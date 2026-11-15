/* Regression checks for the cream-to-butter core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'cream-to-butter-yield';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* cream-to-butter-core:start */');
const end = html.indexOf('/* cream-to-butter-core:end */');
assert.ok(start > -1 && end > start, 'cream to butter core markers missing');
const core = html.slice(start, end + '/* cream-to-butter-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CreamToButterCore;', sandbox);
const C = sandbox.module.exports;

const closeTo = (actual, expected, label, epsilon) => assert.ok(
  Math.abs(actual - expected) < (epsilon === undefined ? 1e-9 : epsilon),
  label + ': ' + actual + ' vs ' + expected);

const DEFAULTS = { cream: '1000', unit: 'g', creamFat: '36', butterFat: '82', buttermilkFat: '0.5', salt: '0' };
const run = (overrides) => C.analyze(Object.assign({}, DEFAULTS, overrides));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return null;
};

// Independent oracle: butter is found by bisecting the fat balance
// fb*B + fm*(C - B) - fc*C = 0, never by repeating the page's closed form.
function bisectButter(input) {
  const num = (value) => Number(String(value == null ? '' : value).trim().replace(',', '.'));
  const units = { g: 1, oz: 28.349523125, lb: 453.59237 };
  const C0 = num(input.cream) * units[input.unit || 'g'];
  const fc = num(input.creamFat) / 100;
  const fb = num(input.butterFat) / 100;
  const fm = num(input.buttermilkFat) / 100;
  const target = C0 * fc;
  const balance = (b) => fb * b + fm * (C0 - b) - target;
  assert.ok(balance(0) < 0 && balance(C0) > 0, 'bisection bracket for ' + JSON.stringify(input));
  let low = 0;
  let high = C0;
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    if (balance(mid) < 0) low = mid;
    else high = mid;
  }
  return { butter: (low + high) / 2, cream: C0 };
}

// Documented surface.
assert.deepEqual([...C.LIMITS.cream], [50, 20000]);
assert.deepEqual([...C.LIMITS.creamFat], [10, 50]);
assert.deepEqual([...C.LIMITS.butterFat], [70, 90]);
assert.deepEqual([...C.LIMITS.buttermilkFat], [0, 5]);
assert.deepEqual([...C.LIMITS.salt], [0, 3]);
assert.deepEqual({ ...C.UNITS }, { g: 1, oz: 28.349523125, lb: 453.59237 });
assert.match(C.MESSAGES.thin, /under 30 percent fat/);
assert.match(C.MESSAGES.lowFat, /under 80 percent milkfat/);
assert.match(C.MESSAGES.rich, /above 2 percent fat/);
assert.match(C.MESSAGES.salty, /above 2\.5 percent/);
assert.match(C.MESSAGES.rounded, /0\.1 g/);

// Golden: a kilogram of 36 percent cream at 82 percent butterfat.
const base = run();
closeTo(base.creamGrams, 1000, 'default cream');
closeTo(base.fatGrams, 360, 'default fat');
closeTo(base.butterGrams, 435.582822, 'default butter', 1e-6);
closeTo(base.buttermilkGrams, 564.417178, 'default buttermilk', 1e-6);
closeTo(base.fatInButter, 357.177914, 'default fat in butter', 1e-6);
closeTo(base.fatInButtermilk, 2.822086, 'default fat in buttermilk', 1e-6);
closeTo(base.fatRecovery, 99.216087, 'default fat recovery', 1e-6);
closeTo(base.butterFromCream, 43.558282, 'default butter yield', 1e-6);
closeTo(base.creamPerButter, 2.295775, 'default cream per butter', 1e-6);
closeTo(base.saltGrams, 0, 'default salt');
closeTo(base.saltedButterGrams, 435.582822, 'unsalted butter weight', 1e-6);
closeTo(base.massCheck, 1000, 'default mass balance');
assert.deepEqual(Array.from(base.warnings), []);

// A kilogram of cream should land near the familiar pound of butter from a quart.
assert.ok(base.butterGrams > 400 && base.butterGrams < 470, 'a kilogram of cream yields about a pound of butter');

// Mass and fat both balance by definition.
closeTo(base.butterGrams + base.buttermilkGrams, base.creamGrams, 'butter plus buttermilk', 1e-9);
closeTo(base.fatInButter + base.fatInButtermilk, base.fatGrams, 'fat in butter plus buttermilk', 1e-9);

// Units convert through grams, so a pound and sixteen ounces agree.
const pound = run({ cream: '1', unit: 'lb' });
const ounces = run({ cream: '16', unit: 'oz' });
closeTo(pound.creamGrams, 453.59237, 'one pound in grams');
closeTo(pound.butterGrams, 197.577045, 'pound of cream butter', 1e-6);
closeTo(ounces.butterGrams, pound.butterGrams, '16 oz equals 1 lb', 1e-6);

// Richer cream yields more butter; richer butter yields less.
assert.ok(run({ creamFat: '40' }).butterGrams > base.butterGrams, 'richer cream yields more butter');
assert.ok(run({ butterFat: '80' }).butterGrams > base.butterGrams, 'leaner butter weighs more');
assert.ok(run({ buttermilkFat: '1' }).butterGrams < base.butterGrams, 'fatter buttermilk keeps more fat');
closeTo(run({ butterFat: '80' }).butterGrams, 446.540881, '80 percent butter', 1e-6);

// Salt is a share of the churned butter weight.
const salted = run({ salt: '2' });
closeTo(salted.saltGrams, 8.711656, 'two percent salt', 1e-6);
closeTo(salted.saltedButterGrams, 444.294479, 'salted butter weight', 1e-6);
closeTo(salted.butterGrams, base.butterGrams, 'salt does not change the churn', 1e-9);

// Decimal commas are accepted.
closeTo(run({ cream: '750,5' }).creamGrams, 750.5, 'comma cream weight');

// Warnings are strict at their thresholds.
assert.deepEqual(Array.from(run({ creamFat: '30' }).warnings), [], '30 percent cream is not thin');
assert.deepEqual(Array.from(run({ creamFat: '29' }).warnings), [C.MESSAGES.thin], '29 percent cream warns');
assert.deepEqual(Array.from(run({ butterFat: '80' }).warnings), [], '80 percent butter is standard');
assert.deepEqual(Array.from(run({ butterFat: '79' }).warnings), [C.MESSAGES.lowFat], '79 percent butter warns');
assert.deepEqual(Array.from(run({ buttermilkFat: '2' }).warnings), [], '2 percent buttermilk is quiet');
assert.deepEqual(Array.from(run({ buttermilkFat: '2.1' }).warnings), [C.MESSAGES.rich], '2.1 percent warns');
assert.deepEqual(Array.from(run({ salt: '2.5' }).warnings), [], '2.5 percent salt is quiet');
assert.deepEqual(Array.from(run({ salt: '2.6' }).warnings), [C.MESSAGES.salty], '2.6 percent salt warns');

// Grid invariants: both balances hold and the butter weight matches bisection.
let checked = 0;
for (const cream of ['50', '250', '1000', '7500', '20000']) {
  for (const unit of ['g', 'oz', 'lb']) {
    for (const creamFat of ['10', '18', '30', '36', '45', '50']) {
      for (const butterFat of ['70', '78', '82', '86', '90']) {
        for (const buttermilkFat of ['0', '0.5', '1', '3', '5']) {
          const input = { cream, unit, creamFat, butterFat, buttermilkFat, salt: '0' };
          // The gram limits apply after conversion, so skip the pairs outside them.
          const grams = Number(cream) * { g: 1, oz: 28.349523125, lb: 453.59237 }[unit];
          if (grams < 50 || grams > 20000) continue;
          const result = run(input);
          const expected = bisectButter(input);
          closeTo(result.butterGrams, expected.butter, 'bisected butter ' + JSON.stringify(input), 1e-6);
          closeTo(result.creamGrams, expected.cream, 'cream in grams ' + JSON.stringify(input), 1e-9);
          closeTo(result.butterGrams + result.buttermilkGrams, result.creamGrams,
            'mass balance ' + JSON.stringify(input), 1e-9);
          closeTo(result.fatInButter + result.fatInButtermilk, result.fatGrams,
            'fat balance ' + JSON.stringify(input), 1e-9);
          closeTo(result.butterGrams * result.butterFat / 100, result.fatInButter,
            'butter fat definition ' + JSON.stringify(input), 1e-9);
          assert.ok(result.butterGrams > 0 && result.butterGrams < result.creamGrams,
            'butter inside the cream ' + JSON.stringify(input));
          checked += 1;
        }
      }
    }
  }
}
assert.ok(checked > 400, 'grid exercised only ' + checked + ' rows');

// The core refuses an unknown unit even though the page offers a select.
assert.equal(failure({ unit: 'kg' }), 'Choose the cream weight unit from the list.');

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.name, 'Cream to Butter Yield Calculator');
assert.equal(entry.category, 'Food');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.ok(entry.testCases.length >= 16, 'expected at least sixteen catalog cases');
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
assert.equal(failure({ cream: '' }), 'Enter the cream weight.');
assert.equal(failure({ cream: '1000', creamFat: '' }), "Enter the cream's fat content.");
assert.equal(failure({ creamFat: '36', butterFat: '' }), "Enter the butter's fat content.");
assert.equal(failure({ butterFat: '82', buttermilkFat: '' }), "Enter the buttermilk's fat content.");
assert.equal(failure({ buttermilkFat: '0.5', salt: '' }), 'Enter the salt amount.');
assert.equal(failure({ cream: 'lots' }), 'The cream weight must be a number.');
assert.equal(failure({ cream: '40' }), 'The cream weight must be between 50 and 20000 grams.');
assert.equal(failure({ creamFat: '9' }), "The cream's fat content must be between 10 and 50 percent.");
assert.equal(failure({ butterFat: '95' }), "The butter's fat content must be between 70 and 90 percent.");
assert.equal(failure({ buttermilkFat: '6' }), "The buttermilk's fat content must be between 0 and 5 percent.");
assert.equal(failure({ salt: '-1' }), 'The salt amount must be between 0 and 3 percent.');

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/https?:\/\/[a-z]/i.test(html.replace(/http:\/\/www\.w3\.org/g, '')), 'page must not reference an external URL');
assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(html), 'page source must stay ASCII');
assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'page needs exactly one h1');
assert.ok(html.includes('<form id="butter-form"'), 'page form missing');
assert.ok(html.includes('type="submit"'), 'page needs an explicit submit button');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('min-height:44px'), 'controls must keep a 44 px target');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
for (const id of ['cream', 'unit', 'cream-fat', 'butter-fat', 'buttermilk-fat', 'salt', 'err', 'out']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
}
for (const value of ['value="1000"', 'value="36"', 'value="82"', 'value="0.5"', 'value="0"']) {
  assert.ok(html.includes(value), 'default ' + value + ' missing from the markup');
}
assert.ok(html.includes('<option value="g" selected>'), 'the gram option must start selected');
// Every id the script looks up must exist in the markup.
for (const match of html.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'getElementById(' + match[1] + ') has no element');
}
// Every label points at a control that exists.
for (const match of html.matchAll(/<label class="f" for="([^"]+)"/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'label for ' + match[1] + ' has no control');
}

console.log('cream to butter yield: ' + entry.testCases.length
  + ' catalog cases, ' + checked + ' grid rows and invariants passed');
