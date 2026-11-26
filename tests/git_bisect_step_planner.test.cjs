/* Regression checks for the Git Bisect Step Planner: catalog cases, an
   independent binary-search model over every candidate count up to 400, the
   worst-case path arithmetic, list parsing, number notation, the page contract
   and catalog integrity. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'git-bisect-step-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* gbp-core:start */';
const endMarker = '/* gbp-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = GitBisectCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Git Bisect Step Planner');
assert.equal(record.category, 'Developer');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.tags.includes('git') && record.tags.includes('bisect'));
assert.ok(record.method.length > 900, 'method records the arithmetic');
assert.ok(Array.isArray(record.sources) && record.sources.length >= 1, 'a source is recorded');
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'source has an https URL');
  assert.ok(source.title.length > 60, 'source title is specific');
}
assert.ok(record.sources.some((source) => source.url === 'https://git-scm.com/docs/git-bisect'), 'git-bisect source');

const run = (input) => C.calculate(input);
const failure = (input) => {
  try {
    C.calculate(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

const kinds = { golden: 0, boundary: 0, validation: 0 };
for (const testCase of record.testCases) {
  kinds[testCase.kind] = (kinds[testCase.kind] || 0) + 1;
  if (testCase.kind === 'validation') {
    const message = failure(testCase.input);
    assert.ok(message, `${testCase.name}: expected a refusal`);
    assert.ok(
      message.includes(testCase.expectedError),
      `${testCase.name}: "${message}" does not mention "${testCase.expectedError}"`
    );
    continue;
  }
  const result = run(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
  assert.equal(result.rows.length, result.steps, `${testCase.name}: one row per test`);
}
assert.equal(kinds.golden, 8, 'eight golden cases');
assert.equal(kinds.boundary, 4, 'four boundary cases');
assert.equal(kinds.validation, 12, 'twelve validation cases');
assert.equal(record.testCases.length, 24, 'twenty-four catalog cases');

// ---- Independent model: binary search over every possible culprit. ----
function independentDepth(count) {
  let worst = 0;
  for (let culprit = 0; culprit < count; culprit++) {
    let lo = 0;
    let hi = count - 1;
    let tests = 0;
    while (lo < hi) {
      const middle = lo + Math.floor((hi - lo) / 2);
      if (culprit <= middle) hi = middle;
      else lo = middle + 1;
      tests++;
      assert.ok(tests <= 64, 'the search terminates');
    }
    worst = Math.max(worst, tests);
  }
  return worst;
}

function doublingSteps(count) {
  let steps = 0;
  let covered = 1;
  while (covered < count) {
    covered *= 2;
    steps++;
  }
  return steps;
}

let modelled = 0;
for (let count = 1; count <= 400; count++) {
  const result = run({ count: String(count) });
  const depth = independentDepth(count);
  assert.equal(result.steps, depth, `${count} commits: steps match the independent search`);
  assert.equal(result.steps, doublingSteps(count), `${count} commits: steps match ceil(log2 n)`);
  assert.equal(result.commits, count);
  assert.equal(result.linear, count - 1);
  assert.equal(result.rows.length, depth, `${count} commits: one row per worst-case test`);

  let lo = 0;
  let hi = count - 1;
  result.rows.forEach((row, index) => {
    const before = hi - lo + 1;
    assert.equal(row.step, index + 1, 'step numbering');
    assert.equal(row.before, before, `${count} commits: candidate count`);
    assert.equal(row.index, lo + Math.floor((before - 1) / 2), `${count} commits: lower-middle pick`);
    assert.equal(row.good, before - 1 - Math.floor((before - 1) / 2), `${count} commits: good branch size`);
    assert.equal(row.bad, Math.floor((before - 1) / 2) + 1, `${count} commits: bad branch size`);
    assert.equal(row.good + row.bad, before, 'the two answers partition the range');
    assert.ok(Math.max(row.good, row.bad) === Math.ceil(before / 2), 'the larger half is at most half the range');
    hi = row.index;
  });
  assert.equal(lo, hi, `${count} commits: the path ends on one commit`);
  modelled++;
}
assert.equal(modelled, 400);

// ---- The large ends of the accepted range. ----
assert.equal(run({ count: '1000000' }).steps, 20, 'a million commits take 20 tests');
assert.equal(run({ count: '1000000' }).rows[0].index, 499999, 'the first test is the lower middle');
assert.equal(C.worstCaseSteps(1), 0, 'no test for a single commit');
assert.equal(C.worstCaseSteps(2), 1);
assert.equal(C.worstCaseSteps(1024), 10);

// ---- List parsing and labels. ----
const four = 'a1b2c3d Add the cache\nb2c3d4e Cache the lookups\nc3d4e5f Cache the index\nd4e5f6a Trim the cache';
const listed = run({ commits: four, count: '500' });
assert.equal(listed.commits, 4, 'the list replaces the count');
assert.equal(listed.steps, 2);
assert.equal(listed.rows[0].index, 1, 'the second of four commits is the lower middle');
assert.equal(listed.rows[0].short, 'b2c3d4e');
assert.equal(listed.rows[0].subject, 'Cache the lookups');
assert.equal(listed.rows[0].label, 'b2c3d4e Cache the lookups');
assert.equal(listed.basis, 'Following the 4 commits you pasted, oldest first.');

const graph = '* a1b2c3d one\n* b2c3d4e two\n\n   \n* c3d4e5f three';
const bullets = run({ commits: graph, count: '0' });
assert.equal(bullets.commits, 3, 'graph bullets and blank lines are dropped');
assert.equal(bullets.rows[0].short, 'b2c3d4e');

const subjectsOnly = run({ commits: 'Fix the build\nAdd the cache\nShip it' });
assert.equal(subjectsOnly.commits, 3, 'lines without a hash still count');
assert.equal(subjectsOnly.rows[0].short, 'commit 2', 'a subject-only line is named by position');
assert.equal(subjectsOnly.rows[0].subject, 'Add the cache');

const hashOnly = run({ commits: 'deadbeef\ncafebabe' });
assert.equal(hashOnly.rows[0].short, 'deadbeef');
assert.equal(hashOnly.rows[0].subject, '');
assert.equal(run({ commits: four, count: 'not a count' }).commits, 4, 'a list makes the count unnecessary');
assert.equal(run({ count: ' 100 ' }).commits, 100, 'surrounding spaces are trimmed');
assert.equal(run({ count: '+7' }).steps, 3, 'a leading plus is a sign');
assert.ok(failure({ count: '\u22125' }).includes('between 1 and 1,000,000'), 'unicode minus reads as a negative count');
assert.equal(run({ count: 1000 }).commits, 1000, 'a number equals its string');
assert.equal(run({ count: '000100' }).commits, 100, 'leading zeros are a number');
assert.equal(run({ commits: `  ${four.split('\n').join('  \n  ')}  ` }).commits, 4, 'indented lines are trimmed');
assert.equal(run({ commits: four.replace(/\n/g, '\r\n') }).commits, 4, 'CRLF line endings');
assert.equal(run({ count: '100' }).rows[0].short, 'commit 50 of 100', 'count mode names the pick by position');
assert.equal(run({ commits: 'x'.repeat(200) }).commits, 1, 'a 200-character line is accepted');
assert.ok(failure({ commits: 'x'.repeat(201) }).includes('200 characters'), 'a 201-character line is refused');
assert.ok(
  failure({ commits: Array.from({ length: 5001 }, (_, index) => `c${index} s`).join('\n') })
    .includes('at most 5,000 commits'),
  'a list over 5,000 commits is refused'
);
assert.equal(run({ count: '5000' }).steps, 13, '5,000 commits take 13 tests');

// ---- Headlines, commands and the empty plan. ----
const single = run({ count: '1' });
assert.equal(single.steps, 0);
assert.equal(single.rows.length, 0, 'a single commit needs no row');
assert.equal(single.headline, 'No tests');
assert.ok(single.summary.includes('nothing has to be tested'));
const hundred = run({});
assert.equal(hundred.headline, '7 tests');
assert.ok(hundred.summary.includes('99'), 'the linear comparison is reported');
assert.equal(run({ count: '2' }).headline, '1 test');
assert.equal(JSON.stringify(hundred.commands), JSON.stringify([
  'git bisect start',
  'git bisect bad <bad-rev>',
  'git bisect good <good-rev>',
  'git bisect reset'
]));

// ---- Page contract. ----
assert.ok(html.includes('<html lang="en">'));
assert.equal((html.match(/<script/g) || []).length, 3, 'one inline script plus theme-init and app.js');
assert.equal((html.match(/<script(?![^>]*\bsrc=)/g) || []).length, 1, 'exactly one inline script');
assert.ok(!/(?:src|href)="https?:\/\//.test(html), 'no external assets');
for (const forbidden of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'WebSocket', 'indexedDB', 'navigator.sendBeacon']) {
  assert.ok(!html.includes(forbidden), `offline page does not use ${forbidden}`);
}
assert.equal((html.match(/<input\b/g) || []).length, 1, 'one count field');
assert.equal((html.match(/<textarea\b/g) || []).length, 1, 'one commit list');
for (const id of ['count', 'commits']) {
  assert.ok(html.includes(`<label for="${id}">`), `label for ${id}`);
  assert.ok(html.includes(`id="${id}"`), `control ${id}`);
}
assert.ok(/id="gbp-out" aria-live="polite"/.test(html), 'live result region');
assert.ok(/id="gbp-err" role="alert" aria-live="polite"/.test(html), 'live error region');
assert.ok(/<button type="submit">Plan the bisect<\/button>/.test(html), 'submit button');
assert.ok(html.includes('git rev-list --count good..bad'), 'notes give the candidate count');
assert.ok(html.includes('ceil(log2 N)'), 'notes state the bound');
assert.ok(html.includes('git bisect skip') && html.includes('git bisect reset'), 'notes cover skip and reset');
assert.ok(html.includes('exit code 125'), 'notes explain the run exit code');
assert.ok(!/←\s*(?:All tools|Back to all tools)/.test(html), 'no page-level back link');

// ---- Catalog integrity and duplicate-name guard. ----
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Developer').length, 55,
  'Developer count');
assert.equal(catalog.tools.length, 2471, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2210, 'public tools');
const names = new Map();
for (const tool of catalog.tools) {
  if (tool.slug === record.slug) continue;
  for (const value of [tool.slug, tool.name, ...(tool.aliases || [])]) {
    names.set(String(value).toLowerCase(), tool.slug);
  }
}
for (const value of [record.slug, record.name, ...record.aliases]) {
  assert.equal(names.get(String(value).toLowerCase()), undefined, `duplicate name or alias: ${value}`);
}
assert.ok(fs.existsSync(path.join(root, 'frontend/tools', record.slug, 'index.html')));

console.log(`${slug}: ${record.testCases.length} catalog cases, ${modelled} candidate counts match the independent binary-search model, notation, list parsing and page contract green`);
