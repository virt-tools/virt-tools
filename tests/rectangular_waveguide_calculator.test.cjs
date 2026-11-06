/* Regression checks for the rectangular waveguide calculator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/rectangular-waveguide-calculator/index.html'), 'utf8');
const start = html.indexOf('/* waveguide-core:start */');
const end = html.indexOf('/* waveguide-core:end */');
assert.ok(start > -1 && end > start, 'waveguide core markers missing');
const core = html.slice(start, end + '/* waveguide-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = WaveguideCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
};
const base = { a: 22.86, b: 10.16, freq: 10 };
const build = (overrides = {}) => C.calculate({ ...base, ...overrides });
const rejects = (overrides, pattern) => {
  assert.throws(() => C.normalise({ ...base, ...overrides }), pattern);
};

// WR-90 at 10 GHz: fc10 = 6.5571 GHz, next mode TE20 at 13.1143 GHz, single mode.
const a = build();
near(a.fc10 / 1e9, 6.557140376203, 'wr90 fc10');
near(a.fc20 / 1e9, 13.114280752406, 'wr90 fc20');
near(a.fc01 / 1e9, 14.753565846457, 'wr90 fc01');
near(a.fc11 / 1e9, 16.14508578791, 'wr90 fc11');
assert.equal(a.nextMode, 'TE20');
near(a.nextGHz, 13.114280752406, 'wr90 next mode');
near(a.bandLow / 1e9, 8.196425470254, 'wr90 band low');
near(a.bandHigh / 1e9, 12.458566714786, 'wr90 band high');
near(a.lambda0, 29.9792458, 'wr90 lambda0');
near(a.lambdaG, 39.707119211112, 'wr90 lambdag');
near(a.phaseVelocity, 1.324486929258, 'wr90 vp');
near(a.groupVelocity, 0.755009338265, 'wr90 vg');
near(a.impedance, 498.974376308524, 'wr90 impedance');
assert.equal(a.status, 'single');

// The dominant cutoff is exactly half the TE20 cutoff, and the band is 1.25x to 1.9x fc.
near(a.fc20, 2 * a.fc10, 'te20 is twice te10');
near(a.bandLow, 1.25 * a.fc10, 'band low is 1.25 fc');
near(a.bandHigh, 1.9 * a.fc10, 'band high is 1.9 fc');

// Phase and group velocity multiply to c squared, and the guide wavelength scales with them.
near(a.phaseVelocity * a.groupVelocity, 1, 'vp times vg is c squared');
near(a.lambdaG / a.lambda0, a.phaseVelocity, 'lambdag scales with vp');
near(a.impedance, 376.730313668 * a.phaseVelocity, 'impedance scales with vp');
assert.ok(a.lambdaG > a.lambda0, 'guide wavelength exceeds free-space wavelength');
assert.ok(a.groupVelocity < 1 && a.phaseVelocity > 1, 'one velocity is slow, the other fast');

// WR-62 at 15 GHz: the higher modes are close together and the TE20 wins.
const b = build({ a: 15.799, b: 7.899, freq: 15 });
near(b.fc10 / 1e9, 9.487703588835, 'wr62 fc10');
near(b.fc20 / 1e9, 18.975407177669, 'wr62 fc20');
near(b.fc01 / 1e9, 18.976608304849, 'wr62 fc01');
assert.equal(b.nextMode, 'TE20');
near(b.nextGHz, 18.975407177669, 'wr62 next mode');
near(b.lambdaG, 25.803605391728, 'wr62 lambdag');
near(b.phaseVelocity, 1.291073442801, 'wr62 vp');
near(b.groupVelocity, 0.774549275702, 'wr62 vg');
near(b.impedance, 486.386503074946, 'wr62 impedance');
assert.equal(b.status, 'single');

// WR-10 is square in cutoff terms: TE20 and TE01 cut off together.
const c = build({ a: 2.54, b: 1.27, freq: 90 });
assert.equal(c.nextMode, 'TE20 / TE01');
near(c.nextGHz, 118.028526771654, 'wr10 next mode');
near(c.fc10 / 1e9, 59.014263385827, 'wr10 fc10');
near(c.lambdaG, 4.411902134568, 'wr10 lambdag');
assert.equal(c.status, 'single');

// Below cutoff the guide is evanescent: no wavelength, velocity or impedance.
const d = build({ freq: 5 });
assert.equal(d.status, 'below');
assert.equal(d.lambdaG, null);
assert.equal(d.phaseVelocity, null);
assert.equal(d.groupVelocity, null);
assert.equal(d.impedance, null);
near(d.lambda0, 59.9584916, 'below cutoff lambda0 still computed');
const fcGHz = a.fc10 / 1e9;
assert.equal(build({ freq: fcGHz * 0.999 }).status, 'below');
assert.equal(build({ freq: fcGHz * 1.001 }).status, 'single');

// Above the next-mode cutoff the guide is multimode, but still propagates.
const e = build({ freq: 14 });
assert.equal(e.status, 'multi');
near(e.lambdaG, 24.23647403423, 'multimode lambdag');
near(e.phaseVelocity, 1.131818454483, 'multimode vp');

// Long-wavelength WR-284 near 3 GHz behaves like the low band it is.
const f = build({ a: 72.136, b: 34.036, freq: 3 });
near(f.fc10 / 1e9, 2.077967020628, 'wr284 fc10');
near(f.lambdaG, 138.548726213366, 'wr284 lambdag');
near(f.groupVelocity, 0.721268409061, 'wr284 vg');

// A wall very close to cutoff still returns finite numbers.
const g = build({ freq: 6.6 });
assert.equal(g.status, 'single');
assert.ok(isFinite(g.lambdaG) && g.lambdaG > 100, 'near-cutoff wavelength is long but finite');

// Form strings normalise to the same numbers.
const fromForm = C.calculate({ a: '22.86', b: '10.16', freq: '10' });
near(fromForm.fc10, a.fc10, 'form fc10');
near(fromForm.lambdaG, a.lambdaG, 'form lambdag');
assert.equal(C.normalise({ ...base, a: ' 22.86 ' }).a, 22.86);
assert.equal(C.normalise({ ...base, freq: '.5' }).freq, 0.5);

// Rejections: wall ordering, ranges, types and missing values.
rejects({ a: 10, b: 10 }, /Broad wall a must be larger than narrow wall b/);
rejects({ a: 10, b: 22.86 }, /Broad wall a must be larger than narrow wall b/);
rejects({ a: 0.01 }, /Broad wall must be from 0.05 to 2000 mm/);
rejects({ a: 2001 }, /Broad wall must be from 0.05 to 2000 mm/);
rejects({ a: 'abc' }, /Broad wall must be a number/);
rejects({ a: '-22' }, /Broad wall must be a number/);
rejects({ a: '' }, /Broad wall is required/);
rejects({ a: undefined }, /Broad wall is required/);
rejects({ b: 0.01 }, /Narrow wall must be from 0.05 to 2000 mm/);
rejects({ b: 2001 }, /Narrow wall must be from 0.05 to 2000 mm/);
rejects({ b: 'x' }, /Narrow wall must be a number/);
rejects({ b: '' }, /Narrow wall is required/);
rejects({ freq: 0 }, /Operating frequency must be from 0.001 to 1000 GHz/);
rejects({ freq: 1001 }, /Operating frequency must be from 0.001 to 1000 GHz/);
rejects({ freq: 'ten' }, /Operating frequency must be a number/);
rejects({ freq: '-10' }, /Operating frequency must be a number/);
rejects({ freq: '' }, /Operating frequency is required/);

// The band table and limits are exposed so the page and tests agree.
assert.equal(C.BANDS.length, 12);
assert.equal(C.BANDS[0].id, 'wr284');
const wr90 = C.BANDS.find((band) => band.id === 'wr90');
assert.equal(wr90.a, 22.86);
assert.equal(wr90.b, 10.16);
assert.equal(C.LIMITS.a.join(','), '0.05,2000,mm');
assert.equal(C.LIMITS.freq.join(','), '0.001,1000,GHz');

console.log('rectangular waveguide calculator: all assertions passed');
