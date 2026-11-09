/* Regression checks for the microstrip patch antenna designer: the catalogue
   cases, an independent recomputation over a grid, the scaling laws and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'microstrip-patch-antenna-designer';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* patch-core:start */');
const end = html.indexOf('/* patch-core:end */');
assert.ok(start > -1 && end > start, 'patch core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PatchCore;', sandbox);
const C = sandbox.module.exports;

const calculate = (input) => C.calculate(input);
const failure = (input) => {
  try {
    calculate(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

const C_MM_GHZ = 299.792458;
const MM_PER_MIL = 0.0254;
const DEFAULT_INPUT = { freq: 2.4, er: 4.4, h: 1.6, unit: 'mm' };
const RANGES = { mm: [0.05, 10], mil: [2, 400] };

function roundHalfUp(value, places) {
  const factor = 10 ** places;
  return Math.floor(value * factor + 0.5) / factor;
}

// Independent transcription of the documented arithmetic.
function recompute(input) {
  const merged = { ...DEFAULT_INPUT, ...(input || {}) };
  const unit = String(merged.unit);
  const hMm = Number(merged.h) * (unit === 'mil' ? MM_PER_MIL : 1);
  const freq = Number(merged.freq);
  const er = Number(merged.er);
  const lambda0 = C_MM_GHZ / freq;
  const width = lambda0 / 2 * Math.sqrt(2 / (er + 1));
  const ratio = width / hMm;
  const eeff = (er + 1) / 2 + (er - 1) / 2 / Math.sqrt(1 + 12 / ratio);
  const delta = 0.412 * hMm * ((eeff + 0.3) * (ratio + 0.264)) / ((eeff - 0.258) * (ratio + 0.8));
  const length = lambda0 / (2 * Math.sqrt(eeff)) - 2 * delta;
  if (length <= 0) {
    return { error: 'These inputs leave no resonant length: the substrate is far too thick for this frequency.' };
  }
  return {
    unit, freq, er, h: Number(merged.h), hMm: roundHalfUp(hMm, 5),
    lambda0Mm: roundHalfUp(lambda0, 2),
    widthMm: roundHalfUp(width, 2),
    widthMil: roundHalfUp(width / MM_PER_MIL, 0),
    eeff: roundHalfUp(eeff, 4),
    deltaLMm: roundHalfUp(delta, 3),
    lengthMm: roundHalfUp(length, 2),
    lengthMil: roundHalfUp(length / MM_PER_MIL, 0),
    ratioWH: roundHalfUp(ratio, 4),
    lambdaGMm: roundHalfUp(lambda0 / Math.sqrt(eeff), 2),
    hOverLambda0: roundHalfUp(hMm / lambda0, 5),
    groundWidthMm: roundHalfUp(width + 12 * hMm, 2),
    groundLengthMm: roundHalfUp(length + 12 * hMm, 2)
  };
}

const close = (actual, expected, label, tolerance = 5.1e-4) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' != ' + expected);

// Defaults describe a familiar 2.4 GHz patch on 1.6 mm FR-4.
const base = calculate({});
assert.equal(base.unit, 'mm');
assert.equal(base.widthMm, 38.01);
assert.equal(base.lengthMm, 29.42);
assert.equal(base.eeff, 4.0857);
assert.equal(base.deltaLMm, 0.739);
assert.equal(base.lambda0Mm, 124.91);
assert.equal(base.lambdaGMm, 61.8);
assert.equal(base.ratioWH, 23.7562);
assert.equal(base.hOverLambda0, 0.01281);
assert.equal(base.groundWidthMm, 57.21);
assert.equal(base.groundLengthMm, 48.62);

// The published 2.4 GHz FR-4 design is 38.04 x 29.44 mm on 1.6 mm laminate;
// this model must land within half a percent of both dimensions.
assert.ok(Math.abs(base.widthMm - 38.04) / 38.04 < 0.005, 'width against the published design');
assert.ok(Math.abs(base.lengthMm - 29.44) / 29.44 < 0.005, 'length against the published design');

// Mil input describes the same physical patch as 1.6 mm.
const mil = calculate({ h: 63, unit: 'mil' });
assert.equal(mil.widthMm, base.widthMm);
assert.equal(mil.lengthMm, base.lengthMm);
assert.equal(mil.hMm, 1.6002);
assert.equal(mil.widthMil, 1496);

// The catalogue records the same numbers the page computes.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Communications Engineering');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
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
    assert.equal(JSON.stringify(result[field]), JSON.stringify(value), testCase.name + ' ' + field);
  }
}

// A deterministic grid walks both thickness units and the whole range.
const frequencies = ['0.1', '0.5', '1', '2.4', '5.8', '10', '24', '50'];
const permittivities = ['1.1', '2.2', '3.55', '4.4', '9.8', '20'];
const millimetres = ['0.05', '0.254', '0.5', '1.6', '3.175', '10'];
const mils = ['2', '10', '63', '125', '250', '400'];

let rows = 0;
function checkRow(input) {
  const expected = recompute(input);
  if (expected.error) {
    assert.equal(failure(input), expected.error, 'refusal ' + JSON.stringify(input));
    return;
  }
  const result = calculate(input);
  for (const [field, value] of Object.entries(expected)) {
    assert.equal(result[field], value, field + ' ' + JSON.stringify(input));
  }
  assert.equal(typeof result.h, 'number');
  assert.equal(typeof result.freq, 'number');
  assert.equal(typeof result.er, 'number');
  assert.ok(result.eeff >= 1 && result.eeff <= result.er, 'effective permittivity out of range');
  // Physical length plus both fringing extensions is the half-wave length,
  // within the rounding of a 0.01 mm length and a 0.001 mm extension.
  const half = result.lambda0Mm / 2 / Math.sqrt(result.eeff);
  assert.ok(Math.abs(result.lengthMm + 2 * result.deltaLMm - half) <= 0.02 + 2e-4 * half,
    'half-wave identity');
  assert.ok(result.groundWidthMm > result.widthMm && result.groundLengthMm > result.lengthMm,
    'ground plane must enclose the patch');
  rows += 1;
}

for (let i = 0; i < frequencies.length; i += 1) {
  for (let j = 0; j < permittivities.length; j += 1) {
    for (let k = 0; k < millimetres.length; k += 1) {
      checkRow({ freq: frequencies[i], er: permittivities[j], h: millimetres[k], unit: 'mm' });
      checkRow({ freq: frequencies[i], er: permittivities[j], h: mils[k], unit: 'mil' });
    }
  }
}

// Scaling laws: raising the frequency by k scales every length by 1/k when the
// substrate thickness is scaled with it, while the effective permittivity and
// the width-to-thickness ratio stay put.
for (const factor of [0.5, 2, 5]) {
  const scaled = calculate({ freq: 2.4 * factor, h: 1.6 / factor });
  close(scaled.widthMm, base.widthMm / factor, 'scaled width at ' + factor, 0.02);
  close(scaled.lengthMm, base.lengthMm / factor, 'scaled length at ' + factor, 0.02);
  assert.equal(scaled.eeff, base.eeff, 'scaled permittivity');
  assert.equal(scaled.ratioWH, base.ratioWH, 'scaled ratio');
  assert.equal(scaled.hOverLambda0, base.hOverLambda0, 'scaled thickness ratio');
}

// Permittivity limits: epsilon_eff tends to epsilon_r as the substrate thins.
const thin = calculate({ h: 0.05, er: 4.4 });
assert.ok(thin.eeff > base.eeff && thin.eeff < 4.4, 'thin substrate approaches epsilon_r');
assert.ok(thin.lengthMm > base.lengthMm, 'thin substrate lengthens the patch');

// Out-of-range and malformed inputs are refused by name.
assert.equal(failure({ freq: '' }), 'Frequency is required.');
assert.equal(failure({ er: ' ' }), 'Relative permittivity is required.');
assert.equal(failure({ h: '' }), 'Substrate thickness is required.');
assert.equal(failure({ freq: '0.05' }), 'Frequency must be a number from 0.1 to 50 GHz.');
assert.equal(failure({ freq: '50.1' }), 'Frequency must be a number from 0.1 to 50 GHz.');
assert.equal(failure({ er: '1' }), 'Relative permittivity must be a number from 1.1 to 20.');
assert.equal(failure({ er: '20.5' }), 'Relative permittivity must be a number from 1.1 to 20.');
assert.equal(failure({ h: '0.049' }), 'Substrate thickness must be a number from 0.05 to 10 mm.');
assert.equal(failure({ h: '10.1' }), 'Substrate thickness must be a number from 0.05 to 10 mm.');
assert.equal(failure({ h: '1.9', unit: 'mil' }), 'Substrate thickness must be a number from 2 to 400 mil.');
assert.equal(failure({ h: '401', unit: 'mil' }), 'Substrate thickness must be a number from 2 to 400 mil.');
assert.equal(failure({ h: '1e-1' }), 'Substrate thickness must be a number from 0.05 to 10 mm.');
assert.equal(failure({ freq: '2.4GHz' }), 'Frequency must be a number from 0.1 to 50 GHz.');
assert.equal(failure({ unit: 'cm' }), 'Choose a valid thickness unit: millimetres or mils.');
assert.equal(failure({ freq: '50', er: '20', h: '10' }),
  'These inputs leave no resonant length: the substrate is far too thick for this frequency.');

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/on(?:click|input|change)=/i.test(html), 'page must not use inline handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(html), 'page must build DOM nodes, not markup strings');
assert.ok(html.includes('<form id="patch-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('aria-describedby'), 'fields must reference their help text');
for (const id of ['freq', 'er', 'h', 'unit']) {
  assert.ok(html.includes('id="in-' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="in-' + id + '"'), 'label ' + id + ' missing');
}
for (const help of ['freq-help', 'er-help', 'h-help', 'unit-help']) {
  assert.ok(html.includes('id="' + help + '"'), 'help text ' + help + ' missing');
}
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet missing');
assert.ok(html.includes('type="submit"'), 'submit button missing');
assert.ok(html.includes('id="reset"'), 'reset button missing');

console.log('Microstrip patch antenna: ' + entry.testCases.length + ' catalog cases, '
  + rows + ' grid rows and invariants passed');
