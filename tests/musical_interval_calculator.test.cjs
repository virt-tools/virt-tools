/* Regression checks for the musical interval core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'musical-interval-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* music-interval-core:start */');
const end = html.indexOf('/* music-interval-core:end */');
assert.ok(start > -1 && end > start, 'music-interval core markers missing');
const core = html.slice(start, end + '/* music-interval-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MusicIntervalCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (first, second) => plain(C.analyze({ first, second }));
const closeTo = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9,
  label + ': ' + actual + ' vs ' + expected);

// Documented surface.
assert.equal(C.OCTAVE_MIN, -1);
assert.equal(C.OCTAVE_MAX, 9);
assert.equal(C.DEFAULT_OCTAVE, 4);
assert.equal(C.MESSAGES.note, 'Enter a note like C4, F#3 or Bb5.');
assert.equal(C.MESSAGES.octave, 'Octaves run from -1 to 9.');
assert.equal(C.MESSAGES.accidental, 'Use at most two sharps or two flats on one note.');

// Textbook intervals.
const third = run('C4', 'E4');
assert.equal(third.name, 'major third');
assert.equal(third.quality, 'major');
assert.equal(third.semitones, 4);
assert.equal(third.generic, 3);
assert.equal(third.octaves, 0);
assert.equal(third.cents, 400);
closeTo(third.ratio, Math.pow(2, 4 / 12), 'major third ratio');
assert.equal(third.inversion, 'minor sixth');
assert.equal(third.direction, 'up');
assert.equal(third.first, 'C4');
assert.equal(third.second, 'E4');

const fifth = run('C4', 'G4');
assert.equal(fifth.name, 'perfect fifth');
assert.equal(fifth.semitones, 7);
assert.equal(fifth.inversion, 'perfect fourth');

const octave = run('C4', 'C5');
assert.equal(octave.name, 'perfect octave');
assert.equal(octave.semitones, 12);
assert.equal(octave.octaves, 1);
assert.equal(octave.simpleName, 'perfect unison');
assert.equal(octave.cents, 1200);

const tenth = run('C4', 'E5');
assert.equal(tenth.name, 'major tenth');
assert.equal(tenth.simpleName, 'major third');
assert.equal(tenth.semitones, 16);
assert.equal(tenth.octaves, 1);
assert.equal(tenth.simpleNumber, 3);

// Spelling decides the name: the same four semitones are a diminished fourth and
// a major third.
assert.equal(run('C#4', 'F4').name, 'diminished fourth');
assert.equal(run('Db4', 'F4').name, 'major third');
assert.equal(run('B3', 'C4').name, 'minor second');
assert.equal(run('B#3', 'C4').name, 'diminished second');
assert.equal(run('B#3', 'C4').semitones, 0);
assert.equal(run('B#3', 'C4').direction, 'same');
assert.equal(run('C4', 'F#4').name, 'augmented fourth');

// Descending input keeps the letter-based number and reports the direction.
const down = run('G4', 'C4');
assert.equal(down.name, 'perfect fifth');
assert.equal(down.direction, 'down');
assert.equal(down.semitones, 7);
assert.equal(run('C5', 'A4').name, 'minor third');
assert.equal(run('C5', 'A4').direction, 'down');

// Unison and enharmonic-unison spellings.
const unison = run('C4', 'C4');
assert.equal(unison.name, 'perfect unison');
assert.equal(unison.semitones, 0);
assert.equal(unison.inversion, 'perfect octave');
assert.equal(unison.ratio, 1);
const doubled = run('C4', 'Dbb4');
assert.equal(doubled.name, 'diminished second');
assert.equal(doubled.semitones, 0);

// Extreme accidentals and wide spans.
assert.equal(run('Fbb3', 'B##3').name, 'quintuply augmented fourth');
assert.equal(run('Fbb3', 'B##3').semitones, 10);
const wide = run('C-1', 'B9');
assert.equal(wide.name, 'major seventh + 10 octaves');
assert.equal(wide.semitones, 131);
assert.equal(wide.octaves, 10);
const beyond = run('C-1', 'C9');
assert.equal(beyond.name, 'perfect unison + 10 octaves');

// Parsing rules.
assert.equal(run('c4', 'e4').name, 'major third');
assert.equal(run(' C4 ', ' E4 ').name, 'major third');
assert.equal(run('C', 'E').name, 'major third');
assert.equal(run('C\u266f4', 'F4').name, 'diminished fourth');
assert.equal(run('B\u266d4', 'D5').name, 'major third');
assert.equal(run('C4', 'E4').first, 'C4');
assert.throws(() => C.analyze({ first: '', second: 'E4' }));
assert.throws(() => C.analyze({ first: 'H4', second: 'E4' }));
assert.throws(() => C.analyze({ first: 'C10', second: 'E4' }));
assert.throws(() => C.analyze({ first: 'C-2', second: 'E4' }));
assert.throws(() => C.analyze({ first: 'Cb#4', second: 'E4' }));
assert.throws(() => C.analyze({ first: 'C4x', second: 'E4' }));
try {
  C.analyze({ first: 'C###4', second: 'E4' });
  assert.fail('three sharps should be refused');
} catch (error) {
  assert.equal(error.message, C.MESSAGES.accidental);
}

// Invariants over the whole supported spelling grid for three octaves.
const letters = 'ABCDEFG'.split('');
const accidentals = ['', 'b', '#', 'bb', '##'];
const notes = [];
for (const octave of [3, 4, 5]) {
  for (const accidental of accidentals) {
    for (const letter of letters) notes.push(letter + accidental + octave);
  }
}
let pairs = 0;
for (const first of notes) {
  for (const second of notes) {
    const result = plain(C.analyze({ first, second }));
    pairs += 1;
    assert.ok(result.semitones >= 0, 'semitones are non-negative');
    assert.ok(result.generic >= 1, 'generic number is at least one');
    assert.equal(result.generic, Math.abs(result.letters) + 1, 'generic follows the letters');
    assert.equal(result.octaves, Math.floor(result.letters / 7), 'octaves follow the letters');
    assert.equal(result.cents, 100 * result.semitones, 'cents are 100 per semitone');
    closeTo(result.ratio, Math.pow(2, result.semitones / 12), 'ratio is 2^(n/12)');
    assert.equal(result.inversionSemitones + (result.semitones - 12 * result.octaves), 12,
      'the inversion completes the octave');
    assert.equal(C.invertQuality(C.invertQuality(result.quality)), result.quality,
      'inverting a quality twice returns it');
    const backwards = plain(C.analyze({ first: second, second: first }));
    assert.equal(backwards.semitones, result.semitones, 'the size does not depend on the order');
    assert.equal(backwards.name, result.name, 'the name does not depend on the order');
    assert.equal(backwards.inversion, result.inversion, 'the inversion does not depend on the order');
  }
}
assert.equal(pairs, 11025, 'every pair in the grid was checked');

// The catalog record replays through this core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(record.category, 'Music');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.ok(record.testCases.length >= 20, 'catalog has the full test case set');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    try {
      C.analyze(testCase.input);
      assert.fail(testCase.name + ': expected a refusal');
    } catch (error) {
      assert.equal(error.message, testCase.expected.error, testCase.name);
    }
    continue;
  }
  const result = C.analyze(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (key === 'ratio') closeTo(result[key], value, testCase.name + ' ' + key);
    else assert.equal(result[key], value, testCase.name + ' ' + key);
  }
}

// Page contract: shared chrome, a single form, no storage, no network.
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style\.css">/);
assert.equal((html.match(/id="interval-form"/g) || []).length, 1);
assert.ok(html.includes('aria-live="polite"'));
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), 'page stores nothing');
assert.ok(!/https?:\/\//.test(html), 'page references no external URL');
assert.ok(!/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/.test(html), 'page makes no requests');

console.log(slug + ' core: all checks passed (' + record.testCases.length + ' catalog cases, ' + pairs + ' pairs)');
