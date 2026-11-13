/* Regression checks for the barbell plate loading calculator. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'barbell-plate-loading-calculator';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* barbell-core:start */');
const end = html.indexOf('/* barbell-core:end */');
assert.ok(start > -1 && end > start, 'barbell core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + '/* barbell-core:end */'.length) + '\nmodule.exports = BarbellPlates;', sandbox);
const B = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Health');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.icon, '\u{1F3CB}\uFE0F\u200D\u2642\uFE0F');
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 6, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 2, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 400, 'method documented');
assert.equal(catalog.tools.length, 2248, 'catalog total');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');
const myAliases = new Set((entry.aliases || []).map((alias) => alias.toLowerCase()));
assert.ok(new Set(entry.aliases || []).size === (entry.aliases || []).length, 'aliases unique within the entry');
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  for (const alias of tool.aliases || []) {
    assert.ok(!myAliases.has(alias.toLowerCase()), `alias ${alias} already belongs to ${tool.slug}`);
  }
  assert.notEqual(tool.name.toLowerCase(), entry.name.toLowerCase(), `name already used by ${tool.slug}`);
}

const cents = (value) => Math.round(value * 100);
const calc = (input) => B.calc(input);
const failure = (input) => {
  try {
    B.calc(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

function pairCounts(unit, pairs) {
  const counts = {};
  for (const plate of B.PLATE_SETS[unit]) {
    counts[plate] = pairs && pairs[plate] !== undefined ? Number(pairs[plate]) : B.DEFAULT_PAIRS[unit][plate];
  }
  return counts;
}

// Independent enumeration of reachable per-side loads, in hundredths of the unit.
function enumerate(unit, pairs) {
  const counts = pairCounts(unit, pairs);
  let sums = new Set([0]);
  for (const plate of B.PLATE_SETS[unit]) {
    const next = new Set(sums);
    for (const sum of sums) {
      for (let k = 1; k <= counts[plate]; k += 1) next.add(sum + cents(plate) * k);
    }
    sums = next;
  }
  return sums;
}

function parsePlates(text, unit) {
  if (!text || text === 'no plates') return { total: 0, count: 0 };
  const suffix = ' ' + unit;
  assert.ok(text.endsWith(suffix), `plate text ends with the unit: ${text}`);
  const parts = text.slice(0, -suffix.length).split(' + ');
  let total = 0;
  for (const part of parts) {
    assert.match(part, /^\d+(?:\.\d{1,2})?$/, `plate value ${part}`);
    total += cents(Number(part));
  }
  return { total, count: parts.length };
}

function checkComposition(result, unit, pairs, label) {
  if (!result.exact) return;
  const counts = pairCounts(unit, pairs);
  const seen = {};
  for (const { plate, count } of result.plates) {
    assert.ok(Number.isFinite(plate) && plate > 0, `${label}: plate value`);
    assert.ok(count >= 1, `${label}: plate count`);
    assert.ok(count <= counts[plate], `${label}: ${plate} within the rack`);
    seen[plate] = (seen[plate] || 0) + count;
  }
  const parsed = parsePlates(result.platesText, unit);
  assert.equal(parsed.total, cents(result.perSide), `${label}: plate values sum to the per-side load`);
  assert.equal(parsed.count, result.plateCount, `${label}: plate count matches the text`);
  assert.equal(result.totalPlates, 2 * result.plateCount, `${label}: two sides`);
}

// --- Published anchors: common gym loads and their per-side arithmetic. ---
const anchors = [
  [{ unit: 'kg', target: '100', bar: '20' }, 40, 100],
  [{ unit: 'kg', target: '60', bar: '15' }, 22.5, 60],
  [{ unit: 'kg', target: '22.5', bar: '20' }, 1.25, 22.5],
  [{ unit: 'kg', target: '140', bar: '20' }, 60, 140],
  [{ unit: 'kg', target: '102.5', bar: '20' }, 41.25, 102.5],
  [{ unit: 'lb', target: '135', bar: '45' }, 45, 135],
  [{ unit: 'lb', target: '185', bar: '45' }, 70, 185],
  [{ unit: 'lb', target: '225', bar: '45' }, 90, 225],
  [{ unit: 'lb', target: '315', bar: '45' }, 135, 315],
  [{ unit: 'kg', target: '500', bar: '20' }, 240, 500]
];
for (const [input, perSide, loadedTotal] of anchors) {
  const result = calc(input);
  assert.equal(result.exact, true, `${input.target} ${input.unit}: exact`);
  assert.equal(result.perSide, perSide, `${input.target} ${input.unit}: per side`);
  assert.equal(result.loadedTotal, loadedTotal, `${input.target} ${input.unit}: total`);
  assert.ok(enumerate(input.unit, null).has(cents(perSide)), `${input.target} ${input.unit}: reachable`);
  checkComposition(result, input.unit, null, `${input.target} ${input.unit}`);
}

// --- Empty bar and the smallest increment. ---
const bare = calc({ unit: 'kg', target: '20', bar: '20' });
assert.equal(bare.exact, true);
assert.equal(bare.perSide, 0);
assert.equal(bare.plateCount, 0);
assert.equal(bare.totalPlates, 0);
assert.equal(bare.platesText, 'no plates');
assert.equal(bare.loadedTotal, 20);

// --- Sweep: every target either loads exactly or reports the true neighbours. ---
let sweepExact = 0;
let sweepGaps = 0;
const defaultKgSums = [...enumerate('kg', null)].sort((a, b) => a - b);
const nearest = (sorted, value) => {
  let below = null;
  let above = null;
  for (const sum of sorted) {
    if (sum <= value) below = sum;
    if (sum >= value && above === null) above = sum;
  }
  return { below, above };
};
for (let targetC = 2100; targetC <= 30000; targetC += 50) {
  const target = targetC / 100;
  const result = calc({ unit: 'kg', target: String(target), bar: '20' });
  const perSideC = (targetC - 2000) / 2;
  const sums = defaultKgSums;
  const { below, above } = nearest(sums, perSideC);
  if (result.exact) {
    sweepExact += 1;
    assert.equal(result.perSide, perSideC / 100, `${target} kg: exact per side`);
    assert.equal(result.loadedTotal, target, `${target} kg: exact total`);
    assert.ok(sums.includes(perSideC), `${target} kg: reachable`);
    checkComposition(result, 'kg', null, `${target} kg`);
  } else {
    sweepGaps += 1;
    assert.equal(cents(result.belowTotal ?? 0), 2000 + 2 * below, `${target} kg: nearest lighter`);
    assert.equal(cents(result.aboveTotal ?? 0), 2000 + 2 * above, `${target} kg: nearest heavier`);
    assert.ok(result.belowTotal < target && result.aboveTotal > target, `${target} kg: bracketed`);
    assert.equal(cents(result.shortfall), targetC - (2000 + 2 * below), `${target} kg: shortfall`);
    assert.equal(cents(result.surplus), 2000 + 2 * above - targetC, `${target} kg: surplus`);
    assert.equal(parsePlates(result.belowPlatesText, 'kg').total, below, `${target} kg: below text`);
    assert.equal(parsePlates(result.abovePlatesText, 'kg').total, above, `${target} kg: above text`);
  }
}
assert.ok(sweepExact > 100 && sweepGaps > 100, 'sweep covers both outcomes');

// --- Limited racks: the reported load must respect the pairs that exist. ---
const rackSets = [
  { 25: 1, 20: 2, 15: 1, 10: 1, 5: 1, 2.5: 0, 1.25: 0 },
  { 25: 2, 20: 0, 15: 2, 10: 4, 5: 0, 2.5: 2, 1.25: 0 },
  { 25: 0, 20: 1, 15: 0, 10: 0, 5: 3, 2.5: 0, 1.25: 4 },
  { 25: 4, 20: 4, 15: 0, 10: 0, 5: 0, 2.5: 0, 1.25: 0 }
];
let limitedChecks = 0;
for (const pairs of rackSets) {
  const sums = enumerate('kg', pairs);
  const maxSum = Math.max(...sums);
  for (let targetC = 2100; targetC <= 2000 + 2 * maxSum; targetC += 500) {
    const result = calc({ unit: 'kg', target: String(targetC / 100), bar: '20', pairs });
    const perSideC = (targetC - 2000) / 2;
    assert.equal(result.exact, sums.has(perSideC), `${JSON.stringify(pairs)} ${targetC}: exactness`);
    if (result.exact) {
      checkComposition(result, 'kg', pairs, `${JSON.stringify(pairs)} ${targetC}`);
    } else {
      assert.equal(parsePlates(result.belowPlatesText, 'kg').total, Math.max(...[...sums].filter((s) => s <= perSideC)), `${targetC}: below`);
      const above = [...sums].filter((s) => s >= perSideC);
      assert.equal(result.aboveTotal === null ? null : parsePlates(result.abovePlatesText, 'kg').total, above.length ? Math.min(...above) : null, `${targetC}: above`);
    }
    limitedChecks += 1;
  }
}

// --- Round trips: every reachable load from a small rack rebuilds exactly. ---
const smallRack = { 25: 1, 20: 0, 15: 1, 10: 2, 5: 1, 2.5: 0, 1.25: 1 };
let roundTrips = 0;
for (const sum of enumerate('kg', smallRack)) {
  const target = (2000 + 2 * sum) / 100;
  const result = calc({ unit: 'kg', target: String(target), bar: '20', pairs: smallRack });
  assert.equal(result.exact, true, `${target} kg rebuilds`);
  assert.equal(cents(result.perSide), sum, `${target} kg per side`);
  checkComposition(result, 'kg', smallRack, `${target} kg round trip`);
  roundTrips += 1;
}

// --- Pounds use their own increments and bar defaults. ---
const poundDefaults = calc({ unit: 'lb', target: '225' });
assert.equal(poundDefaults.bar, 45);
assert.equal(poundDefaults.exact, true);
assert.equal(poundDefaults.perSide, 90);
const poundGap = calc({ unit: 'lb', target: '47.5', bar: '45' });
assert.equal(poundGap.exact, false);
assert.equal(poundGap.belowTotal, 45);
assert.equal(poundGap.aboveTotal, 50);
assert.equal(poundGap.shortfall, 2.5);
assert.equal(poundGap.surplus, 2.5);
assert.equal(poundGap.abovePlatesText, '2.5 lb');

// --- Table invariants: plate sets descend and pair defaults stay loadable. ---
for (const unit of B.UNITS) {
  const set = B.PLATE_SETS[unit];
  assert.ok(set.length >= 6, `${unit}: plate sizes`);
  for (let index = 1; index < set.length; index += 1) {
    assert.ok(set[index] < set[index - 1], `${unit}: sizes descend at ${set[index]}`);
  }
  assert.equal(set[set.length - 1], unit === 'kg' ? 1.25 : 2.5, `${unit}: smallest plate`);
  for (const plate of set) {
    const count = B.DEFAULT_PAIRS[unit][plate];
    assert.ok(Number.isInteger(count) && count >= 1 && count <= B.MAX_PAIRS, `${unit} ${plate}: pairs default`);
  }
}

// --- Every catalog case must agree with the core. ---
let goldenCount = 0;
let boundaryCount = 0;
let validationCount = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    validationCount += 1;
    assert.equal(failure(testCase.input), testCase.expectedError, `${testCase.name}: validation message`);
    continue;
  }
  if (testCase.kind === 'golden') goldenCount += 1;
  else if (testCase.kind === 'boundary') boundaryCount += 1;
  else assert.fail(`unexpected test kind ${testCase.kind}`);
  const result = calc(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
}
assert.ok(goldenCount >= 5, 'expected golden cases');
assert.ok(boundaryCount >= 4, 'expected boundary cases');
assert.ok(validationCount >= 10, 'expected validation cases');

// --- Extra parser and validation vectors. ---
assert.equal(calc({ unit: 'kg', target: ' 100 ', bar: '20' }).loadedTotal, 100, 'padded numbers accepted');
assert.equal(calc({ unit: 'kg', target: '100.0', bar: '20.0' }).loadedTotal, 100, 'trailing zeros accepted');
assert.equal(failure({ unit: 'kg', target: '100,5', bar: '20' }), 'Target weight must be a number with at most two decimal places.', 'comma decimal refused');
assert.equal(failure({ unit: 'kg', target: '1e2', bar: '20' }), 'Target weight must be a number with at most two decimal places.', 'exponent refused');
assert.equal(failure({ unit: 'kg', target: '0', bar: '20' }), 'Target weight must be more than zero.', 'zero target refused');
assert.equal(failure({ unit: 'kg', target: '100', bar: '20', pairs: { 25: 'many' } }), 'Plate pair counts must be whole numbers from 0 to 20.', 'word pairs refused');
assert.equal(failure({ unit: 'lb', target: '1101', bar: '45' }), 'Target weight must be 1100 or less.', 'pound ceiling');
assert.equal(failure({ unit: 'lb', target: '100', bar: '221' }), 'Bar weight must be 220 or less.', 'pound bar ceiling');
assert.equal(failure({ unit: 'kg', target: '100', bar: '20', pairs: { 1.25: 21 } }), 'Plate pair counts must be whole numbers from 0 to 20.', 'smallest plate pairs bounded');
assert.equal(calc({ unit: 'kg', target: '100' }).bar, 20, 'default kilogram bar');
assert.equal(calc({ unit: 'lb', target: '225', bar: '45', pairs: { 45: 2 } }).perSide, 90, 'restricted but sufficient rack');

// --- Page contract. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'), 'live status region');
assert.ok(html.includes('[hidden]{display:none!important}'), 'hidden panels stay hidden');
assert.ok(/min-height:44px/.test(html), 'tap targets');
for (const id of ['unit', 'target', 'bar', 'go', 'bp-status', 'inventory', 'headline-out', 'total-out',
  'bar-out', 'plates-out', 'count-out', 'below-row', 'above-row', 'below-out', 'above-out', 'copy', 'notes', 'reset-plates']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or output ${id}`);
}
assert.ok(/<form id="bp-form" novalidate>/.test(html), 'form contract');
assert.ok(/<button id="go" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(/id="target"[^>]*value="100"/.test(html), 'default target in markup');
assert.ok(/id="bar"[^>]*value="20"/.test(html), 'default bar in markup');
assert.ok(/<option value="kg" selected>/.test(html), 'default unit selected in markup');
assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(html), 'no raw HTML sinks');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'no browser storage');
assert.ok(!/https?:\/\//.test(html), 'no external requests in the page');

console.log(`${slug}: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed; ` +
  `${anchors.length} published anchors, ${roundTrips} round trips, ${sweepExact + sweepGaps} sweep targets and ` +
  `${limitedChecks} limited-rack targets checked`);
