/* Regression checks for the rice cooking ratio core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'rice-cooking-ratio-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* rice-cooking-ratio-core:start */');
const end = html.indexOf('/* rice-cooking-ratio-core:end */');
assert.ok(start > -1 && end > start, 'rice core markers missing');
const core = html.slice(start, end + '/* rice-cooking-ratio-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RiceCookingCore;', sandbox);
const C = sandbox.module.exports;

const ML_CUP = 236.5882365;
const closeTo = (actual, expected, label, epsilon) => assert.ok(
  Math.abs(actual - expected) < (epsilon === undefined ? 1e-9 : epsilon),
  label + ': ' + actual + ' vs ' + expected);

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

// Constants transcribed from the page's documented table, kept separate so a
// silent change to the page's own data would fail here.
const TABLE = {
  'long-grain': { ratio: 1.75, gramsPerCup: 185, cooked: 3 },
  jasmine: { ratio: 1.5, gramsPerCup: 180, cooked: 3 },
  basmati: { ratio: 1.5, gramsPerCup: 180, cooked: 3 },
  'medium-grain': { ratio: 1.75, gramsPerCup: 190, cooked: 3 },
  'short-grain': { ratio: 1.15, gramsPerCup: 200, cooked: 2.7 },
  brown: { ratio: 2.25, gramsPerCup: 190, cooked: 3 },
  wild: { ratio: 3, gramsPerCup: 160, cooked: 3.5 },
  arborio: { ratio: 4.5, gramsPerCup: 200, cooked: 3 },
};

function oracle(input) {
  const row = TABLE[input.type];
  const amount = Number(String(input.amount).replace(',', '.'));
  const ratio = Number(String(input.ratio).replace(',', '.'));
  let cups;
  if (input.unit === 'cups') cups = amount;
  else if (input.unit === 'grams') cups = amount / row.gramsPerCup;
  else cups = 0.5 * amount / row.cooked;
  const waterMl = cups * ratio * ML_CUP;
  return {
    riceCups: cups,
    riceGrams: cups * row.gramsPerCup,
    waterCups: cups * ratio,
    waterMl,
    waterTbsp: waterMl / 14.78676478125,
    potCups: cups + cups * ratio,
    potLitres: (cups + cups * ratio) * ML_CUP / 1000,
    cookedCups: cups * row.cooked,
    servings: cups * row.cooked / 0.5,
    ratioDefault: row.ratio,
    customRatio: Math.abs(ratio - row.ratio) > 1e-9,
  };
}

const base = { type: 'long-grain', amount: '1', unit: 'cups', ratio: '1.75' };

// Documented surface.
assert.deepEqual(Object.keys(C.TYPES).sort(), Object.keys(TABLE).sort());
assert.deepEqual(Object.keys(C.UNITS).sort(), ['cups', 'grams', 'servings']);
assert.deepEqual([...C.LIMITS.cups], [0.05, 40]);
assert.deepEqual([...C.LIMITS.grams], [10, 6400]);
assert.deepEqual([...C.LIMITS.servings], [1, 80]);
assert.deepEqual([...C.LIMITS.ratio], [0.5, 8]);
assert.equal(C.SERVING_CUP, 0.5);
assert.equal(C.ML_PER_CUP, ML_CUP);
assert.match(C.MESSAGES.estimate, /estimate/);
assert.match(C.MESSAGES.customRatio, /custom ratio/);
assert.match(C.MESSAGES.thin, /Less water than rice/);
assert.match(C.MESSAGES.large, /Large batch/);
assert.equal(C.TYPES.wild.cooked, 3.5, 'wild rice expansion');
assert.match(C.TYPES.brown.time, /45 to 50 minutes/);

// Golden: the default cup of long-grain white rice.
const sized = run(base);
assert.equal(sized.typeName, 'Long-grain white');
assert.equal(sized.unit, 'cups');
closeTo(sized.riceCups, 1, 'default rice cups');
closeTo(sized.riceGrams, 185, 'default rice grams');
closeTo(sized.waterCups, 1.75, 'default water cups');
closeTo(sized.waterMl, 414.029414, 'default water ml', 1e-6);
closeTo(sized.waterTbsp, 28, 'default water tbsp', 1e-6);
closeTo(sized.potCups, 2.75, 'default pot cups');
closeTo(sized.potLitres, 0.6506176, 'default pot litres', 1e-6);
closeTo(sized.cookedCups, 3, 'default cooked cups');
closeTo(sized.servings, 6, 'default servings');
assert.equal(sized.customRatio, false);
assert.equal(sized.ratioDefault, 1.75);

// Jasmine takes less water, brown and wild take more.
closeTo(run({ type: 'jasmine', amount: '2', unit: 'cups', ratio: '1.5' }).waterCups, 3, 'jasmine water');
closeTo(run({ type: 'brown', amount: '1', unit: 'cups', ratio: '2.25' }).waterCups, 2.25, 'brown water');
const wild = run({ type: 'wild', amount: '0.5', unit: 'cups', ratio: '3' });
closeTo(wild.waterCups, 1.5, 'wild water');
closeTo(wild.cookedCups, 1.75, 'wild cooked');
closeTo(wild.servings, 3.5, 'wild servings');

// A gram amount is converted to cups with the type's bulk density.
const basmati = run({ type: 'basmati', amount: '450', unit: 'grams', ratio: '1.5' });
closeTo(basmati.riceCups, 2.5, 'basmati cups');
closeTo(basmati.waterCups, 3.75, 'basmati water');
closeTo(basmati.waterMl, 887.205887, 'basmati water ml', 1e-6);

// A serving request is converted back into dry rice.
const risotto = run({ type: 'arborio', amount: '4', unit: 'servings', ratio: '4.5' });
closeTo(risotto.riceCups, 2 / 3, 'risotto dry cups');
closeTo(risotto.waterCups, 3, 'risotto water');
closeTo(risotto.riceGrams, 133.333333, 'risotto grams', 1e-6);

// Decimal commas are accepted in both numeric fields.
const comma = run({ type: 'medium-grain', amount: '1,5', unit: 'cups', ratio: '2,5' });
closeTo(comma.riceCups, 1.5, 'comma cups');
closeTo(comma.waterCups, 3.75, 'comma water');
assert.equal(comma.customRatio, true);

// Boundaries are inclusive.
closeTo(run({ type: 'long-grain', amount: '0.05', unit: 'cups', ratio: '1.75' }).waterCups, 0.0875, 'smallest batch');
closeTo(run({ type: 'long-grain', amount: '40', unit: 'cups', ratio: '1.75' }).waterCups, 70, 'largest batch');
closeTo(run({ type: 'short-grain', amount: '2', unit: 'cups', ratio: '0.5' }).waterCups, 1, 'lowest ratio');
closeTo(run({ type: 'wild', amount: '1', unit: 'cups', ratio: '8' }).waterCups, 8, 'highest ratio');
closeTo(run({ type: 'brown', amount: '10', unit: 'grams', ratio: '2.25' }).riceCups, 10 / 190, 'smallest weight');
closeTo(run({ type: 'wild', amount: '6400', unit: 'grams', ratio: '3' }).riceCups, 40, 'largest weight');
closeTo(run({ type: 'long-grain', amount: '6400', unit: 'grams', ratio: '1.75' }).waterCups, 6400 / 185 * 1.75, 'grams at the cap');

// Invariants over a grid of types, units, amounts and ratios.
let checked = 0;
for (const type of Object.keys(TABLE)) {
  for (const [unit, amounts] of [['cups', ['0.5', '1', '2.5']], ['grams', ['250', '1000']], ['servings', ['2', '6']]]) {
    for (const amount of amounts) {
      for (const ratio of ['0.6', '1.25', '2.25', '4.5']) {
        const input = { type, unit, amount, ratio };
        const result = run(input);
        const expected = oracle(input);
        for (const key of ['riceCups', 'riceGrams', 'waterCups', 'waterMl', 'waterTbsp',
          'potCups', 'potLitres', 'cookedCups', 'servings']) {
          closeTo(result[key], expected[key], type + '/' + unit + '/' + amount + '/' + ratio + ' ' + key, 1e-9);
        }
        assert.equal(result.customRatio, expected.customRatio, 'custom ratio flag ' + JSON.stringify(input));
        closeTo(result.potCups, result.riceCups + result.waterCups, 'pot is rice plus water');
        closeTo(result.cookedCups, result.riceCups * TABLE[type].cooked, 'cooked expansion');
        closeTo(result.servings * 0.5, result.cookedCups, 'servings are half cups');
        assert.ok(result.waterCups > 0 && result.riceCups > 0, 'positive volumes');
        checked += 1;
      }
    }
  }
}

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
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
      if (typeof value === 'boolean') {
        assert.equal(result[key], value, testCase.name + ' ' + key);
      } else if (typeof value === 'string') {
        assert.equal(result[key], value, testCase.name + ' ' + key);
      } else {
        closeTo(result[key], value, testCase.name + ' ' + key, 1e-6);
      }
    }
  }
}

// Refusals name the field in the order it appears on the page.
assert.equal(failure({ type: 'quinoa', amount: '', unit: 'litres', ratio: '' }), 'Choose a rice type from the list.');
assert.equal(failure({ type: 'long-grain', amount: '', unit: 'litres', ratio: '' }), 'Enter the amount of rice.');
assert.equal(failure({ type: 'long-grain', amount: '1', unit: 'litres', ratio: '' }), 'Choose cups, grams or cooked servings.');
assert.equal(failure({ type: 'long-grain', amount: '1', unit: 'cups', ratio: '' }), 'Enter the water ratio.');
assert.equal(failure({ type: 'long-grain', amount: '0.04', unit: 'cups', ratio: '1.75' }),
  'The amount of rice must be between 0.05 and 40 cups of dry rice.');
assert.equal(failure({ type: 'long-grain', amount: '40.01', unit: 'cups', ratio: '1.75' }),
  'The amount of rice must be between 0.05 and 40 cups of dry rice.');
assert.equal(failure({ type: 'long-grain', amount: '1', unit: 'cups', ratio: '8.01' }),
  'The water ratio must be between 0.5 and 8 cups of water per cup of rice.');
assert.equal(failure({ type: 'long-grain', amount: '6401', unit: 'grams', ratio: '1.75' }),
  'The amount of rice must be between 10 and 6400 grams of dry rice.');

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="rice-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
for (const id of ['type', 'amount', 'unit', 'ratio']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
}
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');

// The select offers exactly the documented rice types, with long-grain first.
const options = [...html.matchAll(/<option value="([a-z-]+)"[^>]*>/g)].map((match) => match[1]);
assert.deepEqual(options.slice(0, 8), Object.keys(TABLE));
assert.ok(html.includes('value="long-grain" selected'), 'long-grain must be the default type');
assert.ok(html.includes('value="1.75"'), 'the default ratio must be 1.75');

console.log('rice cooking ratio calculator: ' + entry.testCases.length
  + ' catalog cases, ' + checked + ' grid rows and invariants passed');
