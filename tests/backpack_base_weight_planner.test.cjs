/* Regression checks for the backpack base weight planner core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'backpack-base-weight-planner';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* backpack-core:start */');
const end = html.indexOf('/* backpack-core:end */');
assert.ok(start > -1 && end > start, 'backpack core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + '/* backpack-core:end */'.length) + '\nmodule.exports = Backpack;', sandbox);
const B = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Sports & Outdoors');
assert.equal(entry.subcategory, 'Planning');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.icon, '🎒');
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 5, 'aliases present');
assert.equal(catalog.tools.length, 2268, 'catalog total');

const failure = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.message;
  }
  return null;
};
const close = (actual, expected, tolerance, label) => {
  assert.ok(Number.isFinite(actual), `not a finite number: ${actual} ${label || ''}`);
  const limit = Math.max(Math.abs(expected) * (tolerance || 1e-9), 1e-12);
  assert.ok(Math.abs(actual - expected) <= limit, `${label || 'value'}: ${actual} != ${expected} (limit ${limit})`);
};

// --- Published arithmetic anchors. ---
const sample = B.compute({
  unit: 'g', bodyWeight: '75', bodyUnit: 'kg', items: [
    { name: 'Backpack', weight: '1200', carry: 'pack' },
    { name: 'Tent and poles', weight: '2100', carry: 'pack' },
    { name: 'Sleeping bag and pad', weight: '1600', carry: 'pack' },
    { name: 'Hiking boots', weight: '1100', carry: 'worn' },
    { name: 'Water', weight: '1500', carry: 'consumed' },
  ],
});
assert.equal(sample.baseGrams, 4900);
assert.equal(sample.wornGrams, 1100);
assert.equal(sample.consumedGrams, 1500);
assert.equal(sample.packGrams, 6400);
assert.equal(sample.skinGrams, 7500);
assert.equal(sample.bodyGrams, 75000);
assert.equal(sample.bodyKg, 75);
close(sample.baseShare, 6.533333333333332, 1e-12, 'base share');
close(sample.packShare, 8.533333333333333, 1e-12, 'pack share');
close(sample.skinShare, 10, 1e-12, 'skin share');
assert.equal(sample.counts.pack, 3);
assert.equal(sample.counts.worn, 1);
assert.equal(sample.counts.consumed, 1);
assert.equal(sample.itemCount, 5);
assert.equal(sample.heaviest.name, 'Tent and poles');
assert.equal(sample.heaviest.row, 2);
close(sample.heaviestShare, 42.857142857142854, 1e-12, 'heaviest share');

// --- Unit factors are the exact avoirdupois values. ---
assert.equal(B.UNITS.g.grams, 1);
assert.equal(B.UNITS.kg.grams, 1000);
assert.equal(B.UNITS.oz.grams, 28.349523125);
assert.equal(B.UNITS.lb.grams, 453.59237);

const pounds = B.compute({ unit: 'lb', bodyWeight: '180', bodyUnit: 'lb', items: [{ name: 'Load', weight: '20', carry: 'pack' }] });
close(pounds.baseGrams, 9071.8474, 1e-12, '20 lb in grams');
close(pounds.bodyGrams, 81646.6266, 1e-12, '180 lb in grams');
close(pounds.baseShare, 20 * 453.59237 / (180 * 453.59237) * 100, 1e-12, 'pound share');

const ounces = B.compute({ unit: 'oz', bodyWeight: '70', bodyUnit: 'kg', items: [{ name: 'Quilt', weight: '16', carry: 'pack' }] });
close(ounces.baseGrams, 16 * 28.349523125, 1e-12, 'ounce conversion');

const kilograms = B.compute({ unit: 'kg', bodyWeight: '550', bodyUnit: 'lb', items: [{ name: 'Sled', weight: '2.5', carry: 'consumed' }] });
close(kilograms.baseGrams, 0, 1e-12, 'consumable-only base');
close(kilograms.consumedGrams, 2500, 1e-12, 'kilogram conversion');
close(kilograms.packGrams, 2500, 1e-12, 'consumable pack weight');
assert.equal(kilograms.heaviestShare, 0, 'heaviest share with empty base');

// --- Rows with a zero weight are counted but add nothing. ---
const zero = B.compute({ unit: 'g', bodyWeight: '60', bodyUnit: 'kg', items: [
  { name: 'Poles', weight: '0', carry: 'pack' }, { name: 'Tent', weight: '2000', carry: 'pack' },
] });
assert.equal(zero.itemCount, 2);
assert.equal(zero.counts.pack, 2);
assert.equal(zero.baseGrams, 2000);
assert.equal(zero.heaviest.name, 'Tent');

// --- Defaults: unit grams, body kilograms, carry pack. ---
const defaults = B.compute({ bodyWeight: '75', bodyUnit: 'kg', items: [{ name: 'Pack', weight: '900' }] });
assert.equal(defaults.unit, 'g');
assert.equal(defaults.counts.pack, 1);
assert.equal(defaults.baseGrams, 900);

// --- Every catalog case must agree with the core. ---
let goldenCount = 0;
let boundaryCount = 0;
let validationCount = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    validationCount += 1;
    const message = failure(() => B.compute(testCase.input));
    assert.equal(message, testCase.expectedError, `${testCase.name}: validation message`);
    continue;
  }
  if (testCase.kind === 'golden') goldenCount += 1;
  else if (testCase.kind === 'boundary') boundaryCount += 1;
  else assert.fail(`unexpected test kind ${testCase.kind}`);
  const result = B.compute(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (key === 'heaviestName') assert.equal(result.heaviest.name, expected, `${testCase.name}: heaviestName`);
    else if (key === 'heaviestGrams') close(result.heaviest.grams, expected, 1e-12, `${testCase.name}: heaviestGrams`);
    else if (key === 'heaviestRow') assert.equal(result.heaviest.row, expected, `${testCase.name}: heaviestRow`);
    else if (key === 'packItems') assert.equal(result.counts.pack, expected, `${testCase.name}: packItems`);
    else if (key === 'wornItems') assert.equal(result.counts.worn, expected, `${testCase.name}: wornItems`);
    else if (key === 'consumedItems') assert.equal(result.counts.consumed, expected, `${testCase.name}: consumedItems`);
    else close(result[key], expected, 1e-12, `${testCase.name}: ${key}`);
  }
}
assert.ok(goldenCount >= 5, 'expected golden cases');
assert.ok(boundaryCount >= 3, 'expected boundary cases');
assert.ok(validationCount >= 10, 'expected validation cases');

// --- Sweep: identities hold for every unit, body unit and load shape. ---
const units = ['g', 'kg', 'oz', 'lb'];
const bodyUnits = ['kg', 'lb'];
const shapes = [
  [{ name: 'A', weight: '1.2', carry: 'pack' }, { name: 'B', weight: '0.8', carry: 'worn' }],
  [{ name: 'A', weight: '0.4', carry: 'pack' }, { name: 'B', weight: '1.2', carry: 'consumed' }, { name: 'C', weight: '0.3', carry: 'worn' }],
  [{ name: 'A', weight: '18', carry: 'pack' }],
];
let plans = 0;
for (const unit of units) {
  for (const bodyUnit of bodyUnits) {
    for (const bodyWeight of ['45', '75.5', '140']) {
      for (const items of shapes) {
        const result = B.compute({ unit: unit, bodyUnit: bodyUnit, bodyWeight: bodyWeight, items: items });
        const label = `${unit}/${bodyUnit}/${bodyWeight}/${items.length}`;
        assert.ok(Number.isFinite(result.baseGrams) && result.baseGrams >= 0, `base finite ${label}`);
        close(result.packGrams, result.baseGrams + result.consumedGrams, 1e-9, `pack identity ${label}`);
        close(result.skinGrams, result.packGrams + result.wornGrams, 1e-9, `skin identity ${label}`);
        close(result.baseShare, result.baseGrams / result.bodyGrams * 100, 1e-9, `base share ${label}`);
        close(result.packShare, result.packGrams / result.bodyGrams * 100, 1e-9, `pack share ${label}`);
        assert.equal(result.itemCount, items.length);
        assert.equal(result.items.length, items.length);
        assert.ok(result.items.every((row) => row.grams >= 0 && Number.isFinite(row.grams)), `item grams ${label}`);
        assert.ok(result.heaviest.grams >= Math.max(...result.items.map((row) => row.grams)) - 1e-9, `heaviest ${label}`);
        plans += 1;
      }
    }
  }
}

// --- Page contract. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('class="table-wrap"'), 'table overflow wrapper');
assert.ok(html.includes('class="sr-only"'), 'screen-reader caption');
for (const id of ['weight-unit', 'body-weight', 'body-unit', 'items-body', 'add-item', 'sample',
  'calculate', 'bp-status', 'base-out', 'pack-out', 'skin-out', 'share-out', 'worn-out', 'consumed-out', 'heaviest-out']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or output ${id}`);
}
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(/<button id="add-item" type="button">/.test(html), 'add-row button');
assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(html), 'no raw HTML sinks');
assert.ok(!/https?:\/\//.test(html.replace(/<meta name="description"[^>]*>/, '')), 'no external requests in the page');

console.log(`${slug}: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed; ${plans} sweep plans checked`);
