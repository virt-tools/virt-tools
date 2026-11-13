/* Regression checks for the progression key detector core, its catalog cases and
   the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'progression-key-detector';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* progression-key-core:start */');
const end = html.indexOf('/* progression-key-core:end */');
assert.ok(start > -1 && end > start, 'progression key core markers missing');
const core = html.slice(start, end + '/* progression-key-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ProgressionKeyCore;', sandbox);
const C = sandbox.module.exports;

const clean = (value) => JSON.parse(JSON.stringify(value));
const run = (chords) => clean(C.analyze({ chords }));
const numerals = (result) => result.analysis.map((item) => item.numeral).join(' ');

// Documented surface.
assert.equal(C.MAX_CHORDS, 64);
assert.equal(C.MESSAGES.chords, 'Enter a chord progression such as C G Am F.');
assert.equal(C.MESSAGES.limit, 'Use at most 64 chords.');
assert.equal(C.MESSAGES.long, 'That progression is too long to read.');
assert.ok(C.MESSAGES.unsupported.startsWith('Only plain chord symbols are supported'));

// Chord spelling: tones and letter-correct note names.
const spelling = [
  ['C', 0, 'maj', [0, 4, 7], ['C', 'E', 'G']],
  ['Am', 9, 'min', [9, 0, 4], ['A', 'C', 'E']],
  ['F#m7b5', 6, 'dim', [6, 9, 0, 4], ['F#', 'A', 'C', 'E']],
  ['Bbmaj7', 10, 'maj', [10, 2, 5, 9], ['Bb', 'D', 'F', 'A']],
  ['Cdim7', 0, 'dim', [0, 3, 6, 9], ['C', 'Eb', 'Gb', 'Bbb']],
  ['Caug', 0, 'aug', [0, 4, 8], ['C', 'E', 'G#']],
  ['G7sus4', 7, 'sus', [7, 0, 2, 5], ['G', 'C', 'D', 'F']],
  ['D(add9)', 2, 'maj', [2, 6, 9, 4], ['D', 'F#', 'A', 'E']]
];
for (const [token, pc, kind, tones, names] of spelling) {
  const chord = clean(C.parseChord(token));
  assert.ok(chord, token + ' parses');
  assert.equal(chord.rootPc, pc, token + ' root');
  assert.equal(chord.kind, kind, token + ' kind');
  assert.deepEqual(chord.tones, tones, token + ' tones');
  assert.deepEqual(chord.names, names, token + ' names');
}
assert.equal(C.parseChord('C/E').bass.pc, 4, 'slash bass is kept separately');
assert.equal(C.parseChord('B\u266d').rootPc, 10, 'flat sign is read');
assert.equal(C.parseChord('C\u266fm7').rootPc, 1, 'sharp sign is read');
assert.equal(C.parseChord('N.C.'), null);

// Separators, case and stray punctuation.
assert.deepEqual(clean(C.splitProgression('Am | F, C ; G: D')), ['Am', 'F', 'C', 'G', 'D']);
assert.equal(run('am f c g').best.label, 'A minor');
assert.equal(run('(C) (G) (Am) (F)').best.label, 'C major');

// Core detection cases.
const cMajor = run('C G Am F');
assert.equal(cMajor.best.label, 'C major');
assert.equal(cMajor.fit, 100);
assert.equal(cMajor.matched, 4);
assert.equal(numerals(cMajor), 'I V vi IV');
assert.equal(cMajor.candidates.length, 6);
assert.equal(cMajor.ambiguous, true, 'A minor shares the scale');

const aMinor = run('Am F C G');
assert.equal(aMinor.best.label, 'A minor');
assert.equal(numerals(aMinor), 'i VI III VII');

const turnaround = run('Dm7 | G7 | Cmaj7 | A7');
assert.equal(turnaround.best.label, 'C major', 'a secondary dominant A7 must not win A minor');
assert.equal(turnaround.fit, 92);
assert.equal(numerals(turnaround), 'ii7 V7 Imaj7 VI7');
assert.equal(turnaround.analysis[3].outside.join(','), 'C#');

const minorWithDominant = run('Am Dm E7 Am');
assert.equal(minorWithDominant.best.label, 'A minor');
assert.equal(minorWithDominant.fit, 93);
assert.equal(minorWithDominant.analysis[2].outside.join(','), 'G#');

const flat = run('Ebmaj7 Cm7 Abmaj7 Bb7');
assert.equal(flat.best.label, 'Eb major');
assert.equal(flat.best.key.degreeNames.join(' '), 'Eb F G Ab Bb C D');
assert.equal(numerals(flat), 'Imaj7 vi7 IVmaj7 V7');

const borrowed = run('C Fm C G');
assert.equal(borrowed.best.label, 'C major');
assert.equal(borrowed.fit, 93);
assert.equal(borrowed.analysis[1].numeral, 'iv');
assert.equal(borrowed.analysis[1].outside.join(','), 'Ab', 'borrowed tones use the chord spelling');

const single = run('C');
assert.equal(single.fit, 100);
assert.equal(single.count, 1);
assert.equal(single.warnings.some((line) => line.includes('single chord')), true);

const marked = run('Am N.C. E7 Am');
assert.equal(marked.count, 3);
assert.equal(marked.warnings[0], 'Ignored 1 no-chord marker.');

// Weighted fit arithmetic, checked by hand for one mixed progression:
// C(3/3)*2 + Fm(2/3)*2 + C(3/3)*2 + G(3/3)*3 = 25 of 27 tone slots.
assert.equal(run('C Fm C G').fit, Math.round(100 * 25 / 27));

// Every key: I IV V must be detected as that key, and its scale must be spelled
// with single accidentals only.
let keyChecks = 0;
const TONICS = {
  major: [['C', 0], ['Db', 1], ['D', 2], ['Eb', 3], ['E', 4], ['F', 5], ['F#', 6], ['G', 7], ['Ab', 8], ['A', 9], ['Bb', 10], ['B', 11]],
  minor: [['C', 0], ['C#', 1], ['D', 2], ['Eb', 3], ['E', 4], ['F', 5], ['F#', 6], ['G', 7], ['G#', 8], ['A', 9], ['Bb', 10], ['B', 11]]
};
for (const mode of ['major', 'minor']) {
  for (const [tonic, pc] of TONICS[mode]) {
    const key = C.buildKey(tonic, pc, mode);
    assert.equal(key.degreePcs.length, 7);
    assert.equal(new Set(key.degreePcs).size, 7, key.label + ' has seven distinct degrees');
    for (const name of key.degreeNames) {
      assert.ok(!/##|bb/.test(name), key.label + ' spells ' + name + ' with a single accidental');
      assert.match(name, /^[A-G][#b]?$/, key.label + ' degree name');
    }
    const triads = [0, 3, 4].map((degree) => {
      const rootPc = key.degreePcs[degree];
      const third = key.degreePcs[(degree + 2) % 7];
      const fifth = key.degreePcs[(degree + 4) % 7];
      const thirdGap = ((third - rootPc) % 12 + 12) % 12;
      const fifthGap = ((fifth - rootPc) % 12 + 12) % 12;
      const suffix = thirdGap === 4 && fifthGap === 7 ? ''
        : thirdGap === 3 && fifthGap === 7 ? 'm'
        : thirdGap === 3 && fifthGap === 6 ? 'dim'
        : thirdGap === 4 && fifthGap === 8 ? 'aug' : null;
      assert.ok(suffix !== null, key.label + ' degree ' + (degree + 1) + ' is not a plain triad');
      return key.degreeNames[degree] + suffix;
    });
    const detected = C.analyze({ chords: triads.join(' ') });
    assert.equal(detected.best.label, key.label, key.label + ' is recovered from I IV V');
    assert.equal(detected.fit, 100, key.label + ' I IV V is fully diatonic');
    keyChecks += 1;
  }
}
assert.equal(keyChecks, 24, 'all 24 keys were exercised');

// Sorting: fit first, then tonic evidence, then major before minor.
const ranked = run('C G Am F');
for (let index = 1; index < ranked.candidates.length; index += 1) {
  const previous = ranked.candidates[index - 1];
  const current = ranked.candidates[index];
  assert.ok(previous.fit >= current.fit, 'candidates are ordered by fit');
  if (previous.fit === current.fit) assert.ok(previous.bonus >= current.bonus, 'ties are ordered by tonic evidence');
}

// Refusals.
const refuse = (chords, message) => {
  try {
    C.analyze({ chords });
    assert.fail('expected a refusal for ' + JSON.stringify(chords));
  } catch (error) {
    assert.equal(error.message, message);
  }
};
refuse('', C.MESSAGES.chords);
refuse('   ', C.MESSAGES.chords);
refuse('N.C.', C.MESSAGES.chords);
refuse('H Dm', C.MESSAGES.unsupported + ' Could not read "H".');
refuse('Cmaj7b9', C.MESSAGES.unsupported + ' Could not read "Cmaj7b9".');
refuse(Array(65).fill('C').join(' '), C.MESSAGES.limit);
refuse('C G '.repeat(1400), C.MESSAGES.long);

// The catalog record replays through this core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(catalog.tools.length, 2238, 'catalog total');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 25, 'catalog has the full test case set');
assert.ok(record.method.length > 800, 'method documents the model');
assert.ok(record.sources.length >= 3);
for (const name of record.aliases) {
  const clash = catalog.tools.filter((tool) => tool.slug !== slug)
    .some((tool) => tool.name === name || (tool.aliases || []).includes(name));
  assert.equal(clash, false, 'alias is unique: ' + name);
}
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
  const result = clean(C.analyze(testCase.input));
  assert.equal(result.best.label, testCase.expected.key, testCase.name);
  assert.equal(result.fit, testCase.expected.fit, testCase.name + ' fit');
  assert.equal(result.matched, testCase.expected.matched, testCase.name + ' matched');
  assert.equal(numerals(result), testCase.expected.numerals, testCase.name + ' numerals');
}

// Page contract: shared chrome, a single form, no storage, no network, no HTML sinks.
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style\.css">/);
assert.equal((html.match(/id="key-form"/g) || []).length, 1);
assert.ok(html.includes('aria-live="polite"'));
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), 'page stores nothing');
assert.ok(!/https?:\/\//.test(html), 'page references no external URL');
assert.ok(!/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/.test(html), 'page makes no requests');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page uses no HTML sinks');

console.log(slug + ' core: all checks passed (' + record.testCases.length + ' catalog cases, ' + keyChecks + ' keys, 24 key triads)');
