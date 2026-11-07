/* Regression checks for the bead loom size, bead and warp planner. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/bead-loom-calculator/index.html'), 'utf8');
const start = html.indexOf('/* bead-loom-core:start */');
const end = html.indexOf('/* bead-loom-core:end */');
assert.ok(start > -1 && end > start, 'bead loom core markers missing');
const core = html.slice(start, end + '/* bead-loom-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BeadLoomCore;', sandbox);
const C = sandbox.module.exports;
const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
};
const check = (result, expected, label) => {
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === 'number') near(result[key], value, `${label}: ${key}`);
    else assert.equal(result[key], value, `${label}: ${key}`);
  }
};

const defaults = C.calculate();
check(defaults, {
  mode: 'fit', unit: 'mm', columns: 13, rows: 131,
  widthMm: 20.8, lengthMm: 170.3, patternBeads: 1703,
  beadsWithSpare: 1789, warpStrands: 14, warpPerStrandMm: 470.3,
  warpTotalMm: 6584.2, warpWithSpareMm: 6913.41
}, 'default bracelet');

const exact = C.calculate({
  mode: 'fit', beadWidth: 2, beadLength: 2, targetWidth: 10,
  targetLength: 10, endAllowance: 5, sparePercent: 0
});
check(exact, {
  columns: 5, rows: 5, widthMm: 10, lengthMm: 10,
  patternBeads: 25, beadsWithSpare: 25, warpStrands: 6,
  warpPerStrandMm: 20, warpTotalMm: 120, warpWithSpareMm: 120
}, 'exact fit');

const existing = C.calculate({
  mode: 'grid', columns: 12, rows: 100, beadWidth: 1.5,
  beadLength: 2, unit: 'cm', endAllowance: 10, sparePercent: 10
});
check(existing, {
  columns: 12, rows: 100, widthMm: 18, lengthMm: 200,
  patternBeads: 1200, beadsWithSpare: 1320, warpStrands: 13,
  endAllowanceMm: 100, warpPerStrandMm: 400, warpTotalMm: 5200,
  warpWithSpareMm: 5720
}, 'existing grid in centimetres');

const inches = C.calculate({
  mode: 'fit', unit: 'in', targetWidth: 1, targetLength: 7,
  beadWidth: 1.6, beadLength: 1.3, endAllowance: 6, sparePercent: 5
});
check(inches, {
  columns: 16, rows: 137, widthMm: 25.6, lengthMm: 178.1,
  patternBeads: 2192, warpStrands: 17, endAllowanceMm: 152.4,
  warpPerStrandMm: 482.9
}, 'inch conversion');

const roundedUp = C.calculate({
  beadWidth: 2, beadLength: 2, targetWidth: 11, targetLength: 11,
  endAllowance: 0, sparePercent: 0
});
check(roundedUp, { columns: 6, rows: 6, widthMm: 12, lengthMm: 12 }, 'nearest whole bead');

// Fields belonging to the inactive mode never contaminate the calculation.
assert.equal(C.calculate({ mode: 'fit', columns: '', rows: 'bad' }).columns, 13);
assert.equal(C.calculate({ mode: 'grid', targetWidth: '', targetLength: 'bad' }).columns, 13);

// Independent arithmetic reference over both modes, all units and margins.
const factors = { mm: 1, cm: 10, in: 25.4 };
let referenceCases = 0;
for (const beadWidth of [1, 1.6, 2.2, 3]) {
  for (const beadLength of [1, 1.3, 2, 3]) {
    for (const unit of ['mm', 'cm', 'in']) {
      const targetWidth = unit === 'mm' ? 20 : (unit === 'cm' ? 2 : 1);
      const targetLength = unit === 'mm' ? 120 : (unit === 'cm' ? 15 : 6);
      const sparePercent = referenceCases % 4 * 5;
      const allowance = referenceCases % 3 * 2.5;
      const got = C.calculate({
        mode: 'fit', unit, beadWidth, beadLength, targetWidth, targetLength,
        sparePercent, endAllowance: allowance
      });
      const columns = Math.max(1, Math.round(targetWidth * factors[unit] / beadWidth));
      const rows = Math.max(1, Math.round(targetLength * factors[unit] / beadLength));
      const lengthMm = rows * beadLength;
      const perStrand = lengthMm + 2 * allowance * factors[unit];
      check(got, {
        columns, rows, widthMm: columns * beadWidth, lengthMm,
        patternBeads: columns * rows,
        beadsWithSpare: Math.ceil(columns * rows * (1 + sparePercent / 100) - 1e-12),
        warpStrands: columns + 1, warpPerStrandMm: perStrand,
        warpTotalMm: perStrand * (columns + 1),
        warpWithSpareMm: perStrand * (columns + 1) * (1 + sparePercent / 100)
      }, `fit reference ${referenceCases}`);
      referenceCases += 1;

      const gridColumns = 3 + referenceCases % 20;
      const gridRows = 20 + referenceCases % 100;
      const grid = C.calculate({
        mode: 'grid', unit, beadWidth, beadLength, columns: gridColumns,
        rows: gridRows, sparePercent, endAllowance: allowance
      });
      const gridLength = gridRows * beadLength;
      const gridPerStrand = gridLength + 2 * allowance * factors[unit];
      check(grid, {
        widthMm: gridColumns * beadWidth, lengthMm: gridLength,
        patternBeads: gridColumns * gridRows, warpStrands: gridColumns + 1,
        warpPerStrandMm: gridPerStrand,
        warpTotalMm: gridPerStrand * (gridColumns + 1)
      }, `grid reference ${referenceCases}`);
      referenceCases += 1;
    }
  }
}
assert.equal(referenceCases, 96);

const rejects = (options, message) => assert.throws(
  () => C.calculate(options), (error) => error.message === message, message
);
rejects({ mode: 'other' }, 'Choose target size or existing grid mode.');
rejects({ unit: 'px' }, 'Choose millimetres, centimetres or inches.');
rejects({ beadWidth: '' }, 'Bead width is required.');
rejects({ beadWidth: 0 }, 'Bead width must be a number from 0.2 to 20 millimetres.');
rejects({ beadLength: 'round' }, 'Bead length must be a number from 0.2 to 30 millimetres.');
rejects({ targetWidth: '' }, 'Target beaded width is required.');
rejects({ targetLength: -1 }, 'Target beaded length must be a number from 0.1 to 4000 mm.');
rejects({ mode: 'grid', columns: 2.5 }, 'Pattern columns must be a whole number from 1 to 500 beads.');
rejects({ mode: 'grid', rows: 0 }, 'Pattern rows must be a whole number from 1 to 2000 beads.');
rejects({ endAllowance: -1 }, 'Warp allowance per end must be a number from 0 to 2000 mm.');
rejects({ sparePercent: 101 }, 'Spare material margin must be a number from 0 to 100 percent.');
rejects({ beadWidth: 0.2, targetWidth: 2000, unit: 'in' }, 'The target width needs more than 500 columns; enter a smaller pattern or larger beads.');

// Replay every canonical catalog case against the public core used by the page.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'bead-loom-calculator');
assert.equal(records.length, 1, 'catalog must contain exactly one bead loom record');
const record = records[0];
assert.equal(record.name, 'Bead Loom Calculator');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('Bead Weaving Calculator'));
assert.ok(record.testCases.length >= 12, 'catalog carries representative and validation checks');
for (const test of record.testCases) {
  if (test.kind === 'validation') {
    assert.throws(() => C.calculate(test.input),
      (error) => error.message === test.expected.error, test.name);
    continue;
  }
  assert.equal(test.kind, 'golden', test.name);
  check(C.calculate(test.input), test.expected, test.name);
}

console.log(`bead-loom-calculator: all checks passed (${record.testCases.length} catalog cases, ${referenceCases} independent reference cases)`);
