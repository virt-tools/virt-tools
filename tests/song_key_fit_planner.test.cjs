/* Regression checks for the song key fit core and every case in its catalog record.
 *
 * The range arithmetic is anchored two ways: a closed-form window of shifts
 * (voice low - melody low to voice high - melody high) is asserted against the
 * brute-force sweep the page performs, and the documented worked cases below
 * are derived by hand from the note numbers, not copied out of the page.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'song-key-fit-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* song-key-fit-core:start */';
const endMarker = '/* song-key-fit-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'song key fit core markers missing');
const core = html.slice(start, end + endMarker.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SongKeyFitCore;', sandbox);
const C = sandbox.module.exports;

const run = (melodyLow, melodyHigh, voiceLow, voiceHigh, key) =>
  C.analyse({ melodyLow, melodyHigh, voiceLow, voiceHigh, key });

// ---- Scientific pitch notation: C4 is 60, A4 is 69, unicode accidentals are normalised.
assert.equal(C.parseNote('C4', 'note').midi, 60);
assert.equal(C.parseNote('A4', 'note').midi, 69);
assert.equal(C.parseNote('a4', 'note').midi, 69);
assert.equal(C.parseNote('B\u266d2', 'note').name, 'Bb2');
assert.equal(C.parseNote('B\u266d2', 'note').midi, 46);
assert.equal(C.parseNote('F#3', 'note').midi, 54);
assert.equal(C.parseNote('C0', 'note').midi, 12);
assert.equal(C.parseNote('B8', 'note').midi, 119);

// ---- Spelling helpers: one chromatic table per flavour, octaves from the MIDI number.
assert.equal(C.nameOf(60, false), 'C4');
assert.equal(C.nameOf(70, true), 'Bb4');
assert.equal(C.nameOf(70, false), 'A#4');
assert.equal(C.nameOf(49, true), 'Db3');
assert.equal(C.nameOf(48, false), 'C3');
assert.equal(C.nameOf(0, false), 'C-1');

// ---- Key names: twelve conventional spellings per mode, wrapping both ways.
const MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
assert.equal(C.KEYS.length, 24);
assert.equal(new Set(C.KEYS.map((key) => key.label)).size, 24, 'key labels unique');
for (let index = 0; index < 12; index += 1) {
  const major = C.KEYS.find((key) => key.label === MAJOR[index] + ' major');
  const minor = C.KEYS.find((key) => key.label === MINOR[index] + ' minor');
  assert.equal(C.keyName(major, 0), MAJOR[index] + ' major');
  assert.equal(C.keyName(minor, 0), MINOR[index] + ' minor');
  assert.equal(C.keyName(major, 12), MAJOR[index] + ' major', 'octave wraps');
  assert.equal(C.keyName(major, 1), MAJOR[(index + 1) % 12] + ' major', 'up one semitone');
  assert.equal(C.keyName(major, -1), MAJOR[(index + 11) % 12] + ' major', 'down one semitone');
}
assert.equal(C.keyName({ label: 'C major', tonic: 0, minor: false }, 1), 'Db major', 'sharps are spelled as flats');

// ---- Interval and direction wording.
assert.equal(C.intervalName(0), 'unison');
assert.equal(C.intervalName(6), 'tritone');
assert.equal(C.intervalName(7), 'perfect 5th');
assert.equal(C.intervalName(12), 'octave');
assert.equal(C.intervalName(-7), 'perfect 5th');
assert.equal(C.direction(0), 'No transposition needed');
assert.equal(C.direction(1), 'Up 1 semitone');
assert.equal(C.direction(-7), 'Down 7 semitones');

// ---- The documented default: G3-D5 (55-74) in a C3-A4 voice (48-69), G major.
{
  const result = run('G3', 'D5', 'C3', 'A4', 'G major');
  assert.equal(result.melodySpan, 19);
  assert.equal(result.voiceSpan, 21);
  assert.equal(result.fitCount, 3);
  assert.equal(result.best.shift, -6);
  assert.equal(result.best.key, 'Db major');
  assert.equal(result.best.melodyLow, 'Db3');
  assert.equal(result.best.melodyHigh, 'Ab4');
  assert.equal(result.best.headroomLow, 1);
  assert.equal(result.best.headroomHigh, 1);
  assert.deepEqual(Array.from(result.fits, (fit) => fit.shift), [-6, -5, -7], 'centred first, then by distance');
  assert.deepEqual(Array.from(result.shown, (fit) => fit.shift), [-6, -5, -7]);
  // The recommended shift is exactly the one whose margins are equal.
  assert.equal(result.best.headroomLow, result.best.headroomHigh);
}

// ---- A melody that already fits is left alone, even where another fit is more centred.
{
  const result = run('C4', 'E4', 'C3', 'A4', 'C major');
  assert.equal(result.fitCount, 18);
  assert.equal(result.best.shift, 0);
  assert.equal(result.best.direction, 'No transposition needed');
  assert.equal(result.best.headroomLow, 12);
  assert.equal(result.best.headroomHigh, 5);
  assert.ok(result.fits.some((fit) => fit.shift === -3 && fit.comfort > result.best.comfort),
    'a more centred fit exists but is not recommended');
  assert.equal(result.shown[0].shift, 0, 'as written leads the table');
}

// ---- A melody wider than the voice: no shift fits, and the closest is reported.
{
  const result = run('E2', 'E5', 'C4', 'C5', 'C major');
  assert.equal(result.melodySpan, 36);
  assert.equal(result.voiceSpan, 12);
  assert.equal(result.fitCount, 0);
  assert.equal(result.best, null);
  assert.equal(result.shown.length, 3, 'three closest shifts listed');
  assert.equal(result.closest.shift, 0);
  assert.equal(result.closest.overflow, 24);
  assert.equal(result.closest.overflow, result.voiceSpan < result.melodySpan
    ? (result.melodySpan - result.voiceSpan) : 0, 'overflow is the span difference at the best shift');
}

// ---- The closed-form window agrees with the sweep on a broad grid of inputs.
{
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const note = (midi) => names[midi % 12] + (Math.floor(midi / 12) - 1);
  let checked = 0;
  for (let low = 48; low <= 72; low += 2) {
    for (const span of [7, 12, 19, 21, 24, 31]) {
      for (const voice of [['C3', 'A4'], ['E3', 'E4'], ['C2', 'C6']]) {
        const result = run(note(low), note(low + span), voice[0], voice[1], 'D major');
        const voiceLow = C.parseNote(voice[0], 'v').midi;
        const voiceHigh = C.parseNote(voice[1], 'v').midi;
        const first = Math.max(-12, voiceLow - low);
        const last = Math.min(12, voiceHigh - (low + span));
        const window = first <= last ? Array.from({ length: last - first + 1 }, (_, i) => first + i) : [];
        assert.deepEqual(Array.from(result.fits, (fit) => fit.shift).sort((a, b) => a - b), window,
          `window for ${note(low)}+${span} in ${voice[0]}-${voice[1]}`);
        for (const fit of result.fits) {
          assert.ok(fit.headroomLow >= 0 && fit.headroomHigh >= 0, 'a fit never overflows');
          assert.equal(fit.comfort, Math.min(fit.headroomLow, fit.headroomHigh));
        }
        if (result.fitCount === 0) assert.equal(result.best, null);
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 100, `checked ${checked} grids`);
}

// ---- Octave shifts at both ends of the search window.
{
  const down = run('C3', 'C4', 'C2', 'C3', 'C major');
  assert.equal(down.fitCount, 1);
  assert.equal(down.best.shift, -12);
  assert.equal(down.best.interval, 'octave');
  assert.equal(down.best.melodyLow, 'C2');
  assert.equal(down.best.melodyHigh, 'C3');
  const up = run('C3', 'E3', 'G3', 'C5', 'C major');
  assert.equal(up.best.shift, 12);
  assert.equal(up.best.melodyLow, 'C4');
  assert.equal(up.best.melodyHigh, 'E4');
  assert.equal(up.best.headroomLow, 5);
  assert.equal(up.best.headroomHigh, 8);
}

// ---- Flat spelling follows the key that is landed in.
{
  const flat = run('G3', 'D5', 'C3', 'A4', 'G major');
  assert.equal(flat.best.key, 'Db major');
  assert.equal(flat.best.melodyLow, 'Db3', 'a flat key spells the same pitch with a flat');
  const sharp = run('G3', 'D5', 'C3', 'A4', 'C major');
  assert.equal(sharp.best.key, 'F# major');
  assert.equal(sharp.best.melodyLow, 'C#3', 'a sharp key spells it with a sharp');
  assert.equal(C.parseNote(flat.best.melodyLow, 'n').midi, C.parseNote(sharp.best.melodyLow, 'n').midi,
    'both spellings are the same pitch');
}

// ---- Refusals, by exact message.
const refusal = (input, message) => assert.throws(() => C.analyse(input),
  (error) => { assert.equal(error.message, message); return true; }, `expected "${message}"`);
const base = { melodyLow: 'G3', melodyHigh: 'D5', voiceLow: 'C3', voiceHigh: 'A4', key: 'G major' };
refusal({ ...base, melodyLow: '' }, "Melody's lowest note is required.");
refusal({ ...base, melodyHigh: '  ' }, "Melody's highest note is required.");
refusal({ ...base, voiceLow: '' }, "Voice's lowest note is required.");
refusal({ ...base, voiceHigh: '' }, "Voice's highest note is required.");
refusal({ ...base, melodyLow: 'H3' }, "Melody's lowest note must look like E2, F#3 or Bb4.");
refusal({ ...base, melodyHigh: 'D' }, "Melody's highest note must look like E2, F#3 or Bb4.");
refusal({ ...base, voiceLow: 'C 3' }, "Voice's lowest note must look like E2, F#3 or Bb4.");
refusal({ ...base, voiceHigh: 'C10' }, "Voice's highest note must look like E2, F#3 or Bb4.");
refusal({ ...base, voiceHigh: 'C9' }, "Voice's highest note must be between C0 and B8.");
refusal({ ...base, melodyLow: 'C-1' }, "Melody's lowest note must look like E2, F#3 or Bb4.");
refusal({ ...base, melodyLow: 'D5', melodyHigh: 'G3' }, "The melody's highest note must be above its lowest note.");
refusal({ ...base, melodyLow: 'G3', melodyHigh: 'G3' }, "The melody's highest note must be above its lowest note.");
refusal({ ...base, voiceLow: 'A4', voiceHigh: 'C3' }, "The voice's highest note must be above its lowest note.");
refusal({ ...base, key: 'H major' }, "Choose the song's key from the list.");
refusal({ ...base, key: '' }, "Choose the song's key from the list.");

// ---- Catalog record, totals, and every case stored in the record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2234, 'public tools');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Song Key Fit Planner');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(Array.isArray(record.sources) && record.sources.length >= 3, 'sources present');
assert.ok(record.sources.some((source) => /wikipedia\.org\/wiki\/Transposition_\(music\)/.test(source.url || '')),
  'the transposition reference is cited with its URL');
assert.ok(record.sources.some((source) => /wikipedia\.org\/wiki\/Scientific_pitch_notation/.test(source.url || '')),
  'the pitch notation reference is cited with its URL');
assert.ok(typeof record.method === 'string' && record.method.length > 500, 'method documented');
assert.ok(Array.isArray(record.aliases) && record.aliases.length >= 6, 'aliases present');
assert.ok(Array.isArray(record.tags) && record.tags.length >= 6, 'tags present');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags unique');
assert.ok(record.description.length > 80, 'description present');
assert.ok(record.testCases.length >= 12, `expected at least 12 cases, found ${record.testCases.length}`);
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug unique');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Music').length, 56, 'music category count');
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.ok(!record.aliases.map((alias) => alias.toLowerCase()).includes(other.name.toLowerCase()),
    `alias collides with ${other.slug}`);
  assert.ok(other.name !== record.name, `name collides with ${other.slug}`);
}

for (const testCase of record.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(() => C.analyse(testCase.input), (error) => {
      assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
      return true;
    }, `${label}: expected a refusal`);
    continue;
  }
  const result = C.analyse(testCase.input);
  const expected = testCase.expected;
  assert.equal(result.fitCount, expected.fitCount, `${label}: fit count`);
  if (expected.bestShift === undefined) {
    assert.equal(result.best, null, `${label}: no recommended shift`);
    assert.equal(result.closest.shift, expected.closestShift, `${label}: closest shift`);
    assert.equal(result.closest.overflow, expected.closestOverflow, `${label}: closest overflow`);
    continue;
  }
  assert.equal(result.best.shift, expected.bestShift, `${label}: recommended shift`);
  assert.equal(result.best.key, expected.bestKey, `${label}: recommended key`);
  assert.equal(result.best.melodyLow, expected.bestLow, `${label}: transposed bottom note`);
  assert.equal(result.best.melodyHigh, expected.bestHigh, `${label}: transposed top note`);
  assert.equal(result.best.headroomLow, expected.bestHeadroomLow, `${label}: bottom headroom`);
  assert.equal(result.best.headroomHigh, expected.bestHeadroomHigh, `${label}: top headroom`);
}

// ---- Page contract: inputs, an action, a live result, no network or storage.
assert.match(html, /<label class="f" for="in-melody-low">/, 'melody bottom label');
assert.match(html, /<label class="f" for="in-melody-high">/, 'melody top label');
assert.match(html, /<label class="f" for="in-voice-low">/, 'voice bottom label');
assert.match(html, /<label class="f" for="in-voice-high">/, 'voice top label');
assert.match(html, /<label class="f" for="in-key">/, 'key label');
assert.match(html, /<button type="submit">Find the key<\/button>/, 'submit button');
assert.match(html, /id="out" aria-live="polite"/, 'live result region');
assert.match(html, /<div id="site-header"><\/div>/, 'shared header slot');
assert.match(html, /\/assets\/app\.js/, 'shared app script');
assert.match(html, /id="in-key"><\/select>/, 'key select present');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/onclick=|onchange=|oninput=/.test(html), 'no inline handlers');
assert.ok(!/https?:\/\//.test(html), 'no third-party requests in the page');
