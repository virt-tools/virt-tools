/* Regression checks for the microstrip trace impedance calculator: the
   catalogue cases, an independent recomputation over a grid, a third-opinion
   cross-check against the alternative Hammerstad-Jensen form, the scaling
   laws and the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'microstrip-trace-impedance-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* microstrip-core:start */');
const end = html.indexOf('/* microstrip-core:end */');
assert.ok(start > -1 && end > start, 'microstrip core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MicrostripCore;', sandbox);
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

// Independent transcription of the documented arithmetic: convert the
// dimensions, merge the defaults by hand, pick the branch and round each
// reported figure with the catalogued rule.
const DEFAULT_INPUT = { width: 3, height: 1.6, er: 4.4, freq: 1, unit: 'mm' };
const PS_PER_MM = 3.3356409519815204;
const NH_PER_MM = 0.0033356409519815204;

function roundHalfUp(value, places) {
  const factor = 10 ** places;
  return Math.floor(value * factor + 0.5) / factor;
}

function recompute(input) {
  const merged = { ...DEFAULT_INPUT, ...(input || {}) };
  const unit = String(merged.unit);
  const factor = unit === 'mil' ? 0.0254 : 1;
  const widthMm = Number(merged.width) * factor;
  const heightMm = Number(merged.height) * factor;
  const er = Number(merged.er);
  const freq = Number(merged.freq);
  const u = widthMm / heightMm;
  let eeff;
  let z0;
  if (u <= 1) {
    eeff = (er + 1) / 2 + (er - 1) / 2 * (1 / Math.sqrt(1 + 12 / u) + 0.04 * (1 - u) ** 2);
    z0 = 60 / Math.sqrt(eeff) * Math.log(8 / u + u / 4);
  } else {
    eeff = (er + 1) / 2 + (er - 1) / 2 / Math.sqrt(1 + 12 / u);
    z0 = 120 * Math.PI / (Math.sqrt(eeff) * (u + 1.393 + 0.667 * Math.log(u + 1.444)));
  }
  const wave = Math.sqrt(eeff);
  return {
    unit, ratio: roundHalfUp(u, 4), eeff: roundHalfUp(eeff, 4), z0: roundHalfUp(z0, 2),
    velocityFactor: roundHalfUp(1 / wave, 4),
    delayPsPerMm: roundHalfUp(PS_PER_MM * wave, 3),
    delayPsPerInch: roundHalfUp(PS_PER_MM * wave * 25.4, 3),
    lambdaMm: roundHalfUp(299.792458 / freq / wave, 2),
    capPfPerMm: roundHalfUp(PS_PER_MM * wave / z0, 4),
    indNnPerMm: roundHalfUp(z0 * wave * NH_PER_MM, 4)
  };
}

// A third opinion: the single-expression Hammerstad-Jensen 1980 model.
function alternative(u, er) {
  const f = 6 + (2 * Math.PI - 6) * Math.exp(-((30.666 / u) ** 0.7528));
  const a = 1 + (1 / 49) * Math.log((u ** 4 + (u / 52) ** 2) / (u ** 4 + 0.432))
    + (1 / 18.7) * Math.log(1 + (u / 18.1) ** 3);
  const b = 0.564 * ((er - 0.9) / (er + 3)) ** 0.053;
  const eeff = 0.5 * (er + 1) + 0.5 * (er - 1) * (1 + 10 / u) ** (-a * b);
  const z0 = 60 / Math.sqrt(eeff) * Math.log(f / u + Math.sqrt(1 + (2 / u) ** 2));
  return { eeff, z0 };
}

const close = (actual, expected, label, tolerance = 5.1e-4) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' != ' + expected);

// Defaults describe a familiar 50 ohm line on 1.6 mm FR-4.
const base = calculate({});
assert.equal(base.unit, 'mm');
assert.equal(base.ratio, 1.875);
assert.equal(base.eeff, 3.3249);
assert.equal(base.z0, 50.82);
assert.equal(base.velocityFactor, 0.5484);
assert.equal(base.delayPsPerMm, 6.082);
assert.equal(base.lambdaMm, 164.41);
close(base.delayPsPerInch, 154.491, 'default delay per inch', 1.1e-3);
close(base.capPfPerMm * base.z0, base.delayPsPerMm, 'capacity relation', 5.1e-3);
close(base.indNnPerMm * 1000, base.z0 * base.delayPsPerMm, 'inductance relation', 0.06);

// Mil input describes the same physical line as the millimetre default.
const mil = calculate({ width: 118.11, height: 62.99, unit: 'mil' });
assert.equal(mil.z0, 50.82);
assert.equal(mil.eeff, 3.3249);
assert.equal(mil.ratio, 1.8751);

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

// A deterministic grid walks both branches, both units and the whole ranges.
const widths = [0.01, 0.05, 0.5, 1, 3, 10, 50];
const heights = [0.01, 0.1, 0.5, 1.6, 10, 50];
const permittivities = [1, 2.2, 4.4, 9.8, 100];
const frequencies = [0.01, 1, 10, 100];
const milWidths = [0.4, 4, 40, 400, 2000];
const milHeights = [0.4, 10, 40, 400, 2000];

let rows = 0;
function checkRow(input) {
  const expected = recompute(input);
  if (expected.ratio < 0.01 || expected.ratio > 100) {
    assert.equal(failure(input),
      'The width-to-height ratio must be between 0.01 and 100 for this estimate.');
    return;
  }
  const result = calculate(input);
  assert.equal(result.ratio, expected.ratio, 'ratio ' + JSON.stringify(input));
  assert.equal(result.eeff, expected.eeff, 'eeff ' + JSON.stringify(input));
  assert.equal(result.z0, expected.z0, 'z0 ' + JSON.stringify(input));
  assert.equal(result.velocityFactor, expected.velocityFactor, 'velocity ' + JSON.stringify(input));
  assert.equal(result.delayPsPerMm, expected.delayPsPerMm, 'delay ' + JSON.stringify(input));
  assert.equal(result.delayPsPerInch, expected.delayPsPerInch, 'delay inch ' + JSON.stringify(input));
  assert.equal(result.lambdaMm, expected.lambdaMm, 'lambda ' + JSON.stringify(input));
  assert.equal(result.capPfPerMm, expected.capPfPerMm, 'capacitance ' + JSON.stringify(input));
  assert.equal(result.indNnPerMm, expected.indNnPerMm, 'inductance ' + JSON.stringify(input));
  // The core must echo the parsed inputs so the page can label the result.
  assert.equal(result.width, Number(input.width));
  assert.equal(result.height, Number(input.height));
  assert.equal(result.er, Number(input.er));
  assert.equal(result.freq, Number(input.freq));
  assert.equal(result.unit, input.unit);
  rows += 1;
}

for (let i = 0; i < widths.length; i += 1) {
  for (let j = 0; j < heights.length; j += 1) {
    for (let k = 0; k < permittivities.length; k += 1) {
      checkRow({
        width: String(widths[i]), height: String(heights[j]),
        er: String(permittivities[k]),
        freq: String(frequencies[(i + j + k) % frequencies.length]), unit: 'mm'
      });
    }
  }
}
for (let i = 0; i < milWidths.length; i += 1) {
  for (let j = 0; j < milHeights.length; j += 1) {
    checkRow({
      width: String(milWidths[i]), height: String(milHeights[j]),
      er: String(permittivities[(i + j) % permittivities.length]),
      freq: String(frequencies[(i * 2 + j) % frequencies.length]), unit: 'mil'
    });
  }
}

// Scaling laws: a uniformly scaled cross-section keeps impedance and delay,
// and frequency only divides the guided wavelength.
for (const scale of [0.25, 0.5, 2, 4]) {
  const scaled = calculate({ width: 3 * scale, height: 1.6 * scale });
  assert.equal(scaled.z0, base.z0, 'scaled impedance');
  assert.equal(scaled.eeff, base.eeff, 'scaled permittivity');
  assert.equal(scaled.delayPsPerMm, base.delayPsPerMm, 'scaled delay');
}
const twice = calculate({ freq: 2 });
assert.equal(twice.z0, base.z0, 'frequency must not move impedance');
close(twice.lambdaMm * 2, base.lambdaMm, 'wavelength inverse law', 0.02);
const tenth = calculate({ freq: 0.1 });
close(tenth.lambdaMm, base.lambdaMm * 10, 'wavelength inverse law at 0.1 GHz', 5.1e-2);

// Third-opinion cross-check: the two standard closed forms must agree within
// two percent for width-to-height ratios from 0.1 to 10.
for (const [u, er] of [[0.1, 4.4], [0.2, 2.2], [0.5, 9.8], [1, 4.4], [2, 4.4], [5, 4.4], [10, 4.4]]) {
  const result = calculate({ width: u * 1.6, height: 1.6, er });
  const oracle = alternative(u, er);
  assert.ok(Math.abs(result.z0 - oracle.z0) / oracle.z0 < 0.02,
    'alternative form impedance disagrees at u=' + u + ': ' + result.z0 + ' vs ' + oracle.z0);
  assert.ok(Math.abs(result.eeff - oracle.eeff) / oracle.eeff < 0.02,
    'alternative form permittivity disagrees at u=' + u);
}

// Out-of-range ratios are refused at both ends.
assert.equal(failure({ width: '0.01', height: '50' }),
  'The width-to-height ratio must be between 0.01 and 100 for this estimate.');
assert.equal(failure({ width: '50', height: '0.4' }),
  'The width-to-height ratio must be between 0.01 and 100 for this estimate.');
assert.equal(failure({ width: '', height: 1.6 }),
  'Trace width is required.');
assert.equal(failure({ width: 3, height: '  ' }),
  'Substrate height is required.');
assert.equal(failure({ width: 3, height: 1.6, er: 1.01 }),
  null, 'permittivity just above one must be accepted');
assert.equal(failure({ width: '3e0' }),
  'Trace width must be a number from 0.01 to 50 mm.');

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/on(?:click|input|change)=/i.test(html), 'page must not use inline handlers');
assert.ok(html.includes('<form id="microstrip-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('aria-describedby'), 'fields must reference their help text');
for (const id of ['width', 'height', 'unit', 'er', 'freq']) {
  assert.ok(html.includes('id="in-' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="in-' + id + '"'), 'label ' + id + ' missing');
  const help = { width: 'width-help', height: 'height-help', unit: 'unit-help',
    er: 'er-help', freq: 'freq-help' }[id];
  assert.ok(html.includes('aria-describedby="' + help + '"'), 'help reference ' + id + ' missing');
  assert.ok(html.includes('id="' + help + '"'), 'help text ' + id + ' missing');
}
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet missing');
assert.ok(html.includes('type="submit"'), 'submit button missing');
assert.ok(html.includes('id="reset"'), 'reset button missing');
assert.ok(html.includes('type="button"'), 'reset button must not submit the form');

console.log('Microstrip trace impedance: ' + entry.testCases.length + ' catalog cases, '
  + rows + ' grid rows and invariants passed');
