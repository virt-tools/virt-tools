/* Specific heat capacity converter: exact unit factors from NIST SP 811
   Table B.8, formatting, golden conversions, random round trips, validation
   messages, catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'specific-heat-capacity-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* specific-heat-core:start */';
const endMarker = '/* specific-heat-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SpecificHeatCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (value, from, to) => plain(C.parse(value, from, to));
const failure = (value, from, to) => {
  try { run(value, from, to); } catch (error) { return error.message; }
  return null;
};

// ---- Exported constants and the unit table.
assert.equal(C.SIGNIFICANT_DIGITS, 6);
assert.equal(C.BTU_JOULES, 1055.05585262);
assert.equal(C.POUND_KILOGRAMS, 0.45359237);
assert.equal(C.CALORIE_IT_JOULES, 4.1868);
assert.equal(C.CALORIE_TH_JOULES, 4.184);
assert.equal(C.KILOWATT_HOUR_JOULES, 3600000);
assert.equal(C.KELVIN_PER_FAHRENHEIT, 5 / 9);
assert.equal(C.MAX_BASE, 100000000);
assert.equal(C.DEFAULT_VALUE, '1');
assert.equal(C.DEFAULT_FROM, 'calth-g-c');
assert.equal(C.DEFAULT_TO, 'btuit-lb-f');
assert.deepEqual(plain(C.UNITS.map((unit) => [unit.id, unit.symbol])), [
  ['j-kg-k', 'J/(kg\u00b7K)'],
  ['j-kg-c', 'J/(kg\u00b7\u00b0C)'],
  ['kj-kg-k', 'kJ/(kg\u00b7K)'],
  ['calit-g-c', 'cal_IT/(g\u00b7\u00b0C)'],
  ['calth-g-c', 'cal_th/(g\u00b7\u00b0C)'],
  ['btuit-lb-f', 'Btu_IT/(lb\u00b7\u00b0F)'],
  ['btuth-lb-f', 'Btu_th/(lb\u00b7\u00b0F)'],
  ['kwh-kg-k', 'kWh/(kg\u00b7K)']
]);

// ---- Every scale follows from the SI base by one exact definition.
const BTU = 1055.05585262;
const POUND = 0.45359237;
const KPF = 5 / 9;
const CAL_IT = 4.1868;
const CAL_TH = 4.184;
const BTU_PER_LB_F = BTU / (POUND * KPF);
const EXPECTED_SCALES = {
  'j-kg-k': 1,
  'j-kg-c': 1,
  'kj-kg-k': 1000,
  'calit-g-c': 1000 * CAL_IT,
  'calth-g-c': 1000 * CAL_TH,
  'btuit-lb-f': BTU_PER_LB_F,
  'btuth-lb-f': 1000 * CAL_TH,
  'kwh-kg-k': 3600000
};
for (const unit of C.UNITS) {
  assert.ok(Math.abs(unit.scale - EXPECTED_SCALES[unit.id]) < 1e-9, unit.id + ' scale');
}
// NIST SP 811 Table B.8 states both as 4.1868e3 J/(kg K): the International
// Table Btu per pound-Fahrenheit and the International Table calorie per gram.
assert.ok(Math.abs(BTU_PER_LB_F - 4186.8) < 1e-12, 'Btu_IT/(lb F) is exactly 4186.8 J/(kg K)');
assert.ok(Math.abs(C.unitOf('btuit-lb-f').scale - 1000 * CAL_IT) < 1e-9, 'the two IT values agree');
assert.ok(Math.abs(C.unitOf('btuth-lb-f').scale - 4184) < 1e-12, 'the two thermochemical values agree');
assert.equal(C.unitOf('nonsense').id, 'j-kg-k', 'an unknown unit falls back to SI');
assert.equal(C.unitOf(null).id, 'j-kg-k', 'a missing unit falls back to SI');
assert.equal(C.unitOf(' BTUIT-LB-F ').id, 'btuit-lb-f', 'unit ids are case-folded and trimmed');

// ---- Formatting: six significant digits, trailing zeros trimmed, thousands grouped.
assert.equal(C.format(0), '0');
assert.equal(C.format(1), '1');
assert.equal(C.format(0.5), '0.5');
assert.equal(C.format(4186.8), '4,186.8');
assert.equal(C.format(100000), '100,000');
assert.equal(C.format(0.9993308401642417), '0.999331');
assert.equal(C.format(1.0006692160611855), '1.00067');
assert.equal(C.format(27.77777777777778), '27.7778');
assert.equal(C.format(2.7777777777777776e-7), '2.77778e-7');
assert.equal(C.format(999999.95), '1,000,000', 'a rounding carry groups correctly');
assert.equal(C.format(1e-7), '1e-7');
assert.equal(C.format(-2.5), '-2.5', 'the formatter itself keeps a sign');
assert.equal(C.format(1e12), '1e12');

// ---- Base conversion helpers.
assert.ok(Math.abs(C.toBase(1, 'calth-g-c') - 4184) < 1e-12);
assert.ok(Math.abs(C.toBase(1, 'btuit-lb-f') - 4186.8) < 1e-9);
assert.ok(Math.abs(C.fromBase(4184, 'btuit-lb-f') - 4184 / 4186.8) < 1e-15);
assert.ok(Math.abs(C.fromBase(C.toBase(2.1, 'kj-kg-k'), 'j-kg-k') - 2100) < 1e-12);

// Every ordered pair round trips through the base unit.
for (const from of C.UNITS) {
  for (const to of C.UNITS) {
    const result = C.convert(3.14159, from.id, to.id);
    const back = C.convert(result.result, to.id, from.id);
    assert.ok(Math.abs(back.result - 3.14159) < 1e-12, from.id + ' -> ' + to.id + ' round trip');
  }
}

// ---- Golden conversions, each worked out independently from the factors above.
const REFERENCE = [
  { value: '1', from: 'calth-g-c', to: 'btuit-lb-f', toText: '0.999331 Btu_IT/(lb\u00b7\u00b0F)',
    equation: '1 cal_th/(g\u00b7\u00b0C) = 0.999331 Btu_IT/(lb\u00b7\u00b0F)' },
  { value: '4.184', from: 'kj-kg-k', to: 'calit-g-c', toText: '0.999331 cal_IT/(g\u00b7\u00b0C)',
    equation: '4.184 kJ/(kg\u00b7K) = 0.999331 cal_IT/(g\u00b7\u00b0C)' },
  { value: '4186.8', from: 'j-kg-k', to: 'btuth-lb-f', toText: '1.00067 Btu_th/(lb\u00b7\u00b0F)',
    equation: '4,186.8 J/(kg\u00b7K) = 1.00067 Btu_th/(lb\u00b7\u00b0F)' },
  { value: '2.1', from: 'kj-kg-k', to: 'j-kg-k', toText: '2,100 J/(kg\u00b7K)',
    equation: '2.1 kJ/(kg\u00b7K) = 2,100 J/(kg\u00b7K)' },
  { value: '0.001', from: 'kwh-kg-k', to: 'j-kg-k', toText: '3,600 J/(kg\u00b7K)',
    equation: '0.001 kWh/(kg\u00b7K) = 3,600 J/(kg\u00b7K)' },
  { value: '1', from: 'btuit-lb-f', to: 'calit-g-c', toText: '1 cal_IT/(g\u00b7\u00b0C)',
    equation: '1 Btu_IT/(lb\u00b7\u00b0F) = 1 cal_IT/(g\u00b7\u00b0C)' },
  { value: '0.9', from: 'j-kg-c', to: 'j-kg-k', toText: '0.9 J/(kg\u00b7K)',
    equation: '0.9 J/(kg\u00b7\u00b0C) = 0.9 J/(kg\u00b7K)' },
  { value: '4.1868', from: 'calit-g-c', to: 'kj-kg-k', toText: '17.5293 kJ/(kg\u00b7K)',
    equation: '4.1868 cal_IT/(g\u00b7\u00b0C) = 17.5293 kJ/(kg\u00b7K)' }
];
for (const item of REFERENCE) {
  const result = run(item.value, item.from, item.to);
  assert.equal(result.toText, item.toText, item.value + ' ' + item.from + ' -> ' + item.to);
  assert.equal(result.equation, item.equation, item.value + ' ' + item.from + ' equation');
  assert.equal(result.from, C.unitOf(item.from).id);
  assert.equal(result.to, C.unitOf(item.to).id);
  assert.equal(result.base, result.value * C.unitOf(item.from).scale);
}

// ---- The identity case never drifts and keeps the entered figure.
const identity = run('2.71828', 'j-kg-k', 'j-kg-k');
assert.equal(identity.result, 2.71828);
assert.equal(identity.toText, '2.71828 J/(kg\u00b7K)');

// ---- The reference table runs from low to high capacity in every column.
assert.deepEqual(plain(C.ROWS), [100, 500, 1000, 2000, 4184, 4186.8, 5000, 10000]);
for (let index = 1; index < C.ROWS.length; index += 1) {
  assert.ok(C.ROWS[index] > C.ROWS[index - 1], 'rows ascend');
}
assert.equal(C.format(C.fromBase(1000, 'calth-g-c')), '0.239006');
assert.equal(C.format(C.fromBase(1000, 'btuit-lb-f')), '0.238846');
assert.equal(C.format(C.fromBase(1000, 'kwh-kg-k')), '0.000277778');

// ---- Range edges and refusals.
assert.equal(run('100000000', 'j-kg-k', 'kwh-kg-k').toText, '27.7778 kWh/(kg\u00b7K)');
assert.equal(run('0.01', 'kwh-kg-k', 'j-kg-k').toText, '36,000 J/(kg\u00b7K)');
assert.equal(failure('100000000.1', 'j-kg-k', 'j-kg-k'),
  'Enter a value of at most 100,000,000 J/(kg\u00b7K).');
assert.equal(failure('100001', 'kj-kg-k', 'j-kg-k'),
  'Enter a value of at most 100,000,000 J/(kg\u00b7K).');
assert.equal(failure('100', 'kwh-kg-k', 'j-kg-k'), 'Enter a value of at most 100,000,000 J/(kg\u00b7K).');

// ---- Input parsing.
assert.equal(failure('', 'j-kg-k', 'j-kg-k'), 'Enter a specific heat capacity value to convert.');
assert.equal(failure('   ', 'j-kg-k', 'j-kg-k'), 'Enter a specific heat capacity value to convert.');
assert.equal(failure(null, 'j-kg-k', 'j-kg-k'), 'Enter a specific heat capacity value to convert.');
assert.equal(failure(undefined, 'j-kg-k', 'j-kg-k'), 'Enter a specific heat capacity value to convert.');
assert.equal(failure('abc', 'j-kg-k', 'j-kg-k'), 'Enter the value as a number, such as 4.184.');
assert.equal(failure('4.184 J/kgK', 'j-kg-k', 'j-kg-k'), 'Enter the value as a number, such as 4.184.');
assert.equal(failure('1e3', 'j-kg-k', 'j-kg-k'), 'Enter the value as a number, such as 4.184.');
assert.equal(failure('1.0.0', 'j-kg-k', 'j-kg-k'), 'Enter the value as a number, such as 4.184.');
assert.equal(failure('0', 'j-kg-k', 'j-kg-k'), 'Specific heat capacity must be greater than zero.');
assert.equal(failure('-1', 'calit-g-c', 'j-kg-k'), 'Specific heat capacity must be greater than zero.');
assert.equal(run('1,000', 'kj-kg-k', 'j-kg-k').toText, '1,000,000 J/(kg\u00b7K)',
  'grouped thousands are accepted');
assert.equal(run(' 4.184 ', 'calit-g-c', 'j-kg-k').toText, '17,517.6 J/(kg\u00b7K)',
  'surrounding whitespace is trimmed');
assert.equal(run('.5', 'j-kg-k', 'j-kg-k').toText, '0.5 J/(kg\u00b7K)',
  'a leading decimal point is accepted');

// ---- Random values: linear in the base unit, stable formatted round trips.
let seed = 20261115;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let iteration = 0; iteration < 240; iteration += 1) {
  const places = iteration % 4;
  const unit = C.UNITS[iteration % C.UNITS.length];
  const target = C.UNITS[(iteration * 3 + 5) % C.UNITS.length];
  const ceiling = Math.min(5000, 1e7 / unit.scale);
  let value = Number((random() * ceiling).toFixed(places));
  if (!(value > 0)) value = Number(Math.pow(10, -places).toFixed(places));
  const label = 'random ' + value + ' ' + unit.id + ' -> ' + target.id;
  const result = run(String(value), unit.id, target.id);

  assert.equal(result.base, value * unit.scale, label + ' base');
  const slack = Math.abs(result.base) * 1e-12 + 1e-12;
  assert.ok(Math.abs(result.result * target.scale - result.base) <= slack, label + ' back to base');
  assert.match(result.toText, /^[\d,]+(?:\.\d+)?(?:e[+-]?\d+)? \S+$/, label + ' text shape');
  assert.deepEqual(run(String(value), unit.id, target.id), result, label + ' deterministic');

  const again = run(result.toText.split(' ')[0].replace(/,/g, ''), target.id, unit.id);
  const tolerance = Math.max(Math.abs(value), 1e-9) * 2e-5;
  assert.ok(Math.abs(again.result - value) <= tolerance, label + ' six-digit round trip');
}

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2084, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Converters').length, 48, 'Converters count');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Specific Heat Capacity Converter');
assert.equal(record.category, 'Converters');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1f525}');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('1055.05585262'), 'method states the exact Btu');
assert.ok(record.method.includes('4.1868'), 'method states the International Table calorie');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.equal(record.sources.length, 1, 'one fetched source');
assert.equal(record.sources[0].url,
  'https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication811e2008.pdf');
assert.ok(record.sources[0].title.includes('Table B.8'), 'the source names the table');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 12, 'catalog case count');
assert.equal(kinds('golden'), 6, 'six golden cases');
assert.equal(kinds('boundary'), 2, 'two boundary cases');
assert.equal(kinds('validation'), 4, 'four validation cases');
for (const testCase of record.testCases) {
  const { value, from, to } = testCase.input;
  if (testCase.expectedError) {
    assert.equal(failure(value, from, to), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(value, from, to);
  for (const [key, expected] of Object.entries(testCase.expected)) {
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
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug],
    'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');
for (const tag of ['thermal', 'specific-heat', 'heat-capacity', 'unit-conversion']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 6, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="value">/.test(html), 'the value field has a visible label');
assert.ok(/<label for="from-unit">/.test(html) && /<label for="to-unit">/.test(html),
  'both unit pickers have labels');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/aria-atomic="true"/.test(html), 'the result block is atomic');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/<caption>/.test(html) && /<th scope="col">/.test(html), 'the reference table is described');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="decimal"/.test(html), 'a numeric keyboard is offered on touch');
assert.equal((html.match(/<option value="/g) || []).length, 16, 'eight units in each picker');
for (const unit of C.UNITS) {
  assert.ok(html.includes('<option value="' + unit.id + '"'), 'unit option present: ' + unit.id);
}
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('specific heat capacity converter: 8 units, 8 reference conversions, 240 random '
  + 'round trips, ' + record.testCases.length + ' catalog cases');
