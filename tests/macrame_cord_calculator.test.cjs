/* Regression checks for the macrame cord core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/macrame-cord-calculator/index.html'), 'utf8');
const start = html.indexOf('/* macrame-cord-core:start */');
const end = html.indexOf('/* macrame-cord-core:end */');
assert.ok(start > -1 && end > start, 'macrame cord core markers missing');
const core = html.slice(start, end + '/* macrame-cord-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MacrameCordCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const calculate = (options) => C.calculate(options);

// Default folded wall hanging: 24 working ends, 5.15 m per cut, 67.98 m to buy.
const standard = calculate({});
assert.equal(standard.cords, 12);
assert.equal(standard.strandsPerCord, 2);
assert.equal(standard.workingEnds, 24);
assert.equal(standard.mountingLoops, 12);
near(standard.knottingPerEndCm, 240, 'default knotting length');
near(standard.workingLengthPerEndCm, 255, 'default working length');
near(standard.cutLengthCm, 515, 'default cut centimetres');
near(standard.cutLengthM, 5.15, 'default cut metres');
near(standard.baseTotalM, 61.8, 'default base total');
near(standard.spareM, 6.18, 'default spare');
near(standard.purchaseTotalM, 67.98, 'default purchase total');
near(standard.purchaseTotalYd, 67.98 / 0.9144, 'default yards');
assert.equal(standard.rollCount, 1);
near(standard.leftoverM, 32.02, 'default leftover');

// Straight mounting uses one working length per cut rather than doubling it.
const straight = calculate({ mounting: 'straight' });
assert.equal(straight.strandsPerCord, 1);
assert.equal(straight.workingEnds, 12);
assert.equal(straight.mountingLoops, 0);
near(straight.cutLengthCm, 260, 'straight cut');
near(straight.baseTotalM, 31.2, 'straight base total');
near(straight.purchaseTotalM, 34.32, 'straight purchase total');
near(straight.leftoverM, 65.68, 'straight leftover');

// An exact multiple of the roll length does not round up to an extra roll.
const exactRoll = calculate({
  finishedLength: '50', knotFactor: '2', fringe: '0', cords: '10',
  mounting: 'straight', mountAllowance: '0', wastePercent: '0', rollLength: '10'
});
near(exactRoll.cutLengthM, 1, 'exact-roll cut');
near(exactRoll.purchaseTotalM, 10, 'exact-roll purchase');
assert.equal(exactRoll.rollCount, 1);
near(exactRoll.leftoverM, 0, 'exact-roll leftover');

// A partial second roll is rounded up and the spare margin remains part of leftovers.
const twoRolls = calculate({
  finishedLength: '100', knotFactor: '3', fringe: '20', cords: '1',
  mounting: 'folded', mountAllowance: '10', wastePercent: '20', rollLength: '5'
});
near(twoRolls.cutLengthM, 6.5, 'two-roll cut');
near(twoRolls.baseTotalM, 6.5, 'two-roll base');
near(twoRolls.spareM, 1.3, 'two-roll spare');
near(twoRolls.purchaseTotalM, 7.8, 'two-roll purchase');
assert.equal(twoRolls.rollCount, 2);
near(twoRolls.leftoverM, 2.2, 'two-roll leftover');

// Maximum accepted values remain finite and produce a bounded whole-roll result.
const upper = calculate({
  finishedLength: '1000', knotFactor: '12', fringe: '300', cords: '200',
  mounting: 'folded', mountAllowance: '50', wastePercent: '100', rollLength: '10000'
});
near(upper.cutLengthCm, 24650, 'upper cut');
near(upper.baseTotalM, 49300, 'upper base');
near(upper.purchaseTotalM, 98600, 'upper purchase');
assert.equal(upper.workingEnds, 400);
assert.equal(upper.rollCount, 10);
near(upper.leftoverM, 1400, 'upper leftover');

// Independent deterministic reference sweep, including decimals and both mount styles.
for (let i = 0; i < 300; i++) {
  const input = {
    finishedLength: String(1 + (i * 37 % 500) + (i % 4) * 0.25),
    knotFactor: String(1 + (i * 11 % 90) / 10),
    fringe: String((i * 17 % 120) + (i % 3) * 0.5),
    cords: String(1 + (i * 29 % 200)),
    mounting: i % 2 ? 'folded' : 'straight',
    mountAllowance: String((i * 7 % 45) + (i % 5) * 0.25),
    wastePercent: String((i * 13 % 100) + (i % 2) * 0.5),
    rollLength: String(1 + (i * 19 % 250))
  };
  const actual = calculate(input);
  const strands = input.mounting === 'folded' ? 2 : 1;
  const working = Number(input.finishedLength) * Number(input.knotFactor) + Number(input.fringe);
  const cut = working * strands + Number(input.mountAllowance);
  const base = cut * Number(input.cords) / 100;
  const purchase = base * (1 + Number(input.wastePercent) / 100);
  const rolls = Math.ceil(purchase / Number(input.rollLength) - 1e-12);
  near(actual.workingLengthPerEndCm, working, `sweep ${i} working`);
  near(actual.cutLengthCm, cut, `sweep ${i} cut`);
  near(actual.baseTotalM, base, `sweep ${i} base`);
  near(actual.spareM, purchase - base, `sweep ${i} spare`);
  near(actual.purchaseTotalM, purchase, `sweep ${i} purchase`);
  near(actual.purchaseTotalYd, purchase / 0.9144, `sweep ${i} yards`);
  assert.equal(actual.workingEnds, Number(input.cords) * strands, `sweep ${i} ends`);
  assert.equal(actual.rollCount, rolls, `sweep ${i} rolls`);
  near(actual.leftoverM, rolls * Number(input.rollLength) - purchase, `sweep ${i} leftover`);
}

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'macrame-cord-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 14, 'catalog has the full test case set');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => calculate(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  const result = calculate(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') near(result[key], value, `${testCase.name} ${key}`);
    else assert.equal(result[key], value, `${testCase.name} ${key}`);
  }
}

console.log('macrame-cord-calculator: all checks passed (' + record.testCases.length + ' catalog cases, 300 reference cases)');
