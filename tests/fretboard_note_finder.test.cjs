/* Regression checks for the fretboard note finder: the catalog cases, an
   independent spelling and position oracle, hand-checked anchors and refusals. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/fretboard-note-finder/index.html'), 'utf8');
const start = html.indexOf('/* fbn-core:start */');
const end = html.indexOf('/* fbn-core:end */');
assert.ok(start > -1 && end > start, 'fretboard core markers missing');
const core = html.slice(start, end + '/* fbn-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = FretboardCore;', sandbox);
const C = sandbox.module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'fretboard-note-finder');
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Music', 'catalog category');
assert.ok(entry.testCases.length >= 20, `expected at least 20 cases, found ${entry.testCases.length}`);

// A separate transcription of the standard tunings, top row first.
const TUNINGS = {
  guitar: 'E4 B3 G3 D3 A2 E2',
  'guitar-drop-d': 'E4 B3 G3 D3 A2 D2',
  'guitar-dadgad': 'D4 A3 G3 D3 A2 D2',
  'guitar-open-g': 'D4 B3 G3 D3 G2 D2',
  'guitar-7': 'E4 B3 G3 D3 A2 E2 B1',
  'bass-4': 'G2 D2 A1 E1',
  'bass-5': 'G2 D2 A1 E1 B0',
  'ukulele-high-g': 'A4 E4 C4 G4',
  'ukulele-low-g': 'A4 E4 C4 G3',
  mandolin: 'E5 A4 D4 G3',
};

const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Spell a pitch class by walking the natural letters: an exact natural wins,
// otherwise the letter a semitone below (sharp) or above (flat).
function spell(pc, flats) {
  const wanted = ((pc % 12) + 12) % 12;
  const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  for (const letter of letters) {
    if (NATURAL[letter] === wanted) return letter;
  }
  for (const letter of letters) {
    if (!flats && ((wanted - NATURAL[letter]) % 12 + 12) % 12 === 1) return `${letter}#`;
  }
  for (const letter of letters) {
    if (flats && ((wanted - NATURAL[letter]) % 12 + 12) % 12 === 11) return `${letter}b`;
  }
  throw new Error(`cannot spell pitch class ${pc}`);
}

function nameFor(midi, flats) {
  return spell(midi % 12, flats) + (Math.floor(midi / 12) - 1);
}

function parseToken(token) {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(token);
  if (!match) throw new Error(`bad token ${token}`);
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return 12 * (Number(match[3]) + 1) + NATURAL[match[1].toUpperCase()] + accidental;
}

function oracle(input) {
  const text = input.preset === 'custom' ? input.custom : TUNINGS[input.preset];
  const opens = String(text).split(/[\s,]+/).filter(Boolean).map(parseToken);
  const capo = Number(input.capo);
  const frets = Number(input.frets);
  const target = input.target === 'any' || input.target === undefined ? null : Number(input.target);
  const flats = input.spelling === 'flat';
  const rows = [];
  const groups = [];
  let count = 0;
  let low = Infinity;
  let high = -Infinity;
  for (const openMidi of opens) {
    const base = openMidi + capo;
    const labels = [];
    const hits = [];
    for (let fret = 0; fret <= frets; fret += 1) {
      const midi = base + fret;
      assert.ok(midi <= 127, 'oracle range');
      labels.push(nameFor(midi, flats));
      if (target !== null && midi % 12 === target) {
        count += 1;
        hits.push(fret);
      }
    }
    rows.push(labels);
    if (hits.length) groups.push([nameFor(base, flats), hits]);
    low = Math.min(low, base);
    high = Math.max(high, base + frets);
  }
  return {
    count,
    total: opens.length * (frets + 1),
    low: nameFor(low, flats),
    high: nameFor(high, flats),
    groups,
    rows,
    tuning: opens.map((midi) => nameFor(midi + capo, flats)).join(' '),
  };
}

let goldenCount = 0;
for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(
      () => C.analyze(Object.assign({}, testCase.input)),
      (error) => {
        assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
        return true;
      },
      `${label}: expected a refusal`,
    );
    continue;
  }
  goldenCount += 1;
  const result = C.analyze(Object.assign({}, testCase.input));
  const expected = testCase.expected;
  assert.equal(result.count, expected.count, `${label}: count`);
  assert.equal(result.total, expected.total, `${label}: total`);
  assert.equal(result.low, expected.low, `${label}: low`);
  assert.equal(result.high, expected.high, `${label}: high`);
  assert.deepEqual(plain(result.groups.map((group) => [group.open, group.frets])), expected.groups, `${label}: groups`);
  assert.equal(result.tuning, expected.tuning, `${label}: tuning`);
  assert.deepEqual(plain(result.strings.map((string) => string.cells.map((cell) => cell.label))), expected.rows, `${label}: rows`);
  const independent = oracle(testCase.input);
  assert.equal(independent.count, expected.count, `${label}: oracle count`);
  assert.equal(independent.total, expected.total, `${label}: oracle total`);
  assert.equal(independent.low, expected.low, `${label}: oracle low`);
  assert.equal(independent.high, expected.high, `${label}: oracle high`);
  assert.deepEqual(independent.groups, expected.groups, `${label}: oracle groups`);
  assert.deepEqual(independent.rows, expected.rows, `${label}: oracle rows`);
  assert.equal(independent.tuning, expected.tuning, `${label}: oracle tuning`);
}
assert.ok(goldenCount >= 15, `expected at least 15 golden cases, found ${goldenCount}`);

// Hand-checked anchors: open strings, octave boundaries and capo transposition.
const standard = C.analyze({ preset: 'guitar', capo: 0, frets: 24, target: 'any', spelling: 'sharp' });
assert.equal(standard.strings.length, 6);
assert.equal(standard.strings[0].open, 'E4');
assert.equal(standard.strings[5].open, 'E2');
assert.equal(standard.strings[0].cells[0].label, 'E4');
assert.equal(standard.strings[0].cells[1].label, 'F4');
assert.equal(standard.strings[0].cells[11].label, 'D#5');
assert.equal(standard.strings[0].cells[12].label, 'E5');
assert.equal(standard.strings[0].cells[24].label, 'E6');
assert.equal(standard.strings[1].cells[5].label, 'E4');
assert.equal(standard.strings[5].cells[12].label, 'E3');
assert.equal(standard.strings[0].cells[0].octave, 4);

const capoed = C.analyze({ preset: 'guitar', capo: 2, frets: 3, target: 'any', spelling: 'sharp' });
assert.equal(capoed.strings[0].open, 'F#4');
assert.equal(capoed.strings[5].open, 'F#2');
assert.equal(capoed.strings[5].cells[0].label, 'F#2');
assert.equal(capoed.strings[5].cells[1].label, 'G2');
assert.equal(capoed.low, 'F#2');
assert.equal(capoed.high, 'A4');

const flatNames = C.analyze({ preset: 'bass-5', capo: 0, frets: 5, target: 10, spelling: 'flat' });
assert.equal(flatNames.strings[4].open, 'B0');
assert.equal(flatNames.strings[4].cells[1].label, 'C1');
assert.equal(flatNames.strings[4].cells[5].label, 'E1');
assert.equal(flatNames.targetName, 'Bb');
assert.deepEqual(plain(flatNames.groups.map((group) => [group.open, group.frets])), [['G2', [3]], ['A1', [1]]]);

const openStringsOnly = C.analyze({ preset: 'custom', custom: 'A#3', capo: 0, frets: 1, target: 'any', spelling: 'flat' });
assert.equal(openStringsOnly.tuning, 'Bb3');
assert.equal(openStringsOnly.low, 'Bb3');
assert.equal(openStringsOnly.high, 'B3');

const text = C.positionsText(C.analyze({ preset: 'guitar', capo: 0, frets: 12, target: 9, spelling: 'sharp' }));
assert.equal(text, 'E4: 5 · B3: 10 · G3: 2 · D3: 7 · A2: 0, 12 · E2: 5');

const none = C.analyze({ preset: 'mandolin', capo: 12, frets: 1, target: 0, spelling: 'sharp' });
assert.equal(none.count, 0);
assert.equal(C.positionsText(none), 'None in this range');

console.log(`fretboard note finder: ${entry.testCases.length} catalog cases (${goldenCount} golden), oracle and anchors pass`);
