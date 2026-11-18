/* Pipe offset: the travel, run, true offset, roll angle and cut length, checked
   against an independent Python computation of the same geometry, plus the
   identities between them, the refusals, the catalog record and the page
   contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'pipe-offset-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* pipeoffset-core:start */';
const endMarker = '/* pipeoffset-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PipeOffset;', sandbox);
const C = sandbox.module.exports;

const RAD = Math.PI / 180;
const close = (actual, expected, message, tolerance) => {
  assert.equal(typeof actual, 'number', message + ': a number');
  assert.ok(Math.abs(actual - expected) <= (tolerance || 1e-6),
    message + ': expected ' + expected + ', got ' + actual);
};

// ---- The fixture was produced by an independent Python implementation of the
// same geometry, not by this page, so the two have to agree.
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/pipe_offset_cases.json'), 'utf8'));
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
  assert.equal(got.mode, testCase.input.mode, testCase.name + ': mode');
  assert.equal(got.unit, testCase.input.unit, testCase.name + ': unit');
  close(got.angle, Number(testCase.input.angle), testCase.name + ': angle');
  close(got.trueOffset, testCase.expected.trueOffset, testCase.name + ': true offset');
  close(got.travel, testCase.expected.travel, testCase.name + ': travel');
  close(got.run, testCase.expected.run, testCase.name + ': run');
  close(got.cutLength, testCase.expected.cutLength, testCase.name + ': cut length');
  if (testCase.expected.rollAngle === null) {
    assert.equal(got.rollAngle, null, testCase.name + ': no roll angle on a standard offset');
  } else {
    close(got.rollAngle, testCase.expected.rollAngle, testCase.name + ': roll angle');
  }
}

// ---- The geometry itself: travel is the hypotenuse of the offset and the run,
// so sin and cos of the fitting angle recover the two legs from it.
for (const angle of [1, 22.5, 30, 45, 60, 89]) {
  const got = C.calculate({ mode: 'standard', unit: 'mm', angle: String(angle), offset: '250' });
  const sine = Math.sin(angle * RAD);
  const cosine = Math.cos(angle * RAD);
  close(got.travel, 250 / sine, angle + ' degrees: travel is offset over sine');
  close(got.run, 250 / Math.tan(angle * RAD), angle + ' degrees: run is offset over tangent');
  close(250 / got.travel, sine, angle + ' degrees: offset over travel is the sine');
  close(got.run / got.travel, cosine, angle + ' degrees: run over travel is the cosine');
  close(got.travel * got.travel, 250 * 250 + got.run * got.run, angle + ' degrees: Pythagoras', 1e-6);
  assert.ok(got.travel > got.run, angle + ' degrees: the diagonal is longer than the run');
}

// ---- A rolling offset is the same triangle over the true offset, and the roll
// angle is only a direction: swapping the two legs complements it.
const across = C.calculate({ mode: 'rolling', unit: 'mm', angle: '45', vertical: '300', horizontal: '400' });
const down = C.calculate({ mode: 'rolling', unit: 'mm', angle: '45', vertical: '400', horizontal: '300' });
close(across.trueOffset, 500, 'a 300 by 400 set rolls out at 500');
close(across.trueOffset, Math.hypot(300, 400), 'the true offset is the hypotenuse of the two legs');
close(across.rollAngle + down.rollAngle, 90, 'swapping the legs complements the roll angle');
close(across.travel, down.travel, 'the roll angle does not change the travel');
close(across.travel, 500 * Math.SQRT2, 'a 45 degree travel is the true offset times root two');
assert.ok(Math.abs(across.run - 500) < 1e-9, 'a 45 degree fitting advances the pipe by the true offset');
assert.equal(across.rollAngle, 36.86989764584402, 'the roll angle is measured from the horizontal leg');
assert.equal(down.rollAngle, 53.13010235415598, 'a longer vertical leg rolls the offset up');

// ---- A zero leg gives the axis direction exactly, not a rounding artefact.
assert.equal(C.calculate({ mode: 'rolling', unit: 'mm', angle: '45', vertical: '0', horizontal: '250' }).rollAngle, 0);
assert.equal(C.calculate({ mode: 'rolling', unit: 'mm', angle: '45', vertical: '250', horizontal: '0' }).rollAngle, 90);

// ---- Units are labels, never conversions: the same numbers give the same result.
const millimetres = C.calculate({ mode: 'standard', unit: 'mm', angle: '45', offset: '100' });
const inches = C.calculate({ mode: 'standard', unit: 'in', angle: '45', offset: '100' });
assert.deepEqual(plain(inches.steps.map((step) => step.value)), plain(millimetres.steps.map((step) => step.value)).map((value) => value.replace(' mm', ' in')));

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// ---- Display: three decimals for lengths, trailing zeros dropped, and a
// degree sign that survives as text.
assert.equal(C.show(141.4213562373095, 3), '141.421');
assert.equal(C.show(100, 3), '100');
assert.equal(C.show(0.0004, 3), '0');
assert.equal(C.show(0.0005, 3), '0.001');
assert.equal(C.show(-0.0004, 3), '0');
assert.equal(C.round(2.0005, 3), 2.001);

const standard = C.calculate({ mode: 'standard', unit: 'mm', angle: '45', offset: '100' });
assert.equal(standard.headline, 'Travel 141.421 mm');
assert.equal(standard.subline, '45\u00b0 fitting, standard offset');
assert.equal(standard.steps.length, 3, 'a standard offset shows travel, run and cut length');
assert.deepEqual(plain(standard.steps.map((step) => step.label)), ['Travel', 'Run', 'Cut length']);
assert.equal(standard.steps[0].working, '100 \u00f7 sin 45\u00b0');
assert.equal(standard.steps[2].working, '141.421 \u2212 0 \u2212 0');

const rolling = C.calculate({ mode: 'rolling', unit: 'mm', angle: '45', vertical: '300', horizontal: '400', takeoutA: '16', takeoutB: '16' });
assert.equal(rolling.steps.length, 5, 'a rolling offset adds the true offset and the roll angle');
assert.deepEqual(plain(rolling.steps.map((step) => step.label)), ['True offset', 'Roll angle', 'Travel', 'Run', 'Cut length']);
assert.equal(rolling.steps[0].working, '\u221a(300\u00b2 + 400\u00b2)');
assert.equal(rolling.steps[1].working, 'atan2(300, 400)');
assert.equal(rolling.steps[1].value, '36.87\u00b0');
assert.equal(rolling.steps[4].working, '707.107 \u2212 16 \u2212 16');
assert.equal(rolling.steps[4].value, '675.107 mm');

// ---- Refusals the fixture does not carry: the mode, the unit and the angle.
const refusals = [
  [{ mode: 'diagonal', unit: 'mm', angle: '45', offset: '100' }, 'Choose a standard or a rolling offset.'],
  [{ mode: 'standard', unit: 'furlong', angle: '45', offset: '100' }, 'Choose millimetres or inches.'],
  [{ mode: 'standard', unit: 'mm', angle: '0', offset: '100' }, 'Use a fitting angle between 1 and 89 degrees.'],
  [{ mode: 'standard', unit: 'mm', angle: '90', offset: '100' }, 'Use a fitting angle between 1 and 89 degrees.'],
  [{ mode: 'standard', unit: 'mm', angle: '45', offset: 'Infinity' }, 'Enter an offset as a plain number.']
];
for (const [input, expected] of refusals) {
  assert.throws(() => C.calculate(input), (error) => error.message === expected, expected);
}
// A missing angle falls back to the 45 degree default the select ships with.
close(C.calculate({ mode: 'standard', unit: 'mm', offset: '100' }).angle, 45, 'the angle defaults to 45');

// ---- The catalog record and the cases inside it.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(record.name, 'Pipe Offset Calculator');
assert.equal(record.category, 'Mechanical & Structural Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.listed, true, 'the tool is listed');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 80 && record.description.length < 260, 'description length');
assert.ok(record.tags.includes('pipe') && record.tags.includes('pipefitting') && record.tags.includes('offset'), 'tags');
assert.ok(record.tags.includes('mechanical-and-structural-engineering') || record.tags.includes('mechanical'), 'category tag');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.aliases.length >= 4, 'aliases cover the common searches');
assert.equal(record.sources.length, 0, 'plain trigonometry carries no borrowed standard');
assert.ok(typeof record.method === 'string' && record.method.length > 300, 'the method is recorded');
assert.equal(record.testCases.length, 24, '24 catalog cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 8);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 6);

// The catalog cases and the fixture are the same cases, so a change to one has
// to be made in the other.
assert.deepEqual(plain(record.testCases), plain(fixture.cases), 'catalog cases match the fixture');

for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.throws(() => C.calculate(testCase.input), (error) => error.message === testCase.expectedError, testCase.name);
    continue;
  }
  const got = C.calculate(testCase.input);
  close(got.travel, testCase.expected.travel, testCase.name + ' catalogue travel');
  close(got.cutLength, testCase.expected.cutLength, testCase.name + ' catalogue cut length');
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
assert.ok(html.includes('id="field-vertical" hidden'), 'the rolling fields start hidden');
assert.ok(!html.includes('id="field-offset" hidden'), 'the single offset field starts visible');

const labels = new Set((html.match(/<label\b[^>]*\bfor="([^"]+)"/g) || []).map((tag) => tag.match(/for="([^"]+)"/)[1]));
for (const control of ['mode', 'unit', 'offset', 'vertical', 'horizontal', 'angle', 'takeout-a', 'takeout-b']) {
  assert.ok(labels.has(control), control + ' has a label');
}
for (const button of ['type="submit"', 'type="button" id="reset"']) {
  assert.ok(html.includes(button), button + ' has an explicit type');
}

console.log('pipe offset calculator: fixture, identities, refusals, catalog and page contract green');
