/* Regression checks for the phased array beam pattern core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/phased-array-beam-pattern-calculator/index.html'), 'utf8');
const start = html.indexOf('/* phased-array-core:start */');
const end = html.indexOf('/* phased-array-core:end */');
assert.ok(start > -1 && end > start, 'phased array core markers missing');
const core = html.slice(start, end + '/* phased-array-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PhasedArrayCore;', sandbox);
const C = sandbox.module.exports;
const run = (input) => C.calculate(input);
const DEG = Math.PI / 180;

// Independent reference: sum the element phasors instead of using the closed form.
function elementSum(thetaDeg, n, d, steer) {
  const k = 2 * Math.PI * d;
  const q = Math.sin(thetaDeg * DEG) - Math.sin(steer * DEG);
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i += 1) {
    re += Math.cos(k * q * i);
    im += Math.sin(k * q * i);
  }
  return Math.hypot(re, im) / n;
}
function elementSumDb(theta, n, d, steer) {
  return 20 * Math.log10(Math.max(elementSum(theta, n, d, steer), 1e-9));
}
function referenceHpbw(n, d, steer) {
  let below = null;
  let above = null;
  for (let a = steer; a >= -90; a -= 0.005) {
    if (elementSumDb(a, n, d, steer) <= -3) { below = a; break; }
  }
  for (let a = steer; a <= 90; a += 0.005) {
    if (elementSumDb(a, n, d, steer) <= -3) { above = a; break; }
  }
  if (below === null || above === null) return null;
  return above - below;
}
function referenceSidelobe(n, d, steer) {
  const base = Math.sin(steer * DEG);
  const nulls = [];
  for (let m = 1; m <= 3; m += 1) {
    for (const sign of [1, -1]) {
      const sine = base + sign * m / (n * d);
      if (sine >= -1 && sine <= 1) nulls.push(Math.asin(sine) / DEG);
    }
  }
  nulls.push(steer);
  nulls.sort((a, b) => a - b);
  const index = nulls.indexOf(steer);
  let peak = -Infinity;
  for (const side of [-1, 1]) {
    const near = side === 1 ? nulls[index + 1] : nulls[index - 1];
    const far = side === 1 ? nulls[index + 2] : nulls[index - 2];
    if (near === undefined || far === undefined) continue;
    const from = Math.min(near, far);
    const to = Math.max(near, far);
    for (let a = from; a <= to; a += 0.002) {
      const value = elementSumDb(a, n, d, steer);
      if (value > peak) peak = value;
    }
  }
  return peak === -Infinity ? null : peak;
}

// Defaults: 8 elements, half-wave spacing, broadside.
assert.deepEqual(JSON.parse(JSON.stringify(run({}))), {
  elements: 8,
  spacing: 0.5,
  steer: 0,
  peakGainDb: 9.03,
  apertureLambda: 3.5,
  hpbwDeg: 12.78,
  sidelobeDb: -12.8,
  sidelobeAngleDeg: -21.07,
  nullLowerDeg: -14.48,
  nullUpperDeg: 14.48,
  nullToNullDeg: 28.96,
  gratingLobe: false,
  gratingLobes: [],
  nearestGratingDeg: null,
  beamClipped: false,
});

// Inputs are trimmed and numeric strings are accepted.
assert.equal(run({ elements: ' 16 ', spacing: ' 0.5 ', steer: ' 30 ' }).hpbwDeg, 7.34);
assert.equal(run({ elements: '2', spacing: '.5', steer: '-20' }).elements, 2);

// The pattern peaks at the steering angle and the reported nulls are deep.
for (const [n, d, steer] of [[8, 0.5, 0], [16, 0.5, 30], [10, 0.7, -20], [32, 0.5, 45], [5, 0.95, 85]]) {
  const label = `${n}@${d} steer ${steer}`;
  assert.ok(Math.abs(C.patternDb(steer, n, d, steer)) < 1e-9, label + ' peak is 0 dB');
  const result = run({ elements: n, spacing: d, steer });
  assert.equal(result.elements, n, label);
  assert.equal(result.steer, steer, label);
  for (const nullAngle of [result.nullLowerDeg, result.nullUpperDeg]) {
    if (nullAngle === null) continue;
    assert.ok(C.patternDb(nullAngle, n, d, steer) < -40, label + ' null at ' + nullAngle + ' is deep');
    assert.ok(nullAngle >= -90 && nullAngle <= 90, label + ' null is in range');
  }
  // Peak gain over one element is exactly 10 log10 N.
  assert.equal(result.peakGainDb, Math.round(10 * Math.log10(n) * 100) / 100, label + ' gain');
  // Nulls follow sin(theta) = sin(theta0) +- 1/(N d).
  const base = Math.sin(steer * DEG);
  const offset = 1 / (n * d);
  if (base - offset >= -1) assert.ok(Math.abs(result.nullLowerDeg - Math.asin(base - offset) / DEG) < 0.01, label + ' lower null');
  else assert.equal(result.nullLowerDeg, null, label + ' lower null missing');
  if (base + offset <= 1) assert.ok(Math.abs(result.nullUpperDeg - Math.asin(base + offset) / DEG) < 0.01, label + ' upper null');
  else assert.equal(result.nullUpperDeg, null, label + ' upper null missing');
  // The beamwidth matches the element-by-element pattern.
  const reference = referenceHpbw(n, d, steer);
  if (reference === null) assert.equal(result.hpbwDeg, null, label + ' clipped beam');
  else assert.ok(Math.abs(result.hpbwDeg - reference) < 0.06, label + ' hpbw ' + result.hpbwDeg + ' vs ' + reference.toFixed(2));
  // The first sidelobe matches the highest point between the first two nulls.
  const sidelobe = referenceSidelobe(n, d, steer);
  if (result.sidelobeDb === null) {
    assert.ok(d < 0.75 || sidelobe === null || sidelobe > -1, label + ' sidelobe suppressed');
  } else {
    assert.ok(Math.abs(result.sidelobeDb - sidelobe) < 0.06, label + ' sidelobe ' + result.sidelobeDb + ' vs ' + sidelobe.toFixed(2));
    assert.ok(result.sidelobeDb < -3 && result.sidelobeDb > -20, label + ' sidelobe level is plausible');
  }
}

// Grating lobes are exactly the integers m that land inside visible space.
for (const [n, d, steer] of [[8, 0.5, 0], [8, 1.2, 0], [12, 1, 40], [3, 2, 0], [5, 0.95, 85], [4, 5, -45], [16, 0.5, 60]]) {
  const label = `${n}@${d} steer ${steer}`;
  const expected = [];
  const base = Math.sin(steer * DEG);
  for (let m = -Math.ceil(3 * d) - 1; m <= Math.ceil(3 * d) + 1; m += 1) {
    if (m === 0) continue;
    const sine = base + m / d;
    if (sine >= -1 && sine <= 1) {
      const angle = Math.round(Math.asin(sine) / DEG * 100) / 100;
      if (!expected.includes(angle)) expected.push(angle);
    }
  }
  expected.sort((a, b) => a - b);
  const result = run({ elements: n, spacing: d, steer });
  assert.deepEqual(JSON.parse(JSON.stringify(result.gratingLobes)), expected, label + ' grating lobes');
  assert.equal(result.gratingLobe, expected.length > 0, label + ' grating flag');
  // A spacing within the classic limit must not produce a grating lobe.
  if (d <= 1 / (1 + Math.abs(base)) - 1e-9) assert.equal(result.gratingLobe, false, label + ' spacing is legal');
}

// A broadside half-wave array is the textbook case: the first sidelobe approaches -13 dB.
for (const n of [8, 16, 32, 64]) {
  const result = run({ elements: n, spacing: 0.5, steer: 0 });
  assert.ok(result.sidelobeDb > -13.5 && result.sidelobeDb < -12.5, 'sidelobe near -13 dB for N=' + n);
  assert.ok(Math.abs(result.nullToNullDeg - 2 * result.nullUpperDeg) < 0.02, 'null-to-null is symmetric broadside');
}

// Two elements at half-wave spacing have no visible sidelobe; the beam is 60 degrees wide.
const pair = run({ elements: 2, spacing: 0.5, steer: 0 });
assert.equal(pair.hpbwDeg, 59.9);
assert.equal(pair.sidelobeDb, null);
assert.equal(pair.sidelobeAngleDeg, null);

// A very wide array at the minimum spacing keeps the beam inside visible space.
const tight = run({ elements: 64, spacing: 0.05, steer: 0 });
assert.ok(tight.hpbwDeg > 15 && tight.hpbwDeg < 17);
assert.equal(tight.gratingLobe, false);

// Steering to endfire clips the beam instead of inventing a width.
const clipped = run({ elements: 8, spacing: 0.5, steer: 90 });
assert.equal(clipped.hpbwDeg, null);
assert.equal(clipped.beamClipped, true);
assert.equal(clipped.nullUpperDeg, null);

// Every input is validated with a message naming the field.
assert.throws(() => run({ elements: 1 }), /Elements must be a whole number from 2 to 64\./);
assert.throws(() => run({ elements: 65 }), /Elements must be a whole number from 2 to 64\./);
assert.throws(() => run({ elements: '8.5' }), /Elements must be a whole number from 2 to 64\./);
assert.throws(() => run({ elements: 'eight' }), /Elements must be a whole number from 2 to 64\./);
assert.throws(() => run({ elements: '' }), /Elements is required\./);
assert.throws(() => run({ spacing: 0 }), /Element spacing must be a number from 0\.05 to 5 wavelengths\./);
assert.throws(() => run({ spacing: '5.01' }), /Element spacing must be a number from 0\.05 to 5 wavelengths\./);
assert.throws(() => run({ spacing: 'half' }), /Element spacing must be a number from 0\.05 to 5 wavelengths\./);
assert.throws(() => run({ spacing: '' }), /Element spacing is required\./);
assert.throws(() => run({ steer: 91 }), /Steering angle must be a number from -90 to 90 degrees\./);
assert.throws(() => run({ steer: -90.5 }), /Steering angle must be a number from -90 to 90 degrees\./);
assert.throws(() => run({ steer: 'up' }), /Steering angle must be a number from -90 to 90 degrees\./);
assert.throws(() => run({ steer: '' }), /Steering angle is required\./);

// The page must not reach the network, store data or use inline handlers.
const withoutNamespaces = html
  .replace(/https:\/\/virt\.tools[^"]*/g, '')
  .replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
assert.ok(!/https?:\/\//.test(withoutNamespaces), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'phased-array-beam-pattern-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 20, 'catalog has the full test case set');
assert.ok(record.method.includes('browser'), 'method documents local execution');
for (const testCase of record.testCases) {
  const options = { ...C.DEFAULTS, ...testCase.input };
  if (testCase.kind === 'validation') {
    assert.throws(
      () => C.calculate(options),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = C.calculate(options);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(JSON.parse(JSON.stringify(result[key])), value, testCase.name + ' ' + key);
  }
}

console.log('phased array core: all checks passed');
