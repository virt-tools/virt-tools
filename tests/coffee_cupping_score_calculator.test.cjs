/* Regression checks for the coffee cupping score core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'coffee-cupping-score-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* coffee-cupping-score-core:start */');
const end = html.indexOf('/* coffee-cupping-score-core:end */');
assert.ok(start > -1 && end > start, 'cupping core markers missing');
const core = html.slice(start, end + '/* coffee-cupping-score-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CoffeeCuppingCore;', sandbox);
const C = sandbox.module.exports;

function run(input) {
  return C.analyze(input);
}

function failure(input) {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
}

// Arithmetic kept separate from the page: quarter-point units as integers, so
// every comparison below is exact.
const ATTRIBUTES = ['aroma', 'flavor', 'aftertaste', 'acidity', 'body', 'balance'];
const CUPS = ['uniformity', 'clean', 'sweetness'];

function oracle(input) {
  const quarters = {};
  let attributeQuarters = 0;
  for (const key of ATTRIBUTES) {
    const q = Math.round(Number(String(input[key]).replace(',', '.')) * 4);
    quarters[key] = q;
    attributeQuarters += q;
  }
  const overall = Math.round(Number(String(input.overall).replace(',', '.')) * 4);
  let cupPoints = 0;
  const counts = {};
  for (const key of CUPS) {
    counts[key] = Number(input[key]);
    cupPoints += counts[key] * 2;
  }
  const tainted = Number(input.tainted);
  const faulty = Number(input.faulty);
  const deduction = tainted * 2 + faulty * 4;
  const totalQuarters = attributeQuarters + overall + cupPoints * 4 - deduction * 4;
  return {
    attributes: Object.fromEntries(ATTRIBUTES.map((key) => [key, quarters[key] / 4])),
    overall: overall / 4,
    attributeTotal: attributeQuarters / 4,
    cups: counts,
    cupPoints,
    tainted,
    faulty,
    deduction,
    total: totalQuarters / 4,
    maxScore: 100,
    belowPerfect: 100 - totalQuarters / 4,
  };
}

const base = {
  aroma: '7.5', flavor: '7.5', aftertaste: '7.5', acidity: '7.5',
  body: '7.5', balance: '7.5', overall: '7.5',
  uniformity: '5', clean: '5', sweetness: '5', tainted: '0', faulty: '0',
};

// Documented surface.
assert.deepEqual(Array.from(C.ATTRIBUTES, (row) => row.key), ATTRIBUTES);
assert.deepEqual(Array.from(C.CUPS, (row) => row.key), CUPS);
assert.equal(C.SCORE_MIN, 6);
assert.equal(C.SCORE_MAX, 10);
assert.equal(C.SCORE_STEP, 0.25);
assert.equal(C.CUP_COUNT, 5);
assert.equal(C.POINTS_PER_CUP, 2);
assert.equal(C.MAX_SCORE, 100);
assert.equal(C.SPECIALTY, 80);
assert.deepEqual(Array.from(C.GRADES, (row) => row.min), [90, 85, 80, 0]);
assert.equal(C.GRADES[0].label, 'Outstanding specialty');
assert.equal(C.GRADES[3].label, 'Below the specialty threshold');

// Golden: the default clean flight.
const clean = run(base);
assert.equal(clean.total, 82.5);
assert.equal(clean.attributeTotal, 45);
assert.equal(clean.overall, 7.5);
assert.equal(clean.cupPoints, 30);
assert.equal(clean.deduction, 0);
assert.equal(clean.belowPerfect, 17.5);
assert.equal(clean.grade, 'very-good');
assert.equal(clean.gradeLabel, 'Very good specialty');
assert.equal(clean.specialty, true);
assert.equal(clean.attributes.acidity, 7.5);
assert.equal(clean.cups.uniformity, 5);

// Grade bands sit on the quarter-point grid.
assert.equal(run({ ...base, aroma: '9', flavor: '9', aftertaste: '9', acidity: '9', body: '9', balance: '9', overall: '9' }).grade, 'outstanding');
assert.equal(run({ ...base, aroma: '8.5', flavor: '8.5', aftertaste: '8.5', acidity: '8.5', body: '8.5', balance: '8.5', overall: '8.75' }).total, 89.75);
assert.equal(run({ ...base, aroma: '8', flavor: '8', aftertaste: '8', acidity: '8', body: '8', balance: '8', overall: '8', uniformity: '5', clean: '4', sweetness: '3' }).total, 80);
assert.equal(run({ ...base, aroma: '8', flavor: '8', aftertaste: '8', acidity: '8', body: '8', balance: '8', overall: '7.75', uniformity: '5', clean: '4', sweetness: '3' }).grade, 'below');
assert.equal(run({ ...base, aroma: '10', flavor: '10', aftertaste: '10', acidity: '10', body: '10', balance: '10', overall: '10' }).total, 100);

// Defects deduct 2 and 4 points per cup and never produce a negative score.
assert.equal(run({ ...base, tainted: '1' }).total, 80.5);
assert.equal(run({ ...base, faulty: '2' }).deduction, 8);
assert.equal(run({ ...base, uniformity: '0', clean: '0', sweetness: '0', faulty: '5' }).total, 32.5);

// Decimal commas and exact quarter arithmetic.
const comma = run({ ...base, aroma: '7,25', flavor: '7,5', aftertaste: '7,75', acidity: '8', body: '8,25', balance: '8,5', overall: '8,75' });
assert.equal(comma.attributeTotal, 47.25);
assert.equal(comma.total, 86);
assert.equal(comma.grade, 'excellent');

// Invariants over a grid of scores, cup counts and defects.
let checked = 0;
for (const score of ['6', '6.25', '7.75', '8.5', '9', '10']) {
  for (const cups of ['0', '2', '5']) {
    for (const [tainted, faulty] of [['0', '0'], ['1', '0'], ['0', '2'], ['2', '3']]) {
      const input = {
        aroma: score, flavor: score, aftertaste: score, acidity: score,
        body: score, balance: score, overall: score,
        uniformity: cups, clean: cups, sweetness: cups, tainted, faulty,
      };
      const result = run(input);
      const expected = oracle(input);
      for (const key of ['overall', 'attributeTotal', 'cupPoints', 'deduction', 'total', 'belowPerfect']) {
        assert.equal(result[key], expected[key], JSON.stringify(input) + ' ' + key);
      }
      for (const key of ATTRIBUTES) assert.equal(result.attributes[key], expected.attributes[key], JSON.stringify(input) + ' ' + key);
      for (const key of CUPS) assert.equal(result.cups[key], expected.cups[key], JSON.stringify(input) + ' ' + key);
      assert.equal(result.total, result.attributeTotal + result.overall + result.cupPoints - result.deduction, 'total is the sum');
      assert.ok(result.total >= 22 && result.total <= 100, 'total inside the possible range');
      assert.equal(result.specialty, result.total >= 80, 'specialty flag follows the threshold');
      checked += 1;
    }
  }
}

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(catalog.tools.length, 2266, 'catalog total');
assert.equal(entry.category, 'Food');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.ok(entry.testCases.length >= 20, 'expected at least twenty catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = run(testCase.input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      if (typeof value === 'object') {
        for (const [inner, innerValue] of Object.entries(value)) assert.equal(result[key][inner], innerValue, testCase.name + ' ' + key + '.' + inner);
      } else if (typeof value === 'boolean' || typeof value === 'string') {
        assert.equal(result[key], value, testCase.name + ' ' + key);
      } else {
        assert.ok(Math.abs(result[key] - value) < 1e-9, testCase.name + ' ' + key + ': ' + result[key] + ' vs ' + value);
      }
    }
  }
}

// Refusals name the field and rule.
assert.equal(failure({ ...base, aroma: '   ' }), 'Enter fragrance / aroma.');
assert.equal(failure({ ...base, flavor: 'bright' }), 'Flavor must be a number.');
assert.equal(failure({ ...base, acidity: '5.99' }), 'Acidity must be between 6 and 10.');
assert.equal(failure({ ...base, body: '10.25' }), 'Body must be between 6 and 10.');
assert.equal(failure({ ...base, aftertaste: '7.1' }), 'Aftertaste must be a multiple of 0.25.');
assert.equal(failure({ ...base, overall: '' }), 'Enter overall.');
assert.equal(failure({ ...base, uniformity: '4.5' }), 'Uniformity must be a whole number of cups from 0 to 5.');
assert.equal(failure({ ...base, tainted: '3', faulty: '3' }), 'Tainted and faulty cups together cannot exceed the 5 cups.');

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="cup-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
for (const id of ['aroma', 'flavor', 'aftertaste', 'acidity', 'body', 'balance', 'overall',
  'uniformity', 'clean', 'sweetness', 'tainted', 'faulty']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
}
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');

console.log('coffee cupping score calculator: ' + entry.testCases.length
  + ' catalog cases, ' + checked + ' grid rows and invariants passed');
