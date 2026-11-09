/* Regression checks for the metric modulation core, its catalog cases,
   randomised arithmetic and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'metric-modulation-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* metric-modulation-core:start */');
const end = html.indexOf('/* metric-modulation-core:end */');
assert.ok(start > -1 && end > start, 'metric modulation core markers missing');
const core = html.slice(start, end + '/* metric-modulation-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MetricModulationCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.solve(input));
const failure = (input) => {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
const round3 = (value) => Math.round(value * 1000) / 1000;

// Independent note table, in quarter notes, used as the oracle.
const NOTES = {
  whole: [4, 1],
  'dotted-half': [3, 1],
  half: [2, 1],
  'dotted-quarter': [3, 2],
  quarter: [1, 1],
  'dotted-eighth': [3, 4],
  eighth: [1, 2],
  'dotted-sixteenth': [3, 8],
  sixteenth: [1, 4],
  'thirty-second': [1, 8],
  'half-triplet': [4, 3],
  'quarter-triplet': [2, 3],
  'eighth-triplet': [1, 3]
};

// ---- Library surface.
assert.equal(C.NOTES.length, 13);
assert.equal(C.TEMPO_MIN, 1);
assert.equal(C.TEMPO_MAX, 1000);
assert.deepEqual(plain(C.NOTES.map((note) => note.id).sort()), Object.keys(NOTES).sort());
for (const note of C.NOTES) {
  const [n, d] = NOTES[note.id];
  assert.deepEqual(plain(note.quarters), { n, d }, note.id);
  assert.ok(note.label.length > 3, note.id + ' label');
}

// ---- The canonical modulation: dotted quarter = quarter.
const canonical = run({ tempo: 120, oldNote: 'dotted-quarter', newNote: 'quarter' });
assert.equal(canonical.newTempo, 80);
assert.equal(canonical.pulseMs, 750);
assert.equal(canonical.newQuarterMs, 750);
assert.equal(canonical.ratioLeft, 2);
assert.equal(canonical.ratioRight, 3);
assert.equal(canonical.equivalence, '3 old beats = 2 new beats');
assert.equal(canonical.changePercent, -33.333);
assert.equal(canonical.direction, 'slower');
assert.equal(canonical.oldNoteQuarters, 1.5);
assert.equal(canonical.newNoteQuarters, 1);

// ---- The reverse modulation is the reciprocal tempo.
const reverse = run({ tempo: 120, oldNote: 'quarter', newNote: 'dotted-quarter' });
assert.equal(reverse.newTempo, 180);
assert.equal(reverse.pulseMs, 500);
assert.equal(reverse.newQuarterMs, 333.333);
assert.equal(reverse.changePercent, 50);
assert.equal(reverse.direction, 'faster');
assert.equal(run({ tempo: canonical.newTempo, oldNote: 'quarter', newNote: 'dotted-quarter' }).newTempo, 120);

// ---- Half, triplet and identical values.
assert.equal(run({ tempo: 120, oldNote: 'half', newNote: 'quarter' }).newTempo, 60);
assert.equal(run({ tempo: 120, oldNote: 'quarter-triplet', newNote: 'quarter' }).newTempo, 180);
const same = run({ tempo: 120, oldNote: 'quarter', newNote: 'quarter' });
assert.equal(same.newTempo, 120);
assert.equal(same.changePercent, 0);
assert.equal(same.direction, 'same');
assert.equal(same.equivalence, '1 old beat = 1 new beat');

// ---- Numeric strings are accepted, as the form sends them.
assert.equal(run({ tempo: '96', oldNote: 'dotted-quarter', newNote: 'eighth' }).newTempo, 32);
assert.equal(run({ tempo: '88,5', oldNote: 'dotted-quarter', newNote: 'quarter' }).newTempo, 59);
assert.equal(run({ tempo: '88.5', oldNote: 'dotted-quarter', newNote: 'quarter' }).newTempo, 59);

// ---- Refusals name the field and never guess.
assert.equal(failure({}), 'Tempo is required.');
assert.equal(failure(null), 'Tempo is required.');
assert.equal(failure({ tempo: '', oldNote: 'quarter', newNote: 'half' }), 'Tempo is required.');
assert.equal(failure({ tempo: '   ', oldNote: 'quarter', newNote: 'half' }), 'Tempo is required.');
assert.equal(failure({ tempo: 0, oldNote: 'quarter', newNote: 'half' }),
  'Tempo must be a number from 1 to 1,000 BPM.');
assert.equal(failure({ tempo: 1001, oldNote: 'quarter', newNote: 'half' }),
  'Tempo must be a number from 1 to 1,000 BPM.');
assert.equal(failure({ tempo: -5, oldNote: 'quarter', newNote: 'half' }),
  'Tempo must be a number from 1 to 1,000 BPM.');
assert.equal(failure({ tempo: 'fast', oldNote: 'quarter', newNote: 'half' }),
  'Tempo must be a number from 1 to 1,000 BPM.');
assert.equal(failure({ tempo: '1e2', oldNote: 'quarter', newNote: 'half' }),
  'Tempo must be a number from 1 to 1,000 BPM.');
assert.equal(failure({ tempo: '1,000', oldNote: 'quarter', newNote: 'half' }),
  'Tempo must use a dot for decimals; a comma is read as a thousands separator.');
assert.equal(failure({ tempo: Infinity, oldNote: 'quarter', newNote: 'half' }),
  'Tempo must be a number from 1 to 1,000 BPM.');
assert.equal(failure({ tempo: NaN, oldNote: 'quarter', newNote: 'half' }),
  'Tempo must be a number from 1 to 1,000 BPM.');
assert.equal(failure({ tempo: 120, oldNote: 'breve', newNote: 'half' }),
  'Choose an old note value from the list.');
assert.equal(failure({ tempo: 120, oldNote: 'quarter', newNote: 'breve' }),
  'Choose a new note value from the list.');
assert.equal(failure({ tempo: 120, oldNote: 'quarter' }),
  'Choose a new note value from the list.');

// ---- Randomised arithmetic over 300 modulations, checked independently.
const gcd = (a, b) => {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
};
const pick = (state) => {
  state.seed = (state.seed * 1103515245 + 12345) % 2147483648;
  return state.seed;
};
const ids = Object.keys(NOTES);
const state = { seed: 20261109 };
for (let index = 0; index < 300; index += 1) {
  const tempo = Math.round((1 + (pick(state) / 2147483648) * 999) * 100) / 100;
  const oldId = ids[pick(state) % ids.length];
  const newId = ids[pick(state) % ids.length];
  const [oldN, oldD] = NOTES[oldId];
  const [newN, newD] = NOTES[newId];
  const result = run({ tempo, oldNote: oldId, newNote: newId });

  const numerator = newN * oldD;
  const denominator = newD * oldN;
  const divisor = gcd(numerator, denominator);
  const exact = tempo * (numerator / divisor) / (denominator / divisor);
  const pulse = 60000 * oldN / oldD / tempo;
  assert.equal(result.newTempo, round3(exact), 'newTempo at ' + index);
  assert.equal(result.pulseMs, round3(pulse), 'pulse at ' + index);
  assert.equal(result.newQuarterMs, round3(60000 / exact), 'new quarter at ' + index);
  assert.equal(result.changePercent, round3((exact / tempo - 1) * 100), 'change at ' + index);
  assert.equal(result.direction, exact > tempo ? 'faster' : exact < tempo ? 'slower' : 'same',
    'direction at ' + index);
  assert.equal(result.oldNoteQuarters, round3(oldN / oldD));
  assert.equal(result.newNoteQuarters, round3(newN / newD));

  assert.equal(result.ratioLeft, numerator / divisor, 'ratio left at ' + index);
  assert.equal(result.ratioRight, denominator / divisor, 'ratio right at ' + index);
  assert.equal(result.ratioValue, Math.round((numerator / denominator) * 10000) / 10000,
    'ratio value at ' + index);

  // The new note and the old note must last the same time.
  const oldNoteMs = (oldN / oldD) * 60000 / tempo;
  const newNoteMs = (newN / newD) * 60000 / exact;
  assert.ok(Math.abs(oldNoteMs - newNoteMs) <= 1e-6, 'shared duration at ' + index);
  assert.ok(Math.abs(result.pulseMs - oldNoteMs) <= 0.0005 + 1e-9, 'pulse agreement at ' + index);
}

// ---- The page must not reach the network, store data or inject markup.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="modulation-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<h1>Metric Modulation Calculator<\/h1>/.test(html), 'page heading');
assert.ok(/name="viewport"/.test(html), 'viewport');
assert.ok(/<meta name="description" content="[^"]{80,}"/.test(html), 'meta description');
for (const id of ['tempo', 'old-note', 'new-note']) {
  assert.ok(new RegExp('id="' + id + '"').test(html), 'input #' + id);
  assert.ok(new RegExp('for="' + id + '"').test(html), 'label for ' + id);
}
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 10, 'the page looks up its controls');
for (const id of requestedIds) {
  assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
}
for (const id of ['presets', 'err', 'result', 'verdict', 'detail', 'kv', 'example', 'clear']) {
  assert.ok(new RegExp('id="' + id + '"').test(html), 'page has #' + id);
}
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/min-height:44px/.test(html), 'touch targets');
assert.ok(/@media \(max-width:620px\)/.test(html), 'mobile layout');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Metric Modulation Calculator');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('rounded'), 'method documents rounding');
assert.ok(record.sources.length >= 2, 'sources are recorded');
assert.equal(record.testCases.length, 19, 'catalog case count');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(kinds('golden'), 5, 'five golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('edge'), 2, 'two edge cases');
assert.equal(kinds('validation'), 8, 'eight validation cases');
const catalogSlugs = catalog.tools.map((tool) => tool.slug);
assert.equal(catalogSlugs.filter((value) => value === slug).length, 1, 'slug is unique');
for (const testCase of record.testCases) {
  const { input, expected } = testCase;
  if (expected.error) {
    assert.equal(failure(input), expected.error, testCase.name);
    continue;
  }
  const result = run(input);
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result[key], value, testCase.name + ' ' + key);
  }
}

console.log('metric modulation: all checks passed');
