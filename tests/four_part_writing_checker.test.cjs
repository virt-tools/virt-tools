/* Regression checks for the four-part writing core, page contract and catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/four-part-writing-checker/index.html'), 'utf8');
const start = html.indexOf('/* four-part-core:start */');
const end = html.indexOf('/* four-part-core:end */');
assert.ok(start > -1 && end > start, 'four-part core markers missing');
const core = html.slice(start, end + '/* four-part-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = FourPartCore;', sandbox);
const C = sandbox.module.exports;

const kinds = (result) => JSON.stringify(result.issues.map((issue) => `${issue.chords}|${issue.kind}|${issue.voices.join('+')}`));
const messages = (result) => result.issues.map((issue) => issue.message);
const labels = (chord) => JSON.stringify(chord.notes.map((note) => note.label));

// A plain I - V - I voicing is clean.
const tonic = C.analyze('G4 E4 C4 C3\nG4 D4 B3 G3\nG4 E4 C4 C3');
assert.equal(tonic.total, 0);
assert.equal(tonic.chords.length, 3);
assert.equal(C.summary(tonic), 'No part-writing problems found');
assert.equal(labels(tonic.chords[1]), JSON.stringify(['G4', 'D4', 'B3', 'G3']));
assert.equal(JSON.stringify(tonic.chords[0].notes.map((note) => note.midi)), JSON.stringify([67, 64, 60, 48]));

// Both voices move by the same interval, so the perfect fifth is parallel.
const fifths = C.analyze('G4 E4 C4 C3\nA4 F4 A3 D3');
assert.equal(fifths.total, 1);
assert.equal(kinds(fifths), JSON.stringify(['1 → 2|parallel-fifths|soprano+bass']));
assert.equal(messages(fifths)[0], 'Parallel perfect fifth between soprano and bass: G4/C3 to A4/D3.');
assert.equal(C.summary(fifths), '1 problem: 1 parallel fifth');

const octaves = C.analyze('C5 G4 E4 C3\nD5 F4 A3 D3');
assert.equal(octaves.total, 1);
assert.equal(kinds(octaves), JSON.stringify(['1 → 2|parallel-octaves|soprano+bass']));
assert.equal(messages(octaves)[0], 'Parallel perfect octave between soprano and bass: C5/C3 to D5/D3.');
assert.equal(C.summary(octaves), '1 problem: 1 parallel octave');

// A voice that stays put cannot make a parallel, even inside a perfect interval.
assert.equal(C.analyze('G4 E4 C4 C3\nG4 E4 C4 G3').total, 0);

// Structural checks on a single chord.
const crossing = C.analyze('F4 G4 D4 B2');
assert.equal(kinds(crossing), JSON.stringify(['1|crossing|soprano+alto']));
assert.equal(messages(crossing)[0], 'Soprano F4 sits below alto G4.');

const spacing = C.analyze('D5 C4 A3 F3');
assert.equal(kinds(spacing), JSON.stringify(['1|spacing|soprano+alto']));
assert.equal(messages(spacing)[0], 'Soprano and alto are 14 semitones apart; keep the upper three voices within an octave.');

const rangesHigh = C.analyze('C#6 D5 G4 C3');
assert.equal(kinds(rangesHigh), JSON.stringify(['1|range|soprano']));
assert.equal(messages(rangesHigh)[0], 'Soprano C#6 is outside the usual soprano range (C4–C6).');

const rangesLow = C.analyze('G4 E4 C4 A1');
assert.equal(kinds(rangesLow), JSON.stringify(['1|range|bass']));
assert.equal(messages(rangesLow)[0], 'Bass A1 is outside the usual bass range (E2–C4).');

// An alto that reaches above the previous soprano note is a voice overlap.
const overlap = C.analyze('G4 E4 C4 C3\nB4 A4 D4 G3');
assert.equal(kinds(overlap), JSON.stringify(['1 → 2|overlap|soprano+alto']));
assert.equal(messages(overlap)[0], "Voice overlap between soprano and alto: G4/E4 becomes B4/A4, so one voice passes the other voice's previous note.");

// A one-octave gap between the upper voices is allowed, and bar lines split chords.
assert.equal(C.analyze('D5 D4 G3 C3').total, 0);
const bars = C.analyze('G4 E4 C4 C3 | G4 D4 B3 G3');
assert.equal(bars.chords.length, 2);
assert.equal(bars.total, 0);

// Flats and sharps are kept exactly as written.
const flats = C.analyze('Gb4 Eb4 Cb4 Cb3');
assert.equal(labels(flats.chords[0]), JSON.stringify(['Gb4', 'Eb4', 'Cb4', 'Cb3']));
assert.equal(JSON.stringify(flats.chords[0].notes.map((note) => note.midi)), JSON.stringify([66, 63, 59, 47]));
assert.equal(flats.total, 0);

// Parsing refuses malformed input with the exact reason.
const rejects = (text, pattern) => assert.throws(() => C.analyze(text), (error) => {
  assert.match(error.message, pattern);
  return true;
});
rejects('G4 E4 C3', /^Line 1 needs four notes in soprano, alto, tenor, bass order; found 3\.$/);
rejects('G4 E4 C4 C3\nG4 E4 C3', /^Line 2 needs four notes in soprano, alto, tenor, bass order; found 3\.$/);
rejects('H4 E4 C4 C3', /^Chord 1, Soprano "H4" is not a note: write a letter A–G, an optional sharp or flat, and an octave number, such as C4 or Bb3\.$/);
rejects('', /^Enter at least one chord, one per line with four notes \(soprano, alto, tenor, bass\)\.$/);
rejects('   \n\n', /^Enter at least one chord/);
rejects(Array(9).fill('G4 E4 C4 C3').join('\n'), /^Enter at most 8 chords, one per line\.$/);
rejects('G#b4 E4 C4 C3', /is not a note/);
rejects('G4 E4 C4 C-1', /is not a note/);

// Independent reimplementation of the stated rules, used as an oracle for parsing too.
const LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteToMidi(token) {
  const match = /^([A-Ga-g])([#b]?)([0-9])$/.exec(token);
  if (!match) throw new Error(`oracle cannot read ${token}`);
  const value = (Number(match[3]) + 1) * 12 + LETTERS[match[1].toUpperCase()];
  return value + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
}
const ORACLE_RANGES = [[60, 84], [55, 76], [48, 67], [40, 60]];
const ORACLE_NAMES = ['soprano', 'alto', 'tenor', 'bass'];
function oracle(text) {
  const chords = text.split('\n').map((line) => line.trim()).filter(Boolean)
    .map((line) => line.split(' ').map(noteToMidi));
  const found = [];
  chords.forEach((notes, index) => {
    const marker = String(index + 1);
    notes.forEach((pitch, voice) => {
      if (pitch < ORACLE_RANGES[voice][0] || pitch > ORACLE_RANGES[voice][1]) found.push(`${marker}|range|${ORACLE_NAMES[voice]}`);
    });
    [[0, 1], [1, 2], [2, 3]].forEach(([upper, lower]) => {
      if (notes[upper] < notes[lower]) found.push(`${marker}|crossing|${ORACLE_NAMES[upper]}+${ORACLE_NAMES[lower]}`);
    });
    [[0, 1], [1, 2]].forEach(([upper, lower]) => {
      if (notes[upper] - notes[lower] > 12) found.push(`${marker}|spacing|${ORACLE_NAMES[upper]}+${ORACLE_NAMES[lower]}`);
    });
    if (!index) return;
    const previous = chords[index - 1];
    const pairMarker = `${index} → ${index + 1}`;
    for (let first = 0; first < 4; first += 1) {
      for (let second = first + 1; second < 4; second += 1) {
        const before = ((previous[first] - previous[second]) % 12 + 12) % 12;
        const after = ((notes[first] - notes[second]) % 12 + 12) % 12;
        const moveFirst = notes[first] - previous[first];
        const moveSecond = notes[second] - previous[second];
        if (before === after && (before === 0 || before === 7) && moveFirst && moveSecond
          && (moveFirst > 0) === (moveSecond > 0)) {
          found.push(`${pairMarker}|${before === 0 ? 'parallel-octaves' : 'parallel-fifths'}|${ORACLE_NAMES[first]}+${ORACLE_NAMES[second]}`);
        }
      }
    }
    [[0, 1], [1, 2], [2, 3]].forEach(([upper, lower]) => {
      if (notes[lower] > previous[upper] || notes[upper] < previous[lower]) {
        found.push(`${pairMarker}|overlap|${ORACLE_NAMES[upper]}+${ORACLE_NAMES[lower]}`);
      }
    });
  });
  return found;
}

let seed = 246813579;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const label = (midi) => NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
for (let i = 0; i < 400; i += 1) {
  const count = 1 + Math.floor(rand() * 8);
  const lines = [];
  for (let chord = 0; chord < count; chord += 1) {
    const notes = [];
    for (let voice = 0; voice < 4; voice += 1) notes.push(label(36 + Math.floor(rand() * 55)));
    lines.push(notes.join(' '));
  }
  const text = lines.join('\n');
  assert.equal(kinds(C.analyze(text)), JSON.stringify(oracle(text)), text.replace('\n', ' / '));
}

// Constructed parallels: soprano and bass move by the same offset inside a perfect interval.
for (let i = 0; i < 200; i += 1) {
  const offset = 1 + Math.floor(rand() * 3);
  const octave = i % 2 === 0;
  const upper = octave ? 60 : 67;
  const bass = 48;
  const inner = octave ? [55, 52] : [59, 55];
  const text = `${label(upper)} ${label(inner[0])} ${label(inner[1])} ${label(bass)}\n`
    + `${label(upper + offset)} ${label(inner[0])} ${label(inner[1])} ${label(bass + offset)}`;
  const found = C.analyze(text).issues.filter((issue) => issue.kind.startsWith('parallel'));
  assert.equal(found.length, 1, text.replace('\n', ' / '));
  assert.equal(found[0].kind, octave ? 'parallel-octaves' : 'parallel-fifths', text);
  assert.equal(found[0].voices.join('+'), 'soprano+bass', text);
}

// Opposite motion inside a perfect interval is not a parallel, even when the interval class matches.
const contrary = 'C4 G3 E3 C3\nG4 B3 F#3 G2';
assert.equal(C.analyze(contrary).total, 0);
for (let step = 1; step <= 3; step += 1) {
  const text = `C4 G3 E3 C3\n${label(60 + step)} G3 E3 ${label(48 - (12 - step))}`;
  const found = C.analyze(text).issues.filter((issue) => issue.kind.startsWith('parallel'));
  assert.equal(found.length, 0, text.replace('\n', ' / '));
}

// Eight chords are accepted, nine are refused.
const eight = Array(8).fill('G4 E4 C4 C3').join('\n');
assert.equal(C.analyze(eight).chords.length, 8);

// Catalog integrity and recorded cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2268, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === 'four-part-writing-checker');
assert.ok(record, 'catalog record');
assert.equal(record.name, 'Four-Part Writing Checker');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.tags.includes('music'));
assert.ok(record.tags.includes('voice-leading'));
assert.ok(record.method.length > 700);
assert.ok(record.testCases.length >= 10);
assert.equal(catalog.tools.filter((tool) => tool.category === record.category).length, 43, 'Music count');

const names = new Map();
for (const tool of catalog.tools) {
  if (tool.slug === record.slug) continue;
  for (const value of [tool.slug, tool.name, ...(tool.aliases || [])]) {
    names.set(String(value).toLowerCase(), tool.slug);
  }
}
for (const value of [record.slug, record.name, ...record.aliases]) {
  assert.equal(names.get(String(value).toLowerCase()), undefined, `duplicate name or alias: ${value}`);
}
assert.ok(fs.existsSync(path.join(root, 'frontend/tools', record.slug, 'index.html')));
assert.equal(JSON.stringify(C.voices), JSON.stringify(['soprano', 'alto', 'tenor', 'bass']));
assert.equal(C.limits.chords, 8);
assert.equal(C.rangeText.soprano, 'C4–C6');

for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.throws(() => C.analyze(testCase.input.progression), (error) => {
      assert.equal(error.message, testCase.expectedError, testCase.name);
      return true;
    });
    continue;
  }
  const result = C.analyze(testCase.input.progression);
  assert.equal(result.total, testCase.expected.total, `${testCase.name}: total`);
  assert.equal(C.summary(result), testCase.expected.summary, `${testCase.name}: summary`);
  assert.equal(kinds(result), JSON.stringify(testCase.expected.issues), `${testCase.name}: issues`);
}

console.log('four-part writing checker checks passed');
