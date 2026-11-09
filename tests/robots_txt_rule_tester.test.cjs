/* Regression checks for the robots.txt rule tester, RFC/Google examples,
   an independent wildcard oracle, catalog vectors and offline page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'robots-txt-rule-tester';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* robots-rule-core:start */';
const endMarker = '/* robots-rule-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'robots rule core markers missing');
const core = html.slice(start, end + endMarker.length);
const sandbox = { module: {}, URL };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RobotsRuleCore;', sandbox);
const C = sandbox.module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.evaluate(input));
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};
function projection(report) {
  return {
    verdicts: report.results.map((result) => result.allowed),
    ruleLines: report.results.map((result) => result.rule ? result.rule.line : null),
    ruleTypes: report.results.map((result) => result.rule ? result.rule.type : null),
    normalizedPaths: report.results.map((result) => result.path),
    implicit: report.results.map((result) => result.implicit),
    matches: report.results.map((result) => result.matches),
    selectionKind: report.selection.kind,
    selectedGroups: report.summary.selectedGroups,
    groups: report.summary.groups,
    rules: report.summary.rules,
    paths: report.summary.paths,
  };
}

// Full-table dynamic programming is deliberately independent of the page's
// greedy matcher. Each DP cell answers whether pattern[:p] matches path[:s].
function wildcardOracle(pattern, target, anchored) {
  const rows = Array.from({ length: pattern.length + 1 }, () => Array(target.length + 1).fill(false));
  rows[0][0] = true;
  for (let p = 0; p < pattern.length; p += 1) {
    for (let s = 0; s <= target.length; s += 1) {
      if (pattern[p] === '*') rows[p + 1][s] = rows[p][s] || (s > 0 && rows[p + 1][s - 1]);
      else if (s < target.length && pattern[p] === target[s]) rows[p + 1][s + 1] = rows[p][s];
    }
  }
  return anchored ? rows[pattern.length][target.length] : rows[pattern.length].some(Boolean);
}
function words(alphabet, maxLength) {
  const out = [''];
  let previous = [''];
  for (let length = 1; length <= maxLength; length += 1) {
    const next = [];
    for (const prefix of previous) for (const character of alphabet) next.push(prefix + character);
    out.push(...next);
    previous = next;
  }
  return out;
}
let wildcardComparisons = 0;
for (const pattern of words(['a', '/', '*'], 4)) {
  for (const target of words(['a', 'b', '/'], 4)) {
    for (const anchored of [false, true]) {
      assert.equal(C.matchesPattern(pattern, target, anchored), wildcardOracle(pattern, target, anchored),
        `wildcard mismatch ${JSON.stringify({ pattern, target, anchored })}`);
      wildcardComparisons += 1;
    }
  }
}
assert.ok(wildcardComparisons > 25000);

// Octet canonicalisation and special-character boundaries.
assert.equal(C.normalizeOctets('/foo/bar/%62%61%7a', true), '/foo/bar/baz');
assert.equal(C.normalizeOctets('/foo/%2f', true), '/foo/%2F');
assert.equal(C.normalizeOctets('/foo/ツ', true), '/foo/%E3%83%84');
assert.equal(C.normalizeOctets('/foo/ツ', false), '/foo/%E3%83%84');
assert.equal(C.normalizeOctets('/literal/*$', false), '/literal/%2A%24');
assert.equal(C.normalizeOctets('/100%', false), '/100%25');
assert.equal(C.matchesPattern('/path/file-with-a-%2A.html', '/path/file-with-a-%2A.html', false), true);
assert.equal(C.matchesPattern('/path/file-with-a-%2A.html', '/path/file-with-a-other.html', false), false);

// Bounds, parsing corner cases and deterministic evaluation.
const manyPaths = Array.from({ length: 100 }, (_, index) => `/${index}`).join('\n');
assert.equal(run({ robots: 'User-agent: *\nDisallow: /private', agent: 'ExampleBot', paths: manyPaths }).summary.paths, 100);
assert.match(failure({ robots: '', agent: 'ExampleBot', paths: manyPaths + '\n/100' }), /no more than 100/);
assert.match(failure({ robots: 'a'.repeat(C.MAX_TEXT + 1), agent: 'ExampleBot', paths: '/' }), /exceeds 524,288/);
assert.match(failure({ robots: 'User-agent: *\nDisallow: /' + 'a'.repeat(8192), agent: 'ExampleBot', paths: '/' }), /line 2 exceeds 8,192/);
assert.match(failure({ robots: '', agent: 'x'.repeat(513), paths: '/' }), /exceeds 512/);
let report = run({ robots: 'User-agent: bot\nDisallow: /short\nUser-agent: ExampleBot\nDisallow: /long\nUser-agent: *\nDisallow: /wild', agent: 'examplebot/1', paths: '/long/x\n/short/x\n/wild' });
assert.equal(report.selection.kind, 'specific');
assert.equal(report.selection.specificity, 'ExampleBot'.length);
assert.deepEqual(report.selection.groupLines, [3]);
assert.deepEqual(projection(report).verdicts, [false, true, true]);
report = run({ robots: 'User-agent: bad/token\nDisallow: /\nUser-agent: *\nDisallow: /wild', agent: 'bad/token', paths: '/x\n/wild' });
assert.equal(report.selection.kind, 'wildcard', 'invalid product token is ignored');
assert.deepEqual(projection(report).verdicts, [true, false]);
assert.ok(report.warnings.some((warning) => warning.includes('not an RFC product token')));
report = run({ robots: 'User-agent: *\r\nDisallow: /private\r', agent: 'ExampleBot', paths: '/private/x\r\n/public' });
assert.deepEqual(projection(report).verdicts, [false, true], 'CRLF and CR line endings');
report = run({ robots: 'User-agent: *\nDisallow: /', agent: 'ExampleBot', paths: '/robots.txt?x=1\n/robots.txt' });
assert.deepEqual(projection(report).implicit, [false, true]);
assert.deepEqual(projection(report).verdicts, [false, true]);
const deterministicInput = { robots: 'User-agent: *\nDisallow: /a*\nAllow: /ab$', agent: 'ExampleBot', paths: '/ab\n/abc\n/x' };
assert.deepEqual(run(deterministicInput), run(deterministicInput));
assert.deepEqual(deterministicInput, { robots: 'User-agent: *\nDisallow: /a*\nAllow: /ab$', agent: 'ExampleBot', paths: '/ab\n/abc\n/x' });

// The page is local-only, accessible and wired to real controls.
assert.ok(!/(?:src|href)=["']https?:\/\//i.test(html), 'page loads an external resource');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="robots-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<h1>robots\.txt Rule Tester<\/h1>/.test(html), 'page heading');
for (const id of ['robots', 'agent', 'paths']) {
  assert.ok(new RegExp(`for="${id}"`).test(html), `label for ${id}`);
  assert.ok(new RegExp(`id="${id}"`).test(html), `control ${id}`);
}
assert.ok(/name="viewport"/.test(html), 'viewport');
assert.ok(/min-height:44px/.test(html), '44px controls');
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/(?:getElementById|\$)\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 10, 'page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), `missing element id: ${id}`);
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');

// Replay every catalog vector and enforce catalog identity and metadata.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'catalog record must be unique');
assert.equal(record.name, 'robots.txt Rule Tester');
assert.equal(record.category, 'Developer');
assert.equal(record.subcategory, 'Validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'));
assert.ok(record.sources.some((source) => source.url.includes('rfc9309')));
assert.ok(record.sources.some((source) => source.url.includes('developers.google.com')));
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 37);
assert.equal(kinds('golden'), 25);
assert.equal(kinds('boundary'), 4);
assert.equal(kinds('validation'), 8);
for (const testCase of record.testCases) {
  const { input, expected } = testCase;
  if (expected.error) {
    assert.equal(failure(input), expected.error, testCase.name);
    continue;
  }
  const actual = projection(run(input));
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, `${testCase.name}: ${key}`);
}
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases || [])) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], `catalog key collides: ${key}`);
}
assert.equal(new Set(record.aliases).size, record.aliases.length);

console.log(`${slug}: all checks passed (${record.testCases.length} catalog cases, ${wildcardComparisons} independent wildcard comparisons)`);
