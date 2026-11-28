/* Lawn mowing height: replays every catalog case, checks the pass arithmetic against
   the one-third rule worked by hand, and pins the refusals, determinism and the
   offline page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'lawn-mowing-height-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* mow-plan-core:start */';
const endMarker = '/* mow-plan-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|navigator\.|fetch\(|localStorage|XMLHttpRequest/.test(core),
  'the core stays free of DOM, storage and network access');

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MowPlanCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(catalog.tools.length, 2528, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2267, 'public tools');
assert.equal(entry.category, 'Home & Garden', 'category');
assert.equal(entry.risk, 'low', 'risk');
assert.ok(entry.sources.length >= 3, 'the one-third rule is cited');
assert.ok(entry.testCases.length >= 30, `expected at least 30 cases, found ${entry.testCases.length}`);
assert.ok(entry.testCases.some((testCase) => testCase.kind === 'validation'), 'refusals are pinned');
assert.ok(entry.testCases.some((testCase) => testCase.kind === 'golden'), 'goldens are pinned');

const close = (actual, expected, message) => {
  assert.ok(Number.isFinite(actual), `${message}: not a finite number`);
  const tolerance = Math.max(1e-9, Math.abs(expected) * 1e-9);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
};

// ---- Catalog cases: every golden and every refusal.
for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(() => C.compute(testCase.input), (error) => error.message === testCase.expected.error,
      label);
    continue;
  }
  const result = C.compute(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'boolean') {
      assert.equal(result[key], value, `${label}: ${key}`);
    } else {
      close(result[key], value, `${label}: ${key}`);
    }
  }
}

// ---- The pass count follows the smallest n with (2/3)^n * current <= target.
const passes = (current, target, unit = 'in') => C.compute({ current, target, unit }).passes;
assert.equal(passes('4.5', '3'), 1, 'exactly one third is one pass');
assert.equal(passes('4.49', '3'), 1, 'just under a third is still one pass');
assert.equal(passes('4.51', '3'), 2, 'just over a third needs a second pass');
assert.equal(passes('6', '3'), 2, 'half the blade takes two passes');
assert.equal(passes('8', '2.5'), 3, 'a two-thirds reduction takes three passes');
assert.equal(passes('12', '2'), 5, 'a sixfold reduction takes five passes');
assert.equal(passes('24', '0.5'), 10, 'the largest ratio allowed takes ten passes');
assert.equal(passes('3', '3'), 0, 'no cut at the target');
assert.equal(passes('2.5', '3'), 0, 'a lawn below target is left alone');

// The definition, re-derived independently for the worked examples.
const six = C.compute({ current: '6', target: '3', unit: 'in' });
assert.equal(six.steps.length, 2, 'two steps reported');
close(six.steps[0].after, 4, 'first pass stops at two-thirds of six');
close(six.steps[0].depth, 2, 'first pass removes two inches');
close(six.steps[0].percent, 100 / 3, 'first pass removes a third');
close(six.steps[1].after, 3, 'second pass lands on the target');
close(six.steps[1].depth, 1, 'second pass removes one inch');
close(six.steps[1].percent, 25, 'second pass removes a quarter of the four-inch height');
close(six.singleCutPercent, 50, 'one cut would remove half the blade');
close(six.maxStartForOnePass, 4.5, 'the tallest lawn a single cut can bring to three inches');
close(six.deepestRemovalPercent, 100 / 3, 'no pass exceeds one third');

// Every pass in every catalog golden respects the one-third rule, and the last lands on target.
for (const testCase of entry.testCases) {
  if (testCase.expected.error || !testCase.expected.needsCut) continue;
  const result = C.compute(testCase.input);
  assert.equal(result.steps.length, result.passes, `${testCase.name}: one step per pass`);
  let height = result.current;
  for (const step of result.steps) {
    close(step.before, height, `${testCase.name}: steps chain`);
    assert.ok(step.percent <= 100 / 3 + 1e-9, `${testCase.name}: a pass removes more than a third`);
    assert.ok(step.after < step.before, `${testCase.name}: a pass must shorten the grass`);
    height = step.after;
  }
  close(height, result.target, `${testCase.name}: the plan lands on the target`);
  close(result.deepestRemovalPercent, Math.max(...result.steps.map((step) => step.percent)),
    `${testCase.name}: deepest removal`);
}

// ---- The same ratios in centimeters give the same plan.
const inches = C.compute({ current: '6', target: '3', unit: 'in' });
const metric = C.compute({ current: '15.24', target: '7.62', unit: 'cm' });
assert.equal(metric.passes, inches.passes, 'units do not change the pass count');
for (let i = 0; i < inches.steps.length; i++) {
  close(metric.steps[i].percent, inches.steps[i].percent, 'unit-free percentages');
  close(metric.steps[i].depth, inches.steps[i].depth * 2.54, 'depths scale by 2.54');
}
assert.equal(metric.symbol, 'cm', 'the result reports its unit');

// ---- Accepted edges and parsing.
assert.ok(Number.isFinite(C.compute({ current: '0.5', target: '0.5', unit: 'in' }).passes),
  'the smallest height is accepted');
assert.ok(Number.isFinite(C.compute({ current: '61', target: '1.3', unit: 'cm' }).passes),
  'the metric bounds are accepted');
close(C.compute({ current: ' 6 ', target: ' 3 ', unit: ' in ' }).singleCutPercent, 50,
  'surrounding spaces are ignored');
close(C.compute({ current: '6,5', target: '3', unit: 'in' }).current, 6.5, 'a decimal comma is read');
close(C.compute({ current: '6,5', target: '3', unit: 'in' }).singleCutPercent, 53.84615384615385,
  'a decimal comma gives the decimal value');

// ---- Refusals beyond the catalog cases.
assert.throws(() => C.compute({ current: '6', target: '3' }), /Choose inches or centimeters/,
  'a missing unit is refused');
assert.throws(() => C.compute({ current: '  ', target: '3', unit: 'in' }), /Enter the height now/,
  'a blank current height is refused');
assert.throws(() => C.compute({ current: '6', target: '0.4', unit: 'in' }),
  /target mowing height from 0.5 to 24 in/, 'a target below the range is refused');
assert.throws(() => C.compute({ current: '6', target: '3', unit: 'inches' }),
  /Choose inches or centimeters/, 'long unit names are refused');
assert.throws(() => C.compute(null), /Choose inches or centimeters/, 'missing input is refused');

// ---- Determinism: the same input gives identical output.
const once = JSON.stringify(C.compute({ current: '8', target: '2.5', unit: 'in' }));
const twice = JSON.stringify(C.compute({ current: '8', target: '2.5', unit: 'in' }));
assert.equal(once, twice, 'deterministic result');

// ---- Page contract: one self-contained page, shared shell, no remote resources.
assert.ok(/<html lang="en">/.test(html), 'language declared');
assert.ok(html.includes('name="viewport"'), 'viewport declared');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('<div id="site-header"></div>'), 'shared header mount');
assert.ok(html.includes('/assets/app.js'), 'shared app script');
assert.ok(/<main[\s>]/.test(html), 'main landmark');
assert.ok(/<h1[^>]*>Lawn Mowing Height Calculator<\/h1>/.test(html), 'page heading');
assert.ok(!/<script[^>]+src="(?:https?:)?\/\//.test(html), 'no remote scripts');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage/.test(html.slice(html.indexOf('<body>'))),
  'no network or storage in the page');
assert.ok(!/<form[^>]+action=/.test(html), 'the form does not post anywhere');
for (const id of ['current', 'target', 'unit']) {
  assert.ok(html.includes(`<label for="${id}"`), `label for ${id}`);
  assert.ok(html.includes(`id="${id}"`), `control ${id}`);
}
assert.ok(html.includes('role="alert"'), 'error region is announced');
assert.ok(html.includes('aria-live="polite"'), 'result region is announced');
assert.ok(html.includes('@media (max-width:360px)'), 'small-screen rule present');

console.log(`lawn mowing height: ${entry.testCases.length} catalog cases and the definition checks passed`);
