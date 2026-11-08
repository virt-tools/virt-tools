/* Regression checks for the pleat calculator core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/pleat-calculator/index.html'), 'utf8');
const start = html.indexOf('/* pleat-core:start */');
const end = html.indexOf('/* pleat-core:end */');
assert.ok(start > -1 && end > start, 'pleat core markers missing');
const core = html.slice(start, end + '/* pleat-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PleatCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const plan = (options) => C.plan(Object.assign({ unit: 'in', type: 'knife' }, options));

// Twelve knife pleats one inch deep with two inches between them on a 44 in bolt.
const standard = plan({});
assert.equal(standard.type, 'knife');
assert.equal(standard.pleats, 12);
near(standard.perPleat, 4, 'default fabric per pleat');
near(standard.perVisible, 3, 'default visible per pleat');
near(standard.fabric, 48, 'default fabric');
near(standard.finished, 36, 'default pleated width');
near(standard.hidden, 12, 'default folded away');
near(standard.fullness, 1.33, 'default fullness');
assert.equal(standard.strips, 2);
near(standard.perStrip, 24, 'default per strip');
near(standard.converted, 121.92, 'default conversion');

// A box pleat folds to both sides, so it eats twice what a knife pleat eats.
const box = plan({ type: 'box' });
const inverted = plan({ type: 'inverted' });
near(box.perPleat, 2 + 4 * 1, 'box fabric per pleat');
near(box.perVisible, 2 + 2 * 1, 'box visible per pleat');
near(box.fabric, 72, 'box fabric');
near(box.finished, 48, 'box pleated width');
near(box.hidden, 24, 'box folded away');
near(box.fullness, 1.5, 'box fullness');
near(inverted.perPleat, box.perPleat, 'inverted eats what box eats');
near(inverted.perVisible, box.perVisible, 'inverted shows what box shows');

// The gap between pleats is flat fabric and is never counted twice.
const touching = plan({ pleats: '10', depth: '1.5', spacing: '0' });
near(touching.perVisible, 1.5, 'spacing free visible width');
near(touching.finished, 15, 'spacing free pleated width');
near(touching.hidden, 15, 'spacing free folded away');
assert.equal(touching.strips, 1);

// Metric input stays metric, and the conversion uses 2.54 cm to the inch.
const metric = plan({ unit: 'cm', pleats: '20', depth: '2.5', spacing: '5', width: '150' });
near(metric.perPleat, 10, 'metric fabric per pleat');
near(metric.fabric, 200, 'metric fabric');
near(metric.finished, 150, 'metric pleated width');
near(metric.converted, 78.74, 'metric conversion');
assert.equal(metric.strips, 2);

// Whole pleats only, and an unsupported type is refused rather than guessed.
assert.throws(() => plan({ pleats: '2.5' }), /Pleat count must be a whole number from 1 to 200\./);
assert.throws(() => plan({ type: 'accordion' }), /Choose knife, box or inverted pleats\./);
assert.throws(() => plan({ unit: 'yd' }), /Choose inches or centimetres\./);

// Replay every canonical catalog case against the core, then assert the plan invariants.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'pleat-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.risk, 'low');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 30, 'catalog has the full test case set');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let replayed = 0;
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => plan(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  const result = plan(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') near(result[key], value, `${testCase.name} ${key}`);
    else assert.equal(result[key], value, `${testCase.name} ${key}`);
  }
  replayed += 1;
  // Invariants that must hold for every accepted plan, independent of the oracle.
  near(result.fabric, result.pleats * result.perPleat, `${testCase.name} fabric = pleats x perPleat`, 1e-6);
  near(result.finished, result.pleats * result.perVisible, `${testCase.name} width = pleats x perVisible`, 1e-6);
  near(result.hidden, result.fabric - result.finished, `${testCase.name} hidden = fabric - width`, 1e-6);
  near(result.fullness, result.fabric / result.finished, `${testCase.name} fullness = fabric / width`, 0.01);
  assert.ok(result.fullness > 1, `${testCase.name} pleats must consume more fabric than they show`);
  assert.ok(result.hidden > 0, `${testCase.name} pleats must fold fabric away`);
  assert.ok(result.strips >= 1, `${testCase.name} needs at least one strip`);
  assert.ok(result.strips * result.width >= result.fabric - 1e-6, `${testCase.name} strips must cover the fabric`);
  assert.ok((result.strips - 1) * result.width < result.fabric + 1e-6, `${testCase.name} strips must be minimal`);
  near(result.perStrip, result.fabric / result.strips, `${testCase.name} perStrip = fabric / strips`, 1e-3);
  if (result.type === 'knife') {
    near(result.perPleat, result.spacing + 2 * result.depth, `${testCase.name} knife consumes two depths`, 1e-6);
  } else {
    near(result.perPleat, result.spacing + 4 * result.depth, `${testCase.name} box consumes four depths`, 1e-6);
  }
  near(result.perVisible, result.perPleat - result.depth * (result.type === 'knife' ? 1 : 2), `${testCase.name} visible width`, 1e-6);
}
assert.ok(replayed >= 14, 'at least fourteen accepted cases replayed');

console.log('pleat-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
