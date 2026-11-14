/* Regression checks for the priming sugar core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'priming-sugar-calculator';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* priming-core:start */');
const end = html.indexOf('/* priming-core:end */');
assert.ok(start > -1 && end > start, 'priming core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + '/* priming-core:end */'.length) + '\nmodule.exports = PrimingSugar;', sandbox);
const P = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Food');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.icon, '\u{1F37A}');
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 5, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 2, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 200, 'method documented');
assert.equal(catalog.tools.length, 2274, 'catalog total');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');

const failure = (input) => {
  try {
    P.compute(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// --- Published anchors: Hall's residual fit and the priming constants. ---
assert.ok(Math.abs(P.residualVolumes(68) - 0.8614872) < 1e-9, '68 F residual from the published fit');
assert.ok(Math.abs(P.residualVolumes(50) - 1.20) < 0.005, '50 F residual matches the published 1.20');
assert.equal(P.SUGAR_YIELDS.sucrose.toFixed(6), '0.514279');
assert.equal(P.SUGAR_YIELDS.dextrose.toFixed(6), '0.444152');
assert.equal(P.SUGAR_YIELDS.anhydrous.toFixed(6), '0.488565');

const defaults = P.compute({});
assert.equal(defaults.litres, 20);
assert.equal(defaults.target, 2.4);
assert.equal(defaults.tempC, 20);
assert.equal(defaults.tempF, 68);
assert.equal(defaults.sugar, 'dextrose');
assert.equal(defaults.residual, 0.86);
assert.equal(defaults.toAdd, 1.54);
assert.equal(defaults.gramsPerLitre, 6.8);
assert.equal(defaults.grams, 135.9);
assert.equal(defaults.perBottle, 3.4);
assert.equal(defaults.fullBottles, 40);
assert.equal(defaults.warnings.length, 0);

// BYO's chart gives 0.85 volumes at 68 F and 4.5 oz (128 g) of corn sugar for 5 US
// gallons at 2.4 volumes; this core lands within a gram of that published figure.
const fiveGallons = P.compute({ volume: '5', volumeUnit: 'gal', temp: '68', tempUnit: 'f', target: '2.4', sugar: 'dextrose' });
assert.equal(fiveGallons.litres, 18.927);
assert.equal(fiveGallons.grams, 128.6);
assert.ok(Math.abs(fiveGallons.grams - 128) <= 1, 'BYO corn sugar anchor');
assert.equal(fiveGallons.fullBottles, 37);

// Table sugar needs less mass than corn sugar for the same CO2; anhydrous sits between.
const sucrose = P.compute({ sugar: 'sucrose' });
const anhydrous = P.compute({ sugar: 'anhydrous' });
assert.equal(sucrose.grams, 117.4);
assert.equal(anhydrous.grams, 123.6);
assert.ok(sucrose.grams < anhydrous.grams && anhydrous.grams < defaults.grams, 'sugar mass ordering');
assert.equal(sucrose.equivalents.dextrose, defaults.grams);
assert.equal(sucrose.equivalents.anhydrous, anhydrous.grams);

// --- Every catalog case must agree with the core. ---
let goldenCount = 0;
let boundaryCount = 0;
let validationCount = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    validationCount += 1;
    assert.equal(failure(testCase.input), testCase.expectedError, `${testCase.name}: validation message`);
    continue;
  }
  if (testCase.kind === 'golden') goldenCount += 1;
  else if (testCase.kind === 'boundary') boundaryCount += 1;
  else assert.fail(`unexpected test kind ${testCase.kind}`);
  const result = P.compute(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
}
assert.equal(goldenCount, 6, 'expected six golden cases');
assert.equal(boundaryCount, 6, 'expected six boundary cases');
assert.equal(validationCount, 12, 'expected twelve validation cases');

// --- Independent recomputation from the published fit and the molar masses. ---
const C = 12.011;
const H = 1.008;
const O = 15.999;
const CO2 = C + 2 * O;
const YIELDS = {
  sucrose: 4 * CO2 / (12 * C + 22 * H + 11 * O),
  dextrose: 2 * CO2 / (6 * C + 14 * H + 7 * O),
  anhydrous: 2 * CO2 / (6 * C + 12 * H + 6 * O)
};
const roundHalfAway = (value, places) => {
  const factor = Math.pow(10, places);
  return Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
};
let sweeps = 0;
for (const tempC of [0, 4, 8, 12, 16, 20, 24, 28, 30]) {
  for (const target of [1, 1.8, 2.4, 3, 3.6]) {
    for (const sugarKey of Object.keys(YIELDS)) {
      for (const litres of [0.5, 5, 12.5, 20, 60, 240]) {
        const result = P.compute({
          volume: String(litres), temp: String(tempC), target: String(target), sugar: sugarKey, bottle: '500'
        });
        const tempF = tempC * 9 / 5 + 32;
        const residual = 3.0378 - 0.050062 * tempF + 0.00026555 * tempF * tempF;
        const expectedToAdd = roundHalfAway(target - residual, 2);
        const toAdd = expectedToAdd > 0 ? expectedToAdd : 0;
        const grams = toAdd * 1.96 / YIELDS[sugarKey] * litres;
        assert.equal(result.residual, roundHalfAway(residual, 2), `${tempC} C residual`);
        assert.equal(result.toAdd, toAdd, `${tempC} C ${target} vol: CO2 to add`);
        assert.equal(result.grams, roundHalfAway(grams, 1), `${sugarKey} ${litres} L: sugar mass`);
        assert.equal(result.perBottle, roundHalfAway(grams / litres * 0.5, 1), 'per bottle mass');
        assert.equal(result.fullBottles, Math.floor(litres * 2 + 1e-9), 'bottle count');
        sweeps += 1;
      }
    }
  }
}

// --- Monotonicity: warmer beer holds less CO2 and so needs more sugar. ---
let previous = -1;
for (const tempC of [0, 5, 10, 15, 20, 25, 30]) {
  const result = P.compute({ temp: String(tempC), target: '2.6' });
  assert.ok(result.grams > previous, `sugar grows as the temperature rises (${tempC} C)`);
  previous = result.grams;
}
let lastGrams = -1;
for (const target of ['1', '1.5', '2', '2.5', '3', '3.5', '4']) {
  const result = P.compute({ target });
  assert.ok(result.grams > lastGrams, `sugar grows with the target (${target} vol)`);
  lastGrams = result.grams;
}

// --- Unit switches keep the physical batch. ---
const gallons = P.compute({ volume: '5.283', volumeUnit: 'gal' });
assert.ok(Math.abs(gallons.litres - 20) < 0.01, 'gallons convert through 3.785411784 L');
const fahrenheit = P.compute({ temp: '68', tempUnit: 'f' });
assert.equal(fahrenheit.tempC, 20);
assert.equal(fahrenheit.residual, defaults.residual);

// --- Refusals. ---
assert.equal(failure({ sugar: 'honey' }), 'Choose a priming sugar: table sugar, corn sugar or anhydrous dextrose.');
assert.equal(failure({ bottle: '440' }), 'Choose a bottle size.');
assert.equal(failure({ volumeUnit: 'pt' }), 'Choose litres or US gallons for the batch volume.');
assert.equal(failure({ tempUnit: 'k' }), 'Choose degrees Celsius or Fahrenheit for the temperature.');
assert.equal(failure({ volume: '-2' }), 'Batch volume must be a number from 0.5 to 500 litres.');
assert.equal(failure({ volume: '0.4' }), 'Batch volume must be a number from 0.5 to 500 litres.');
assert.equal(failure({ temp: '31' }), 'Warmest temperature must be a number from 0 to 30 degrees Celsius.');

// A target below the residual is a zero-sugar answer, not an error.
const flat = P.compute({ temp: '30', target: '0.5' });
assert.equal(flat.residual, 0.7);
assert.equal(flat.toAdd, 0);
assert.equal(flat.grams, 0);
assert.ok(flat.warnings.some((line) => line.includes('no priming sugar at all')), 'zero-sugar warning');

// --- Page contract. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'), 'live status region');
for (const id of ['volume', 'volume-unit', 'temp', 'temp-unit', 'target', 'sugar', 'bottle', 'calculate',
  'reset', 'ps-status', 'headline-out', 'residual-out', 'toadd-out', 'perlitre-out', 'perbottle-out',
  'equivalent-out', 'copy', 'notes']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or output ${id}`);
}
assert.ok(/<form id="ps-form" novalidate>/.test(html), 'form contract');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(/<option value="l" selected>/.test(html) && /<option value="c" selected>/.test(html), 'default units selected');
assert.ok(/<option value="dextrose" selected>/.test(html) && /<option value="500" selected>/.test(html), 'defaults selected');
assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(html), 'no raw HTML sinks');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'no browser storage');
assert.ok(!/https?:\/\//.test(html.replace(/<meta name="description"[^>]*>/, '')), 'no external requests in the page');
assert.ok(!/\bfetch\(|XMLHttpRequest/.test(html), 'no network calls');

console.log(`${slug}: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed; ` +
  `${sweeps} independent recomputations and the published anchors checked`);
