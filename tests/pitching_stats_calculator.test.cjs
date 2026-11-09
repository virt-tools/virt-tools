/* Regression checks for the pitching-stats core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'pitching-stats-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* pitching-stats-core:start */');
const end = html.indexOf('/* pitching-stats-core:end */');
assert.ok(start > -1 && end > start, 'pitching stats core markers missing');
const core = html.slice(start, end + '/* pitching-stats-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PitchingStatsCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const stats = (options) => plain(C.calculate(options));
const failure = (options) => {
  try {
    stats(options);
  } catch (error) {
    return error.message;
  }
  return null;
};

// ---- Field contract.
assert.equal(plain(C.MAX), 20000);
assert.equal(plain(C.MAX_OUTS), 999 * 3);
assert.deepEqual(Object.keys(plain(C.DEFAULTS)).sort(),
  ['earnedRuns', 'hits', 'homers', 'innings', 'strikeouts', 'walks']);
assert.deepEqual(plain(C.FIELDS).map((field) => field[0]),
  ['earnedRuns', 'hits', 'walks', 'strikeouts', 'homers']);

// ---- The default line, checked by hand: 20 outs is 6 2/3 innings.
const base = { innings: '6.2', earnedRuns: 2, hits: 5, walks: 1, strikeouts: 7, homers: 1 };
const d = stats(base);
assert.equal(d.outs, 20);                    // 6 * 3 + 2
assert.equal(d.inningsWhole, 6);
assert.equal(d.inningsOuts, 2);
assert.equal(d.inningsPitched, 20 / 3);
assert.equal(d.era, 2.7);                    // 27 * 2 / 20
assert.equal(d.whip, 0.9);                   // 3 * 6 / 20
assert.equal(d.strikeoutsPerNine, 9.45);     // 27 * 7 / 20
assert.equal(d.walksPerNine, 1.35);          // 27 * 1 / 20
assert.equal(d.homersPerNine, 1.35);         // 27 * 1 / 20
assert.equal(d.strikeoutWalkRatio, 7);       // 7 / 1

// The defaults object reproduces the same line when no input is supplied.
assert.deepEqual(stats({}), d);
assert.deepEqual(stats(), d);

// ---- Every rate satisfies the identity the method text states.
const lines = [
  base,
  { innings: '9', earnedRuns: 0, hits: 0, walks: 0, strikeouts: 10, homers: 0 },
  { innings: '0.1', earnedRuns: 1, hits: 2, walks: 1, strikeouts: 0, homers: 0 },
  { innings: '200', earnedRuns: 60, hits: 180, walks: 50, strikeouts: 220, homers: 20 },
  { innings: '7.1', earnedRuns: 3, hits: 6, walks: 2, strikeouts: 5, homers: 1 },
  { innings: '1.2', earnedRuns: 4, hits: 3, walks: 3, strikeouts: 2, homers: 2 }
];
for (const line of lines) {
  const r = stats(line);
  const outs = r.outs;
  assert.equal(outs, r.inningsWhole * 3 + r.inningsOuts, 'outs come from the innings notation');
  assert.ok(Math.abs(r.era - 27 * r.earnedRuns / outs) < 0.005, 'ERA identity');
  assert.ok(Math.abs(r.whip - 3 * (r.hits + r.walks) / outs) < 0.005, 'WHIP identity');
  assert.ok(Math.abs(r.strikeoutsPerNine - 27 * r.strikeouts / outs) < 0.005, 'K/9 identity');
  assert.ok(Math.abs(r.walksPerNine - 27 * r.walks / outs) < 0.005, 'BB/9 identity');
  assert.ok(Math.abs(r.homersPerNine - 27 * r.homers / outs) < 0.005, 'HR/9 identity');
  if (r.walks > 0) {
    assert.ok(Math.abs(r.strikeoutWalkRatio - r.strikeouts / r.walks) < 0.005, 'K/BB identity');
    // The per-nine rates divide out: K/9 over BB/9 is the same as K over BB.
    assert.ok(Math.abs(r.strikeoutsPerNine / r.walksPerNine - r.strikeouts / r.walks) < 0.01,
      'K/9 over BB/9 matches the strikeout-to-walk ratio');
  } else {
    assert.equal(r.strikeoutWalkRatio, null, 'K/BB is undefined without walks');
  }
}

// Doubling every count while doubling the innings leaves every rate unchanged.
const doubled = stats({ innings: '13.1', earnedRuns: 4, hits: 10, walks: 2, strikeouts: 14, homers: 2 });
assert.equal(doubled.outs, 40);              // exactly twice the default 20 outs
for (const key of ['era', 'whip', 'strikeoutsPerNine', 'walksPerNine', 'homersPerNine', 'strikeoutWalkRatio']) {
  assert.equal(doubled[key], d[key], key + ' is unchanged by doubling the workload');
}

// Innings notation: a trailing .0 is legal, and padded whole innings keep their value.
assert.equal(stats({ innings: '3.0' }).outs, 9);
assert.equal(stats({ innings: '006.2' }).outs, 20);
assert.equal(stats({ innings: '0.2' }).outs, 2);
assert.equal(stats({ innings: 6 }).outs, 18, 'a numeric innings value is accepted');

// ---- Refusals name the failing field.
assert.equal(failure({ innings: '' }), 'Innings pitched is required.');
assert.equal(failure({ innings: '0' }), 'Innings pitched must be greater than zero.');
assert.equal(failure({ innings: '0.0' }), 'Innings pitched must be greater than zero.');
assert.equal(failure({ innings: '6.3' }),
  'Innings pitched must be a whole number of innings, or use .1 for one out and .2 for two outs, like 6.2.');
assert.equal(failure({ innings: '999.1' }), 'Innings pitched must be 999 innings or fewer.');
assert.equal(failure({ innings: '6.2', earnedRuns: '' }), 'Earned runs is required.');
assert.equal(failure({ innings: '6.2', hits: 20001 }), 'Hits allowed must be a whole number from 0 to 20000.');
assert.equal(failure({ innings: '6.2', walks: '1.5' }), 'Walks must be a whole number from 0 to 20000.');
assert.equal(failure({ innings: '6.2', strikeouts: -1 }), 'Strikeouts must be a whole number from 0 to 20000.');
assert.equal(failure({ innings: '6.2', homers: 'many' }), 'Home runs allowed must be a whole number from 0 to 20000.');
for (const bad of ['6.4', '7.3', 'abc', '1.2.3', '-5', '+5', '  ', 'NaN', 'Infinity', '0x10', '6,2', '6 2']) {
  assert.ok(failure({ innings: bad }), 'innings refuses ' + JSON.stringify(bad));
}

// ---- Boundaries: the maximum line is accepted, one out beyond it is not.
const maxLine = stats({ innings: '999', earnedRuns: 300, hits: 900, walks: 200, strikeouts: 900, homers: 60 });
assert.equal(maxLine.outs, 2997);
assert.equal(maxLine.era, 2.7);
assert.equal(maxLine.whip, 1.1);

// ---- The page must not reach the network, store data or inject markup.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="pitching-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<h1>Baseball Pitching Stats Calculator<\/h1>/.test(html), 'page heading');
for (const id of ['innings', 'earned', 'hits', 'walks', 'strikeouts', 'homers']) {
  assert.ok(new RegExp('for="in-' + id + '"').test(html), 'label for in-' + id);
  assert.ok(new RegExp('id="in-' + id + '"').test(html), 'control in-' + id);
}
assert.ok(/name="viewport"/.test(html), 'viewport');
// Every element the page script looks up must exist in the markup.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 8, 'the page looks up its controls');
for (const id of requestedIds) {
  assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
}
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Baseball Pitching Stats Calculator');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.description.length > 80, 'description is descriptive');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 13, 'catalog case count');
assert.equal(kinds('golden'), 4, 'four golden cases');
assert.equal(kinds('boundary'), 2, 'two boundary cases');
assert.equal(kinds('validation'), 7, 'seven validation cases');
for (const testCase of record.testCases) {
  const { input, expected } = testCase;
  if (expected.error) {
    assert.throws(
      () => C.calculate(input),
      new RegExp(expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = plain(C.calculate(input));
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(result[key], value, testCase.name + ' ' + key);
  }
}

// The new record's slug, name and aliases must not collide with any other record.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases || [])) {
  const owners = keyOwners.get(String(key).toLowerCase());
  assert.deepEqual(Array.from(owners), [slug], 'catalog key is unique to this tool: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.ok(record.aliases.some((alias) => alias === alias.toLowerCase()), 'lowercase search aliases are present');

console.log('pitching-stats-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, 6 fields, 1 innings notation)');
