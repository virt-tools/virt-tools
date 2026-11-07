/* Regression checks for the staggered round and canon entry planner. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/round-entry-planner/index.html'), 'utf8');
const start = html.indexOf('/* round-entry-core:start */');
const end = html.indexOf('/* round-entry-core:end */');
assert.ok(start > -1 && end > start, 'round entry core markers missing');
const core = html.slice(start, end + '/* round-entry-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RoundEntryCore;', sandbox);
const C = sandbox.module.exports;
const near = (actual, expected, label, eps = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)), `${label}: expected ${expected}, got ${actual}`);
};
const check = (result, expected, label) => {
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === 'number') near(result[key], value, `${label}: ${key}`);
    else assert.equal(result[key], value, `${label}: ${key}`);
  }
};

const standard = C.calculate();
check(standard, {
  voices: 4, phraseBars: 8, repeats: 1, staggerBeats: 4,
  secondsPerTempoBeat: 0.5, quarterBeatsPerBar: 4, phraseTempoBeats: 32,
  perVoiceTempoBeats: 32, phraseSeconds: 16, perVoiceSeconds: 16,
  lastEntrySeconds: 6, totalTempoBeats: 44, totalSeconds: 22, elapsedBars: 11
}, 'default four-voice round');
assert.deepEqual(Array.from(standard.rows, (row) => row.startSeconds), [0, 2, 4, 6]);
assert.deepEqual(Array.from(standard.rows, (row) => row.endSeconds), [16, 18, 20, 22]);
assert.deepEqual(Array.from(standard.rows, (row) => row.startBar), [1, 2, 3, 4]);
assert.deepEqual(Array.from(standard.rows, (row) => row.endBar), [9, 10, 11, 12]);
assert.ok(Array.from(standard.rows).every((row) => row.startBeat === 1 && row.endBeat === 1));

const compound = C.calculate({
  bpm: 120, tempoBeat: 'dotted-quarter', meterBeats: 6, meterUnit: 8,
  phraseBars: 4, repeats: 2, voices: 3, staggerBeats: 2
});
check(compound, {
  quarterBeatsPerBar: 3, phraseTempoBeats: 8, perVoiceTempoBeats: 16,
  phraseSeconds: 4, perVoiceSeconds: 8, lastEntrySeconds: 2,
  totalTempoBeats: 20, totalSeconds: 10, elapsedBars: 10
}, 'compound meter with repeats');
assert.deepEqual(Array.from(compound.rows, (row) => row.startSeconds), [0, 1, 2]);
assert.deepEqual(Array.from(compound.rows, (row) => row.endSeconds), [8, 9, 10]);
assert.deepEqual(Array.from(compound.rows, (row) => row.startBar), [1, 2, 3]);

const fractional = C.calculate({
  bpm: 100, meterBeats: 3, meterUnit: 4, phraseBars: 2,
  voices: 3, staggerBeats: 1.5
});
check(fractional, {
  phraseTempoBeats: 6, phraseSeconds: 3.6, lastEntrySeconds: 1.8,
  totalTempoBeats: 9, totalSeconds: 5.4, elapsedBars: 3
}, 'fractional entry gap');
assert.equal(fractional.rows[1].startBar, 1);
assert.equal(fractional.rows[1].startBeat, 2.5);
assert.equal(fractional.rows[2].startBar, 2);
assert.equal(fractional.rows[2].startBeat, 1);

const decimal = C.calculate({ bpm: '73.5', phraseBars: '5', voices: '2', staggerBeats: '3.25' });
near(decimal.lastEntrySeconds, 3.25 * 60 / 73.5, 'decimal last entry');
near(decimal.totalSeconds, (5 * 4 + 3.25) * 60 / 73.5, 'decimal total');
near(decimal.elapsedBars, 23.25 / 4, 'decimal elapsed bars');

const upper = C.calculate({
  bpm: 1000, meterBeats: 32, meterUnit: 1, tempoBeat: 'whole',
  phraseBars: 999, repeats: 99, voices: 16, staggerBeats: 128
});
assert.equal(upper.rows.length, 16);
near(upper.quarterBeatsPerBar, 128, 'upper meter');
near(upper.phraseTempoBeats, 999 * 32, 'upper phrase beats');
near(upper.totalTempoBeats, 15 * 128 + 999 * 32 * 99, 'upper total beats');
assert.ok(Number.isFinite(upper.totalSeconds));

// Independent arithmetic and notation-position references across every note/meter unit.
const beatLengths = { whole: 4, half: 2, quarter: 1, 'dotted-quarter': 1.5, eighth: 0.5, sixteenth: 0.25 };
const beatNames = Object.keys(beatLengths);
const units = [1, 2, 4, 8, 16, 32];
let referenceCases = 0;
for (let i = 0; i < 360; i++) {
  const bpm = 20 + (i * 17 % 300) + (i % 4) * 0.25;
  const meterBeats = 1 + (i * 7 % 32);
  const meterUnit = units[i % units.length];
  const tempoBeat = beatNames[(i * 5) % beatNames.length];
  const phraseBars = 1 + (i * 13 % 40);
  const repeats = 1 + (i % 5);
  const voices = 2 + (i % 15);
  const staggerBeats = 0.25 + (i % 24) * 0.25;
  const actual = C.calculate({ bpm, meterBeats, meterUnit, tempoBeat, phraseBars, repeats, voices, staggerBeats });
  const noteLength = beatLengths[tempoBeat];
  const quarterPerBar = meterBeats * 4 / meterUnit;
  const phraseTempo = phraseBars * quarterPerBar / noteLength;
  const perVoiceTempo = phraseTempo * repeats;
  const secondsPerBeat = 60 / bpm;
  check(actual, {
    quarterBeatsPerBar: quarterPerBar,
    phraseTempoBeats: phraseTempo,
    perVoiceTempoBeats: perVoiceTempo,
    phraseSeconds: phraseTempo * secondsPerBeat,
    perVoiceSeconds: perVoiceTempo * secondsPerBeat,
    lastEntrySeconds: (voices - 1) * staggerBeats * secondsPerBeat,
    totalTempoBeats: (voices - 1) * staggerBeats + perVoiceTempo,
    totalSeconds: ((voices - 1) * staggerBeats + perVoiceTempo) * secondsPerBeat
  }, `reference ${i}`);
  actual.rows.forEach((row, j) => {
    const startTempo = j * staggerBeats;
    const endTempo = startTempo + perVoiceTempo;
    near(row.startSeconds, startTempo * secondsPerBeat, `reference ${i} row ${j} start`);
    near(row.endSeconds, endTempo * secondsPerBeat, `reference ${i} row ${j} end`);
    const startQuarter = startTempo * noteLength;
    const startBarIndex = Math.floor((startQuarter + 1e-9) / quarterPerBar);
    const startBeat = (startQuarter - startBarIndex * quarterPerBar) / (4 / meterUnit) + 1;
    assert.equal(row.startBar, startBarIndex + 1, `reference ${i} row ${j} start bar`);
    near(row.startBeat, startBeat, `reference ${i} row ${j} start beat`);
  });
  referenceCases += 1;
}
assert.equal(referenceCases, 360);

const rejects = (options, message) => assert.throws(
  () => C.calculate(options), (error) => error.message === message, message
);
rejects({ bpm: '' }, 'Tempo is required.');
rejects({ bpm: 0 }, 'Tempo must be a number from 1 to 1000.');
rejects({ tempoBeat: 'dotted-half' }, 'Choose a supported tempo beat.');
rejects({ meterBeats: 2.5 }, 'Meter beats must be a whole number from 1 to 32.');
rejects({ meterUnit: 3 }, 'Meter beat unit must be 1, 2, 4, 8, 16 or 32.');
rejects({ phraseBars: 0 }, 'Phrase length must be a whole number from 1 to 999.');
rejects({ repeats: 100 }, 'Repeats per voice must be a whole number from 1 to 99.');
rejects({ voices: 1 }, 'Voices must be a whole number from 2 to 16.');
rejects({ staggerBeats: 0 }, 'Entry gap must be a number from 0.25 to 128.');

// Replay every canonical catalog case against the same public core used by the page.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'round-entry-planner');
assert.equal(records.length, 1, 'catalog must contain exactly one round entry record');
const record = records[0];
assert.equal(record.name, 'Round & Canon Entry Planner');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('Canon Entry Planner'));
assert.ok(record.testCases.length >= 12, 'catalog carries representative and validation checks');
for (const test of record.testCases) {
  if (test.kind === 'validation') {
    assert.throws(() => C.calculate(test.input), (error) => error.message === test.expected.error, test.name);
    continue;
  }
  assert.equal(test.kind, 'golden', test.name);
  check(C.calculate(test.input), test.expected, test.name);
}

console.log(`round-entry-planner: all checks passed (${record.testCases.length} catalog cases, ${referenceCases} independent reference cases)`);
