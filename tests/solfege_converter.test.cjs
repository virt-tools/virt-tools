/* Regression checks for the solfège converter core, its catalog cases, and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'solfege-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* solfege-core:start */');
const end = html.indexOf('/* solfege-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + '/* solfege-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SolfegeCore;', sandbox);
const T = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(T.convert(input));
const shape = (result) => ({
  keyName: result.keyName,
  count: result.count,
  notes: result.tokens.map((token) => token.note).join(' '),
  syllables: result.tokens.map((token) => token.syllable).join(' '),
  degrees: result.tokens.map((token) => token.degree).join(' '),
  semitones: result.tokens.map((token) => token.semitone).join(' ')
});
const failure = (input) => {
  try {
    T.convert(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
const input = (system, key, direction, text) => ({ system, key, direction, text });

// Independent pitch-class helper, deliberately not taken from the page core.
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function pitchClass(note) {
  const match = /^([A-G])([#b]?)$/.exec(note);
  assert.ok(match, 'note name ' + note);
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return (LETTER_PC[match[1]] + accidental + 12) % 12;
}

// Documented surface.
assert.deepEqual(Object.keys(T.SYSTEMS), ['movable', 'minor', 'fixed']);
assert.equal(T.KEYS.length, 18);
assert.deepEqual(plain(T.keysFor('fixed')), ['C']);
assert.equal(T.keysFor('movable').length, 15, 'major keys');
assert.equal(T.keysFor('minor').length, 15, 'minor keys');
for (const unsupported of ['G#', 'D#', 'A#']) {
  assert.ok(!T.keysFor('movable').includes(unsupported), unsupported + ' major needs a double sharp');
  assert.ok(T.keysFor('minor').includes(unsupported), unsupported + ' minor is spellable');
}
for (const unsupported of ['Db', 'Gb', 'Cb']) {
  assert.ok(!T.keysFor('minor').includes(unsupported), unsupported + ' minor has no spellable relative major');
}

// Movable do in D major.
const dScale = run(input('movable', 'D', 'toNotes', 'do re mi fa sol la ti do'));
assert.equal(dScale.keyName, 'D major');
assert.equal(dScale.mode, 'major');
assert.equal(dScale.count, 8);
assert.equal(shape(dScale).notes, 'D E F# G A B C# D');
assert.equal(shape(dScale).syllables, 'do re mi fa sol la ti do');
assert.equal(shape(dScale).degrees, '1 2 3 4 5 6 7 1');
assert.equal(shape(dScale).semitones, '0 2 4 5 7 9 11 0');
assert.deepEqual(dScale.tokens[0], { input: 'do', syllable: 'do', note: 'D', degree: '1', semitone: 0 });
assert.deepEqual(dScale.tokens[6], { input: 'ti', syllable: 'ti', note: 'C#', degree: '7', semitone: 11 });

// Chromatic syllables are spelled by degree, so the raised fourth of D is G sharp,
// the raised fifth is A sharp, and the raised sixth is B sharp rather than C.
const dChromatic = run(input('movable', 'D', 'toNotes', 'do di re ri mi fa fi sol si la li ti'));
assert.equal(shape(dChromatic).notes, 'D D# E E# F# G G# A A# B B# C#');
assert.equal(shape(dChromatic).syllables, 'do di re ri mi fa fi sol si la li ti');
assert.equal(shape(dChromatic).degrees, '1 #1 2 #2 3 4 #4 5 #5 6 #6 7');
assert.equal(shape(dChromatic).semitones, '0 1 2 3 4 5 6 7 8 9 10 11');

// La-based minor keeps do on the relative major tonic.
const aMinor = run(input('minor', 'A', 'toNotes', 'la ti do re mi fa sol la'));
assert.equal(aMinor.keyName, 'A minor');
assert.equal(aMinor.mode, 'minor');
assert.equal(aMinor.doTonic, 'C');
assert.equal(shape(aMinor).notes, 'A B C D E F G A');
assert.equal(shape(aMinor).degrees, '1 2 3 4 5 6 7 1');
assert.equal(shape(aMinor).semitones, '0 2 3 5 7 8 10 0');
const raisedSixth = run(input('minor', 'A', 'toNotes', 'mi fi sol si'));
assert.equal(shape(raisedSixth).notes, 'E F# G G#');
assert.equal(shape(raisedSixth).degrees, '5 #6 7 #7');
assert.equal(raisedSixth.tokens[1].syllable, 'fi');
assert.equal(raisedSixth.tokens[3].syllable, 'si');

// Fixed do anchors every syllable to a pitch, whatever the key select says.
const fixed = run(input('fixed', 'F#', 'toNotes', 'do re mi fa sol la ti'));
assert.equal(fixed.keyName, 'do = C');
assert.equal(shape(fixed).notes, 'C D E F G A B');
assert.equal(shape(fixed).semitones, '0 2 4 5 7 9 11');
const fixedChromatic = run(input('fixed', 'C', 'toNotes', 'di ra fi se'));
assert.equal(shape(fixedChromatic).notes, 'C# Db F# Gb');
assert.equal(shape(fixedChromatic).degrees, '#1 b2 #4 b5');

// Note names to syllables use the spelling, not only the pitch class.
const dNotes = run(input('movable', 'D', 'toSyllables', 'D E F# G A B C# F C G#'));
assert.equal(shape(dNotes).syllables, 'do re mi fa sol la ti me te fi');
assert.equal(shape(dNotes).degrees, '1 2 3 4 5 6 7 b3 b7 #4');
assert.equal(shape(dNotes).notes, 'D E F# G A B C# F C G#');
const fixedNotes = run(input('fixed', 'C', 'toSyllables', 'C# Db F# Gb B'));
assert.equal(shape(fixedNotes).syllables, 'di ra fi se ti');
const minorNotes = run(input('minor', 'A', 'toSyllables', 'A B C D E F# G#'));
assert.equal(shape(minorNotes).syllables, 'la ti do re mi fi si');

// Aliases, case folding and ignored octave numbers.
assert.equal(run(input('movable', 'D', 'toNotes', 'so DOH')).tokens[0].syllable, 'sol');
assert.equal(run(input('movable', 'D', 'toNotes', 'so DOH')).tokens[1].syllable, 'do');
assert.equal(shape(run(input('fixed', 'C', 'toSyllables', 'C4 D4 E4'))).notes, 'C D E');
assert.equal(run(input('movable', 'D', 'toSyllables', 'g♯')).tokens[0].syllable, 'fi');

// Every key offered by every system round-trips through its twelve-step table,
// the table covers each semitone once, and each pitch agrees with an independent
// pitch-class calculation.
let roundTrips = 0;
for (const system of ['movable', 'minor', 'fixed']) {
  const keys = T.keysFor(system);
  for (const key of keys) {
    const table = plain(T.chromaticTable(system, key));
    assert.equal(table.rows.length, 12, system + ' ' + key + ' rows');
    assert.deepEqual(table.rows.map((row) => row.semitone), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], system + ' ' + key);
    const tonic = table.mode === 'fixed' ? 'C' : key;
    for (const row of table.rows) {
      assert.equal(row.semitone, (pitchClass(row.note) - pitchClass(tonic) + 12) % 12, system + ' ' + key + ' ' + row.note + ' semitone');
      assert.match(row.degree, /^[#b]?[1-7]$/, system + ' ' + key + ' ' + row.note + ' degree');
      const toNotes = run(input(system, key, 'toNotes', row.syllable));
      assert.equal(toNotes.tokens[0].note, row.note, system + ' ' + key + ' ' + row.syllable);
      assert.equal(toNotes.tokens[0].semitone, row.semitone, system + ' ' + key + ' ' + row.syllable + ' semitone');
      const toSyllables = run(input(system, key, 'toSyllables', row.note));
      assert.equal(toSyllables.tokens[0].syllable, row.syllable, system + ' ' + key + ' ' + row.note);
      roundTrips += 2;
    }
  }
}
assert.equal(roundTrips, 744, '31 tables of twelve steps, both directions');

// The seven diatonic syllables of each key produce that key's scale, letter for letter.
for (const key of T.keysFor('movable')) {
  const table = plain(T.chromaticTable('movable', key));
  const expected = [0, 2, 4, 5, 7, 9, 11].map((step) => table.rows.find((row) => row.semitone === step).note);
  const scale = run(input('movable', key, 'toNotes', 'do re mi fa sol la ti')).tokens.map((token) => token.note);
  assert.deepEqual(scale, expected, 'major scale ' + key);
}
for (const key of T.keysFor('minor')) {
  const table = plain(T.chromaticTable('minor', key));
  const expected = [0, 2, 3, 5, 7, 8, 10].map((step) => table.rows.find((row) => row.semitone === step).note);
  const scale = run(input('minor', key, 'toNotes', 'la ti do re mi fa sol')).tokens.map((token) => token.note);
  assert.deepEqual(scale, expected, 'minor scale ' + key);
}
assert.deepEqual(
  run(input('movable', 'C#', 'toNotes', 'do re mi fa sol la ti')).tokens.map((token) => token.note),
  ['C#', 'D#', 'E#', 'F#', 'G#', 'A#', 'B#']
);
assert.deepEqual(
  run(input('movable', 'Cb', 'toNotes', 'do re mi fa sol la ti')).tokens.map((token) => token.note),
  ['Cb', 'Db', 'Eb', 'Fb', 'Gb', 'Ab', 'Bb']
);

// A C sharp major key cannot spell di (C double sharp); the table takes the
// enharmonic lowered second instead.
assert.equal(failure(input('movable', 'C#', 'toNotes', 'di')), 'The syllable "di" would need a double accidental in C# major; choose a simpler key.');
assert.deepEqual(
  plain(T.chromaticTable('movable', 'C#')).rows.slice(0, 3).map((row) => row.syllable + ' ' + row.note),
  ['do C#', 'ra D', 're D#']
);

// Validation.
assert.equal(failure(input('movable', 'D', 'toNotes', '  ')), 'Enter at least one syllable or note.');
assert.equal(
  failure(input('movable', 'D', 'toNotes', 'bo')),
  'Unrecognized syllable "bo". Use do, re, mi, fa, sol, la, ti, or a chromatic syllable such as di, fi, si, ra, me or te.'
);
assert.equal(
  failure(input('movable', 'D', 'toSyllables', 'H')),
  'Unrecognized note "H". Use a letter A to G with an optional sharp or flat, such as F# or Bb.'
);
assert.equal(failure(input('movable', 'H', 'toNotes', 'do')), 'Choose a key such as C, F# or Bb.');
assert.equal(failure(input('movable', 'D', 'sideways', 'do')), 'Choose syllables to notes or notes to syllables.');
assert.equal(failure(input('nope', 'D', 'toNotes', 'do')), 'Choose fixed do, movable do or la-based minor.');
const long = Array(33).fill('do').join(' ');
assert.equal(failure(input('movable', 'D', 'toNotes', long)), 'Enter no more than 32 syllables or notes.');
assert.equal(run(input('movable', 'D', 'toNotes', Array(32).fill('do').join(' '))).count, 32);

// The catalog record and every published case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record');
assert.equal(record.name, 'Solfège Converter');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.method.length > 500, 'method documents the arithmetic');
assert.equal(record.sources.length, 1);
assert.match(record.sources[0].url, /^https:\/\/en\.wikipedia\.org\/wiki\/Solf%C3%A8ge$/);
assert.equal(record.testCases.length, 22);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 9);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 5);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 8);
for (const testCase of record.testCases) {
  assert.ok(testCase.name && testCase.kind && testCase.input, 'catalog case shape');
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    assert.deepEqual(shape(run(testCase.input)), testCase.expected, testCase.name);
  }
}

// The new record's slug, name and aliases stay unique across the whole catalog.
const others = catalog.tools.filter((tool) => tool.slug !== slug);
const otherNames = new Set(others.map((tool) => tool.name.toLowerCase()));
const otherAliases = new Set(others.flatMap((tool) => tool.aliases.map((alias) => alias.toLowerCase())));
assert.ok(!otherNames.has(record.name.toLowerCase()), 'duplicate name');
for (const alias of record.aliases) {
  assert.ok(!otherAliases.has(alias.toLowerCase()), 'duplicate alias ' + alias);
}
assert.ok(!others.some((tool) => /solf|sol-fa/.test(tool.slug + ' ' + tool.name + ' ' + tool.aliases.join(' '))), 'no other solfège tool');

// Page contract: no network, storage or external assets; labelled controls.
assert.match(html, /<h1>Solfège Converter<\/h1>/);
assert.match(html, /<meta name="description" content="[^"]{80,}"/);
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/app.js'));
assert.ok(!/https?:\/\//.test(html), 'no absolute URLs');
assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\b/.test(html), 'no network or storage');
assert.ok(!/<(?:img|iframe|link[^>]+href="https?:)/.test(html), 'no remote media');
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('role="alert"'));
assert.equal((html.match(/<label\b/g) || []).length, 4);
assert.equal((html.match(/<table\b/g) || []).length, 2);
assert.ok(html.includes('overflow-x:auto'), 'tables scroll on narrow screens');
console.log('solfege converter checks passed');
