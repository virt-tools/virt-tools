/* Paper weight converter: reference weighings, rounding invariants, random round
   trips, validation messages, catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'paper-weight-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* paper-weight-core:start */';
const endMarker = '/* paper-weight-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PaperWeightCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (value, unit) => plain(C.parse(value, unit));
const failure = (value, unit) => {
  try { run(value, unit); } catch (error) { return error.message; }
  return null;
};
const pounds = (result) => result.rows.map((row) => row.lbText);

// ---- Exported contract.
assert.equal(C.MIN_GRAMS, 1);
assert.equal(C.MAX_GRAMS, 2000);
assert.equal(C.GRAMS_PER_POUND, 453.59237);
assert.equal(C.SQ_METRES_PER_SQ_INCH, 0.00064516);
assert.equal(C.SHEETS_PER_REAM, 500);
assert.equal(C.DEFAULT_VALUE, '80');
assert.equal(C.DEFAULT_UNIT, 'text');
assert.deepEqual(plain(C.GRADES.map((grade) => [grade.id, grade.area])),
  [['bond', 374], ['text', 950], ['cover', 520], ['index', 777.75], ['bristol', 641.25], ['tag', 864]]);

// ---- Formatting.
assert.equal(C.format1(118.4117), '118.4');
assert.equal(C.format1(118.44), '118.4');
assert.equal(C.format1(118.45), '118.5', 'halves round up');
assert.equal(C.format1(49.95), '50', 'a binary near-half still rounds up');
assert.equal(C.format1(0.3704), '0.4');
assert.equal(C.format1(2000), '2,000');
assert.equal(C.format1(1351.24), '1,351.2');
assert.equal(C.format1(0.05), '0.1');
assert.equal(C.format1(49.9499999), '49.9', 'values below the half stay down');

// ---- One inch is 0.00064516 m2 and one pound is 453.59237 g, so these are exact.
const gramsBond = 500 * 374 * 0.00064516;
assert.ok(Math.abs(gramsBond - 120.64492) < 1e-9, 'bond ream grams per g/m2');
assert.ok(Math.abs(C.toGrams(20, 'bond') - 20 * 453.59237 / gramsBond) < 1e-12, 'pound to gram');
assert.ok(Math.abs(C.basisWeight(75, C.gradeOf('bond')) - 75 * gramsBond / 453.59237) < 1e-12, 'gram to pound');
for (const grade of C.GRADES) {
  const roundTrip = C.basisWeight(C.toGrams(42.5, grade.id), grade);
  assert.ok(Math.abs(roundTrip - 42.5) < 1e-9, 'round trip through ' + grade.id);
}
assert.equal(C.unitOf('cover').id, 'cover');
assert.equal(C.unitOf('GSM').id, 'gsm');
assert.equal(C.unitOf('nonsense').id, 'gsm', 'an unknown unit falls back to metric');
assert.equal(C.gradeOf('tag').base, '24 \u00d7 36 in');

// ---- Reference weighings, each figure worked out by hand from the base sheets.
const REFERENCE = [
  { value: '80', unit: 'text', metric: '118.4 g/m\u00b2', lbs: ['31.5 lb', '80 lb', '43.8 lb', '65.5 lb', '54 lb', '72.8 lb'] },
  { value: '20', unit: 'bond', metric: '75.2 g/m\u00b2', lbs: ['20 lb', '50.8 lb', '27.8 lb', '41.6 lb', '34.3 lb', '46.2 lb'] },
  { value: '100', unit: 'cover', metric: '270.4 g/m\u00b2', lbs: ['71.9 lb', '182.7 lb', '100 lb', '149.6 lb', '123.3 lb', '166.2 lb'] },
  { value: '90', unit: 'index', metric: '162.7 g/m\u00b2', lbs: ['43.3 lb', '109.9 lb', '60.2 lb', '90 lb', '74.2 lb', '100 lb'] },
  { value: '67', unit: 'bristol', metric: '146.9 g/m\u00b2', lbs: ['39.1 lb', '99.3 lb', '54.3 lb', '81.3 lb', '67 lb', '90.3 lb'] },
  { value: '150', unit: 'tag', metric: '244.1 g/m\u00b2', lbs: ['64.9 lb', '164.9 lb', '90.3 lb', '135 lb', '111.3 lb', '150 lb'] },
  { value: '118.4', unit: 'gsm', metric: '118.4 g/m\u00b2', lbs: ['31.5 lb', '80 lb', '43.8 lb', '65.5 lb', '54 lb', '72.8 lb'] },
  { value: '80', unit: 'gsm', metric: '80 g/m\u00b2', lbs: ['21.3 lb', '54 lb', '29.6 lb', '44.2 lb', '36.5 lb', '49.2 lb'] },
  { value: '1000', unit: 'gsm', metric: '1,000 g/m\u00b2', lbs: ['266 lb', '675.6 lb', '369.8 lb', '553.1 lb', '456 lb', '614.4 lb'] },
];
for (const item of REFERENCE) {
  const result = run(item.value, item.unit);
  assert.equal(result.metric, item.metric, item.value + ' ' + item.unit);
  assert.deepEqual(pounds(result), item.lbs, 'pound rows for ' + item.value + ' ' + item.unit);
  assert.equal(result.gsmText, item.metric.replace(' g/m\u00b2', ''), 'metric text');
}

// The chosen grade is echoed in the sentence under the headline.
assert.equal(run('80', 'text').subText, 'Entered as 80 lb text \u00b7 25 \u00d7 38 in base sheet, 500 sheets');
assert.equal(run('52.5', 'index').subText, 'Entered as 52.5 lb index \u00b7 25.5 \u00d7 30.5 in base sheet, 500 sheets');
assert.equal(run('118.4', 'gsm').subText, 'Entered in grams per square metre');
assert.equal(run('80', 'text').fromText, '80 lb text');
assert.equal(run('80', 'text').unitLabel, 'lb text');
assert.equal(run('80', 'text').baseText, '25 \u00d7 38 in');
assert.equal(run('80', 'gsm').baseText, null);

// ---- Rounding boundary: 74 lb text is exactly 49.95 lb bristol, which rounds up.
const halfCase = run('74', 'text');
assert.equal(halfCase.metric, '109.5 g/m\u00b2');
assert.equal(pounds(halfCase)[4], '50 lb', 'the exact half rounds up, not down');

// ---- Range edges.
assert.equal(run('2000', 'gsm').metric, '2,000 g/m\u00b2');
assert.equal(pounds(run('2000', 'gsm'))[0], '532 lb');
assert.equal(pounds(run('2000', 'gsm'))[1], '1,351.2 lb');
assert.deepEqual(pounds(run('1', 'gsm')), ['0.3 lb', '0.7 lb', '0.4 lb', '0.6 lb', '0.5 lb', '0.6 lb']);
assert.equal(run('1', 'tag').metric, '1.6 g/m\u00b2');
assert.ok(C.toGrams(531, 'bond') <= C.MAX_GRAMS, '531 lb bond stays inside the ceiling');
assert.ok(C.toGrams(532, 'bond') > C.MAX_GRAMS, '532 lb bond leaves it');

// ---- Random weighings: shape, monotonic grade order, stable text round trips.
let seed = 20261111;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const AREA_ORDER = ['bond', 'cover', 'bristol', 'index', 'tag', 'text'];
for (let iteration = 0; iteration < 200; iteration += 1) {
  const places = iteration % 4;
  const grams = Number((1 + random() * 1999).toFixed(places));
  const text = grams.toFixed(places);
  const result = run(text, 'gsm');
  const label = 'random ' + text + ' g/m2';

  assert.equal(result.unit, 'gsm', label + ' unit');
  assert.equal(result.metric, result.gsmText + ' g/m\u00b2', label + ' metric text');
  assert.equal(result.rows.length, 6, label + ' six grades');
  assert.deepEqual(result.rows.map((row) => row.id), ['bond', 'text', 'cover', 'index', 'bristol', 'tag'],
    label + ' grade order');

  const byId = new Map(result.rows.map((row) => [row.id, row.lb]));
  for (let index = 1; index < AREA_ORDER.length; index += 1) {
    assert.ok(byId.get(AREA_ORDER[index]) > byId.get(AREA_ORDER[index - 1]),
      label + ' a larger base sheet gives more pounds');
  }
  for (const row of result.rows) {
    assert.match(row.lbText, /^[\d,]+(?:\.\d)? lb$/, label + ' pound text shape');
  }

  const again = run(result.gsmText, 'gsm');
  assert.equal(again.gsmText, result.gsmText, label + ' metric text round trip');
  for (let index = 0; index < result.rows.length; index += 1) {
    assert.ok(Math.abs(again.rows[index].lb - result.rows[index].lb) <= 0.11,
      label + ' a repeated conversion drifts by at most one tenth');
  }
  assert.deepEqual(run(text, 'gsm'), result, label + ' deterministic');

  // A pound entry for the same sheet must land back on the same metric weight.
  const bondPounds = byId.get('bond');
  const fromPounds = run(String(bondPounds), 'bond');
  assert.ok(Math.abs(fromPounds.gsm - result.gsm) / result.gsm < 0.02, label + ' one-decimal pound round trip');
}

// ---- Validation messages.
assert.equal(failure('', 'gsm'), 'Enter a paper weight to convert.');
assert.equal(failure('   ', 'text'), 'Enter a paper weight to convert.');
assert.equal(failure(null, 'gsm'), 'Enter a paper weight to convert.');
assert.equal(failure(undefined, 'gsm'), 'Enter a paper weight to convert.');
assert.equal(failure('eighty', 'text'), 'Enter the weight as a number, such as 80 or 118.4.');
assert.equal(failure('80 lb', 'text'), 'Enter the weight as a number, such as 80 or 118.4.');
assert.equal(failure('1,00', 'gsm'), 'Enter the weight as a number, such as 80 or 118.4.');
assert.equal(run('1,000', 'gsm').metric, '1,000 g/m\u00b2', 'grouped thousands are accepted');
assert.equal(run('1,500.5', 'gsm').gsmText, '1,500.5');
assert.equal(failure('8 0', 'text'), 'Enter the weight as a number, such as 80 or 118.4.');
assert.equal(failure('1e3', 'gsm'), 'Enter the weight as a number, such as 80 or 118.4.');
assert.equal(failure('80.', 'gsm'), 'Enter the weight as a number, such as 80 or 118.4.');
assert.equal(failure('0', 'gsm'), 'Enter a weight of at least 1.');
assert.equal(failure('0.5', 'gsm'), 'Enter a weight of at least 1.');
assert.equal(failure('-5', 'text'), 'Enter a weight of at least 1.');
assert.equal(failure('2500', 'gsm'), 'Enter a weight of at most 2,000 g/m\u00b2.');
assert.equal(failure('2000.1', 'gsm'), 'Enter a weight of at most 2,000 g/m\u00b2.');
assert.equal(failure('600', 'bond'),
  'That is heavier than 2,000 g/m\u00b2, the heaviest paper this converter covers.');
assert.equal(failure('.5', 'bond'), null, 'a leading decimal point is accepted');
assert.equal(run('.5', 'bond').fromText, '0.5 lb bond');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2267, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Paper Weight Converter');
assert.equal(record.category, 'Converters');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1f4c4}');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('453.59237'), 'method states the exact pound');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 4, 'sources are cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 21, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 9, 'nine validation cases');
for (const testCase of record.testCases) {
  const value = testCase.input.value;
  const unit = testCase.input.unit;
  if (testCase.expectedError) {
    assert.equal(failure(value, unit), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(value, unit);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (key === 'rows') {
      const published = result.rows.map((row) => ({ id: row.id, label: row.label, base: row.base, lbText: row.lbText }));
      assert.deepEqual(published, expected, testCase.name + ' rows');
      continue;
    }
    assert.deepEqual(result[key], expected, testCase.name + ' ' + key);
  }
}

// The new record's slug, name and aliases must not collide with any other record.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');
for (const tag of ['paper-weight', 'basis-weight', 'gsm', 'lb-text', 'lb-cover']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 6, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="weight">/.test(html) && /<label for="unit">/.test(html), 'both controls have visible labels');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status"/.test(html), 'copy feedback is announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="decimal"/.test(html), 'a numeric keyboard is offered on touch');
assert.equal((html.match(/<option value="/g) || []).length, 7, 'seven units in the picker');
for (const grade of C.GRADES) {
  assert.ok(html.includes('<option value="' + grade.id + '"'), 'unit option present: ' + grade.id);
}
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('paper weight converter: 9 reference weighings, 200 random conversions, 21 catalog cases and the page contract pass');
