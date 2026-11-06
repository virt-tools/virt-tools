/* Regression checks for the radio horizon calculator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/radio-horizon-calculator/index.html'), 'utf8');
const start = html.indexOf('/* radio-horizon-core:start */');
const end = html.indexOf('/* radio-horizon-core:end */');
assert.ok(start > -1 && end > start, 'radio horizon core markers missing');
const core = html.slice(start, end + '/* radio-horizon-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RadioHorizonCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
};
const plan = (heightA, heightB, target = '') => C.plan({ heightA, heightB, target });
const rejects = (heightA, heightB, target, pattern) => {
  assert.throws(() => C.plan({ heightA, heightB, target }), pattern);
};

// 4.12 x sqrt(h) kilometres: 10 m reaches 13.03 km and 2 m reaches 5.83 km.
const base = plan('10', '2');
near(base.horizonA, 13.034313689, 'horizon A');
near(base.horizonB, 5.829122290, 'horizon B');
near(base.maxDistance, 18.863435978, 'max distance');
near(base.maxDistanceMiles, 11.721192077, 'max distance miles');
assert.equal(base.target, null);
assert.equal(base.requiredHeight, null);
assert.equal(base.coveredByA, false);
assert.equal(base.beyondMax, false);

// Equal heights double the single horizon.
const equal = plan('30', '30');
near(equal.horizonA, 22.576093550, 'equal horizon A');
near(equal.maxDistance, 45.152187101, 'equal max distance');
near(equal.maxDistanceMiles, 28.056259651, 'equal miles');

// Ground-level antennas have no horizon at all.
const ground = plan('0', '0');
assert.equal(ground.horizonA, 0);
assert.equal(ground.horizonB, 0);
assert.equal(ground.maxDistance, 0);
assert.equal(ground.maxDistanceMiles, 0);

// Fractional heights are used exactly.
const small = plan('1.5', '0.5');
near(small.horizonA, 5.048167985, 'small horizon A');
near(small.horizonB, 2.914561145, 'small horizon B');
near(small.maxDistance, 7.962729129, 'small max distance');

// A target inside A's own horizon needs no height at B.
const covered = plan('100', '2', '20');
assert.equal(covered.coveredByA, true);
assert.equal(covered.requiredHeight, 0);
assert.equal(covered.beyondMax, false);
assert.equal(covered.requiredBeyondLimit, false);

// A target just past the combined horizon is flagged and needs a taller B.
const gap = plan('10', '2', '40');
near(gap.requiredHeight, 42.800280857, 'gap height');
assert.equal(gap.coveredByA, false);
assert.equal(gap.beyondMax, true);
assert.equal(gap.requiredBeyondLimit, false);

// A target exactly at the combined horizon needs exactly B's own height.
const exact = plan('10', '2', '18.863435978');
near(exact.requiredHeight, 2, 'exact height', 1e-6);
assert.equal(exact.beyondMax, false);

// A required height beyond the input limit is reported, not silently capped.
const unreachable = plan('0', '0', '200');
near(unreachable.requiredHeight, 2354.418458641, 'unreachable height');
assert.equal(unreachable.beyondMax, true);
assert.equal(unreachable.requiredBeyondLimit, true);

// Top of both ranges stays finite.
const top = plan('2000', '2000');
near(top.horizonA, 184.333031947, 'top horizon');
near(top.maxDistance, 368.666063893, 'top max distance');
assert.ok(isFinite(top.maxDistance));

// Height parsing: required, numeric, unsigned, inside 0-2000.
rejects('', '2', '', /Antenna A height is required/);
rejects('  ', '2', '', /Antenna A height is required/);
rejects('2', '', '', /Antenna B height is required/);
rejects('-1', '2', '', /Antenna A height must be a number/);
rejects('ten', '2', '', /Antenna A height must be a number/);
rejects('1e3', '2', '', /Antenna A height must be a number/);
rejects('2001', '2', '', /Antenna A height must be from 0 to 2000/);
rejects('2.5.1', '2', '', /Antenna A height must be a number/);

// Target parsing: optional, but when present inside 0.1-1000 km.
rejects('10', '2', '0', /Target distance must be from 0.1 to 1000/);
rejects('10', '2', '1001', /Target distance must be from 0.1 to 1000/);
rejects('10', '2', '-5', /Target distance must be a number/);
rejects('10', '2', '40km', /Target distance must be a number/);

// A whitespace-only target is treated as absent, not as zero.
const blank = plan('10', '2', '  ');
assert.equal(blank.target, null);

console.log('radio-horizon-calculator: checks passed');
