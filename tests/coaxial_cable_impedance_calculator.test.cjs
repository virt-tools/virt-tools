/* Regression checks for the coaxial cable core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/coaxial-cable-impedance-calculator/index.html'), 'utf8');
const start = html.indexOf('/* coaxial-cable-core:start */');
const end = html.indexOf('/* coaxial-cable-core:end */');
assert.ok(start > -1 && end > start, 'coaxial cable core markers missing');
const core = html.slice(start, end + '/* coaxial-cable-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CoaxialCableCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`);
};
const base = {
  innerDiameter: '0.85', outerDiameter: '2.95', diameterUnit: 'mm',
  relativePermittivity: '2.25', length: '1', lengthUnit: 'm'
};
const calculate = (overrides = {}) => C.calculate({ ...base, ...overrides });

// Independent reference values for a roughly 50 ohm solid-PE example.
const standard = calculate();
near(standard.impedanceOhm, 49.73853075274686, 'default impedance');
near(standard.capacitancePerM, 1.0059528000223148e-10, 'default capacitance');
near(standard.inductancePerM, 2.488648201053766e-7, 'default inductance');
near(standard.velocityMPerS, 199861638.66666666, 'default velocity');
near(standard.velocityFactor, 2 / 3, 'default velocity factor');
near(standard.delayPerM, 5.0034614279722804e-9, 'default delay');
near(standard.diameterRatio, 2.95 / 0.85, 'default diameter ratio');

// Exact transmission-line identities cross-check every primary result.
near(standard.impedanceOhm, Math.sqrt(standard.inductancePerM / standard.capacitancePerM), 'Z from L and C');
near(standard.velocityMPerS, 1 / Math.sqrt(standard.inductancePerM * standard.capacitancePerM), 'velocity from L and C');
near(standard.delayPerM, Math.sqrt(standard.inductancePerM * standard.capacitancePerM), 'delay from L and C');

// Air dielectric: a 2.3 diameter ratio is approximately 50 ohms.
const air = calculate({ innerDiameter: '1', outerDiameter: '2.3', relativePermittivity: '1', length: '2' });
near(air.impedanceOhm, 49.939974678254984, 'air impedance');
near(air.capacitancePerM, 6.679300447130308e-11, 'air capacitance');
near(air.inductancePerM, 1.6658182467770386e-7, 'air inductance');
near(air.velocityMPerS, 299792458, 'air velocity');
near(air.totalDelayS, 6.671281903963041e-9, 'air total delay');

// A different geometry gives approximately 75 ohms; length affects only totals.
const seventyFive = calculate({ innerDiameter: '0.57', outerDiameter: '3.71', length: '100', lengthUnit: 'ft' });
near(seventyFive.impedanceOhm, 74.87419750337689, '75 ohm example');
near(seventyFive.totalCapacitanceF, 2.0368232236173707e-9, '75 ohm total capacitance');
near(seventyFive.totalInductanceH, 1.1418727251151584e-5, '75 ohm total inductance');
near(seventyFive.totalDelayS, 1.5250550432459513e-7, '75 ohm total delay');
const doubled = calculate({ length: '2' });
near(doubled.impedanceOhm, standard.impedanceOhm, 'length-independent impedance');
near(doubled.totalCapacitanceF, standard.totalCapacitanceF * 2, 'double capacitance');
near(doubled.totalInductanceH, standard.totalInductanceH * 2, 'double inductance');
near(doubled.totalDelayS, standard.totalDelayS * 2, 'double delay');

// Quadrupling permittivity halves impedance and velocity, doubles C and delay, and leaves L unchanged.
const dielectric = calculate({ relativePermittivity: '9' });
near(dielectric.impedanceOhm, standard.impedanceOhm / 2, 'permittivity impedance');
near(dielectric.capacitancePerM, standard.capacitancePerM * 2, 'permittivity capacitance');
near(dielectric.inductancePerM, standard.inductancePerM, 'permittivity inductance');
near(dielectric.velocityMPerS, standard.velocityMPerS / 2, 'permittivity velocity');
near(dielectric.delayPerM, standard.delayPerM * 2, 'permittivity delay');

// Diameter and length units preserve the physical result.
for (const unit of ['cm', 'm', 'in', 'mil']) {
  const factors = { cm: 10, m: 0.001, in: 1 / 25.4, mil: 1000 / 25.4 };
  const converted = calculate({
    innerDiameter: String(0.85 * factors[unit]),
    outerDiameter: String(2.95 * factors[unit]), diameterUnit: unit
  });
  near(converted.impedanceOhm, standard.impedanceOhm, `${unit} impedance`);
  near(converted.capacitancePerM, standard.capacitancePerM, `${unit} capacitance`);
}
for (const [unit, value] of [['cm', '100'], ['mm', '1000'], ['in', String(1 / 0.0254)], ['ft', String(1 / 0.3048)]]) {
  near(calculate({ length: value, lengthUnit: unit }).totalDelayS, standard.totalDelayS, `${unit} length`);
}

// A diameter ratio of e makes ln(D/d) exactly one.
const exponential = calculate({ innerDiameter: '1', outerDiameter: String(Math.E), relativePermittivity: '1' });
near(exponential.inductancePerM, C.MU_0 / (2 * Math.PI), 'log-ratio inductance');
near(exponential.capacitancePerM, 2 * Math.PI * C.EPSILON_0, 'log-ratio capacitance');
near(exponential.impedanceOhm, Math.sqrt(C.MU_0 / C.EPSILON_0) / (2 * Math.PI), 'log-ratio impedance');

// Deterministic independent formula sweep over units, geometry, dielectric and length.
const diameterFactors = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, mil: 0.0000254 };
const lengthFactors = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 };
const diameterUnits = Object.keys(diameterFactors);
const lengthUnits = Object.keys(lengthFactors);
for (let i = 0; i < 300; i += 1) {
  const diameterUnit = diameterUnits[i % diameterUnits.length];
  const lengthUnit = lengthUnits[(i * 3) % lengthUnits.length];
  const innerM = 0.00001 + (i % 100) * 0.000013;
  const ratio = 1.01 + (i % 150) * 0.073;
  const er = 1 + (i % 96);
  const lengthM = 0.001 + (i % 200) * 0.37;
  const result = calculate({
    innerDiameter: String(innerM / diameterFactors[diameterUnit]),
    outerDiameter: String(innerM * ratio / diameterFactors[diameterUnit]), diameterUnit,
    relativePermittivity: String(er),
    length: String(lengthM / lengthFactors[lengthUnit]), lengthUnit
  });
  const logRatio = Math.log(result.diameterRatio);
  const expectedC = 2 * Math.PI * 8.8541878128e-12 * er / logRatio;
  const expectedL = 1.25663706212e-6 * logRatio / (2 * Math.PI);
  const expectedV = 299792458 / Math.sqrt(er);
  near(result.capacitancePerM, expectedC, `sweep ${i} C`, 1e-8);
  near(result.inductancePerM, expectedL, `sweep ${i} L`, 1e-8);
  near(result.impedanceOhm, Math.sqrt(expectedL / expectedC), `sweep ${i} Z`, 1e-8);
  near(result.velocityMPerS, expectedV, `sweep ${i} velocity`, 1e-8);
  near(result.totalCapacitanceF, expectedC * result.lengthM, `sweep ${i} total C`, 1e-8);
  near(result.totalInductanceH, expectedL * result.lengthM, `sweep ${i} total L`, 1e-8);
  near(result.totalDelayS, result.lengthM / expectedV, `sweep ${i} total delay`, 1e-8);
}

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'coaxial-cable-impedance-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 20, 'catalog has the full test case set');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.calculate(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) near(result[key], value, `${testCase.name} ${key}`, 1e-8);
}
console.log('coaxial-cable-impedance-calculator: all checks passed (' + record.testCases.length + ' catalog cases, 300 reference cases)');
