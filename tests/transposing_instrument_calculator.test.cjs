/* Regression checks for the transposing instrument core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/transposing-instrument-calculator/index.html'), 'utf8');
const start = html.indexOf('/* transposing-instrument-core:start */');
const end = html.indexOf('/* transposing-instrument-core:end */');
assert.ok(start > -1 && end > start, 'transposing instrument core markers missing');
const core = html.slice(start, end + '/* transposing-instrument-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TransposingInstrumentCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)), `${label}: expected ${expected}, got ${actual}`);
};
const plan = (input) => C.plan(input);

// Bb trumpet: written C4 sounds Bb3, a major 2nd below.
const trumpet = plan({ instrument: 'bb-trumpet', direction: 'written-to-concert', note: '0', octave: '4', spelling: 'flat' });
assert.equal(trumpet.writtenLabel, 'C4');
assert.equal(trumpet.concertLabel, 'B\u266d3');
assert.equal(trumpet.writtenMidi, 60);
assert.equal(trumpet.concertMidi, 58);
assert.equal(trumpet.intervalName, 'major 2nd');
assert.equal(trumpet.intervalText, 'down a major 2nd');
assert.equal(trumpet.intervalSemitones, -2);
near(trumpet.frequency, 233.08188075904496, 'trumpet frequency');
assert.equal(trumpet.chart.length, 12);
assert.equal(trumpet.chart[0].written.label, 'C4');
assert.equal(trumpet.chart[0].written.midi, 60);
assert.equal(trumpet.chart[0].concert.label, 'B\u266d3');
assert.equal(trumpet.chart[0].concert.midi, 58);

// A concert-pitch instrument is a no-op and reports a unison.
const concert = plan({ instrument: 'concert', direction: 'written-to-concert', note: '9', octave: '4', spelling: 'sharp' });
assert.equal(concert.writtenLabel, 'A4');
assert.equal(concert.concertLabel, 'A4');
assert.equal(concert.intervalSemitones, 0);
assert.equal(concert.intervalName, 'unison');
assert.equal(concert.intervalText, 'at written pitch');
near(concert.frequency, 440, 'concert A4 frequency');

// Octave transposition uses the word octave rather than "perfect 8th".
const piccolo = plan({ instrument: 'piccolo', direction: 'written-to-concert', note: '0', octave: '6', spelling: 'sharp' });
assert.equal(piccolo.concertLabel, 'C7');
assert.equal(piccolo.intervalName, 'octave');
assert.equal(piccolo.intervalText, 'up an octave');
near(piccolo.frequency, 2093.004522404789, 'piccolo frequency');

// Compound intervals are named as ninths and thirteenths.
const tenor = plan({ instrument: 'bb-tenor-sax', direction: 'written-to-concert', note: '0', octave: '4', spelling: 'flat' });
assert.equal(tenor.intervalName, 'major 9th');
assert.equal(tenor.intervalText, 'down a major 9th');
const baritone = plan({ instrument: 'eb-baritone-sax', direction: 'written-to-concert', note: '0', octave: '4', spelling: 'flat' });
assert.equal(baritone.intervalName, 'major 13th');
assert.equal(baritone.concertMidi, 39);

// Concert-to-written is the exact inverse for a spelling-safe pair.
const written = plan({ instrument: 'eb-alto-sax', direction: 'concert-to-written', note: '3', octave: '4', spelling: 'flat' });
assert.equal(written.concertLabel, 'E\u266d4');
assert.equal(written.writtenLabel, 'C5');
assert.equal(written.intervalText, 'up a major 6th');

// Spelling follows the chosen side: a written Db on a Bb clarinet sounds Cb, not B.
const flatCase = plan({ instrument: 'bb-clarinet', direction: 'written-to-concert', note: '1', octave: '4', spelling: 'flat' });
assert.equal(flatCase.writtenLabel, 'D\u266d4');
assert.equal(flatCase.concertLabel, 'C\u266d4');
const sharpCase = plan({ instrument: 'bb-clarinet', direction: 'written-to-concert', note: '1', octave: '4', spelling: 'sharp' });
assert.equal(sharpCase.writtenLabel, 'C\u266f4');
assert.equal(sharpCase.concertLabel, 'B3');

// Every instrument transposition is an interval whose name matches its semitone count.
for (const instrument of C.INSTRUMENTS) {
  const info = C.intervalInfo(instrument.letters, instrument.semitones);
  assert.equal(info.semitones, instrument.semitones, instrument.id + ' semitones');
  assert.ok(info.text.length > 0, instrument.id + ' interval text');
  if (instrument.semitones === 0) assert.equal(info.text, 'at written pitch');
}

// Chart rows are in chromatic order and stay inside the MIDI range.
for (const spelling of ['sharp', 'flat']) {
  const table = plan({ instrument: 'f-horn', direction: 'written-to-concert', note: '0', octave: '4', spelling });
  for (let i = 1; i < table.chart.length; i += 1) {
    assert.equal(table.chart[i].written.midi - table.chart[i - 1].written.midi, 1, 'chart is chromatic');
    assert.ok(table.chart[i].written.midi >= 0 && table.chart[i].written.midi <= 127, 'chart inside MIDI range');
  }
}

// Out-of-range octave for the target side is rejected, not wrapped.
assert.throws(
  () => plan({ instrument: 'piccolo', direction: 'concert-to-written', note: '0', octave: '-1', spelling: 'sharp' }),
  /The transposed pitch lies outside the supported range \(C-1 to G9\)\./
);

// Validation rejects non-integer pitch classes and whitespace-only octaves.
assert.throws(() => plan({ instrument: 'bb-trumpet', direction: 'written-to-concert', note: '1.5', octave: '4', spelling: 'sharp' }), /Choose a note to transpose\./);
assert.throws(() => plan({ instrument: 'bb-trumpet', direction: 'written-to-concert', note: '0', octave: '  ', spelling: 'sharp' }), /Written octave is required\./);
assert.throws(() => plan({ instrument: 'bb-trumpet', direction: 'written-to-concert', note: '0', octave: '1e2', spelling: 'sharp' }), /Written octave must be a whole number from -1 to 9\./);

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'transposing-instrument-calculator');
assert.ok(record, 'catalog entry present');
assert.ok(record.testCases.length >= 12, 'catalog has the full test case set');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.plan(testCase.input), new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), testCase.name);
    continue;
  }
  const result = C.plan(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number' && key === 'frequency') near(result[key], value, testCase.name + ' ' + key);
    else assert.equal(result[key], value, testCase.name + ' ' + key);
  }
}

console.log('transposing instrument core: all checks passed (' + record.testCases.length + ' catalog cases)');
