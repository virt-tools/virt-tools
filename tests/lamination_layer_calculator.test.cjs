/* Laminated dough layer calculator: independent stack model, fold-plan search,
   ratio and thickness arithmetic, catalog replay and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'lamination-layer-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* lamination-core:start */';
const endMarker = '/* lamination-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = LaminationCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.compute(input));
const near = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Number.isFinite(actual), 'expected a finite number, got ' + actual);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    'expected ' + expected + ', got ' + actual);
};
const failure = (input) => {
  try { C.compute(input); } catch (error) { return error.message; }
  return null;
};

// ---- A materialised stack: every fold copies the sheets, as pastry does.
function stackLayers(letterFolds, bookFolds) {
  let stack = [0];
  for (let i = 0; i < letterFolds; i += 1) stack = stack.concat(stack, stack);
  for (let i = 0; i < bookFolds; i += 1) stack = stack.concat(stack, stack, stack);
  return stack.length;
}
const productLayers = (letterFolds, bookFolds) => 3 ** letterFolds * 4 ** bookFolds;

assert.equal(C.LETTER_MULTIPLIER, 3);
assert.equal(C.BOOK_MULTIPLIER, 4);
assert.equal(C.MAX_FOLDS, 8);
assert.equal(C.MAX_WEIGHT, 1000000);
assert.equal(C.MAX_THICKNESS, 100);
assert.equal(C.MAX_PLAN_LAYERS, 429981696);

// ---- Every fold combination, checked against the materialised stack where
// the stack stays small and against an independent product for the rest.
let combinations = 0;
for (let letter = 0; letter <= C.MAX_FOLDS; letter += 1) {
  for (let book = 0; book <= C.MAX_FOLDS; book += 1) {
    const layers = productLayers(letter, book);
    assert.equal(C.foldLayers(letter, book), layers, 'layers for ' + letter + '/' + book);
    if (letter <= 3 && book <= 2) {
      assert.equal(C.foldLayers(letter, book), stackLayers(letter, book),
        'materialised stack for ' + letter + '/' + book);
    }
    combinations += 1;
  }
}
assert.equal(combinations, 81);
assert.equal(C.foldLayers(8, 8), 429981696);
assert.equal(C.foldLayers(0, 0), 1);

// ---- Percentages and thickness against direct arithmetic.
function mulberry32(seed) {
  let state = seed >>> 0;
  return function () {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(20261122);
let arithmetic = 0;
for (let i = 0; i < 400; i += 1) {
  const dough = Math.round(10 + random() * 4990);
  const butter = Math.round(10 + random() * 1990);
  const letter = Math.floor(random() * 9);
  const book = Math.floor(random() * 9);
  const thickness = random() < 0.5 ? null : Math.round((0.2 + random() * 40) * 1000) / 1000;
  const result = run({
    dough: String(dough),
    butter: String(butter),
    letterFolds: String(letter),
    bookFolds: String(book),
    thickness: thickness === null ? '' : String(thickness),
  });
  const total = dough + butter;
  assert.equal(result.layers, productLayers(letter, book));
  assert.equal(result.folds, letter + book);
  assert.equal(result.total, total, 'total weight');
  near(result.butterOfDough, (butter / dough) * 100);
  near(result.butterOfTotal, (butter / total) * 100);
  near(result.doughOfTotal, (dough / total) * 100);
  near(result.butterOfTotal + result.doughOfTotal, 100);
  if (thickness === null) {
    assert.equal(result.thickness, null);
    assert.equal(result.layerThickness, null);
    assert.equal(result.layerMicrons, null);
  } else {
    near(result.layerThickness, thickness / result.layers);
    near(result.layerMicrons, (thickness / result.layers) * 1000);
    near(result.layerThickness * result.layers, thickness);
  }
  assert.equal(result.plan, null);
  arithmetic += 1;
}

// ---- The fold-plan search, against an independent enumeration.
function bestPlan(target) {
  const plans = [];
  for (let letter = 0; letter <= C.MAX_FOLDS; letter += 1) {
    for (let book = 0; book <= C.MAX_FOLDS; book += 1) {
      const layers = productLayers(letter, book);
      if (layers < target) continue;
      plans.push({ letterFolds: letter, bookFolds: book, folds: letter + book, layers });
    }
  }
  plans.sort((a, b) => (a.folds - b.folds) || (a.layers - b.layers));
  return plans[0];
}
let plans = 0;
const targets = [];
for (let target = 1; target <= 3000; target += 1) targets.push(target);
for (let i = 0; i < 300; i += 1) {
  targets.push(1 + Math.floor(random() * C.MAX_PLAN_LAYERS));
}
for (const target of targets) {
  const found = C.planFor(target);
  const expected = bestPlan(target);
  assert.equal(found.target, target);
  assert.equal(found.letterFolds, expected.letterFolds, 'letter folds for ' + target);
  assert.equal(found.bookFolds, expected.bookFolds, 'book folds for ' + target);
  assert.equal(found.folds, expected.folds, 'folds for ' + target);
  assert.equal(found.layers, expected.layers, 'layers for ' + target);
  assert.equal(found.exact, expected.layers === target, 'exact flag for ' + target);
  assert.equal(found.extra, expected.layers - target, 'extra layers for ' + target);
  assert.ok(found.layers >= target, 'the plan reaches the target');
  plans += 1;
}
assert.equal(C.planFor(27).letterFolds, 3);
assert.equal(C.planFor(27).layers, 27);
assert.ok(C.planFor(27).exact);
assert.equal(C.planFor(100).layers, 108);
assert.equal(C.planFor(100).folds, 4);
assert.ok(!C.planFor(100).exact);
assert.equal(C.planFor(C.MAX_PLAN_LAYERS).layers, C.MAX_PLAN_LAYERS);
assert.ok(C.planFor(C.MAX_PLAN_LAYERS).exact);

// ---- Refusals.
const problems = [
  [{ dough: '', butter: '300', letterFolds: '3', bookFolds: '0' }, 'Enter the dough weight.'],
  [{ dough: '0', butter: '300', letterFolds: '3', bookFolds: '0' }, 'The dough weight must be greater than zero.'],
  [{ dough: '1000', butter: '0', letterFolds: '3', bookFolds: '0' }, 'The butter weight must be greater than zero.'],
  [{ dough: '1,000', butter: '300', letterFolds: '3', bookFolds: '0' }, 'Enter the dough weight as a plain number, without units or a thousands separator.'],
  [{ dough: '1000', butter: '300 g', letterFolds: '3', bookFolds: '0' }, 'Enter the butter weight as a plain number, without units or a thousands separator.'],
  [{ dough: '-1000', butter: '300', letterFolds: '3', bookFolds: '0' }, 'Enter the dough weight as a plain number, without units or a thousands separator.'],
  [{ dough: '1000', butter: '1000001', letterFolds: '3', bookFolds: '0' }, 'The butter weight must be at most 1000000.'],
  [{ dough: '1000', butter: '300', letterFolds: '2.5', bookFolds: '0' }, 'Enter the letter folds as a whole number.'],
  [{ dough: '1000', butter: '300', letterFolds: '9', bookFolds: '0' }, 'The letter folds must be at most 8.'],
  [{ dough: '1000', butter: '300', letterFolds: '0', bookFolds: 'nine' }, 'Enter the book folds as a plain number, without units or a thousands separator.'],
  [{ dough: '1000', butter: '300', letterFolds: '3', bookFolds: '0', thickness: '0' }, 'The final sheet thickness must be greater than zero.'],
  [{ dough: '1000', butter: '300', letterFolds: '3', bookFolds: '0', thickness: '101' }, 'The final sheet thickness must be at most 100.'],
  [{ dough: '1000', butter: '300', letterFolds: '3', bookFolds: '0', target: '0' }, 'The target layer count must be at least 1.'],
  [{ dough: '1000', butter: '300', letterFolds: '3', bookFolds: '0', target: '429981697' }, 'The target layer count must be at most 429981696.'],
  [{ dough: '1000', butter: '300', letterFolds: '3', bookFolds: '0', target: '10.5' }, 'Enter the target layer count as a whole number.'],
];
for (const [input, message] of problems) {
  assert.equal(failure(input), message, JSON.stringify(input));
}

// A blank optional field means "not asked" rather than zero.
const optional = run({ dough: '500', butter: '200', letterFolds: '2', bookFolds: '1', thickness: '', target: '' });
assert.equal(optional.thickness, null);
assert.equal(optional.plan, null);
assert.equal(optional.layers, 36);

// ---- Catalog replay.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(entry.name, 'Laminated Dough Layer Calculator');
assert.equal(entry.category, 'Food');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.listed, true);
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.icon, '\u{1F950}');
assert.ok(Array.isArray(entry.sources) && entry.sources.length === 0, 'bespoke arithmetic needs no citation');
assert.ok(entry.method && entry.method.length > 400, 'the method explains the arithmetic');
assert.ok(entry.guidance && entry.guidance.length > 100, 'the guidance states the limits');
assert.ok(entry.testCases.length >= 20, 'enough catalog cases');
const kinds = (kind) => entry.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(kinds('golden'), 6);
assert.equal(kinds('boundary'), 6);
assert.equal(kinds('validation'), 12);
for (const testCase of entry.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') near(result[key], value, 1e-9);
    else if (value !== null && typeof value === 'object') {
      for (const [innerKey, innerValue] of Object.entries(value)) {
        if (typeof innerValue === 'number') near(result[key][innerKey], innerValue, 1e-9);
        else assert.deepEqual(result[key][innerKey], innerValue, testCase.name + ' ' + key + '.' + innerKey);
      }
    } else {
      assert.deepEqual(result[key], value, testCase.name + ' ' + key);
    }
  }
}

// ---- Uniqueness: no other record claims this slug, name or alias.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [entry.slug, entry.name].concat(entry.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'aliases are internally unique');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'tags are internally unique');
for (const tag of ['lamination', 'croissant', 'puff-pastry', 'layers']) {
  assert.ok(entry.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- The page stays self-contained, offline and keyboard accessible.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="lam-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('<div id="site-header"></div>'), 'shared header hook missing');
const controls = ['lam-dough', 'lam-butter', 'lam-letter', 'lam-book', 'lam-thickness', 'lam-target'];
for (const id of controls) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id + ' missing');
}
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
assert.ok(!/type="hidden"/i.test(html), 'no hidden inputs');
assert.ok((html.match(/<button /g) || []).length === 3, 'three buttons');
assert.ok(!/autocomplete="on"/.test(html), 'inputs are not autocompleted');

console.log('lamination layer calculator: ' + entry.testCases.length + ' catalog cases, '
  + combinations + ' fold combinations, ' + arithmetic + ' arithmetic sweeps, '
  + plans + ' plan targets and ' + problems.length + ' refusals pass');
