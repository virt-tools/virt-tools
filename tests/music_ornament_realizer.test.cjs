/* Regression checks for the music ornament realization core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/music-ornament-realizer/index.html'), 'utf8');
const startMarker = '/* music-ornament-core:start */';
const endMarker = '/* music-ornament-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'music ornament core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = MusicOrnamentCore;', sandbox);
const C = sandbox.module.exports;

function expectSequence(input, expected) {
  const result = C.calculate(input);
  assert.equal(result.sequence, expected);
  assert.equal(result.noteCount, expected.split(' – ').length);
  assert.ok(result.realization.endsWith(': ' + expected));
  return result;
}

expectSequence({}, 'E5 – D5 – C5 – D5');
expectSequence({note: 'D5', key: 'C', ornament: 'inverted-turn'}, 'C5 – D5 – E5 – D5');
expectSequence({note: 'D5', key: 'C', ornament: 'upper-mordent'}, 'D5 – E5 – D5');
expectSequence({note: 'D5', key: 'C', ornament: 'lower-mordent'}, 'D5 – C5 – D5');
expectSequence({note: 'D5', key: 'C', ornament: 'trill-main', cycles: 2}, 'D5 – E5 – D5 – E5 – D5');
expectSequence({note: 'D5', key: 'C', ornament: 'trill-upper', cycles: 2}, 'E5 – D5 – E5 – D5');
expectSequence({note: 'F4', key: 'G', ornament: 'upper-mordent'}, 'F#4 – G4 – F#4');
expectSequence({note: 'Fn4', key: 'G', ornament: 'upper-mordent'}, 'F4 – G4 – F4');
expectSequence({note: 'C4', key: 'F', ornament: 'lower-mordent'}, 'C4 – Bb3 – C4');
expectSequence({note: 'B4', key: 'C', ornament: 'turn'}, 'C5 – B4 – A4 – B4');
expectSequence({note: 'E5', key: 'F#', ornament: 'inverted-turn'}, 'D#5 – E#5 – F#5 – E#5');
expectSequence({note: 'B♭3', key: 'C', ornament: 'upper-mordent'}, 'Bb3 – C4 – Bb3');

const ornaments = ['turn', 'inverted-turn', 'trill-main', 'trill-upper', 'upper-mordent', 'lower-mordent'];
const keys = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
let exhaustiveCases = 0;
for (const key of keys) {
  for (const letter of letters) {
    for (let octave = 0; octave <= 8; octave += 1) {
      for (const ornament of ornaments) {
        for (let cycles = 1; cycles <= 8; cycles += 1) {
          const result = C.calculate({note: letter + octave, key, ornament, cycles});
          const notes = result.sequence.split(' – ');
          assert.equal(notes.length, result.noteCount);
          assert.ok(notes.every((name) => /^[A-G](?:#|b)?-?\d$/.test(name)), result.sequence);
          assert.equal(notes[notes.length - 1], result.main, `${key} ${letter}${octave} ${ornament}`);
          if (ornament === 'trill-main') assert.equal(result.noteCount, cycles * 2 + 1);
          else if (ornament === 'trill-upper') assert.equal(result.noteCount, cycles * 2);
          else if (ornament.includes('mordent')) assert.equal(result.noteCount, 3);
          else assert.equal(result.noteCount, 4);
          exhaustiveCases += 1;
        }
      }
    }
  }
}
assert.equal(exhaustiveCases, 45360);

const invalid = [
  [{note: ''}, 'Written note must be a letter, optional #, b or n, and an octave from -1 to 9 (for example C#4).'],
  [{note: 'H4'}, 'Written note must be a letter, optional #, b or n, and an octave from -1 to 9 (for example C#4).'],
  [{note: 'C##4'}, 'Written note must be a letter, optional #, b or n, and an octave from -1 to 9 (for example C#4).'],
  [{note: 'C10'}, 'Written note must be a letter, optional #, b or n, and an octave from -1 to 9 (for example C#4).'],
  [{key: 'C-minor'}, 'Choose a supported major-key signature.'],
  [{ornament: 'grace-note'}, 'Choose a supported ornament.'],
  [{ornament: 'trill-main', cycles: '0'}, 'Trill alternations must be a whole number from 1 to 8.'],
  [{ornament: 'trill-main', cycles: '2.5'}, 'Trill alternations must be a whole number from 1 to 8.'],
  [{note: 'B9', ornament: 'upper-mordent'}, 'Ornament neighbour octave must stay between -1 and 9.'],
  [{note: 'C-1', ornament: 'lower-mordent'}, 'Ornament neighbour octave must stay between -1 and 9.']
];
for (const [input, message] of invalid) {
  assert.throws(() => C.calculate(input), (error) => error.message === message, message);
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'music-ornament-realizer');
assert.equal(records.length, 1, 'catalog must contain exactly one music ornament realizer');
const record = records[0];
assert.equal(record.name, 'Music Ornament Realizer');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Reference');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('Trill Note Calculator'));
assert.ok(record.testCases.length >= 12, 'catalog carries ornament and validation checks');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.calculate(testCase.input), (error) => error.message === testCase.expected.error, testCase.name);
    continue;
  }
  assert.equal(testCase.kind, 'golden', testCase.name);
  const result = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) assert.equal(result[key], expected, `${testCase.name}: ${key}`);
}

console.log(`music-ornament-realizer: all checks passed (${record.testCases.length} catalog cases, ${exhaustiveCases} exhaustive key/note/ornament cases)`);
