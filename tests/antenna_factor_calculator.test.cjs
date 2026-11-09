/* Regression checks for the antenna factor calculator: every catalog case,
   an independent 300 m/MHz oracle, hand-checked anchors and refusals outside
   the catalog. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/antenna-factor-calculator/index.html'), 'utf8');
const start = html.indexOf('/* antenna-factor-core:start */');
const end = html.indexOf('/* antenna-factor-core:end */');
assert.ok(start > -1 && end > start, 'antenna factor core markers missing');
const core = html.slice(start, end + '/* antenna-factor-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = AntennaFactorCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'antenna-factor-calculator');
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.name, 'Antenna Factor Calculator', 'catalog name');
assert.equal(entry.category, 'Communications Engineering', 'catalog category');
assert.equal(entry.subcategory, 'Estimation & calculation', 'catalog subcategory');
assert.equal(entry.risk, 'low', 'catalog risk');
assert.equal(entry.maturity, 'draft', 'catalog maturity');
assert.equal(entry.listed, true, 'catalog listed');
assert.ok(entry.testCases.length >= 34, `expected at least 34 cases, found ${entry.testCases.length}`);

const NUMERIC = ['frequency', 'gain', 'wavelengthM', 'antennaFactorDb', 'fieldDbUvPerM', 'fieldVPerM'];

function close(actual, expected, label) {
  const tolerance = Math.max(Math.abs(expected) * 2e-5, 1e-4);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`);
}

function nearDb(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= 0.02,
    `${label}: expected about ${expected}, got ${actual}`);
}

// Independent oracle: round the wavelength to 300 m/MHz and use the published
// 9.73 constant and its 29.79 dB form, rather than the page's exact 299,792,458.
const oracleAf = (frequency, gain) => 20 * Math.log10(9.73 / (300 / frequency)) - gain;

for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.kind === 'validation') {
    assert.throws(() => C.calculate(testCase.input), (error) => error.message === testCase.expected.error, label);
    continue;
  }
  const got = C.calculate(testCase.input);
  for (const key of NUMERIC) {
    if (testCase.expected[key] === null) {
      assert.equal(got[key], null, `${label}: ${key} should be null`);
    } else {
      close(got[key], testCase.expected[key], `${label}: ${key}`);
    }
  }
  assert.equal(got.level, testCase.expected.level, `${label}: level`);
  nearDb(got.antennaFactorDb, oracleAf(got.frequency, got.gain), `${label}: oracle antenna factor`);
  if (got.level !== null) {
    nearDb(got.fieldDbUvPerM, got.level + oracleAf(got.frequency, got.gain), `${label}: oracle field strength`);
    close(got.fieldVPerM, Math.pow(10, (got.fieldDbUvPerM - 120) / 20), `${label}: linear field strength`);
  }
}

// Hand-checked anchors against published antenna-factor tables.
const anchor = (frequency, gain) => C.calculate({ frequency, gain }).antennaFactorDb;
assert.ok(Math.abs(anchor(100, 0) - 10.21) <= 0.03, `100 MHz 0 dBi anchor: ${anchor(100, 0)}`);
assert.ok(Math.abs(anchor(300, 0) - 19.75) <= 0.03, `300 MHz 0 dBi anchor: ${anchor(300, 0)}`);
assert.ok(Math.abs(anchor(1000, 6) - 24.21) <= 0.03, `1 GHz 6 dBi anchor: ${anchor(1000, 6)}`);
assert.ok(Math.abs(anchor(100, 10) - anchor(100, 0) + 10) <= 1e-4, 'each 10 dB of gain must lower the factor by 10 dB');
assert.ok(Math.abs(C.calculate({}).wavelengthM - 2.9979) <= 1e-6, 'default wavelength');

// Field strength from a 40 dBuV level at 100 MHz, 0 dBi: 50.21 dBuV/m, 0.000324 V/m.
const field = C.calculate({ frequency: 100, gain: 0, level: 40 });
assert.ok(Math.abs(field.fieldDbUvPerM - 50.23) <= 0.03, `field anchor: ${field.fieldDbUvPerM}`);
assert.ok(Math.abs(field.fieldVPerM / Math.pow(10, (50.21 - 120) / 20) - 1) <= 5e-3, 'linear field anchor');

// Warnings fire at the documented boundaries and stay quiet in the middle.
const warn = (input) => C.calculate(input).warnings.join(' ');
assert.match(warn({ frequency: 10 }), /Below 30 MHz/, 'low-frequency warning');
assert.match(warn({ frequency: 2000 }), /Above 1 GHz/, 'high-frequency warning');
assert.match(warn({ gain: -3 }), /smaller than isotropic/, 'negative gain warning');
assert.match(warn({ frequency: 1000, gain: 40 }), /negative antenna factor/i, 'negative factor warning');
assert.equal(warn({ frequency: 100, gain: 0 }), '', 'no warnings in the normal case');
assert.equal(warn({ frequency: 100, gain: 0, level: 0 }), '', 'no warnings with a level');

// Refusals outside the catalog.
const refusals = [
  [{ frequency: '  ' }, 'Frequency is required.'],
  [{ frequency: '50000' }, 'Frequency must be a number from 0.1 to 40000 MHz.'],
  [{ frequency: '-5' }, 'Frequency must be a number from 0.1 to 40000 MHz.'],
  [{ frequency: '1/2' }, 'Frequency must be a number from 0.1 to 40000 MHz.'],
  [{ gain: 'Infinity' }, 'Antenna gain must be a number from -20 to 40 dBi.'],
  [{ gain: 'NaN' }, 'Antenna gain must be a number from -20 to 40 dBi.'],
  [{ gain: '-25' }, 'Antenna gain must be a number from -20 to 40 dBi.'],
  [{ level: '1e3' }, 'Received level must be a number from -20 to 160 dBµV.'],
  [{ level: '170' }, 'Received level must be a number from -20 to 160 dBµV.'],
  [{ level: '--5' }, 'Received level must be a number from -20 to 160 dBµV.'],
];
for (const [input, message] of refusals) {
  assert.throws(() => C.calculate(input), (error) => error.message === message, JSON.stringify(input));
}

// A blank or absent optional level must be accepted, and must not invent a field.
for (const input of [{ level: '' }, { level: '   ' }, { level: undefined }, { level: null }]) {
  const got = C.calculate(input);
  assert.equal(got.level, null, 'blank level must be treated as absent');
  assert.equal(got.fieldDbUvPerM, null, 'no field strength without a level');
  assert.equal(got.fieldVPerM, null, 'no linear field without a level');
}

console.log(`antenna factor: ${entry.testCases.length} catalog cases, ${refusals.length} extra refusals, anchors and warnings passed`);
