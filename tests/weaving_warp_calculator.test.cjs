/* Regression checks for the weaving warp core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/weaving-warp-calculator/index.html'), 'utf8');
const start = html.indexOf('/* weave-core:start */');
const end = html.indexOf('/* weave-core:end */');
assert.ok(start > -1 && end > start, 'weave core markers missing');
const core = html.slice(start, end + '/* weave-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = WeaveCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const analyse = (options) => C.analyse(options);

// Four 24 in towels at a 12% allowance with 24 in of waste: 3.65 yd of warp, 400 ends.
const standard = analyse({});
assert.equal(standard.items, 4);
near(standard.length, 24, 'default length');
near(standard.allowance, 12, 'default allowance');
near(standard.waste, 24, 'default waste');
near(standard.sett, 20, 'default sett');
near(standard.width, 20, 'default width');
near(standard.perItem, 26.88, 'default per-item warp');
near(standard.totalIn, 131.52, 'default total inches');
near(standard.totalYd, 3.6533333333333333, 'default total yards');
near(standard.exactEnds, 400, 'default exact ends');
assert.equal(standard.ends, 400);
near(standard.yarnYd, 1461.3333333333333, 'default yarn yards');
near(standard.yarnM, 1336.2432, 'default yarn metres');

// The reed table picks the closest whole ends per dent for common reeds.
assert.equal(standard.reeds.length, 7);
assert.deepEqual(
  Array.from(standard.reeds, (row) => [row.reed, row.perDent, row.sett, row.difference]),
  [[6, 3, 18, -2], [8, 2, 16, -4], [10, 2, 20, 0], [12, 2, 24, 4], [15, 1, 15, -5], [20, 1, 20, 0], [25, 1, 25, 5]],
  'default reed table'
);

// A plain one-item warp with no allowance or waste is a straight multiplication.
const plain = analyse({ items: '1', length: '60', allowance: '0', waste: '0', sett: '12', width: '10' });
near(plain.perItem, 60, 'plain per item');
near(plain.totalIn, 60, 'plain total inches');
near(plain.totalYd, 1.6666666666666667, 'plain total yards');
assert.equal(plain.ends, 120);
near(plain.yarnYd, 200, 'plain yarn yards');
near(plain.yarnM, 182.88, 'plain yarn metres');

// A fractional end count rounds to the nearest whole end, half up.
const fractional = analyse({ sett: '15', width: '21.5' });
near(fractional.exactEnds, 322.5, 'fractional exact ends');
assert.equal(fractional.ends, 323);

// The allowance raises the warp length per item, and waste is added once.
const allowed = analyse({ items: '2', length: '40', allowance: '25', waste: '30', sett: '24', width: '15' });
near(allowed.perItem, 50, 'allowed per item');
near(allowed.totalIn, 130, 'allowed total inches');
near(allowed.totalYd, 3.6111111111111112, 'allowed total yards');
assert.equal(allowed.ends, 360);
near(allowed.yarnYd, 1300, 'allowed yarn yards');
near(allowed.yarnM, 1188.72, 'allowed yarn metres');

// The upper bounds are inclusive.
const upper = analyse({ items: '200', length: '200', allowance: '50', waste: '120', sett: '60', width: '120' });
near(upper.perItem, 300, 'upper per item');
near(upper.totalIn, 60120, 'upper total inches');
assert.equal(upper.ends, 7200);
near(upper.yarnYd, 12024000, 'upper yarn yards');
near(upper.yarnM, 10994745.6, 'upper yarn metres');

// A sett that matches the reed exactly shows a zero difference.
const exact = analyse({ sett: '10' });
assert.equal(exact.reeds[2].perDent, 1);
assert.equal(exact.reeds[2].difference, 0);
assert.equal(exact.reeds[6].perDent, 1);
assert.equal(exact.reeds[6].difference, 15);

// Parsing and validation rejections.
assert.throws(() => analyse({ items: '' }), /Number of items is required\./);
assert.throws(() => analyse({ items: 'abc' }), /Number of items must be a whole number from 1 to 200 items\./);
assert.throws(() => analyse({ items: '2.5' }), /Number of items must be a whole number from 1 to 200 items\./);
assert.throws(() => analyse({ items: '0' }), /Number of items must be between 1 and 200 items\./);
assert.throws(() => analyse({ items: '201' }), /Number of items must be between 1 and 200 items\./);
assert.throws(() => analyse({ length: '' }), /Finished length is required\./);
assert.throws(() => analyse({ length: 'abc' }), /Finished length must be a number between 1 and 200 inches\./);
assert.throws(() => analyse({ length: '0.5' }), /Finished length must be between 1 and 200 inches\./);
assert.throws(() => analyse({ length: '201' }), /Finished length must be between 1 and 200 inches\./);
assert.throws(() => analyse({ allowance: '-1' }), /Length allowance must be a number between 0 and 50 percent\./);
assert.throws(() => analyse({ allowance: '51' }), /Length allowance must be between 0 and 50 percent\./);
assert.throws(() => analyse({ waste: '121' }), /Loom waste must be between 0 and 120 inches\./);
assert.throws(() => analyse({ sett: 'x' }), /Sett must be a number between 1 and 60 ends per inch\./);
assert.throws(() => analyse({ sett: '0' }), /Sett must be between 1 and 60 ends per inch\./);
assert.throws(() => analyse({ sett: '61' }), /Sett must be between 1 and 60 ends per inch\./);
assert.throws(() => analyse({ width: '0' }), /Reed width must be between 1 and 120 inches\./);
assert.throws(() => analyse({ width: '121' }), /Reed width must be between 1 and 120 inches\./);

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'weaving-warp-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.risk, 'low');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 14, 'catalog has the full test case set');
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
    } else if (typeof value === 'number') {
      near(result[key], value, `${testCase.name} ${key}`);
    } else {
      assert.equal(result[key], value, `${testCase.name} ${key}`);
    }
  }
}

console.log('weaving-warp-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
