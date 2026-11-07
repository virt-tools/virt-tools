/* Regression checks for the end credits roll planner core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/end-credits-roll-planner/index.html'), 'utf8');
const startMarker = '/* end-credits-roll-core:start */';
const endMarker = '/* end-credits-roll-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'End credits roll core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = EndCreditsRollCore;', sandbox);
const C = sandbox.module.exports;
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-12, Math.abs(expected) * 1e-11), `${label || 'value'}: ${actual} != ${expected}`);

const standard = C.calculate({});
assert.equal(standard.totalRows, 8);
assert.equal(standard.nonEmptyRows, 6);
assert.equal(standard.spacerRows, 2);
assert.equal(standard.contentHeight, 512);
assert.equal(standard.scrollDistance, 1592);
assert.equal(standard.frameCount, 796);
close(standard.requestedSeconds, 1592 / 60);
close(standard.durationSeconds, 796 / 30);
close(standard.alignedSpeed, 1592 / (796 / 30));
close(standard.pixelsPerFrame, 2);
assert.equal(C.clock(4), '00:00:04.000');
assert.equal(C.clock(3661.234), '01:01:01.234');
assert.match(C.summary(standard), /End credits roll plan/);
assert.match(C.summary(standard), /Travel distance: 1592 px/);

assert.throws(() => C.calculate({credits: Array(2001).fill('A').join('\n')}), /2,000 rows or fewer/);
assert.throws(() => C.calculate({credits: 'A'.repeat(50001)}), /50,000 characters or fewer/);
assert.throws(() => C.calculate({credits: {}}), /Credit text must be a string/);
for (const value of ['', ' ', -1, 0, '1e2', 'NaN', Infinity, 500.001]) {
  assert.throws(() => C.calculate({lineHeight: value}), /Line height/);
}
for (const value of ['', ' ', -1, 0, '1e2', 'NaN', Infinity, 16384.001]) {
  assert.throws(() => C.calculate({frameHeight: value}), /Frame height/);
}
for (const value of ['', ' ', -1, 0, '1e2', 'NaN', Infinity, 240.001]) {
  assert.throws(() => C.calculate({fps: value}), /Frame rate/);
}
for (const value of ['', ' ', -1, 0, '1e2', 'NaN', Infinity, 10000.001]) {
  assert.throws(() => C.calculate({mode: 'speed', speed: value}), /Scroll speed/);
}
for (const value of ['', ' ', -1, 0, '1e2', 'NaN', Infinity, 86400.001]) {
  assert.throws(() => C.calculate({mode: 'duration', target: value}), /Target duration/);
}

// Independently enumerate both planning directions and fractional frame rates.
let enumerated = 0;
for (const rowCount of [1, 2, 8, 40]) {
  const credits = Array(rowCount).fill('Credit').join('\n');
  for (const lineHeight of [32, 64]) {
    for (const frameHeight of [720, 1080]) {
      for (const fps of [24, 29.97, 30]) {
        for (const mode of ['speed', 'duration']) {
          for (const pace of [12, 45]) {
            const input = mode === 'speed'
              ? {credits, mode, lineHeight, frameHeight, fps, speed: pace}
              : {credits, mode, lineHeight, frameHeight, fps, target: pace};
            const result = C.calculate(input);
            const expectedContent = rowCount * lineHeight;
            const expectedDistance = expectedContent + frameHeight;
            const expectedRequested = mode === 'speed' ? expectedDistance / pace : pace;
            const expectedFrames = Math.round(expectedRequested * fps);
            const expectedDuration = expectedFrames / fps;
            assert.equal(result.contentHeight, expectedContent);
            assert.equal(result.scrollDistance, expectedDistance);
            close(result.requestedSeconds, expectedRequested, 'requested duration');
            assert.equal(result.frameCount, expectedFrames);
            close(result.durationSeconds, expectedDuration, 'frame duration');
            close(result.alignedSpeed, expectedDistance / expectedDuration, 'aligned speed');
            close(result.pixelsPerFrame, expectedDistance / expectedFrames, 'pixels per frame');
            close(result.durationDelta, expectedDuration - expectedRequested, 'rounding delta');
            enumerated += 1;
          }
        }
      }
    }
  }
}
assert.equal(enumerated, 192);

// Replay every canonical catalog case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'end-credits-roll-planner');
assert.equal(records.length, 1, 'catalog must contain exactly one end credits roll planner');
const record = records[0];
assert.equal(record.name, 'End Credits Roll Planner');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('Credits Roll Duration Calculator'));
assert.ok(record.testCases.length >= 14, 'catalog carries golden and validation checks');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.calculate(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  assert.equal(testCase.kind, 'golden', testCase.name);
  const result = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) close(result[key], expected, `${testCase.name}: ${key}`);
}

console.log(`end-credits-roll-planner: all checks passed (${record.testCases.length} catalog cases and ${enumerated} independently checked configurations)`);
