/* Regression checks for the Nashville Number System converter: the degree
   arithmetic both ways, the catalogue cases and the page's offline,
   no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'nashville-number-system-converter';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* nashville-core:start */');
const end = html.indexOf('/* nashville-core:end */');
assert.ok(start > -1 && end > start, 'Nashville core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = NashvilleCore;', sandbox);
const C = sandbox.module.exports;

const convert = (input) => C.convert(input);
const failure = (input) => {
  try {
    convert(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// Independent transcription: a chromatic name table, a letter table and a
// step-by-step accidental shift instead of modular arithmetic.
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const CHROMATIC = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
const SCALE = [0, 2, 4, 5, 7, 9, 11];
const TRIADS = ['', 'm', 'm', '', '', 'm', 'dim'];

function pitchOf(name) {
  const match = /^([A-G])([b#]*)$/.exec(name);
  assert.ok(match, 'bad note name ' + name);
  let pitch = NATURAL[match[1]];
  for (const sign of match[2]) pitch += sign === '#' ? 1 : -1;
  return ((pitch % 12) + 12) % 12;
}

function shift(base, target) {
  // Walk from the letter's natural pitch to the target, one semitone at a
  // time, counting the accidentals needed.
  let pitch = base;
  let steps = 0;
  while (((pitch % 12) + 12) % 12 !== target && steps < 12) {
    pitch += 1;
    steps += 1;
  }
  if (((pitch % 12) + 12) % 12 !== target) return null;
  if (steps > 6) {
    let downPitch = base;
    let down = 0;
    while (((downPitch % 12) + 12) % 12 !== target && down < 12) {
      downPitch -= 1;
      down += 1;
    }
    if (((downPitch % 12) + 12) % 12 === target) return { offset: -down };
    return null;
  }
  return { offset: steps };
}

function oracleKey(raw) {
  const text = String(raw == null ? '' : raw).trim();
  const match = /^([A-Ga-g])([b#]{0,2})$/.exec(text);
  if (!match) throw new Error('key');
  const letter = match[1].toUpperCase();
  const offset = (match[2].match(/#/g) || []).length - (match[2].match(/b/g) || []).length;
  if (match[2].includes('b') && match[2].includes('#')) throw new Error('key');
  return { letter, index: LETTERS.indexOf(letter), pitch: pitchOf(letter + match[2].replace(/#/g, '#').replace(/b/g, 'b')) };
}

function oracleNumber(pitch, keyPitch) {
  return CHROMATIC[((pitch - keyPitch) % 12 + 12) % 12];
}

function oracleSpell(degree, offset, key) {
  const letter = LETTERS[(key.index + degree - 1) % 7];
  const target = ((key.pitch + SCALE[degree - 1] + offset) % 12 + 12) % 12;
  const delta = shift(NATURAL[letter], target);
  if (!delta || delta.offset < -2 || delta.offset > 2) return null;
  return letter + (delta.offset < 0 ? 'b'.repeat(-delta.offset) : '#'.repeat(delta.offset));
}

function oracleChart(keyRaw, direction, chartRaw) {
  const key = oracleKey(keyRaw);
  const raw = String(chartRaw == null ? '' : chartRaw).trim();
  const tokens = raw.replace(/\|/g, ' | ').split(/\s+/).filter(Boolean);
  const rows = [];
  const outside = [];
  let chords = 0;
  for (const token of tokens) {
    if (token === '|') {
      rows.push('|');
      continue;
    }
    chords += 1;
    let number;
    let written;
    if (direction === 'to-numbers') {
      const match = /^([A-Ga-g][b#]{0,2})((?:maj|min|dim|aug|sus|add|alt|no|m|M|[°øΔ+\-()]|[b#]\d{1,2}|\d{1,3})*)(?:\/([A-Ga-g][b#]{0,2}))?$/.exec(token);
      if (!match) throw new Error('chord ' + token);
      number = oracleNumber(pitchOf(match[1].charAt(0).toUpperCase() + match[1].slice(1)), key.pitch);
      const rootName = match[1].charAt(0).toUpperCase() + match[1].slice(1);
      number = oracleNumber(pitchOf(rootName), key.pitch);
      written = number + match[2];
      if (match[3]) written += '/' + oracleNumber(pitchOf(match[3].charAt(0).toUpperCase() + match[3].slice(1)), key.pitch);
    } else {
      const match = /^([b#]{0,2})([1-7])((?:maj|min|dim|aug|sus|add|alt|no|m|M|[°øΔ+\-()]|[b#]\d{1,2}|\d{1,3})*)(?:\/([b#]{0,2})([1-7]))?$/.exec(token);
      if (!match) throw new Error('number ' + token);
      const offset = (match[1].match(/#/g) || []).length - (match[1].match(/b/g) || []).length;
      const root = oracleSpell(Number(match[2]), offset, key);
      if (!root) throw new Error('spelling');
      number = match[1] + match[2];
      written = root + match[3];
      if (match[5]) {
        const bassOffset = (match[4].match(/#/g) || []).length - (match[4].match(/b/g) || []).length;
        written += '/' + oracleSpell(Number(match[5]), bassOffset, key);
      }
    }
    rows.push(written);
    if (number.charAt(0) === 'b' || number.charAt(0) === '#') {
      if (!outside.includes(number)) outside.push(number);
    }
  }
  return { chart: rows.join(' '), chords, outside };
}

// Documented surface.
assert.equal(C.LIMITS.maxChords, 200);
assert.equal(C.LIMITS.accidentals, 2);
assert.deepEqual([...C.LETTERS], LETTERS);
assert.deepEqual([...C.TRIADS], TRIADS);
assert.equal(C.MESSAGES.keyRequired, 'Enter the key, for example C, F or Bb.');
assert.equal(C.MESSAGES.chartLong, 'Keep the chart to 200 chords or fewer.');

// Golden default.
const base = convert({ key: 'C', direction: 'to-numbers', chart: 'C Am F G7 | Dm7 G7 C' });
assert.equal(base.chart, '1 6m 4 57 | 2m7 57 1');
assert.equal(base.chords, 7);
assert.equal(base.bars, 2);
assert.equal(base.outsideCount, 0);
assert.equal(base.outside.length, 0);
assert.equal(base.keyLabel, 'C major');

// Both directions round-trip through the default progression.
const back = convert({ key: 'C', direction: 'to-chords', chart: base.chart });
assert.equal(back.chart, 'C Am F G7 | Dm7 G7 C');

// Borrowed chords are listed once each.
const borrowed = convert({ key: 'C', direction: 'to-numbers', chart: 'C Ab Bb Ab Gb' });
assert.equal(borrowed.chart, '1 b6 b7 b6 b5');
assert.equal(borrowed.outsideCount, 4);
assert.equal(borrowed.outside.join(','), 'b6,b7,b5');

// Slash chords carry the bass degree both ways.
assert.equal(convert({ key: 'C', direction: 'to-numbers', chart: 'C/E Am/C C/Bb' }).chart, '1/3 6m/1 1/b7');
assert.equal(convert({ key: 'C', direction: 'to-chords', chart: '1/3 6m/1 1/b7' }).chart, 'C/E Am/C C/Bb');

// Qualities are copied verbatim, including unicode signs.
assert.equal(convert({ key: 'C', direction: 'to-numbers', chart: 'Cmaj7 Am7 Dm7b5 G7sus4 G7#9' }).chart,
  '1maj7 6m7 2m7b5 57sus4 57#9');
assert.equal(convert({ key: 'C', direction: 'to-chords', chart: '1ø7 4°' }).chart, 'C\u00f87 F\u00b0');

// Key spelling: the seventh of C sharp is B sharp, of C flat is B flat.
assert.equal(convert({ key: 'C#', direction: 'to-chords', chart: '7' }).chart, 'B#');
assert.equal(convert({ key: 'Cb', direction: 'to-chords', chart: '7' }).chart, 'Bb');
assert.equal(convert({ key: 'D', direction: 'to-chords', chart: '3 7' }).chart, 'F# C#');
assert.equal(convert({ key: 'F', direction: 'to-chords', chart: '4 b7' }).chart, 'Bb Eb');

// A flat key prints its flats.
assert.equal(C.table('Bb').map((row) => row.chord).join(' '), 'Bb Cm Dm Eb F Gm Adim');
assert.equal(C.table('C').map((row) => row.quality).join(' '),
  'Major Minor Minor Major Major Minor Diminished');

// Bars count non-empty groups, not pipes.
assert.equal(convert({ key: 'C', direction: 'to-numbers', chart: '| C | F |' }).bars, 2);
assert.equal(convert({ key: 'C', direction: 'to-numbers', chart: 'C|F|G' }).bars, 3);
assert.equal(convert({ key: 'C', direction: 'to-numbers', chart: 'C||F' }).chart, '1 | | 4');

// Grid: every key spelling, every canonical number, several qualities.
const keys = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B', 'Cb'];
const numbers = ['1', '2', '3', '4', '5', '6', '7', 'b2', 'b3', 'b5', 'b6', 'b7'];
const qualities = ['', 'm', '7', 'maj7', 'm7b5', 'sus4'];
let checked = 0;
for (const key of keys) {
  const parsed = oracleKey(key);
  for (const number of numbers) {
    const degree = Number(number.replace(/^[b#]+/, ''));
    const offset = number.startsWith('b') ? -1 : number.startsWith('#') ? 1 : 0;
    const root = oracleSpell(degree, offset, parsed);
    assert.ok(root, 'spelling ' + key + ' ' + number);
    for (const quality of qualities) {
      const chord = root + quality;
      const toNumbers = convert({ key, direction: 'to-numbers', chart: chord });
      assert.equal(toNumbers.chart, number + quality, 'number ' + key + ' ' + chord);
      const toChords = convert({ key, direction: 'to-chords', chart: number + quality });
      assert.equal(toChords.chart, chord, 'chord ' + key + ' ' + number + quality);
      checked += 1;
    }
    // Round trip in both directions.
    const numberChart = convert({ key, direction: 'to-numbers', chart: root });
    assert.equal(convert({ key, direction: 'to-chords', chart: numberChart.chart }).chart, root,
      'round trip ' + key + ' ' + number);
  }
  // Every pitch class has exactly one canonical number.
  for (let pitch = 0; pitch < 12; pitch += 1) {
    const number = C.numberFor(pitch, parsed.pitch);
    assert.equal(oracleNumber(pitch, parsed.pitch), number, 'numberFor ' + key + ' ' + pitch);
    assert.ok(numbers.includes(number), 'canonical number ' + number);
  }
}

// Grid against the independent oracle for charts with bars and borrowed chords.
const chartGrid = [
  ['C', 'C Am F G7 | Dm7 G7 C'],
  ['G', 'G C D Em | Am D7 G'],
  ['F', 'F Bb C7 F | Dm Gm C7'],
  ['Bb', 'Bb Eb F Bb | Gm Cm F7'],
  ['Eb', 'Eb Ab Bb7 Eb | Cm Fm Bb7'],
  ['Ab', 'Ab Db Eb7 Ab | Fm Bbm Eb7'],
  ['Db', 'Db Gb Ab7 Db | Bbm Ebm Ab7'],
  ['Gb', 'Gb Cb Db7 Gb | Ebm Abm Db7'],
  ['B', 'B E F#7 B | G#m C#m F#7'],
  ['E', 'E A B7 E | C#m F#m B7'],
  ['A', 'A D E7 A | F#m Bm E7'],
  ['D', 'D G A7 D | Bm Em A7'],
  ['C', 'C Ab Bb Fm | C/E Am/C C/Bb'],
  ['D', 'D F C G A#dim'],
];
for (const [key, chart] of chartGrid) {
  const result = convert({ key, direction: 'to-numbers', chart });
  const expected = oracleChart(key, 'to-numbers', chart);
  assert.equal(result.chart, expected.chart, 'oracle chart ' + key + ' ' + chart);
  assert.equal(result.chords, expected.chords, 'oracle chords ' + key);
  assert.equal(result.outside.join(','), expected.outside.join(','), 'oracle outside ' + key + ' ' + chart);
  // Reading the numbers back returns the same pitch classes.
  const reread = convert({ key, direction: 'to-chords', chart: result.chart });
  assert.equal(reread.chords, result.chords, 'reread chords ' + key);
}

// Refusals name the offending token.
assert.equal(failure({ key: '', direction: 'to-numbers', chart: 'C' }),
  'Enter the key, for example C, F or Bb.');
assert.equal(failure({ key: 'H', direction: 'to-numbers', chart: 'C' }),
  'The key must be a letter A to G with at most two sharps or flats.');
assert.equal(failure({ key: 'C4', direction: 'to-numbers', chart: 'C' }),
  'The key must be a letter A to G with at most two sharps or flats.');
assert.equal(failure({ key: 'C#b', direction: 'to-numbers', chart: 'C' }),
  'The key must be a letter A to G with at most two sharps or flats.');
assert.equal(failure({ key: 'C', direction: 'to-numbers', chart: '  ' }),
  'Enter a chord chart to convert.');
assert.equal(failure({ key: 'C', direction: 'to-numbers', chart: '| |' }),
  'Enter a chord chart to convert.');
assert.equal(failure({ key: 'C', direction: 'to-numbers', chart: 'H7' }),
  '"H7" is not a chord: start with a root note A to G, then a quality such as m, 7 or maj7.');
assert.equal(failure({ key: 'C', direction: 'to-numbers', chart: 'Cfoo' }),
  '"Cfoo" is not a chord: start with a root note A to G, then a quality such as m, 7 or maj7.');
assert.equal(failure({ key: 'C', direction: 'to-numbers', chart: 'C#b7' }),
  '"C#b7" is not a chord: start with a root note A to G, then a quality such as m, 7 or maj7.');
assert.equal(failure({ key: 'C', direction: 'to-numbers', chart: 'C/H' }),
  '"C/H" needs a bass note after the slash, for example C/E.');
assert.equal(failure({ key: 'C', direction: 'to-numbers', chart: 'C/E/G' }),
  '"C/E/G" has more than one slash; use at most one bass note.');
assert.equal(failure({ key: 'C', direction: 'to-numbers', chart: 'C6/9' }),
  '"C6/9" puts a number after the slash; write six-nine chords as 6add9.');
assert.equal(failure({ key: 'C', direction: 'to-chords', chart: '8' }),
  '"8" is not a number: use 1 to 7 with an optional b or #, then a quality such as m or 7.');
assert.equal(failure({ key: 'C', direction: 'to-chords', chart: '1mfoo' }),
  '"1mfoo" is not a number: use 1 to 7 with an optional b or #, then a quality such as m or 7.');
assert.equal(failure({ key: 'C', direction: 'to-chords', chart: '1/x' }),
  '"1/x" needs a number 1 to 7 after the slash, for example 1/3.');
assert.equal(failure({ key: 'C', direction: 'sideways', chart: 'C' }),
  'Choose whether to convert chords to numbers or numbers to chords.');
assert.equal(failure({ key: 'C', direction: 'to-numbers', chart: 'C '.repeat(201).trim() }),
  'Keep the chart to 200 chords or fewer.');
// The key is checked before the chart, and the chart length before any token.
assert.equal(failure({ key: '', direction: 'to-numbers', chart: 'H7' }),
  'Enter the key, for example C, F or Bb.');
assert.equal(failure({ key: 'C', direction: 'to-numbers', chart: ('H '.repeat(200) + 'H').trim() }),
  'Keep the chart to 200 chords or fewer.');

// Double accidentals are accepted where the spelling needs them.
assert.equal(convert({ key: 'C', direction: 'to-chords', chart: '#4' }).chart, 'F#');
assert.equal(convert({ key: 'C', direction: 'to-chords', chart: 'b4' }).chart, 'Fb');
assert.equal(convert({ key: 'C', direction: 'to-numbers', chart: 'Fb' }).chart, '3');
assert.equal(convert({ key: 'C', direction: 'to-numbers', chart: 'F#' }).chart, 'b5');

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Music');
assert.equal(entry.subcategory, 'Conversion');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 900, 'method must describe the arithmetic');
assert.ok(entry.testCases.length >= 30, 'expected at least thirty catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = convert(testCase.input);
    for (const [field, value] of Object.entries(testCase.expected)) {
      assert.equal(JSON.stringify(result[field]), JSON.stringify(value), testCase.name + ' ' + field);
    }
  }
}

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="nashville-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('aria-describedby'), 'fields must reference their help text');
for (const id of ['key', 'direction', 'chart']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label ' + id + ' missing');
  assert.ok(html.includes('aria-describedby="' + id + '-hint"'), 'help reference ' + id + ' missing');
}
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet missing');
assert.ok(html.includes('type="submit"'), 'submit button missing');
assert.ok(html.includes('id="reset"'), 'reset button missing');

console.log('Nashville number converter: ' + entry.testCases.length + ' catalog cases, '
  + checked + ' grid rows and invariants passed');
