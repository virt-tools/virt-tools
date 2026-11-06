/* Regression checks for the practice tempo ramp planner core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/practice-tempo-ramp-planner/index.html'), 'utf8');
const start = html.indexOf('/* practice-tempo-core:start */');
const end = html.indexOf('/* practice-tempo-core:end */');
assert.ok(start > -1 && end > start, 'practice tempo core markers missing');
const core = html.slice(start, end + '/* practice-tempo-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PracticeTempoCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
};
const base = { start: 60, target: 120, step: 5, beats: 32, passes: 3, rest: 30 };
const build = (overrides = {}) => C.plan({ ...base, ...overrides });
const rejects = (overrides, pattern) => {
  assert.throws(() => C.plan({ ...base, ...overrides }), pattern);
};

// Defaults: 60 to 120 BPM in fifths is 13 steps, 39 passes, 871 s playing plus 12 rests of 30 s.
const a = build();
assert.equal(a.steps, 13);
assert.equal(a.totalPasses, 39);
assert.equal(a.rows[0].bpm, 60);
assert.equal(a.rows[a.rows.length - 1].bpm, 120);
near(a.playingSeconds, 871.005119, 'playing seconds');
near(a.restSeconds, 360, 'rest seconds');
near(a.totalSeconds, 1231.005119, 'total seconds');
near(a.rows[0].secondsPerPass, 32, 'first seconds per pass');
near(a.rows[0].stepSeconds, 96, 'first step seconds');
near(a.rows[1].secondsPerPass, 29.538461538461537, 'second seconds per pass');
near(a.rows[1].stepSeconds, 88.61538461538461, 'second step seconds');
near(a.rows[12].stepSeconds, 48, 'last step seconds');
near(a.rows[12].cumulativeSeconds, 1231.005119, 'last cumulative seconds');
assert.equal(a.lastStepGap, 5);

// An evenly dividing range with no rest: three steps, two passes of 16 beats each.
const even = build({ start: 80, target: 100, step: 10, beats: 16, passes: 2, rest: 0 });
assert.equal(even.steps, 3);
assert.equal(even.totalPasses, 6);
near(even.playingSeconds, 64.53333333333333, 'even playing');
near(even.restSeconds, 0, 'even rest');
near(even.totalSeconds, 64.53333333333333, 'even total');
near(even.rows[2].stepSeconds, 19.2, 'even last step');

// A range that does not divide evenly ends exactly on the target with a short final step.
const uneven = build({ start: 60, target: 122, step: 5, beats: 8, passes: 1, rest: 15 });
assert.equal(uneven.steps, 14);
assert.equal(uneven.rows[uneven.rows.length - 1].bpm, 122);
assert.equal(uneven.lastStepGap, 2);
near(uneven.playingSeconds, 76.518186, 'uneven playing');
near(uneven.restSeconds, 195, 'uneven rest');
near(uneven.totalSeconds, 271.518186, 'uneven total');

// Target equal to start is a single step with no rest.
const single = build({ start: 100, target: 100, step: 5, beats: 4, passes: 1, rest: 30 });
assert.equal(single.steps, 1);
assert.equal(single.totalPasses, 1);
assert.equal(single.restSeconds, 0);
assert.equal(single.lastStepGap, 0);
near(single.totalSeconds, 2.4, 'single total');

// A wide range with a large step keeps the ladder short.
const wide = build({ start: 40, target: 208, step: 24, beats: 12, passes: 5, rest: 45 });
assert.equal(wide.steps, 8);
assert.equal(wide.totalPasses, 40);
near(wide.playingSeconds, 305.145446, 'wide playing');
near(wide.restSeconds, 315, 'wide rest');
near(wide.totalSeconds, 620.145446, 'wide total');

// The top of every range is still finite.
const top = build({ start: 20, target: 400, step: 50, beats: 512, passes: 50, rest: 600 });
assert.equal(top.steps, 9);
assert.equal(top.totalPasses, 450);
near(top.playingSeconds, 146040.209683, 'top playing');
near(top.restSeconds, 4800, 'top rest');
near(top.totalSeconds, 150840.209683, 'top total');
assert.ok(isFinite(top.totalSeconds));

// Exactly sixty steps is accepted; one more is rejected.
const capped = build({ start: 20, target: 400, step: 6.5, beats: 1, passes: 1, rest: 0 });
assert.equal(capped.steps, 60);
assert.equal(capped.rows[59].bpm, 400);
rejects({ start: 20, target: 400, step: 0.5 }, /more than 60 steps/);

// Invalid start tempos.
rejects({ start: '' }, /Start tempo is required/);
rejects({ start: 'abc' }, /Start tempo must be a number/);
rejects({ start: '19' }, /Start tempo must be from 20 to 400/);
rejects({ start: '401' }, /Start tempo must be from 20 to 400/);
rejects({ start: '-60' }, /Start tempo must be a number/);

// A target below the start is a contradiction, not a reverse ramp.
rejects({ start: 120, target: 100 }, /Target tempo must be at least the start tempo/);
rejects({ target: 'fast' }, /Target tempo must be a number/);
rejects({ target: '401' }, /Target tempo must be from 20 to 400/);

// Invalid step sizes.
rejects({ step: '' }, /Step size is required/);
rejects({ step: '0' }, /Step size must be from 0.5 to 50/);
rejects({ step: '51' }, /Step size must be from 0.5 to 50/);
rejects({ step: 'five' }, /Step size must be a number/);

// Beats and passes must be whole numbers in range.
rejects({ beats: '' }, /Beats per pass is required/);
rejects({ beats: '0' }, /Beats per pass must be from 1 to 512/);
rejects({ beats: '513' }, /Beats per pass must be from 1 to 512/);
rejects({ beats: '2.5' }, /Beats per pass must be a whole number/);
rejects({ beats: 'sixteen' }, /Beats per pass must be a whole number/);
rejects({ passes: '0' }, /Passes per step must be from 1 to 50/);
rejects({ passes: '51' }, /Passes per step must be from 1 to 50/);
rejects({ passes: '1.5' }, /Passes per step must be a whole number/);

// Rest time may be zero but not negative or above the ceiling.
rejects({ rest: '' }, /Rest between steps is required/);
rejects({ rest: '-1' }, /Rest between steps must be a number/);
rejects({ rest: '601' }, /Rest between steps must be from 0 to 600/);
rejects({ rest: 'half' }, /Rest between steps must be a number/);

console.log('practice-tempo-ramp-planner: checks passed');
