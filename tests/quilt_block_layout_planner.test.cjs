/* Regression checks for the quilt block layout planner core and catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/quilt-block-layout-planner/index.html'), 'utf8');
const startMarker = '/* quilt-block-layout-core:start */';
const endMarker = '/* quilt-block-layout-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'quilt block layout core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = QuiltBlockLayoutCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'quilt-block-layout-planner');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 17, 'catalog has the full test case set');
const base = { ...record.testCases[0].input };
const calculate = (overrides = {}) => C.calculate({ ...base, ...overrides });
const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)), `${label}: expected ${expected}, got ${actual}`);
};

// Published example and its copyable plan.
const standard = calculate();
assert.equal(standard.quiltWidth, 60);
assert.equal(standard.quiltHeight, 71);
assert.equal(standard.interiorWidth, 54);
assert.equal(standard.interiorHeight, 65);
assert.equal(standard.blockCount, 30);
assert.equal(standard.verticalSashingCount, 24);
assert.equal(standard.horizontalSashingCount, 5);
assert.equal(standard.totalSashingCount, 29);
assert.equal(standard.sideBorderLength, 65);
assert.equal(standard.endBorderLength, 60);
assert.deepEqual(Array.from(standard.blockColors.slice(0, 7)), ['A', 'B', 'A', 'B', 'A', 'B', 'A']);
assert.match(C.summary(standard), /Finished quilt: 60 × 71 in \(152\.4 × 180\.34 cm\)/);
assert.match(C.summary(standard), /Vertical sashing: 24 pieces at 1 × 10 in finished/);
assert.match(C.summary(standard), /Finished dimensions only; add seam allowance separately/);

// Color sequences are deterministic and the preview remains bounded at 144 blocks.
assert.deepEqual(Array.from(calculate({ columns: 3, rows: 3 }).blockColors), [
  'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A'
]);
assert.deepEqual(Array.from(calculate({ columns: 3, rows: 3, pattern: 'alternate-rows' }).blockColors), [
  'A', 'A', 'A', 'B', 'B', 'B', 'A', 'A', 'A'
]);
assert.ok(Array.from(calculate({ pattern: 'solid', columns: 12, rows: 12 }).blockColors).every((value) => value === 'A'));
assert.equal(calculate({ columns: 12, rows: 12 }).blockColors.length, 144);

// Independent geometry reference across grid sizes, patterns and zero/nonzero strips.
let referencePlans = 0;
for (const units of ['in', 'cm']) {
  const blockSize = units === 'in' ? 7.25 : 20;
  for (const sashing of [0, units === 'in' ? 1.5 : 2]) {
    for (const border of [0, units === 'in' ? 4 : 5]) {
      for (const pattern of ['checkerboard', 'alternate-rows', 'solid']) {
        for (let columns = 1; columns <= 12; columns += 1) {
          for (let rows = 1; rows <= 12; rows += 1) {
            const result = calculate({ columns, rows, blockSize, sashing, border, units, pattern });
            const interiorWidth = columns * blockSize + (columns - 1) * sashing;
            const interiorHeight = rows * blockSize + (rows - 1) * sashing;
            near(result.interiorWidth, interiorWidth, `${units}/${columns}/${rows} interior width`);
            near(result.interiorHeight, interiorHeight, `${units}/${columns}/${rows} interior height`);
            near(result.quiltWidth, interiorWidth + 2 * border, `${units}/${columns}/${rows} quilt width`);
            near(result.quiltHeight, interiorHeight + 2 * border, `${units}/${columns}/${rows} quilt height`);
            assert.equal(result.blockCount, columns * rows);
            assert.equal(result.verticalSashingCount, sashing > 0 ? rows * (columns - 1) : 0);
            assert.equal(result.horizontalSashingCount, sashing > 0 ? rows - 1 : 0);
            assert.equal(result.sideBorderCount, border > 0 ? 2 : 0);
            assert.equal(result.endBorderCount, border > 0 ? 2 : 0);
            const colors = Array.from(result.blockColors);
            const a = colors.filter((value) => value === 'A').length;
            assert.equal(result.colorACount, a);
            assert.equal(result.colorBCount, colors.length - a);
            colors.forEach((value, index) => {
              const row = Math.floor(index / columns);
              const column = index % columns;
              const expected = pattern === 'solid' || (pattern === 'checkerboard' ? (row + column) % 2 === 0 : row % 2 === 0) ? 'A' : 'B';
              assert.equal(value, expected);
            });
            const conversion = units === 'in' ? 2.54 : 1 / 2.54;
            near(result.secondaryWidth, result.quiltWidth * conversion, 'secondary width');
            near(result.secondaryHeight, result.quiltHeight * conversion, 'secondary height');
            referencePlans += 1;
          }
        }
      }
    }
  }
}
assert.equal(referencePlans, 3456);

// Strict validation, including object-prototype keys and numeric notation.
for (const units of ['mm', '', null, '__proto__', 'constructor']) {
  assert.throws(() => calculate({ units }), /Choose inches or centimetres\./);
}
for (const pattern of ['random', '', null, '__proto__', 'constructor']) {
  assert.throws(() => calculate({ pattern }), /Choose a supported block color pattern\./);
}
for (const field of ['columns', 'rows']) {
  for (const value of [null, '', '   ']) assert.throws(() => calculate({ [field]: value }), new RegExp(`${field === 'columns' ? 'Columns' : 'Rows'} is required\.`));
  for (const value of [0, -1, 1.2, '1.0', '1e2', '+4', '4 blocks', 'NaN', Infinity, 13, '9007199254740992']) {
    assert.throws(() => calculate({ [field]: value }), /must be a whole number from 1 to 12\./);
  }
}
for (const field of ['blockSize', 'sashing', 'border']) {
  for (const value of [null, '', '   ']) assert.throws(() => calculate({ [field]: value }), /is required\./);
  for (const value of [-1, '1e2', '+4', '4in', 'NaN', Infinity]) assert.throws(() => calculate({ [field]: value }), /must be a number\./);
}
assert.throws(() => calculate({ blockSize: 0 }), /Finished block size must be from 1 to 40 in\./);
assert.throws(() => calculate({ units: 'cm', blockSize: 1 }), /Finished block size must be from 2 to 100 cm\./);
assert.throws(() => calculate({ sashing: 12.01 }), /Sashing width must be from 0 to 12 in\./);
assert.throws(() => calculate({ border: 24.01 }), /Border width must be from 0 to 24 in\./);
for (const field of ['colorA', 'colorB', 'colorSashing', 'colorBorder']) {
  for (const value of ['', 'red', '#fff', '#12345g', null]) assert.throws(() => calculate({ [field]: value }), /must be a six-digit hex color/);
}
assert.equal(calculate({ columns: '0005', colorA: '#aBcDeF' }).columns, 5);
assert.equal(calculate({ colorA: '#aBcDeF' }).colors.A, '#ABCDEF');
assert.equal(C.number(-0), '0');
assert.equal(C.number(12.3400), '12.34');

// Replay every canonical catalog case.
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.calculate(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') near(result[key], expected, `${testCase.name}: ${key}`);
    else assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
}

console.log(`quilt-block-layout-planner: all checks passed (${record.testCases.length} catalog cases, ${referencePlans} independent reference plans)`);
