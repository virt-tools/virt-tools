/* Helical antenna designer: the fixture replay, the identities the classical
   axial-mode relations imply, the warnings, the refusals, the catalog record and
   the page contract. The fixture came from an independent Python model of the
   same published relations, never from this page. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'helical-antenna-designer';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* helix-core:start */';
const endMarker = '/* helix-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = HelicalAntenna;', sandbox);
const C = sandbox.module.exports;

const close = (actual, expected, message, tolerance) => {
  assert.equal(typeof actual, 'number', message + ': a number');
  assert.ok(Number.isFinite(actual), message + ': finite');
  assert.ok(Math.abs(actual - expected) <= (tolerance || 1e-6),
    message + ': expected ' + expected + ', got ' + actual);
};

// ---- The fixture, produced independently of this page.
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/helical_antenna_cases.json'), 'utf8'));
assert.equal(fixture.slug, slug);
assert.equal(fixture.cases.length, 24, '24 fixture cases');

for (const testCase of fixture.cases) {
  if (testCase.expectedError) {
    let message = null;
    try {
      C.calculate(testCase.input);
    } catch (error) {
      message = error.message;
    }
    assert.equal(message, testCase.expectedError, testCase.name);
    continue;
  }
  const got = C.calculate(testCase.input);
  for (const key of ['wavelength', 'circumference', 'circumferenceWaves', 'spacingWaves',
    'pitchAngle', 'axialLength', 'gainLinear', 'gainDbi', 'beamwidth']) {
    close(got[key], testCase.expected[key], testCase.name + ': ' + key);
  }
  close(got.frequency, Number(testCase.input.frequency), testCase.name + ': frequency');
  close(got.turns, Number(testCase.input.turns), testCase.name + ': turns');
  assert.ok(Array.isArray(got.warnings), testCase.name + ': warnings are a list');
}

// ---- The relations themselves, checked against the published algebra rather
// than the page's own arithmetic.
const LAMBDA_MM_PER_MHZ = 299792.458;
for (const frequency of [1, 145, 435, 2400, 5800, 10000, 300000]) {
  const wavelength = LAMBDA_MM_PER_MHZ / frequency;
  const diameter = wavelength / Math.PI;
  const spacing = 0.23 * wavelength;
  const got = C.calculate({
    unit: 'mm',
    frequency: String(frequency),
    diameter: String(diameter),
    turns: '10',
    spacing: String(spacing)
  });
  close(got.wavelength, wavelength, frequency + ' MHz: wavelength');
  close(got.wavelength * frequency, LAMBDA_MM_PER_MHZ, frequency + ' MHz: wavelength times frequency');
  close(got.circumference, Math.PI * diameter, frequency + ' MHz: circumference is pi d');
  close(got.circumferenceWaves, 1, frequency + ' MHz: C equals lambda', 2e-6);
  close(got.gainLinear, 3.45 * 10, frequency + ' MHz: C = lambda and S = 0.23 C give 3.45 N', 3e-5);
  close(got.gainDbi, 10 * Math.log10(34.5), frequency + ' MHz: the decibel form');
  close(got.axialLength, 10 * spacing, frequency + ' MHz: ten turns of winding');
  close(got.beamwidth, 52 / (1 * Math.sqrt(10 * 0.23)), frequency + ' MHz: the beamwidth form', 3e-4);
}

// ---- Doubling the turns adds 3.01 dB and shrinks the beam by root two; doubling
// the spacing does the same to the gain. Both follow from the products inside the
// relations, so they catch a swapped term.
const base = C.calculate({ unit: 'mm', frequency: '2400', diameter: '40', turns: '8', spacing: '29' });
const doubled = C.calculate({ unit: 'mm', frequency: '2400', diameter: '40', turns: '16', spacing: '29' });
const wider = C.calculate({ unit: 'mm', frequency: '2400', diameter: '40', turns: '8', spacing: '58' });
close(doubled.gainDbi - base.gainDbi, 10 * Math.log10(2), 'twice the turns adds 3.01 dB');
close(wider.gainDbi - base.gainDbi, 10 * Math.log10(2), 'twice the spacing adds 3.01 dB');
close(doubled.beamwidth, base.beamwidth / Math.SQRT2, 'twice the turns narrows the beam by root two', 1e-9);
close(wider.beamwidth, base.beamwidth / Math.SQRT2, 'twice the spacing narrows the beam by root two', 1e-9);
close(base.gainDbi, 10 * Math.log10(base.gainLinear), 'the reported decibels are the reported linear gain');
close(base.pitchAngle, Math.atan(29 / (Math.PI * 40)) * 180 / Math.PI, 'the pitch is the spacing over the circumference');

// ---- The same physical winding in either unit is the same antenna: only the
// entered lengths change, and the electrical figures do not.
const metric = C.calculate({ unit: 'mm', frequency: '2400', diameter: '40', turns: '8', spacing: '29' });
const imperial = C.calculate({
  unit: 'in',
  frequency: '2400',
  diameter: String(40 / 25.4),
  turns: '8',
  spacing: String(29 / 25.4)
});
close(imperial.gainDbi, metric.gainDbi, 'the gain does not depend on the length unit', 1e-9);
close(imperial.beamwidth, metric.beamwidth, 'the beamwidth does not depend on the length unit', 1e-9);
close(imperial.circumferenceWaves, metric.circumferenceWaves, 'the electrical circumference is unit free', 1e-9);
close(imperial.axialLength * 25.4, metric.axialLength, 'the winding length converts exactly');

// ---- Warnings are advice, never refusals: the design still comes back.
assert.equal(base.warnings.length, 0, 'a textbook 2.4 GHz helix needs no warning');
const narrow = C.calculate({ unit: 'mm', frequency: '2400', diameter: '10', turns: '8', spacing: '2.3' });
assert.equal(narrow.warnings.length, 2, 'a small helix at a tight pitch warns twice');
assert.ok(narrow.warnings[0].includes('outside the 0.75 to 1.33') && narrow.warnings[0].includes('\u03bb'),
  'the first warning is the electrical circumference');
assert.ok(narrow.warnings[1].includes('pitch angle') && narrow.warnings[1].includes('\u00b0'),
  'the second warning is the pitch angle');
assert.ok(narrow.gainDbi < 0, 'a tenth wavelength circumference is a loss, and the page still reports it');
const couple = C.calculate({ unit: 'mm', frequency: '2400', diameter: '40', turns: '2', spacing: '29' });
assert.equal(couple.warnings.length, 1, 'two turns warn about the beam');
assert.ok(couple.warnings[0].startsWith('Fewer than three turns'), 'the two-turn warning');
const wide = C.calculate({ unit: 'mm', frequency: '2400', diameter: '100', turns: '8', spacing: '72.3' });
assert.equal(wide.warnings.length, 1, 'a two-and-a-half wavelength circumference warns once');
assert.ok(wide.warnings[0].includes('axial mode'), 'the band warning names the mode');

// ---- Display: four decimals for the short lengths, two for gain, one for angles,
// trailing zeros dropped, and a half rounded away from zero rather than by binary
// representation.
assert.equal(C.show(124.913524166, 4), '124.9135');
assert.equal(C.show(232, 4), '232');
assert.equal(C.show(14.501706, 2), '14.5');
assert.equal(C.show(37.928326, 1), '37.9');
assert.equal(C.show(0.00004, 3), '0');
assert.equal(C.show(0.0005, 3), '0.001');
assert.equal(C.show(-0.0004, 3), '0');
assert.equal(C.round(2.0005, 3), 2.001);
assert.equal(C.round(82.85, 1), 82.9);

assert.equal(base.headline, 'Gain 14.5 dBi');
assert.equal(base.subline, '8 turns at 2400 MHz, 1.006 \u03bb circumference');
assert.equal(base.steps.length, 8, 'eight working rows');
assert.deepEqual(Array.from(base.steps, (step) => step.label),
  ['Wavelength', 'Circumference', 'Electrical circumference', 'Electrical spacing',
    'Gain factor', 'Gain', 'Beamwidth', 'Winding length']);
assert.equal(base.steps[0].working, '299792.458 \u00f7 2400 MHz');
assert.equal(base.steps[0].value, '124.9135 mm');
assert.equal(base.steps[2].working, '125.664 \u00f7 124.914');
assert.equal(base.steps[2].value, '1.006 \u03bb');
assert.equal(base.steps[5].value, '14.5 dBi');
assert.equal(base.steps[6].value, '37.9\u00b0');
assert.equal(base.steps[7].value, '232 mm');
assert.ok(imperial.steps[0].working.includes('\u00f7 25.4'), 'the inch wavelength shows the division');

// ---- Refusals the fixture does not carry.
const refusals = [
  [{ unit: 'furlong', frequency: '2400', diameter: '40', turns: '8', spacing: '29' }, 'Choose millimetres or inches.'],
  [{ unit: 'mm', frequency: '2400', diameter: '', turns: '8', spacing: '29' }, 'Enter the helix diameter.'],
  [{ unit: 'mm', frequency: '2400', diameter: '40', turns: '8', spacing: '-1' }, 'Enter a turn spacing greater than zero.'],
  [{ unit: 'mm', frequency: '2400', diameter: '40', turns: '1001', spacing: '29' }, 'Use no more than 1000 turns.'],
  [{ unit: 'mm', frequency: 'Infinity', diameter: '40', turns: '8', spacing: '29' }, 'Enter the frequency as a plain number.'],
  [{ unit: 'mm', frequency: '0.01', diameter: '40', turns: '8', spacing: '29' }, 'Use a frequency between 0.1 and 300000 MHz.']
];
for (const [input, expected] of refusals) {
  assert.throws(() => C.calculate(input), (error) => error.message === expected, expected);
}
// Defaults: a missing unit reads as millimetres.
assert.equal(C.calculate({ frequency: '2400', diameter: '40', turns: '8', spacing: '29' }).unit, 'mm');

// ---- The catalog record and the cases it carries.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(record.name, 'Helical Antenna Designer');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.listed, true, 'the tool is listed');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 80 && record.description.length < 260, 'description length');
for (const tag of ['antenna', 'helix', 'helical', 'gain', 'circular-polarization', 'rf']) {
  assert.ok(record.tags.includes(tag), 'tag ' + tag);
}
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.aliases.length >= 4, 'aliases cover the common searches');
assert.equal(record.sources.length, 1, 'the classical helix relations carry one source');
assert.ok(/^https:\/\/en\.wikipedia\.org\/wiki\/Helical_antenna$/.test(record.sources[0].url), 'the source URL');
assert.ok(typeof record.sources[0].title === 'string' && record.sources[0].title.length > 10, 'the source title');
assert.ok(typeof record.method === 'string' && record.method.length > 300, 'the method is recorded');
assert.equal(record.testCases.length, 24, '24 catalog cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 8);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 6);
assert.deepEqual(JSON.parse(JSON.stringify(record.testCases)), fixture.cases, 'catalog cases match the fixture');
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.throws(() => C.calculate(testCase.input), (error) => error.message === testCase.expectedError, testCase.name);
    continue;
  }
  close(C.calculate(testCase.input).gainDbi, testCase.expected.gainDbi, testCase.name + ' catalogue gain');
}

// ---- The page contract: one self-contained page, no network, no innerHTML.
const scripts = html.match(/<script\b/g) || [];
assert.equal(scripts.length, 3, 'theme bootstrap, the shared app script and one inline script');
assert.equal((html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []).length, 1, 'a single inline script');
assert.ok(!/https?:\/\//.test(html), 'no absolute URLs');
assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/.test(html), 'no network calls');
assert.ok(!/innerHTML/.test(html), 'text goes in through textContent');
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.ok(html.includes('<main'), 'main landmark');
assert.ok(html.includes('name="viewport"'), 'viewport');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('aria-live="polite"'), 'the result is announced');
assert.ok(html.includes('role="alert"'), 'errors are announced');
assert.ok(/\.field input[^{]*\{[^}]*min-height:44px/.test(html), 'touch targets are 44px');

const labels = new Set((html.match(/<label\b[^>]*\bfor="([^"]+)"/g) || []).map((tag) => tag.match(/for="([^"]+)"/)[1]));
for (const control of ['frequency', 'unit', 'diameter', 'turns', 'spacing']) {
  assert.ok(labels.has(control), control + ' has a label');
}
for (const button of ['type="submit"', 'type="button" id="reset"']) {
  assert.ok(html.includes(button), button + ' has an explicit type');
}
const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'ids are unique');

console.log('helical antenna designer: fixture, identities, warnings, refusals, catalog and page contract green');
