/* Precious metal fineness: the karat/parts-per-thousand/percent identities,
   the nearest-mark lookup over the whole scale, the piece-mass split, the
   warnings and refusals, the catalog cases, uniqueness and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'precious-metal-fineness-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* fineness-core:start */';
const endMarker = '/* fineness-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = FinenessCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');

const run = (overrides) => C.calculate(Object.assign({ metal: 'gold', unit: 'millesimal', value: '750', mass: '' }, overrides || {}));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};
const round = (value, digits) => {
  const factor = Math.pow(10, digits);
  return Math.floor(value * factor + 0.5 + 1e-9) / factor;
};

// ---- Karat is parts per 24 by mass; parts per thousand and percent are tens.
for (let karat = 0.5; karat <= 24; karat += 0.5) {
  const result = run({ unit: 'karat', value: String(karat) });
  assert.equal(result.fineness, round(karat * 1000 / 24, 1), 'karat ' + karat + ' -> fineness');
  assert.equal(result.percent, round(karat * 1000 / 24 / 10, 2), 'karat ' + karat + ' -> percent');
  assert.equal(result.karat, karat, 'karat ' + karat + ' round-trips');
}
for (let percent = 1; percent <= 100; percent += 1) {
  const result = run({ unit: 'percent', value: String(percent) });
  assert.equal(result.fineness, percent * 10, 'percent ' + percent + ' -> fineness');
  assert.equal(result.percent, percent, 'percent ' + percent + ' round-trips');
}
for (let fineness = 1; fineness <= 1000; fineness += 1) {
  const result = run({ value: String(fineness) });
  assert.equal(result.percent, round(fineness / 10, 2), 'fineness ' + fineness + ' -> percent');
  assert.equal(result.karat, round(fineness * 24 / 1000, 2), 'fineness ' + fineness + ' -> karat');
}

// ---- The nearest mark is the published mark with the smallest distance.
const MARKS = {
  gold: [999, 916, 750, 585, 500, 417, 375, 333],
  silver: [999, 958, 925, 900, 835, 800],
  platinum: [999.5, 999, 950, 900, 850, 750]
};
for (const metal of Object.keys(MARKS)) {
  for (let step = 1; step <= 1000; step += 1) {
    const fineness = step * 1;
    const result = run({ metal, value: String(fineness) });
    let nearest = MARKS[metal][0];
    for (const mark of MARKS[metal]) {
      if (Math.abs(fineness - mark) < Math.abs(fineness - nearest)) nearest = mark;
    }
    assert.equal(result.mark, nearest, metal + ' ' + fineness + ' nearest mark');
    assert.equal(result.delta, round(fineness - nearest, 1), metal + ' ' + fineness + ' delta');
  }
}
assert.equal(run({ value: '750' }).mark, 750);
assert.equal(run({ value: '585' }).delta, 0, '585 is the 14 karat stamp even though 14/24 is 583.3');
assert.equal(run({ unit: 'karat', value: '14' }).delta, -1.7, '14 karat computes 1.7 below its stamp');

// ---- The optional piece mass splits into fine metal and alloy.
const masses = [0, 0.5, 3.2, 42.5, 100, 1000, 100000];
const finenesses = [333, 375, 585, 750, 916, 999, 925, 950];
for (const metal of ['gold', 'silver', 'platinum']) {
  for (const fineness of finenesses) {
    for (const mass of masses) {
      const result = run({ metal, value: String(fineness), mass: String(mass) });
      if ((metal === 'silver' && fineness > 999) || (metal === 'platinum' && fineness > 999.5)) continue;
      assert.equal(result.mass, mass);
      assert.equal(result.fineMass, round(mass * fineness / 1000, 3), 'fine metal ' + fineness + '/' + mass);
      assert.equal(result.alloyMass, round(mass - mass * fineness / 1000, 3), 'alloy ' + fineness + '/' + mass);
      assert.ok(Math.abs(result.fineMass + result.alloyMass - mass) <= 0.0011, 'the split adds back to the piece');
    }
  }
}
assert.equal(run({ mass: '42.5', metal: 'silver', value: '925' }).fineMass, 39.313);
assert.equal(run({ mass: '42.5', metal: 'silver', value: '925' }).alloyMass, 3.188);

// ---- Monotonicity: more fineness never lowers the reported purity.
let previous = 0;
for (let fineness = 1; fineness <= 1000; fineness += 7) {
  const result = run({ value: String(fineness) });
  assert.ok(result.fineness >= previous, 'fineness is monotonic');
  previous = result.fineness;
}

// ---- Warnings.
const warn = (overrides) => JSON.stringify(run(overrides).warnings);
assert.equal(warn({ unit: 'karat', value: '24' }),
  JSON.stringify(['1,000 parts per thousand is pure metal on paper; even fine bullion is stamped 999 or 999.9.']));
assert.equal(warn({ value: '999.9' }), '[]');
assert.equal(warn({ value: '332' }),
  JSON.stringify(['Below the lowest common mark for gold (333 \u2030, 8 karat).']));
assert.equal(warn({ metal: 'silver', value: '925' }), '[]');
assert.equal(warn({ metal: 'platinum', value: '750' }), '[]');
assert.equal(warn({ metal: 'silver', value: '925', mass: '10' }), '[]');

// ---- Refusals.
assert.equal(failure({ metal: 'gold', unit: 'grain' }), 'Choose karat, parts per thousand or percent.');
assert.equal(failure({ metal: 'bronze' }), 'Choose gold, silver or platinum.');
assert.equal(failure({ metal: 'silver', unit: 'karat', value: '14' }),
  'Karat measures gold only; use parts per thousand or percent for silver and platinum.');
assert.equal(failure({ metal: 'platinum', unit: 'karat', value: '18' }),
  'Karat measures gold only; use parts per thousand or percent for silver and platinum.');
assert.equal(failure({ unit: 'karat', value: '24.5' }), 'Enter a karat value above zero and no more than 24.');
assert.equal(failure({ value: '0' }), 'Enter parts per thousand above zero and no more than 1,000.');
assert.equal(failure({ value: '1000.5' }), 'Enter parts per thousand above zero and no more than 1,000.');
assert.equal(failure({ unit: 'percent', value: '0' }), 'Enter a percentage above zero and no more than 100.');
assert.equal(failure({ unit: 'percent', value: '100.5' }), 'Enter a percentage above zero and no more than 100.');
assert.equal(failure({ value: '' }), 'Enter a fineness value to convert.');
assert.equal(failure({ value: 'eighteen' }), 'Enter the value as a number, such as 750.');
assert.equal(failure({ mass: 'abc' }), 'Enter the piece mass in grams, or leave it blank.');
assert.equal(failure({ mass: '-0.1' }), 'The piece mass must be between 0 and 100,000 grams.');
assert.equal(failure({ mass: '100001' }), 'The piece mass must be between 0 and 100,000 grams.');
assert.equal(run({ mass: '' }).mass, null, 'a blank mass stays out of the result');
assert.equal(run({ mass: '  ' }).mass, null, 'whitespace is a blank mass');
assert.equal(run({ mass: '0' }).fineMass, 0, 'a zero mass is a real zero');

// ---- Catalog metadata and cases.
assert.equal(record.category, 'Converters');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.ok(record.description.length > 80);
assert.ok(record.method.length > 400);
assert.ok(record.guidance.length > 80);
assert.deepEqual(record.sources.map((source) => source.url), ['https://en.wikipedia.org/wiki/Fineness']);
assert.match(record.sources[0].title, /karat/i);
assert.match(record.sources[0].title, /parts per 1,000/);

const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 7, validation: 11 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(JSON.stringify(actual[key]), JSON.stringify(expected), testCase.name + ': ' + key);
  }
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(testCase.expected).sort(),
    'the case covers every result field: ' + testCase.name);
}

// ---- Uniqueness across the catalog.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
assert.equal(record.tags.length, new Set(record.tags).size, 'tags are internally unique');
assert.ok(record.tags.includes('converters'));
for (const alias of record.aliases) {
  assert.equal(catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase())).length,
  1, 'alias is unique: ' + alias);
}
assert.deepEqual(
  catalog.tools.filter((tool) =>
    /fineness|karat|precious-metal/.test(tool.slug) && tool.slug !== slug &&
    /karat|fineness|hallmark/.test(tool.slug + ' ' + tool.name.toLowerCase())).map((tool) => tool.slug),
  [],
  'no other karat or fineness tool exists'
);
assert.ok(catalog.tools.some((tool) => tool.slug === 'ring-size-converter'),
  'the ring size converter stays a separate tool');
assert.ok(!catalog.tools.some((tool) => tool.slug === 'karat-converter'), 'no older karat slug to revive');

// ---- Page contract.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Precious Metal Fineness Converter<\/h1>/);
assert.match(html, /<form id="fineness-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label for="/g) || []).length, 4, 'every control is labelled');
assert.equal((html.match(/<input/g) || []).length, 2);
assert.equal((html.match(/<select/g) || []).length, 2);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function|localStorage|sessionStorage/.test(html),
  'no network calls, no eval, no storage');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored and nothing is sent/i, 'the privacy note stays on the page');
assert.match(html, /min-height:46px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* fineness-core:start \*\//g) || []).length, 1);
assert.equal((html.match(/\/\* fineness-core:end \*\//g) || []).length, 1);

// Every id the script reaches for exists in the markup.
const ids = ['fineness-form', 'metal', 'unit', 'value', 'mass', 'clear', 'err', 'out'];
for (const id of ids) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}

console.log('precious metal fineness converter OK: ' + record.testCases.length +
  ' catalog cases, ' + (24 * 2) + ' karat values, 100 percent values, 1,000 fineness values x 3 metals,' +
  ' the piece-mass split over ' + (3 * finenesses.length * masses.length) +
  ' runs, warnings, refusals, uniqueness and page contract OK');
