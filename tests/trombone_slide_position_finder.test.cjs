/* Trombone slide position finder: the published position charts and the
   harmonic-series intonation table against the page's model, the trigger
   arithmetic, the catalog record and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'trombone-slide-position-finder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* trombone-slide-core:start */';
const endMarker = '/* trombone-slide-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|localStorage|fetch\s*\(/.test(core), 'the core stays free of DOM and storage');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TromboneSlideCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const find = (note, attachment) => plain(C.find({ note, attachment }));
const names = (result) => result.matches.map((match) => match.label);
const partials = (result) => result.matches.map((match) => match.partial);
const centsOf = (result, label) => result.matches.find((match) => match.label === label).cents;

function failure(input) {
  try { C.find(input); } catch (error) { return error.message; }
  return null;
}

// ---- Published chart: the first position harmonic series. Wikipedia's
// Trombone article gives Bb2, F3, Bb3, D4, F4 in first position and the
// 31-cent flat seventh partial Ab4; the pedal below Bb2 is Bb1.
const firstPosition = C.chart(false)[0];
assert.equal(firstPosition.label, '1st');
assert.deepEqual(Array.from(firstPosition.cells, (cell) => cell.note),
  ['Bb1', 'Bb2', 'F3', 'Bb3', 'D4', 'F4', 'Ab4', 'Bb4'], 'first-position series');
assert.deepEqual(Array.from(firstPosition.cells, (cell) => cell.cents),
  [0, 0, 2, 0, -14, 2, -31, 0], 'partial deviations in cents');
assert.equal(firstPosition.cells[6].adjust, true, 'the seventh partial is flagged');
assert.equal(firstPosition.cells[4].adjust, false, 'the fifth partial stays unmarked');
assert.equal(C.chart(false)[6].cells[0].note, 'E1', 'seventh-position pedal is E1');
assert.equal(C.chart(false)[6].cells[1].note, 'E2', 'seventh-position second partial is E2');

// ---- Published alternate positions, from the same article ("F4 may be played
// in first, fourth or sixth position") and the University of Mississippi
// chromatic chart, whose "short" entries are the flat seventh partial. Those
// charts print the commonly used positions, so every published label must
// appear; the page also lists the higher partials that stay within 35 cents.
const chartPositions = {
  F3: ['1st', '6th'],
  A3: ['2nd', '6th'],
  Bb3: ['1st', '5th'],
  B3: ['4th', '7th'],
  C4: ['3rd', '6th'],
  D4: ['1st', '4th'],
  F4: ['1st', '4th', '6th'],
  Bb4: ['1st', '3rd'],
  C5: ['1st', '3rd'],
  D5: ['1st', '4th'],
  F5: ['1st'],
};
for (const [note, labels] of Object.entries(chartPositions)) {
  const pageLabels = names(find(note, false));
  for (const label of labels) {
    assert.ok(pageLabels.includes(label), note + ' is published in ' + label + ': got ' + pageLabels.join(', '));
  }
}
const fullSets = {
  F3: ['1st', '6th'],
  A3: ['2nd', '6th'],
  D4: ['1st', '4th', '7th'],
  F4: ['1st', '6th', '4th'],
  Bb4: ['1st', '3rd', '5th'],
  C5: ['1st', '3rd', '6th'],
};
for (const [note, labels] of Object.entries(fullSets)) {
  assert.deepEqual(names(find(note, false)), labels, note + ' full position set');
}
assert.equal(centsOf(find('F4', false), '4th'), -31, 'short fourth is the flat seventh partial');
assert.equal(centsOf(find('D4', false), '1st'), -14, 'the fifth partial is 14 cents flat');
assert.equal(centsOf(find('Bb3', false), '1st'), 0, 'the fourth partial is in tune');
assert.equal(centsOf(find('Bb4', false), '5th'), -14, 'the tenth partial is 14 cents flat');

// ---- Trigger: six positions a semitone apart on the F fundamental, giving the
// second partials C2 to F2. Wikipedia: the F attachment lowers Bb to F, adds a
// third of the tubing and leaves six positions, down to low C2.
const triggerSecond = { C2: 'T6', Db2: 'T5', D2: 'T4', Eb2: 'T3', E2: 'T2', F2: 'T1' };
for (const [note, label] of Object.entries(triggerSecond)) {
  const result = find(note, true);
  const trigger = result.matches.filter((match) => match.kind === 'trigger' && match.partial === 2);
  assert.equal(trigger.length, 1, note + ' has one trigger second partial');
  assert.equal(trigger[0].label, label, note + ' trigger position');
  assert.equal(trigger[0].cents, 0, note + ' is in tune on the trigger');
}
assert.equal(C.chart(true).length, 13, 'seven open rows and six trigger rows');
assert.equal(C.chart(true)[7].label, 'T1');
assert.equal(C.chart(true)[7].cells[0].note, 'F1', 'T1 pedal is F1');

// ---- Sounding frequency: fundamental * partial * 2^-(position-1)/12, checked
// against the equal-tempered note and the integer cents the page prints. This
// is a second formulation (a frequency ratio), not a copy of the cents step.
for (const attachment of [false, true]) {
  for (let midi = 24; midi <= 77; midi += 1) {
    const result = C.find({ note: midiName(midi), attachment });
    for (const match of result.matches) {
      const fundamental = match.kind === 'trigger' ? 43.65353 : 58.27047;
      const exact = fundamental * match.partial * Math.pow(2, -(match.position - 1) / 12);
      assert.ok(Math.abs(match.frequency - exact) < 0.006,
        'sounding frequency ' + match.frequency + ' vs ' + exact);
      const equal = 440 * Math.pow(2, (result.note.midi - 69) / 12);
      const ratioCents = 1200 * Math.log(exact / equal) / Math.LN2;
      assert.ok(Math.abs(ratioCents - match.cents) < 1.5,
        'cents ' + match.cents + ' vs ratio ' + ratioCents);
    }
  }
}

function midiName(midi) {
  const names = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  return names[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

// ---- Coverage: the open horn runs E1 to F5, the trigger adds C1 to Eb2.
const covered = (attachment) => {
  const set = new Set();
  for (let midi = 12; midi < 120; midi += 1) {
    if (C.find({ note: midiName(midi), attachment }).matches.length) set.add(midi);
  }
  return set;
};
const open = covered(false);
const trigger = covered(true);
const missing = (set, low, high) => {
  const gaps = [];
  for (let midi = low; midi <= high; midi += 1) if (!set.has(midi)) gaps.push(midiName(midi));
  return gaps;
};
assert.deepEqual(missing(open, 28, 77), ['B1', 'C2', 'Db2', 'D2', 'Eb2'],
  'the trigger covers the gap above the pedal');
assert.deepEqual(missing(trigger, 24, 77), ['B1'], 'B1 needs the attachment tuned to E');
assert.deepEqual(missing(trigger, 78, 84), ['Gb5', 'G5', 'Ab5', 'A5', 'Bb5', 'B5', 'C6'], 'F5 is the top');

// ---- Ordering and the needs-trigger hint.
for (const note of ['F4', 'Ab4', 'D5', 'G4']) {
  const matches = find(note, true).matches;
  const adjusted = matches.map((match) => Math.abs(match.cents) >= 20);
  assert.deepEqual(adjusted, adjusted.slice().sort((a, b) => a - b), note + ': adjusted positions last');
  const seen = new Set();
  for (const match of matches) {
    const key = match.kind + match.position;
    assert.ok(!seen.has(key), note + ': one entry per position');
    seen.add(key);
    assert.ok(Math.abs(match.cents) <= 35, note + ': inside the 35 cent window');
  }
}
const needsTrigger = find('Eb2', false);
assert.equal(needsTrigger.reason, 'needs-trigger');
assert.equal(needsTrigger.alternative, 1);
assert.deepEqual(needsTrigger.matches, []);
assert.equal(find('B1', true).reason, 'unreachable');
assert.equal(find('G5', true).reason, 'above-range');
assert.equal(find('A0', true).reason, 'below-range');

// ---- Refusals: the page's own messages.
const refusals = [
  ['', 'Enter a note, for example F4 or Bb3.'],
  ['   ', 'Enter a note, for example F4 or Bb3.'],
  ['H4', 'Enter a note as a letter, an optional sharp or flat sign, and an octave, for example F4 or Bb3.'],
  ['F', 'Enter a note as a letter, an optional sharp or flat sign, and an octave, for example F4 or Bb3.'],
  ['F#4x', 'Enter a note as a letter, an optional sharp or flat sign, and an octave, for example F4 or Bb3.'],
  ['F 4', 'Enter a note as a letter, an optional sharp or flat sign, and an octave, for example F4 or Bb3.'],
  ['4', 'Enter a note as a letter, an optional sharp or flat sign, and an octave, for example F4 or Bb3.'],
  ['F##4', 'Enter a note as a letter, an optional sharp or flat sign, and an octave, for example F4 or Bb3.'],
  ['Bb-1', 'Enter a note as a letter, an optional sharp or flat sign, and an octave, for example F4 or Bb3.'],
  ['C10', 'The octave must be a whole number from 0 to 8.'],
  ['Bb9', 'The octave must be a whole number from 0 to 8.'],
  ['f', 'Enter a note as a letter, an optional sharp or flat sign, and an octave, for example F4 or Bb3.'],
  ['F--4', 'Enter a note as a letter, an optional sharp or flat sign, and an octave, for example F4 or Bb3.'],
  ['Fb', 'Enter a note as a letter, an optional sharp or flat sign, and an octave, for example F4 or Bb3.'],
  [null, 'Enter a note, for example F4 or Bb3.'],
];
for (const [input, message] of refusals) {
  assert.equal(failure({ note: input, attachment: true }), message, JSON.stringify(input));
}
assert.equal(find('Cb4', true).note.name, 'B3', 'a flat renames the note without moving the octave');
assert.equal(find('B#4', true).note.name, 'C5', 'a sharp carries past B');
assert.equal(find('B\u266d4', true).note.name, 'Bb4', 'a typographic flat is accepted');

// ---- Catalog record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Reference');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'one record for the slug');
assert.ok(record.method.includes('12 * log2(partial)'), 'method names the partial series');
assert.ok(record.method.includes('35 cents'), 'method names the acceptance window');
assert.ok(record.method.includes('49 cents flat'), 'method says why the 11th partial is rejected');
assert.ok(record.method.includes('does not model'), 'method states what it does not do');
assert.equal(record.sources.length, 2, 'two documented sources');
assert.equal(record.sources[0].url, 'https://en.wikipedia.org/wiki/Trombone');
assert.equal(record.sources[1].url, 'https://olemiss.edu/lowbrass/lowbrassmethods/charts/tromboneposition.pdf');
for (const tag of ['trombone', 'slide-position', 'partials', 'harmonic-series']) {
  assert.ok(record.tags.includes(tag), 'tag present: ' + tag);
}

function subset(actualValue, expectedValue, label) {
  if (Array.isArray(expectedValue)) {
    assert.ok(Array.isArray(actualValue), label + ' should be an array');
    assert.equal(actualValue.length, expectedValue.length, label + ' length');
    expectedValue.forEach((item, index) => subset(actualValue[index], item, label + '[' + index + ']'));
    return;
  }
  if (expectedValue !== null && typeof expectedValue === 'object') {
    assert.ok(actualValue !== null && typeof actualValue === 'object', label + ' should be an object');
    for (const [key, value] of Object.entries(expectedValue)) {
      assert.ok(Object.prototype.hasOwnProperty.call(actualValue, key), label + ' missing ' + key);
      subset(actualValue[key], value, label + '.' + key);
    }
    return;
  }
  if (typeof expectedValue === 'number' && typeof actualValue === 'number') {
    assert.ok(Math.abs(actualValue - expectedValue) < 1e-9, label + ': ' + actualValue + ' vs ' + expectedValue);
    return;
  }
  assert.equal(actualValue, expectedValue, label);
}
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 30, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 8, 'eight boundary cases');
assert.equal(kinds('validation'), 14, 'fourteen validation cases');
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  subset(plain(C.find(testCase.input)), testCase.expected, testCase.name);
}

// The slug, name and aliases must not collide with another record.
const owners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!owners.has(folded)) owners.set(folded, new Set());
    owners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases)) {
  assert.deepEqual(Array.from(owners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(markupIds).size, markupIds.length, 'no duplicate element ids');
const requestedIds = [
  ...[...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]),
  ...[...html.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]),
];
assert.ok(requestedIds.length >= 10, 'the page looks up its controls');
for (const id of new Set(requestedIds)) assert.ok(markupIds.includes(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label\b[^>]*\bfor="note"/.test(html), 'visible label for the note');
assert.ok(/<label\b[^>]*\bfor="attachment"/.test(html), 'visible label for the trigger');
assert.ok(/<input id="note"[^>]*value="F4"/.test(html), 'the note field starts at F4');
assert.ok(/<input id="attachment"[^>]*checked/.test(html), 'the trigger starts engaged');
assert.ok(/novalidate/.test(html), 'the page owns its validation');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status"/.test(html), 'the confirmation is announced');
assert.ok(/<table id="positions"/.test(html), 'the positions are a table');
assert.ok(/<details id="chart-details"/.test(html), 'the reference chart is collapsible');
assert.ok(/<div class="chart-wrap"[^>]*tabindex="0"/.test(html), 'the chart scroll box is focusable');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/button:focus\{/.test(html), 'keyboard focus is visible');
assert.ok(/max-width:none/.test(html), 'the shared input cap is lifted');
assert.ok(/no storage, uploads or network access/.test(html), 'the page states the local-only scope');
assert.ok(/tune the slide by ear/.test(html), 'the page says positions are instrument-specific');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('trombone slide position finder: ' + record.testCases.length + ' catalog cases, '
  + (2 * 54) + ' model notes, ' + refusals.length + ' refusals and the page contract pass');
