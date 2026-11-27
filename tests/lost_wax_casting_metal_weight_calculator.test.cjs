/* Lost-wax casting metal weight: the published wax-to-metal conversions, the
   density-ratio identity across a grid, the button allowance, the metal-on-hand
   inversion, warnings, refusals, catalog cases, uniqueness and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'lost-wax-casting-metal-weight-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* casting-metal-core:start */';
const endMarker = '/* casting-metal-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = CastingMetalCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');

const base = { waxWeight: '5', waxSg: '0.95', metal: 'sterling', metalSg: '', allowance: '10' };
const run = (overrides) => C.calculate(Object.assign({}, base, overrides || {}));
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
  const scaled = value * factor;
  return Math.floor(scaled + 0.5 + 1e-9) / factor;
};

// ---- The two published worked examples.
const regal = run({ waxWeight: '0.7', waxSg: '0.95', metal: 'custom', metalSg: '11.2', allowance: '0' });
assert.equal(regal.modelMetal, 8.25, 'Regal: 0.7 / 0.95 x 11.2 = 8.25 g');
assert.equal(regal.totalMetal, 8.25);
assert.equal(regal.volume, 0.7368);
assert.equal(regal.factor, 11.789);

const rio = run({ waxWeight: '5', waxSg: '1.00', metal: 'gold-14k', metalSg: '', allowance: '10' });
assert.equal(rio.modelMetal, 65.35);
assert.equal(rio.allowanceMetal, 6.54);
assert.equal(rio.totalMetal, 71.89, 'Rio Grande: 5.5 g x 13.07 = 71.89 g of 14K yellow gold');
assert.equal(rio.troyOunces, 2.311);
assert.equal(rio.warnings.length, 0);

// ---- The density-ratio identity over a grid of patterns and alloys.
const metals = C.METALS.filter((metal) => metal.sg !== null);
for (const metal of metals) {
  for (const wax of [0.05, 1, 3.2, 12, 250, 4000]) {
    for (const waxSg of [0.85, 0.95, 1.0]) {
      for (const allowance of [0, 10, 25, 60]) {
        const result = run({
          waxWeight: String(wax), waxSg: String(waxSg), metal: metal.key,
          metalSg: '', allowance: String(allowance)
        });
        const volume = wax / waxSg;
        const model = volume * metal.sg;
        const total = model * (1 + allowance / 100);
        assert.equal(result.volume, round(volume, 4), 'volume = wax / wax specific gravity');
        assert.equal(result.modelMetal, round(model, 2), 'model metal = volume x metal specific gravity');
        assert.equal(result.allowanceMetal, round(model * allowance / 100, 2), 'allowance on the model metal');
        assert.equal(result.totalMetal, round(total, 2), 'total = model + allowance');
        assert.equal(result.factor, round(metal.sg / waxSg, 3), 'metal per gram of wax');
        assert.equal(result.troyOunces, round(total / 31.1034768, 3), 'troy ounces');
        assert.ok(Math.abs(result.modelMetal + result.allowanceMetal - result.totalMetal) <= 0.011,
          'the two rounded parts add back to the melt: ' + [metal.key, wax, waxSg, allowance].join('/'));
      }
    }
  }
}

// ---- Monotonic behaviour.
assert.ok(run({ waxWeight: '10' }).totalMetal > run({ waxWeight: '5' }).totalMetal, 'more wax needs more metal');
assert.ok(run({ metal: 'platinum' }).totalMetal > run({ metal: 'sterling' }).totalMetal, 'a denser metal weighs more');
assert.ok(run({ metal: 'gold-24k' }).totalMetal > run({ metal: 'gold-14k' }).totalMetal, 'pure gold is denser than 14K');
assert.ok(run({ waxSg: '0.90' }).totalMetal > run({ waxSg: '1.00' }).totalMetal, 'a lighter wax means more volume');
assert.ok(run({ allowance: '20' }).totalMetal > run({ allowance: '10' }).totalMetal, 'a bigger button needs more metal');
assert.equal(run({ allowance: '0' }).allowanceMetal, 0, 'no allowance, no button metal');

// ---- The metal-on-hand inversion lands back on the melt.
for (const metal of metals) {
  for (const allowance of [0, 10, 40]) {
    const pattern = run({ waxWeight: '7.5', metal: metal.key, allowance: String(allowance) });
    const onHand = pattern.totalMetal;
    const held = run({ waxWeight: '7.5', metal: metal.key, allowance: String(allowance), onHand: String(onHand) });
    assert.equal(held.surplus, 0, 'exactly enough metal leaves no surplus: ' + metal.key);
    assert.ok(Math.abs(held.maxWaxWeight - 7.5) <= 0.004, 'the largest pattern returns the 7.5 g wax: ' + metal.key + ' -> ' + held.maxWaxWeight);
    const replay = run({ waxWeight: String(held.maxWaxWeight), metal: metal.key, allowance: String(allowance) });
    assert.ok(Math.abs(replay.totalMetal - onHand) <= Math.max(0.01, onHand * 0.002),
      'the largest pattern needs the metal on hand: ' + metal.key + ' ' + replay.totalMetal + ' vs ' + onHand);
  }
}
const short = run({ onHand: '20' });
assert.equal(short.totalMetal, 59.98);
assert.equal(short.surplus, -39.98);
assert.equal(short.maxWaxWeight, 1.667);
assert.ok(short.warnings.some((text) => /is 39.98 g short of the 59.98 g melt/.test(text)), 'a shortfall is reported');

// ---- Warnings.
assert.equal(run().warnings.length, 0, 'the default is quiet');
assert.equal(run({ allowance: '0' }).warnings[0],
  'No allowance is added, so the figure covers the model only; a sprue and button still need metal in the crucible.');
assert.ok(run({ waxSg: '0.80' }).warnings.some((text) => /outside the usual 0.85 to 1.00 range/.test(text)),
  'an unusual wax density is called out');
assert.equal(run({ waxSg: '0.96' }).warnings.some((text) => /outside the usual/.test(text)), false,
  '0.96 g/cm3 is ordinary wax');
assert.ok(run({ waxWeight: '400', metal: 'gold-18k' }).warnings
  .some((text) => /check the crucible and flask capacity/.test(text)), 'a melt above a kilogram is called out');
assert.ok(run({ onHand: '1000' }).warnings.some((text) => /More than ten times the melt/.test(text)),
  'a large surplus is called out');
assert.equal(run({ onHand: '70' }).warnings.some((text) => /short|ten times/.test(text)), false,
  'enough metal without a large surplus stays quiet');

// ---- Refusals.
assert.equal(failure({ waxWeight: '' }), 'Enter the wax pattern weight in grams.');
assert.equal(failure({ waxWeight: 'wax' }), 'Enter the wax pattern weight in grams.');
assert.equal(failure({ waxWeight: '0' }), 'The wax weight must be greater than 0 and at most 10,000 grams.');
assert.equal(failure({ waxWeight: '0.009' }), 'The wax weight must be greater than 0 and at most 10,000 grams.');
assert.equal(failure({ waxWeight: '10001' }), 'The wax weight must be greater than 0 and at most 10,000 grams.');
assert.equal(failure({ waxSg: '' }), 'Enter the wax specific gravity.');
assert.equal(failure({ waxSg: 'wax' }), 'Enter the wax specific gravity.');
assert.equal(failure({ waxSg: '0.79' }), 'The wax specific gravity must be between 0.80 and 1.10.');
assert.equal(failure({ waxSg: '1.11' }), 'The wax specific gravity must be between 0.80 and 1.10.');
assert.equal(failure({ allowance: '' }), 'Enter the button and sprue allowance as a percentage.');
assert.equal(failure({ allowance: '-1' }), 'The allowance must be between 0 and 200 percent.');
assert.equal(failure({ allowance: '201' }), 'The allowance must be between 0 and 200 percent.');
assert.equal(failure({ allowance: 'a tenth' }), 'Enter the button and sprue allowance as a percentage.');
assert.equal(failure({ metal: 'custom', metalSg: '' }), 'Enter the specific gravity of the custom alloy.');
assert.equal(failure({ metal: 'custom', metalSg: '26' }), 'The metal specific gravity must be between 1 and 25.');
assert.equal(failure({ metal: 'custom', metalSg: '0.99' }), 'The metal specific gravity must be between 1 and 25.');
assert.equal(failure({ metal: 'titanium' }), 'Choose the casting metal from the list.');
assert.equal(failure({ metal: '' }), 'Choose the casting metal from the list.');
assert.equal(failure({ onHand: '-1' }), 'The metal on hand must be between 0 and 1,000,000 grams.');
assert.equal(failure({ onHand: '1000001' }), 'The metal on hand must be between 0 and 1,000,000 grams.');
assert.equal(failure({ onHand: 'some' }), 'Enter the metal on hand in grams, or leave it blank.');
const nothing = (value) => {
  try {
    C.calculate(value);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};
assert.equal(nothing(null), 'Nothing to calculate.');
assert.equal(nothing('5'), 'Nothing to calculate.');
assert.equal(C.TROY_OUNCE_GRAMS, 31.1034768);
assert.equal(C.MAX_WAX, 10000);
assert.equal(C.MAX_ALLOWANCE, 200);
assert.equal(C.METALS.length, 11);
assert.equal(C.METALS.find((metal) => metal.key === 'custom').sg, null);
// A listed alloy ignores the custom field rather than reading it.
assert.equal(run({ metal: 'sterling', metalSg: 'not a number' }).metalSg, 10.36);
assert.equal(run({ metalSg: '12' }).metalSg, 10.36, 'the custom density only applies to the custom alloy');

// ---- Catalog record: counts, cases and metadata.
assert.equal(catalog.tools.length, 2483, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2222, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Crafts & Hobbies').length, 56,
  'Crafts & Hobbies count');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.method.length > 600);
assert.equal(record.sources.length, 2);
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'every source has a fetched https url');
  assert.ok(source.title.length > 40, 'the citation keeps its wording');
}
assert.ok(record.tags.includes('crafts-&-hobbies'));
assert.equal(record.tags.length, new Set(record.tags).size, 'tags are internally unique');

const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 6, validation: 9 });

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
for (const alias of record.aliases) {
  assert.equal(catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase())).length,
  1, 'alias is unique: ' + alias);
}
assert.deepEqual(
  catalog.tools.filter((tool) => /lost-wax|wax-to-metal|casting-metal|metal-weight/.test(tool.slug) && tool.slug !== slug)
    .map((tool) => tool.slug),
  [],
  'no other casting metal weight tool exists');
assert.ok(catalog.tools.some((tool) => tool.slug === 'epoxy-resin-calculator'),
  'the resin casting calculator stays separate');

// ---- Page contract.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Lost-Wax Casting Metal Weight Calculator<\/h1>/);
assert.match(html, /<form id="cast-form" novalidate>/);
assert.match(html, /<select id="metal"><\/select>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label for="/g) || []).length, 6, 'every control is labelled');
assert.equal((html.match(/<input/g) || []).length, 5);
assert.equal((html.match(/<select/g) || []).length, 1);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.equal((html.match(/data-example="/g) || []).length, 2);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function|localStorage|sessionStorage/.test(html),
  'no network calls, no eval, no storage');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored and nothing is sent/i, 'the privacy note stays on the page');
assert.match(html, /min-height:46px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* casting-metal-core:start \*\//g) || []).length, 1);
assert.equal((html.match(/\/\* casting-metal-core:end \*\//g) || []).length, 1);

// Every id the script reaches for exists in the markup.
const ids = ['cast-form', 'wax', 'waxsg', 'metal', 'metalsg', 'allowance', 'onhand', 'err', 'out'];
for (const id of ids) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}

console.log('lost-wax casting metal weight calculator OK: ' + record.testCases.length +
  ' catalog cases, the density-ratio identity over ' + metals.length * 6 * 3 * 4 +
  ' runs, the allowance, the metal-on-hand inversion, warnings, refusals, uniqueness and page contract OK');
