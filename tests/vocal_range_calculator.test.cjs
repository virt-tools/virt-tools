/* Regression checks for the vocal range core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/vocal-range-calculator/index.html'), 'utf8');
const start = html.indexOf('/* vocal-range-core:start */');
const end = html.indexOf('/* vocal-range-core:end */');
assert.ok(start > -1 && end > start, 'vocal range core markers missing');
const core = html.slice(start, end + '/* vocal-range-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = VocalRangeCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const analyse = (low, high) => C.analyse({ low, high });

// The default C3 to G4 is 19 semitones and fits the baritone and tenor references.
const standard = analyse('C3', 'G4');
assert.equal(standard.lowName, 'C3');
assert.equal(standard.highName, 'G4');
assert.equal(standard.lowMidi, 48);
assert.equal(standard.highMidi, 67);
assert.equal(standard.semitones, 19);
assert.equal(standard.octaves, 1);
assert.equal(standard.remainder, 7);
assert.equal(standard.containingText, 'Baritone, Tenor');
assert.equal(standard.narrowest, 'Tenor');
assert.equal(standard.types.length, 6);
near(standard.lowFreq, 130.8127826502993, 'C3 frequency');
near(standard.highFreq, 391.99543598174927, 'G4 frequency');
near(standard.ratio, 2 ** (19 / 12), 'frequency ratio');

// Reference tuning anchors: A4 is 440 Hz and middle C is 261.6255653 Hz.
near(analyse('A3', 'A4').highFreq, 440, 'A4 reference');
near(analyse('C4', 'C5').lowFreq, 261.6255653005986, 'middle C frequency');
near(analyse('A3', 'A4').ratio, 2, 'one octave doubles the frequency');

// A bass range is contained by the bass reference only; the baritone still overlaps.
const bass = analyse('E2', 'E4');
assert.equal(bass.semitones, 24);
assert.equal(bass.remainder, 0);
assert.equal(bass.containingText, 'Bass');
assert.equal(bass.narrowest, 'Bass');
assert.equal(bass.types[1].name, 'Baritone');
assert.equal(bass.types[1].fit, 'overlaps');
assert.equal(bass.types[5].fit, 'overlaps');

// A narrow range can sit inside several references; the narrowest span wins.
const narrow = analyse('A3', 'C4');
assert.equal(narrow.semitones, 3);
assert.equal(narrow.containingText, 'Bass, Baritone, Tenor, Alto, Mezzo-soprano');
assert.equal(narrow.narrowest, 'Tenor');

// No single reference contains a very wide range.
const wide = analyse('F2', 'A5');
assert.equal(wide.semitones, 40);
assert.equal(wide.containingText, '');
assert.equal(wide.narrowest, '');
assert.equal(wide.overlappingText, 'Bass, Baritone, Tenor, Alto, Mezzo-soprano, Soprano');

// Accidentals wrap across octaves and preserve the entered spelling.
const enharmonic = analyse('Cb4', 'B#4');
assert.equal(enharmonic.lowName, 'Cb4');
assert.equal(enharmonic.lowMidi, 59);
assert.equal(enharmonic.highName, 'B#4');
assert.equal(enharmonic.highMidi, 72);
assert.equal(enharmonic.semitones, 13);
const unicode = analyse('F\u266f2', 'F\u266f5');
assert.equal(unicode.lowName, 'F#2');
assert.equal(unicode.highName, 'F#5');
assert.equal(unicode.semitones, 36);
const flat = analyse('B\u266d2', 'F4');
assert.equal(flat.lowName, 'Bb2');
assert.equal(flat.containingText, 'Baritone');

// The full accepted span of scientific pitch notation.
const extremes = analyse('C0', 'B8');
assert.equal(extremes.lowMidi, 12);
assert.equal(extremes.highMidi, 119);
assert.equal(extremes.semitones, 107);
assert.equal(extremes.octaves, 8);
assert.equal(extremes.remainder, 11);
near(extremes.lowFreq, 16.351597831287414, 'C0 frequency');

// Parsing and range rejections.
assert.throws(() => analyse('', 'G4'), /Lowest note is required\./);
assert.throws(() => analyse('   ', 'G4'), /Lowest note is required\./);
assert.throws(() => analyse('C3', ''), /Highest note is required\./);
assert.throws(() => analyse('H2', 'G4'), /Lowest note must look like E2, F#3 or Bb4\./);
assert.throws(() => analyse('C', 'G4'), /Lowest note must look like E2, F#3 or Bb4\./);
assert.throws(() => analyse('C3', 'C10'), /Highest note must look like E2, F#3 or Bb4\./);
assert.throws(() => analyse('C 3', 'G4'), /Lowest note must look like E2, F#3 or Bb4\./);
assert.throws(() => analyse('C-1', 'G4'), /Lowest note must look like E2, F#3 or Bb4\./);
assert.throws(() => analyse('C3', 'C9'), /Highest note must be between C0 and B8\./);
assert.throws(() => analyse('C4', 'C4'), /Highest note must be above the lowest note\./);
assert.throws(() => analyse('A4', 'C4'), /Highest note must be above the lowest note\./);
assert.throws(() => C.analyse(), /Lowest note is required\./);

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'vocal-range-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Music');
assert.equal(record.risk, 'low');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 24, 'catalog has the full test case set');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(
      () => analyse(testCase.input.low, testCase.input.high),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = analyse(testCase.input.low, testCase.input.high);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') near(result[key], value, testCase.name + ' ' + key);
    else assert.equal(result[key], value, testCase.name + ' ' + key);
  }
}

console.log('vocal-range-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
