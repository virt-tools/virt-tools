/* Thermal expansion coefficient converter: the exact factors behind the seven
   units, the 9/5 kelvin-to-Fahrenheit relation, formatting, golden conversions
   derived from an independent Decimal model, random round trips, refusals,
   catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'thermal-expansion-coefficient-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* thermal-expansion-core:start */';
const endMarker = '/* thermal-expansion-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ThermalExpansionCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (value, from, to) => plain(C.parse(value, from, to));
const failure = (value, from, to) => {
  try { run(value, from, to); } catch (error) { return error.message; }
  return null;
};

// ---- Exported constants and the unit table.
assert.equal(C.SIGNIFICANT_DIGITS, 6);
assert.equal(C.MAX_BASE, 10);
assert.equal(C.MICRO, 1e-6);
assert.equal(C.KELVIN_PER_FAHRENHEIT, 5 / 9);
assert.equal(C.FAHRENHEIT_PER_KELVIN, 9 / 5);
assert.equal(C.DEFAULT_VALUE, '12');
assert.equal(C.DEFAULT_FROM, 'micro-per-kelvin');
assert.equal(C.DEFAULT_TO, 'microinch-per-inch-fahrenheit');
assert.deepEqual(plain(C.UNITS.map((unit) => [unit.id, unit.symbol])), [
  ['reciprocal-kelvin', '1/K'],
  ['reciprocal-celsius', '1/\u00b0C'],
  ['reciprocal-fahrenheit', '1/\u00b0F'],
  ['micro-per-kelvin', 'ppm/K'],
  ['micro-per-fahrenheit', 'ppm/\u00b0F'],
  ['micrometre-per-metre-kelvin', '\u00b5m/(m\u00b7K)'],
  ['microinch-per-inch-fahrenheit', '\u00b5in/(in\u00b7\u00b0F)']
]);

// ---- Every scale follows from 1/K by one exact definition.
const F_PER_K = 9 / 5;
const EXPECTED_SCALES = {
  'reciprocal-kelvin': 1,
  'reciprocal-celsius': 1,
  'reciprocal-fahrenheit': F_PER_K,
  'micro-per-kelvin': 1e-6,
  'micro-per-fahrenheit': 1e-6 * F_PER_K,
  'micrometre-per-metre-kelvin': 1e-6,
  'microinch-per-inch-fahrenheit': 1e-6 * F_PER_K
};
for (const unit of C.UNITS) {
  assert.ok(Math.abs(unit.scale - EXPECTED_SCALES[unit.id]) < 1e-18, unit.id + ' scale');
}
// A Fahrenheit degree interval is 5/9 K, so a reciprocal Fahrenheit is 9/5 per kelvin,
// and the micro forms keep the same ratio: 1 ppm/degF = 1.8e-6 /K and 1 microinch per
// inch-degF = 1 ppm/degF.
assert.ok(Math.abs(C.unitOf('reciprocal-fahrenheit').scale / C.unitOf('reciprocal-kelvin').scale - 1.8) < 1e-15);
assert.ok(Math.abs(C.unitOf('micro-per-fahrenheit').scale / C.unitOf('micro-per-kelvin').scale - 1.8) < 1e-15);
assert.ok(Math.abs(C.unitOf('microinch-per-inch-fahrenheit').scale - C.unitOf('micro-per-fahrenheit').scale) < 1e-24,
  'a microinch per inch is a part per million');
assert.equal(C.unitOf('micrometre-per-metre-kelvin').scale, C.unitOf('micro-per-kelvin').scale,
  'a micrometre per metre-kelvin is a ppm per kelvin');
assert.equal(C.unitOf('reciprocal-celsius').scale, C.unitOf('reciprocal-kelvin').scale,
  'a degree Celsius interval is a kelvin');
assert.equal(C.unitOf('nonsense').id, 'reciprocal-kelvin', 'an unknown unit falls back to SI');
assert.equal(C.unitOf(null).id, 'reciprocal-kelvin', 'a missing unit falls back to SI');
assert.equal(C.unitOf(' MICRO-PER-KELVIN ').id, 'micro-per-kelvin', 'unit ids are case-folded and trimmed');

// ---- Formatting: six significant digits, trailing zeros trimmed, thousands grouped.
assert.equal(C.format(0), '0');
assert.equal(C.format(1), '1');
assert.equal(C.format(12), '12');
assert.equal(C.format(0.5), '0.5');
assert.equal(C.format(6.666666666666667), '6.66667');
assert.equal(C.format(555555.5555555555), '555,556');
assert.equal(C.format(1200), '1,200');
assert.equal(C.format(0.000012777777), '0.0000127778');
assert.equal(C.format(-0.000009), '-0.000009');
assert.equal(C.format(1e-7), '1e-7');
assert.equal(C.format(1e12), '1e12');
assert.equal(C.format(-2.5), '-2.5', 'the formatter itself keeps a sign');
assert.equal(C.format(999999.95), '1,000,000', 'a rounding carry groups correctly');

// ---- Base conversion helpers.
assert.ok(Math.abs(C.toBase(1, 'reciprocal-fahrenheit') - 1.8) < 1e-15);
assert.ok(Math.abs(C.toBase(12, 'micro-per-kelvin') - 1.2e-5) < 1e-20);
assert.ok(Math.abs(C.fromBase(1.8e-5, 'microinch-per-inch-fahrenheit') - 10) < 1e-12);
assert.ok(Math.abs(C.fromBase(C.toBase(23, 'micro-per-kelvin'), 'reciprocal-kelvin') - 2.3e-5) < 1e-20);

// Every ordered pair round trips through the base unit.
for (const from of C.UNITS) {
  for (const to of C.UNITS) {
    const result = C.convert(3.14159e-4, from.id, to.id);
    const back = C.convert(result.result, to.id, from.id);
    assert.ok(Math.abs(back.result - 3.14159e-4) < 1e-20, from.id + ' -> ' + to.id + ' round trip');
  }
}

// ---- Golden conversions, each worked out independently with exact decimals.
const REFERENCE = [
  { value: '12', from: 'micro-per-kelvin', to: 'microinch-per-inch-fahrenheit',
    toText: '6.66667 \u00b5in/(in\u00b7\u00b0F)', equation: '12 ppm/K = 6.66667 \u00b5in/(in\u00b7\u00b0F)',
    strainMicrometres: 12 },
  { value: '1', from: 'reciprocal-fahrenheit', to: 'reciprocal-kelvin',
    toText: '1.8 1/K', equation: '1 1/\u00b0F = 1.8 1/K', strainMicrometres: 1800000 },
  { value: '23', from: 'micro-per-kelvin', to: 'reciprocal-fahrenheit',
    toText: '0.0000127778 1/\u00b0F', equation: '23 ppm/K = 0.0000127778 1/\u00b0F' },
  { value: '7.5', from: 'micro-per-fahrenheit', to: 'reciprocal-kelvin',
    toText: '0.0000135 1/K', equation: '7.5 ppm/\u00b0F = 0.0000135 1/K' },
  { value: '17', from: 'micrometre-per-metre-kelvin', to: 'micro-per-fahrenheit',
    toText: '9.44444 ppm/\u00b0F', equation: '17 \u00b5m/(m\u00b7K) = 9.44444 ppm/\u00b0F' },
  { value: '0.000012', from: 'reciprocal-kelvin', to: 'micro-per-kelvin',
    toText: '12 ppm/K', equation: '0.000012 1/K = 12 ppm/K' },
  { value: '1,200', from: 'micro-per-kelvin', to: 'reciprocal-fahrenheit',
    toText: '0.000666667 1/\u00b0F', equation: '1,200 ppm/K = 0.000666667 1/\u00b0F' },
  { value: '1', from: 'reciprocal-celsius', to: 'reciprocal-kelvin',
    toText: '1 1/K', equation: '1 1/\u00b0C = 1 1/K' },
  { value: '-9', from: 'micro-per-kelvin', to: 'reciprocal-kelvin',
    toText: '-0.000009 1/K', equation: '-9 ppm/K = -0.000009 1/K', strainMicrometres: -9 },
  { value: '1', from: 'reciprocal-kelvin', to: 'micro-per-fahrenheit',
    toText: '555,556 ppm/\u00b0F', equation: '1 1/K = 555,556 ppm/\u00b0F' }
];
for (const item of REFERENCE) {
  const result = run(item.value, item.from, item.to);
  assert.equal(result.toText, item.toText, item.value + ' ' + item.from + ' -> ' + item.to);
  assert.equal(result.equation, item.equation, item.value + ' ' + item.from + ' equation');
  assert.equal(result.from, C.unitOf(item.from).id);
  assert.equal(result.to, C.unitOf(item.to).id);
  assert.ok(Math.abs(result.base - result.value * C.unitOf(item.from).scale) < 1e-20,
    item.value + ' base');
  if (item.strainMicrometres !== undefined) {
    assert.equal(result.strainMicrometres, item.strainMicrometres, item.value + ' strain');
  }
}

// ---- The identity case never drifts and keeps the entered figure.
const identity = run('2.71828', 'micro-per-kelvin', 'micro-per-kelvin');
assert.equal(identity.result, 2.71828);
assert.equal(identity.toText, '2.71828 ppm/K');

// ---- The reference table pairs each round ppm/K value with its microinch reading.
assert.deepEqual(plain(C.ROWS), [1, 2, 5, 10, 12, 17, 23]);
for (let index = 1; index < C.ROWS.length; index += 1) {
  assert.ok(C.ROWS[index] > C.ROWS[index - 1], 'rows ascend');
}
assert.equal(C.format(C.fromBase(23 * 1e-6, 'microinch-per-inch-fahrenheit')), '12.7778');
assert.equal(C.format(C.fromBase(1 * 1e-6, 'microinch-per-inch-fahrenheit')), '0.555556');
assert.equal(C.format(C.fromBase(12 * 1e-6, 'microinch-per-inch-fahrenheit')), '6.66667');

// ---- Range edges: the ceiling, the floor, zero and negatives.
assert.equal(run('1', 'reciprocal-kelvin', 'micro-per-kelvin').toText, '1,000,000 ppm/K');
assert.equal(run('9.99', 'reciprocal-kelvin', 'micro-per-kelvin').toText, '9,990,000 ppm/K');
assert.equal(run('-1', 'reciprocal-kelvin', 'micro-per-kelvin').toText, '-1,000,000 ppm/K');
assert.equal(run('0', 'micro-per-kelvin', 'reciprocal-kelvin').toText, '0 1/K');
assert.equal(failure('10', 'reciprocal-kelvin', 'micro-per-kelvin'),
  'Enter a coefficient between -10 and 10 per kelvin.');
assert.equal(failure('-11', 'reciprocal-kelvin', 'micro-per-kelvin'),
  'Enter a coefficient between -10 and 10 per kelvin.');
assert.equal(failure('6000000', 'micro-per-fahrenheit', 'reciprocal-kelvin'),
  'Enter a coefficient between -10 and 10 per kelvin.', 'the ceiling is tested in base units');

// ---- Input parsing.
assert.equal(failure('', 'micro-per-kelvin', 'reciprocal-kelvin'),
  'Enter a thermal expansion coefficient to convert.');
assert.equal(failure('   ', 'micro-per-kelvin', 'reciprocal-kelvin'),
  'Enter a thermal expansion coefficient to convert.');
assert.equal(failure(null, 'micro-per-kelvin', 'reciprocal-kelvin'),
  'Enter a thermal expansion coefficient to convert.');
assert.equal(failure(undefined, 'micro-per-kelvin', 'reciprocal-kelvin'),
  'Enter a thermal expansion coefficient to convert.');
assert.equal(failure('steel', 'micro-per-kelvin', 'reciprocal-kelvin'),
  'Enter the value as a number, such as 12.');
assert.equal(failure('12 ppm/K', 'micro-per-kelvin', 'reciprocal-kelvin'),
  'Enter the value as a number, such as 12.');
assert.equal(failure('1e3', 'micro-per-kelvin', 'reciprocal-kelvin'),
  'Enter the value as a number, such as 12.');
assert.equal(failure('1.5.0', 'micro-per-kelvin', 'reciprocal-kelvin'),
  'Enter the value as a number, such as 12.');
assert.equal(run(' 12 ', 'micro-per-kelvin', 'reciprocal-kelvin').toText, '0.000012 1/K',
  'surrounding whitespace is trimmed');
assert.equal(run('.5', 'micro-per-kelvin', 'reciprocal-kelvin').toText, '5e-7 1/K',
  'a leading decimal point is accepted');
assert.equal(run('-0', 'micro-per-kelvin', 'reciprocal-kelvin').toText, '0 1/K',
  'a negative zero reads as zero');

// ---- Random values: linear in the base unit, stable formatted round trips.
let seed = 20261118;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let iteration = 0; iteration < 240; iteration += 1) {
  const places = iteration % 4;
  const unit = C.UNITS[iteration % C.UNITS.length];
  const target = C.UNITS[(iteration * 3 + 5) % C.UNITS.length];
  const ceiling = Math.min(0.9, 0.5 / unit.scale);
  let value = Number((random() * ceiling).toFixed(places));
  if (!(value > 0)) value = Number(Math.pow(10, -places).toFixed(places));
  const label = 'random ' + value + ' ' + unit.id + ' -> ' + target.id;
  const result = run(String(value), unit.id, target.id);

  assert.equal(result.base, value * unit.scale, label + ' base');
  const slack = Math.abs(result.base) * 1e-12 + 1e-30;
  assert.ok(Math.abs(result.result * target.scale - result.base) <= slack, label + ' back to base');
  assert.match(result.toText, /^-?[\d,]+(?:\.\d+)?(?:e[+-]?\d+)? \S+$/, label + ' text shape');
  assert.deepEqual(run(String(value), unit.id, target.id), result, label + ' deterministic');

  const token = result.toText.split(' ')[0].replace(/,/g, '');
  if (token.includes('e')) continue;
  const again = run(token, target.id, unit.id);
  const tolerance = Math.max(Math.abs(value), 1e-9) * 2e-5;
  assert.ok(Math.abs(again.result - value) <= tolerance, label + ' six-digit round trip');
}

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2191, 'public tools');
assert.equal(catalog.tools.length, 2452, 'catalog total');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Converters').length, 54, 'Converters count');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Thermal Expansion Coefficient Converter');
assert.equal(record.category, 'Converters');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1f321}');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('9/5'), 'method states the kelvin to Fahrenheit factor');
assert.ok(record.method.includes('1e-6/K'), 'method states the part per million');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.equal(record.sources.length, 1, 'one fetched source');
assert.equal(record.sources[0].url, 'https://en.wikipedia.org/wiki/Thermal_expansion');
assert.ok(record.sources[0].title.includes('Thermal expansion'), 'the source names the article');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 17, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 5, 'five validation cases');
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

// The record's slug, name and aliases must not collide with any other record.
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
for (const tag of ['thermal', 'thermal-expansion', 'expansion-coefficient', 'unit-conversion']) {
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
assert.equal((html.match(/<option value="/g) || []).length, 14, 'seven units in each picker');
for (const unit of C.UNITS) {
  assert.ok(html.includes('<option value="' + unit.id + '"'), 'unit option present: ' + unit.id);
}
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('thermal expansion coefficient converter: 7 units, ' + REFERENCE.length
  + ' reference conversions, 240 random round trips, ' + record.testCases.length + ' catalog cases');
