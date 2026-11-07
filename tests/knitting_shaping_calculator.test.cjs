/* Regression checks for the knitting shaping calculator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(
  path.join(root, 'frontend/tools/knitting-shaping-calculator/index.html'),
  'utf8'
);
const startMarker = '/* knitting-shaping-core:start */';
const endMarker = '/* knitting-shaping-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'knitting shaping core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = KnittingShapingCore;', sandbox);
const C = sandbox.module.exports;
const base = {current: '60', target: '72', style: 'knit', context: 'row', method: 'M1'};

function verifyGroups(result) {
  const groups = Array.from(result.groups);
  assert.equal(groups.length, result.change);
  if (result.direction === 'none') {
    assert.equal(Array.from(result.segments).length, 0);
    return;
  }
  assert.equal(groups.reduce((sum, group) => sum + group.size, 0), result.current);
  assert.ok(groups.every((group) => group.size === result.minimumGroup || group.size === result.maximumGroup));
  assert.ok(result.maximumGroup - result.minimumGroup <= 1);
  const expanded = Array.from(result.segments).flatMap((segment) => Array(segment.repeat).fill(segment.instruction));
  assert.deepEqual(expanded, groups.map((group) => group.instruction));
}

{
  const result = C.calculate(base);
  verifyGroups(result);
  assert.equal(result.instruction, 'Row: (k5, M1) 12 times. 72 stitches.');
  assert.equal(result.minimumGroup, 5);
  assert.equal(result.maximumGroup, 5);
}

{
  const result = C.calculate({...base, method: 'KFB'});
  verifyGroups(result);
  assert.equal(result.instruction, 'Row: (k4, KFB) 12 times. 72 stitches.');
}

{
  const result = C.calculate({...base, current: '50', target: '58'});
  verifyGroups(result);
  assert.deepEqual(Array.from(result.groups, (group) => group.size), [6, 6, 6, 7, 6, 6, 6, 7]);
  assert.equal(result.instruction, 'Row: (k6, M1) 3 times; k7, M1; (k6, M1) 3 times; k7, M1. 58 stitches.');
}

{
  const result = C.calculate({...base, current: '60', target: '48', method: 'k2tog'});
  verifyGroups(result);
  assert.equal(result.instruction, 'Row: (k3, k2tog) 12 times. 48 stitches.');
}

{
  const result = C.calculate({...base, current: '50', target: '42', style: 'purl', context: 'round', method: 'ssk'});
  verifyGroups(result);
  assert.equal(result.instruction, 'Round: (p4, ssk) 3 times; p5, ssk; (p4, ssk) 3 times; p5, ssk. 42 stitches.');
}

{
  const result = C.calculate({...base, target: '60'});
  verifyGroups(result);
  assert.equal(result.direction, 'none');
  assert.equal(result.instruction, 'Row: k60. 60 stitches.');
}

for (let current = 2; current <= 100; current += 1) {
  for (let target = 1; target <= Math.min(100, current * 2); target += 1) {
    const method = target > current ? 'M1' : 'k2tog';
    if (target < current && target < Math.ceil(current / 2)) continue;
    const result = C.calculate({...base, current: String(current), target: String(target), method});
    verifyGroups(result);
    assert.equal(result.target, target);
  }
}

const invalid = [
  [{current: '1'}, 'Current stitches must be a whole number from 2 to 500.'],
  [{current: '12.5'}, 'Current stitches must be a whole number from 2 to 500.'],
  [{target: '1001'}, 'Target stitches must be a whole number from 1 to 1000.'],
  [{current: '10', target: '21'}, 'This one-row planner supports at most one increase per original stitch; split this change over several rows or rounds.'],
  [{current: '10', target: '4', method: 'k2tog'}, 'This one-row planner cannot decrease below half the current stitch count; split this change over several rows or rounds.'],
  [{method: 'ssk'}, 'Choose M1 or KFB for increases.'],
  [{current: '60', target: '48', method: 'M1'}, 'Choose k2tog or ssk for decreases.'],
  [{style: 'crochet'}, 'Choose knit or purl stitches.'],
  [{context: 'chart'}, 'Choose row or round instructions.']
];
for (const [override, message] of invalid) {
  assert.throws(() => C.calculate({...base, ...override}), (error) => error.message === message);
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'knitting-shaping-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 9, 'catalog has distribution and validation cases');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(
      () => C.calculate(testCase.input),
      (error) => error.message === testCase.expected.error,
      testCase.name
    );
    continue;
  }
  const result = C.calculate(testCase.input);
  verifyGroups(result);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (key === 'groupSizes') assert.deepEqual(Array.from(result.groups, (group) => group.size), expected, testCase.name);
    else assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
}

console.log(`knitting-shaping-calculator: all checks passed (${record.testCases.length} catalog cases plus exhaustive small-count checks)`);
