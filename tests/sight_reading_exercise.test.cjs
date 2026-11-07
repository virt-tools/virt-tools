/* Regression checks for the deterministic sight-reading exercise core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/sight-reading-exercise/index.html'), 'utf8');
const startMarker = '/* sight-reading-core:start */';
const endMarker = '/* sight-reading-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'sight-reading core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = SightReadingCore;', sandbox);
const C = sandbox.module.exports;

const standard = C.generate({});
assert.equal(standard.sequence, 'C5 E5 D5 F5 D5 F5 C5 B4');
assert.equal(standard.clefLabel, 'Treble');
assert.equal(standard.measureCount, 2);
assert.equal(standard.noteCount, 8);
assert.equal(standard.minimum, 'C4');
assert.equal(standard.maximum, 'A5');
assert.deepEqual(Array.from(standard.bars, (bar) => bar.length), [4, 4]);
assert.equal(C.generate({}).sequence, standard.sequence, 'defaults must be repeatable');
assert.equal(C.generate({seed: ' daily-scale '}).sequence, standard.sequence, 'seed is trimmed');
assert.match(C.answerKey(standard), /Sight-reading exercise — Treble clef/);
assert.match(C.answerKey(standard), /Measure 1: C5 E5 D5 F5/);
assert.match(C.answerKey(standard), /Measure 2: D5 F5 C5 B4/);

// Enumerate clefs, ranges, motions and measure bounds with independent note checks.
const ranges = {
  'treble-staff': ['E4', 'F5'],
  'treble-extended': ['C4', 'A5'],
  'bass-staff': ['G2', 'A3'],
  'bass-extended': ['E2', 'C4']
};
const allowedDeltas = {
  steps: [1],
  mixed: [1, 2, 3],
  leaps: [2, 3, 4]
};
let enumerated = 0;
let notesChecked = 0;
const sequences = new Set();
for (const clef of ['treble', 'bass']) {
  for (const range of ['staff', 'extended']) {
    const [minimumName, maximumName] = ranges[`${clef}-${range}`];
    const minimum = C.absolute(minimumName);
    const maximum = C.absolute(maximumName);
    for (const motion of ['steps', 'mixed', 'leaps']) {
      for (let measures = 1; measures <= 8; measures++) {
        for (let variant = 0; variant < 12; variant++) {
          const input = {clef, range, motion, measures: String(measures), seed: `case-${variant}`};
          const result = C.generate(input);
          assert.equal(result.measureCount, measures);
          assert.equal(result.noteCount, measures * 4);
          assert.equal(result.bars.length, measures);
          assert.equal(result.minimum, minimumName);
          assert.equal(result.maximum, maximumName);
          assert.equal(C.generate(input).sequence, result.sequence, 'same input must reproduce the exercise');
          sequences.add(`${clef}|${range}|${motion}|${measures}|${result.sequence}`);
          result.notes.forEach((note, index) => {
            assert.match(note.name, /^[A-G]\d$/, 'only natural notes are generated');
            assert.ok(note.index >= minimum && note.index <= maximum, `${note.name} outside ${minimumName}-${maximumName}`);
            assert.equal(note.measure, Math.floor(index / 4) + 1);
            assert.equal(note.beat, index % 4 + 1);
            if (index > 0) {
              const delta = Math.abs(note.index - result.notes[index - 1].index);
              assert.ok(allowedDeltas[motion].includes(delta), `${motion} produced a ${delta}-position move`);
            }
            notesChecked++;
          });
          result.bars.forEach((bar, barIndex) => {
            assert.equal(bar.length, 4);
            assert.equal(bar[0].measure, barIndex + 1);
            assert.equal(bar[3].beat, 4);
          });
          enumerated++;
        }
      }
    }
  }
}
assert.equal(enumerated, 1152);
assert.ok(sequences.size > 1000, 'seeds and settings must produce varied exercises');
assert.notEqual(C.generate({seed: 'another-seed'}).sequence, standard.sequence);

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'sight-reading-exercise');
assert.equal(records.length, 1, 'catalog must contain exactly one sight-reading exercise');
const record = records[0];
assert.equal(record.name, 'Sight Reading Exercise Generator');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Practice');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('Note Reading Practice'));
assert.ok(record.testCases.length >= 14, 'catalog carries golden and validation checks');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.generate(testCase.input), (error) => error.message === testCase.expected.error, testCase.name);
    continue;
  }
  assert.equal(testCase.kind, 'golden', testCase.name);
  const result = C.generate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) assert.equal(result[key], expected, `${testCase.name}: ${key}`);
}

console.log(`sight-reading-exercise: all checks passed (${record.testCases.length} catalog cases, ${enumerated} exercises and ${notesChecked} notes)`);
