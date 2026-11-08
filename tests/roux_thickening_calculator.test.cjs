/* Regression checks for the roux thickening calculator: the catalogued cases,
   an independent recomputation over a grid of valid volumes and roux weights,
   the documented invariants, and the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'roux-thickening-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* roux-core:start */');
const end = html.indexOf('/* roux-core:end */');
assert.ok(start > -1 && end > start, 'roux core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RouxCore;', sandbox);
const C = sandbox.module.exports;

const CUP_ML = 236.5882365;
const FLOUR_G = 8;
const BUTTER_G = 14.2;
const MAX_ML = 6000;
const PER_CUP = { thin: 1, medium: 2, thick: 3 };
const UNIT_ML = { cups: CUP_ML, ml: 1, litres: 1000 };

const calculate = (input) => C.calculate(input);
const failure = (input) => {
  try {
    calculate(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

function roundHalfUp(value, places) {
  const factor = 10 ** places;
  return Math.floor(value * factor + 0.5) / factor;
}

// Independent transcription of the documented arithmetic.
function recompute(input) {
  const mode = (input && input.mode) || 'liquid';
  const preset = (input && input.preset) || 'medium';
  const perCup = PER_CUP[preset];
  let volumeMl;
  let cups;
  let flourTbsp;
  let volume = null;
  let rouxInput = null;
  let unit = null;
  if (mode === 'liquid') {
    unit = (input && input.unit) || 'cups';
    volume = Number((input && input.volume) || '2');
    volumeMl = volume * UNIT_ML[unit];
    cups = volumeMl / CUP_ML;
    flourTbsp = cups * perCup;
  } else {
    rouxInput = Number((input && input.roux) || '60');
    flourTbsp = (rouxInput * (FLOUR_G / (FLOUR_G + BUTTER_G))) / FLOUR_G;
    cups = flourTbsp / perCup;
    volumeMl = cups * CUP_ML;
  }
  const flourGrams = flourTbsp * FLOUR_G;
  const fatGrams = flourTbsp * BUTTER_G;
  const warnings = [];
  if (mode === 'liquid' && cups < 0.5) warnings.push('small');
  if (mode === 'liquid' && cups > 16) warnings.push('large');
  if (mode === 'roux' && volumeMl < 60) warnings.push('tiny');
  if (mode === 'roux' && volumeMl > 4000) warnings.push('huge');
  if (preset === 'thick') warnings.push('thick');
  return {
    mode, preset, unit, volume, rouxInput,
    volumeMl: roundHalfUp(volumeMl, 0),
    cups: roundHalfUp(cups, 2),
    flourTbsp: roundHalfUp(flourTbsp, 2),
    flourGrams: roundHalfUp(flourGrams, 1),
    fatTbsp: roundHalfUp(fatGrams / BUTTER_G, 2),
    fatGrams: roundHalfUp(fatGrams, 1),
    rouxGrams: roundHalfUp(flourGrams + fatGrams, 1),
    flourPct: roundHalfUp((flourGrams / volumeMl) * 100, 1),
    warningCount: warnings.length
  };
}

// The page's own defaults: two cups of liquid for a medium sauce.
const base = calculate({});
assert.equal(base.flourGrams, 32);
assert.equal(base.fatGrams, 56.8);
assert.equal(base.rouxGrams, 88.8);
assert.equal(base.flourTbsp, 4);
assert.equal(base.fatTbsp, 4);
assert.equal(base.cups, 2);
assert.equal(base.flourPct, 6.8);
assert.equal(base.volumeMl, 473);

// The three documented consistencies sit at fixed flour shares of the liquid.
for (const [preset, expected] of Object.entries({ thin: 3.4, medium: 6.8, thick: 10.1 })) {
  assert.equal(calculate({ volume: '4', unit: 'cups', preset }).flourPct, expected, preset + ' flour share');
}

// Reverse mode: a 60 g roux splits 8:14.2 and thickens a medium sauce.
const reverse = calculate({ mode: 'roux', roux: '60', preset: 'medium' });
assert.equal(reverse.rouxGrams, 60);
assert.equal(reverse.flourGrams, 21.6);
assert.equal(reverse.fatGrams, 38.4);
assert.equal(reverse.cups, 1.35);
assert.equal(reverse.volumeMl, 320);
assert.equal(reverse.rouxInput, 60);
assert.equal(reverse.volume, null);
assert.equal(reverse.unit, null);

// The catalogue records the same numbers the page computes.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Food');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(entry.icon, '🥣');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 900, 'method must describe the arithmetic');
assert.ok(entry.testCases.length >= 30, 'expected at least thirty catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');

for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = calculate(testCase.input);
  for (const [field, value] of Object.entries(testCase.expected)) {
    if (field === 'warnings') {
      assert.equal(result.warnings.length, value.length, testCase.name + ' warning count');
      continue;
    }
    assert.equal(JSON.stringify(result[field]), JSON.stringify(value), testCase.name + ' ' + field);
  }
}

// A deterministic grid walks every unit and consistency, plus the reverse mode.
let rows = 0;
function checkRow(input, expectWarningCount) {
  const expected = recompute(input);
  const result = calculate(input);
  for (const field of ['mode', 'preset', 'unit', 'volume', 'rouxInput', 'volumeMl', 'cups',
    'flourTbsp', 'flourGrams', 'fatTbsp', 'fatGrams', 'rouxGrams', 'flourPct']) {
    assert.equal(JSON.stringify(result[field]), JSON.stringify(expected[field]),
      field + ' ' + JSON.stringify(input));
  }
  if (expectWarningCount !== undefined) {
    assert.equal(result.warnings.length, expectWarningCount, 'warnings ' + JSON.stringify(input));
  }
  assert.equal(result.fatTbsp, result.flourTbsp, 'fat matches the flour volume');
  assert.ok(Math.abs(result.rouxGrams - (result.flourGrams + result.fatGrams)) <= 0.2,
    'roux total ' + JSON.stringify(input));
  assert.ok(result.flourGrams > 0 && result.volumeMl > 0, 'positive amounts');
  rows += 1;
}

const volumes = {
  cups: ['0.25', '0.3', '0.4', '0.5', '0.6', '0.75', '0.8', '1', '1.25', '1.5', '2', '2.25',
    '2.5', '3', '3.5', '4', '5', '6', '7', '8', '10', '12', '14', '16', '18', '20', '25'],
  ml: ['60', '75', '90', '120', '150', '236.6', '250', '300', '473', '500', '600', '750',
    '900', '1000', '1500', '2000', '3000', '4000', '5000', '6000'],
  litres: ['0.06', '0.1', '0.2', '0.25', '0.4', '0.5', '0.75', '0.8', '1', '1.25', '1.5',
    '2', '2.5', '3', '4', '5', '6']
};
for (const unit of Object.keys(volumes)) {
  for (const preset of Object.keys(PER_CUP)) {
    for (const volume of volumes[unit]) {
      checkRow({ volume, unit, preset });
    }
  }
}
for (const preset of Object.keys(PER_CUP)) {
  for (const roux of ['5', '7.5', '10', '15', '22.2', '60', '100', '250', '500', '750', '1000', '1500']) {
    const capacity = (Number(roux) * (FLOUR_G / (FLOUR_G + BUTTER_G)) / FLOUR_G / PER_CUP[preset]) * CUP_ML;
    if (capacity > MAX_ML) {
      assert.equal(failure({ mode: 'roux', roux, preset }),
        'That much roux would thicken more than 6000 mL at this consistency; choose a thicker consistency or use less roux.');
      continue;
    }
    checkRow({ mode: 'roux', roux, preset });
  }
}
assert.ok(rows >= 200, 'grid must cover at least two hundred rows, got ' + rows);

// Doubling the liquid doubles the flour, and a thicker consistency always
// needs more flour for the same liquid.
const pairs = { cups: ['1', '2'], ml: ['500', '1000'], litres: ['0.5', '1'] };
for (const unit of Object.keys(pairs)) {
  const [small, large] = pairs[unit];
  const single = calculate({ volume: small, unit, preset: 'medium' });
  const doubled = calculate({ volume: large, unit, preset: 'medium' });
  assert.ok(Math.abs(doubled.flourGrams - single.flourGrams * 2) <= 0.2, 'doubling ' + unit);
  const thin = calculate({ volume: large, unit, preset: 'thin' });
  const thick = calculate({ volume: large, unit, preset: 'thick' });
  assert.ok(thin.flourGrams < doubled.flourGrams && doubled.flourGrams < thick.flourGrams, 'ordering ' + unit);
}

// Warning thresholds: strictly under half a cup, strictly over sixteen cups,
// under 60 mL of capacity, over four litres, and every thick setting.
assert.equal(calculate({ volume: '0.49', unit: 'cups', preset: 'thin' }).warnings.length, 1);
assert.equal(calculate({ volume: '0.5', unit: 'cups', preset: 'thin' }).warnings.length, 0);
assert.equal(calculate({ volume: '16', unit: 'cups', preset: 'medium' }).warnings.length, 0);
assert.equal(calculate({ volume: '16.5', unit: 'cups', preset: 'medium' }).warnings.length, 1);
assert.equal(calculate({ volume: '1', unit: 'cups', preset: 'thick' }).warnings.length, 1);
assert.equal(calculate({ mode: 'roux', roux: '400', preset: 'thin' }).warnings.length, 1);
assert.equal(calculate({ mode: 'roux', roux: '5', preset: 'medium' }).warnings.length, 1);
assert.ok(calculate({ mode: 'roux', roux: '5', preset: 'medium' }).warnings[0].includes('quarter cup'));

// Refusals name the field, the range or the physical limit.
assert.equal(failure({ volume: '' }), 'Liquid volume is required.');
assert.equal(failure({ volume: '0.2' }), 'Liquid volume must be a number from 0.25 to 25.');
assert.equal(failure({ volume: '25.1' }), 'Liquid volume must be a number from 0.25 to 25.');
assert.equal(failure({ volume: '59', unit: 'ml' }), 'Liquid volume must be a number from 60 to 6000.');
assert.equal(failure({ volume: '6.1', unit: 'litres' }), 'Liquid volume must be a number from 0.06 to 6.');
assert.equal(failure({ volume: '2e0' }), 'Liquid volume must be a number from 0.25 to 25.');
assert.equal(failure({ volume: '.5' }), 'Liquid volume must be a number from 0.25 to 25.');
assert.equal(failure({ volume: '2.' }), 'Liquid volume must be a number from 0.25 to 25.');
assert.equal(failure({ volume: '1.2345' }), 'Liquid volume must be a number from 0.25 to 25.');
assert.equal(failure({ volume: ' 2 ' }), null, 'surrounding whitespace must be accepted');
assert.equal(failure({ unit: 'gallons' }), 'Choose cups, millilitres or litres.');
assert.equal(failure({ preset: 'extra' }), 'Choose a thin, medium or thick consistency.');
assert.equal(failure({ mode: 'both' }), 'Choose whether to start from a liquid volume or from a roux.');
assert.equal(failure({ mode: 'roux', roux: '' }), 'Roux weight is required.');
assert.equal(failure({ mode: 'roux', roux: '4.9' }), 'Roux weight must be a number from 5 to 2000.');
assert.equal(failure({ mode: 'roux', roux: '2000.1' }), 'Roux weight must be a number from 5 to 2000.');
assert.equal(failure({ mode: 'roux', roux: '2000', preset: 'thick' }),
  'That much roux would thicken more than 6000 mL at this consistency; choose a thicker consistency or use less roux.');

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/on(?:click|input|change)=/i.test(html), 'page must not use inline handlers');
assert.ok(html.includes('<form id="roux-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
for (const id of ['mode', 'preset', 'volume', 'unit', 'roux']) {
  assert.ok(html.includes('id="in-' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="in-' + id + '"'), 'label ' + id + ' missing');
  assert.ok(html.includes('aria-describedby="' + id + '-help"'), 'help reference ' + id + ' missing');
  assert.ok(html.includes('id="' + id + '-help"'), 'help text ' + id + ' missing');
}
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet missing');
assert.ok(html.includes('type="submit"'), 'submit button missing');
assert.ok(html.includes('id="reset"'), 'reset button missing');
assert.ok(html.includes('type="button"'), 'reset button must not submit the form');

console.log('Roux thickening: ' + entry.testCases.length + ' catalog cases, '
  + rows + ' grid rows and invariants passed');
