/* Regression checks for the guitar capo core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/guitar-capo-key-calculator/index.html'), 'utf8');
const start = html.indexOf('/* guitar-capo-core:start */');
const end = html.indexOf('/* guitar-capo-core:end */');
assert.ok(start > -1 && end > start, 'capo core markers missing');
const core = html.slice(start, end + '/* guitar-capo-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = GuitarCapoCore;', sandbox);
const C = sandbox.module.exports;
const run = (input) => C.calculate(input);

const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
const OPEN_ROOTS = { major: ['C', 'G', 'D', 'A', 'E'], minor: ['A', 'E', 'D'] };
const KEY_PC = {
  major: { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 },
  minor: { C: 0, 'C#': 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, Bb: 10, B: 11 },
};

function parseChord(name) {
  const match = /^([A-G])(#{1,2}|b{1,2})?(dim|m)?$/.exec(name);
  assert.ok(match, 'unparseable chord name: ' + name);
  const letter = match[1];
  const accidental = match[2] || '';
  const suffix = match[3] || '';
  let shift = 0;
  for (const mark of accidental) shift += mark === '#' ? 1 : -1;
  return { letter, suffix, pc: (NOTE_PC[letter] + shift + 24) % 12 };
}

// Defaults: capo 2 on the A major key gives G shapes that sound as A chords.
assert.deepEqual(JSON.parse(JSON.stringify(run({}))), {
  capo: 2, mode: 'major', key: 'A', shapeKey: 'G',
  soundingLabel: 'A major', shapeLabel: 'G major',
  shapeChords: 'G Am Bm C D Em F#dim',
  soundingChords: 'A Bm C#m D E F#m G#dim',
  chords: [
    { degree: 1, roman: 'I', shape: 'G', sounding: 'A', quality: 'major' },
    { degree: 2, roman: 'ii', shape: 'Am', sounding: 'Bm', quality: 'minor' },
    { degree: 3, roman: 'iii', shape: 'Bm', sounding: 'C#m', quality: 'minor' },
    { degree: 4, roman: 'IV', shape: 'C', sounding: 'D', quality: 'major' },
    { degree: 5, roman: 'V', shape: 'D', sounding: 'E', quality: 'major' },
    { degree: 6, roman: 'vi', shape: 'Em', sounding: 'F#m', quality: 'minor' },
    { degree: 7, roman: 'vii\u00b0', shape: 'F#dim', sounding: 'G#dim', quality: 'diminished' },
  ],
  openOptions: [
    { capo: 0, shapeKey: 'A', shapeLabel: 'A major' },
    { capo: 2, shapeKey: 'G', shapeLabel: 'G major' },
    { capo: 5, shapeKey: 'E', shapeLabel: 'E major' },
    { capo: 7, shapeKey: 'D', shapeLabel: 'D major' },
    { capo: 9, shapeKey: 'C', shapeLabel: 'C major' },
  ],
});

// Named cases checked against music theory by hand.
const named = [
  ['C major without a capo', { capo: 0, key: 'C', mode: 'major' }, 'C', 'C major', 'C Dm Em F G Am Bdim'],
  ['A shapes with a capo on fret 3 sound in C major', { capo: 3, key: 'C', mode: 'major' }, 'A', 'A major', 'A Bm C#m D E F#m G#dim'],
  ['B minor shapes with a capo on fret 5 sound in E minor', { capo: 5, key: 'E', mode: 'minor' }, 'B', 'B minor', 'Bm C#dim D Em F#m G A'],
  ['E shapes with a capo on fret 7 sound in B major', { capo: 7, key: 'B', mode: 'major' }, 'E', 'E major', 'E F#m G#m A B C#m D#dim'],
  ['F minor shapes with a capo on fret 1 sound in F# minor', { capo: 1, key: 'F#', mode: 'minor' }, 'F', 'F minor', 'Fm Gdim Ab Bbm Cm Db Eb'],
  ['A capo on fret 12 keeps the same key an octave up', { capo: 12, key: 'D', mode: 'major' }, 'D', 'D major', 'D Em F#m G A Bm C#dim'],
  ['E shapes with a capo on fret 4 sound in Ab major', { capo: 4, key: 'Ab', mode: 'major' }, 'E', 'E major', 'E F#m G#m A B C#m D#dim'],
  ['C# minor shapes with a capo on fret 2 sound in Eb minor', { capo: 2, key: 'Eb', mode: 'minor' }, 'C#', 'C# minor', 'C#m D#dim E F#m G#m A B'],
  ['A capo on fret 9 with Eb shapes returns to C major', { capo: 9, key: 'C', mode: 'major' }, 'Eb', 'Eb major', 'Eb Fm Gm Ab Bb Cm Ddim'],
  ['Eb shapes with a capo on fret 2 sound in F major', { capo: 2, key: 'F', mode: 'major' }, 'Eb', 'Eb major', 'Eb Fm Gm Ab Bb Cm Ddim'],
];
for (const [name, input, shapeKey, shapeLabel, shapeChords] of named) {
  const result = run(input);
  assert.equal(result.shapeKey, shapeKey, name);
  assert.equal(result.shapeLabel, shapeLabel, name);
  assert.equal(result.shapeChords, shapeChords, name);
  assert.equal(result.capo, Number(input.capo), name);
}

// Every key and capo: the sounding pitch class is the shape pitch class shifted by the capo.
for (const mode of ['major', 'minor']) {
  const steps = mode === 'major' ? MAJOR_STEPS : MINOR_STEPS;
  for (const keyName of Object.keys(KEY_PC[mode])) {
    const keyPc = KEY_PC[mode][keyName];
    for (let capo = 0; capo <= 12; capo += 1) {
      const result = run({ capo, key: keyName, mode });
      const label = keyName + ' ' + mode;
      assert.equal(result.capo, capo, label);
      assert.equal(result.soundingLabel, label, label);
      const shapePc = (keyPc - capo + 120) % 12;
      assert.equal(KEY_PC[mode][result.shapeKey], shapePc, label + ' shape key at capo ' + capo);
      assert.equal(result.chords.length, 7, label + ' chord count');
      const shapeLetters = [];
      const soundingLetters = [];
      result.chords.forEach((chord, degree) => {
        const shapeChord = parseChord(chord.shape);
        const soundingChord = parseChord(chord.sounding);
        assert.equal(shapeChord.pc, (shapePc + steps[degree]) % 12, label + ' ' + chord.roman + ' shape root');
        assert.equal(soundingChord.pc, (keyPc + steps[degree]) % 12, label + ' ' + chord.roman + ' sounding root');
        assert.equal(shapeChord.suffix, soundingChord.suffix, label + ' ' + chord.roman + ' keeps its quality');
        assert.equal(chord.quality, { '': 'major', m: 'minor', dim: 'diminished' }[shapeChord.suffix], label + ' ' + chord.roman + ' quality');
        shapeLetters.push(shapeChord.letter);
        soundingLetters.push(soundingChord.letter);
      });
      // Chord roots climb the letters in order, so a key is spelled without repeating a letter.
      const LETTER_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
      for (let index = 1; index < 7; index += 1) {
        assert.equal((LETTER_INDEX[shapeLetters[index]] - LETTER_INDEX[shapeLetters[index - 1]] + 7) % 7, 1, label + ' shape letters');
        assert.equal((LETTER_INDEX[soundingLetters[index]] - LETTER_INDEX[soundingLetters[index - 1]] + 7) % 7, 1, label + ' sounding letters');
      }
      // Open-chord options are exactly the capos 0-9 whose shape root is a familiar open key.
      const expectedOpen = [];
      for (let fret = 0; fret <= 9; fret += 1) {
        const pc = (keyPc - fret + 120) % 12;
        const root = Object.keys(KEY_PC[mode]).find((candidate) => KEY_PC[mode][candidate] === pc);
        if (OPEN_ROOTS[mode].includes(root)) expectedOpen.push(root);
      }
      assert.equal(result.openOptions.map((option) => option.shapeKey).join(','), expectedOpen.join(','), label + ' open options');
      for (const option of result.openOptions) {
        assert.equal(option.capo >= 0 && option.capo <= 9, true, label + ' option range');
        assert.equal(KEY_PC[mode][option.shapeKey], (keyPc - option.capo + 120) % 12, label + ' option arithmetic');
      }
    }
  }
}

// Inputs are trimmed and case-insensitive, but every bad value names its field.
assert.equal(run({ capo: ' 3 ', key: ' g ', mode: 'MAJOR' }).capo, 3);
assert.equal(run({ capo: ' 3 ', key: ' g ', mode: 'MAJOR' }).shapeKey, 'E');
assert.throws(() => run({ capo: '' }), /Capo fret is required\./);
assert.throws(() => run({ capo: 'two' }), /Capo fret must be a whole number from 0 to 12\./);
assert.throws(() => run({ capo: '-1' }), /Capo fret must be a whole number from 0 to 12\./);
assert.throws(() => run({ capo: '13' }), /Capo fret must be a whole number from 0 to 12\./);
assert.throws(() => run({ capo: '2.5' }), /Capo fret must be a whole number from 0 to 12\./);
assert.throws(() => run({ capo: '2a' }), /Capo fret must be a whole number from 0 to 12\./);
assert.throws(() => run({ key: 'H' }), /Choose a key from the list\./);
assert.throws(() => run({ key: '' }), /Choose a key from the list\./);
assert.throws(() => run({ key: 'Db', mode: 'minor' }), /Choose a key from the list\./);
assert.throws(() => run({ mode: 'dorian' }), /Choose major or minor\./);
assert.throws(() => run({ mode: '' }), /Choose major or minor\./);

// The page must not reach the network, store data or use inline handlers.
const withoutNamespaces = html
  .replace(/https:\/\/virt\.tools[^"]*/g, '')
  .replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
assert.ok(!/https?:\/\//.test(withoutNamespaces), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'guitar-capo-key-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.category, 'Music');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 20, 'catalog has the full test case set');
assert.ok(record.method.includes('browser'), 'method documents local execution');
for (const testCase of record.testCases) {
  const options = { ...C.DEFAULTS, ...testCase.input };
  if (testCase.kind === 'validation') {
    assert.throws(
      () => C.calculate(options),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = C.calculate(options);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(JSON.parse(JSON.stringify(result[key])), value, testCase.name + ' ' + key);
  }
}

console.log('guitar capo core: all checks passed');
