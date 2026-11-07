/* Regression checks for the OFDM symbol-timing calculator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/ofdm-symbol-timing-calculator/index.html'), 'utf8');
const startMarker = '/* ofdm-symbol-timing-core:start */';
const endMarker = '/* ofdm-symbol-timing-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'OFDM timing core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = OfdmSymbolTimingCore;', sandbox);
const C = sandbox.module.exports;
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-12, Math.abs(expected) * 1e-11), `${label || 'value'}: ${actual} != ${expected}`);

const standard = C.calculate({});
assert.equal(standard.sampleRateHz, 20000000);
assert.equal(standard.fftSize, 64);
assert.equal(standard.cpSamples, 16);
assert.equal(standard.activeSubcarriers, 52);
assert.equal(standard.subcarrierSpacingHz, 312500);
assert.equal(standard.usefulSymbolSeconds, 0.0000032);
assert.equal(standard.cpSeconds, 0.0000008);
assert.equal(standard.totalSamples, 80);
assert.equal(standard.totalSymbolSeconds, 0.000004);
assert.equal(standard.symbolRateHz, 250000);
assert.equal(standard.occupiedBandwidthHz, 16250000);
assert.equal(standard.overheadPercent, 20);
assert.match(C.summary(standard), /20 MS\/s · 64-point FFT · 52 active subcarriers/);
assert.match(C.summary(standard), /Subcarrier spacing: 312\.5 kHz/);
assert.match(C.summary(standard), /Total symbol: 4 µs \(80 samples\)/);
assert.equal(C.formatFrequencyHz(999), '999 Hz');
assert.equal(C.formatFrequencyHz(15000), '15 kHz');
assert.equal(C.formatFrequencyHz(16250000), '16.25 MHz');
assert.equal(C.formatDurationSeconds(0), '0 s');
assert.equal(C.formatDurationSeconds(0.0000032), '3.2 µs');
assert.equal(C.formatDurationSeconds(0.05), '50 ms');

// Independently recompute every supported FFT size and cyclic-prefix choice.
const sizes = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192];
const ratios = {'0': 0, '1/32': 1 / 32, '1/16': 1 / 16, '1/8': 1 / 8, '1/4': 1 / 4};
let enumerated = 0;
for (const fftSize of sizes) {
  for (const [cpRatio, ratio] of Object.entries(ratios)) {
    for (const sampleRateMHz of [0.001, 20, 1000]) {
      const activeSubcarriers = Math.max(1, Math.floor(fftSize * 0.75));
      const sampleRateHz = sampleRateMHz * 1000000;
      const cpSamples = fftSize * ratio;
      if (!Number.isSafeInteger(cpSamples)) {
        assert.throws(() => C.calculate({sampleRateMHz, fftSize, cpRatio, activeSubcarriers}), /whole number of samples/);
        continue;
      }
      const result = C.calculate({sampleRateMHz, fftSize, cpRatio, activeSubcarriers});
      assert.equal(result.cpSamples, cpSamples);
      assert.equal(result.totalSamples, fftSize + cpSamples);
      close(result.samplePeriodSeconds, 1 / sampleRateHz, 'sample period');
      close(result.subcarrierSpacingHz, sampleRateHz / fftSize, 'subcarrier spacing');
      close(result.usefulSymbolSeconds, fftSize / sampleRateHz, 'useful symbol');
      close(result.cpSeconds, cpSamples / sampleRateHz, 'cyclic prefix');
      close(result.totalSymbolSeconds, (fftSize + cpSamples) / sampleRateHz, 'total symbol');
      close(result.symbolRateHz, sampleRateHz / (fftSize + cpSamples), 'symbol rate');
      close(result.occupiedBandwidthHz, activeSubcarriers * sampleRateHz / fftSize, 'occupied bandwidth');
      close(result.overheadPercent, cpSamples / (fftSize + cpSamples) * 100, 'overhead');
      close(result.totalSymbolSeconds, result.usefulSymbolSeconds + result.cpSeconds, 'symbol components');
      assert.ok(result.occupiedBandwidthHz <= sampleRateHz);
      enumerated += 1;
    }
  }
}
assert.equal(enumerated, 147);

for (const value of ['', ' ', 0, -1, '1e3', '+20', 'NaN', Infinity, 0.0009, 1000.1]) {
  assert.throws(() => C.calculate({sampleRateMHz: value}), /Sample rate/);
}
for (const value of ['', 0, 15, 8194, 100, 64.5, '1e6', '__proto__', 'constructor']) {
  assert.throws(() => C.calculate({fftSize: value}), /FFT size/);
}
for (const value of ['', '1/2', 0.25, '__proto__', 'constructor']) {
  assert.throws(() => C.calculate({cpRatio: value}), /Cyclic prefix/);
}
for (const value of ['', 0, 65, -1, 1.5, '1e2', '__proto__']) {
  assert.throws(() => C.calculate({activeSubcarriers: value}), /Active subcarriers/);
}
assert.throws(() => C.calculate({fftSize: 16, activeSubcarriers: 17}), /from 1 to 16/);
assert.equal(C.calculate({fftSize: 16, cpRatio: '0', activeSubcarriers: 16}).cpSeconds, 0);

// Replay every canonical catalog case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'ofdm-symbol-timing-calculator');
assert.equal(records.length, 1, 'catalog must contain exactly one OFDM timing calculator');
const record = records[0];
assert.equal(record.name, 'OFDM Symbol Timing Calculator');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('OFDM Cyclic Prefix Calculator'));
assert.ok(record.testCases.length >= 12, 'catalog carries golden and validation checks');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.calculate(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  assert.equal(testCase.kind, 'golden', testCase.name);
  const result = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) close(result[key], expected, `${testCase.name}: ${key}`);
}

console.log(`ofdm-symbol-timing-calculator: all checks passed (${record.testCases.length} catalog cases and ${enumerated} independently checked configurations)`);
