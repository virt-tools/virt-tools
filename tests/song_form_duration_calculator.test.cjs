/* Regression checks for the song form core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/song-form-duration-calculator/index.html'), 'utf8');
const start = html.indexOf('/* song-form-core:start */');
const end = html.indexOf('/* song-form-core:end */');
assert.ok(start > -1 && end > start, 'song form core markers missing');
const core = html.slice(start, end + '/* song-form-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SongFormCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const calculate = (options) => C.calculate(options);

// Default arrangement: 32 written bars become 48 performed bars and 96 seconds.
const standard = calculate({});
assert.equal(standard.sectionCount, 5);
assert.equal(standard.writtenBars, 32);
assert.equal(standard.totalBars, 48);
near(standard.beatsPerBar, 4, 'default beats per bar');
near(standard.secondsPerBar, 2, 'default seconds per bar');
near(standard.totalSeconds, 96, 'default duration');
assert.deepEqual(Array.from(standard.rows, (row) => row.performedBars), [4, 16, 16, 8, 4]);
assert.deepEqual(Array.from(standard.rows, (row) => row.startSeconds), [0, 8, 40, 72, 88]);
assert.deepEqual(Array.from(standard.rows, (row) => row.endSeconds), [8, 40, 72, 88, 96]);

// Compound meter supports a dotted-quarter tempo without rounding the timeline.
const compound = calculate({
  bpm: 120,
  meterBeats: 6,
  meterUnit: 8,
  tempoBeat: 'dotted-quarter',
  sections: [{ name: 'Theme', bars: 6, repeats: 2 }]
});
near(compound.beatsPerBar, 2, 'compound beats per bar');
near(compound.secondsPerBar, 1, 'compound seconds per bar');
near(compound.totalSeconds, 12, 'compound total');

// The same 6/8 meter contains three quarter-note tempo beats.
const quarterCompound = calculate({
  bpm: 120,
  meterBeats: 6,
  meterUnit: 8,
  tempoBeat: 'quarter',
  sections: [{ name: 'Theme', bars: 6, repeats: 2 }]
});
near(quarterCompound.beatsPerBar, 3, 'quarter compound beats');
near(quarterCompound.secondsPerBar, 1.5, 'quarter compound bar');
near(quarterCompound.totalSeconds, 18, 'quarter compound total');

// Decimal tempo values remain exact in the unrounded core result.
const decimal = calculate({
  bpm: '73.5',
  sections: [{ name: 'Passage', bars: '5', repeats: '3' }]
});
near(decimal.secondsPerBar, 240 / 73.5, 'decimal tempo bar');
near(decimal.totalSeconds, 15 * 240 / 73.5, 'decimal tempo total');

// Maximum row counts and numeric bounds remain finite.
const upperSections = Array.from({ length: 24 }, (_, i) => ({ name: `S${i + 1}`, bars: 999, repeats: 99 }));
const upper = calculate({
  bpm: 1000,
  meterBeats: 32,
  meterUnit: 1,
  tempoBeat: 'whole',
  sections: upperSections
});
assert.equal(upper.sectionCount, 24);
near(upper.beatsPerBar, 32, 'upper beats per bar');
near(upper.secondsPerBar, 1.92, 'upper seconds per bar');
near(upper.totalBars, 2373624, 'upper total bars');
near(upper.totalSeconds, 4557358.08, 'upper total seconds');
assert.ok(Number.isFinite(upper.totalSeconds));

// Independent deterministic reference sweep across meter and tempo-beat choices.
const units = [1, 2, 4, 8, 16, 32];
const beatLengths = { whole: 4, half: 2, quarter: 1, 'dotted-quarter': 1.5, eighth: 0.5, sixteenth: 0.25 };
const beatNames = Object.keys(beatLengths);
for (let i = 0; i < 300; i++) {
  const bpm = 20 + (i * 17 % 300) + (i % 4) * 0.25;
  const meterBeats = 1 + (i * 7 % 32);
  const meterUnit = units[i % units.length];
  const tempoBeat = beatNames[(i * 5) % beatNames.length];
  const sections = Array.from({ length: 1 + i % 5 }, (_, j) => ({
    name: `Part ${j + 1}`,
    bars: 1 + ((i * 13 + j * 7) % 999),
    repeats: 1 + ((i + j * 3) % 99)
  }));
  const actual = calculate({ bpm, meterBeats, meterUnit, tempoBeat, sections });
  const quarterLength = beatLengths[tempoBeat];
  const referenceBeatsPerBar = (meterBeats * 4 / meterUnit) / quarterLength;
  const referenceBarSeconds = referenceBeatsPerBar * (60 / bpm);
  let expectedCursor = 0;
  let expectedWritten = 0;
  let expectedPlayed = 0;
  sections.forEach((section, j) => {
    const played = section.bars * section.repeats;
    const duration = played * referenceBarSeconds;
    const row = actual.rows[j];
    assert.equal(row.performedBars, played, `sweep ${i} row ${j} played bars`);
    near(row.startSeconds, expectedCursor, `sweep ${i} row ${j} start`);
    near(row.durationSeconds, duration, `sweep ${i} row ${j} duration`);
    expectedCursor += duration;
    near(row.endSeconds, expectedCursor, `sweep ${i} row ${j} end`);
    expectedWritten += section.bars;
    expectedPlayed += played;
  });
  near(actual.beatsPerBar, referenceBeatsPerBar, `sweep ${i} beats per bar`);
  near(actual.secondsPerBar, referenceBarSeconds, `sweep ${i} seconds per bar`);
  near(actual.totalSeconds, expectedCursor, `sweep ${i} total`);
  assert.equal(actual.totalBars, expectedPlayed, `sweep ${i} performed bars`);
  assert.equal(actual.writtenBars, expectedWritten, `sweep ${i} written bars`);
}

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'song-form-duration-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Music');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 18, 'catalog has the full test case set');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => calculate(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  const result = calculate(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') near(result[key], value, `${testCase.name} ${key}`);
    else assert.equal(result[key], value, `${testCase.name} ${key}`);
  }
}

console.log('song-form-duration-calculator: all checks passed (' + record.testCases.length + ' catalog cases, 300 reference cases)');
