/* Regression checks for the harmonic mixing key finder: the two rings are
   rebuilt by transposition and compared with the page's tables, the Open Key
   codes come from a literal published conversion table, and the catalog cases,
   the four mix moves and the page's offline contract are all replayed. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'harmonic-mixing-key-finder';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* camelot-core:start */');
const end = html.indexOf('/* camelot-core:end */');
assert.ok(start > -1 && end > start, 'camelot core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CamelotCore;', sandbox);
const C = sandbox.module.exports;

const convert = (value) => C.convert(value);
const failure = (value) => {
  try {
    convert(value);
  } catch (error) {
    return error.message;
  }
  return null;
};

// Independent note arithmetic: letter pitch plus one step per accidental.
const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function pitchOf(name) {
  const match = /^([A-G])([#b]*)(?:\s|$)/.exec(name);
  assert.ok(match, 'bad note name ' + name);
  let pitch = NATURAL[match[1]];
  for (const sign of match[2]) pitch += sign === '#' ? 1 : -1;
  return ((pitch % 12) + 12) % 12;
}

// Rebuild the wheel from the 8A = A minor anchor: one number on is a perfect
// fifth (seven semitones), and the major ring sits three semitones above.
const MINOR_NAMES = {};
const MAJOR_NAMES = {};
let pitch = pitchOf('A');
for (let step = 0, number = 8; step < 12; step += 1, number = (number % 12) + 1) {
  MINOR_NAMES[number] = C.nameOf(number, 'minor');
  MAJOR_NAMES[number] = C.nameOf(number, 'major');
  assert.equal(pitchOf(C.nameOf(number, 'minor')), pitch, 'minor ring pitch at ' + number);
  assert.equal(pitchOf(C.nameOf(number, 'major')), (pitch + 3) % 12, 'major ring pitch at ' + number);
  pitch = (pitch + 7) % 12;
}

// Literal conversion table from the published charts (Camelot -> Open Key).
const OPEN_KEY = {
  '1A': '6m', '2A': '7m', '3A': '8m', '4A': '9m', '5A': '10m', '6A': '11m',
  '7A': '12m', '8A': '1m', '9A': '2m', '10A': '3m', '11A': '4m', '12A': '5m',
  '1B': '6d', '2B': '7d', '3B': '8d', '4B': '9d', '5B': '10d', '6B': '11d',
  '7B': '12d', '8B': '1d', '9B': '2d', '10B': '3d', '11B': '4d', '12B': '5d',
};

// Every position: code, Open Key and canonical name agree in both directions.
let positions = 0;
for (let number = 1; number <= 12; number += 1) {
  for (const mode of ['minor', 'major']) {
    const code = C.codeOf(number, mode);
    const key = C.nameOf(number, mode);
    assert.equal(code, number + (mode === 'minor' ? 'A' : 'B'));
    assert.equal(C.openKeyOf(number, mode), OPEN_KEY[code], 'Open Key for ' + code);
    const fromName = convert(key);
    assert.equal(fromName.camelot, code, 'name to code ' + key);
    assert.equal(fromName.openKey, OPEN_KEY[code], 'name to Open Key ' + key);
    assert.equal(fromName.mode, mode);
    assert.equal(fromName.also, null, 'canonical name reports no alternate spelling');
    const fromCode = convert(code);
    assert.equal(fromCode.key, key, 'code to name ' + code);
    assert.equal(fromCode.openKey, OPEN_KEY[code]);
    const fromOpen = convert(OPEN_KEY[code]);
    assert.equal(fromOpen.camelot, code, 'Open Key to code ' + OPEN_KEY[code]);
    assert.equal(fromOpen.key, key, 'Open Key to name ' + OPEN_KEY[code]);
    positions += 1;
  }
}
assert.equal(Object.keys(OPEN_KEY).length, 24, 'conversion table size');
assert.equal(new Set(Object.keys(MINOR_NAMES)).size, 12);
assert.equal(new Set(Object.values(MINOR_NAMES)).size, 12, 'minor ring names unique');
assert.equal(new Set(Object.values(MAJOR_NAMES)).size, 12, 'major ring names unique');
assert.equal(positions, 24);

// The page's own wheel literal must agree with the rebuilt ring.
assert.equal(C.WHEEL.length, 12);
for (const row of C.WHEEL) {
  assert.equal(row.minor, MINOR_NAMES[row.number], 'wheel literal minor ' + row.number);
  assert.equal(row.major, MAJOR_NAMES[row.number], 'wheel literal major ' + row.number);
}

// Documented messages.
assert.equal(C.MESSAGES.required, 'Enter a key such as A minor, F# major or 8A.');
assert.equal(C.MESSAGES.camelotRange, 'Camelot numbers run from 1 to 12, so use 1A to 12B.');
assert.equal(C.MESSAGES.openKeyRange, 'Open Key numbers run from 1 to 12, so use 1m to 12d.');

// The four mix moves from A minor, in the documented order.
const base = convert('A minor');
assert.equal(base.key, 'A minor');
assert.equal(base.camelot, '8A');
assert.equal(base.openKey, '1m');
assert.equal(base.mode, 'minor');
assert.equal(base.typed, 'A minor');
assert.equal(base.also, null);
assert.deepEqual(JSON.parse(JSON.stringify(base.mixable)), [
  { key: 'A minor', camelot: '8A', openKey: '1m', relation: 'same key' },
  { key: 'E minor', camelot: '9A', openKey: '2m', relation: 'a fifth up, one number on' },
  { key: 'D minor', camelot: '7A', openKey: '12m', relation: 'a fifth down, one number back' },
  { key: 'C major', camelot: '8B', openKey: '1d', relation: 'relative major' },
]);

// The major ring lists the relative minor last.
const major = convert('C major');
assert.deepEqual(JSON.parse(JSON.stringify(major.mixable.map((row) => row.camelot))),
  ['8B', '9B', '7B', '8A']);
assert.equal(major.mixable[3].relation, 'relative minor');
assert.equal(major.mixable[3].key, 'A minor');

// The wheel wraps at twelve and at one.
assert.deepEqual(JSON.parse(JSON.stringify(convert('12A').mixable.map((row) => row.camelot))),
  ['12A', '1A', '11A', '12B']);
assert.deepEqual(JSON.parse(JSON.stringify(convert('1A').mixable.map((row) => row.camelot))),
  ['1A', '2A', '12A', '1B']);

// Every mix row is a real position with matching codes.
for (let number = 1; number <= 12; number += 1) {
  for (const mode of ['minor', 'major']) {
    const result = convert(C.codeOf(number, mode));
    assert.equal(result.mixable.length, 4);
    for (const row of result.mixable) {
      assert.equal(row.openKey, OPEN_KEY[row.camelot], 'mix row Open Key ' + row.camelot);
      assert.equal(row.key, convert(row.camelot).key, 'mix row round trip ' + row.camelot);
    }
    const codes = new Set(result.mixable.map((row) => row.camelot));
    assert.equal(codes.size, 4, 'four different codes from ' + C.codeOf(number, mode));
  }
}

// Enharmonic spellings are reported, not hidden.
assert.equal(convert('G# minor').key, 'Ab minor');
assert.equal(convert('G# minor').also, 'G# minor');
assert.equal(convert('Gb major').key, 'F# major');
assert.equal(convert('Cb major').key, 'B major');
assert.equal(convert('B# major').key, 'C major');
assert.equal(convert('A# minor').key, 'Bb minor');
assert.equal(convert('C##').key, 'D major');
assert.equal(convert('Dbb').key, 'C major');
assert.equal(convert('C##').also, 'C## major');

// Spelling is normalised but never invented.
assert.equal(convert('  a MINOR ').key, 'A minor');
assert.equal(convert('Aminor').key, 'A minor');
assert.equal(convert('07a').camelot, '7A');
assert.equal(convert('F\u266f minor').camelot, '11A');
assert.equal(convert('B\u266d major').camelot, '6B');
assert.equal(convert('12m').key, 'D minor');
assert.equal(convert('5m').key, 'C# minor');
assert.equal(convert('8a').camelot, '8A');

// Refusals name the problem.
assert.equal(failure(''), 'Enter a key such as A minor, F# major or 8A.');
assert.equal(failure('   '), 'Enter a key such as A minor, F# major or 8A.');
assert.equal(failure('H minor'),
  'That is not a key or code: write a note such as F# minor, a Camelot code such as 8A, or an Open Key code such as 1m.');
assert.equal(failure('C4'),
  'That is not a key or code: write a note such as F# minor, a Camelot code such as 8A, or an Open Key code such as 1m.');
assert.equal(failure('8C'),
  'That is not a key or code: write a note such as F# minor, a Camelot code such as 8A, or an Open Key code such as 1m.');
assert.equal(failure('A minor 8A'),
  'That is not a key or code: write a note such as F# minor, a Camelot code such as 8A, or an Open Key code such as 1m.');
assert.equal(failure('-8A'),
  'That is not a key or code: write a note such as F# minor, a Camelot code such as 8A, or an Open Key code such as 1m.');
assert.equal(failure('C#b major'), 'Use at most two sharps or flats, and do not mix them.');
assert.equal(failure('C blues'),
  'Write the mode as minor or major, or leave it off for major; a single m means minor.');
assert.equal(failure('CM'),
  'Write the mode as minor or major, or leave it off for major; a single m means minor.');
assert.equal(failure('13A'), 'Camelot numbers run from 1 to 12, so use 1A to 12B.');
assert.equal(failure('0A'), 'Camelot numbers run from 1 to 12, so use 1A to 12B.');
assert.equal(failure('13m'), 'Open Key numbers run from 1 to 12, so use 1m to 12d.');

// The 24-row reference table is generated from the same tables.
const rows = C.chart();
assert.equal(rows.length, 24);
assert.equal(new Set(rows.map((row) => row.camelot)).size, 24);
for (const row of rows) {
  assert.equal(row.openKey, OPEN_KEY[row.camelot], 'chart Open Key ' + row.camelot);
  const other = row.camelot.slice(-1) === 'A' ? row.camelot.slice(0, -1) + 'B' : row.camelot.slice(0, -1) + 'A';
  assert.equal(row.relative, convert(other).key, 'chart relative ' + row.camelot);
  assert.equal(row.key, convert(row.camelot).key);
}

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
    assert.equal(failure(testCase.input.value), testCase.expectedError, testCase.name);
  } else {
    const result = convert(testCase.input.value);
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
assert.ok(html.includes('<form id="camelot-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('aria-describedby'), 'fields must reference their help text');
for (const id of ['key']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label ' + id + ' missing');
  assert.ok(html.includes('aria-describedby="' + id + '-hint"'), 'help reference ' + id + ' missing');
}
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet missing');
assert.ok(html.includes('type="submit"'), 'submit button missing');
assert.ok(html.includes('id="reset"'), 'reset button missing');
assert.ok(html.includes('<details'), 'reference table should be collapsible');

console.log('Harmonic mixing key finder: ' + entry.testCases.length + ' catalog cases, '
  + positions + ' positions round-tripped through both notations and the mix moves passed');
