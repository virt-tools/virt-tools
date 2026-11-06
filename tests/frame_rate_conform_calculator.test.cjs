/* Regression checks for the frame rate conform core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/frame-rate-conform-calculator/index.html'), 'utf8');
const start = html.indexOf('/* frame-rate-conform-core:start */');
const end = html.indexOf('/* frame-rate-conform-core:end */');
assert.ok(start > -1 && end > start, 'frame rate conform core markers missing');
const core = html.slice(start, end + '/* frame-rate-conform-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = FrameRateConformCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
};
const plan = (source, target, duration) => C.plan({ source, target, duration });
const rejects = (source, target, duration, pattern) => {
  assert.throws(() => C.plan({ source, target, duration }), pattern);
};

// 24 -> 25 fps over 60 s: the classic 4.17% PAL speed-up.
const pal = plan('24', '25', '60');
near(pal.ratio, 1.0416666666666667, 'pal ratio');
near(pal.speedPct, 4.166666666666674, 'pal speed');
assert.equal(pal.sourceFrames, 1440);
near(pal.conformedSeconds, 57.6, 'pal conformed duration');
near(pal.savedSeconds, 2.4, 'pal time saved');
assert.equal(pal.sameTimeFrames, 1500);
assert.equal(pal.frameDelta, 60);
near(pal.semitones, 0.7067242686428233, 'pal semitones');
near(pal.cents, 70.67242686428234, 'pal cents');
assert.equal(pal.palSpeed, true);
assert.equal(pal.pullUp, false);
assert.equal(pal.unchanged, false);
assert.equal(pal.bigChange, false);
assert.equal(pal.slower, false);

// 25 -> 24 fps slows the same clip back down and needs fewer frames for the same running time.
const back = plan('25', '24', '57.6');
near(back.ratio, 0.96, 'back ratio');
near(back.speedPct, -4.0000000000000036, 'back speed');
assert.equal(back.sourceFrames, 1440);
near(back.conformedSeconds, 60, 'back conformed duration');
near(back.savedSeconds, -2.4, 'back time added');
assert.equal(back.sameTimeFrames, 1382);
assert.equal(back.frameDelta, -58);
near(back.semitones, -0.7067242686428228, 'back semitones');
assert.equal(back.palSpeed, true);
assert.equal(back.slower, true);

// 23.976 -> 24 fps is a 0.1% pull-up, not a PAL speed change.
const pull = plan('23.976', '24', '3600');
near(pull.ratio, 1.001001001001001, 'pull ratio');
near(pull.speedPct, 0.10010010010010895, 'pull speed');
assert.equal(pull.sourceFrames, 86314);
near(pull.conformedSeconds, 3596.4166666666665, 'pull conformed duration');
assert.equal(pull.sameTimeFrames, 86400);
assert.equal(pull.frameDelta, 86);
near(pull.semitones, 0.017321002436026137, 'pull semitones');
assert.equal(pull.pullUp, true);
assert.equal(pull.palSpeed, false);

// 29.97 -> 30 fps is the other 0.1% pull-up family.
const ntsc = plan('29.97', '30', '600');
assert.equal(ntsc.sourceFrames, 17982);
near(ntsc.conformedSeconds, 599.4, 'ntsc conformed duration');
assert.equal(ntsc.sameTimeFrames, 18000);
assert.equal(ntsc.frameDelta, 18);
assert.equal(ntsc.pullUp, true);
assert.equal(ntsc.palSpeed, false);

// Equal rates are a no-op.
const sameRate = plan('30', '30', '10');
near(sameRate.ratio, 1, 'same ratio');
near(sameRate.speedPct, 0, 'same speed');
near(sameRate.semitones, 0, 'same semitones');
assert.equal(sameRate.sourceFrames, 300);
near(sameRate.conformedSeconds, 10, 'same conformed duration');
assert.equal(sameRate.sameTimeFrames, 300);
assert.equal(sameRate.frameDelta, 0);
assert.equal(sameRate.unchanged, true);
assert.equal(sameRate.palSpeed, false);
assert.equal(sameRate.pullUp, false);

// Doubling the rate halves the running time and raises the pitch an octave.
const double = plan('60', '120', '5');
near(double.ratio, 2, 'double ratio');
near(double.speedPct, 100, 'double speed');
assert.equal(double.sourceFrames, 300);
near(double.conformedSeconds, 2.5, 'double conformed duration');
assert.equal(double.sameTimeFrames, 600);
assert.equal(double.frameDelta, 300);
near(double.semitones, 12, 'double semitones');
assert.equal(double.bigChange, true);

// Whole-frame rounding: 0.1 s at 24 fps contains two frames, not 2.4, and the
// same running time at 25 fps rounds up to three.
const shortClip = plan('24', '25', '0.1');
assert.equal(shortClip.sourceFrames, 2);
near(shortClip.conformedSeconds, 0.08, 'short conformed duration');
assert.equal(shortClip.sameTimeFrames, 3);
assert.equal(shortClip.frameDelta, 1);

// Extreme limits stay finite: 240 -> 1 fps over 24 hours.
const extreme = plan('240', '1', '86400');
assert.equal(extreme.sourceFrames, 20736000);
near(extreme.conformedSeconds, 20736000, 'extreme conformed duration');
assert.equal(extreme.sameTimeFrames, 86400);
assert.equal(extreme.frameDelta, -20649600);
near(extreme.semitones, -94.88268714730222, 'extreme semitones');
assert.equal(extreme.slower, true);
assert.equal(extreme.bigChange, true);

// Both ends of the frame-rate range are accepted.
assert.equal(plan('1', '240', '1').sourceFrames, 1);
assert.equal(plan('240', '1', '86400').sourceFrames, 20736000);
// A clip shorter than half a frame at the source rate has nothing to conform.
rejects('1', '240', '0.1', /at least one frame at the source rate/);

// Source rate: required, plain decimal, inside 1-240 fps.
rejects('', '25', '60', /Source frame rate is required/);
rejects('   ', '25', '60', /Source frame rate is required/);
rejects('twenty-four', '25', '60', /Source frame rate must be a number/);
rejects('-24', '25', '60', /Source frame rate must be a number/);
rejects('2.4e1', '25', '60', /Source frame rate must be a number/);
rejects('24fps', '25', '60', /Source frame rate must be a number/);
rejects('0', '25', '60', /Source frame rate must be from 1 to 240 fps/);
rejects('0.5', '25', '60', /Source frame rate must be from 1 to 240 fps/);
rejects('240.5', '25', '60', /Source frame rate must be from 1 to 240 fps/);

// Target rate: same rules.
rejects('24', '', '60', /Target frame rate is required/);
rejects('24', 'fast', '60', /Target frame rate must be a number/);
rejects('24', '1e2', '60', /Target frame rate must be a number/);
rejects('24', '0.99', '60', /Target frame rate must be from 1 to 240 fps/);
rejects('24', '241', '60', /Target frame rate must be from 1 to 240 fps/);

// Duration: required, plain decimal, inside 0.1-86,400 s.
rejects('24', '25', '', /Clip duration is required/);
rejects('24', '25', 'one minute', /Clip duration must be a number/);
rejects('24', '25', '60s', /Clip duration must be a number/);
rejects('24', '25', '0.05', /Clip duration must be from 0.1 to 86,400 seconds/);
rejects('24', '25', '90000', /Clip duration must be from 0.1 to 86,400 seconds/);

console.log('frame-rate-conform-calculator: checks passed');
