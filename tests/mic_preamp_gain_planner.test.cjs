/* Regression checks for the Mic Preamp Gain Planner: catalog cases, an independent
   level-chain implementation over random inputs, unit conversion and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'mic-preamp-gain-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* mpg-core:start */');
const end = html.indexOf('/* mpg-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + '/* mpg-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MicPreampCore;', sandbox);
const C = sandbox.module.exports;

const record = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'))
  .tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.listed, true, 'the new tool is listed');
assert.equal(record.category, 'Audio', 'filed under Audio');
assert.equal(record.risk, 'low', 'low risk');
assert.ok(Array.isArray(record.sources) && record.sources.length >= 2, 'two sources recorded');
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'source has an https URL');
  assert.ok(source.title.length > 40, 'source title is specific');
}

const run = (input) => C.calculate(input);
const failure = (input) => {
  try {
    C.calculate(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

const kinds = { golden: 0, boundary: 0, validation: 0 };
for (const testCase of record.testCases) {
  kinds[testCase.kind] = (kinds[testCase.kind] || 0) + 1;
  if (testCase.kind === 'validation') {
    const message = failure(testCase.input);
    assert.ok(message, `${testCase.name}: expected a refusal`);
    assert.ok(
      message.includes(testCase.expectedError),
      `${testCase.name}: "${message}" does not mention "${testCase.expectedError}"`
    );
    continue;
  }
  const result = run(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], expected, `${testCase.name}: ${key}`);
  }
  assert.ok(Number.isFinite(result.micVolts) && result.micVolts > 0, `${testCase.name}: positive voltage`);
  assert.ok(result.notes.every((note) => typeof note === 'string' && !/undefined|NaN/.test(note)), `${testCase.name}: clean notes`);
}
assert.equal(kinds.golden, 9, 'nine golden cases');
assert.equal(kinds.boundary, 6, 'six boundary cases');
assert.equal(kinds.validation, 21, 'twenty-one validation cases');
assert.equal(record.testCases.length, 36, 'thirty-six catalog cases');

// ---- Independent implementation: the chain is built from the dBV/Pa figure. ----
const REFERENCE_DBU = -20 * Math.log10(0.775); // 0 dBV is 2.2148 dBu
const round2 = (value) => {
  const scaled = value * 100;
  const rounded = scaled >= 0 ? Math.floor(scaled + 0.5) : -Math.floor(-scaled + 0.5);
  return Object.is(rounded / 100, -0) ? 0 : rounded / 100;
};

function reference(input) {
  const mvPa = input.sensitivityUnit === 'dbv'
    ? 1000 * Math.pow(10, Number(String(input.sensitivity).replace(',', '.')) / 20)
    : Number(String(input.sensitivity).replace(',', '.'));
  const spl = Number(input.spl);
  const gain = Number(input.gain);
  const maxInput = Number(input.maxInput);
  const target = Number(input.target);
  const dbvPa = 20 * Math.log10(mvPa / 1000);
  const micDbu = dbvPa + REFERENCE_DBU + (spl - 94);
  const converterDbfs = micDbu + gain - maxInput;
  const headroomDb = -converterDbfs;
  const status = headroomDb <= 0 ? 'clipping' : headroomDb < 6 ? 'hot' : headroomDb > 40 ? 'quiet' : 'ok';
  return {
    sensitivityMvPa: round2(mvPa),
    sensitivityDbvPa: round2(dbvPa),
    micDbu: round2(micDbu),
    preampDbu: round2(micDbu + gain),
    converterDbfs: round2(converterDbfs),
    headroomDb: round2(headroomDb),
    gainForTargetDb: round2(target + maxInput - micDbu),
    clipSpl: round2(94 + maxInput - gain - dbvPa),
    targetSpl: round2(94 + target + maxInput - gain - dbvPa),
    status
  };
}

let seed = 20261122;
const random = () => {
  seed = (seed * 48271) % 2147483647;
  return seed / 2147483647;
};
const randomInt = (min, max) => min + Math.floor(random() * (max - min + 1));

let randomCases = 0;
for (let round = 0; round < 240; round++) {
  const mvPa = round2(Math.pow(10, -1.3 + random() * 3.6)); // 0.05 .. 200 mV/Pa
  const asDbv = random() < 0.5;
  const sensitivity = asDbv ? round2(20 * Math.log10(mvPa / 1000)).toFixed(2) : mvPa.toFixed(2);
  const input = {
    sensitivity,
    sensitivityUnit: asDbv ? 'dbv' : 'mvpa',
    spl: String(randomInt(20, 180)),
    gain: String(randomInt(0, 80)),
    maxInput: String(randomInt(-20, 30)),
    target: String(randomInt(-40, 0))
  };
  const actual = run(input);
  const expected = reference(input);
  for (const key of ['sensitivityMvPa', 'sensitivityDbvPa', 'micDbu', 'preampDbu', 'converterDbfs',
    'headroomDb', 'gainForTargetDb', 'clipSpl', 'targetSpl']) {
    assert.ok(
      Math.abs(actual[key] - expected[key]) <= 0.011,
      `${JSON.stringify(input)} ${key}: ${actual[key]} vs ${expected[key]}`
    );
  }
  assert.equal(actual.status, expected.status, `${JSON.stringify(input)} status`);
  const volts = (mvPa / 1000) * Math.pow(10, (Number(input.spl) - 94) / 20);
  assert.ok(Math.abs(actual.micVolts - volts) <= Math.abs(volts) * 1e-3, `${JSON.stringify(input)} voltage`);
  randomCases++;
}
assert.equal(randomCases, 240);

// ---- Unit conversion, notation and normalisation ----
assert.equal(run({ sensitivity: '10', sensitivityUnit: 'mvpa', spl: '110', gain: '10', maxInput: '4', target: '-12' }).sensitivityDbvPa, -40);
const dbv = run({ sensitivity: '-40', sensitivityUnit: 'dbv', spl: '110', gain: '10', maxInput: '4', target: '-12' });
assert.equal(dbv.sensitivityMvPa, 10, 'dBV to mV/Pa');
const comma = run({ sensitivity: '3,5', sensitivityUnit: 'mvpa', spl: '100', gain: '20', maxInput: '4', target: '-12' });
const plain = run({ sensitivity: '3.5', sensitivityUnit: 'mvpa', spl: '100', gain: '20', maxInput: '4', target: '-12' });
assert.deepEqual(comma, plain, 'decimal comma equals decimal point');
const exponent = run({ sensitivity: '1e1', sensitivityUnit: 'mvpa', spl: '1.1e2', gain: '10', maxInput: '4', target: '-12' });
assert.equal(exponent.micDbu, -21.79, 'exponent notation accepted');
const spaced = run({ sensitivity: ' 10 ', sensitivityUnit: 'mvpa', spl: ' 110 ', gain: ' 10 ', maxInput: ' 4 ', target: ' -12 ' });
assert.equal(spaced.converterDbfs, -15.79, 'surrounding spaces are trimmed');
const unicodeMinus = run({ sensitivity: '10', sensitivityUnit: 'mvpa', spl: '110', gain: '10', maxInput: '4', target: '\u221212' });
assert.equal(unicodeMinus.converterDbfs, -15.79, 'unicode minus is read as a sign');
const unknownUnit = run({ sensitivity: '10', sensitivityUnit: 'pa', spl: '110', gain: '10', maxInput: '4', target: '-12' });
assert.equal(unknownUnit.sensitivityMvPa, 10, 'an unknown unit falls back to mV/Pa');

// The four status branches, driven from the level rather than copied from the page.
const statusFor = (headroom) => (headroom <= 0 ? 'clipping' : headroom < 6 ? 'hot' : headroom > 40 ? 'quiet' : 'ok');
for (const target of ['-12', '-18', '-24', '-30']) {
  for (const spl of ['85', '100', '115', '130']) {
    const input = { sensitivity: '8', sensitivityUnit: 'mvpa', spl, gain: '36', maxInput: '4', target };
    const actual = run(input).status;
    assert.equal(actual, statusFor(reference(input).headroomDb), `${JSON.stringify(input)} branch`);
  }
}

// Notes are only raised when the numbers call for them.
const needsMoreGain = run({ sensitivity: '0.05', sensitivityUnit: 'mvpa', spl: '40', gain: '0', maxInput: '0', target: '-12' });
assert.ok(needsMoreGain.notes.some((note) => note.includes('more than the 80 dB')), 'out-of-range gain is reported');
const overTarget = run({ sensitivity: '30', sensitivityUnit: 'mvpa', spl: '120', gain: '10', maxInput: '4', target: '-12' });
assert.ok(overTarget.notes.some((note) => note.includes('above the target')), 'negative gain need is reported');
const clean = run({ sensitivity: '10', sensitivityUnit: 'mvpa', spl: '110', gain: '10', maxInput: '4', target: '-12' });
assert.equal(clean.notes.length, 0, 'a comfortable plan needs no note');

// ---- Page contract ----
assert.ok(html.includes('<html lang="en">'));
assert.equal((html.match(/<script/g) || []).length, 4, 'one inline script plus theme, tools.js and app.js');
assert.equal((html.match(/<script(?![^>]*\bsrc=)/g) || []).length, 1, 'exactly one inline script');
assert.ok(!/(?:src|href)="https?:\/\//.test(html), 'no external assets');
for (const forbidden of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'WebSocket', 'indexedDB', 'navigator.sendBeacon']) {
  assert.ok(!html.includes(forbidden), `offline page does not use ${forbidden}`);
}
assert.equal((html.match(/<input\b/g) || []).length, 5, 'five number fields');
assert.equal((html.match(/<select\b/g) || []).length, 1, 'one unit selector');
for (const id of ['sensitivity-input', 'spl-input', 'gain-input', 'max-input-input', 'target-input']) {
  assert.ok(html.includes(`<label for="${id}">`), `label for ${id}`);
}
assert.ok(/role="status" aria-live="polite"/.test(html), 'live status region');
assert.ok(/id="sensitivity-unit" aria-label="Sensitivity unit"/.test(html), 'unit selector is labelled');
assert.ok(html.includes('94 dB SPL') && html.includes('0.775 V'), 'page states both level references');
assert.ok(html.includes('self-noise') && html.includes('signal-to-noise ratio'), 'page states what it does not model');

console.log(`${slug}: ${record.testCases.length} catalog cases, ${randomCases} random chains match the independent level model, conversions and page contract green`);
