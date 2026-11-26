/* Wind pipe tuning calculator: pipe physics, a bisection round trip through the
   inverse model, the stopped-to-open invariants, limits, refusals, the catalog
   cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'wind-pipe-tuning-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* wpt-core:start */';
const endMarker = '/* wpt-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = WindPipeCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, label, tolerance) => {
  const limit = tolerance === undefined ? 1e-9 : tolerance;
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= limit * scale,
    label + ': ' + actual + ' is not within ' + limit + ' of ' + expected);
};
const solve = (input) => plain(C.describe(input));
const failure = (input) => {
  try { C.describe(input); } catch (error) { return error.message; }
  return null;
};
const base = {
  mode: 'length', note: '9', octave: '4', pipe: 'open', bore: '20', temp: '20', a4: '440'
};

// ---- Constants and the exported surface.
assert.deepEqual(plain(C.NOTE_NAMES), ['C', 'C\u266f', 'D', 'D\u266f', 'E', 'F', 'F\u266f',
  'G', 'G\u266f', 'A', 'A\u266f', 'B']);
assert.deepEqual(plain(C.PIPES), [
  { id: 'open', label: 'Open at both ends' }, { id: 'stopped', label: 'Stopped at one end' }
]);
assert.equal(C.END_FACTOR, 0.6133);
assert.equal(C.ZERO_C_MPS, 331.3);
assert.equal(C.MIN_BORE_MM, 2);
assert.equal(C.MAX_BORE_MM, 200);
assert.equal(C.MIN_TEMP_C, -20);
assert.equal(C.MAX_TEMP_C, 50);
assert.equal(C.MIN_A4_HZ, 392);
assert.equal(C.MAX_A4_HZ, 466);
assert.equal(C.MIN_LENGTH_MM, 20);
assert.equal(C.MAX_LENGTH_MM, 6000);
assert.equal(C.MIN_MIDI, 24);
assert.equal(C.MAX_MIDI, 96);
assert.equal(C.TABLE_ROWS, 13);
assert.deepEqual(plain(Object.keys(C)).sort(), [
  'END_FACTOR', 'MAX_A4_HZ', 'MAX_BORE_MM', 'MAX_LENGTH_MM', 'MAX_MIDI', 'MAX_TEMP_C',
  'MESSAGES', 'MIN_A4_HZ', 'MIN_BORE_MM', 'MIN_LENGTH_MM', 'MIN_MIDI', 'MIN_TEMP_C',
  'NOTE_NAMES', 'PIPES', 'TABLE_ROWS', 'ZERO_C_MPS', 'describe', 'effectiveLengthMm',
  'endCorrectionMm', 'frequencyToMidi', 'isNumber', 'midiToFrequency', 'noteName',
  'perEndMm', 'round', 'speedOfSound'
]);

// ---- Air at 0 C carries sound at 331.3 m/s; 20 C at about 343.2 m/s.
near(C.speedOfSound(0), 331.3, 'speed at 0 C', 1e-12);
near(C.speedOfSound(20), 331.3 * Math.sqrt(1 + 20 / 273.15), 'speed at 20 C', 1e-12);
near(C.speedOfSound(20), 343.2146, 'speed at 20 C in round figures', 2e-6);
near(C.speedOfSound(-20), 318.9406, 'speed at -20 C', 2e-6);
near(C.speedOfSound(50), 360.3487, 'speed at 50 C', 2e-6);
assert.ok(C.speedOfSound(50) > C.speedOfSound(20) && C.speedOfSound(20) > C.speedOfSound(-20),
  'warmer air is faster');

// ---- The end correction grows with the radius: one per open end.
near(C.perEndMm(20), 6.133, '20 mm bore, one end', 1e-12);
near(C.endCorrectionMm('open', 20), 12.266, 'open pipe has two ends', 1e-12);
near(C.endCorrectionMm('stopped', 20), 6.133, 'stopped pipe has one open end', 1e-12);
near(C.endCorrectionMm('open', 2), 1.2266, 'narrow bore', 1e-12);
near(C.endCorrectionMm('open', 200), 122.66, 'wide bore', 1e-12);
near(C.endCorrectionMm('open', 40), 2 * C.endCorrectionMm('stopped', 40), 'two ends, twice one', 1e-12);

// ---- Equal temperament around the reference A4.
near(C.midiToFrequency(69, 440), 440, 'A4', 1e-12);
near(C.midiToFrequency(81, 440), 880, 'A5', 1e-12);
near(C.midiToFrequency(60, 440), 261.6256, 'C4', 2e-6);
near(C.midiToFrequency(69, 415), 415, 'baroque A4', 1e-12);
near(C.frequencyToMidi(440, 440), 69, 'A4 back to its number', 1e-12);
near(C.frequencyToMidi(261.6256, 440), 60, 'C4 back to its number', 2e-6);
assert.equal(C.noteName(69), 'A4');
assert.equal(C.noteName(60), 'C4');
assert.equal(C.noteName(21), 'A0');
assert.equal(C.noteName(108), 'C8');
assert.equal(C.noteName(61), 'C\u266f4');

// ---- Lengths: half a wavelength open, a quarter stopped, minus one end
// correction per open end.
const v20 = C.speedOfSound(20);
near(C.effectiveLengthMm(440, 'open', v20), v20 / 880 * 1000, 'open effective length', 1e-12);
near(C.effectiveLengthMm(440, 'stopped', v20), v20 / 1760 * 1000, 'stopped effective length', 1e-12);
near(C.effectiveLengthMm(440, 'open', v20), 2 * C.effectiveLengthMm(440, 'stopped', v20),
  'a stopped pipe is half as long as an open one at the same note', 1e-12);
near(C.effectiveLengthMm(880, 'open', v20) * 2, C.effectiveLengthMm(440, 'open', v20),
  'an octave up halves the length', 1e-12);

// ---- The default: A4 in a 20 mm open pipe at 20 C.
const result = solve(base);
assert.equal(result.mode, 'length');
assert.equal(result.pipe, 'open');
assert.equal(result.note, 'A4');
assert.equal(result.midi, 69);
assert.equal(result.frequency, 440);
near(result.speedMps, 343.2146, 'speed of sound', 2e-6);
near(result.endCorrectionMm, 12.266, 'end correction', 1e-12);
near(result.effectiveLengthMm, 390.0166, 'effective length', 2e-6);
near(result.cutLengthMm, 377.7506, 'cut length', 2e-6);
near(result.wavelengthMm, 780.0332, 'wavelength', 2e-6);
near(result.cutLengthMm + result.endCorrectionMm, result.effectiveLengthMm,
  'the cut plus the correction is the effective length', 1e-12);
assert.equal(result.rows.length, 13);
assert.equal(result.currentIndex, 0);
assert.deepEqual(result.rows.map((row) => row.note),
  ['A4', 'A\u266f4', 'B4', 'C5', 'C\u266f5', 'D5', 'D\u266f5', 'E5', 'F5', 'F\u266f5',
    'G5', 'G\u266f5', 'A5']);
for (let index = 1; index < result.rows.length; index += 1) {
  near(result.rows[index].frequency, result.rows[index - 1].frequency * Math.pow(2, 1 / 12),
    'a semitone apart', 1e-12);
  assert.ok(result.rows[index].cutLengthMm < result.rows[index - 1].cutLengthMm,
    'a higher note needs a shorter pipe');
  near(result.rows[index].cutLengthMm + result.endCorrectionMm,
    v20 / (2 * result.rows[index].frequency) * 1000, 'row self-consistency', 1e-12);
}
near(result.rows[12].frequency, 880, 'the table ends an octave up', 1e-12);

// ---- A stopped pipe at the same note takes about half the length, and its
// correction is one end instead of two.
const stopped = solve({ ...base, pipe: 'stopped' });
near(stopped.effectiveLengthMm, result.effectiveLengthMm / 2, 'half the effective length', 1e-12);
near(stopped.endCorrectionMm, result.endCorrectionMm / 2, 'one open end', 1e-12);
near(stopped.cutLengthMm, 188.8753, 'stopped cut length', 2e-6);
near(stopped.cutLengthMm, result.cutLengthMm / 2, 'the stopped cut is exactly half the open cut', 1e-12);

// ---- Stopping a pipe of the same physical length drops it about an octave,
// but not quite: the cut length keeps its single end correction.
const drops = [];
for (const bore of ['10', '40', '120']) {
  const length = '1000';
  const openNote = solve({ mode: 'pitch', length, pipe: 'open', bore, temp: '20', a4: '440' });
  const stoppedNote = solve({ mode: 'pitch', length, pipe: 'stopped', bore, temp: '20', a4: '440' });
  const drop = 1200 * Math.log(openNote.frequency / stoppedNote.frequency) / Math.log(2);
  assert.ok(drop > 1000 && drop < 1200, 'stopping drops close to an octave, bore ' + bore + ': ' + drop);
  drops.push(drop);
}
assert.ok(drops[0] > drops[1] && drops[1] > drops[2],
  'a wider bore pulls the stopped pipe further below the octave');

// ---- Cold air shortens the pipe and warm air lengthens it.
const cold = solve({ ...base, temp: '-20' });
const warm = solve({ ...base, temp: '50' });
assert.ok(cold.cutLengthMm < result.cutLengthMm && result.cutLengthMm < warm.cutLengthMm,
  'temperature moves the length');
near(cold.cutLengthMm, 350.1665, 'cold cut length', 2e-6);
near(warm.cutLengthMm, 397.2212, 'warm cut length', 2e-6);

// ---- The reverse direction: measure the pipe and read the note back.
const back = solve({ mode: 'pitch', length: '377.8', pipe: 'open', bore: '20', temp: '20', a4: '440' });
assert.equal(back.nearestNote, 'A4');
near(back.frequency, 439.9443, 'read-back frequency', 2e-6);
near(back.cents, -0.2192, 'a fifth of a cent flat', 1e-3);
assert.equal(back.rows.length, 0, 'no octave table when reading a pipe');
const shortPipe = solve({ mode: 'pitch', length: '100', pipe: 'stopped', bore: '10', temp: '20', a4: '440' });
assert.ok(shortPipe.frequency > 440 && shortPipe.frequency < 1760, 'a short stopped pipe sits above A4');
assert.ok(Math.abs(shortPipe.cents) <= 50, 'the nearest note is within half a semitone');

// ---- A bisection on the forward pitch model finds the same length the
// closed-form cut length gives.  It shares no formula with that inverse: it
// only knows how to turn a length into a pitch.
const pitchOf = (lengthMm, pipe, bore, temp, a4) => solve({
  mode: 'pitch', length: String(lengthMm), pipe, bore, temp, a4
}).frequency;
const bisectLength = (target, pipe, bore, temp, a4) => {
  let low = 20;
  let high = 6000;
  for (let step = 0; step < 120; step += 1) {
    const middle = (low + high) / 2;
    if (pitchOf(middle, pipe, bore, temp, a4) > target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
};

let seed = 20261119;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const between = (low, high) => low + (high - low) * random();

let checked = 0;
let refused = 0;
for (let index = 0; index < 300; index += 1) {
  const midi = 24 + Math.floor(random() * 73);
  const octave = Math.floor(midi / 12) - 1;
  const pitchClass = midi % 12;
  const pipe = random() < 0.5 ? 'open' : 'stopped';
  const bore = Math.round(between(2, 60) * 10) / 10;
  const temp = Math.round(between(-20, 50));
  const a4 = Math.round(between(392, 466));
  const request = {
    mode: 'length', note: String(pitchClass), octave: String(octave), pipe,
    bore: String(bore), temp: String(temp), a4: String(a4)
  };
  let forward;
  try {
    forward = solve(request);
  } catch (error) {
    assert.match(error.message, /shorter than its diameter|between C1 and C7/, 'only the documented refusals');
    refused += 1;
    continue;
  }
  const found = bisectLength(forward.frequency, pipe, String(bore), String(temp), String(a4));
  near(found, forward.cutLengthMm, 'bisection agrees with the closed form: ' + JSON.stringify(request), 1e-6);
  const readBack = solve({ ...request, mode: 'pitch', length: String(forward.cutLengthMm) });
  near(readBack.frequency, forward.frequency, 'the inverse returns the same pitch', 1e-9);
  near(readBack.cents, 0, 'and reports no offset', 1e-6);
  checked += 1;
}
assert.equal(checked + refused, 300, '300 seeded pipes accounted for');
assert.ok(checked > 240, 'most seeded pipes are buildable: ' + checked);

// ---- Shorter pipes sound higher, longer lower.
let previous = null;
const samples = [];
for (let index = 0; index < 200; index += 1) {
  const length = Math.round(between(20, 6000) * 10) / 10;
  samples.push([length, solve({ mode: 'pitch', length: String(length), pipe: 'open', bore: '20', temp: '20', a4: '440' }).frequency]);
}
samples.sort((left, right) => left[0] - right[0]);
for (const [length, frequency] of samples) {
  if (previous !== null) assert.ok(frequency <= previous + 1e-9, 'length ' + length + ' is not higher');
  previous = frequency;
}

// ---- The limits themselves are accepted.
assert.equal(solve({ ...base, bore: '2' }).boreMm, 2);
assert.equal(solve({ ...base, bore: '200', note: '0', octave: '5' }).boreMm, 200);
assert.equal(solve({ ...base, temp: '-20' }).tempC, -20);
assert.equal(solve({ ...base, temp: '50' }).tempC, 50);
assert.equal(solve({ ...base, a4: '392' }).a4, 392);
assert.equal(solve({ ...base, a4: '466' }).a4, 466);
assert.equal(solve({ ...base, note: '0', octave: '1' }).note, 'C1');
assert.equal(solve({ ...base, note: '0', octave: '7', bore: '2' }).note, 'C7');
assert.equal(solve({ ...base, mode: 'pitch', length: '20', bore: '2' }).lengthMm, 20);
assert.equal(solve({ ...base, mode: 'pitch', length: '6000', pipe: 'stopped', bore: '2' }).lengthMm, 6000);

// ---- Refusals.
assert.equal(failure({ ...base, mode: '' }), 'Choose whether to find a length or a pitch.');
assert.equal(failure({ ...base, pipe: 'half' }), 'Choose an open pipe or a stopped pipe.');
assert.equal(failure({ ...base, bore: '' }), 'Enter the bore diameter.');
assert.equal(failure({ ...base, bore: 'twenty' }), 'Write the bore diameter in millimetres, for example 20.');
assert.equal(failure({ ...base, bore: '1' }), 'The bore must be between 2 and 200 mm.');
assert.equal(failure({ ...base, bore: '201' }), 'The bore must be between 2 and 200 mm.');
assert.equal(failure({ ...base, temp: '' }), 'Enter the air temperature.');
assert.equal(failure({ ...base, temp: 'warm' }), 'Write the air temperature in degrees Celsius, for example 20.');
assert.equal(failure({ ...base, temp: '-21' }), 'The air temperature must be between -20 and 50 \u00b0C.');
assert.equal(failure({ ...base, temp: '51' }), 'The air temperature must be between -20 and 50 \u00b0C.');
assert.equal(failure({ ...base, a4: '' }), 'Enter the reference pitch for A4.');
assert.equal(failure({ ...base, a4: '391' }), 'The reference A4 pitch must be between 392 and 466 Hz.');
assert.equal(failure({ ...base, note: '12' }), 'Choose a note from the list.');
assert.equal(failure({ ...base, octave: '9' }), 'Choose an octave from the list.');
assert.equal(failure({ ...base, note: '0', octave: '0' }), 'The note must be between C1 and C7.');
assert.equal(failure({ ...base, note: '11', octave: '7' }), 'The note must be between C1 and C7.');
assert.equal(failure({ ...base, mode: 'pitch', length: '10' }),
  'The pipe length must be between 20 and 6,000 mm.');
assert.equal(failure({ ...base, note: '0', octave: '7', bore: '200' }),
  'That note is too high for this bore: the pipe would be shorter than its diameter. Use a narrower bore or a lower note.');

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Wind Pipe Tuning Calculator');
assert.equal(entry.category, 'Music');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 700, 'method must document the model and its limits');
assert.equal(entry.sources.length, 3);
assert.ok(entry.sources.every((source) => /^https:\/\//.test(source.url)), 'https sources');
assert.equal(entry.testCases.length, 39, 'catalog case count');
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'golden').length, 6);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'boundary').length, 6);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'validation').length, 27);

for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const answer = solve(testCase.input);
  for (const [field, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') {
      near(answer[field], expected, testCase.name + ' ' + field, field === 'cents' ? 1e-3 : 2e-6);
    } else {
      assert.equal(answer[field], expected, testCase.name + ' ' + field);
    }
  }
}

// ---- A name or alias belongs to one tool only.
const names = new Map();
for (const tool of catalog.tools) {
  for (const value of [tool.name, ...(tool.aliases || [])]) {
    const key = value.toLowerCase();
    if (!names.has(key)) names.set(key, new Set());
    names.get(key).add(tool.slug);
  }
}
for (const value of [entry.name, ...entry.aliases]) {
  const holders = names.get(value.toLowerCase());
  assert.deepEqual([...holders], [slug], 'name or alias is not shared: ' + value);
}

// ---- Page contract.
assert.ok(/<h1>Wind Pipe Tuning Calculator<\/h1>/.test(html), 'heading');
assert.ok(/<form id="pipe-form" novalidate>/.test(html), 'form');
for (const id of ['in-mode', 'in-note', 'in-octave', 'in-length', 'in-pipe', 'in-bore', 'in-temp',
  'in-a4', 'err', 'run', 'out', 'headline', 'sub', 'fact-frequency', 'fact-effective',
  'fact-correction', 'fact-speed', 'fact-wavelength', 'fact-bore', 'rows', 'octave-table',
  'field-note', 'field-octave', 'field-length']) {
  assert.ok(html.includes('id="' + id + '"'), 'element id: ' + id);
}
for (const label of ['I want to find', 'Note', 'Octave', 'Pipe length', 'Pipe', 'Bore diameter',
  'Air temperature', 'Reference A4']) {
  assert.ok(html.includes('>' + label + '</label>'), 'label: ' + label);
}
assert.ok(/<button type="submit" id="run">Calculate<\/button>/.test(html), 'submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/Nothing is sent or stored/.test(html), 'the note states local only');
assert.ok(/id="field-length" hidden/.test(html), 'the length field starts hidden');
assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(html), 'no off-site links or requests');
assert.ok(!/<script[^>]+src="(?!\/assets\/)/.test(html), 'only local scripts');
assert.ok(!/\son(click|input|change|submit|keydown)=/.test(html), 'no inline event handlers');
assert.equal(html.match(/<script/g).length, 3, 'theme init, shared app and the tool script');
assert.ok(/min-height:44px/.test(html), '44px touch targets');
assert.ok(/\.field\[hidden\]\{display:none\}/.test(html), 'hidden fields actually hide');
assert.ok(/<caption>/.test(html) && /scope="col"/.test(html), 'table caption and headers');
const ids = html.match(/\bid="[^"]+"/g).map((value) => value.slice(4, -1));
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');

console.log('wind pipe tuning calculator: all assertions passed');
