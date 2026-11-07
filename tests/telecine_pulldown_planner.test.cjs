/* Regression checks for the telecine pulldown planner core and catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/telecine-pulldown-planner/index.html'), 'utf8');
const startMarker = '/* telecine-pulldown-core:start */';
const endMarker = '/* telecine-pulldown-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'telecine pulldown core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = TelecinePulldownCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)), `${label}: expected ${expected}, got ${actual}`);
};
const plan = (preset = '24-23', frames = 8) => C.calculate({ preset, frames });

// Standard 2:3 produces AA, BB, BC, CD, DD over five output frames.
const standard = plan('24-23', 4);
assert.deepEqual(Array.from(standard.pattern), [2, 3, 2, 3]);
assert.equal(standard.preview.length, 5);
const expectedStandard = [
  [1, 1, 'clean'], [2, 2, 'clean'], [2, 3, 'mixed'], [3, 4, 'mixed'], [4, 4, 'clean']
];
standard.preview.forEach((row, index) => {
  assert.equal(row.number, index + 1);
  assert.equal(row.firstSource, expectedStandard[index][0]);
  assert.equal(row.secondSource, expectedStandard[index][1]);
  assert.equal(row.kind, expectedStandard[index][2]);
  assert.equal(row.firstField, index * 2 + 1);
  assert.equal(row.secondField, index * 2 + 2);
});
assert.match(C.summary(standard), /3: F2 \/ F3 · mixed/);
assert.match(C.summary(standard), /Output fields: 10 \(2 repeated beyond 2:2\)/);

// Advanced 2:3:3:2 changes the mixed-frame positions and leaves four clean frames.
const advanced = plan('24-2332', 4);
assert.deepEqual(Array.from(advanced.pattern), [2, 3, 3, 2]);
assert.deepEqual(Array.from(advanced.preview, (row) => `${row.firstSource}/${row.secondSource}:${row.kind}`), [
  '1/1:clean', '2/2:clean', '2/3:mixed', '3/3:clean', '4/4:clean'
]);
assert.equal(advanced.cleanOutputFrames, 4);
assert.equal(advanced.mixedOutputFrames, 1);

// Partial cycles expose the incomplete output frame rather than hiding its final field.
const partial = plan('24-23', 2);
assert.equal(partial.totalFields, 5);
assert.equal(partial.completeOutputFrames, 2);
assert.equal(partial.outputFramesSpanned, 3);
assert.equal(partial.unpairedFields, 1);
assert.equal(partial.preview.length, 3);
assert.equal(partial.preview[2].firstSource, 2);
assert.equal(partial.preview[2].secondSource, null);
assert.equal(partial.preview[2].secondField, null);
assert.equal(partial.preview[2].kind, 'incomplete');
assert.match(C.summary(partial), /3: F2 \/ — · incomplete/);

// A long plan still bounds its preview to ten output frames.
const longPlan = plan('24-23', 10000000);
assert.equal(longPlan.preview.length, 10);
assert.equal(longPlan.completeOutputFrames, 12500000);
assert.equal(longPlan.totalFields, 25000000);

// Independent field-by-field reference for every preset and many cycle boundaries.
const patterns = {
  '24-23': [2, 3, 2, 3],
  '24-2332': [2, 3, 3, 2],
  '23976-23': [2, 3, 2, 3],
  '23976-2332': [2, 3, 3, 2],
  '25-22': [2],
  '24-22': [2]
};
let referencePlans = 0;
for (const [preset, pattern] of Object.entries(patterns)) {
  for (let sourceFrames = 1; sourceFrames <= 200; sourceFrames += 1) {
    const fields = [];
    for (let source = 0; source < sourceFrames; source += 1) {
      for (let repeat = 0; repeat < pattern[source % pattern.length]; repeat += 1) fields.push(source + 1);
    }
    let clean = 0;
    let mixed = 0;
    for (let index = 0; index + 1 < fields.length; index += 2) {
      if (fields[index] === fields[index + 1]) clean += 1;
      else mixed += 1;
    }
    const result = plan(preset, sourceFrames);
    assert.equal(result.totalFields, fields.length, `${preset}/${sourceFrames} fields`);
    assert.equal(result.completeOutputFrames, Math.floor(fields.length / 2), `${preset}/${sourceFrames} complete`);
    assert.equal(result.outputFramesSpanned, Math.ceil(fields.length / 2), `${preset}/${sourceFrames} spanned`);
    assert.equal(result.cleanOutputFrames, clean, `${preset}/${sourceFrames} clean`);
    assert.equal(result.mixedOutputFrames, mixed, `${preset}/${sourceFrames} mixed`);
    assert.equal(result.unpairedFields, fields.length % 2, `${preset}/${sourceFrames} tail`);
    assert.equal(result.repeatedFields, fields.length - sourceFrames * 2, `${preset}/${sourceFrames} repeated`);
    assert.equal(result.wholeCycles, Math.floor(sourceFrames / pattern.length));
    assert.equal(result.remainderSourceFrames, sourceFrames % pattern.length);
    near(result.sourceSeconds, sourceFrames / result.sourceFps, `${preset}/${sourceFrames} source time`);
    near(result.outputSeconds, fields.length / (2 * result.outputFps), `${preset}/${sourceFrames} output time`);
    near(result.durationDelta, result.outputSeconds - result.sourceSeconds, `${preset}/${sourceFrames} duration delta`);
    if (sourceFrames % pattern.length === 0) near(result.durationDelta, 0, `${preset}/${sourceFrames} complete-cycle timing`);
    referencePlans += 1;
  }
}

// Strict input validation beyond the canonical cases.
assert.throws(() => plan('__proto__', 4), /Choose a supported conversion and cadence\./);
assert.throws(() => plan('constructor', 4), /Choose a supported conversion and cadence\./);
for (const value of [null, '', '   ']) assert.throws(() => plan('24-23', value), /Source frame count is required\./);
assert.throws(() => C.calculate({ preset: '24-23' }), /Source frame count is required\./);
for (const value of [0, -1, 1.2, '1.0', '1e2', '+4', '4fps', 'NaN', Infinity, 10000001, '9007199254740992']) {
  assert.throws(() => plan('24-23', value), /Source frame count must be a whole number from 1 to 10,000,000\./);
}
assert.equal(plan('24-23', '0004').sourceFrames, 4);
assert.equal(plan('24-23', 1).sourceFrames, 1);

// Replay every canonical catalog case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'telecine-pulldown-planner');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Video');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 17, 'catalog has the full test case set');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.calculate(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') near(result[key], expected, `${testCase.name}: ${key}`);
    else assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
}

console.log(`telecine-pulldown-planner: all checks passed (${record.testCases.length} catalog cases, ${referencePlans} field-by-field reference plans)`);
