/* Color gamut converter: replays every catalog case, then checks the maths
   against matrices derived independently in this file and against the
   published sRGB, Display P3, Rec.2020 and BT.2087 matrices. Also covers
   refusals, determinism and the offline page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'color-gamut-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* gamut-core:start */';
const endMarker = '/* gamut-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|navigator\./.test(core), 'the core stays free of DOM and browser access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = GamutCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(entry.listed, true);
assert.equal(entry.category, 'Video');
assert.equal(entry.risk, 'low');
assert.ok(entry.sources.length >= 3, 'the standards are cited');

// ---- Independent derivation: Gaussian elimination, not the page's cofactor inverse.
const PRIMARIES = {
  rec709: { r: [0.64, 0.33], g: [0.3, 0.6], b: [0.15, 0.06], w: [0.3127, 0.329] },
  p3: { r: [0.68, 0.32], g: [0.265, 0.69], b: [0.15, 0.06], w: [0.3127, 0.329] },
  rec2020: { r: [0.708, 0.292], g: [0.17, 0.797], b: [0.131, 0.046], w: [0.3127, 0.329] }
};
const xyz = ([x, y]) => [x / y, 1, (1 - x - y) / y];
function solve3(matrix, vector) {
  const a = matrix.map((row, i) => row.concat([vector[i]]));
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      for (let k = col; k < 4; k++) a[row][k] -= factor * a[col][k];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}
function matrixOf(space) {
  const p = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let j = 0; j < 3; j++) {
    const column = xyz(space[['r', 'g', 'b'][j]]);
    for (let i = 0; i < 3; i++) p[i][j] = column[i];
  }
  const s = solve3(p, xyz(space.w));
  return p.map((row, i) => row.map((value, j) => value * s[j]));
}
const PUBLISHED = {
  rec709: [[0.41239079926595934, 0.357584339383878, 0.1804807884018343],
    [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
    [0.0193308187155918, 0.1191947797946259, 0.9505321522496607]],
  p3: [[0.4865709486482162, 0.26566769316909306, 0.19821728523436247],
    [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
    [0.0, 0.04511338185890264, 1.043944368900976]],
  rec2020: [[0.6369580483012914, 0.14461690358620832, 0.1688809751641721],
    [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
    [0.0, 0.028072693049087428, 1.060985057710791]]
};
for (const key of Object.keys(PRIMARIES)) {
  const derived = matrixOf(PRIMARIES[key]);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      assert.ok(Math.abs(derived[i][j] - PUBLISHED[key][i][j]) < 1e-12, 'independent matrix derivation');
      assert.ok(Math.abs(derived[i][j] - C.MATRICES[key][i][j]) < 1e-12, 'page matrix matches independent derivation');
    }
  }
}
// BT.2087 publishes the BT.709 to BT.2020 matrix to four decimals.
const chain = C.multiply3(C.invert3(C.MATRICES.rec2020), C.MATRICES.rec709);
const bt2087 = [[0.6274, 0.3293, 0.0433], [0.0691, 0.9195, 0.0114], [0.0164, 0.088, 0.8956]];
for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
  assert.ok(Math.abs(chain[i][j] - bt2087[i][j]) < 1e-4, 'BT.2087 published conversion matrix');
}

// ---- Catalog replay.
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
};
let gilded = 0;
for (const testCase of entry.testCases) {
  const input = testCase.input;
  let result;
  try {
    result = C.convert(input);
  } catch (error) {
    assert.equal(testCase.kind, 'validation', 'only validation cases refuse: ' + testCase.name);
    assert.equal(error.message, testCase.expected.error, testCase.name);
    continue;
  }
  assert.notEqual(testCase.kind, 'validation', 'validation case did not refuse: ' + testCase.name);
  const expected = testCase.expected;
  for (let i = 0; i < 3; i++) {
    assert.equal(result.code8[i], expected.codes8[i], testCase.name + ' 8-bit code ' + i);
    assert.equal(result.code10[i], expected.codes10[i], testCase.name + ' 10-bit code ' + i);
    close(result.percent[i], expected.percent[i], 1e-3, testCase.name + ' percent ' + i);
    close(result.linearTarget[i], expected.linear[i], 1e-8, testCase.name + ' linear ' + i);
  }
  assert.equal(result.inside, expected.inside, testCase.name + ' gamut verdict');
  assert.deepEqual(Array.from(result.clipped, (channel) => channel.channel), expected.clippedChannels, testCase.name + ' clipped channels');
  if (expected.xy === null) {
    assert.equal(result.xy, null, testCase.name + ' chromaticity undefined');
  } else {
    close(result.xy[0], expected.xy[0], 1e-6, testCase.name + ' x');
    close(result.xy[1], expected.xy[1], 1e-6, testCase.name + ' y');
  }
  close(result.luminance, expected.luminance, 1e-8, testCase.name + ' luminance');
  if (!expected.inside) {
    for (const channel of result.clipped) {
      const expectedDeviation = (expected.percent[['r', 'g', 'b'].indexOf(channel.channel)] - Math.max(0, Math.min(100, expected.percent[['r', 'g', 'b'].indexOf(channel.channel)])));
      close(channel.deviationPercent, expectedDeviation, 1e-3, testCase.name + ' deviation');
    }
  } else {
    gilded++;
  }
}
assert.ok(gilded >= 8, 'most goldens are in gamut');

// ---- Independent colour checks.
const red709 = C.convert({ source: 'rec709', target: 'rec2020', curve: 'srgb', units: 'code8', r: '255', g: '0', b: '0' });
for (let i = 0; i < 3; i++) close(red709.linearTarget[i], bt2087[i][0], 1e-4, 'BT.2087 red column');
const white = C.convert({ source: 'p3', target: 'rec709', curve: 'srgb', units: 'percent', r: '100', g: '100', b: '100' });
for (let i = 0; i < 3; i++) close(white.linearTarget[i], 1, 1e-9, 'white stays white');
close(white.luminance, 1, 1e-9, 'white luminance');
close(white.xy[0], 0.3127, 1e-9, 'D65 x');
close(white.xy[1], 0.329, 1e-9, 'D65 y');
const grey = C.convert({ source: 'rec2020', target: 'rec709', curve: 'bt1886', units: 'code8', r: '77', g: '77', b: '77' });
assert.ok(Math.abs(grey.linearTarget[0] - grey.linearTarget[1]) < 1e-12 && Math.abs(grey.linearTarget[1] - grey.linearTarget[2]) < 1e-12, 'neighbours stay neutral');
// A wide-gamut primary outside the target: the red channel exceeds 1 and green falls below 0.
const outside = C.convert({ source: 'rec2020', target: 'rec709', curve: 'bt709', units: 'code10', r: '940', g: '64', b: '64' });
assert.equal(outside.inside, false);
assert.ok(outside.encodedTarget[0] > 1 && outside.encodedTarget[1] < 0);
assert.equal(outside.code8[0], 255, 'clipped code is the stored value');
assert.equal(outside.code8[1], 0);
close(outside.clipped[0].deviationPercent, (outside.encodedTarget[0] - 1) * 100, 1e-9, 'deviation is unclipped minus edge');
// Round-trip inside the target gamut stays within two codes of the original.
for (const pair of [['rec709', 'p3'], ['p3', 'rec2020'], ['rec2020', 'p3'], ['p3', 'rec709']]) {
  for (const rgb of [[17, 83, 211], [250, 12, 140], [3, 3, 3], [254, 254, 254]]) {
    const there = C.convert({ source: pair[0], target: pair[1], curve: 'srgb', units: 'code8', r: String(rgb[0]), g: String(rgb[1]), b: String(rgb[2]) });
    if (!there.inside) continue;
    const back = C.convert({ source: pair[1], target: pair[0], curve: 'srgb', units: 'code8', r: String(there.code8[0]), g: String(there.code8[1]), b: String(there.code8[2]) });
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(back.code8[i] - rgb[i]) <= 2, 'round trip within two codes');
  }
}
// Every curve decodes and re-encodes a mid code without drift.
for (const curve of ['srgb', 'bt709', 'bt1886', 'linear']) {
  const result = C.convert({ source: 'rec709', target: 'rec709', curve, units: 'code8', r: '128', g: '128', b: '128' });
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(result.linearTarget[i] - result.linearSource[i]) < 1e-12, 'same gamut is identity for ' + curve);
  assert.equal(result.code8[0], 128, 'same gamut keeps the code for ' + curve);
}
// Determinism.
const first = C.convert({ source: 'rec709', target: 'p3', curve: 'srgb', units: 'code8', r: '1', g: '2', b: '3' });
const second = C.convert({ source: 'rec709', target: 'p3', curve: 'srgb', units: 'code8', r: '1', g: '2', b: '3' });
assert.deepEqual(first, second, 'conversion is deterministic');

// ---- Refusals not already in the catalog.
assert.throws(() => C.convert({ source: 'rec709', target: 'p3', curve: 'srgb', units: 'code8', r: '0', g: '', b: '0' }), /green value/);
assert.throws(() => C.convert({ source: 'rec709', target: 'p3', curve: 'srgb', units: 'percent', r: '0', g: '0', b: '-0.1' }), /0 to 100/);
assert.throws(() => C.convert({ source: 'rec709', target: 'p3', curve: 'srgb', units: 'code10', r: '1.5', g: '0', b: '0' }), /whole number from 0 to 1023/);
assert.throws(() => C.convert({ source: 'rec709', target: 'nope', curve: 'srgb', units: 'code8', r: '0', g: '0', b: '0' }), /target gamut/);
assert.throws(() => C.convert({ source: 'rec709', target: 'p3', curve: 'srgb', units: 'code8', r: 'Infinity', g: '0', b: '0' }), /decimal number/);
assert.throws(() => C.convert({}), /source gamut/);

// ---- Offline and accessible page contract.
assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/.test(html), 'no network calls');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'no remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote stylesheets');
for (const id of ['source', 'target', 'curve', 'units', 'r', 'g', 'b']) {
  assert.ok(html.includes(`for="${id}"`) && html.includes(`id="${id}"`), 'labelled control ' + id);
}
assert.ok(/aria-live="polite"/.test(html), 'live results region');
assert.ok(/setAttribute\("role", "status"\)/.test(html), 'copy status is announced');
assert.ok(/<form id="gamut-form"/.test(html), 'form is present');
assert.ok(/novalidate/.test(html), 'validation is handled by the page');
console.log('color gamut converter: all checks passed');
