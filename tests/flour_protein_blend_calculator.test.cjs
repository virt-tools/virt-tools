/* Flour protein blend calculator: catalog replay, an independent bisection
   reference over 300 seeded blends, mass-balance invariants, formatting,
   refusals, name/alias uniqueness and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'flour-protein-blend-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* flour-blend-core:start */';
const endMarker = '/* flour-blend-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = FlourBlendCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.solve(input));
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};
const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ': ' + actual + ' vs ' + expected);
};

// ---- An independent reference: bisect the protein curve for the unknown weight.
// Nothing here reuses the page's closed-form solution.
function referenceBatch(a, b, target, weight) {
  let lo = 0;
  let hi = weight;
  for (let step = 0; step < 200; step += 1) {
    const mid = (lo + hi) / 2;
    const protein = (mid * a + (weight - mid) * b) / weight;
    if ((protein - target) * (a - b) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function referenceAdjust(a, b, target, weight) {
  let lo = 0;
  let hi = 10000000;
  for (let step = 0; step < 200; step += 1) {
    const mid = (lo + hi) / 2;
    const protein = (weight * a + mid * b) / (weight + mid);
    if ((protein - target) * (b - target) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---- Exported contract.
assert.equal(C.MAX_GRAMS, 100000);
assert.equal(typeof C.MESSAGES.badNumber, 'string');
assert.deepEqual(plain(Object.keys(C)).sort(),
  ['MAX_GRAMS', 'MESSAGES', 'formatGrams', 'formatPercent', 'parseNumber', 'round', 'solve', 'trim']);

// ---- Formatting.
assert.equal(C.formatGrams(1000), '1000 g');
assert.equal(C.formatGrams(454.5), '454.5 g');
assert.equal(C.formatGrams(1), '1 g');
assert.equal(C.formatGrams(1142.9), '1142.9 g');
assert.equal(C.formatPercent(11.5), '11.5%');
assert.equal(C.formatPercent(12), '12%');
assert.equal(C.formatPercent(10.01), '10.01%');
assert.equal(C.trim(0.5, 1), '0.5');
assert.equal(C.round(2.24, 1), 2.2);
assert.equal(C.round(2.25, 1), 2.3);

// ---- Random blends both ways against the bisection reference.
let seed = 20261117;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
for (let trial = 0; trial < 300; trial += 1) {
  const a = Math.round((5 + random() * 70) * 10) / 10;
  const b = Math.round((5 + random() * 70) * 10) / 10;
  if (a === b) continue;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  if (high - low < 0.2) continue;
  const target = Math.round((low + 0.1 + random() * (high - low - 0.2)) * 10) / 10;
  if (target === a || target === b) continue;
  const weight = Math.round(50 + random() * 4950);

  const batch = run({ mode: 'batch', a: String(a), b: String(b), target: String(target), weight: String(weight) });
  near(batch.aGrams, referenceBatch(a, b, target, weight), 0.0501, 'batch split ' + trial);
  near(batch.aGrams + batch.bGrams, batch.totalGrams, 1e-9, 'batch parts sum to total');
  near(batch.totalGrams, weight, 1e-9, 'batch keeps its weight');
  assert.ok(batch.aGrams >= 0 && batch.bGrams >= 0, 'no negative part');
  const batchProtein = (batch.aGrams * a + batch.bGrams * b) / 100;
  assert.equal(batch.actualPercent, C.round(batchProtein * 100 / batch.totalGrams, 2), 'actual percent recomputed');
  assert.ok(Math.abs(batch.actualPercent - target) < 0.25, 'batch lands on the target ' + trial);

  const onHand = Math.round(50 + random() * 4950);
  const adjust = run({ mode: 'adjust', a: String(a), b: String(b), target: String(target), weight: String(onHand) });
  near(adjust.bGrams, referenceAdjust(a, b, target, onHand), 0.0501, 'adjust addition ' + trial);
  assert.equal(adjust.aGrams, onHand, 'the amount on hand is kept');
  near(adjust.totalGrams, adjust.aGrams + adjust.bGrams, 1e-9, 'adjust parts sum to total');
  assert.ok(adjust.bGrams >= 0, 'the addition is not negative');
  const adjustProtein = (adjust.aGrams * a + adjust.bGrams * b) / 100;
  assert.equal(adjust.actualPercent, C.round(adjustProtein * 100 / adjust.totalGrams, 2), 'adjusted percent recomputed');
}

// ---- The blend percentage always lies between the two flours.
for (const probe of [
  { mode: 'batch', a: '12.7', b: '10.5', target: '11.5', weight: '1000' },
  { mode: 'adjust', a: '10.5', b: '75', target: '12', weight: '500' },
  { mode: 'batch', a: '5', b: '20', target: '17.5', weight: '240' }
]) {
  const result = run(probe);
  assert.ok(result.actualPercent >= Math.min(result.aPercent, result.bPercent) - 0.01);
  assert.ok(result.actualPercent <= Math.max(result.aPercent, result.bPercent) + 0.01);
  assert.equal(result.proteinGrams, C.round((result.aGrams * result.aPercent + result.bGrams * result.bPercent) / 100, 1));
}

// ---- Catalog replay of the published cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug appears once');
assert.equal(record.name, 'Flour Protein Blend Calculator');
assert.equal(record.category, 'Food');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.sources.length, 0, 'bespoke mass balance carries no citation');
assert.equal(record.testCases.length, 26, '26 catalog cases');
assert.equal(record.testCases.filter((entry) => entry.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((entry) => entry.kind === 'boundary').length, 6);
assert.equal(record.testCases.filter((entry) => entry.kind === 'validation').length, 10);

for (const testCase of record.testCases) {
  const input = {
    mode: testCase.input.mode,
    a: testCase.input.a,
    b: testCase.input.b,
    target: testCase.input.target,
    weight: testCase.input.weight
  };
  if (testCase.expected.error) {
    assert.equal(failure(input), testCase.expected.error, 'refusal: ' + testCase.name);
    continue;
  }
  const result = run(input);
  const expected = testCase.expected;
  for (const key of ['aGrams', 'bGrams', 'totalGrams', 'proteinGrams', 'actualPercent']) {
    near(result[key], expected[key], 1e-9, testCase.name + ' ' + key);
  }
}

// ---- The catalog is the single place a slug, name or alias may live.
const names = new Map();
for (const tool of catalog.tools) {
  for (const value of [tool.name, ...(tool.aliases || [])]) {
    const key = value.toLowerCase();
    if (!names.has(key)) names.set(key, new Set());
    names.get(key).add(tool.slug);
  }
}
for (const value of [record.name, ...record.aliases]) {
  const owners = names.get(value.toLowerCase());
  assert.equal(owners.size, 1, 'name or alias belongs to one tool: ' + value);
  assert.ok(owners.has(slug), 'name or alias belongs to this tool: ' + value);
}

// ---- Refusals stay specific.
const base = { mode: 'batch', a: '12.7', b: '10.5', target: '11.5', weight: '1000' };
assert.equal(failure({ ...base, mode: 'mix' }), 'Pick split a batch or add to what you have.');
assert.equal(failure({ ...base, weight: '' }), 'Enter the weight in grams.');
assert.equal(failure({ ...base, a: '' }), 'Enter the protein percentage for both flours and the target.');
assert.equal(failure({ ...base, target: 'abc' }), 'Use digits only for the percentages and the weight.');
assert.equal(failure({ ...base, weight: '1,000' }), 'Use digits only for the percentages and the weight.');
assert.equal(failure({ ...base, weight: '-5' }), 'Use digits only for the percentages and the weight.');
assert.equal(failure({ ...base, weight: '0' }), 'Enter a weight greater than 0 g.');
assert.equal(failure({ ...base, weight: '100001' }),
  'That is more than 100,000 g; split the amount into smaller batches.');
assert.equal(failure({ ...base, b: '150' }), 'A protein percentage must be between 0% and 100%.');
assert.equal(failure({ ...base, b: '12.7' }),
  'Both flours have the same protein level, so mixing them cannot reach a different target.');
assert.equal(failure({ ...base, target: '12.7' }),
  'The target equals one of the flours, so use that flour on its own.');
assert.equal(failure({ ...base, target: '13' }),
  'A target of 13% is above both flours; add a stronger flour or vital wheat gluten.');
assert.equal(failure({ ...base, target: '10' }),
  'A target of 10% is below both flours; add a weaker flour or starch to dilute the blend.');

// ---- Page contract.
assert.ok(/<h1>Flour Protein Blend Calculator<\/h1>/.test(html), 'heading');
assert.ok(/<form id="blend-form" novalidate>/.test(html), 'form');
for (const id of ['in-a', 'in-b', 'in-target', 'in-weight', 'weight-label', 'w-hint', 'err', 'run',
  'copy', 'clear', 'status', 'out', 'headline', 'sub', 'rows']) {
  assert.ok(html.includes('id="' + id + '"'), 'element id: ' + id);
}
for (const label of ['Flour A protein', 'Flour B protein', 'Target protein']) {
  assert.ok(html.includes('>' + label + '</label>'), 'label: ' + label);
}
assert.ok(/<input type="radio" name="mode" id="m-batch" value="batch" checked>/.test(html), 'batch radio');
assert.ok(/<label for="m-adjust">Add to what I have<\/label>/.test(html), 'adjust label');
assert.ok(/<button type="submit" id="run">Calculate blend<\/button>/.test(html), 'submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<th scope="col" class="num">Protein<\/th>/.test(html), 'table header');
assert.ok(/Flour A on hand/.test(html), 'the weight field is relabelled in adjust mode');
assert.ok(/nothing is sent or stored/.test(html), 'the note states local only');
assert.ok(!/https?:\/\//.test(html), 'no off-site links or requests');
assert.ok(!/<script[^>]+src="(?!\/assets\/)/.test(html), 'only local scripts');
assert.ok(!/\son(click|input|change|submit|keydown)=/.test(html), 'no inline event handlers');
assert.equal(html.match(/<script/g).length, 3, 'theme init, shared app and the tool script');
const ids = html.match(/\bid="[^"]+"/g).map((value) => value.slice(4, -1));
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');

console.log('flour protein blend calculator: all assertions passed');
