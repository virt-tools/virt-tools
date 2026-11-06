/* Regression checks for the fish weight core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/fish-weight-calculator/index.html'), 'utf8');
const start = html.indexOf('/* fish-weight-core:start */');
const end = html.indexOf('/* fish-weight-core:end */');
assert.ok(start > -1 && end > start, 'fish weight core markers missing');
const core = html.slice(start, end + '/* fish-weight-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = FishWeightCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const plan = (input) => C.plan(input);
const base = { length: '18', girth: '12', unit: 'in', factor: '800' };

// 18 in by 12 in at the standard 800 divisor is 3.24 lb.
const standard = plan(base);
near(standard.weightLb, 3.24, 'standard weight');
near(standard.weightKg, 1.4696392788000001, 'standard kilograms');
near(standard.weightOz, 51.84, 'standard ounces');
near(standard.lengthCm, 45.72, 'length in cm');
near(standard.girthCm, 30.48, 'girth in cm');
near(standard.girthRatioPct, 66.66666666666666, 'girth ratio');
assert.equal(standard.unit, 'in');
assert.equal(standard.factor, 800);
assert.equal(C.CM_PER_INCH, 2.54);
near(standard.weightKg, standard.weightLb * C.KG_PER_POUND, 'kilogram conversion');

// Centimetres convert exactly at 2.54 cm per inch.
const metric = plan({ length: '45', girth: '30', unit: 'cm', factor: '800' });
near(metric.lengthIn, 17.716535433070867, 'metric length inches');
near(metric.girthIn, 11.811023622047244, 'metric girth inches');
near(metric.weightLb, 3.0893270447958225, 'metric weight pounds');
near(metric.weightKg, 1.4012951759540333, 'metric weight kilograms');
near(metric.girthRatioPct, 66.66666666666666, 'metric girth ratio');
assert.equal(metric.lengthCm, 45);
assert.equal(metric.girthCm, 30);

// Same length, doubled girth: the weight goes up four times.
const slim = plan({ length: '40', girth: '12', unit: 'in', factor: '800' });
const thick = plan({ length: '40', girth: '24', unit: 'in', factor: '800' });
near(slim.weightLb, 7.2, 'slim weight');
near(thick.weightLb, 28.8, 'thick weight');
near(thick.weightLb / slim.weightLb, 4, 'girth squared');

// Scaling both dimensions by two multiplies the weight by eight.
const scaled = plan({ length: '36', girth: '24', unit: 'in', factor: '800' });
near(scaled.weightLb / standard.weightLb, 8, 'cube scaling');

// The shape factor divides the result exactly.
const slimmer = plan({ ...base, factor: '900' });
near(slimmer.weightLb, 2.88, 'shape factor 900');
near(slimmer.weightLb / standard.weightLb, 800 / 900, 'shape factor ratio');
const deeper = plan({ ...base, factor: '700' });
near(deeper.weightLb, 3.702857142857143, 'shape factor 700');

// Decimal inputs are accepted.
const decimal = plan({ length: '18.5', girth: '11.5', unit: 'in', factor: '800' });
near(decimal.weightLb, 18.5 * 11.5 * 11.5 / 800, 'decimal inputs');

// A round fish has a girth equal to its length.
const round = plan({ length: '20', girth: '20', unit: 'in', factor: '800' });
near(round.weightLb, 10, 'round fish weight');
near(round.girthRatioPct, 100, 'round fish ratio');

// The sensitivity table has four rows, descending as the divisor grows.
assert.equal(standard.shapeRows.length, 4);
assert.equal(standard.shapeRows.map((row) => row.factor).join(','), '700,800,900,1000');
near(standard.shapeRows[0].weightLb, 3.702857142857143, 'table 700');
near(standard.shapeRows[3].weightLb, 2.592, 'table 1000');
near(standard.shapeRows[1].weightLb, standard.weightLb, 'table current factor');
for (let i = 1; i < standard.shapeRows.length; i += 1) {
  assert.ok(standard.shapeRows[i].weightLb < standard.shapeRows[i - 1].weightLb,
    'table is descending');
  near(standard.shapeRows[i].weightLb * standard.shapeRows[i].factor,
    standard.weightLb * standard.factor, 'table keeps the same fish');
}

// Parsing: required, unsigned, no exponent or sign, in range.
const rejects = (input, pattern) => assert.throws(() => plan({ ...base, ...input }), pattern);
rejects({ length: '' }, /Length is required\./);
rejects({ length: '  ' }, /Length is required\./);
rejects({ length: '18in' }, /Length must be a number\./);
rejects({ length: '-18' }, /Length must be a number\./);
rejects({ length: '+18' }, /Length must be a number\./);
rejects({ length: '1e1' }, /Length must be a number\./);
rejects({ length: '0' }, /Length must be from 1 to 100 in \(2\.5 to 254 cm\)\./);
rejects({ length: '101' }, /Length must be from 1 to 100 in \(2\.5 to 254 cm\)\./);
rejects({ girth: '' }, /Girth is required\./);
rejects({ girth: '0.4' }, /Girth must be from 0\.5 to 100 in \(1\.3 to 254 cm\)\./);
rejects({ girth: '101' }, /Girth must be from 0\.5 to 100 in \(1\.3 to 254 cm\)\./);
rejects({ girth: '19' }, /Girth must not exceed the length\./);
rejects({ unit: 'mm' }, /Choose a measurement unit\./);
rejects({ factor: '' }, /Shape factor is required\./);
rejects({ factor: '399' }, /Shape factor must be from 400 to 2000\./);
rejects({ factor: '2001' }, /Shape factor must be from 400 to 2000\./);
rejects({ factor: '1e3' }, /Shape factor must be a number\./);

// Centimetre bounds are checked in centimetres.
rejects({ length: '2.4', unit: 'cm' }, /Length must be from 2\.5 to 254 cm \(1 to 100 in\)\./);
rejects({ length: '255', unit: 'cm' }, /Length must be from 2\.5 to 254 cm \(1 to 100 in\)\./);
rejects({ girth: '1.2', unit: 'cm', length: '30' }, /Girth must be from 1\.3 to 254 cm \(0\.5 to 100 in\)\./);
rejects({ length: '20', girth: '25', unit: 'cm' }, /Girth must not exceed the length\./);
const cmEdge = plan({ length: '2.5', girth: '1.3', unit: 'cm', factor: '400' });
assert.ok(cmEdge.weightLb > 0, 'centimetre minimum is accepted');

// Missing options object is rejected rather than crashing.
assert.throws(() => C.plan(), /Length is required\./);

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'fish-weight-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Sports & Outdoors');
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
    if (key === 'shapeFactorRows') assert.equal(result.shapeRows.length, value, testCase.name);
    else if (key === 'shapeFactorFirst') assert.equal(result.shapeRows[0].factor, value, testCase.name);
    else if (key === 'shapeFactorFirstWeight') near(result.shapeRows[0].weightLb, value, testCase.name);
    else if (key === 'shapeFactorLast') assert.equal(result.shapeRows[result.shapeRows.length - 1].factor, value, testCase.name);
    else if (key === 'shapeFactorLastWeight') near(result.shapeRows[result.shapeRows.length - 1].weightLb, value, testCase.name);
    else if (typeof value === 'number') near(result[key], value, testCase.name + ' ' + key);
    else assert.equal(result[key], value, testCase.name + ' ' + key);
  }
}

console.log('fish-weight-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
