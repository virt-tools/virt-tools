/* Regression checks for the ice cream mix core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ice-cream-mix-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* ice-cream-mix-core:start */');
const end = html.indexOf('/* ice-cream-mix-core:end */');
assert.ok(start > -1 && end > start, 'ice cream core markers missing');
const core = html.slice(start, end + '/* ice-cream-mix-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = IceCreamMixCore;', sandbox);
const C = sandbox.module.exports;

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

// Independent oracle: the dairy and sugar weights come from the definitions,
// and the cream weight is found by bisecting the fat balance rather than by
// repeating the page's closed form.
function bisectCream(input) {
  const num = (value) => Number(String(value == null ? '' : value).trim().replace(',', '.'));
  const batch = num(input.batch);
  const fat = num(input.fat) / 100;
  const sugar = num(input.sugar) / 100;
  const creamFat = num(input.creamFat) / 100;
  const milkFat = num(input.milkFat) / 100;
  const dairy = batch * (1 - sugar);
  const target = batch * fat;
  const balance = (c) => c * creamFat + (dairy - c) * milkFat - target;
  let low = 0;
  let high = dairy;
  assert.ok(balance(low) < 0 && balance(high) > 0, 'bisection bracket for ' + JSON.stringify(input));
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    if (balance(mid) < 0) low = mid;
    else high = mid;
  }
  return { cream: (low + high) / 2, dairy, target };
}

// Documented surface.
assert.deepEqual([...C.LIMITS.batch], [100, 20000]);
assert.deepEqual([...C.LIMITS.fat], [1, 30]);
assert.deepEqual([...C.LIMITS.sugar], [5, 30]);
assert.deepEqual([...C.LIMITS.creamFat], [20, 50]);
assert.deepEqual([...C.LIMITS.milkFat], [0, 15]);
assert.match(C.MESSAGES.sweet, /20 percent sugar/);
assert.match(C.MESSAGES.lean, /Under 5 percent/);
assert.match(C.MESSAGES.rounded, /0\.1 g/);

// Golden: the default kilogram of 12 percent base.
const DEFAULTS = { batch: '1000', fat: '12', sugar: '16', creamFat: '36', milkFat: '3.5' };
const mix = (overrides) => run(Object.assign({}, DEFAULTS, overrides));
const refuse = (overrides) => failure(Object.assign({}, DEFAULTS, overrides));
const base = run(DEFAULTS);
closeTo(base.batch, 1000, 'default batch');
closeTo(base.sugarGrams, 160, 'default sugar');
closeTo(base.dairyGrams, 840, 'default dairy');
closeTo(base.creamGrams, 278.769231, 'default cream', 1e-6);
closeTo(base.milkGrams, 561.230769, 'default milk', 1e-6);
closeTo(base.fatFromCream, 100.356923, 'default cream fat', 1e-6);
closeTo(base.fatFromMilk, 19.643077, 'default milk fat', 1e-6);
closeTo(base.fatAchieved, 12, 'default fat achieved', 1e-9);
closeTo(base.sugarAchieved, 16, 'default sugar achieved', 1e-9);
closeTo(base.creamShare, 33.186813, 'default cream share', 1e-6);
closeTo(base.totalGrams, 1000, 'default total');
assert.deepEqual(Array.from(base.warnings), []);

// The default is exactly a third cream by dairy weight, 278.77 of 840 g.
closeTo(base.creamShare, base.creamGrams / 840 * 100, 'cream share definition');

// A richer target needs more cream; a leaner one needs less.
const rich = mix({ fat: '18', creamFat: '45' });
assert.ok(rich.creamGrams > base.creamGrams, 'rich base needs more cream');
const light = mix({ fat: '8', sugar: '12', creamFat: '20' });
assert.ok(light.creamGrams > base.creamGrams, 'light cream needs more of it');
const leaner = mix({ fat: '8' });
assert.ok(leaner.creamGrams < base.creamGrams, 'a leaner target needs less cream');

// Skim milk puts all of the fat into the cream.
const skim = mix({ batch: '750', fat: '10', sugar: '15', milkFat: '0' });
closeTo(skim.fatFromMilk, 0, 'skim milk carries no fat');
closeTo(skim.fatFromCream, 75, 'skim milk cream carries the fat');
closeTo(skim.creamGrams, 208.333333, 'skim milk cream weight', 1e-6);

// Decimal commas are accepted.
const comma = mix({ batch: '800', fat: '11', sugar: '15', milkFat: '1,7' });
closeTo(comma.milkFat, 1.7, 'comma milk fat');
closeTo(comma.milkGrams, 457.142857, 'comma milk weight', 1e-6);

// Warning thresholds are strict.
assert.deepEqual(Array.from(mix({ sugar: '20' }).warnings), [], '20 percent sugar is not too sweet');
assert.deepEqual(Array.from(mix({ sugar: '20.5' }).warnings), [C.MESSAGES.sweet], '20.5 percent sugar warns');
const lean = mix({ fat: '28', sugar: '5', creamFat: '30' });
assert.deepEqual(Array.from(lean.warnings), [C.MESSAGES.lean], 'almost no milk warns');
const justAboveLean = mix({ fat: '27', sugar: '5', creamFat: '30' });
assert.ok(justAboveLean.milkGrams / 1000 >= 0.05, '27 percent leaves at least 5 percent milk');
assert.deepEqual(Array.from(justAboveLean.warnings), [], '27 percent is above the lean line');

// Invariants over a grid: components sum to the batch, the fat contributions
// total the fat target, and the cream weight matches an independent bisection.
let checked = 0;
for (const batch of ['100', '1000', '7500', '20000']) {
  for (const fat of ['1', '4', '8', '12', '16', '20', '25', '30']) {
    for (const sugar of ['5', '12', '16', '22', '30']) {
      for (const [creamFat, milkFat] of [['20', '3.5'], ['36', '3.5'], ['36', '0'], ['40', '1.7'], ['50', '15']]) {
        const input = { batch, fat, sugar, creamFat, milkFat };
        // Only the reachable combinations are exercised: the fat target must sit
        // between the milk and the cream, and the cream must fit in the dairy.
        if (Number(fat) <= Number(milkFat) || Number(fat) >= Number(creamFat)) continue;
        if (Number(fat) * Number(batch) > Number(creamFat) * Number(batch) * (1 - Number(sugar) / 100)) continue;
        const result = run(input);
        const expected = bisectCream(input);
        closeTo(result.creamGrams, expected.cream, 'bisected cream ' + JSON.stringify(input), 1e-6);
        closeTo(result.milkGrams, expected.dairy - expected.cream, 'milk by difference ' + JSON.stringify(input), 1e-6);
        closeTo(result.totalGrams, Number(batch), 'components sum to batch ' + JSON.stringify(input), 1e-9);
        closeTo(result.fatFromCream + result.fatFromMilk, Number(batch) * Number(fat) / 100,
          'fat contributions total the target ' + JSON.stringify(input), 1e-9);
        closeTo(result.sugarGrams, Number(batch) * Number(sugar) / 100, 'sugar grams ' + JSON.stringify(input), 1e-9);
        closeTo(result.sugarAchieved, Number(sugar), 'sugar share ' + JSON.stringify(input), 1e-9);
        assert.ok(result.creamGrams >= 0 && result.milkGrams >= 0, 'non-negative weights ' + JSON.stringify(input));
        checked += 1;
      }
    }
  }
}
assert.ok(checked > 300, 'grid exercised only ' + checked + ' rows');

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.name, 'Ice Cream Mix Calculator');
assert.equal(entry.category, 'Food');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.ok(entry.testCases.length >= 30, 'expected at least thirty catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = run(testCase.input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      if (Array.isArray(value)) {
        assert.deepEqual(Array.from(result[key]), Array.from(value), testCase.name + ' ' + key);
      } else if (typeof value === 'string' || typeof value === 'boolean') {
        assert.equal(result[key], value, testCase.name + ' ' + key);
      } else {
        closeTo(result[key], value, testCase.name + ' ' + key, 1e-6);
      }
    }
  }
}

// Refusals name the field in the order it appears on the page.
assert.equal(refuse({ batch: '', fat: '', sugar: '', creamFat: '', milkFat: '' }), 'Enter the batch weight.');
assert.equal(refuse({ batch: '1000', fat: '', sugar: '', creamFat: '', milkFat: '' }), 'Enter the butterfat target.');
assert.equal(refuse({ batch: '1000', fat: '12', sugar: '', creamFat: '', milkFat: '' }), 'Enter the sugar target.');
assert.equal(refuse({ batch: '1000', fat: '12', sugar: '16', creamFat: '', milkFat: '' }), "Enter the cream's fat content.");
assert.equal(refuse({ batch: '1000', fat: '12', sugar: '16', creamFat: '36', milkFat: '' }), "Enter the milk's fat content.");
assert.equal(refuse({ fat: '20', creamFat: '20' }), "The butterfat target must be below the cream's fat content (20%).");
assert.equal(refuse({ fat: '3', milkFat: '4' }), "The butterfat target must be above the milk's fat content (4%).");
assert.equal(refuse({ fat: '28', sugar: '30', creamFat: '30', milkFat: '0' }),
  'That fat target needs more cream than the batch allows once the sugar is taken out; lower the sugar or the fat target.');
assert.equal(refuse({ sugar: '4.9' }), 'The sugar target must be between 5 and 30 percent.');
assert.equal(refuse({ creamFat: '19' }), "The cream's fat content must be between 20 and 50 percent.");
assert.equal(refuse({ milkFat: '-1' }), "The milk's fat content must be between 0 and 15 percent.");

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="ice-cream-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
for (const id of ['batch', 'fat', 'sugar', 'cream-fat', 'milk-fat']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
}
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
for (const value of ['1000', '12', '16', '36', '3.5']) {
  assert.ok(html.includes('value="' + value + '"'), 'default ' + value + ' missing from the markup');
}
assert.ok(html.includes('min-height:44px'), 'controls must keep a 44 px target');

console.log('ice cream mix calculator: ' + entry.testCases.length
  + ' catalog cases, ' + checked + ' grid rows and invariants passed');
