/* Regression checks for the warm-up ladder core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'warmup-set-planner';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* warmup-core:start */');
const end = html.indexOf('/* warmup-core:end */');
assert.ok(start > -1 && end > start, 'warmup core markers missing');
const core = html.slice(start, end + '/* warmup-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = WarmupSetCore;', sandbox);
const C = sandbox.module.exports;

const DEFAULTS = { unit: 'kg', bar: '20', working: '100', increment: '1.25' };
const run = (overrides) => C.plan(Object.assign({}, DEFAULTS, overrides || {}));
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ': ' + actual + ' differs from ' + expected + ' by more than ' + tolerance);
};
const cents = (value) => Math.round(value * 100);

// The published ladder, not derived from this core.
assert.equal(C.LADDER.map((rung) => rung.pct).join(','), '0,40,60,80,90');
assert.equal(C.LADDER.map((rung) => rung.reps).join(','), '5,5,3,2,1');
assert.equal(C.DEFAULTS.kg.bar, 20);
assert.equal(C.DEFAULTS.kg.increment, 1.25);
assert.equal(C.DEFAULTS.lb.bar, 45);
assert.equal(C.DEFAULTS.lb.increment, 2.5);
assert.equal(C.LIMITS.working, 1000);
assert.equal(C.LIMITS.bar, 100);

// The headline default ladder: 100 kg on a 20 kg bar with 1.25 kg pairs.
const base = run();
close(base.top, 100, 1e-9, 'default top set');
close(base.topPerSide, 40, 1e-9, 'default plate per side');
close(base.step, 2.5, 1e-9, 'default loadable step');
assert.equal(base.exact, true);
assert.equal(base.skipped, 0);
assert.equal(base.totalReps, 16);
assert.equal(JSON.stringify(base.sets.map((s) => [s.pct, s.weight, s.reps, s.perSide])),
  JSON.stringify([
    [0, 20, 5, 0],
    [40, 40, 5, 10],
    [60, 60, 3, 20],
    [80, 80, 2, 30],
    [90, 90, 1, 35],
  ]));

// A 45 lb bar with 225 lb: the 90 percent rung lands between loadable weights.
const pounds = run({ unit: 'lb', bar: '45', working: '225', increment: '2.5' });
close(pounds.step, 5, 1e-9, 'pound step');
close(pounds.sets[4].weight, 205, 1e-9, '90 percent rounds onto the 5 lb grid');
close(pounds.sets[4].ideal, 202.5, 1e-9, '90 percent ideal');
close(pounds.sets[4].delta, 2.5, 1e-9, '90 percent rounding delta');
close(pounds.top, 225, 1e-9, 'pound top set');
assert.equal(pounds.exact, true);

// Rungs are quantised to twice the smallest pair; a working weight that cannot
// be built is reported with its difference.
const odd = run({ working: '101' });
close(odd.top, 100, 1e-9, '101 kg rounds down to 100 kg');
close(odd.topDelta, -1, 1e-9, 'top-set rounding delta');
assert.equal(odd.exact, false);
const fine = run({ increment: '1' });
close(fine.step, 2, 1e-9, '1 kg pairs make a 2 kg step');
close(fine.sets[2].weight, 60, 1e-9, '60 percent on a 2 kg grid');

// Light working weights collapse the ladder instead of repeating a load.
const light = run({ working: '25' });
assert.equal(JSON.stringify(light.sets.map((s) => [s.pct, s.weight, s.reps, s.perSide])),
  JSON.stringify([
    [0, 20, 5, 0],
    [90, 22.5, 1, 1.25],
  ]));
assert.equal(light.skipped, 3);
assert.equal(light.totalReps, 6);
const floor = run({ working: '20.5' });
assert.equal(floor.sets.length, 1);
assert.equal(floor.skipped, 4);
assert.equal(floor.exact, false);

// Structural invariants hold for every catalog golden case: on the grid, above
// the bar, strictly increasing, within half a step of the ideal percentage, and
// never above the rounded working weight.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') continue;
  const input = testCase.input;
  const step = 2 * cents(Number(input.increment));
  const bar = cents(Number(input.bar));
  const working = cents(Number(input.working));
  const result = C.plan(input);
  const label = testCase.name;
  assert.ok(Math.abs(cents(result.top) - working) <= step / 2, label + ': top set within half a step');
  assert.equal((cents(result.top) - bar) % step, 0, label + ': top set on the loadable grid');
  let previous = null;
  for (const set of result.sets) {
    const weight = cents(set.weight);
    assert.equal((weight - bar) % step, 0, label + ': set ' + set.pct + ' on the grid');
    assert.ok(weight >= bar, label + ': set ' + set.pct + ' not below the bar');
    if (previous !== null) assert.ok(weight > previous, label + ': sets strictly increase');
    previous = weight;
    const ideal = set.pct === 0 ? bar : working * set.pct / 100;
    assert.ok(Math.abs(weight - ideal) <= step / 2 + 1e-9, label + ': set ' + set.pct + ' within half a step');
    assert.ok(weight <= cents(result.top), label + ': set ' + set.pct + ' not above the top set');
    close(set.perSide, (set.weight - Number(input.bar)) / 2, 1e-9, label + ': per side weight');
  }
  const reps = result.sets.reduce((total, set) => total + set.reps, 0);
  assert.equal(result.totalReps, reps, label + ': rep total');
  assert.equal(result.sets.length + result.skipped, C.LADDER.length, label + ': rungs accounted for');
}

// The catalog record replays through this core.
assert.equal(catalog.tools.length, 2246, 'catalog total');
assert.equal(record.name, 'Warm-Up Set Planner');
assert.equal(record.category, 'Health');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 28, 'catalog has the full test case set');
assert.ok(record.method.length > 800, 'method documents the model');
assert.ok(record.sources.length >= 4);
for (const name of record.aliases) {
  const clash = catalog.tools.filter((tool) => tool.slug !== slug)
    .some((tool) => tool.name === name || (tool.aliases || []).includes(name));
  assert.equal(clash, false, 'alias is unique: ' + name);
}
let golden = 0;
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    try {
      C.plan(testCase.input);
      assert.fail(testCase.name + ': expected a refusal');
    } catch (error) {
      assert.equal(error.message, testCase.expected.error, testCase.name);
    }
    continue;
  }
  golden += 1;
  const result = C.plan(testCase.input);
  const expected = testCase.expected;
  assert.equal(result.unit, expected.unit, testCase.name + ' unit');
  for (const key of ['top', 'topPerSide', 'topDelta', 'step']) {
    close(result[key], expected[key], 0.01, testCase.name + ' ' + key);
  }
  assert.equal(result.exact, expected.exact, testCase.name + ' exact');
  assert.equal(result.skipped, expected.skipped, testCase.name + ' skipped');
  assert.equal(result.totalReps, expected.totalReps, testCase.name + ' totalReps');
  assert.equal(result.sets.length, expected.sets.length, testCase.name + ' set count');
  expected.sets.forEach((set, index) => {
    assert.equal(result.sets[index].pct, set[0], testCase.name + ' set pct');
    close(result.sets[index].weight, set[1], 0.01, testCase.name + ' set weight');
    assert.equal(result.sets[index].reps, set[2], testCase.name + ' set reps');
    close(result.sets[index].perSide, set[3], 0.01, testCase.name + ' set per side');
  });
}
assert.equal(golden, 14, 'golden case count');

// Refusals carry the page's user-facing wording.
const refuse = (overrides, message) => {
  try {
    run(overrides);
    assert.fail('expected a refusal for ' + JSON.stringify(overrides));
  } catch (error) {
    assert.equal(error.message, message);
  }
};
refuse({ bar: '' }, 'Bar weight is required.');
refuse({ working: '  ' }, 'Working weight is required.');
refuse({ increment: '' }, 'Plate increment is required.');
refuse({ working: '1e2' }, 'Working weight must be a number with at most two decimal places.');
refuse({ bar: '0' }, 'Bar weight must be more than zero.');
refuse({ working: '20' }, 'Working weight must be more than the bar weight.');
refuse({ working: '1001' }, 'Working weight must be 1000 or less.');
refuse({ increment: '0.1' }, 'Plate increment must be from 0.25 to 20.');
refuse({ unit: 'stone' }, 'Choose kilograms or pounds.');

// Page contract: shared chrome, one form, defaults pinned, no storage, no network, no HTML sinks.
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style\.css">/);
assert.equal((html.match(/id="warmup-form"/g) || []).length, 1);
assert.ok(html.includes('aria-live="polite"'));
for (const id of ['in-unit', 'in-bar', 'in-working', 'in-increment']) {
  assert.ok(html.includes('id="' + id + '"'), 'control present: ' + id);
}
assert.match(html, /<option value="kg" selected>/);
assert.match(html, /id="in-bar"[^>]*value="20"/);
assert.match(html, /id="in-working"[^>]*value="100"/);
assert.match(html, /id="in-increment"[^>]*value="1\.25"/);
assert.match(html, /\.actions button\{[^}]*min-height:44px/);
assert.match(html, /\.field input,\.field select\{[^}]*min-height:44px/);
assert.match(html, /<button type="submit">/);
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), 'page stores nothing');
assert.ok(!/https?:\/\//.test(html), 'page references no external URL');
assert.ok(!/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/.test(html), 'page makes no requests');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page uses no HTML sinks');

console.log(slug + ' core: all checks passed (' + record.testCases.length + ' catalog cases, '
  + golden + ' golden, ladder and grid invariants)');
