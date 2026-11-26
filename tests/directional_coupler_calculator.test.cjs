/* Directional coupler calculator: coupling, directivity, isolation and insertion
   loss from four port powers, the power-budget invariants, the refusals, the
   catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'directional-coupler-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* directional-coupler-core:start */';
const endMarker = '/* directional-coupler-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = DirectionalCouplerCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');

const base = { p1: 0, p2: -0.2, p3: -20, p4: -45 };
const run = (overrides) => C.calculate(Object.assign({}, base, overrides || {}));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};

// ---- The published definitions, port power by port power.
const defaults = run();
assert.equal(defaults.coupling, 20);
assert.equal(defaults.directivity, 25);
assert.equal(defaults.isolation, 45);
assert.equal(defaults.insertionLoss, 0.2);
assert.equal(defaults.coupledPercent, 1);
assert.equal(defaults.throughPercent, 95.5);
assert.equal(defaults.totalPercent, 96.5);
assert.equal(defaults.headline, '20.00 dB');
assert.equal(defaults.warnings.length, 0);

// ---- Isolation is coupling plus directivity, and the four definitions agree
//      with the dB differences of the input powers over a deterministic sweep.
let checked = 0;
for (const p1 of [-40, -20, 0, 20, 40]) {
  for (const coupling of [3, 6, 10, 16, 20, 26, 30]) {
    for (const directivity of [0, 5, 10, 20, 30, 40]) {
      const p3 = p1 - coupling;
      const p4 = p3 - directivity;
      if (p4 < -100) continue;
      const p2 = p1 - 0.25;
      const result = C.calculate({ p1, p2, p3, p4 });
      assert.equal(result.coupling, coupling, 'coupling');
      assert.equal(result.directivity, directivity, 'directivity');
      assert.ok(Math.abs(result.isolation - (coupling + directivity)) <= 0.01,
        'isolation is coupling plus directivity');
      assert.equal(result.insertionLoss, 0.25, 'insertion loss');
      assert.ok(result.coupledPercent > 0 && result.coupledPercent <= 100);
      assert.ok(result.throughPercent > 0 && result.throughPercent <= 100);
      checked += 1;
    }
  }
}

// ---- A tighter coupling takes a larger share of the input, and a larger
//      through power lowers the insertion loss.
const fractions = [3, 6, 10, 20, 30].map((c) => run({ p3: -c, p4: -c - 25 }).coupledPercent);
for (let i = 1; i < fractions.length; i += 1) {
  assert.ok(fractions[i] < fractions[i - 1], 'the coupled fraction falls as coupling rises');
}
assert.ok(run({ p2: -0.1 }).insertionLoss < run({ p2: -0.5 }).insertionLoss);
assert.equal(run({ p2: 0 }).insertionLoss, 0);

// ---- Numeric strings behave like numbers; one decimal place is enough.
const strings = C.calculate({ p1: '0', p2: '-0.2', p3: '-20', p4: '-45' });
assert.equal(JSON.stringify(strings), JSON.stringify(defaults));
assert.equal(run({ p1: '.5' }).p1, 0.5);
assert.equal(failure({ p1: '1e1' }), 'The input power must be a number in dBm.');

// ---- Refusals, in the page's own words.
assert.equal(failure({ p1: '' }), 'The input power is required.');
assert.equal(failure({ p1: '0 dBm' }), 'The input power must be a number in dBm.');
assert.equal(failure({ p2: 101 }), 'The through power must be between -100 and 100 dBm.');
assert.equal(failure({ p3: 0 }), 'The coupled power must be below the input power.');
assert.equal(failure({ p4: -10 }), 'The isolated power cannot exceed the coupled power.');
assert.equal(failure({ p2: 0.5 }), 'The through power cannot exceed the input power for a passive coupler.');

// ---- Warnings: impossible power total, weak directivity and excessive loss.
assert.ok(run({ p2: 0, p3: -10, p4: -20 }).warnings.some((w) => /cannot do/.test(w)));
assert.ok(run({ p3: -20, p4: -20 }).warnings.some((w) => /essentially zero/.test(w)));
assert.ok(run({ p3: -20, p4: -25 }).warnings.some((w) => /below 10 dB/.test(w)));
assert.ok(run({ p2: -3 }).warnings.some((w) => /above 1 dB/.test(w)));
assert.ok(run({ p3: -40, p4: -80 }).warnings.some((w) => /above 30 dB/.test(w)));
assert.equal(run().warnings.length, 0, 'the default measurement is plausible');

// ---- Catalog record: counts, cases and metadata.
assert.equal(catalog.tools.length, 2474, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2213, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Communications Engineering').length, 55,
  'Communications Engineering count');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.length > 600);
assert.equal(record.sources.length, 2);
assert.match(record.sources[0].url, /^https:\/\/www\.microwaves101\.com\//);
assert.match(record.sources[1].url, /^https:\/\/en\.wikipedia\.org\//);
assert.ok(record.tags.length === new Set(record.tags).size, 'tags are internally unique');

const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 4, validation: 6 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(actual[key], expected, testCase.name + ': ' + key);
  }
}

// ---- Uniqueness across the catalog.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
for (const alias of record.aliases) {
  assert.equal(catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase())).length,
  1, 'alias is unique: ' + alias);
}

// ---- Page contract.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Directional Coupler Calculator<\/h1>/);
assert.match(html, /<form id="coupler-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label[^>]* for="/g) || []).length, 4, 'every control is labelled');
assert.equal((html.match(/<input/g) || []).length, 4);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function|localStorage|sessionStorage/.test(html),
  'no network calls, no eval, no storage');
assert.ok(!/<iframe|<img|<canvas|<select/.test(html), 'no embedded media or extra controls');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored and nothing is sent/i, 'the privacy note stays on the page');
assert.match(html, /min-height:46px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* directional-coupler-core:start \*\//g) || []).length, 1);
assert.equal((html.match(/\/\* directional-coupler-core:end \*\//g) || []).length, 1);

// Every id the script reaches for exists in the markup.
const ids = ['coupler-form', 'in-p1', 'in-p2', 'in-p3', 'in-p4', 'err', 'out'];
for (const id of ids) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}

console.log('directional coupler calculator OK: ' + checked + ' sweep cases, ' + record.testCases.length +
  ' catalog cases, invariants, refusals, warnings, uniqueness and page contract OK');
