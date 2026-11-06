/* Regression checks for the receiver sensitivity core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/receiver-sensitivity-calculator/index.html'), 'utf8');
const start = html.indexOf('/* receiver-sensitivity-core:start */');
const end = html.indexOf('/* receiver-sensitivity-core:end */');
assert.ok(start > -1 && end > start, 'receiver sensitivity core markers missing');
const core = html.slice(start, end + '/* receiver-sensitivity-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ReceiverSensitivityCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const plan = (input) => C.plan(input);
const base = { nf: '4', bandwidth: '12.5', unit: 'kHz', snr: '10', temperature: '290' };

// -174 dBm/Hz reference: 12.5 kHz, 4 dB NF and 10 dB SNR is about -119 dBm.
const standard = plan(base);
near(standard.sensitivity, -119.006087, 'standard sensitivity');
near(standard.noiseFloor, -129.006087, 'standard noise floor');
near(standard.thermalDensity, -173.975187, 'thermal density at 290 K');
assert.equal(standard.bandwidthHz, 12500);
assert.equal(standard.bandwidthLabel, '12.5 kHz');
// 0.25 uV across 50 ohm at -119 dBm.
near(standard.microvolts, 0.250715, 'equivalent voltage');
near(standard.microvolts * 1e-6 * standard.microvolts * 1e-6 / 50, standard.powerW, 'power from voltage', 1e-6);

// Sensitivity is the noise floor plus the required SNR, exactly.
near(standard.sensitivity - standard.noiseFloor, 10, 'SNR offset');

// Each 10x of bandwidth adds 10 dB; doubling adds 3.0103 dB.
const decade = plan({ ...base, bandwidth: '125', unit: 'kHz' });
near(decade.sensitivity - standard.sensitivity, 10, 'decade bandwidth');
const doubled = plan({ ...base, bandwidth: '25' });
near(doubled.sensitivity - standard.sensitivity, 10 * Math.log10(2), 'doubled bandwidth');

// Noise figure and required SNR shift the result one-for-one.
const noisier = plan({ ...base, nf: '7' });
near(noisier.sensitivity - standard.sensitivity, 3, 'noise figure shift');
const pickier = plan({ ...base, snr: '13' });
near(pickier.sensitivity - standard.sensitivity, 3, 'SNR shift');

// A negative required SNR is allowed and lowers the sensitivity.
const spread = plan({ ...base, snr: '-5' });
near(spread.sensitivity - standard.sensitivity, -15, 'negative SNR shift');

// Temperature scales the noise floor: 580 K is exactly 3.0103 dB above 290 K.
const hot = plan({ ...base, temperature: '580' });
near(hot.thermalDensity - standard.thermalDensity, 10 * Math.log10(2), 'temperature density');
near(hot.sensitivity - standard.sensitivity, 10 * Math.log10(2), 'temperature sensitivity');

// Zero noise figure and zero SNR make the sensitivity equal the noise floor.
const ideal = plan({ nf: '0', bandwidth: '1', unit: 'kHz', snr: '0', temperature: '290' });
near(ideal.sensitivity, -143.975187, 'ideal sensitivity');
assert.equal(ideal.sensitivity, ideal.noiseFloor);

// The reference table has six ascending rows and includes the entered bandwidth.
assert.equal(standard.chart.length, 6);
assert.equal(standard.chart[0].label, '3 kHz');
assert.equal(standard.chart[5].label, '20 MHz');
near(standard.chart[0].sensitivity, -125.203975, 'chart 3 kHz');
near(standard.chart[5].sensitivity, -86.964887, 'chart 20 MHz');
for (let i = 1; i < standard.chart.length; i += 1) {
  assert.ok(standard.chart[i].hz > standard.chart[i - 1].hz, 'chart is ascending');
  near(standard.chart[i].sensitivity - standard.chart[i - 1].sensitivity,
    10 * Math.log10(standard.chart[i].hz / standard.chart[i - 1].hz), 'chart spacing');
}

// Bandwidth units convert exactly.
near(plan({ ...base, bandwidth: '12500', unit: 'Hz' }).sensitivity, standard.sensitivity, 'Hz unit');
near(plan({ ...base, bandwidth: '0.0125', unit: 'MHz' }).sensitivity, standard.sensitivity, 'MHz unit');

// Parsing: required, unsigned, no exponent or sign, in range.
const rejects = (input, pattern) => assert.throws(() => plan({ ...base, ...input }), pattern);
rejects({ nf: '' }, /Noise figure is required\./);
rejects({ nf: '  ' }, /Noise figure is required\./);
rejects({ nf: '-1' }, /Noise figure must be a number\./);
rejects({ nf: '+4' }, /Noise figure must be a number\./);
rejects({ nf: '1e1' }, /Noise figure must be a number\./);
rejects({ nf: '4.5.1' }, /Noise figure must be a number\./);
rejects({ nf: '101' }, /Noise figure must be from 0 to 100 dB\./);
rejects({ bandwidth: '' }, /Bandwidth is required\./);
rejects({ bandwidth: '0' }, /Bandwidth must be greater than zero\./);
rejects({ bandwidth: '-5' }, /Bandwidth must be a number\./);
rejects({ bandwidth: '1e3', unit: 'Hz' }, /Bandwidth must be a number\./);
rejects({ bandwidth: '2000000', unit: 'MHz' }, /Bandwidth must be at most 1 THz\./);
rejects({ unit: 'GHz' }, /Choose a bandwidth unit\./);
rejects({ snr: '' }, /Required SNR is required\./);
rejects({ snr: '-101' }, /Required SNR must be from -100 to 100 dB\./);
rejects({ snr: '101' }, /Required SNR must be from -100 to 100 dB\./);
rejects({ temperature: '0' }, /Noise temperature must be from 1 to 10000 K\./);
rejects({ temperature: '10001' }, /Noise temperature must be from 1 to 10000 K\./);

// Missing options object is rejected rather than crashing.
assert.throws(() => C.plan(), /Noise figure is required\./);

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'receiver-sensitivity-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Communications Engineering');
assert.ok(record.testCases.length >= 12, 'catalog has the full test case set');
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
    else if (key === 'chartFirstSensitivity') near(result.chart[0].sensitivity, value, testCase.name);
    else if (key === 'chartLastLabel') assert.equal(result.chart[result.chart.length - 1].label, value, testCase.name);
    else if (key === 'chartLastSensitivity') near(result.chart[result.chart.length - 1].sensitivity, value, testCase.name);
    else if (typeof value === 'number') near(result[key], value, testCase.name + ' ' + key);
    else assert.equal(result[key], value, testCase.name + ' ' + key);
  }
}

console.log('receiver-sensitivity-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
