/* Regression checks for the string tension core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/string-tension-calculator/index.html'), 'utf8');
const start = html.indexOf('/* string-core:start */');
const end = html.indexOf('/* string-core:end */');
assert.ok(start > -1 && end > start, 'string core markers missing');
const core = html.slice(start, end + '/* string-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = StringCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const analyse = (options) => C.analyse(options);

// Defaults: a 0.010-ish plain-steel string at E4 over a 25.5 in scale pulls 16.31 lb.
const standard = analyse({});
assert.equal(standard.note, 'E');
assert.equal(standard.octave, 4);
assert.equal(standard.midi, 64);
near(standard.frequency, 329.6275569128699, 'default frequency');
near(standard.scaleLength, 25.5, 'default scale');
near(standard.unitWeight, 0.398, 'default unit weight');
near(standard.tensionN, 72.56678470645948, 'default newtons');
near(standard.tensionLb, 16.313662174, 'default pounds');
near(standard.tensionKg, 7.3997526889, 'default kilograms');
near(standard.equivalentGauge, 0.010002948903244433, 'default equivalent gauge');

// A4 at 440 Hz is the tuning anchor.
const anchor = analyse({ note: 'A', octave: '4' });
near(anchor.frequency, 440, 'A4 frequency');
near(anchor.tensionLb, 29.067641438, 'A4 pounds');

// Tension grows with the square of the scale length.
const longScale = analyse({ scaleLength: '27' });
near(longScale.tensionLb, 18.2893652055, '27 in pounds');

// A heavier string tuned two octaves down carries less tension than the treble string.
const bass = analyse({ note: 'E', octave: '2', unitWeight: '5.2' });
near(bass.frequency, 82.4068892282, 'E2 frequency');
near(bass.tensionLb, 13.3214578054, 'E2 pounds');

// Both limits are inclusive.
const upper = analyse({ scaleLength: '40', note: 'B', octave: '8', unitWeight: '30' });
near(upper.tensionLb, 1738885.1393393695, 'upper pounds');
const lower = analyse({ scaleLength: '8', note: 'C', octave: '0', unitWeight: '0.02' });
near(lower.tensionLb, 0.00019855067700984668, 'lower pounds');

// The gauge table covers 0.008 to 0.026 in plain steel.
assert.equal(standard.gauges.length, 14);
near(standard.gauges[0].gauge, 0.008, 'first gauge');
near(standard.gauges[0].unitWeight, 0.25456983749858286, 'first unit weight');
near(standard.gauges[0].tensionLb, 10.434588765446048, 'first tension');
near(standard.gauges[2].gauge, 0.010, 'third gauge');
near(standard.gauges[2].unitWeight, 0.39776537109153565, 'third unit weight');
near(standard.gauges[2].tensionLb, 16.304044946009444, 'third tension');
near(standard.gauges[13].gauge, 0.026, 'last gauge');
near(standard.gauges[13].unitWeight, 2.688893908578781, 'last unit weight');
near(standard.gauges[13].tensionLb, 110.21534383502386, 'last tension');

// The table follows the selected pitch and scale.
const tableAtA = analyse({ note: 'A', octave: '4', scaleLength: '27' });
near(tableAtA.gauges[2].tensionLb, 32.568732793774004, 'table follows pitch and scale');

// Parsing and validation rejections.
assert.throws(() => analyse({ scaleLength: '' }), /Scale length is required\./);
assert.throws(() => analyse({ scaleLength: 'abc' }), /Scale length must be a number between 8 and 40 inches\./);
assert.throws(() => analyse({ scaleLength: '7.9' }), /Scale length must be between 8 and 40 inches\./);
assert.throws(() => analyse({ scaleLength: '41' }), /Scale length must be between 8 and 40 inches\./);
assert.throws(() => analyse({ unitWeight: '' }), /Unit weight is required\./);
assert.throws(() => analyse({ unitWeight: 'thirty' }), /Unit weight must be a number between 0\.02 and 30 g\/m\./);
assert.throws(() => analyse({ unitWeight: '0' }), /Unit weight must be between 0\.02 and 30 g\/m\./);
assert.throws(() => analyse({ unitWeight: '31' }), /Unit weight must be between 0\.02 and 30 g\/m\./);
assert.throws(() => analyse({ note: 'H' }), /Pitch must be a note name such as C, F# or B\./);
assert.throws(() => analyse({ octave: '9' }), /Octave must be a whole number from 0 to 8\./);
assert.throws(() => analyse({ octave: '4.5' }), /Octave must be a whole number from 0 to 8\./);

// Replay every canonical catalog test case against the core.
const compare = (actual, expected, label) => {
  if (typeof expected === 'number') {
    near(actual, expected, label);
    return;
  }
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, `${label} length`);
    expected.forEach((item, index) => compare(actual[index], item, `${label}[${index}]`));
    return;
  }
  if (expected && typeof expected === 'object') {
    for (const key of Object.keys(expected)) compare(actual[key], expected[key], `${label}.${key}`);
    return;
  }
  assert.equal(actual, expected, label);
};

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'string-tension-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Music');
assert.equal(record.risk, 'low');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 14, 'catalog has the full test case set');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => analyse(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  compare(analyse(testCase.input), testCase.expected, testCase.name);
}

console.log('string-tension-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
