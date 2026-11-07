/* Regression checks for the friendship bracelet pattern core and catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/friendship-bracelet-pattern/index.html'), 'utf8');
const start = html.indexOf('/* friendship-bracelet-core:start */');
const end = html.indexOf('/* friendship-bracelet-core:end */');
assert.ok(start > -1 && end > start, 'friendship bracelet core markers missing');
const core = html.slice(start, end + '/* friendship-bracelet-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = FriendshipBraceletCore;', sandbox);
const C = sandbox.module.exports;

const base = { pairs: '4', rows: '16' };
const plan = (overrides = {}) => C.generate({ ...base, ...overrides });
const standard = plan();
assert.equal(standard.strands, 8);
assert.equal(standard.knotsPerRow, 7);
assert.equal(standard.totalKnots, 112);
assert.equal(standard.repeatRows, 4);
assert.equal(standard.threadSetup, 'A B C D D C B A');
assert.equal(standard.colorSequence, 'A → B → C → D');
assert.equal(standard.rows[0].label, 'A');
assert.equal(standard.rows[3].label, 'D');
assert.equal(standard.rows[4].label, 'A');
assert.equal(standard.rows[15].label, 'D');
assert.equal(standard.rows[0].leftKnots, 3);
assert.equal(standard.rows[0].rightKnots, 3);
assert.equal(standard.rows[0].centerKnots, 1);
assert.deepEqual(Array.from(standard.colorTotals, (item) => item.knots), [28, 28, 28, 28]);
const text = C.guide(standard);
assert.match(text, /Starting order, left to right: A B C D D C B A/);
assert.match(text, /Rows: 16 · Knots: 112/);
assert.match(text, /Row 1 — A #E76F51: 3 forward knots on left; 3 backward knots on right; 1 center knot\./);
assert.match(text, /Row 16 — D #2A9D8F/);

const minimum = plan({ pairs: '2', rows: '4' });
assert.equal(minimum.strands, 4);
assert.equal(minimum.knotsPerRow, 3);
assert.equal(minimum.totalKnots, 12);
assert.equal(minimum.threadSetup, 'A B B A');
assert.deepEqual(Array.from(minimum.rows, (row) => row.label), ['A', 'B', 'A', 'B']);
assert.match(C.guide(minimum), /1 forward knot on left; 1 backward knot on right/);

const maximum = plan({ pairs: '6', rows: '40' });
assert.equal(maximum.strands, 12);
assert.equal(maximum.knotsPerRow, 11);
assert.equal(maximum.totalKnots, 440);
assert.equal(maximum.repeatRows, 6);
assert.equal(maximum.threadSetup, 'A B C D E F F E D C B A');
assert.equal(maximum.lastColor, '#2A9D8F');
assert.deepEqual(Array.from(maximum.colorTotals, (item) => item.knots), [77, 77, 77, 77, 66, 66]);

const custom = plan({
  pairs: '3', rows: '5', colors: ['#aabbcc', '#DdEeFf', '#012345']
});
assert.deepEqual(Array.from(custom.colors), ['#AABBCC', '#DDEEFF', '#012345']);
assert.equal(custom.firstColor, '#AABBCC');
assert.equal(custom.lastColor, '#DDEEFF');
assert.deepEqual(Array.from(custom.colorTotals, (item) => item.knots), [10, 10, 5]);

// Independent enumeration checks counts, mirrored setup and row cycling.
for (let pairs = 2; pairs <= 6; pairs++) {
  for (let rows = 4; rows <= 40; rows++) {
    const result = plan({ pairs: String(pairs), rows: String(rows) });
    const expectedSetup = [];
    for (let index = 0; index < pairs; index++) expectedSetup.push(String.fromCharCode(65 + index));
    for (let index = pairs - 1; index >= 0; index--) expectedSetup.push(String.fromCharCode(65 + index));
    assert.equal(result.strands, pairs * 2);
    assert.equal(result.knotsPerRow, pairs * 2 - 1);
    assert.equal(result.totalKnots, rows * (pairs * 2 - 1));
    assert.equal(result.threadSetup, expectedSetup.join(' '));
    assert.equal(result.rows.length, rows);
    let countedKnots = 0;
    result.rows.forEach((row, index) => {
      const expectedIndex = index % pairs;
      assert.equal(row.number, index + 1);
      assert.equal(row.colorIndex, expectedIndex);
      assert.equal(row.label, String.fromCharCode(65 + expectedIndex));
      assert.equal(row.color, result.colors[expectedIndex]);
      countedKnots += row.leftKnots + row.rightKnots + row.centerKnots;
    });
    assert.equal(countedKnots, result.totalKnots);
    assert.equal(result.colorTotals.reduce((sum, item) => sum + item.knots, 0), result.totalKnots);
  }
}

assert.throws(() => plan({ pairs: '' }), /Thread pairs is required\./);
assert.throws(() => plan({ rows: '' }), /Rows is required\./);
assert.throws(() => plan({ pairs: '2.5' }), /Thread pairs must be a whole number/);
assert.throws(() => plan({ pairs: '1' }), /Thread pairs must be a whole number/);
assert.throws(() => plan({ pairs: '7' }), /Thread pairs must be a whole number/);
assert.throws(() => plan({ rows: '4e1' }), /Rows must be a whole number/);
assert.throws(() => plan({ rows: '3' }), /Rows must be a whole number/);
assert.throws(() => plan({ rows: '41' }), /Rows must be a whole number/);
assert.throws(() => plan({ colors: [] }), /Color A must be a six-digit hex color/);
assert.throws(() => plan({ colors: ['red'] }), /Color A must be a six-digit hex color/);
assert.throws(() => plan({ colors: {} }), /Colors must be supplied as a list\./);

// Replay every canonical catalog case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'friendship-bracelet-pattern');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 15, 'catalog has the full test case set');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.generate(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  const result = C.generate(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.equal(result[key], value, `${testCase.name} ${key}`);
  }
}

console.log(`friendship-bracelet-pattern: all checks passed (${record.testCases.length} catalog cases, 185 enumerated patterns)`);
