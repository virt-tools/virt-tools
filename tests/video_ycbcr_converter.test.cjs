/* Regression checks for the 8-bit video RGB/YCbCr converter. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/video-ycbcr-converter/index.html'), 'utf8');
const start = html.indexOf('/* video-ycbcr-core:start */');
const end = html.indexOf('/* video-ycbcr-core:end */');
assert.ok(start > -1 && end > start, 'video YCbCr core markers missing');
const core = html.slice(start, end + '/* video-ycbcr-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = VideoYcbcrCore;', sandbox);
const C = sandbox.module.exports;

const array = (value) => Array.from(value);
const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
};
const rgb = (r, g, b, matrix = '709', range = 'limited') => C.convert({
  direction: 'rgbToYcbcr', r, g, b, matrix, range
});
const ycc = (y, cb, cr, matrix = '709', range = 'limited') => C.convert({
  direction: 'ycbcrToRgb', y, cb, cr, matrix, range
});

// 100% primary and monochrome code values from the standard matrices.
assert.deepEqual(array(rgb(255, 0, 0).ycbcr), [63, 102, 240], 'BT.709 limited red');
assert.deepEqual(array(rgb(0, 255, 0).ycbcr), [173, 42, 26], 'BT.709 limited green');
assert.deepEqual(array(rgb(0, 0, 255).ycbcr), [32, 240, 118], 'BT.709 limited blue');
assert.deepEqual(array(rgb(255, 255, 255).ycbcr), [235, 128, 128], 'BT.709 limited white');
assert.deepEqual(array(rgb(0, 0, 0).ycbcr), [16, 128, 128], 'BT.709 limited black');
assert.deepEqual(array(rgb(255, 0, 0, '601').ycbcr), [81, 90, 240], 'BT.601 limited red');
assert.deepEqual(array(rgb(0, 255, 0, '601').ycbcr), [145, 54, 34], 'BT.601 limited green');
assert.deepEqual(array(rgb(0, 0, 255, '601').ycbcr), [41, 240, 110], 'BT.601 limited blue');
assert.deepEqual(array(rgb(255, 0, 0, '2020').ycbcr), [74, 97, 240], 'BT.2020 limited red');
assert.deepEqual(array(rgb(255, 0, 0, '709', 'full').ycbcr), [54, 98, 255], 'BT.709 full red');
assert.deepEqual(array(rgb(0, 0, 0, '709', 'full').ycbcr), [0, 128, 128], 'full-range black');
assert.deepEqual(array(rgb(128, 128, 128, '709', 'full').ycbcr), [128, 128, 128], 'full-range neutral');

// Inverse conversion gives the expected quantized round trips. Primary colors
// can move by one code after their YCbCr codes have been rounded.
const inverseCases = [
  { spec: [255, 0, 0, '709', 'limited'], expected: [255, 1, 0] },
  { spec: [0, 255, 0, '709', 'limited'], expected: [0, 255, 1] },
  { spec: [0, 0, 255, '709', 'limited'], expected: [1, 0, 255] },
  { spec: [255, 255, 255, '709', 'limited'], expected: [255, 255, 255] },
  { spec: [0, 0, 0, '709', 'limited'], expected: [0, 0, 0] },
  { spec: [255, 0, 0, '601', 'limited'], expected: [254, 0, 0] },
  { spec: [0, 255, 0, '601', 'limited'], expected: [0, 255, 1] },
  { spec: [0, 0, 255, '601', 'limited'], expected: [0, 0, 255] },
  { spec: [255, 0, 0, '2020', 'limited'], expected: [255, 1, 1] },
  { spec: [255, 0, 0, '709', 'full'], expected: [255, 0, 0] }
];
for (const test of inverseCases) {
  const spec = test.spec;
  const forward = rgb(...spec);
  const inverse = ycc(...array(forward.ycbcr), spec[3], spec[4]);
  assert.deepEqual(array(inverse.rgb), test.expected, `inverse ${spec.join(',')}`);
  assert.deepEqual(array(forward.roundTrip), test.expected, `forward round trip ${spec.join(',')}`);
}

// The UI exposes unrounded values, a hex preview and a quantized round trip.
const red = rgb(255, 0, 0);
near(red.exactYcbcr[0], 16 + 219 * 0.2126, 'red exact luma');
near(red.exactYcbcr[1], 128 - 112 * 0.2126 / (1 - 0.0722), 'red exact Cb');
near(red.exactYcbcr[2], 240, 'red exact Cr');
assert.equal(red.hex, '#ff0000');
assert.deepEqual(array(red.roundTrip), [255, 1, 0]);
const reverseRed = ycc(63, 102, 240);
assert.equal(reverseRed.hex, '#ff0100');
assert.deepEqual(array(reverseRed.rgb), [255, 1, 0]);
assert.deepEqual(array(reverseRed.roundTrip), [63, 102, 240]);

// Valid but out-of-gamut YCbCr is clipped and clearly flagged.
const clipped = ycc(16, 240, 240);
assert.equal(clipped.clipped, true);
assert.ok(array(clipped.exactRgb).some((value) => value < 0 || value > 255));
assert.ok(array(clipped.rgb).every((value) => value >= 0 && value <= 255));
assert.deepEqual(array(clipped.rgb), [201, 0, 237]);

// Inactive fields do not contaminate the selected conversion direction.
assert.deepEqual(array(C.convert({
  direction: 'rgbToYcbcr', r: 255, g: 0, b: 0, y: '', cb: 'bad', cr: -1
}).ycbcr), [63, 102, 240]);
assert.deepEqual(array(C.convert({
  direction: 'ycbcrToRgb', y: 63, cb: 102, cr: 240, r: '', g: 'bad', b: -1
}).rgb), [255, 1, 0]);

// Every 8-bit RGB corner survives a quantized round trip within two codes.
let roundTrips = 0;
for (const matrix of ['601', '709', '2020']) {
  for (const range of ['limited', 'full']) {
    for (const r of [0, 51, 128, 204, 255]) {
      for (const g of [0, 51, 128, 204, 255]) {
        for (const b of [0, 51, 128, 204, 255]) {
          const result = rgb(r, g, b, matrix, range);
          array(result.roundTrip).forEach((value, index) => {
            assert.ok(Math.abs(value - [r, g, b][index]) <= 2,
              `${matrix}/${range} round trip ${r},${g},${b}: ${array(result.roundTrip)}`);
          });
          const inverse = ycc(...array(result.ycbcr), matrix, range);
          assert.deepEqual(array(inverse.rgb), array(result.roundTrip));
          array(inverse.roundTrip).forEach((value, index) => {
            assert.ok(Math.abs(value - result.ycbcr[index]) <= 1,
              `${matrix}/${range} reverse round trip ${r},${g},${b}`);
          });
          roundTrips += 1;
        }
      }
    }
  }
}
assert.equal(roundTrips, 750);

// Independent matrix/range reference for a deterministic numerical sweep.
const coefficients = {
  '601': [0.299, 0.114], '709': [0.2126, 0.0722], '2020': [0.2627, 0.058]
};
function referenceRgb(r, g, b, matrix, range) {
  const [kr, kb] = coefficients[matrix];
  const y = (kr * r + (1 - kr - kb) * g + kb * b) / 255;
  const cb = (b / 255 - y) / (2 * (1 - kb));
  const cr = (r / 255 - y) / (2 * (1 - kr));
  return range === 'limited'
    ? [16 + 219 * y, 128 + 224 * cb, 128 + 224 * cr]
    : [255 * y, 127.5 + 255 * cb, 127.5 + 255 * cr];
}
let seed = 20261107;
const randomByte = () => {
  seed = (seed * 48271) % 2147483647;
  return seed % 256;
};
for (let i = 0; i < 300; i += 1) {
  const values = [randomByte(), randomByte(), randomByte()];
  const matrix = ['601', '709', '2020'][i % 3];
  const range = i % 2 ? 'limited' : 'full';
  const got = rgb(...values, matrix, range);
  const want = referenceRgb(...values, matrix, range);
  want.forEach((value, channel) => {
    near(got.exactYcbcr[channel], value, `sweep ${i} exact channel ${channel}`);
    const low = range === 'limited' ? 16 : 0;
    const high = range === 'limited' ? (channel === 0 ? 235 : 240) : 255;
    // Different operation ordering can put an exact x.5 tie just either side
    // of Math.round's boundary; the independent exact-value assertion above
    // still pins the formula, while this checks quantization deterministically.
    const rounded = Math.min(high, Math.max(low, Math.round(got.exactYcbcr[channel])));
    assert.equal(got.ycbcr[channel], rounded, `sweep ${i} code channel ${channel}`);
  });
}

// Strict validation of active inputs and options.
const rejects = (options, message) => assert.throws(
  () => C.convert(options), (error) => error.message === message, message
);
rejects({ direction: 'sideways' }, 'Choose a conversion direction.');
rejects({ matrix: '420' }, 'Choose BT.601, BT.709 or BT.2020.');
rejects({ range: 'auto' }, 'Choose limited or full range.');
rejects({ r: '', g: 0, b: 0 }, 'R′ red is required.');
rejects({ r: '1.5', g: 0, b: 0 }, 'R′ red must be a whole number from 0 to 255.');
rejects({ r: 256, g: 0, b: 0 }, 'R′ red must be a whole number from 0 to 255.');
rejects({ r: 0, g: -1, b: 0 }, 'G′ green must be a whole number from 0 to 255.');
rejects({ r: 0, g: 0, b: 'blue' }, 'B′ blue must be a whole number from 0 to 255.');
rejects({ direction: 'ycbcrToRgb', y: '', cb: 128, cr: 128 }, 'Y′ luma is required.');
rejects({ direction: 'ycbcrToRgb', y: 15, cb: 128, cr: 128 }, 'Y′ luma must be a whole number from 16 to 235.');
rejects({ direction: 'ycbcrToRgb', y: 16, cb: 241, cr: 128 }, 'Cb blue difference must be a whole number from 16 to 240.');
rejects({ direction: 'ycbcrToRgb', y: 16, cb: 128, cr: 15 }, 'Cr red difference must be a whole number from 16 to 240.');
rejects({ direction: 'ycbcrToRgb', range: 'full', y: 256, cb: 128, cr: 128 }, 'Y′ luma must be a whole number from 0 to 255.');
rejects({ direction: 'ycbcrToRgb', range: 'full', y: 0, cb: 127.5, cr: 128 }, 'Cb blue difference must be a whole number from 0 to 255.');

// Replay every canonical catalog test case against the same public core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'video-ycbcr-converter');
assert.equal(records.length, 1, 'catalog must contain exactly one video YCbCr record');
const record = records[0];
assert.equal(record.name, 'Video RGB to YCbCr Converter');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('YCbCr to RGB Converter'));
assert.ok(record.testCases.length >= 18, 'catalog carries representative and boundary checks');
for (const test of record.testCases) {
  if (test.kind === 'validation') {
    assert.throws(() => C.convert(test.input),
      (error) => error.message === test.expected.error, test.name);
    continue;
  }
  assert.equal(test.kind, 'golden', test.name);
  const result = C.convert(test.input);
  for (const [key, expected] of Object.entries(test.expected)) {
    if (Array.isArray(expected)) assert.deepEqual(array(result[key]), expected, `${test.name}: ${key}`);
    else assert.equal(result[key], expected, `${test.name}: ${key}`);
  }
}

console.log(`video-ycbcr-converter: all checks passed (${record.testCases.length} catalog cases, ${roundTrips} round trips, 300 reference sweeps)`);
