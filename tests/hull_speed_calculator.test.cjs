/* Regression checks for the hull-speed core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/hull-speed-calculator/index.html'), 'utf8');
const start = html.indexOf('/* hull-speed-core:start */');
const end = html.indexOf('/* hull-speed-core:end */');
assert.ok(start > -1 && end > start, 'hull speed core markers missing');
const core = html.slice(start, end + '/* hull-speed-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = HullSpeedCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const plan = (input) => C.plan(input);
const base = { length: '10', lengthUnit: 'm', speed: '7', speedUnit: 'kn' };
const at = (speed, speedUnit = 'kn') => plan({ ...base, speed, speedUnit });

// A ten-metre waterline is 32.81 ft, so the estimate is 1.34 sqrt(32.81) = 7.675 kn.
const standard = plan(base);
near(standard.lengthFt, 32.808398950131, 'waterline in feet');
near(standard.hullKnots, 7.675334595629, 'hull speed in knots');
near(standard.hullKmh, 14.214719671104, 'hull speed in km/h');
near(standard.hullMph, 8.832617309354, 'hull speed in mph');
near(standard.ratio, 0.912012357609, 'planned speed share');
near(standard.sharePercent, 91.201235760935, 'planned speed percentage');
near(standard.speedLengthRatio, 1.222096559197, 'speed-length ratio');
near(standard.froude, 0.363643796988, 'Froude number');
assert.equal(standard.regime, 'displacement');
assert.equal(standard.regimeLabel, 'Displacement speed');
assert.equal(standard.exceed, false);

// The hull-speed estimate is exactly 1.34 sqrt(LWL ft) and keeps a speed-length ratio of 1.34.
near(standard.hullKnots, C.HULL_COEFF * Math.sqrt(standard.lengthFt), 'hull speed formula');
near(standard.hullSpeedLengthRatio, 1.34, 'hull speed-length ratio');
// The implied Froude number at hull speed is about 0.40 for every waterline length.
near(standard.hullFroude, 0.398726830787, 'Froude number at hull speed');
for (const length of ['6', '12', '18', '100']) {
  near(plan({ ...base, length }).hullFroude, standard.hullFroude, 'hull Froude is length independent');
}

// Hull speed scales with the square root of waterline length.
const doubled = plan({ ...base, length: '20' });
near(doubled.hullKnots / standard.hullKnots, Math.SQRT2, 'hull speed scales with sqrt(LWL)');
const shorter = plan({ ...base, length: '2.5' });
near(shorter.hullKnots / standard.hullKnots, 0.5, 'quarter length halves hull speed');

// Unit equivalence: feet, km/h and mph describe the same physical case.
near(plan({ ...base, length: '32.808398950131', lengthUnit: 'ft' }).hullKnots, standard.hullKnots, 'feet entry');
near(at('14.2144', 'kmh').speedKnots, 7.675161987041, 'km/h entry knots');
near(at('14.2144', 'kmh').ratio, 0.999977511262, 'km/h entry share');
near(at('8.0559', 'mph').speedKnots, 7.000385707127, 'mph entry knots');
assert.throws(() => plan({ ...base, length: '1000', lengthUnit: 'cm' }), /Choose a valid waterline length unit\./);

// Regime boundaries are exclusive at 95, 105 and 160 percent of the estimate.
const share = (speed) => at(speed).ratio;
assert.ok(share('7.2915') < 0.95 && share('7.2916') > 0.95, '95 percent boundary brackets');
assert.equal(at('7.2915').regime, 'displacement');
assert.equal(at('7.2916').regime, 'hull');
assert.ok(share('8.0591') < 1.05 && share('8.0592') > 1.05, '105 percent boundary brackets');
assert.equal(at('8.0591').regime, 'hull');
assert.equal(at('8.0592').regime, 'above');
assert.ok(share('12.2805') < 1.6 && share('12.2806') > 1.6, '160 percent boundary brackets');
assert.equal(at('12.2805').regime, 'above');
assert.equal(at('12.2806').regime, 'planing');
for (const label of ['displacement', 'hull', 'above', 'planing']) assert.ok(C.REGIMES[label], 'regime label ' + label);

// The warning flag follows the 105 percent threshold.
assert.equal(at('8.0591').exceed, false);
assert.equal(at('8.0592').exceed, true);

// A stationary boat is valid and reports zero speed with displacement classification.
const stopped = at('0');
assert.equal(stopped.speedKnots, 0);
assert.equal(stopped.ratio, 0);
assert.equal(stopped.froude, 0);
assert.equal(stopped.regime, 'displacement');

// The reference table has eight ascending waterline lengths for the documented span.
assert.equal(standard.chart.length, 8);
assert.equal(standard.chart[0].metres, 6);
near(standard.chart[0].knots, 5.945288613088, 'chart 6 m');
near(standard.chart[1].knots, 6.64703474236, 'chart 7.5 m');
near(standard.chart[7].knots, 10.297541943529, 'chart 18 m');
for (let i = 1; i < standard.chart.length; i += 1) {
  assert.ok(standard.chart[i].metres > standard.chart[i - 1].metres, 'chart is ascending');
  near(standard.chart[i].knots / standard.chart[i - 1].knots,
    Math.sqrt(standard.chart[i].metres / standard.chart[i - 1].metres), 'chart scales with sqrt(length)');
}

// Parsing: required, unsigned decimal only, and bounded.
const rejects = (input, pattern) => assert.throws(() => plan({ ...base, ...input }), pattern);
rejects({ length: '' }, /Waterline length is required\./);
rejects({ length: '  ' }, /Waterline length is required\./);
rejects({ length: '-1' }, /Waterline length must be a number\./);
rejects({ length: '+1' }, /Waterline length must be a number\./);
rejects({ length: '1e1' }, /Waterline length must be a number\./);
rejects({ length: '1.2.3' }, /Waterline length must be a number\./);
rejects({ length: '0.5' }, /Waterline length must be from 1 to 100 m\./);
rejects({ length: '101' }, /Waterline length must be from 1 to 100 m\./);
rejects({ lengthUnit: 'yd' }, /Choose a valid waterline length unit\./);
rejects({ speed: '' }, /Planned speed is required\./);
rejects({ speed: '101' }, /Planned speed must be from 0 to 100 kn\./);
rejects({ speed: '150', speedUnit: 'mph' }, /Planned speed must be from 0 to 100 kn\./);
rejects({ speedUnit: 'fps' }, /Choose a valid planned speed unit\./);

// Missing options object is rejected rather than crashing.
assert.throws(() => C.plan(), /Waterline length is required\./);

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'hull-speed-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Sports & Outdoors');
assert.ok(record.testCases.length >= 20, 'catalog has the full test case set');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(
      () => plan(testCase.input),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = plan(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') near(result[key], value, testCase.name + ' ' + key);
    else assert.equal(result[key], value, testCase.name + ' ' + key);
  }
}

console.log('hull-speed-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
