/* Regression checks for the quilt backing core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/quilt-backing-calculator/index.html'), 'utf8');
const start = html.indexOf('/* quilt-backing-core:start */');
const end = html.indexOf('/* quilt-backing-core:end */');
assert.ok(start > -1 && end > start, 'quilt backing core markers missing');
const core = html.slice(start, end + '/* quilt-backing-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = QuiltBackingCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const plan = (input) => C.plan(input);
const base = { width: '60', length: '72', fabric: '42', margin: '4', seam: '0.5' };

// Default 60 x 72 in top with a 4 in margin gives a 68 x 80 in backing.
const standard = plan(base);
assert.equal(standard.neededWidth, 68);
assert.equal(standard.neededLength, 80);
// Two 42 in panels joined with one 1/2 in seam cover 83.5 in, with 15.5 in to trim.
assert.equal(standard.panels.pieces, 2);
assert.equal(standard.panels.joined, 83.5);
near(standard.panels.yardage, 2 * 80 / 36, 'panel yardage');
assert.equal(standard.panels.cutWidth, 42);
assert.equal(standard.panels.cutLength, 80);
// Two 68 in strips cover the 80 in length the same way and cut less fabric.
assert.equal(standard.strips.pieces, 2);
assert.equal(standard.strips.joined, 83.5);
near(standard.strips.yardage, 2 * 68 / 36, 'strip yardage');
assert.equal(standard.best, 'strips');
assert.equal(standard.bestPieces, 2);
near(standard.yardage, standard.strips.yardage, 'best yardage is the strip yardage');
near(standard.buyYardage, 3.875, 'rounded up to the next eighth yard');

// A single panel is chosen whenever it is the cheaper cut.
const exact = plan({ width: '34', length: '50', fabric: '42', margin: '4', seam: '0.5' });
assert.equal(exact.panels.pieces, 1);
assert.equal(exact.best, 'panels');
near(exact.panels.yardage, 58 / 36, 'single panel yardage');
assert.equal(exact.panels.joined, 42);

// Wide backing covers the default backing in one piece.
const wide = plan({ width: '60', length: '72', fabric: '108', margin: '4', seam: '0.5' });
assert.equal(wide.panels.pieces, 1);
assert.equal(wide.strips.pieces, 1);
near(wide.buyYardage, 2, 'wide-back buy amount');

// Seam allowance is really subtracted: two panels of 42 in cannot reach 84 in.
const tight = plan({ width: '76', length: '60', fabric: '42', margin: '4', seam: '0.5' });
assert.equal(tight.neededWidth, 84);
assert.equal(tight.panels.pieces, 3, '84 in needs a third panel after the seam');

// Exact seam fit: 2 x 42 - 0.5 = 83.5 in with no trim.
const fitted = plan({ width: '75.5', length: '60', fabric: '42', margin: '4', seam: '0.5' });
assert.equal(fitted.panels.pieces, 2);
assert.equal(fitted.panels.joined, 83.5);
near(fitted.panels.joined - fitted.neededWidth, 0, 'no trim needed');

// The yardage always grows with the number of pieces and never falls below the cut area.
for (const margin of ['0', '2', '4', '8']) {
  const result = plan({ width: '90', length: '108', fabric: '42', margin, seam: '0.5' });
  assert.ok(result.buyYardage * 36 >= result.yardage * 36 - 1e-9, 'buy covers the exact yardage');
  assert.ok(result.buyYardage * 36 - result.yardage * 36 < 4.5, 'buy rounds up by less than an eighth');
  assert.ok(result.yardage >= (result.neededWidth * result.neededLength) / 36 / 42, 'yardage covers the cut area');
}

// Margins and fabric widths are honoured independently of the layout choice.
const noMargin = plan({ width: '50', length: '60', fabric: '42', margin: '0', seam: '0.5' });
assert.equal(noMargin.neededWidth, 50);
assert.equal(noMargin.neededLength, 60);
assert.equal(noMargin.best, 'strips');

// Parsing and range rejections.
const rejects = (input, pattern, label) =>
  assert.throws(() => plan({ ...base, ...input }), pattern, label);
rejects({ width: '' }, /Quilt width is required\./);
rejects({ width: '   ' }, /Quilt width is required\./);
rejects({ width: '60in' }, /Quilt width must be a number\./);
rejects({ width: '-60' }, /Quilt width must be a number\./);
rejects({ width: '0' }, /Quilt width must be from 1 to 200 in\./);
rejects({ width: '201' }, /Quilt width must be from 1 to 200 in\./);
rejects({ length: '' }, /Quilt length is required\./);
rejects({ length: 'abc' }, /Quilt length must be a number\./);
rejects({ length: '0' }, /Quilt length must be from 1 to 200 in\./);
rejects({ fabric: '' }, /Backing fabric width is required\./);
rejects({ fabric: '11' }, /Backing fabric width must be from 12 to 130 in\./);
rejects({ fabric: '131' }, /Backing fabric width must be from 12 to 130 in\./);
rejects({ margin: '' }, /Margin is required\./);
rejects({ margin: '-1' }, /Margin must be a number\./);
rejects({ margin: '13' }, /Margin must be from 0 to 12 in\./);
rejects({ seam: '' }, /Seam allowance is required\./);
rejects({ seam: '0.1' }, /Seam allowance must be from 0.25 to 1 in\./);
rejects({ seam: '1.5' }, /Seam allowance must be from 0.25 to 1 in\./);

// Missing options object is rejected rather than crashing.
assert.throws(() => C.plan(), /Quilt width is required\./);

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'quilt-backing-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Crafts & Hobbies');
assert.ok(record.testCases.length >= 18, 'catalog has the full test case set');
const grouped = (result, key) => {
  const match = /^(panels|strips)([A-Z]\w*)$/.exec(key);
  if (!match) return result[key];
  return result[match[1]][match[2][0].toLowerCase() + match[2].slice(1)];
};
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
    if (typeof value === 'number') near(grouped(result, key), value, testCase.name + ' ' + key);
    else assert.equal(grouped(result, key), value, testCase.name + ' ' + key);
  }
}

console.log('quilt-backing-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
