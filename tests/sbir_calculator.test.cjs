/* Speaker boundary interference (SBIR): replays every catalog case, re-derives the
   quarter-wavelength arithmetic and the placement inverse by hand, and pins the
   refusals, determinism and the offline page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'speaker-boundary-interference-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* sbir-core:start */';
const endMarker = '/* sbir-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|navigator\.|fetch\(|localStorage|XMLHttpRequest/.test(core),
  'the core stays free of DOM, storage and network access');

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SbirCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(catalog.tools.length, 2518, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2257, 'public tools');
assert.equal(entry.category, 'Audio', 'category');
assert.equal(entry.risk, 'low', 'risk');
assert.equal(entry.maturity, 'draft', 'maturity');
assert.equal(entry.listed, true, 'listed');
assert.ok(entry.sources.length >= 2, 'the quarter-wavelength rule and the path-difference form are cited');
assert.ok(entry.sources.some((source) => /arqen\.com/.test(source.url || '')), 'SBIR placement source');
assert.ok(entry.sources.some((source) => /gikacoustics\.com/.test(source.url || '')), 'path-difference source');
assert.ok(entry.testCases.length >= 26, `expected at least 26 cases, found ${entry.testCases.length}`);
assert.ok(entry.testCases.some((testCase) => testCase.kind === 'validation'), 'refusals are pinned');
assert.ok(entry.testCases.some((testCase) => testCase.kind === 'golden'), 'goldens are pinned');

const close = (actual, expected, message) => {
  assert.ok(Number.isFinite(actual), `${message}: not a finite number`);
  const tolerance = Math.max(1e-9, Math.abs(expected) * 1e-9);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
};
const metric = (distance, target = '200', boundary = 'front-wall') =>
  C.calculate({ units: 'metric', boundary, distance, target });
const imperial = (distance, target = '200', boundary = 'front-wall') =>
  C.calculate({ units: 'imperial', boundary, distance, target });

// ---- Catalog cases: every golden and every refusal, replayed through the page core.
for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(() => C.calculate(testCase.input), (error) => error.message === testCase.expected.error, label);
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    close(result[key], value, `${label}: ${key}`);
  }
}

// ---- f = c / 4d with c = 343 m/s: the published notches fall where they should.
close(metric(50).firstNull, 171.5, '50 cm gives the 171.5 Hz null');
close(metric(25).firstNull, 343, '25 cm gives the 343 Hz null');
close(metric(100).firstNull, 85.75, '1 m gives the 85.75 Hz null');
close(metric(200).firstNull, 42.875, '2 m gives the 42.875 Hz null');
close(metric(45).firstNull, 343 / (4 * 0.45), '45 cm gives 343 / 1.8');
close(metric(45).secondNull, 3 * metric(45).firstNull, 'the second notch is the third harmonic of the null');
close(metric(45).thirdNull, 5 * metric(45).firstNull, 'the third notch is the fifth harmonic');
close(metric(45).firstPeak, 2 * metric(45).firstNull, 'the first peak is twice the null');
close(metric(45).secondPeak, 4 * metric(45).firstNull, 'the second peak is four times the null');

// ---- Spacing, wavelength and delay are the same geometry seen three ways.
const sample = metric(45);
close(sample.nullSpacing, 2 * sample.firstNull, 'nulls repeat every 2f');
close(sample.nullSpacing, sample.firstPeak, 'the spacing equals the first peak');
close(sample.wavelengthCm, 4 * 45, 'the first null is a quarter wavelength, so the wavelength is 4d');
close(343 * 100 / sample.firstNull, sample.wavelengthCm, 'the wavelength is c / f');
close(sample.pathDifferenceCm, 90, 'the reflected path is 2d longer');
close(sample.delayMs, 2 * 0.45 / 343 * 1000, 'the reflection arrives 2d / c later');

// ---- The inverse: the distance at which the first null reaches the target.
close(metric(40, '100').maxDistanceCm, 85.75, '100 Hz sits at 85.75 cm');
close(metric(100, '20').maxDistanceCm, 428.75, '20 Hz sits at 4.2875 m');
close(metric(85.75, '100').firstNull, 100, '85.75 cm puts the null exactly at 100 Hz');
assert.equal(metric(85.75, '100').meetsTarget, true, 'the exact target distance is accepted');
assert.equal(metric(85.8, '100').meetsTarget, false, 'a hair further drops the null below the target');
assert.equal(metric(40, '200').meetsTarget, true, '40 cm keeps 214 Hz above a 200 Hz target');
assert.equal(metric(60, '200').meetsTarget, false, '60 cm drops the null to 143 Hz');

// ---- Metric and imperial describe the same geometry.
const metricCase = metric(45, '100', 'side-wall');
const imperialCase = imperial(45 / 2.54, '100', 'side-wall');
close(imperialCase.firstNull, metricCase.firstNull, 'the same distance gives the same null');
close(imperialCase.delayMs, metricCase.delayMs, 'the same distance gives the same delay');
close(imperialCase.maxDistanceCm, metricCase.maxDistanceCm, 'the same target gives the same limit');
close(imperialCase.distanceCm, 45, '17.7165 in is 45 cm');
close(imperial(12).pathDifferenceIn, 24, '12 in to the floor reflects 24 in further');
close(imperial(12).distanceCm, 30.48, '12 in is 30.48 cm');

// ---- Input forms the page accepts.
close(metric(' 45 ').firstNull, metric('45').firstNull, 'surrounding spaces are ignored');
close(metric('1 000').firstNull, metric('1000').firstNull, 'a spaced thousand is still one thousand');
const comma = metric('45,5');
close(comma.firstNull, 343 / (4 * 0.455), 'a decimal comma reads as a decimal point');
close(metric('45.5').firstNull, comma.firstNull, 'both decimal marks agree');
close(metric('007').firstNull, metric('7').firstNull, 'leading zeros do not change the distance');

// ---- Determinism: the same input returns the same object, and the input is untouched.
const frozenInput = Object.freeze({ units: 'metric', boundary: 'floor', distance: '55', target: '150' });
const first = C.calculate(frozenInput);
const second = C.calculate(frozenInput);
assert.deepEqual(first, second, 'repeated calls agree');
assert.equal(frozenInput.distance, '55', 'the input object is not modified');

// ---- Page contract: one form, labelled fields, no outbound requests, no inline handlers.
assert.ok(/<form id="sbir-form"/.test(html), 'form present');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
for (const id of ['units', 'boundary', 'distance', 'target']) {
  assert.ok(new RegExp(`<label for="${id}"`).test(html), `label for ${id}`);
  assert.ok(new RegExp(`id="${id}"`).test(html), `control ${id}`);
}
assert.ok(html.includes('/assets/theme-init.js') && html.includes('/assets/app.js'), 'shared assets');
assert.ok(!/https?:\/\//.test(html), 'the page itself makes no external reference');
assert.ok(!/\son[a-z]+\s*=/.test(html), 'no inline event handlers');
assert.ok(!/\beval\s*\(|new Function\s*\(/.test(html), 'no dynamic code evaluation');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), 'no network or storage');
assert.ok(/<button class="primary" type="submit">/.test(html), 'a submit button');
assert.ok(/id="reset"/.test(html), 'a reset button');

console.log('sbir suite ok');
