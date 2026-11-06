/* Regression checks for the uncompressed video data rate calculator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/uncompressed-video-data-rate-calculator/index.html'), 'utf8');
const start = html.indexOf('/* uncompressed-video-core:start */');
const end = html.indexOf('/* uncompressed-video-core:end */');
assert.ok(start > -1 && end > start, 'uncompressed video core markers missing');
const core = html.slice(start, end + '/* uncompressed-video-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = UncompressedVideoCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
};
const base = { width: 3840, height: 2160, fps: 25, chroma: '422', depth: 10, minutes: 60 };
const build = (overrides = {}) => C.calculate({ ...base, ...overrides });
const rejects = (overrides, pattern) => {
  assert.throws(() => C.normalise({ ...base, ...overrides }), pattern);
};

// UHD 4:2:2 10-bit at 25 fps: 20 bits per pixel, 4,147.2 Mb/s, carried on 6G-SDI.
const a = build();
assert.equal(a.pixels, 8294400);
assert.equal(a.samples, 2);
assert.equal(a.bitDepth, 10);
assert.equal(a.bitsPerPixel, 20);
assert.equal(a.bitsPerFrame, 165888000);
near(a.mbps, 4147.2, 'uhd mbps');
near(a.megabytesPerSecond, 518.4, 'uhd MB/s');
near(a.megabytesPerFrame, 20.736, 'uhd MB/frame');
near(a.gigabytesPerMinute, 31.104, 'uhd GB/min');
near(a.gigabytesPerHour, 1866.24, 'uhd GB/hour');
near(a.gigabytesTotal, 1866.24, 'uhd GB total');
assert.equal(a.level.name, '6G-SDI');
near(a.level.mbps, 5940, '6G level rate');
near(a.level.utilisation, 69.81818181818181, '6G utilisation', 1e-9);

// HD 4:2:0 8-bit at 29.97 fps: 12 bits per pixel, 745.75 Mb/s on HD-SDI.
const b = build({ width: 1920, height: 1080, fps: 29.97, chroma: '420', depth: 8, minutes: 10 });
assert.equal(b.pixels, 2073600);
assert.equal(b.bitsPerPixel, 12);
near(b.bitsPerFrame, 24883200, 'hd bits per frame');
near(b.mbps, 745.749504, 'hd mbps');
near(b.megabytesPerSecond, 93.218688, 'hd MB/s');
near(b.megabytesPerFrame, 3.1104, 'hd MB/frame');
near(b.gigabytesPerMinute, 5.59312128, 'hd GB/min');
near(b.gigabytesTotal, 55.9312128, 'hd GB total');
assert.equal(b.level.name, 'HD-SDI');
near(b.level.utilisation, 50.218821818181816, 'hd utilisation');

// DCI 4K 4:4:4 12-bit at 24 fps: 36 bits per pixel, 1,911.03 Mb/s on 3G-SDI.
const c = build({ width: 2048, height: 1080, fps: 24, chroma: '444', depth: 12, minutes: 1 });
assert.equal(c.bitsPerPixel, 36);
near(c.mbps, 1911.02976, 'dci mbps');
near(c.megabytesPerSecond, 238.87872, 'dci MB/s');
near(c.gigabytesPerMinute, 14.3327232, 'dci GB/min');
assert.equal(c.level.name, '3G-SDI');
near(c.level.utilisation, 64.34443636363636, 'dci utilisation');

// Monochrome 720p60 is one sample per pixel and still needs HD-SDI.
const d = build({ width: 1280, height: 720, fps: 60, chroma: 'mono', depth: 8, minutes: 120 });
assert.equal(d.samples, 1);
assert.equal(d.bitsPerPixel, 8);
near(d.mbps, 442.368, 'mono mbps');
near(d.megabytesPerSecond, 55.296, 'mono MB/s');
near(d.gigabytesPerMinute, 3.31776, 'mono GB/min');
near(d.gigabytesTotal, 398.1312, 'mono GB total');
assert.equal(d.level.name, 'HD-SDI');
near(d.level.utilisation, 29.78909090909091, 'mono utilisation');

// 8K 4:4:4 16-bit at 60 fps is far past 12G-SDI.
const e = build({ width: 8192, height: 4320, fps: 60, chroma: '444', depth: 16, minutes: 1 });
assert.equal(e.bitsPerPixel, 48);
near(e.mbps, 101921.5872, '8k mbps');
assert.equal(e.level, null);

// Sampling and bit depth scale the rate in proportion.
const base422 = build();
near(build({ chroma: '420' }).mbps / base422.mbps, 0.75, '4:2:0 is three quarters of 4:2:2');
near(build({ chroma: '444' }).mbps / base422.mbps, 1.5, '4:4:4 is one and a half times 4:2:2');
near(build({ chroma: 'mono' }).mbps / base422.mbps, 0.5, 'monochrome is half of 4:2:2');
near(build({ depth: 8 }).mbps / base422.mbps, 0.8, '8-bit is four fifths of 10-bit');
near(build({ depth: 12 }).mbps / base422.mbps, 1.2, '12-bit is one and one fifth of 10-bit');
near(build({ fps: 50 }).mbps, base422.mbps * 2, 'double frame rate doubles the rate');
near(build({ minutes: 30 }).gigabytesTotal, base422.gigabytesPerMinute * 30, 'duration scales storage');

// The chosen interface is the smallest one that carries the rate, and an exact fit is kept.
const exact270 = build({ width: 720, height: 480, fps: 25, chroma: 'mono', depth: 8, minutes: 1 });
near(exact270.mbps, 69.12, 'sd mbps');
assert.equal(exact270.level.name, 'SD-SDI');
const hd25 = build({ width: 1920, height: 1080, fps: 25, chroma: '422', depth: 10, minutes: 1 });
near(hd25.mbps, 1036.8, 'hd25 mbps');
assert.equal(hd25.level.name, 'HD-SDI');
const hd50 = build({ width: 1920, height: 1080, fps: 50, chroma: '422', depth: 10, minutes: 1 });
near(hd50.mbps, 2073.6, 'hd50 mbps');
assert.equal(hd50.level.name, '3G-SDI');

// Form strings normalise to the same numbers.
const fromForm = C.calculate({
  width: '3840', height: '2160', fps: '25', chroma: '422', depth: '10', minutes: '60'
});
near(fromForm.mbps, a.mbps, 'form mbps');
near(fromForm.gigabytesTotal, a.gigabytesTotal, 'form storage');
assert.equal(C.normalise({ ...base, fps: ' 23.976 ', minutes: ' 1.5 ' }).fps, 23.976);
near(C.normalise({ ...base, fps: '23.976' }).fps * 1000, 23976, 'decimal frame rate');

// Rejections: ranges, types, unsupported sampling, bit depth and missing values.
rejects({ width: 8 }, /Frame width must be from 16 to 16384 px/);
rejects({ width: 16385 }, /Frame width must be from 16 to 16384 px/);
rejects({ width: 'abc' }, /Frame width must be a whole number of px/);
rejects({ width: '38.4' }, /Frame width must be a whole number of px/);
rejects({ width: '' }, /Frame width is required/);
rejects({ height: 15 }, /Frame height must be from 16 to 16384 px/);
rejects({ fps: 0.5 }, /Frame rate must be from 1 to 1000 fps/);
rejects({ fps: 1001 }, /Frame rate must be from 1 to 1000 fps/);
rejects({ fps: 'abc' }, /Frame rate must be a number/);
rejects({ fps: '-25' }, /Frame rate must be a number/);
rejects({ fps: '' }, /Frame rate is required/);
rejects({ minutes: 0.05 }, /Clip duration must be from 0.1 to 10000 min/);
rejects({ minutes: 10001 }, /Clip duration must be from 0.1 to 10000 min/);
rejects({ minutes: 'ten' }, /Clip duration must be a number/);
rejects({ chroma: '411' }, /Choose a chroma sampling/);
rejects({ chroma: '' }, /Choose a chroma sampling/);
rejects({ depth: 9 }, /Bit depth must be 8, 10, 12 or 16 bits per sample/);
rejects({ depth: 0 }, /Bit depth must be 8, 10, 12 or 16 bits per sample/);
rejects({ depth: undefined }, /Bit depth must be 8, 10, 12 or 16 bits per sample/);

// The limits are exposed so the page and tests agree on them.
assert.equal(C.LIMITS.fps.join(','), '1,1000,fps');
assert.equal(C.DEPTHS.join(','), '8,10,12,16');
assert.equal(C.LEVELS[C.LEVELS.length - 1].mbps, 11880);

console.log('uncompressed video data rate calculator: all assertions passed');
