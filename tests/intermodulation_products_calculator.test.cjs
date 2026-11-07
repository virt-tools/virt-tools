/* Regression checks for the intermodulation product core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/intermodulation-products-calculator/index.html'), 'utf8');
const start = html.indexOf('/* intermodulation-core:start */');
const end = html.indexOf('/* intermodulation-core:end */');
assert.ok(start > -1 && end > start, 'intermodulation core markers missing');
const core = html.slice(start, end + '/* intermodulation-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = IntermodulationCore;', sandbox);
const C = sandbox.module.exports;

// Values created inside the vm context have foreign prototypes, so compare by value, not identity.
const same = (actual, expected, label) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), label);
const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const sameFreqs = (actual, expected, label) => {
  assert.equal(actual.length, expected.length, `${label}: count`);
  expected.forEach((value, index) => near(actual[index], value, `${label} [${index}]`));
};
const analyse = (options) => C.analyse(options);

// The default two carriers up to third order give four 2nd- and six 3rd-order products.
const standard = analyse({ carrier1: '145.0', carrier2: '145.6' });
assert.equal(standard.total, 10);
assert.equal(standard.inBandCount, 0);
assert.equal(standard.order, 3);
assert.equal(standard.carriers.length, 2);
same(standard.byOrder, { 2: 4, 3: 6 }, 'byOrder');
sameFreqs(standard.frequencies, [0.6, 144.4, 146.2, 290, 290.6, 291.2, 435, 435.6, 436.2, 436.8], 'default frequencies');
same(standard.formulas, [
  'f2 \u2212 f1',
  '2f1 \u2212 f2',
  '2f2 \u2212 f1',
  '2f1',
  'f1 + f2',
  '2f2',
  '3f1',
  '2f1 + f2',
  'f1 + 2f2',
  '3f2'
], 'default formulas');
same(standard.orders, [2, 3, 3, 2, 2, 2, 3, 3, 3, 3], 'default orders');
near(standard.lowest, 0.6, 'lowest product');
near(standard.highest, 436.8, 'highest product');

// A protect band flags the 2f1 - f2 product and nothing else.
const banded = analyse({ carrier1: '145.0', carrier2: '145.6', bandLow: '144.2', bandHigh: '144.5' });
assert.equal(banded.inBandCount, 1);
sameFreqs(banded.inBandFrequencies, [144.4], 'in-band products');
assert.equal(banded.products[1].inBand, true);
assert.equal(banded.products[0].inBand, false);

// Coincident products are listed once, at their lowest order.
const octave = analyse({ carrier1: '100', carrier2: '200', order: 3 });
assert.equal(octave.total, 6);
sameFreqs(octave.frequencies, [100, 200, 300, 400, 500, 600], 'octave-spaced frequencies');
same(octave.formulas, ['f2 \u2212 f1', '2f1', 'f1 + f2', '2f2', 'f1 + 2f2', '3f2'], 'octave formulas');
same(octave.orders, [2, 2, 2, 2, 3, 3], 'octave orders');

// Higher orders add progressively more products.
const fifth = analyse({ carrier1: '145.0', carrier2: '145.6', order: 5 });
assert.equal(fifth.total, 28);
same(fifth.byOrder, { 2: 4, 3: 6, 4: 8, 5: 10 }, 'fifth byOrder');
near(fifth.highest, 728, 'fifth-order highest');
const seventh = analyse({ carrier1: '145.0', carrier2: '145.6', order: 7 });
assert.equal(seventh.total, 54);
near(seventh.highest, 1019.2, 'seventh-order highest');

// A third carrier adds the cross products between all three tones.
const triple = analyse({ carrier1: '145.0', carrier2: '145.6', carrier3: '146.2', order: 3 });
assert.equal(triple.carriers.length, 3);
assert.equal(triple.total, 21);
same(triple.byOrder, { 2: 7, 3: 14 }, 'triple byOrder');
sameFreqs(triple.frequencies.slice(0, 3), [0.6, 1.2, 143.8], 'three-carrier low products');
assert.equal(triple.products[5].formula, 'f1 + f3 \u2212 f2');
near(triple.products[5].frequency, 145.6, 'f1 + f3 - f2 frequency');

// The seventh order spans both sides of every carrier.
const wide = analyse({ carrier1: '145.0', carrier2: '145.6', carrier3: '146.2', order: 7 });
assert.equal(wide.total, 105);
near(wide.lowest, 0.6, 'three-carrier seventh-order lowest');
near(wide.highest, 1023.4, 'three-carrier seventh-order highest');
assert.equal(wide.byOrder[7], 27);

// Sum products can land in a band above the carriers.
const upperBand = analyse({ carrier1: '145.0', carrier2: '145.6', order: 3, bandLow: '435.0', bandHigh: '435.6' });
assert.equal(upperBand.inBandCount, 2);
sameFreqs(upperBand.inBandFrequencies, [435, 435.6], 'upper-band products');

// A band with no products reports zero rather than failing.
const emptyBand = analyse({ carrier1: '145.0', carrier2: '145.6', order: 3, bandLow: '200', bandHigh: '210' });
assert.equal(emptyBand.inBandCount, 0);

// Small and large frequencies keep their precision and their products.
const low = analyse({ carrier1: '0.001', carrier2: '0.002', order: 2 });
sameFreqs(low.frequencies, [0.001, 0.002, 0.003, 0.004], 'low-frequency products');
const high = analyse({ carrier1: '999999', carrier2: '1000000', order: 2 });
sameFreqs(high.frequencies, [1, 1999998, 1999999, 2000000], 'high-frequency products');

// Parsing and validation rejections.
assert.throws(() => analyse({}), /Carrier 1 is required\./);
assert.throws(() => analyse({ carrier1: '  ', carrier2: '145.6' }), /Carrier 1 is required\./);
assert.throws(() => analyse({ carrier1: '145.0' }), /Carrier 2 is required\./);
assert.throws(() => analyse({ carrier1: 'abc', carrier2: '145.6' }), /Carrier 1 must be a number greater than 0\./);
assert.throws(() => analyse({ carrier1: '0', carrier2: '145.6' }), /Carrier 1 must be a number greater than 0\./);
assert.throws(() => analyse({ carrier1: '-5', carrier2: '145.6' }), /Carrier 1 must be a number greater than 0\./);
assert.throws(() => analyse({ carrier1: '145', carrier2: '145.0' }), /Carrier 1 and carrier 2 must be different frequencies\./);
assert.throws(() => analyse({ carrier1: '145', carrier2: '146', carrier3: '146' }), /Carrier 3 must differ from the other carriers\./);
assert.throws(() => analyse({ carrier1: '145', carrier2: '146', order: 1 }), /Product order must be a whole number from 2 to 7\./);
assert.throws(() => analyse({ carrier1: '145', carrier2: '146', order: 9 }), /Product order must be a whole number from 2 to 7\./);
assert.throws(() => analyse({ carrier1: '145', carrier2: '146', order: '2.5' }), /Product order must be a whole number from 2 to 7\./);
assert.throws(() => analyse({ carrier1: '145', carrier2: '146', bandLow: '145' }), /Protect band high is required when a low limit is given\./);
assert.throws(() => analyse({ carrier1: '145', carrier2: '146', bandHigh: '145' }), /Protect band low is required when a high limit is given\./);
assert.throws(() => analyse({ carrier1: '145', carrier2: '146', bandLow: '146', bandHigh: '145' }), /Protect band low must be below its high limit\./);
assert.throws(() => analyse({ carrier1: '1450001', carrier2: '146' }), /Carrier 1 must be 1,000,000 MHz or less\./);

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'intermodulation-products-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.risk, 'low');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 24, 'catalog has the full test case set');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => analyse(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  const result = analyse(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (Array.isArray(value)) {
      assert.equal(result[key].length, value.length, `${testCase.name} ${key} length`);
      value.forEach((item, index) => {
        if (typeof item === 'number') near(result[key][index], item, `${testCase.name} ${key}[${index}]`);
        else assert.equal(result[key][index], item, `${testCase.name} ${key}[${index}]`);
      });
    } else if (value && typeof value === 'object') {
      same(result[key], value, `${testCase.name} ${key}`);
    } else if (typeof value === 'number') {
      near(result[key], value, `${testCase.name} ${key}`);
    } else {
      assert.equal(result[key], value, `${testCase.name} ${key}`);
    }
  }
}

console.log('intermodulation-products-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
