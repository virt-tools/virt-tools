/* Egg size converter: replay the catalog fixtures, check the USDA weight classes
   against an independently written per-dozen table, sweep the size pairs for
   internal consistency, and pin the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'egg-size-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* egg-size-core:start */');
const end = html.indexOf('/* egg-size-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = EggSizeCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
assert.equal(catalog.tools.length, 2221, 'catalog total');
const entry = matches[0];
assert.equal(entry.name, 'Egg Size Converter');
assert.equal(entry.category, 'Food');
assert.equal(entry.subcategory, 'Conversion');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 1000, 'method must document the model and limits');
assert.ok(entry.sources.length >= 3);
const kinds = entry.testCases.reduce((acc, testCase) => {
  acc[testCase.kind] = (acc[testCase.kind] || 0) + 1;
  return acc;
}, {});
assert.equal(entry.testCases.length, 16, 'catalog case count');
assert.deepEqual(kinds, { golden: 6, boundary: 4, validation: 6 });

// Independent table: USDA AMS 56.218 minimum net weight per dozen, in ounces.
const USDA_OUNCES = { peewee: 15, small: 18, medium: 21, large: 24, xlarge: 27, jumbo: 30 };
const OUNCE = 28.349523125;
function perEgg(key) { return USDA_OUNCES[key] * OUNCE / 12; }

assert.equal(C.OUNCE_GRAMS, OUNCE);
assert.deepEqual(Object.keys(C.SIZES).sort(), Object.keys(USDA_OUNCES).sort());
for (const [key, ounces] of Object.entries(USDA_OUNCES)) {
  assert.equal(C.SIZES[key].perDozenOunces, ounces, key + ' class weight');
  assert.ok(C.SIZES[key].label.length > 2, key + ' needs a label');
}
const grams = C.convert({ mode: 'count', amount: '1', recipeSize: 'large', haveSize: 'large' });
assert.ok(Math.abs(grams.recipePerEggGrams - 56.699) < 1e-3, 'large egg is 56.7 g');
assert.ok(Math.abs(grams.neededGrams - 56.699) < 1e-3);
const medium = C.convert({ mode: 'count', amount: '1', recipeSize: 'medium', haveSize: 'medium' });
assert.ok(Math.abs(medium.recipePerEggGrams - 49.612) < 1e-3, 'medium egg is 49.6 g');

const NUMERIC_TOLERANCE = 1e-3;
function attempt(run) {
  try { return run(); } catch (error) { return error.message; }
}
function compare(name, result, expected) {
  for (const [field, value] of Object.entries(expected)) {
    if (typeof value === 'number') {
      assert.ok(Math.abs(result[field] - value) <= NUMERIC_TOLERANCE,
        name + ' ' + field + ': ' + result[field] + ' vs ' + value);
    } else {
      assert.deepEqual(result[field], value, name + ' ' + field);
    }
  }
}
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.ok(testCase.expectedError, testCase.name + ' needs an expectedError');
    assert.equal(attempt(() => C.convert(testCase.input)), testCase.expectedError, testCase.name);
    continue;
  }
  compare(testCase.name, C.convert(testCase.input), testCase.expected);
}

// Hand-computed anchors: 3 large eggs are 3 x 56.699 = 170.097 g, which is
// 3.43 medium eggs at 49.612 g; 2 extra large eggs are 127.573 g, 2.25 large.
const anchors = [
  [{ mode: 'count', amount: '3', recipeSize: 'large', haveSize: 'medium' }, 170.097, 3.4286, 3, 4],
  [{ mode: 'count', amount: '2', recipeSize: 'xlarge', haveSize: 'large' }, 127.573, 2.25, 2, 3],
  [{ mode: 'count', amount: '1', recipeSize: 'large', haveSize: 'jumbo' }, 56.699, 0.8, 0, 1],
  [{ mode: 'count', amount: '0.5', recipeSize: 'jumbo', haveSize: 'peewee' }, 35.437, 1, 1, 1],
  [{ mode: 'weight', amount: '150', recipeSize: 'large', haveSize: 'medium' }, 150, 3.0235, 3, 4],
];
for (const [input, needed, exact, whole, up] of anchors) {
  const result = C.convert(input);
  assert.ok(Math.abs(result.neededGrams - needed) < NUMERIC_TOLERANCE, JSON.stringify(input) + ' grams');
  assert.ok(Math.abs(result.exactCount - exact) < 1e-3, JSON.stringify(input) + ' count');
  assert.equal(result.wholeEggs, whole, JSON.stringify(input) + ' whole');
  assert.equal(result.roundUpEggs, up, JSON.stringify(input) + ' rounded up');
}

// Sweep every size pair: the page's count must reproduce the weight it reports,
// and the rounded counts must bracket the exact count.
const sizes = Object.keys(USDA_OUNCES);
const counts = ['0.25', '0.5', '0.75', '1', '1.5', '2', '2.5', '3', '4', '5', '6', '8', '10', '12', '18', '24', '36', '60'];
const weights = ['5', '10', '50', '100', '150', '170', '250', '500', '1000', '3400'];
let swept = 0;
for (const recipeSize of sizes) {
  for (const haveSize of sizes) {
    const inputs = counts.map((amount) => ({ mode: 'count', amount, recipeSize, haveSize }))
      .concat(weights.map((amount) => ({ mode: 'weight', amount, recipeSize, haveSize })));
    for (const input of inputs) {
      const r = C.convert(input);
      const have = perEgg(haveSize);
      assert.ok(Math.abs(r.exactCount - r.neededGrams / have) <= 2e-3, 'exact count ' + JSON.stringify(input));
      assert.ok(Math.abs(r.neededOunces * OUNCE - r.neededGrams) <= 0.02, 'ounces ' + JSON.stringify(input));
      assert.ok(Math.abs(r.wholeEggs * have - r.wholeGrams) <= NUMERIC_TOLERANCE, 'whole grams ' + JSON.stringify(input));
      assert.ok(Math.abs(r.roundUpEggs * have - r.roundUpGrams) <= NUMERIC_TOLERANCE, 'up grams ' + JSON.stringify(input));
      assert.ok(r.shortfallGrams >= 0 && r.overshootGrams >= 0, 'shortfall and overshoot cannot be negative');
      assert.ok(r.wholeEggs <= r.exactCount + 1e-9, 'rounded down must not exceed the exact count');
      assert.ok(r.roundUpEggs >= r.exactCount - 1e-9, 'rounded up must reach the exact count');
      assert.ok(r.roundUpEggs - r.wholeEggs <= 1, 'the two rounded counts must be neighbours');
      assert.ok(Math.abs(r.wholeGrams + r.shortfallGrams - r.neededGrams) <= 2e-3, 'shortfall closes the gap');
      assert.ok(Math.abs(r.roundUpGrams - r.overshootGrams - r.neededGrams) <= 2e-3, 'overshoot closes the gap');
      if (r.isWhole) assert.equal(r.wholeEggs, r.roundUpEggs, 'a whole count needs no rounding');
      if (recipeSize === haveSize && input.mode === 'count') {
        assert.ok(Math.abs(r.exactCount - Number(input.amount)) < 1e-9, 'same size keeps the count');
      }
      swept += 1;
    }
  }
}
assert.ok(swept >= 1000, 'sweep size ' + swept);

// Page contract: every id the script looks up exists, the markup starts at the
// core defaults, and the page stays self-contained.
assert.equal(C.DEFAULTS.mode, 'count');
assert.equal(C.DEFAULTS.amount, '3');
assert.equal(C.DEFAULTS.recipeSize, 'large');
assert.equal(C.DEFAULTS.haveSize, 'medium');
const scriptStart = html.indexOf('<script>');
const scriptText = html.slice(html.indexOf('/* egg-size-core:end */'));
for (const match of scriptText.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'missing element #' + match[1]);
}
for (const id of ['in-mode', 'in-amount', 'in-recipe-size', 'in-have-size']) {
  assert.ok(new RegExp('<label[^>]*for="' + id + '"').test(html), 'missing label for ' + id);
}
assert.ok(html.includes('id="in-amount" inputmode="decimal" autocomplete="off" value="3"'), 'count default in markup');
assert.ok(/<option value="large" selected>/.test(html), 'recipe size default');
assert.ok(/<option value="medium" selected>/.test(html), 'carton size default');
assert.ok(/<option value="count" selected>/.test(html), 'mode default');
for (const key of sizes) {
  assert.ok(html.split('<option value="' + key + '"').length === 3, 'both size selects need ' + key);
}
assert.ok(html.includes('novalidate'), 'form must not block the page validation');
assert.ok(html.includes('role="alert"') && html.includes('aria-live="polite"'), 'error region');
assert.ok(!/https?:\/\//.test(html.slice(0, html.indexOf('<script src="/assets/app.js">'))), 'no external references');
assert.ok(!/<button(?![^>]*type=)/.test(html), 'every button needs an explicit type');
console.log('egg size converter: ' + entry.testCases.length + ' catalog cases, ' + swept + ' swept conversions passed');
