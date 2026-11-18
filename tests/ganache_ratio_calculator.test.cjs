/* Ganache ratio calculator: catalog replay, mass-balance invariants over 400
   seeded ganaches, a solve-from-either-end round trip, the published style
   ratios, formatting, refusals, name/alias uniqueness and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ganache-ratio-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* ganache-core:start */';
const endMarker = '/* ganache-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = GanacheCore;', sandbox);
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

// ---- Exported contract.
assert.equal(C.MAX_GRAMS, 20000);
assert.equal(C.MIN_RATIO, 0.5);
assert.equal(C.MAX_RATIO, 3);
assert.deepEqual(plain(C.RATIOS), { truffle: 2, filling: 1, milk: 2.5 });
assert.deepEqual(plain(Object.keys(C)).sort(),
  ['MAX_GRAMS', 'MAX_RATIO', 'MESSAGES', 'MIN_RATIO', 'RATIOS', 'formatGrams', 'formatPercent',
    'formatRatio', 'parseNumber', 'ratioFor', 'round', 'solve', 'trim']);

// ---- Formatting.
assert.equal(C.formatGrams(200), '200 g');
assert.equal(C.formatGrams(13333.3), '13333.3 g');
assert.equal(C.formatGrams(0.5), '0.5 g');
assert.equal(C.formatPercent(66.6666666), '66.67%');
assert.equal(C.formatPercent(50), '50%');
assert.equal(C.formatRatio(2), '2:1');
assert.equal(C.formatRatio(2.5), '2.5:1');
assert.equal(C.formatRatio(0.8), '0.8:1');
assert.equal(C.trim(0.5, 1), '0.5');
assert.equal(C.round(13333.35, 1), 13333.4);

// ---- The style ratios themselves.
assert.equal(C.ratioFor('truffle', ''), 2);
assert.equal(C.ratioFor('filling', ''), 1);
assert.equal(C.ratioFor('milk', ''), 2.5);
assert.equal(C.ratioFor('custom', '1.75'), 1.75);
assert.equal(failure({ style: 'custom', ratio: '', basis: 'chocolate', amount: '100', extra: '0' }),
  'Enter the chocolate-to-cream ratio.');

// ---- 400 seeded ganaches: C = ratio x (cream + added liquid), parts sum to the total.
let seed = 20261118;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const styles = ['truffle', 'filling', 'milk', 'custom'];
const bases = ['chocolate', 'cream', 'finished'];
for (let trial = 0; trial < 400; trial += 1) {
  const style = styles[Math.floor(random() * styles.length)];
  const ratioText = String(Math.round((0.5 + random() * 2.5) * 100) / 100);
  const ratio = style === 'custom' ? Number(ratioText) : C.RATIOS[style];
  const basis = bases[Math.floor(random() * bases.length)];
  const amount = String(Math.round(5 + random() * 1995));
  let extra;
  if (basis === 'chocolate') extra = String(Math.round(random() * 0.8 * Number(amount) / ratio * 10) / 10);
  else if (basis === 'cream') extra = String(Math.round(random() * 1200 * 10) / 10);
  else extra = String(Math.round(random() * 0.8 * Number(amount) / (ratio + 1) * 10) / 10);

  const input = { style, ratio: ratioText, basis, amount, extra };
  const result = run(input);
  const label = trial + ' ' + JSON.stringify(input);
  assert.ok(result.chocolateGrams > 0, 'chocolate is positive ' + label);
  assert.ok(result.creamGrams > 0, 'cream is positive ' + label);
  assert.ok(result.extraGrams >= 0, 'added liquid is not negative ' + label);
  near(result.totalGrams, result.chocolateGrams + result.creamGrams + result.extraGrams, 1e-6,
    'total is the sum of the rounded parts ' + label);
  near(result.chocolateGrams, ratio * (result.creamGrams + result.extraGrams),
    0.06 * (1 + ratio) + 1e-9, 'the ratio holds ' + label);
  near(result.chocolateShare + result.liquidShare, 100, 1e-9, 'shares fill the total ' + label);
  assert.equal(result.chocolateShare, C.round(result.chocolateGrams * 100 / result.totalGrams, 2),
    'chocolate share recomputed ' + label);
  assert.ok(Math.abs(result.chocolateShare - result.chocolateGrams / result.totalGrams * 100) < 0.01,
    'chocolate share reads the parts ' + label);
  if (basis === 'chocolate') near(result.chocolateGrams, Number(amount), 1e-9, 'the chocolate on hand is kept ' + label);
  if (basis === 'cream') near(result.creamGrams, Number(amount), 1e-9, 'the cream on hand is kept ' + label);
  if (basis === 'finished') near(result.totalGrams, Number(amount), 1e-6, 'the finished weight is kept ' + label);

  // Whatever we started from, feeding the total back in must return the same ganache.
  const back = run({ style, ratio: ratioText, basis: 'finished', amount: String(result.totalGrams), extra });
  near(back.chocolateGrams, result.chocolateGrams, 0.15, 'round trip chocolate ' + label);
  near(back.creamGrams, result.creamGrams, 0.15, 'round trip cream ' + label);
  near(back.totalGrams, result.totalGrams, 0.15, 'round trip total ' + label);
}

// ---- Catalog replay of the published cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug appears once');
assert.equal(record.name, 'Ganache Ratio Calculator');
assert.equal(record.category, 'Food');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.sources.length, 1, 'the ratio presets carry one citation');
assert.equal(record.sources[0].url, 'https://en.wikipedia.org/wiki/Ganache');
assert.equal(record.testCases.length, 24, '24 catalog cases');
assert.equal(record.testCases.filter((entry) => entry.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((entry) => entry.kind === 'boundary').length, 4);
assert.equal(record.testCases.filter((entry) => entry.kind === 'validation').length, 10);

for (const testCase of record.testCases) {
  const input = {
    style: testCase.input.style,
    ratio: testCase.input.ratio,
    basis: testCase.input.basis,
    amount: testCase.input.amount,
    extra: testCase.input.extra
  };
  if (testCase.expectedError) {
    assert.equal(failure(input), testCase.expectedError, 'refusal: ' + testCase.name);
    continue;
  }
  const result = run(input);
  const expected = testCase.expected;
  for (const key of ['chocolateGrams', 'creamGrams', 'extraGrams', 'totalGrams',
    'chocolateShare', 'liquidShare']) {
    near(result[key], expected[key], 1e-9, testCase.name + ' ' + key);
  }
  assert.equal(result.ratio, expected.ratio, testCase.name + ' ratio');
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
const base = { style: 'truffle', basis: 'chocolate', amount: '200', extra: '0' };
assert.equal(failure({ ...base, style: 'white' }),
  'Choose a ganache style: truffle, filling, milk or white, or a custom ratio.');
assert.equal(failure({ ...base, basis: 'ganache' }),
  'Pick what you are starting from: chocolate, cream or finished ganache.');
assert.equal(failure({ ...base, amount: '' }), 'Enter the amount in grams.');
assert.equal(failure({ ...base, amount: '-5' }),
  'Use digits only for the amount, the ratio and the extra liquid.');
assert.equal(failure({ ...base, amount: '1,000' }),
  'Use digits only for the amount, the ratio and the extra liquid.');
assert.equal(failure({ ...base, amount: '0' }), 'Enter an amount greater than 0 g.');
assert.equal(failure({ ...base, amount: '20001' }),
  'That is more than 20,000 g; split the ganache into smaller batches.');
assert.equal(failure({ ...base, extra: '20001' }),
  'That is more than 20,000 g of added liquid; split the ganache into smaller batches.');
assert.equal(failure({ ...base, extra: '120' }),
  'The added liquid is more than the chocolate covers at this ratio; add chocolate or reduce the liquid.');
assert.equal(failure({ ...base, style: 'custom', ratio: '0.4' }),
  'The chocolate ratio must be between 0.5 and 3 parts per 1 part cream.');
assert.equal(failure({ ...base, style: 'custom', ratio: '3.5' }),
  'The chocolate ratio must be between 0.5 and 3 parts per 1 part cream.');
assert.equal(failure({ style: 'truffle', basis: 'finished', amount: '200', extra: '80' }),
  'The added liquid leaves no cream at this finished weight; add weight or reduce the liquid.');
assert.equal(failure({ style: 'custom', ratio: '3', basis: 'cream', amount: '5000', extra: '15000' }),
  'The ganache comes to more than 20,000 g; reduce the amounts or split the batch.');

// ---- Page contract.
assert.ok(/<h1>Ganache Ratio Calculator<\/h1>/.test(html), 'heading');
assert.ok(/<form id="ganache-form" novalidate>/.test(html), 'form');
for (const id of ['in-style', 'ratio-field', 'in-ratio', 'in-amount', 'amount-label', 'amount-hint',
  'in-extra', 'extra-hint', 'err', 'run', 'copy', 'clear', 'status', 'out', 'headline', 'sub', 'rows']) {
  assert.ok(html.includes('id="' + id + '"'), 'element id: ' + id);
}
for (const label of ['Ganache style', 'Chocolate parts per 1 cream', 'Added liquid']) {
  assert.ok(html.includes('>' + label + '</label>'), 'label: ' + label);
}
assert.ok(/<input type="radio" name="basis" id="m-choc" value="chocolate" checked>/.test(html), 'chocolate radio');
assert.ok(/<label for="m-finished">Finished ganache<\/label>/.test(html), 'finished label');
assert.ok(/<button type="submit" id="run">Calculate ganache<\/button>/.test(html), 'submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<th scope="col" class="num">Share<\/th>/.test(html), 'table header');
assert.ok(/nothing is sent or stored/.test(html), 'the note states local only');
assert.ok(!/https?:\/\//.test(html), 'no off-site links or requests');
assert.ok(!/<script[^>]+src="(?!\/assets\/)/.test(html), 'only local scripts');
assert.ok(!/\son(click|input|change|submit|keydown)=/.test(html), 'no inline event handlers');
assert.equal(html.match(/<script/g).length, 3, 'theme init, shared app and the tool script');
assert.ok(/min-height:44px/.test(html), '44px touch targets');
const ids = html.match(/\bid="[^"]+"/g).map((value) => value.slice(4, -1));
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');

console.log('ganache ratio calculator: all assertions passed');
