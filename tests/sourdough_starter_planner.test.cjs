/* Regression checks for the sourdough starter planner core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/sourdough-starter-planner/index.html'), 'utf8');
const start = html.indexOf('/* sourdough-core:start */');
const end = html.indexOf('/* sourdough-core:end */');
assert.ok(start > -1 && end > start, 'sourdough core markers missing');
const core = html.slice(start, end + '/* sourdough-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SourdoughCore;', sandbox);
const C = sandbox.module.exports;
const plan = (input) => C.plan(input);

// The documented default: 300 g of 100% levain from a 100% seed at a 1:5 feed.
const standard = plan({ target: 300, hydration: 100, seedHydration: 100, parts: 5, onHand: 150 });
assert.equal(standard.seed, 27.27);
assert.equal(standard.flour, 136.36);
assert.equal(standard.water, 136.36);
assert.equal(standard.seedFlour, 13.64);
assert.equal(standard.seedWater, 13.64);
assert.equal(standard.totalFlour, 150);
assert.equal(standard.totalWater, 150);
assert.equal(standard.finalHydration, 100);
assert.equal(standard.ratioFlour, 5);
assert.equal(standard.ratioWater, 5);
assert.equal(standard.seedShare, 9.09);
assert.equal(standard.leftover, 122.73);

// Mass balance and hydration hold for every golden case in the catalog.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'sourdough-starter-planner');
assert.ok(record, 'catalog entry present');
assert.equal(record.name, 'Sourdough Starter Planner');
assert.equal(record.category, 'Food');
assert.equal(record.risk, 'low');
assert.equal(record.listed, true);
assert.equal(record.testCases.length, 32);
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') continue;
  const result = plan(testCase.input);
  assert.ok(Math.abs(result.seed + result.flour + result.water - result.target) < 0.02, `${testCase.name}: parts do not fill the target`);
  assert.ok(Math.abs(result.finalHydration - result.hydration) < 0.02, `${testCase.name}: hydration drifts`);
  assert.ok(result.water > 0, `${testCase.name}: water must be positive`);
}

// A seed of the same hydration makes the added water follow the flour directly.
const equalHydration = plan({ target: 640, hydration: 120, seedHydration: 120, parts: 4 });
assert.ok(Math.abs(equalHydration.water - equalHydration.flour * 1.2) < 0.02, 'water should be 120% of flour');
assert.equal(equalHydration.ratioWater, 4.8);

// A drier seed needs more added water than the flour; a wetter seed needs less.
const drySeed = plan({ target: 300, hydration: 100, seedHydration: 50, parts: 5 });
const wetSeed = plan({ target: 300, hydration: 100, seedHydration: 300, parts: 5 });
assert.ok(drySeed.water > drySeed.flour, 'a drier seed should need extra water');
assert.ok(wetSeed.water < wetSeed.flour, 'a wetter seed should need less water');
assert.equal(drySeed.finalHydration, 100);
assert.equal(wetSeed.finalHydration, 100);

// No starter on hand reports null, and an empty jar is refused rather than negative.
assert.equal(plan({ target: 300, hydration: 100, seedHydration: 100, parts: 5 }).leftover, null);
assert.throws(() => plan({ target: 100, hydration: 100, seedHydration: 100, parts: 5, onHand: 0 }),
  /You have 0 g of starter on hand but this plan needs 9\.09 g of seed/);

// A seed wetter than a dry target, at a small flour part, has no water to add.
assert.throws(() => plan({ target: 300, hydration: 50, seedHydration: 300, parts: 0.5 }),
  /the seed already carries more water than the target leaves room for/);

// Replay every canonical catalog test case against the core.
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => plan(testCase.input), new RegExp(escape(testCase.expectedError)), testCase.name);
    continue;
  }
  const result = plan(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') {
      assert.ok(Math.abs(result[key] - value) < 0.005, `${testCase.name} ${key}: ${result[key]} != ${value}`);
    } else {
      assert.equal(result[key], value, `${testCase.name} ${key}`);
    }
  }
}

console.log('sourdough-starter-planner: all checks passed (' + record.testCases.length + ' catalog cases)');
