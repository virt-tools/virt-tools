/* Harmonica key and position checks: an independent spelling/mode oracle over
   all 84 key and position pairs, catalog replay, validation messages, and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'harmonica-key-finder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* harmonica-core:start */';
const endMarker = '/* harmonica-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'harmonica core markers missing');
const core = html.slice(start, end + endMarker.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = HarmonicaCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.calculate({ ...C.DEFAULTS, ...(input || {}) }));
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};

// ---- Exported contract.
assert.deepEqual(plain(C.FIELDS), ['songkey', 'position']);
assert.deepEqual(plain(C.DEFAULTS), { songkey: 'A', position: '2' });
assert.deepEqual(plain(C.modes), ['Ionian', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Aeolian', 'Locrian']);
assert.deepEqual(plain(C.blowDegrees), [0, 2, 4, 0, 2, 4, 0, 2, 4, 0]);
assert.deepEqual(plain(C.drawDegrees), [1, 4, 6, 1, 3, 5, 6, 1, 3, 5]);
assert.equal(C.keys.length, 12);
assert.deepEqual(plain(C.keys).map((key) => key.name), ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']);
assert.deepEqual(plain(C.keys).map((key) => key.pc), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

// ---- Published default: a song in A played in 2nd position takes a D harp.
const published = run({});
assert.equal(published.songkey, 'A');
assert.equal(published.position, 2);
assert.equal(published.positionLabel, '2nd position (cross harp)');
assert.equal(published.mode, 'Mixolydian');
assert.equal(published.harpKey, 'D');
assert.equal(published.harpLabel, 'D harmonica');
assert.equal(published.scaleText, 'A B C# D E F# G');
assert.equal(published.rootName, 'A');
assert.equal(published.rootHolesText, 'draw 2, blow 3, blow 6, blow 9');
assert.equal(published.layout.length, 10);
assert.deepEqual(published.layout[1], { hole: 2, blow: 'F#', draw: 'A', blowTonic: false, drawTonic: true });
assert.deepEqual(published.positions.map((row) => row.key), ['D', 'A', 'E', 'B', 'F#', 'C#', 'G']);
assert.deepEqual(published.positions.map((row) => row.mode),
  ['Ionian', 'Mixolydian', 'Dorian', 'Aeolian', 'Phrygian', 'Locrian', 'Lydian']);
assert.equal(published.positions.filter((row) => row.selected).length, 1);

// ---- Independent oracle: spell each harp's major scale from letters and
// accidentals, take modes as rotations and positions as circle-of-fourths
// degrees. Nothing here reads the page's note tables.
const LETTERS = 'CDEFGAB';
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const KEY_PC = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const ACCIDENTALS = new Map([[0, ''], [1, '#'], [2, '##'], [10, 'bb'], [11, 'b']]);
const MODE_NAMES = ['Ionian', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Aeolian', 'Locrian'];
// 1st position is the harp key; each further position drops a fourth, leaving
// the fourth degree for the 7th position.
const DEGREE = { 1: 0, 2: 4, 3: 1, 4: 5, 5: 2, 6: 6, 7: 3 };

function majorScale(key) {
  const start = LETTERS.indexOf(key[0]);
  const tonic = KEY_PC[key];
  const notes = [];
  for (let step = 0; step < 7; step += 1) {
    const letter = LETTERS[(start + step) % 7];
    const want = (tonic + MAJOR[step]) % 12;
    const diff = (want - LETTER_PC[letter] + 12) % 12;
    assert.ok(ACCIDENTALS.has(diff), `unexpected accidental for ${key} degree ${step}`);
    notes.push(letter + ACCIDENTALS.get(diff));
  }
  return notes;
}

function oracle(song, position) {
  const degree = DEGREE[position];
  const harpPc = (KEY_PC[song] - MAJOR[degree] + 12) % 12;
  const harp = Object.keys(KEY_PC).find((name) => KEY_PC[name] === harpPc);
  const scale = majorScale(harp);
  const modeScale = [];
  for (let i = 0; i < 7; i += 1) modeScale.push(scale[(degree + i) % 7]);
  const blow = [0, 2, 4, 0, 2, 4, 0, 2, 4, 0];
  const draw = [1, 4, 6, 1, 3, 5, 6, 1, 3, 5];
  const roots = [];
  for (let hole = 1; hole <= 10; hole += 1) {
    if (blow[hole - 1] === degree) roots.push(`blow ${hole}`);
    if (draw[hole - 1] === degree) roots.push(`draw ${hole}`);
  }
  return {
    harpKey: harp,
    harpLabel: `${harp} harmonica`,
    mode: MODE_NAMES[degree],
    scaleText: modeScale.join(' '),
    rootName: modeScale[0],
    rootHolesText: roots.join(', '),
    layout: Array.from({ length: 10 }, (_, index) => ({
      hole: index + 1,
      blow: scale[blow[index]],
      draw: scale[draw[index]],
      blowTonic: blow[index] === degree,
      drawTonic: draw[index] === degree,
    })),
  };
}

// ---- Full 12 x 7 grid against the oracle, including layout and tonic marks.
const keys = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
let rows = 0;
for (const song of keys) {
  for (let position = 1; position <= 7; position += 1) {
    const input = { songkey: song, position: String(position) };
    const result = run(input);
    const expected = oracle(song, position);
    for (const key of ['harpKey', 'harpLabel', 'mode', 'scaleText', 'rootName', 'rootHolesText']) {
      assert.equal(result[key], expected[key], `${song}/${position} ${key}`);
    }
    assert.deepEqual(result.layout, expected.layout, `${song}/${position} layout`);
    // Every note on the harp belongs to the mode's seven notes, the root is
    // reachable, and the selected row is the position that was asked for.
    const notes = new Set(result.scaleText.split(' '));
    for (const hole of result.layout) {
      assert.ok(notes.has(hole.blow) && notes.has(hole.draw), `${song}/${position} hole ${hole.hole}`);
    }
    assert.ok(result.rootHolesText.length > 0, `${song}/${position} has a root`);
    assert.equal(result.positions.length, 7);
    const selected = result.positions.filter((row) => row.selected);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].position, position);
    assert.equal(selected[0].mode, result.mode);
    assert.equal(selected[0].key, result.rootName);
    rows += 1;
  }
}
assert.equal(rows, 84, 'grid covers every key and position');

// ---- Known reference pairs, checked against published position charts.
const pair = (song, position) => run({ songkey: song, position: String(position) }).harpKey;
assert.equal(pair('A', 2), 'D');   // cross harp, a fourth above the song key
assert.equal(pair('E', 2), 'A');
assert.equal(pair('G', 1), 'G');
assert.equal(pair('C', 1), 'C');
assert.equal(pair('D', 3), 'C');   // Dorian a tone above the harp key
assert.equal(pair('A', 4), 'C');   // Aeolian a sixth above
assert.equal(pair('F', 2), 'Bb');
assert.equal(pair('B', 5), 'G');

// ---- Parsing and per-field validation.
assert.equal(C.keyByName(' c ').name, 'C');
assert.equal(C.keyByName('B♭').name, 'Bb');
assert.equal(C.keyByName('f♯').name, 'F#');
assert.equal(C.positionByNumber(' 3 ').position, 3);
assert.throws(() => C.keyByName('E#'), /twelve listed/);
assert.throws(() => C.positionByNumber('  '), /Choose a playing position/);
assert.equal(failure({ songkey: '' }), 'Choose the key the song is in.');
assert.equal(failure({ songkey: 'H' }), 'Choose the song key from the twelve listed.');
assert.equal(failure({ songkey: 'C#' }), 'Choose the song key from the twelve listed.');
assert.equal(failure({ songkey: 'A minor' }), 'Choose the song key from the twelve listed.');
assert.equal(failure({ position: '' }), 'Choose a playing position.');
assert.equal(failure({ position: '0' }), 'Choose a playing position from 1st to 7th.');
assert.equal(failure({ position: '8' }), 'Choose a playing position from 1st to 7th.');
assert.equal(failure({ position: 'second' }), 'Choose a playing position from 1st to 7th.');
assert.equal(failure({ position: '2.5' }), 'Choose a playing position from 1st to 7th.');
assert.equal(failure({ position: '02' }), 'Choose a playing position from 1st to 7th.');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Harmonica Key & Position Finder');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 3, 'sources are cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 20, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 8, 'eight validation cases');
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.equal(result[key], value, testCase.name + ' ' + key);
  }
}

// The new record's slug, name and aliases must not collide with any other record.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 8, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const field of C.FIELDS) {
  assert.ok(new RegExp(`<label class="f" for="${field}"`).test(html), 'control is labelled: ' + field);
}
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html), 'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html.replace(/[←·—•♭♯🎵]/g, '')), 'no unexpected non-ASCII glyphs');

console.log('harmonica-key-finder: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + rows + ' key/position pairs)');
