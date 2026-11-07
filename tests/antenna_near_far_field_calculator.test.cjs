/* Regression checks for the antenna near/far-field core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/antenna-near-far-field-calculator/index.html'), 'utf8');
const start = html.indexOf('/* antenna-field-core:start */');
const end = html.indexOf('/* antenna-field-core:end */');
assert.ok(start > -1 && end > start, 'antenna field core markers missing');
const core = html.slice(start, end + '/* antenna-field-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = AntennaFieldCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const plan = (input) => C.plan(input);
const base = {
  dimension: '1', dimUnit: 'm',
  frequency: '2.4', freqUnit: 'GHz',
  distance: '10', distanceUnit: 'm'
};
const at = (distance) => plan({ ...base, distance });

// One metre aperture at 2.4 GHz: lambda 12.49 cm, Fraunhofer distance 16.0 m.
const standard = plan(base);
near(standard.wavelength, 0.124913524167, 'wavelength');
near(standard.reactive, 1.754231716923, 'reactive boundary');
near(standard.fraunhofer, 16.011076569511, 'Fraunhofer distance');
near(standard.ratio, 8.005538284756, 'dimension in wavelengths');
near(standard.distanceWavelengths, 80.055382847556, 'distance in wavelengths');
assert.equal(standard.region, 'fresnel');
assert.equal(standard.regionLabel, 'Radiating near field (Fresnel)');
assert.equal(standard.shortDimension, false);

// The Fraunhofer distance is exactly 2D^2/lambda, and the Fresnel edge is 0.62*sqrt(D^3/lambda).
near(standard.fraunhofer, 2 * 1 * 1 / standard.wavelength, 'Fraunhofer formula');
near(standard.reactive, 0.62 * Math.sqrt(1 / standard.wavelength), 'Fresnel formula');

// Region classification is exclusive at each boundary.
assert.equal(at('0').region, 'reactive');
assert.equal(at('1.7').region, 'reactive');
assert.equal(at('1.8').region, 'fresnel');
assert.equal(at('16').region, 'fresnel');
assert.equal(at('17').region, 'far');
assert.equal(at('1000').region, 'far');
for (const label of ['reactive', 'fresnel', 'far']) assert.ok(C.REGIONS[label], 'region label ' + label);

// Boundary cases just either side of the 0.62*sqrt(D^3/lambda) edge.
assert.equal(at('1.7542').region, 'reactive');
assert.equal(at('1.7543').region, 'fresnel');

// Scaling: doubling D quadruples the Fraunhofer distance and multiplies the Fresnel edge by sqrt(8).
const doubled = plan({ ...base, dimension: '2' });
near(doubled.fraunhofer / standard.fraunhofer, 4, 'Fraunhofer scales with D^2');
near(doubled.reactive / standard.reactive, Math.sqrt(8), 'Fresnel edge scales with D^1.5');

// Scaling: doubling frequency doubles the Fraunhofer distance and the Fresnel edge by sqrt(2).
const faster = plan({ ...base, frequency: '4.8' });
near(faster.fraunhofer / standard.fraunhofer, 2, 'Fraunhofer scales with frequency');
near(faster.reactive / standard.reactive, Math.sqrt(2), 'Fresnel edge scales with sqrt(frequency)');
near(faster.wavelength * 2, standard.wavelength, 'wavelength halves');

// Unit equivalence across mm, cm and m, and MHz versus GHz.
near(plan({ ...base, dimension: '100', dimUnit: 'cm' }).fraunhofer, standard.fraunhofer, 'cm dimension');
near(plan({ ...base, dimension: '1000', dimUnit: 'mm' }).fraunhofer, standard.fraunhofer, 'mm dimension');
near(plan({ ...base, frequency: '2400', freqUnit: 'MHz' }).fraunhofer, standard.fraunhofer, 'MHz frequency');
near(plan({ ...base, distance: '0.01', distanceUnit: 'km' }).distance, 10, 'km distance');

// A dimension below one wavelength is flagged, and the 2 m / 100 MHz case still classifies.
const small = plan({ dimension: '2', dimUnit: 'm', frequency: '100', freqUnit: 'MHz', distance: '2', distanceUnit: 'm' });
near(small.wavelength, 2.99792458, '100 MHz wavelength');
near(small.fraunhofer, 2.668512761585, '2 m aperture far field');
near(small.reactive, 1.012806153987, '2 m aperture Fresnel edge');
assert.equal(small.shortDimension, true);
assert.equal(small.region, 'fresnel');
const patch = plan({ dimension: '5', dimUnit: 'cm', frequency: '24', freqUnit: 'GHz', distance: '0.5', distanceUnit: 'm' });
near(patch.fraunhofer, 0.400276914238, '5 cm patch far field');
near(patch.distanceWavelengths, 40.027691423778, '5 cm patch distance');
assert.equal(patch.region, 'far');
assert.equal(patch.shortDimension, false);

// The reference table has eight ascending frequencies for the entered aperture.
assert.equal(standard.chart.length, 8);
assert.equal(standard.chart[0].label, '100 MHz');
assert.equal(standard.chart[7].label, '24 GHz');
near(standard.chart[0].fraunhofer, 0.667128190396, 'chart 100 MHz');
near(standard.chart[5].fraunhofer, 38.693435042986, 'chart 5.8 GHz');
near(standard.chart[7].fraunhofer, 160.110765695113, 'chart 24 GHz');
for (let i = 1; i < standard.chart.length; i += 1) {
  assert.ok(standard.chart[i].hz > standard.chart[i - 1].hz, 'chart is ascending');
  near(standard.chart[i].fraunhofer / standard.chart[i - 1].fraunhofer,
    standard.chart[i].hz / standard.chart[i - 1].hz, 'chart scales with frequency');
}

// Parsing: required, unsigned decimal only, and bounded.
const rejects = (input, pattern) => assert.throws(() => plan({ ...base, ...input }), pattern);
rejects({ dimension: '' }, /Antenna dimension is required\./);
rejects({ dimension: '  ' }, /Antenna dimension is required\./);
rejects({ dimension: '-1' }, /Antenna dimension must be a number\./);
rejects({ dimension: '+1' }, /Antenna dimension must be a number\./);
rejects({ dimension: '1e2' }, /Antenna dimension must be a number\./);
rejects({ dimension: '1.2.3' }, /Antenna dimension must be a number\./);
rejects({ dimension: '0' }, /Antenna dimension must be from 0\.001 to 1000 m\./);
rejects({ dimension: '1001' }, /Antenna dimension must be from 0\.001 to 1000 m\./);
rejects({ dimUnit: 'ft' }, /Choose a valid antenna dimension unit\./);
rejects({ frequency: '' }, /Frequency is required\./);
rejects({ frequency: '0' }, /Frequency must be from 1 MHz to 300 GHz\./);
rejects({ frequency: '301', freqUnit: 'GHz' }, /Frequency must be from 1 MHz to 300 GHz\./);
rejects({ freqUnit: 'kHz' }, /Choose a valid frequency unit\./);
rejects({ distance: '' }, /Measurement distance is required\./);
rejects({ distance: '-5' }, /Measurement distance must be a number\./);
rejects({ distance: '1000001' }, /Measurement distance must be from 0 to 1000000 m\./);
rejects({ distanceUnit: 'ft' }, /Choose a valid measurement distance unit\./);

// Missing options object is rejected rather than crashing.
assert.throws(() => C.plan(), /Antenna dimension is required\./);

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'antenna-near-far-field-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Communications Engineering');
assert.ok(record.testCases.length >= 14, 'catalog has the full test case set');
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
    if (key === 'chartRows') assert.equal(result.chart.length, value, testCase.name);
    else if (key === 'chartFirstLabel') assert.equal(result.chart[0].label, value, testCase.name);
    else if (key === 'chartFirstFraunhofer') near(result.chart[0].fraunhofer, value, testCase.name);
    else if (key === 'chartLastLabel') assert.equal(result.chart[result.chart.length - 1].label, value, testCase.name);
    else if (key === 'chartLastFraunhofer') near(result.chart[result.chart.length - 1].fraunhofer, value, testCase.name);
    else if (typeof value === 'number') near(result[key], value, testCase.name + ' ' + key);
    else assert.equal(result[key], value, testCase.name + ' ' + key);
  }
}

console.log('antenna-near-far-field-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
