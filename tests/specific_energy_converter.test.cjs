/* Specific energy converter: exact unit identities, reference conversions,
   formatting, mass totals, round trips, validation messages, catalog replay
   and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'specific-energy-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* specific-energy-core:start */';
const endMarker = '/* specific-energy-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SpecificEnergyCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (value, from, to, mass) => plain(C.parse(value, from, to, mass));
const failure = (value, from, to, mass) => {
  try { run(value, from, to, mass); } catch (error) { return error.message; }
  return null;
};

// ---- Exported contract.
assert.equal(C.MAX_JPK, 1e9);
assert.equal(C.MAX_MASS, 1e6);
assert.equal(C.MIN_EXPONENT, 0.0001);
assert.equal(C.MAX_DECIMAL, 1e13);
assert.equal(C.DEFAULT_VALUE, '45.5');
assert.equal(C.DEFAULT_FROM, 'mj-kg');
assert.equal(C.DEFAULT_TO, 'kwh-kg');
assert.equal(C.UNITS.length, 9, 'nine specific-energy units');
assert.equal(C.FAMILIES.length, 3, 'three unit families');

// ---- The unit table: unique ids and short symbols, exact factors in J/kg.
assert.equal(new Set(C.UNITS.map((unit) => unit.id)).size, 9);
assert.equal(new Set(C.UNITS.map((unit) => unit.short)).size, 9);
for (const unit of C.UNITS) {
  assert.ok(C.FAMILIES.some((family) => family.id === unit.family), 'unit family exists: ' + unit.id);
  assert.ok(unit.factor > 0 && Number.isFinite(unit.factor), 'unit factor is a positive number: ' + unit.id);
}
const byId = (id) => C.UNITS.find((unit) => unit.id === id);
assert.equal(byId('j-kg').factor, 1);
assert.equal(byId('kj-kg').factor, 1000);
assert.equal(byId('mj-kg').factor, 1e6);
assert.equal(byId('gj-t').factor, 1e6);
assert.equal(byId('kwh-kg').factor, 3.6e6);
assert.equal(byId('wh-kg').factor, 3600);
assert.equal(byId('cal-g').factor, 4184);
assert.equal(byId('kcal-kg').factor, 4184);
assert.equal(byId('btu-lb').factor, 2326);

// ---- The factors follow their definitions, not just each other.
assert.equal(byId('kwh-kg').factor, 1000 * byId('wh-kg').factor, 'a kilowatt hour is 1000 watt hours');
assert.equal(byId('mj-kg').factor, 1000 * byId('kj-kg').factor, 'a megajoule is 1000 kilojoules');
assert.equal(byId('cal-g').factor, 1000 * 4.184, 'cal/g is 1000 thermochemical calories per kg');
assert.equal(byId('kcal-kg').factor, 1000 * 4.184, 'kcal/kg is 1000 calories per kg');
assert.equal(byId('btu-lb').factor, 1055.05585262 / 0.45359237, 'Btu/lb is IT BTU over the avoirdupois pound');
assert.equal(byId('btu-lb').factor, 2326, 'the IT BTU per pound is exactly 2326 J/kg');
assert.equal(byId('gj-t').factor, byId('mj-kg').factor, 'a gigajoule per tonne is a megajoule per kilogram');

// ---- Formatting: six significant digits, grouped thousands, exponent at the edges.
assert.equal(C.formatEnergy(0), '0');
assert.equal(C.formatEnergy(45.5), '45.5');
assert.equal(C.formatEnergy(12.638888888888889), '12.6389');
assert.equal(C.formatEnergy(2326), '2,326');
assert.equal(C.formatEnergy(1000000000), '1,000,000,000');
assert.equal(C.formatEnergy(0.2777777777777778), '0.277778');
assert.equal(C.formatEnergy(0.0001), '0.0001');
assert.equal(C.formatEnergy(0.00009999), '9.999e-5');
assert.equal(C.formatEnergy(1e-6), '1e-6');
assert.equal(C.formatEnergy(1e13), '1e+13');
assert.equal(C.formatEnergy(1.005), '1.005');

// ---- Reference conversions (exact arithmetic on the defined factors).
const golden = [
  ['45.5', 'mj-kg', 'kwh-kg', 45.5 / 3.6, '12.6389 kWh/kg'],
  ['1', 'kwh-kg', 'mj-kg', 3.6, '3.6 MJ/kg'],
  ['1', 'btu-lb', 'j-kg', 2326, '2,326 J/kg'],
  ['1', 'cal-g', 'j-kg', 4184, '4,184 J/kg'],
  ['12,000', 'j-kg', 'kj-kg', 12, '12 kJ/kg'],
  ['1', 'gj-t', 'mj-kg', 1, '1 MJ/kg'],
  ['1', 'kcal-kg', 'cal-g', 1, '1 cal/g'],
  ['1', 'wh-kg', 'j-kg', 3600, '3,600 J/kg'],
  ['0', 'mj-kg', 'kwh-kg', 0, '0 kWh/kg']
];
for (const [value, from, to, want, text] of golden) {
  const result = run(value, from, to);
  assert.ok(Math.abs(result.value - want) <= Math.abs(want) * 1e-12, value + ' ' + from + ' -> ' + to);
  assert.equal(result.bigText, text, value + ' ' + from + ' -> ' + to + ' text');
  assert.equal(result.subText, C.formatEnergy(Number(value.replace(/,/g, ''))) + ' ' + byId(from).short + ' = ' + text);
  assert.equal(result.total, null, 'no total without a mass');
}

// ---- Round trips across every unit pair.
const seeded = (() => {
  let state = 20261117;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
})();
let roundTrips = 0;
for (let index = 0; index < 400; index += 1) {
  const from = C.UNITS[Math.floor(seeded() * C.UNITS.length)];
  const to = C.UNITS[Math.floor(seeded() * C.UNITS.length)];
  const ceiling = Math.min(1000, C.MAX_JPK / from.factor);
  const value = Math.round(seeded() * ceiling * 1e4) / 1e4;
  const result = C.convert(value, from.id, to.id);
  const expected = value * from.factor / to.factor;
  assert.ok(Math.abs(result.value - expected) <= Math.abs(expected) * 1e-12 + 1e-12,
    'conversion ' + value + ' ' + from.id + ' -> ' + to.id);
  const back = C.convert(result.value, to.id, from.id);
  assert.ok(Math.abs(back.value - value) <= Math.abs(value) * 1e-9 + 1e-9,
    'round trip ' + value + ' ' + from.id + ' -> ' + to.id);
  roundTrips += 1;
}
assert.equal(roundTrips, 400);
assert.equal(C.convert(42.125, 'mj-kg', 'mj-kg').value, 42.125, 'same-unit conversion is the identity');
assert.ok(Math.abs(C.convert(1, 'MJ-KG', 'mj-kg').value - 1) === 0, 'unit lookup is case-insensitive');

// ---- Identities between the units that hold exactly.
for (const [a, b] of [['gj-t', 'mj-kg'], ['kcal-kg', 'cal-g'], ['kj-kg', 'mj-kg'], ['wh-kg', 'kwh-kg']]) {
  const result = C.convert(1, a, b);
  assert.ok(Math.abs(result.value - byId(a).factor / byId(b).factor) < 1e-12, '1 ' + a + ' in ' + b);
}
assert.ok(Math.abs(C.convert(1, 'kwh-kg', 'mj-kg').value - 3.6) < 1e-12, '1 kWh/kg is 3.6 MJ/kg');
assert.ok(Math.abs(C.convert(1, 'kwh-kg', 'wh-kg').value - 1000) < 1e-12, '1 kWh/kg is 1000 Wh/kg');
assert.ok(Math.abs(C.convert(1, 'cal-g', 'kcal-kg').value - 1) < 1e-12, '1 cal/g is 1 kcal/kg');
assert.ok(Math.abs(C.convert(1, 'btu-lb', 'mj-kg').value - 0.002326) < 1e-15, '1 Btu/lb is 0.002326 MJ/kg');

// ---- Every supported unit is listed once, grouped under its family.
const table = run('45.5', 'mj-kg', 'kwh-kg');
assert.equal(table.families.length, 3);
let listed = 0;
for (const family of table.families) {
  assert.ok(family.label.length > 0);
  for (const item of family.items) {
    listed += 1;
    assert.equal(item.text, C.formatEnergy(item.value), 'table text matches the value: ' + item.id);
    assert.equal(item.value, table.joulesPerKg / byId(item.id).factor, 'table value uses the J/kg base: ' + item.id);
  }
}
assert.equal(listed, 9, 'the table covers every unit');
assert.equal(table.joulesPerKg, 45.5e6, '45.5 MJ/kg is 45.5 million joules per kilogram');
assert.equal(table.families[0].items.find((item) => item.id === 'mj-kg').text, '45.5');
assert.equal(table.families[1].items.find((item) => item.id === 'kwh-kg').text, '12.6389');

// ---- A mass turns specific energy into a total energy.
const batch = run('30', 'mj-kg', 'mj-kg', '2.5');
assert.equal(batch.total.massKg, 2.5);
assert.equal(batch.total.joules, 75e6);
assert.equal(batch.total.mj, 75);
assert.equal(batch.total.mjText, '75');
assert.equal(batch.total.kwhText, '20.8333');
assert.equal(batch.total.label, 'Energy in 2.5 kg');
const none = run('30', 'mj-kg', 'mj-kg', '');
assert.equal(none.total, null, 'an empty mass leaves the total out');
const zeroMass = run('30', 'mj-kg', 'mj-kg', '0');
assert.equal(zeroMass.total.joules, 0);
assert.equal(zeroMass.total.kwhText, '0');
const tonne = run('1', 'kj-kg', 'kj-kg', '1000');
assert.equal(tonne.total.mj, 1, '1 kJ/kg over one tonne is 1 MJ');

// ---- Validation.
assert.equal(failure('', 'mj-kg', 'kwh-kg'), 'Enter a specific energy to convert.');
assert.equal(failure('   ', 'mj-kg', 'kwh-kg'), 'Enter a specific energy to convert.');
assert.equal(failure('heavy', 'mj-kg', 'kwh-kg'), 'Enter the specific energy as a number, such as 45.5.');
assert.equal(failure('4.5e1', 'mj-kg', 'kwh-kg'), 'Enter the specific energy as a number, such as 45.5.');
assert.equal(failure('1,5', 'mj-kg', 'kwh-kg'), 'Enter the specific energy as a number, such as 45.5.');
assert.equal(failure('1.2.3', 'mj-kg', 'kwh-kg'), 'Enter the specific energy as a number, such as 45.5.');
assert.equal(failure('45.5 MJ/kg', 'mj-kg', 'kwh-kg'), 'Enter the specific energy as a number, such as 45.5.');
assert.equal(failure('-2', 'mj-kg', 'kwh-kg'), 'Enter a specific energy of zero or more.');
assert.equal(failure('1001', 'mj-kg', 'kwh-kg'), 'That is above 1,000 MJ/kg (1 GJ/kg), the largest value this converter covers.');
assert.equal(failure('45.5', 'ft-lb', 'kwh-kg'), 'Pick the unit the value is written in.');
assert.equal(failure('45.5', 'mj-kg', 'btu'), 'Pick the unit to convert to.');
assert.equal(failure('45.5', 'mj-kg', 'kwh-kg', 'heavy'), 'Enter the mass as a number, such as 10.');
assert.equal(failure('45.5', 'mj-kg', 'kwh-kg', '1000001'), 'That mass is above 1,000 tonnes (1,000,000 kg), the largest this converter covers.');
assert.equal(run('1000', 'mj-kg', 'j-kg').value, 1e9, 'the specific-energy ceiling is inclusive');
assert.ok(Math.abs(run('1000', 'j-kg', 'kj-kg', '1000').total.joules - 1e6) < 1e-9, 'the mass ceiling is inclusive');
assert.equal(run(' 0 ', 'mj-kg', 'kwh-kg').value, 0, 'a zero value is accepted');

// ---- The catalog record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(record.name, 'Specific Energy Converter');
assert.equal(record.category, 'Converters');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.method.length > 400, 'method paragraph describes the model');
assert.equal(record.sources.length, 2);
for (const source of record.sources) {
  assert.ok(source.title.length > 20, 'source title is specific');
  assert.ok(/^https:\/\//.test(source.url), 'source url is https: ' + source.url);
}
assert.equal(record.testCases.length, 25);
assert.equal(record.testCases.filter((test) => test.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((test) => test.kind === 'boundary').length, 6);
assert.equal(record.testCases.filter((test) => test.kind === 'validation').length, 9);
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
for (const tag of record.tags) assert.equal(tag, tag.toLowerCase(), 'tags are lowercase');
for (const tag of ['converters', 'specific-energy', 'mj-kg', 'kwh-kg', 'btu-lb']) {
  assert.ok(record.tags.includes(tag), 'tag present: ' + tag);
}
for (const alias of ['MJ/kg to kWh/kg Converter', 'mj/kg to kwh/kg converter', 'Energy per Mass Converter', 'energy per mass converter']) {
  assert.ok(record.aliases.includes(alias), 'alias present: ' + alias);
}

// ---- Catalog-wide uniqueness and the growth pins.
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
assert.equal(catalog.tools.length, 2520, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2259, 'public total');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Converters').length, 57, 'Converters count');

// ---- Replay every catalog case.
const pick = (result, key) => {
  switch (key) {
    case 'value': return result.value;
    case 'text': return result.bigText;
    case 'joulesPerKg': return result.joulesPerKg;
    case 'totalMj': return result.total.mj;
    case 'totalKwh': return result.total.kwh;
    case 'totalMjText': return result.total.mjText;
    case 'totalKwhText': return result.total.kwhText;
    default: throw new Error('unknown expected key: ' + key);
  }
};
let replayed = 0;
for (const testCase of record.testCases) {
  const input = testCase.input;
  if (testCase.kind === 'validation') {
    assert.equal(failure(input.value, input.from, input.to, input.mass), testCase.expectedError, testCase.name);
    replayed += 1;
    continue;
  }
  const result = C.parse(input.value, input.from, input.to, input.mass);
  for (const [key, want] of Object.entries(testCase.expected)) {
    const actual = pick(result, key);
    if (typeof want === 'number') {
      assert.ok(Math.abs(actual - want) <= Math.abs(want) * 2e-5 + 1e-12,
        testCase.name + ': ' + key + ' got ' + actual + ' want ' + want);
    } else {
      assert.equal(actual, want, testCase.name + ': ' + key);
    }
  }
  replayed += 1;
}
assert.equal(replayed, record.testCases.length);

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 9, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const id of ['value', 'from', 'to', 'mass']) {
  assert.ok(new RegExp('<label for="' + id + '">').test(html), 'control has a visible label: ' + id);
}
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status"/.test(html), 'copy feedback is announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="decimal"/.test(html), 'a numeric keyboard is offered on touch');
const options = [...html.matchAll(/<option value="([a-z-]+)"/g)].map((match) => match[1]);
assert.equal(options.length, 18, 'two pickers of nine units');
for (const unit of C.UNITS) {
  assert.equal(options.filter((id) => id === unit.id).length, 2, 'unit option appears in both pickers: ' + unit.id);
}
assert.ok(/<option value="mj-kg" selected>/.test(html) && /<option value="kwh-kg" selected>/.test(html), 'defaults are marked selected');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('specific energy converter: 9 golden conversions, 400 round trips, 25 catalog cases, mass totals and the page contract pass');
