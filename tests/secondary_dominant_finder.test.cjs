/* Regression checks for the secondary-dominant and borrowed-chord core, its catalog
   cases and the page's offline, no-storage contract. The spelled notes are checked
   against hand-written tables for five keys and, for every key and mode, against
   pitch-class arithmetic that never touches the core's chord builder: an applied
   dominant must sit a fifth above its target with its third a semitone below it. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'secondary-dominant-finder';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* chord-finder-core:start */');
const end = html.indexOf('/* chord-finder-core:end */');
assert.ok(start > -1 && end > start, 'chord finder core markers missing');
const core = html.slice(start, end + '/* chord-finder-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ChordFinderCore;', sandbox);
const C = sandbox.module.exports;

const SHARP = '\u266f';
const FLAT = '\u266d';
const LETTERS = 'CDEFGAB';
const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

function splitNote(name) {
  const letter = name[0];
  let offset = 0;
  for (const symbol of name.slice(1)) {
    if (symbol === SHARP) offset += 1;
    else if (symbol === FLAT) offset -= 1;
    else throw new Error('bad accidental in ' + name);
  }
  return { letter, offset };
}
const pcOf = (name) => {
  const { letter, offset } = splitNote(name);
  return ((NATURAL[letter] + offset) % 12 + 12) % 12;
};
const splitSymbol = (symbol) => {
  let index = 1;
  while (index < symbol.length && (symbol[index] === SHARP || symbol[index] === FLAT)) index += 1;
  return [symbol.slice(0, index), symbol.slice(index)];
};
const run = (key, mode) => C.calculate({ key, mode });
const failure = (key, mode) => {
  try {
    C.calculate({ key, mode });
  } catch (error) {
    return error.message;
  }
  return null;
};

// Documented surface.
assert.deepEqual({ ...C.DEFAULTS }, { key: 'C', mode: 'major' });
assert.deepEqual(Array.from(C.KEYS), ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']);
assert.deepEqual({ ...C.MODES }, { major: 'Major', minor: 'Minor' });
assert.equal(C.MESSAGES.key, 'Choose a key from the list.');
assert.equal(C.MESSAGES.mode, 'Choose major or minor.');

// Hand-written expectations, one table per key.
const HAND = {
  'C|major': {
    signature: 'no sharps or flats',
    scale: 'C D E F G A B',
    applied: [
      ['V7/ii', 'A7', 'A C\u266f E G', 'Dm'],
      ['V7/iii', 'B7', 'B D\u266f F\u266f A', 'Em'],
      ['V7/IV', 'C7', 'C E G B\u266d', 'F'],
      ['V7/V', 'D7', 'D F\u266f A C', 'G'],
      ['V7/vi', 'E7', 'E G\u266f B D', 'Am'],
    ],
    borrowed: [
      ['iv', 'Fm', 'F A\u266d C'],
      ['\u266dVI', 'A\u266d', 'A\u266d C E\u266d'],
      ['\u266dVII', 'B\u266d', 'B\u266d D F'],
      ['\u266dIII', 'E\u266d', 'E\u266d G B\u266d'],
      ['\u266dII', 'D\u266d', 'D\u266d F A\u266d'],
    ],
  },
  'Eb|major': {
    signature: '3 flats',
    scale: 'E\u266d F G A\u266d B\u266d C D',
    applied: [
      ['V7/ii', 'C7', 'C E G B\u266d', 'Fm'],
      ['V7/iii', 'D7', 'D F\u266f A C', 'Gm'],
      ['V7/IV', 'E\u266d7', 'E\u266d G B\u266d D\u266d', 'A\u266d'],
      ['V7/V', 'F7', 'F A C E\u266d', 'B\u266d'],
      ['V7/vi', 'G7', 'G B D F', 'Cm'],
    ],
    borrowed: [
      ['iv', 'A\u266dm', 'A\u266d C\u266d E\u266d'],
      ['\u266dVI', 'C\u266d', 'C\u266d E\u266d G\u266d'],
      ['\u266dVII', 'D\u266d', 'D\u266d F A\u266d'],
      ['\u266dIII', 'G\u266d', 'G\u266d B\u266d D\u266d'],
      ['\u266dII', 'F\u266d', 'F\u266d A\u266d C\u266d'],
    ],
  },
  'F#|major': {
    signature: '6 sharps',
    scale: 'F\u266f G\u266f A\u266f B C\u266f D\u266f E\u266f',
    applied: [
      ['V7/ii', 'D\u266f7', 'D\u266f F\u266f\u266f A\u266f C\u266f', 'G\u266fm'],
      ['V7/iii', 'E\u266f7', 'E\u266f G\u266f\u266f B\u266f D\u266f', 'A\u266fm'],
      ['V7/IV', 'F\u266f7', 'F\u266f A\u266f C\u266f E', 'B'],
      ['V7/V', 'G\u266f7', 'G\u266f B\u266f D\u266f F\u266f', 'C\u266f'],
      ['V7/vi', 'A\u266f7', 'A\u266f C\u266f\u266f E\u266f G\u266f', 'D\u266fm'],
    ],
    borrowed: [
      ['iv', 'Bm', 'B D F\u266f'],
      ['\u266dVI', 'D', 'D F\u266f A'],
      ['\u266dVII', 'E', 'E G\u266f B'],
      ['\u266dIII', 'A', 'A C\u266f E'],
      ['\u266dII', 'G', 'G B D'],
    ],
  },
  'C|minor': {
    signature: '3 flats',
    scale: 'C D E\u266d F G A\u266d B\u266d',
    applied: [
      ['V7/III', 'B\u266d7', 'B\u266d D F A\u266d', 'E\u266d'],
      ['V7/iv', 'C7', 'C E G B\u266d', 'Fm'],
      ['V7/v', 'D7', 'D F\u266f A C', 'Gm'],
      ['V7/VI', 'E\u266d7', 'E\u266d G B\u266d D\u266d', 'A\u266d'],
      ['V7/VII', 'F7', 'F A C E\u266d', 'B\u266d'],
    ],
    borrowed: [
      ['IV', 'F', 'F A C'],
      ['V', 'G', 'G B D'],
      ['I', 'C', 'C E G'],
    ],
  },
  'A|minor': {
    signature: 'no sharps or flats',
    scale: 'A B C D E F G',
    applied: [
      ['V7/III', 'G7', 'G B D F', 'C'],
      ['V7/iv', 'A7', 'A C\u266f E G', 'Dm'],
      ['V7/v', 'B7', 'B D\u266f F\u266f A', 'Em'],
      ['V7/VI', 'C7', 'C E G B\u266d', 'F'],
      ['V7/VII', 'D7', 'D F\u266f A C', 'G'],
    ],
    borrowed: [
      ['IV', 'D', 'D F\u266f A'],
      ['V', 'E', 'E G\u266f B'],
      ['I', 'A', 'A C\u266f E'],
    ],
  },
};

for (const [label, expected] of Object.entries(HAND)) {
  const [key, mode] = label.split('|');
  const result = run(key, mode);
  assert.equal(result.signature, expected.signature, label + ' signature');
  assert.equal(result.scaleNotes, expected.scale, label + ' scale');
  assert.equal(result.applied.length, expected.applied.length, label + ' applied count');
  expected.applied.forEach(([numeral, symbol, notes, target], index) => {
    const row = result.applied[index];
    assert.equal(row.numeral, numeral, label + ' applied numeral ' + index);
    assert.equal(row.symbol, symbol, label + ' applied symbol ' + numeral);
    assert.equal(row.notes, notes, label + ' applied notes ' + numeral);
    assert.equal(row.targetSymbol, target, label + ' applied target ' + numeral);
  });
  assert.equal(result.borrowed.length, expected.borrowed.length, label + ' borrowed count');
  expected.borrowed.forEach(([roman, symbol, notes], index) => {
    const row = result.borrowed[index];
    assert.equal(row.roman, roman, label + ' borrowed roman ' + index);
    assert.equal(row.symbol, symbol, label + ' borrowed symbol ' + roman);
    assert.equal(row.notes, notes, label + ' borrowed notes ' + roman);
  });
}

// Key signatures: accidentals counted from the circle of fifths, not from the core.
const SIGNATURES = [
  ['C', 'major', 'no sharps or flats', 'none', 0],
  ['C', 'minor', '3 flats', 'flats', 3],
  ['C#', 'major', '7 sharps', 'sharps', 7],
  ['C#', 'minor', '4 sharps', 'sharps', 4],
  ['Db', 'major', '5 flats', 'flats', 5],
  ['Db', 'minor', '8 flats', 'flats', 8],
  ['D', 'major', '2 sharps', 'sharps', 2],
  ['D', 'minor', '1 flat', 'flats', 1],
  ['Eb', 'major', '3 flats', 'flats', 3],
  ['Eb', 'minor', '6 flats', 'flats', 6],
  ['E', 'major', '4 sharps', 'sharps', 4],
  ['E', 'minor', '1 sharp', 'sharps', 1],
  ['F', 'major', '1 flat', 'flats', 1],
  ['F', 'minor', '4 flats', 'flats', 4],
  ['F#', 'major', '6 sharps', 'sharps', 6],
  ['F#', 'minor', '3 sharps', 'sharps', 3],
  ['Gb', 'major', '6 flats', 'flats', 6],
  ['Gb', 'minor', '9 flats', 'flats', 9],
  ['G', 'major', '1 sharp', 'sharps', 1],
  ['G', 'minor', '2 flats', 'flats', 2],
  ['Ab', 'major', '4 flats', 'flats', 4],
  ['Ab', 'minor', '7 flats', 'flats', 7],
  ['A', 'major', '3 sharps', 'sharps', 3],
  ['A', 'minor', 'no sharps or flats', 'none', 0],
  ['Bb', 'major', '2 flats', 'flats', 2],
  ['Bb', 'minor', '5 flats', 'flats', 5],
  ['B', 'major', '5 sharps', 'sharps', 5],
  ['B', 'minor', '2 sharps', 'sharps', 2],
];
assert.equal(SIGNATURES.length, C.KEYS.length * 2, 'every key and mode is pinned');
for (const [key, mode, signature, kind, count] of SIGNATURES) {
  const result = run(key, mode);
  assert.equal(result.signature, signature, key + ' ' + mode + ' signature text');
  assert.equal(result.accidentalKind, kind, key + ' ' + mode + ' accidental kind');
  assert.equal(result.accidentalCount, count, key + ' ' + mode + ' accidental count');
}

// The whole envelope: spelling and interval invariants that never use the chord builder.
let compared = 0;
for (const key of C.KEYS) {
  for (const mode of ['major', 'minor']) {
    const result = run(key, mode);
    const steps = mode === 'major' ? MAJOR_STEPS : MINOR_STEPS;
    const scale = result.scaleNotes.split(' ');
    assert.equal(scale.length, 7, key + ' ' + mode + ' scale length');
    const rootPc = pcOf(scale[0]);
    scale.forEach((note, index) => {
      assert.equal(pcOf(note), (rootPc + steps[index]) % 12, key + ' ' + mode + ' scale pitch ' + index);
      const { letter } = splitNote(note);
      assert.equal(letter, LETTERS[(LETTERS.indexOf(splitNote(scale[0]).letter) + index) % 7],
        key + ' ' + mode + ' scale letter ' + index);
    });
    assert.equal(new Set(scale).size, 7, key + ' ' + mode + ' scale repeats a note');

    const checkChord = (tones, rootPc, intervals, tag) => {
      assert.equal(tones.length, intervals.length, tag + ' tone count');
      const letters = tones.map((tone) => splitNote(tone).letter);
      const rootLetter = letters[0];
      letters.forEach((letter, index) => {
        assert.equal(letter, LETTERS[(LETTERS.indexOf(rootLetter) + 2 * index) % 7], tag + ' letter ' + index);
      });
      assert.equal(new Set(letters).size, tones.length, tag + ' repeats a letter');
      tones.forEach((tone, index) => {
        assert.equal(pcOf(tone), (rootPc + intervals[index]) % 12, tag + ' pitch ' + index);
        assert.ok(Math.abs(splitNote(tone).offset) <= 2, tag + ' accidental range ' + tone);
      });
    };
    const qualities = { '': [0, 4, 7], m: [0, 3, 7], '\u00b0': [0, 3, 6] };
    for (const chord of result.diatonic) {
      const [, quality] = splitSymbol(chord.symbol);
      checkChord(chord.notes.split(' '), pcOf(chord.root), qualities[quality], key + ' ' + mode + ' ' + chord.roman);
    }
    for (const row of result.applied) {
      const tones = row.notes.split(' ');
      assert.equal(tones.length, 4, key + ' ' + mode + ' ' + row.numeral + ' is a seventh chord');
      assert.ok(row.symbol.endsWith('7'), key + ' ' + mode + ' ' + row.numeral + ' symbol');
      const targetPc = pcOf(row.targetRoot);
      assert.equal(pcOf(tones[0]), (targetPc + 7) % 12, key + ' ' + mode + ' ' + row.numeral + ' root');
      assert.equal(pcOf(tones[1]), (targetPc + 11) % 12, key + ' ' + mode + ' ' + row.numeral + ' third');
      assert.equal(pcOf(tones[2]), (targetPc + 2) % 12, key + ' ' + mode + ' ' + row.numeral + ' fifth');
      assert.equal(pcOf(tones[3]), (targetPc + 5) % 12, key + ' ' + mode + ' ' + row.numeral + ' seventh');
      assert.equal(row.numeral, 'V7/' + row.targetRoman, key + ' ' + mode + ' numeral');
      assert.equal(pcOf(splitSymbol(row.targetSymbol)[0]), targetPc, key + ' ' + mode + ' target symbol');
      checkChord(tones, pcOf(tones[0]), [0, 4, 7, 10], key + ' ' + mode + ' ' + row.numeral);
      compared += 1;
    }
    for (const row of result.borrowed) {
      const tones = row.notes.split(' ');
      checkChord(tones, pcOf(tones[0]),
        row.symbol.endsWith('m') ? [0, 3, 7] : [0, 4, 7], key + ' ' + mode + ' borrowed ' + row.roman);
    }
    assert.equal(result.appliedNumerals.join('|'), result.applied.map((row) => row.numeral).join('|'));
    assert.equal(result.appliedSymbols.join('|'), result.applied.map((row) => row.symbol).join('|'));
    assert.equal(result.borrowedNumerals.join('|'), result.borrowed.map((row) => row.roman).join('|'));
    assert.equal(result.borrowedSymbols.join('|'), result.borrowed.map((row) => row.symbol).join('|'));
  }
}
assert.ok(compared >= 140, 'applied dominants compared: ' + compared);

// Input handling: surrounding space and mode case are tolerated, anything else is refused.
assert.equal(run(' C ', 'Major').signature, 'no sharps or flats');
assert.equal(run('Eb', 'MINOR').mode, 'minor', 'mode names are case insensitive');
assert.equal(failure('eb', 'minor'), C.MESSAGES.key, 'lowercase keys are refused rather than guessed');
assert.equal(failure('Cb', 'major'), C.MESSAGES.key);
assert.equal(failure('E#', 'major'), C.MESSAGES.key);
assert.equal(failure('B#', 'minor'), C.MESSAGES.key);
assert.equal(failure('', 'major'), C.MESSAGES.key);
assert.equal(failure(null, 'major'), C.MESSAGES.key);
assert.equal(failure('C', ''), C.MESSAGES.mode);
assert.equal(failure('C', 'dorian'), C.MESSAGES.mode);
assert.equal(failure('C', 'aeolian'), C.MESSAGES.mode);
assert.equal(failure('C', null), C.MESSAGES.mode);

// Catalog replay, both directions.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2304, 'catalog total');
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(entry.name, 'Secondary Dominant & Borrowed Chord Finder');
assert.equal(entry.category, 'Music');
assert.equal(entry.subcategory, 'Reference');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.sources.length, 2);
for (const source of entry.sources) {
  assert.match(source.url, /^https:\/\/openmusictheory\.github\.io\//);
  assert.match(source.title, /Open Music Theory/);
}
assert.match(entry.guidance, /natural minor/, 'guidance names the stated scale');
assert.match(entry.method, /double sharps/, 'method names the spelling limit');
assert.ok(entry.testCases.length >= 26, 'at least twenty-six catalog cases');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Music').length, 45, 'Music count');
let goldenCases = 0;
let validationCases = 0;
for (const testCase of entry.testCases) {
  const { key, mode } = testCase.input;
  if (testCase.kind === 'golden') {
    const result = run(key, mode);
    for (const [field, value] of Object.entries(testCase.expected)) {
      if (Array.isArray(value)) {
        assert.deepEqual(Array.from(result[field]), value, testCase.name + ' ' + field);
      } else {
        assert.equal(result[field], value, testCase.name + ' ' + field);
      }
    }
    goldenCases += 1;
  } else {
    assert.equal(failure(key, mode), testCase.expected.error, testCase.name);
    validationCases += 1;
  }
}
assert.ok(goldenCases >= 10, 'golden cases: ' + goldenCases);
assert.ok(validationCases >= 8, 'validation cases: ' + validationCases);

// Slug and name stay unique, and no neighbouring record already answers the question.
for (const field of ['slug', 'name']) {
  const values = catalog.tools.map((tool) => String(tool[field]).toLowerCase());
  assert.equal(new Set(values).size, values.length, 'duplicate ' + field);
}
const rivals = ['secondary-dominant-calculator', 'applied-chord-finder', 'borrowed-chord-finder',
  'modal-mixture-finder', 'secondary-dominants-calculator'];
for (const rival of rivals) assert.ok(!catalog.tools.some((tool) => tool.slug === rival), 'competing record ' + rival);
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  const text = [tool.slug, tool.name, tool.description, (tool.aliases || []).join(' ')].join(' ').toLowerCase();
  assert.ok(!text.includes('secondary dominant'), 'another record claims secondary dominants: ' + tool.slug);
  assert.ok(!text.includes('applied dominant'), 'another record claims applied dominants: ' + tool.slug);
  const claims = [tool.name, tool.slug, (tool.aliases || []).join(' ')].join(' ').toLowerCase();
  assert.ok(!claims.includes('borrowed chord'), 'another tool is named for borrowed chords: ' + tool.slug);
}

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/https?:\/\/[a-z]/i.test(html.replace(/http:\/\/www\.w3\.org/g, '')),
  'page must not reference an external URL');
assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(html), 'page source must stay ASCII');
assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'page needs exactly one h1');
assert.ok(html.includes('<form id="sdf-form"'), 'page form missing');
assert.ok(html.includes('type="submit"'), 'page needs an explicit submit button');
assert.ok(html.includes('type="button"'), 'reset needs an explicit type');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('min-height:44px'), 'controls must keep a 44 px target');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
for (const id of ['in-key', 'in-mode', 'err', 'out', 'reset', 'key-help', 'mode-help']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
}
for (const match of html.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'getElementById(' + match[1] + ') has no element');
}
for (const match of html.matchAll(/<label class="f" for="([^"]+)"/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'label for ' + match[1] + ' has no control');
}
// The key select lists exactly the keys the core accepts, with C/major selected.
const selectBlock = html.slice(html.indexOf('<select id="in-key"'), html.indexOf('</select>', html.indexOf('<select id="in-key"')));
const optionValues = Array.from(selectBlock.matchAll(/<option value="([^"]+)"/g)).map((match) => match[1]);
assert.deepEqual(optionValues, Array.from(C.KEYS), 'key options must match the core key list');
assert.ok(/<option value="C" selected>/.test(selectBlock), 'C must be the default key');
assert.ok(/<option value="major" selected>/.test(html), 'major must be the default mode');
assert.ok(/<option value="minor">/.test(html), 'minor must be offered');

console.log('secondary dominant finder: ' + entry.testCases.length + ' catalog cases, ' + compared
  + ' applied dominants checked against pitch-class arithmetic and ' + goldenCases + ' golden / '
  + validationCases + ' validation replays passed');
