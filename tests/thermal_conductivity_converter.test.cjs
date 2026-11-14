/* Thermal conductivity converter: exact unit factors, formatting, golden
   conversions, random round trips, validation messages, catalog replay and the
   page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'thermal-conductivity-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* thermal-conductivity-core:start */';
const endMarker = '/* thermal-conductivity-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ThermalConductivityCore;', sandbox);
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
assert.equal(C.CALORIE_JOULES, 4.184);
assert.equal(C.HOUR_SECONDS, 3600);
assert.equal(C.FOOT_METRES, 0.3048);
assert.equal(C.INCH_METRES, 0.0254);
assert.equal(C.KELVIN_PER_FAHRENHEIT, 5 / 9);
assert.equal(C.MAX_BASE, 1000000);
assert.equal(C.DEFAULT_VALUE, '0.04');
assert.equal(C.DEFAULT_FROM, 'w-mk');
assert.equal(C.DEFAULT_TO, 'btu-in-h-ft2-f');
assert.deepEqual(plain(C.UNITS.map((unit) => [unit.id, unit.symbol])), [
  ['w-mk', 'W/(m\u00b7K)'],
  ['mw-mk', 'mW/(m\u00b7K)'],
  ['kw-mk', 'kW/(m\u00b7K)'],
  ['w-cm-c', 'W/(cm\u00b7\u00b0C)'],
  ['btu-h-ft-f', 'Btu/(h\u00b7ft\u00b7\u00b0F)'],
  ['btu-in-h-ft2-f', 'Btu\u00b7in/(h\u00b7ft\u00b2\u00b7\u00b0F)'],
  ['cal-s-cm-c', 'cal/(s\u00b7cm\u00b7\u00b0C)'],
  ['kcal-h-m-c', 'kcal/(h\u00b7m\u00b7\u00b0C)']
]);

// ---- Every scale follows from the base watt per metre-kelvin by definition.
const BTU = 1055.05585262;
const HOUR = 3600;
const FOOT = 0.3048;
const INCH = 0.0254;
const KPF = 5 / 9;
const EXPECTED_SCALES = {
  'w-mk': 1,
  'mw-mk': 0.001,
  'kw-mk': 1000,
  'w-cm-c': 100,
  'btu-h-ft-f': BTU / (HOUR * FOOT * KPF),
  'btu-in-h-ft2-f': BTU * INCH / (HOUR * FOOT * FOOT * KPF),
  'cal-s-cm-c': 4.184 / 0.01,
  'kcal-h-m-c': 1000 * 4.184 / HOUR
};
for (const unit of C.UNITS) {
  assert.ok(Math.abs(unit.scale - EXPECTED_SCALES[unit.id]) < 1e-12, unit.id + ' scale');
}
assert.ok(Math.abs(C.unitOf('btu-h-ft-f').scale - 1.730734666371391) < 1e-12, 'Btu per hour-foot');
assert.ok(Math.abs(C.unitOf('btu-in-h-ft2-f').scale - 0.14422788886428256) < 1e-15, 'Btu-inch');
assert.equal(C.unitOf('nonsense').id, 'w-mk', 'an unknown unit falls back to SI');
assert.equal(C.unitOf(null).id, 'w-mk', 'a missing unit falls back to SI');
assert.equal(C.unitOf(' BTU-IN-H-FT2-F ').id, 'btu-in-h-ft2-f', 'unit ids are case-folded and trimmed');

// ---- Formatting: six significant digits, trailing zeros trimmed, thousands grouped.
assert.equal(C.format(0), '0');
assert.equal(C.format(1), '1');
assert.equal(C.format(0.5), '0.5');
assert.equal(C.format(401), '401');
assert.equal(C.format(2780.3221912049075), '2,780.32');
assert.equal(C.format(0.277338852), '0.277339');
assert.equal(C.format(0.02311157266171993), '0.0231116');
assert.equal(C.format(1234567), '1,234,567');
assert.equal(C.format(999999.95), '1,000,000', 'a rounding carry groups correctly');
assert.equal(C.format(0.000001), '0.000001');
assert.equal(C.format(1e-7), '1e-7');
assert.equal(C.format(1.1622222222222223), '1.16222');
assert.equal(C.format(-2.5), '-2.5', 'the formatter itself keeps a sign');
assert.equal(C.format(1e12), '1e12');

// ---- Base conversion helpers.
assert.ok(Math.abs(C.toBase(0.04, 'w-mk') - 0.04) < 1e-15);
assert.ok(Math.abs(C.toBase(1, 'btu-in-h-ft2-f') - 0.14422788886428256) < 1e-15);
assert.ok(Math.abs(C.fromBase(1, 'cal-s-cm-c') - 1 / 418.4) < 1e-15);
assert.ok(Math.abs(C.fromBase(C.toBase(7.25, 'kcal-h-m-c'), 'w-mk') - 8.426111111111112) < 1e-12);

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
  { value: '0.04', from: 'w-mk', to: 'btu-in-h-ft2-f', toText: '0.277339 Btu\u00b7in/(h\u00b7ft\u00b2\u00b7\u00b0F)',
    equation: '0.04 W/(m\u00b7K) = 0.277339 Btu\u00b7in/(h\u00b7ft\u00b2\u00b7\u00b0F)' },
  { value: '0.04', from: 'w-mk', to: 'btu-h-ft-f', toText: '0.0231116 Btu/(h\u00b7ft\u00b7\u00b0F)',
    equation: '0.04 W/(m\u00b7K) = 0.0231116 Btu/(h\u00b7ft\u00b7\u00b0F)' },
  { value: '401', from: 'w-mk', to: 'btu-in-h-ft2-f', toText: '2,780.32 Btu\u00b7in/(h\u00b7ft\u00b2\u00b7\u00b0F)',
    equation: '401 W/(m\u00b7K) = 2,780.32 Btu\u00b7in/(h\u00b7ft\u00b2\u00b7\u00b0F)' },
  { value: '1', from: 'btu-h-ft-f', to: 'w-mk', toText: '1.73073 W/(m\u00b7K)',
    equation: '1 Btu/(h\u00b7ft\u00b7\u00b0F) = 1.73073 W/(m\u00b7K)' },
  { value: '1', from: 'btu-in-h-ft2-f', to: 'w-mk', toText: '0.144228 W/(m\u00b7K)',
    equation: '1 Btu\u00b7in/(h\u00b7ft\u00b2\u00b7\u00b0F) = 0.144228 W/(m\u00b7K)' },
  { value: '1', from: 'cal-s-cm-c', to: 'w-mk', toText: '418.4 W/(m\u00b7K)',
    equation: '1 cal/(s\u00b7cm\u00b7\u00b0C) = 418.4 W/(m\u00b7K)' },
  { value: '10', from: 'kcal-h-m-c', to: 'w-mk', toText: '11.6222 W/(m\u00b7K)',
    equation: '10 kcal/(h\u00b7m\u00b7\u00b0C) = 11.6222 W/(m\u00b7K)' },
  { value: '1', from: 'w-cm-c', to: 'w-mk', toText: '100 W/(m\u00b7K)',
    equation: '1 W/(cm\u00b7\u00b0C) = 100 W/(m\u00b7K)' },
  { value: '1000', from: 'mw-mk', to: 'w-mk', toText: '1 W/(m\u00b7K)',
    equation: '1,000 mW/(m\u00b7K) = 1 W/(m\u00b7K)' },
  { value: '1', from: 'w-mk', to: 'w-mk', toText: '1 W/(m\u00b7K)',
    equation: '1 W/(m\u00b7K) = 1 W/(m\u00b7K)' },
  { value: '.5', from: 'kw-mk', to: 'cal-s-cm-c', toText: '1.19503 cal/(s\u00b7cm\u00b7\u00b0C)',
    equation: '0.5 kW/(m\u00b7K) = 1.19503 cal/(s\u00b7cm\u00b7\u00b0C)' }
];
for (const item of REFERENCE) {
  const result = run(item.value, item.from, item.to);
  assert.equal(result.toText, item.toText, item.value + ' ' + item.from + ' -> ' + item.to);
  assert.equal(result.equation, item.equation, item.value + ' ' + item.from + ' equation');
  assert.equal(result.from, C.unitOf(item.from).id);
  assert.equal(result.to, C.unitOf(item.to).id);
}

// ---- The identity case never drifts and keeps the entered figure.
const identity = run('0.000123456789', 'w-mk', 'w-mk');
assert.equal(identity.result, 0.000123456789);
assert.equal(identity.toText, '0.000123457 W/(m\u00b7K)');

// ---- Reference materials: typical values, pinned and descending.
assert.deepEqual(plain(C.MATERIALS.map((material) => [material.name, material.k])), [
  ['Copper, pure', 401],
  ['Aluminium, pure', 237],
  ['Mild steel', 50],
  ['Stainless steel, 18/8', 16],
  ['Window glass', 1],
  ['Water, liquid', 0.6],
  ['Brick, common', 0.6],
  ['Mineral wool', 0.04],
  ['Still air', 0.026],
  ['Polyurethane foam', 0.025]
]);
for (let index = 1; index < C.MATERIALS.length; index += 1) {
  assert.ok(C.MATERIALS[index].k <= C.MATERIALS[index - 1].k, 'materials run from conductive to insulating');
}
const imperial = C.unitOf(C.DEFAULT_TO);
assert.equal(C.format(C.fromBase(401, imperial)), '2,780.32');
assert.equal(C.format(C.fromBase(0.025, imperial)), '0.173337');

// ---- Range edges and refusals.
assert.equal(run('1000000', 'w-mk', 'w-mk').toText, '1,000,000 W/(m\u00b7K)');
assert.equal(run('1000', 'kw-mk', 'w-mk').toText, '1,000,000 W/(m\u00b7K)');
assert.equal(failure('1000000.1', 'w-mk', 'w-mk'), 'Enter a value of at most 1,000,000 W/(m\u00b7K).');
assert.equal(failure('1001', 'kw-mk', 'w-mk'), 'Enter a value of at most 1,000,000 W/(m\u00b7K).');
assert.equal(run('0', 'w-mk', 'btu-in-h-ft2-f').toText, '0 Btu\u00b7in/(h\u00b7ft\u00b2\u00b7\u00b0F)');
assert.equal(run('2000', 'btu-in-h-ft2-f', 'w-mk').toText, '288.456 W/(m\u00b7K)');
assert.equal(failure('6950000', 'btu-in-h-ft2-f', 'w-mk'), 'Enter a value of at most 1,000,000 W/(m\u00b7K).');

// ---- Input parsing.
assert.equal(failure('', 'w-mk', 'w-mk'), 'Enter a thermal conductivity value to convert.');
assert.equal(failure('   ', 'w-mk', 'w-mk'), 'Enter a thermal conductivity value to convert.');
assert.equal(failure(null, 'w-mk', 'w-mk'), 'Enter a thermal conductivity value to convert.');
assert.equal(failure(undefined, 'w-mk', 'w-mk'), 'Enter a thermal conductivity value to convert.');
assert.equal(failure('abc', 'w-mk', 'w-mk'), 'Enter the value as a number, such as 0.04.');
assert.equal(failure('0.04 W/mK', 'w-mk', 'w-mk'), 'Enter the value as a number, such as 0.04.');
assert.equal(failure('1e3', 'w-mk', 'w-mk'), 'Enter the value as a number, such as 0.04.');
assert.equal(failure('0.0.4', 'w-mk', 'w-mk'), 'Enter the value as a number, such as 0.04.');
assert.equal(failure('-1', 'w-mk', 'w-mk'), 'Thermal conductivity cannot be negative.');
assert.equal(failure('-0.001', 'btu-h-ft-f', 'w-mk'), 'Thermal conductivity cannot be negative.');
assert.equal(run('1,000', 'mw-mk', 'w-mk').toText, '1 W/(m\u00b7K)', 'grouped thousands are accepted');
assert.equal(run(' 0.04 ', 'w-mk', 'btu-in-h-ft2-f').toText, '0.277339 Btu\u00b7in/(h\u00b7ft\u00b2\u00b7\u00b0F)',
  'surrounding whitespace is trimmed');
assert.equal(run('.5', 'w-mk', 'w-mk').toText, '0.5 W/(m\u00b7K)', 'a leading decimal point is accepted');

// ---- Random values: monotonic in the linear unit, stable formatted round trips.
let seed = 20261114;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let iteration = 0; iteration < 240; iteration += 1) {
  const places = iteration % 4;
  const value = Number((random() * 400).toFixed(places));
  const unit = C.UNITS[iteration % C.UNITS.length];
  const target = C.UNITS[(iteration * 3 + 5) % C.UNITS.length];
  const label = 'random ' + value + ' ' + unit.id + ' -> ' + target.id;
  const result = run(String(value), unit.id, target.id);

  assert.equal(result.base, value * unit.scale, label + ' base');
  const slack = Math.abs(result.base) * 1e-12 + 1e-12;
  assert.ok(Math.abs(result.result * target.scale - result.base) <= slack, label + ' back to base');
  assert.ok(Math.abs(result.result - result.base / target.scale) <= slack / target.scale, label + ' quotient');
  assert.match(result.toText, /^-?[\d,]+(?:\.\d+)?(?:e[+-]?\d+)? \S+$/, label + ' text shape');
  assert.deepEqual(run(String(value), unit.id, target.id), result, label + ' deterministic');

  const again = run(result.toText.split(' ')[0].replace(/,/g, ''), target.id, unit.id);
  const tolerance = Math.max(Math.abs(value), 1e-12) * 2e-5;
  assert.ok(Math.abs(again.result - value) <= tolerance, label + ' six-digit round trip');
}

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2272, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Thermal Conductivity Converter');
assert.equal(record.category, 'Converters');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1f321}');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('1055.05585262'), 'method states the exact Btu');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 3, 'sources are cited');
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
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');
for (const tag of ['thermal', 'conductivity', 'unit-conversion', 'insulation', 'heat-transfer']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 6, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="value">/.test(html), 'the value field has a visible label');
assert.ok(/<label for="from-unit">/.test(html) && /<label for="to-unit">/.test(html), 'both unit pickers have labels');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
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

console.log('thermal conductivity converter: 8 units, 11 reference conversions, 240 random round trips, 12 catalog cases and the page contract pass');
