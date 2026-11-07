/* Regression checks for the video loop planner core and catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/video-loop-planner/index.html'), 'utf8');
const start = html.indexOf('/* video-loop-core:start */');
const end = html.indexOf('/* video-loop-core:end */');
assert.ok(start > -1 && end > start, 'video loop core markers missing');
const core = html.slice(start, end + '/* video-loop-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = VideoLoopCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const base = { clip: '7', target: '60', fps: '30' };
const plan = (overrides = {}) => C.calculate({ ...base, ...overrides });

// The default minute needs eight complete seven-second clips and four seconds.
const standard = plan();
assert.equal(standard.clipFrames, 210);
assert.equal(standard.targetFrames, 1800);
assert.equal(standard.completeLoops, 8);
assert.equal(standard.completeFrames, 1680);
assert.equal(standard.finalFrames, 120);
assert.equal(standard.finalSeconds, 4);
assert.equal(standard.totalPasses, 9);
assert.equal(standard.exactBoundary, false);
assert.equal(C.clock(standard.finalSeconds), '00:04.000');
const text = C.summary(standard);
assert.match(text, /Complete loops: 8 \(1,680 frames; 56 s\)/);
assert.match(text, /Final pass: use 00:00\.000–00:04\.000 of the clip \(120 frames; 4 s\)/);
assert.match(text, /Total passes: 9/);

// Exact multiples, equal durations and targets shorter than one clip.
const exact = plan({ clip: '6' });
assert.equal(exact.completeLoops, 10);
assert.equal(exact.finalFrames, 0);
assert.equal(exact.totalPasses, 10);
assert.equal(exact.exactBoundary, true);
assert.match(C.summary(exact), /Final pass: none; the target ends on a loop boundary/);
const short = plan({ target: '3' });
assert.equal(short.completeLoops, 0);
assert.equal(short.finalFrames, 90);
assert.equal(short.totalPasses, 1);
const one = plan({ target: '7' });
assert.equal(one.completeLoops, 1);
assert.equal(one.finalFrames, 0);
assert.equal(one.totalPasses, 1);

// Independent repeated-subtraction reference over integral and fractional rates.
for (const fps of [1, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 240]) {
  for (const clip of [0.5, 1, 2.5, 7, 13]) {
    for (const target of [0.5, 1, 7, 60]) {
      const result = plan({ clip: String(clip), target: String(target), fps: String(fps) });
      const clipFrames = Math.max(1, Math.round(clip * fps));
      const targetFrames = Math.max(1, Math.round(target * fps));
      let remaining = targetFrames;
      let loops = 0;
      while (remaining >= clipFrames) {
        remaining -= clipFrames;
        loops += 1;
      }
      assert.equal(result.clipFrames, clipFrames, `clip frames ${clip}s at ${fps}`);
      assert.equal(result.targetFrames, targetFrames, `target frames ${target}s at ${fps}`);
      assert.equal(result.completeLoops, loops, `loops ${clip}/${target} at ${fps}`);
      assert.equal(result.finalFrames, remaining, `remainder ${clip}/${target} at ${fps}`);
      assert.equal(result.completeFrames + result.finalFrames, targetFrames);
      assert.equal(result.totalPasses, loops + (remaining ? 1 : 0));
    }
  }
}

// Strict parsing and lower-frame validation.
assert.throws(() => plan({ clip: '' }), /Clip duration is required\./);
assert.throws(() => plan({ target: '' }), /Target runtime is required\./);
assert.throws(() => plan({ fps: '' }), /Frame rate is required\./);
assert.throws(() => plan({ clip: '-1' }), /Clip duration must be a number/);
assert.throws(() => plan({ target: '1e2' }), /Target runtime must be a number/);
assert.throws(() => plan({ fps: 'NaN' }), /Frame rate must be a number/);
assert.throws(() => plan({ clip: '0.001', fps: '240' }), /Clip duration is shorter than half a frame/);
assert.throws(() => plan({ target: '0.001', fps: '240' }), /Target runtime is shorter than half a frame/);

// Replay every canonical catalog case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'video-loop-planner');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Video');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 15, 'catalog has the full test case set');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.calculate(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') near(result[key], value, `${testCase.name} ${key}`);
    else assert.equal(result[key], value, `${testCase.name} ${key}`);
  }
}

console.log(`video-loop-planner: all checks passed (${record.testCases.length} catalog cases, 500 reference plans)`);
