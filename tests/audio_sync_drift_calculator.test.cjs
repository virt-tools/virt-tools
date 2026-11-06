/* Regression checks for the audio sync drift calculator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/audio-sync-drift-calculator/index.html'), 'utf8');
const start = html.indexOf('/* audio-sync-core:start */');
const end = html.indexOf('/* audio-sync-core:end */');
assert.ok(start > -1 && end > start, 'audio sync core markers missing');
const core = html.slice(start, end + '/* audio-sync-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = AudioSyncCore;', sandbox);
const S = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
};
const build = (input) => S.plan(input);
const rejects = (input, pattern) => {
  assert.throws(() => S.normalise(input), pattern);
};

// Classic film-sound mismatch: 48.048 kHz audio read at 48 kHz, 20-minute take at 24 fps.
const base = build({ minutes: 20, seconds: 0, fps: 24, tolerance: 1 });
near(base.percent, 0.1, 'percent');
near(base.driftEndSeconds, 1.2, 'end drift');
near(base.driftEndFrames, 28.8, 'end frames');
near(base.driftPerMinuteSeconds, 0.06, 'per minute');
near(base.driftPerMinuteFrames, 1.44, 'per minute frames');
near(base.intervalSeconds, 1000 / 24, 'interval');
near(base.toleranceSeconds, 1 / 24, 'tolerance seconds');
near(base.frameSeconds, 1 / 24, 'frame seconds');
assert.equal(base.needsResync, true);
assert.equal(base.reSyncs, 29);
near(base.speedUp, 1.001, 'speed up');
near(base.speedDown, 1 / 1.001, 'speed down');

// The preset key survives normalisation and presets carry 1,000 ppm.
assert.equal(S.normalise({ minutes: 1, mismatch: 'video-23976' }).ppm, 1000);
assert.equal(S.normalise({ minutes: 1, mismatch: 'audio-48048' }).mismatch, 'audio-48048');
assert.equal(S.normalise({ minutes: 1, mismatch: 'video-2997' }).ppm, 1000);

// An hour of 23.976-on-24 footage at 23.976 fps drifts over 86 frames.
const long = build({ mismatch: 'video-23976', minutes: 60, fps: 23.976, tolerance: 1 });
near(long.driftEndSeconds, 3.6, 'long drift');
near(long.driftEndFrames, 86.3136, 'long frames');
near(long.intervalSeconds, 1 / 0.023976, 'long interval');
assert.equal(long.reSyncs, 87);
assert.equal(long.needsResync, true);

// Custom mismatch, short take.
const custom = build({ mismatch: 'custom', ppm: 250, minutes: 10, fps: 25, tolerance: 1 });
near(custom.percent, 0.025, 'custom percent');
near(custom.driftEndSeconds, 0.15, 'custom drift');
near(custom.driftEndFrames, 3.75, 'custom frames');
near(custom.intervalSeconds, 160, 'custom interval');
assert.equal(custom.reSyncs, 4);

// A generous allowance covers the whole take, so no mid-take marks are needed.
const relaxed = build({ minutes: 20, fps: 24, tolerance: 30 });
near(relaxed.driftEndFrames, 28.8, 'relaxed frames');
assert.equal(relaxed.needsResync, false);
assert.equal(relaxed.reSyncs, 0);

// Half-frame allowance on a one-minute take.
const tight = build({ minutes: 1, fps: 24, tolerance: 0.5 });
near(tight.driftEndSeconds, 0.06, 'tight drift');
near(tight.driftEndFrames, 1.44, 'tight frames');
near(tight.intervalSeconds, 0.5 / 0.024, 'tight interval');
assert.equal(tight.reSyncs, 3);

// String inputs from the form are accepted, and frames stay tied to the chosen rate.
const fromForm = build({ minutes: '2', seconds: '30', fps: '25', tolerance: '2' });
near(fromForm.driftEndSeconds, 0.15, 'form drift');
near(fromForm.driftEndFrames, 3.75, 'form frames');
near(fromForm.intervalSeconds, 80, 'form interval');
assert.equal(fromForm.needsResync, true);
assert.equal(fromForm.reSyncs, 2);

// Rejections: ranges, types, unknown choices and missing custom values.
rejects({ minutes: 721 }, /whole number from 0 to 720/);
rejects({ minutes: 2.5 }, /whole number from 0 to 720/);
rejects({ minutes: '' }, /must be a number/);
rejects({ minutes: 'abc' }, /must be a number/);
rejects({ seconds: 60 }, /whole number from 0 to 59/);
rejects({ seconds: -1 }, /whole number from 0 to 59/);
rejects({ minutes: 0, seconds: 0 }, /at least 1 second/);
rejects({ mismatch: 'bogus', minutes: 1 }, /Choose a clock mismatch/);
rejects({ mismatch: 'custom', minutes: 1 }, /Custom mismatch \(ppm\) must be a number/);
rejects({ mismatch: 'custom', ppm: 0, minutes: 1 }, /from 1 to 10000 ppm/);
rejects({ mismatch: 'custom', ppm: 10001, minutes: 1 }, /from 1 to 10000 ppm/);
rejects({ fps: 26, minutes: 1 }, /Frame rate must be one of the listed rates/);
rejects({ tolerance: 0, minutes: 1 }, /from 0.1 to 120 frames/);
rejects({ tolerance: 121, minutes: 1 }, /from 0.1 to 120 frames/);

console.log('audio sync drift calculator: all assertions passed');
