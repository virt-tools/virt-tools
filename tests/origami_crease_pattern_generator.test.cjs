/* Regression checks for the origami crease pattern generator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/origami-crease-pattern-generator/index.html'), 'utf8');
const startMarker = '/* origami-crease-core:start */';
const endMarker = '/* origami-crease-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'origami crease core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = OrigamiCreaseCore;', sandbox);
const C = sandbox.module.exports;

const base = { width: '200', height: '200', columns: '8', rows: '8', diagonals: 'both', majorEvery: '4' };
const make = (overrides = {}) => C.generate({ ...base, ...overrides });
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.00001, `${label}: ${actual} != ${expected}`);

const standard = make();
assert.equal(standard.width, 200);
assert.equal(standard.height, 200);
assert.equal(standard.columns, 8);
assert.equal(standard.rows, 8);
assert.equal(standard.cellWidth, 25);
assert.equal(standard.cellHeight, 25);
assert.equal(standard.cells, 64);
assert.equal(standard.vertical.length, 7);
assert.equal(standard.horizontal.length, 7);
assert.equal(standard.gridLineCount, 14);
assert.equal(standard.diagonalLines.length, 128);
assert.equal(standard.diagonalCount, 128);
assert.equal(standard.majorLineCount, 2);
assert.deepEqual(Array.from(standard.vertical, (line) => line.x), [25, 50, 75, 100, 125, 150, 175]);
assert.deepEqual(Array.from(standard.horizontal, (line) => line.y), [25, 50, 75, 100, 125, 150, 175]);
assert.equal(standard.vertical[3].major, true);
assert.equal(standard.horizontal[3].major, true);
assert.equal(standard.vertical.filter((line) => line.major).length, 1);
assert.deepEqual({ ...standard.diagonalLines[0] }, { x1: 0, y1: 0, x2: 25, y2: 25, direction: 'falling' });
assert.deepEqual({ ...standard.diagonalLines[1] }, { x1: 25, y1: 0, x2: 0, y2: 25, direction: 'rising' });
assert.equal(C.summary(standard), '200 × 200 mm · 8 × 8 grid · 64 cells · 14 grid lines · 128 diagonals · major lines every 4 cells');

const rectangular = make({ width: '180', height: '120', columns: '6', rows: '4', diagonals: 'alternating', majorEvery: '2' });
assert.equal(rectangular.cellWidth, 30);
assert.equal(rectangular.cellHeight, 30);
assert.equal(rectangular.cells, 24);
assert.equal(rectangular.gridLineCount, 8);
assert.equal(rectangular.diagonalCount, 24);
assert.equal(rectangular.majorLineCount, 3);
assert.deepEqual(Array.from(rectangular.vertical, (line) => line.major), [false, true, false, true, false]);
assert.deepEqual(Array.from(rectangular.horizontal, (line) => line.major), [false, true, false]);
assert.equal(rectangular.diagonalLines[0].direction, 'falling');
assert.equal(rectangular.diagonalLines[1].direction, 'rising');
assert.equal(rectangular.diagonalLines[6].direction, 'rising');

for (const [mode, expected] of [['none', 0], ['rising', 64], ['falling', 64], ['both', 128], ['alternating', 64]]) {
  const result = make({ diagonals: mode });
  assert.equal(result.diagonalCount, expected, mode);
  assert.equal(result.diagonalLines.length, expected, mode);
}
const one = make({ width: '50', height: '50', columns: '1', rows: '1', diagonals: 'both', majorEvery: '0' });
assert.equal(one.cells, 1);
assert.equal(one.gridLineCount, 0);
assert.equal(one.majorLineCount, 0);
assert.equal(one.diagonalCount, 2);
assert.equal(C.summary(one), '50 × 50 mm · 1 × 1 grid · 1 cell · 0 grid lines · 2 diagonals');
const maximum = make({ width: '500', height: '500', columns: '32', rows: '32', diagonals: 'both', majorEvery: '16' });
assert.equal(maximum.cells, 1024);
assert.equal(maximum.gridLineCount, 62);
assert.equal(maximum.diagonalCount, 2048);
assert.equal(maximum.majorLineCount, 2);
for (const line of [...maximum.vertical, ...maximum.horizontal, ...maximum.diagonalLines]) {
  for (const key of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) {
    if (key in line) assert.ok(line[key] >= 0 && line[key] <= 500, `${key} outside paper`);
  }
}

const svg = C.svgText(rectangular);
assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="180mm" height="120mm" viewBox="0 0 180 120"'));
assert.ok(svg.includes('<title>Origami crease pattern, 180 × 120 mm</title>'));
assert.ok(svg.includes('class="grid"'));
assert.ok(svg.includes('class="major"'));
assert.ok(svg.includes('class="diagonal"'));
assert.ok(svg.includes('M30 0V120'));
assert.ok(svg.includes('M0 30H180'));
assert.ok(svg.includes('M0 0L30 30'));
assert.ok(svg.includes('M60 0L30 30'));
assert.ok(svg.endsWith('</svg>'));
assert.ok(!/<script|on\w+=|(?:href|src)=/i.test(svg));
assert.ok(C.svgText(make({ diagonals: 'none' })).includes('class="diagonal" d=""'));

const invalid = [
  [{ width: '' }, 'Paper width must be a number from 50 to 500 mm.'],
  [{ width: '49.9' }, 'Paper width must be a number from 50 to 500 mm.'],
  [{ width: '500.1' }, 'Paper width must be a number from 50 to 500 mm.'],
  [{ width: 'wide' }, 'Paper width must be a number from 50 to 500 mm.'],
  [{ height: null }, 'Paper height must be a number from 50 to 500 mm.'],
  [{ height: '0' }, 'Paper height must be a number from 50 to 500 mm.'],
  [{ columns: '' }, 'Columns must be a whole number from 1 to 32.'],
  [{ columns: '2.5' }, 'Columns must be a whole number from 1 to 32.'],
  [{ columns: '0' }, 'Columns must be a whole number from 1 to 32.'],
  [{ columns: '33' }, 'Columns must be a whole number from 1 to 32.'],
  [{ rows: '1e2' }, 'Rows must be a whole number from 1 to 32.'],
  [{ rows: '0' }, 'Rows must be a whole number from 1 to 32.'],
  [{ diagonals: 'random' }, 'Choose a supported diagonal pattern.'],
  [{ majorEvery: '-1' }, 'Major line interval must be a whole number from 0 to 16.'],
  [{ majorEvery: '17' }, 'Major line interval must be a whole number from 0 to 16.'],
  [{ majorEvery: '2.5' }, 'Major line interval must be a whole number from 0 to 16.']
];
for (const [override, message] of invalid) {
  assert.throws(() => make(override), (error) => error.message === message, message);
}
const decimal = make({ width: '200.25', height: '150.5', columns: '5', rows: '7', majorEvery: '0' });
close(decimal.cellWidth, 40.05, 'decimal cell width');
close(decimal.cellHeight, 21.5, 'decimal cell height');
assert.equal(decimal.majorLineCount, 0);
assert.equal(C.summary(decimal).includes('major lines'), false);

// Replay every canonical catalog case against the same public core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'origami-crease-pattern-generator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 15, 'catalog has generation and validation cases');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.generate(testCase.input), (error) => error.message === testCase.expected.error, testCase.name);
    continue;
  }
  const result = C.generate(testCase.input);
  const svgText = C.svgText(result);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (key === 'summary') assert.equal(C.summary(result), expected, testCase.name);
    else if (key === 'svgIncludes') for (const value of expected) assert.ok(svgText.includes(value), `${testCase.name}: ${value}`);
    else assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
}

console.log(`origami-crease-pattern-generator: all checks passed (${record.testCases.length} catalog cases)`);
