/* Regression checks for the render time estimator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/render-time-estimator/index.html'), 'utf8');
const start = html.indexOf('/* render-time-core:start */');
const end = html.indexOf('/* render-time-core:end */');
assert.ok(start > -1 && end > start, 'render time core markers missing');
const core = html.slice(start, end + '/* render-time-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RenderTimeCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
};
const base = { clip: '2:30', fps: 24, secondsPerFrame: 0.5, machines: 4, margin: 10 };
const build = (overrides = {}) => C.calculate({ ...base, ...overrides });
const rejects = (overrides, pattern) => {
  assert.throws(() => C.calculate({ ...base, ...overrides }), pattern);
};

// Defaults: 150 s at 24 fps is 3600 frames; 30 minutes on one machine, 7.5 on four, 8.25 with 10%.
const a = build();
assert.equal(a.clipSeconds, 150);
assert.equal(a.frames, 3600);
near(a.singleMachineSeconds, 1800, 'single machine seconds');
near(a.baseSeconds, 450, 'base seconds');
near(a.marginSeconds, 45, 'margin seconds');
near(a.wallSeconds, 495, 'wall seconds');
near(a.footagePerHour, 1090.9090909090909, 'footage per hour');

// Duration parsing accepts plain seconds, mm:ss and h:mm:ss.
assert.equal(C.parseDuration('90'), 90);
assert.equal(C.parseDuration('2:30'), 150);
assert.equal(C.parseDuration(' 0:45 '), 45);
assert.equal(C.parseDuration('1:02:03'), 3723);
assert.equal(C.parseDuration('24:00:00'), 86400);

// A one-hour clip at 25 fps: 93075 frames, 0.08 s each on four machines is 1861.5 s.
const long = build({ clip: '1:02:03', fps: 25, secondsPerFrame: 0.08, machines: 4, margin: 0 });
assert.equal(long.clipSeconds, 3723);
assert.equal(long.frames, 93075);
near(long.singleMachineSeconds, 7446, 'long single machine');
near(long.baseSeconds, 1861.5, 'long base');
near(long.marginSeconds, 0, 'long margin');
near(long.wallSeconds, 1861.5, 'long wall');
near(long.footagePerHour, 7200, 'long footage per hour');

// Sub-minute clips and a 15% margin round-trip through the arithmetic.
const short = build({ clip: '45', fps: 30, secondsPerFrame: 1.25, machines: 2, margin: 15 });
assert.equal(short.frames, 1350);
near(short.baseSeconds, 843.75, 'short base');
near(short.marginSeconds, 126.5625, 'short margin');
near(short.wallSeconds, 970.3125, 'short wall');
near(short.footagePerHour, 166.95652173913043, 'short footage per hour');

// 23.976 is used as entered: 90 s is 2157.84 frames, rounded to 2158.
const ntsc = build({ clip: '90', fps: 23.976, secondsPerFrame: 2.5, machines: 1, margin: 20 });
assert.equal(ntsc.frames, 2158);
near(ntsc.singleMachineSeconds, 5395, 'ntsc single machine');
near(ntsc.wallSeconds, 6474, 'ntsc wall');
near(ntsc.footagePerHour, 50.046339203000925, 'ntsc footage per hour');

// Machine count divides the work; the margin is a percentage of the divided base.
const many = build({ clip: '10:00', fps: 60, secondsPerFrame: 0.25, machines: 8, margin: 5 });
assert.equal(many.frames, 36000);
near(many.singleMachineSeconds, 9000, 'many single machine');
near(many.baseSeconds, 1125, 'many base');
near(many.wallSeconds, 1181.25, 'many wall');
near(many.marginSeconds, 56.25, 'many margin');

// A full-scale job at the top of every range is still finite.
const big = build({ clip: '24:00:00', fps: 240, secondsPerFrame: 600, machines: 512, margin: 100 });
assert.equal(big.frames, 20736000);
near(big.singleMachineSeconds, 12441600000, 'big single machine');
near(big.wallSeconds, 48600000, 'big wall');
assert.ok(isFinite(big.footagePerHour));

// Invalid clip lengths.
rejects({ clip: '' }, /Clip length is required/);
rejects({ clip: 'abc' }, /Clip length must be seconds, mm:ss or h:mm:ss/);
rejects({ clip: '2:75' }, /minutes and seconds must be under 60/);
rejects({ clip: '1:75:00' }, /minutes and seconds must be under 60/);
rejects({ clip: '1:2:3:4' }, /Clip length must be seconds, mm:ss or h:mm:ss/);
rejects({ clip: '-5' }, /Clip length must be seconds, mm:ss or h:mm:ss/);
rejects({ clip: '0' }, /Clip length must be from 1 second to 24 hours/);
rejects({ clip: '24:00:01' }, /Clip length must be from 1 second to 24 hours/);
rejects({ clip: '2.5:00' }, /Clip length must be seconds, mm:ss or h:mm:ss/);

// Invalid frame rates.
rejects({ fps: '' }, /Frame rate is required/);
rejects({ fps: '0' }, /Frame rate must be from 1 to 240/);
rejects({ fps: '241' }, /Frame rate must be from 1 to 240/);
rejects({ fps: '-24' }, /Frame rate must be a number/);
rejects({ fps: 'fast' }, /Frame rate must be a number/);

// Invalid per-frame costs.
rejects({ secondsPerFrame: '' }, /Seconds per frame is required/);
rejects({ secondsPerFrame: '0' }, /Seconds per frame must be from 0.001 to 600/);
rejects({ secondsPerFrame: '601' }, /Seconds per frame must be from 0.001 to 600/);
rejects({ secondsPerFrame: '.0005' }, /Seconds per frame must be from 0.001 to 600/);

// Invalid machine counts, including fractional and out-of-range values.
rejects({ machines: '' }, /Machines is required/);
rejects({ machines: '0' }, /Machines must be from 1 to 512/);
rejects({ machines: '513' }, /Machines must be from 1 to 512/);
rejects({ machines: '2.5' }, /Machines must be a whole number/);
rejects({ machines: 'four' }, /Machines must be a whole number/);

// Invalid safety margins.
rejects({ margin: '' }, /Safety margin is required/);
rejects({ margin: '-1' }, /Safety margin must be a number/);
rejects({ margin: '101' }, /Safety margin must be from 0 to 100/);
rejects({ margin: 'ten' }, /Safety margin must be a number/);

console.log('render-time-estimator: ' + 9 + ' groups of checks passed');
