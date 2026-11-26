/* Cheese yield: the Van Slyke formula against an independent Fraction oracle,
   casein estimation, the published examples, validation messages, the catalog
   record and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'cheese-yield-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* cheese-core:start */';
const endMarker = '/* cheese-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CheeseCore;', sandbox);
const C = sandbox.module.exports;

const failure = (fn) => {
  try { fn(); } catch (error) { return error.message; }
  return null;
};
const close = (got, expected, label) =>
  assert.ok(Math.abs(got - expected) <= 1e-6, label + ': got ' + got + ', expected ' + expected);
const run = (input) => C.estimate(input);
const base = { milk: '100', fat: '3.6', protein: '3.2', moisture: '37', caseinMode: 'number', casein: '2.5' };
const withInput = (patch) => Object.assign({}, base, patch);

// ---- Constants of the Van Slyke and Price formula.
assert.equal(C.FAT_RECOVERY, 0.93, '93 percent of the milk fat is recovered');
assert.equal(C.CASEIN_LOSS, 0.1, '0.1 kg of casein per 100 kg is lost in the whey');
assert.equal(C.SOLIDS_FACTOR, 1.09, 'salt and other solids add nine percent');
assert.equal(C.CASEIN_NUMBER, 0.78, 'the default casein number');
assert.equal(C.LIMITS.milk.join(','), '1,1000000');
assert.equal(C.LIMITS.fat.join(','), '0,12');
assert.equal(C.LIMITS.protein.join(','), '0.1,10');
assert.equal(C.LIMITS.casein.join(','), '0,9');
assert.equal(C.LIMITS.moisture.join(','), '20,60');

// ---- Casein estimates, checked against the published coefficients.
close(C.caseinFromProtein(3.2, 'number'), 2.496, '0.78 x protein');
close(C.caseinFromProtein(3.2, 'regression'), 2.457, '0.830 x protein - 0.199');
close(C.caseinFromProtein(2.5, 'regression'), 1.876, 'the regression at 2.5 percent protein');
assert.equal(failure(() => C.caseinFromProtein(2.5, 'direct')), 'Choose how casein is entered from the list.',
  'direct mode gets its casein from the input, not the protein');

// ---- The e-book's worked example: 3.6 fat, 2.5 casein, 37 percent moisture
// yields 9.945 kg of Cheddar per 100 kg of milk.
const book = run(withInput({ caseinMode: 'direct', casein: '2.5' }));
close(book.yieldPercent, 9.944952381, 'the published Van Slyke example');
assert.equal((Math.round(book.yieldPercent * 1000) / 1000).toFixed(3), '9.945');

// ---- The e-book's Colby exercise: 3.3 fat, 3.2 protein, 40 percent moisture.
const colby = run(withInput({ fat: '3.3', moisture: '40' }));
close(colby.yieldPercent, 9.928083333, 'the Colby exercise');
close(colby.casein, 2.496, 'casein from the 0.78 casein number');

// ---- Vectors pinned from an exact Fraction model of the formula.
const pinned = [
  ['the page defaults', {}, 9.938031746, 9.938031746, 10.062354655],
  ['the regression casein', { caseinMode: 'regression' }, 9.870555556, 9.870555556, 10.131142005],
  ['a high-moisture cheese', { moisture: '55' }, 13.913244444, 13.913244444, 7.187396182],
  ['a 450 kg vat', { milk: '450', fat: '4.0', protein: '3.4', moisture: '38' }, 11.026580645, 49.619612903, 9.068994570],
  ['Jersey milk by the regression', { milk: '200', fat: '4.8', protein: '3.8', moisture: '36', caseinMode: 'regression' }, 12.465171875, 24.93034375, 8.022352279],
  ['a skim-milk batch', { milk: '50', fat: '0.1', protein: '3.4', moisture: '45' }, 5.241909091, 2.620954545, 19.077019129],
  ['the largest accepted vat', { milk: '1000000' }, 9.938031746, 99380.317460317, 10.062354655],
];
for (const [label, patch, yieldPercent, cheeseKg, milkPerKg] of pinned) {
  const result = run(withInput(patch));
  close(result.yieldPercent, yieldPercent, label + ' yield');
  close(result.cheeseKg, cheeseKg, label + ' cheese weight');
  close(result.milkPerKg, milkPerKg, label + ' milk per kg');
}

// ---- Boundaries the formula still accepts.
const boundary = [
  ['dry cheese at 20 percent moisture', { moisture: '20' }, 7.8262],
  ['wet cheese at 60 percent moisture', { moisture: '60' }, 15.6524],
  ['one kilogram of milk', { milk: '1' }, 9.938031746],
  ['fat-free milk', { fat: '0' }, 4.145460317],
  ['high-protein milk', { protein: '10' }, 19.114793651],
  ['casein typed at the 9 percent ceiling', { caseinMode: 'direct', casein: '9' }, 21.190984127],
  ['casein just above the whey loss', { caseinMode: 'direct', casein: '0.11' }, 5.809873016],
];
for (const [label, patch, expected] of boundary) {
  close(run(withInput(patch)).yieldPercent, expected, label);
}

// ---- Identities: the yield scales with the vat and inverts into milk per kg.
const small = run(withInput({ milk: '100' }));
const large = run(withInput({ milk: '250' }));
close(large.cheeseKg, small.cheeseKg * 2.5, 'cheese weight scales with the vat');
close(small.yieldPercent * small.milkPerKg, 100, 'yield x milk per kg is 100');
close(small.solids, (0.93 * 3.6 + 2.496 - 0.1) * 1.09, 'the solids term');
for (const value of ['1', '7', '99.5', '640', '1250.25']) {
  const result = run(withInput({ milk: value }));
  assert.ok(result.cheeseKg > 0 && result.milkPerKg > 0, 'positive results for ' + value + ' kg');
  close(result.cheeseKg, Number(value) * result.yieldPercent / 100, 'cheese for ' + value + ' kg');
}

// ---- The formula responds in the expected direction.
assert.ok(run(withInput({ fat: '4.2' })).yieldPercent > small.yieldPercent, 'more fat yields more cheese');
assert.ok(run(withInput({ protein: '3.8' })).yieldPercent > small.yieldPercent, 'more protein yields more cheese');
assert.ok(run(withInput({ moisture: '45' })).yieldPercent > small.yieldPercent, 'wetter cheese weighs more on the same solids');
assert.ok(run(withInput({ caseinMode: 'regression' })).yieldPercent < small.yieldPercent,
  'the regression estimates less casein at 3.2 percent protein');
assert.ok(run(withInput({ protein: '3.2', caseinMode: 'number' })).casein
  > run(withInput({ protein: '3.2', caseinMode: 'regression' })).casein, 'the two estimators differ');

// ---- Commas are accepted as decimal separators, as on the other pages.
close(run(withInput({ fat: '3,6' })).yieldPercent, small.yieldPercent, 'comma decimal');

// ---- Validation messages, exactly as the page shows them.
assert.equal(failure(() => run(withInput({ milk: '' }))), 'Enter the milk weight.');
assert.equal(failure(() => run(withInput({ milk: '0' }))), 'Enter a milk weight from 1 to 1,000,000 kg.');
assert.equal(failure(() => run(withInput({ milk: '1000001' }))), 'Enter a milk weight from 1 to 1,000,000 kg.');
assert.equal(failure(() => run(withInput({ milk: 'many' }))), 'Milk weight must be a number.');
assert.equal(failure(() => run(withInput({ fat: 'abc' }))), 'Milk fat must be a number.');
assert.equal(failure(() => run(withInput({ fat: '13' }))), 'Enter a milk fat from 0 to 12 percent.');
assert.equal(failure(() => run(withInput({ fat: '-1' }))), 'Milk fat must be a number.');
assert.equal(failure(() => run(withInput({ protein: '0.05' }))), 'Enter a milk protein from 0.1 to 10 percent.');
assert.equal(failure(() => run(withInput({ moisture: '' }))), 'Enter the target moisture.');
assert.equal(failure(() => run(withInput({ moisture: '10' }))), 'Enter a target moisture from 20 to 60 percent.');
assert.equal(failure(() => run(withInput({ moisture: '61' }))), 'Enter a target moisture from 20 to 60 percent.');
assert.equal(failure(() => run(withInput({ caseinMode: 'direct', casein: '9.5' }))),
  'Enter a casein content from 0 to 9 percent.');
assert.equal(failure(() => run(withInput({ caseinMode: 'direct', casein: '' }))), 'Enter the casein content.');
assert.equal(failure(() => run(withInput({ caseinMode: 'direct', casein: '0.1' }))),
  'Casein must be above 0.1 kg per 100 kg of milk; 0.1 is the amount lost in the whey.');
assert.equal(failure(() => run(withInput({ protein: '0.1' }))),
  'That milk protein gives no casein above the 0.1 kg lost in the whey. Raise the protein figure.');
assert.equal(failure(() => run(withInput({ protein: '0.35', caseinMode: 'regression' }))),
  'That milk protein gives no casein above the 0.1 kg lost in the whey. Raise the protein figure.');
assert.equal(failure(() => run(withInput({ caseinMode: 'bogus' }))), 'Choose how casein is entered from the list.');
assert.equal(failure(() => run(null)), 'Enter the milk weight.');

// ---- Catalog record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(record.name, 'Cheese Yield Calculator');
assert.equal(record.category, 'Food');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.icon, '\u{1F9C0}', 'the cheese icon');
assert.deepEqual(record.tags, ['food', 'cheese', 'dairy', 'yield', 'van-slyke', 'estimation-calculation']);
assert.ok(record.aliases.includes('Van Slyke Cheese Yield'), 'the formula alias is present');
assert.equal(record.sources.length, 2, 'two sources');
assert.ok(record.sources[0].url.startsWith('https://books.lib.uoguelph.ca/'), 'cites the cheese-making e-book');
assert.ok(record.sources[1].url.startsWith('https://www.cheesescience.org/'), 'cites the Cheese Science Toolkit');
assert.ok(record.method.includes('0.93'), 'method states the fat recovery');
assert.ok(record.method.includes('0.1'), 'method states the casein loss');
assert.ok(record.method.includes('0.78'), 'method states the casein number');
assert.ok(record.description.length > 80 && record.description.endsWith('browser.'),
  'the description says the page runs locally');
assert.ok(record.testCases.length >= 20, 'the catalog carries the test cases');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug is unique');
assert.equal(catalog.tools.filter((tool) => tool.name === record.name).length, 1, 'the name is unique');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Food').length, 55, 'Food count');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2209, 'public tools');

// ---- Replay every case stored in the record.
for (const item of record.testCases) {
  if (item.kind === 'validation') {
    const got = failure(() => run(item.input));
    assert.equal(got, item.expected.error, 'replay ' + item.name);
    continue;
  }
  const got = run(item.input);
  for (const field of ['yieldPercent', 'cheeseKg', 'milkPerKg', 'casein', 'fatRecovered', 'caseinRetained']) {
    if (item.expected[field] !== undefined) close(got[field], item.expected[field], 'replay ' + item.name + ' ' + field);
  }
}

// ---- Page contract.
assert.ok(html.includes('<div id="site-header"></div>'), 'the shared header mount is present');
assert.ok(html.includes('/assets/app.js'), 'the shared shell script is loaded');
assert.ok(html.includes('/assets/style.css'), 'the shared stylesheet is loaded');
assert.ok(!/https?:\/\//.test(html), 'the page makes no third-party request');
assert.ok(!html.includes('\u0000'), 'no NUL bytes');
assert.ok(html.includes('<h1>Cheese Yield Calculator</h1>'), 'the page heading');
assert.ok(html.includes('Van Slyke'), 'the note names the formula');
assert.ok(html.includes('glycomacropeptide'), 'the note explains the casein loss');
assert.ok(html.includes('Nothing is uploaded'), 'the note stays local');
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'ids are unique');
for (const control of ['milk', 'fat', 'protein', 'moisture', 'casein-mode', 'casein']) {
  assert.ok(new RegExp('<label\\b[^>]*\\bfor="' + control + '"').test(html), 'label for ' + control);
  assert.ok(ids.includes(control), 'control id ' + control);
}
for (const id of ['yield-form', 'err', 'out', 'facts', 'casein-field']) {
  assert.ok(ids.includes(id), 'element id ' + id);
}
assert.ok(html.includes('inputmode="decimal"'), 'numeric keyboards on phones');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no external script');

console.log('cheese yield calculator: all checks passed');
