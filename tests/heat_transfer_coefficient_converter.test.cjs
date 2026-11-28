/* Heat transfer coefficient converter: exact unit factors, formatting, golden
   conversions, random round trips, validation messages, catalog replay and the
   page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'heat-transfer-coefficient-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* heat-transfer-core:start */';
const endMarker = '/* heat-transfer-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = HeatTransferCore;', sandbox);
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
assert.equal(C.KELVIN_PER_FAHRENHEIT, 5 / 9);
assert.equal(C.CHU_BTU, 1.8);
assert.equal(C.MAX_BASE, 1000000);
assert.equal(C.DEFAULT_VALUE, '0.18');
assert.equal(C.DEFAULT_FROM, 'w-m2k');
assert.equal(C.DEFAULT_TO, 'btu-h-ft2-f');
assert.deepEqual(plain(C.UNITS.map((unit) => [unit.id, unit.symbol])), [
  ['w-m2k', 'W/(m\u00b2\u00b7K)'],
  ['w-m2c', 'W/(m\u00b2\u00b7\u00b0C)'],
  ['kw-m2k', 'kW/(m\u00b2\u00b7K)'],
  ['btu-h-ft2-f', 'Btu/(h\u00b7ft\u00b2\u00b7\u00b0F)'],
  ['btu-h-ft2-c', 'Btu/(h\u00b7ft\u00b2\u00b7\u00b0C)'],
  ['chu-h-ft2-f', 'CHU/(h\u00b7ft\u00b2\u00b7\u00b0F)'],
  ['kcal-h-m2-c', 'kcal/(h\u00b7m\u00b2\u00b7\u00b0C)'],
  ['cal-s-cm2-c', 'cal/(s\u00b7cm\u00b2\u00b7\u00b0C)']
]);

// ---- Every scale follows from the base watt per square metre-kelvin by definition.
const SQ_FOOT = 0.3048 * 0.3048;
const K_PER_F = 5 / 9;
const EXPECTED_SCALES = {
  'w-m2k': 1,
  'w-m2c': 1,
  'kw-m2k': 1000,
  'btu-h-ft2-f': 1055.05585262 / (3600 * SQ_FOOT * K_PER_F),
  'btu-h-ft2-c': 1055.05585262 / (3600 * SQ_FOOT),
  'chu-h-ft2-f': 1.8 * 1055.05585262 / (3600 * SQ_FOOT * K_PER_F),
  'kcal-h-m2-c': 4184 / 3600,
  'cal-s-cm2-c': 4.184 / 0.0001
};
for (const unit of C.UNITS) {
  assert.ok(Math.abs(unit.scale - EXPECTED_SCALES[unit.id]) <= Math.abs(EXPECTED_SCALES[unit.id]) * 1e-15,
    unit.id + ' scale');
}
assert.ok(Math.abs(C.unitOf('btu-h-ft2-f').scale - 5.67826334111349) < 1e-12, 'imperial U-value factor');
assert.ok(Math.abs(C.unitOf('btu-h-ft2-c').scale - 3.15459074506305) < 1e-12, 'Btu over a Celsius interval');
assert.ok(Math.abs(C.unitOf('chu-h-ft2-f').scale - 10.2208740140043) < 1e-12, 'Celsius heat unit factor');
assert.ok(Math.abs(C.unitOf('kcal-h-m2-c').scale - 1.16222222222222) < 1e-12, 'kilocalorie factor');
assert.equal(C.unitOf('cal-s-cm2-c').scale, 41840, 'CGS calorie factor');
assert.equal(C.unitOf('w-m2c').scale, C.unitOf('w-m2k').scale, 'a Celsius interval is a kelvin');
assert.equal(C.unitOf('nonsense').id, 'w-m2k', 'an unknown unit falls back to SI');
assert.equal(C.unitOf(null).id, 'w-m2k', 'a missing unit falls back to SI');
assert.equal(C.unitOf(' BTU-H-FT2-F ').id, 'btu-h-ft2-f', 'unit ids are case-folded and trimmed');

// ---- Formatting: six significant digits, trailing zeros trimmed, thousands grouped.
assert.equal(C.format(0), '0');
assert.equal(C.format(1), '1');
assert.equal(C.format(0.5), '0.5');
assert.equal(C.format(5.67826334111349), '5.67826');
assert.equal(C.format(0.031699833062815055), '0.0316998');
assert.equal(C.format(19.542780141499573), '19.5428');
assert.equal(C.format(1000000), '1,000,000');
assert.equal(C.format(672018.5), '672,019', 'six-digit ties round away from zero');
assert.equal(C.format(0.000001), '0.000001');
assert.equal(C.format(1e-7), '1e-7');
assert.equal(C.format(1e12), '1e12');
assert.equal(C.format(-2.5), '-2.5', 'the formatter itself keeps a sign');

// ---- Base conversion helpers.
assert.ok(Math.abs(C.toBase(0.18, 'w-m2k') - 0.18) < 1e-15);
assert.ok(Math.abs(C.toBase(1, 'kw-m2k') - 1000) < 1e-12);
assert.ok(Math.abs(C.fromBase(1000, 'kw-m2k') - 1) < 1e-15);
assert.ok(Math.abs(C.fromBase(C.toBase(0.3, 'btu-h-ft2-f'), 'btu-h-ft2-f') - 0.3) < 1e-12);

// Every ordered pair round trips through the base unit.
for (const from of C.UNITS) {
  for (const to of C.UNITS) {
    const result = C.convert(3.14159, from.id, to.id);
    const back = C.convert(result.result, to.id, from.id);
    assert.ok(Math.abs(back.result - 3.14159) < 1e-12, from.id + ' -> ' + to.id + ' round trip');
  }
}

// ---- Golden conversions, each derived independently from the SI and Btu definitions.
const REFERENCE = [
  { value: '0.18', from: 'w-m2k', to: 'btu-h-ft2-f', toText: '0.0316998 Btu/(h\u00b7ft\u00b2\u00b7\u00b0F)' },
  { value: '0.18', from: 'w-m2k', to: 'kcal-h-m2-c', toText: '0.154876 kcal/(h\u00b7m\u00b2\u00b7\u00b0C)' },
  { value: '0.3', from: 'w-m2k', to: 'chu-h-ft2-f', toText: '0.0293517 CHU/(h\u00b7ft\u00b2\u00b7\u00b0F)' },
  { value: '1', from: 'w-m2k', to: 'w-m2c', toText: '1 W/(m\u00b2\u00b7\u00b0C)' },
  { value: '5.8', from: 'w-m2k', to: 'btu-h-ft2-f', toText: '1.02144 Btu/(h\u00b7ft\u00b2\u00b7\u00b0F)' },
  { value: '1', from: 'btu-h-ft2-f', to: 'w-m2k', toText: '5.67826 W/(m\u00b2\u00b7K)' },
  { value: '4', from: 'btu-h-ft2-f', to: 'kcal-h-m2-c', toText: '19.5428 kcal/(h\u00b7m\u00b2\u00b7\u00b0C)' },
  { value: '0.5', from: 'chu-h-ft2-f', to: 'w-m2k', toText: '5.11044 W/(m\u00b2\u00b7K)' },
  { value: '1', from: 'cal-s-cm2-c', to: 'kw-m2k', toText: '41.84 kW/(m\u00b2\u00b7K)' },
  { value: '10', from: 'kcal-h-m2-c', to: 'btu-h-ft2-c', toText: '3.68423 Btu/(h\u00b7ft\u00b2\u00b7\u00b0C)' },
  { value: '0', from: 'w-m2k', to: 'btu-h-ft2-f', toText: '0 Btu/(h\u00b7ft\u00b2\u00b7\u00b0F)' },
  { value: '1,000', from: 'w-m2k', to: 'kw-m2k', toText: '1 kW/(m\u00b2\u00b7K)' },
  { value: '.35', from: 'w-m2k', to: 'btu-h-ft2-f', toText: '0.0616386 Btu/(h\u00b7ft\u00b2\u00b7\u00b0F)' },
  { value: '2.5', from: 'btu-h-ft2-c', to: 'w-m2k', toText: '7.88648 W/(m\u00b2\u00b7K)' },
  { value: '1000000', from: 'w-m2k', to: 'w-m2k', toText: '1,000,000 W/(m\u00b2\u00b7K)' }
];
for (const item of REFERENCE) {
  const result = run(item.value, item.from, item.to);
  assert.equal(result.toText, item.toText, item.value + ' ' + item.from + ' -> ' + item.to);
  assert.equal(result.equation,
    C.format(Number(item.value.replace(/,/g, ''))) + ' ' + C.unitOf(item.from).symbol + ' = ' + item.toText,
    item.value + ' ' + item.from + ' equation');
  const numeric = Number(item.value.replace(/,/g, ''));
  const expected = numeric * EXPECTED_SCALES[item.from] / EXPECTED_SCALES[item.to];
  assert.ok(Math.abs(result.result - expected) <= Math.abs(expected) * 1e-12 + 1e-300,
    item.value + ' ' + item.from + ' -> ' + item.to + ' value');
}

// ---- The reciprocal imperial R-value travels with every result.
const wall = run('0.18', 'w-m2k', 'btu-h-ft2-f');
assert.ok(Math.abs(wall.imperial - 0.031699833062815055) < 1e-15, 'imperial coefficient');
assert.ok(Math.abs(wall.rValue - 1 / wall.imperial) < 1e-12, 'reciprocal R-value');
assert.ok(Math.abs(run('5.8', 'w-m2k', 'btu-h-ft2-f').rValue - 0.979011) < 5e-6, 'R of single glazing');
assert.equal(run('0', 'w-m2k', 'btu-h-ft2-f').rValue, null, 'zero has no reciprocal');
assert.ok(Math.abs(run('37.8551', 'btu-h-ft2-f', 'w-m2k').rValue - 1 / 37.8551) < 1e-12,
  'an imperial input reports its own reciprocal');

// ---- The identity case never drifts and keeps six digits.
const identity = run('0.000123456789', 'w-m2k', 'w-m2k');
assert.equal(identity.result, 0.000123456789);
assert.equal(identity.toText, '0.000123457 W/(m\u00b2\u00b7K)');

// ---- Reference table: round U-values, ascending, with their reciprocals.
assert.deepEqual(plain(C.ROWS), [0.1, 0.15, 0.2, 0.25, 0.3, 0.5, 1, 2.8, 5.8]);
for (let index = 1; index < C.ROWS.length; index += 1) {
  assert.ok(C.ROWS[index] > C.ROWS[index - 1], 'reference rows ascend');
}
assert.equal(C.format(C.fromBase(0.18, 'kcal-h-m2-c')), '0.154876');
assert.equal(C.format(C.fromBase(5.8, 'kcal-h-m2-c')), '4.99044');
assert.equal(C.format(1 / C.fromBase(0.18, 'btu-h-ft2-f')), '31.5459');

// ---- Range edges and refusals.
assert.equal(run('1000000', 'w-m2k', 'w-m2k').toText, '1,000,000 W/(m\u00b2\u00b7K)');
assert.equal(run('1000', 'kw-m2k', 'w-m2k').toText, '1,000,000 W/(m\u00b2\u00b7K)');
assert.equal(failure('1000001', 'w-m2k', 'w-m2k'), 'Enter a value of at most 1,000,000 W/(m\u00b2\u00b7K).');
assert.equal(failure('1001', 'kw-m2k', 'w-m2k'), 'Enter a value of at most 1,000,000 W/(m\u00b2\u00b7K).');
assert.equal(failure('24', 'cal-s-cm2-c', 'w-m2k'), 'Enter a value of at most 1,000,000 W/(m\u00b2\u00b7K).');
assert.equal(run('0', 'chu-h-ft2-f', 'w-m2k').toText, '0 W/(m\u00b2\u00b7K)');
assert.equal(run('3141.59265358979', 'kcal-h-m2-c', 'btu-h-ft2-c').toText, '1,157.43 Btu/(h\u00b7ft\u00b2\u00b7\u00b0C)');

// ---- Input parsing.
assert.equal(failure('', 'w-m2k', 'btu-h-ft2-f'), 'Enter a heat transfer coefficient value to convert.');
assert.equal(failure('   ', 'w-m2k', 'btu-h-ft2-f'), 'Enter a heat transfer coefficient value to convert.');
assert.equal(failure(null, 'w-m2k', 'btu-h-ft2-f'), 'Enter a heat transfer coefficient value to convert.');
assert.equal(failure(undefined, 'w-m2k', 'btu-h-ft2-f'), 'Enter a heat transfer coefficient value to convert.');
assert.equal(failure('abc', 'w-m2k', 'btu-h-ft2-f'), 'Enter the value as a number, such as 0.18.');
assert.equal(failure('0.18 W/m2K', 'w-m2k', 'btu-h-ft2-f'), 'Enter the value as a number, such as 0.18.');
assert.equal(failure('1e3', 'w-m2k', 'btu-h-ft2-f'), 'Enter the value as a number, such as 0.18.');
assert.equal(failure('1.2.3', 'w-m2k', 'btu-h-ft2-f'), 'Enter the value as a number, such as 0.18.');
assert.equal(failure('1,00', 'w-m2k', 'btu-h-ft2-f'), 'Enter the value as a number, such as 0.18.');
assert.equal(failure('-1', 'w-m2k', 'btu-h-ft2-f'), 'Heat transfer coefficient cannot be negative.');
assert.equal(failure('-0.001', 'chu-h-ft2-f', 'w-m2k'), 'Heat transfer coefficient cannot be negative.');
assert.equal(run(' 0.18 ', 'w-m2k', 'btu-h-ft2-f').toText, '0.0316998 Btu/(h\u00b7ft\u00b2\u00b7\u00b0F)', 'whitespace is trimmed');
assert.equal(run('1,000,000', 'w-m2k', 'kw-m2k').toText, '1,000 kW/(m\u00b2\u00b7K)', 'grouped thousands are accepted');

// ---- Random values: linear in the base unit, stable formatted round trips.
let seed = 20261115;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let iteration = 0; iteration < 260; iteration += 1) {
  const places = iteration % 4;
  const value = Number((random() * 2).toFixed(places));
  const unit = C.UNITS[iteration % C.UNITS.length];
  const target = C.UNITS[(iteration * 5 + 3) % C.UNITS.length];
  const label = 'random ' + value + ' ' + unit.id + ' -> ' + target.id;
  const result = run(String(value), unit.id, target.id);

  assert.ok(Math.abs(result.base - value * unit.scale) <= Math.abs(result.base) * 1e-15 + 1e-15, label + ' base');
  const slack = Math.abs(result.base) * 1e-12 + 1e-12;
  assert.ok(Math.abs(result.result * target.scale - result.base) <= slack, label + ' back to base');
  assert.match(result.toText, /^[\d,]+(?:\.\d+)?(?:e[+-]?\d+)? \S+$/, label + ' text shape');
  assert.deepEqual(run(String(value), unit.id, target.id), result, label + ' deterministic');
  if (result.imperial > 0) {
    assert.ok(Math.abs(result.rValue * result.imperial - 1) <= 1e-9, label + ' reciprocal');
  }

  const again = run(result.toText.split(' ')[0].replace(/,/g, ''), target.id, unit.id);
  const tolerance = Math.max(Math.abs(value), 1e-12) * 2e-5;
  assert.ok(Math.abs(again.result - value) <= tolerance, label + ' six-digit round trip');
}

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Heat Transfer Coefficient Converter');
assert.equal(record.category, 'Converters');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u2668');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('5.67826334111349'), 'method states the imperial factor');
assert.ok(record.method.includes('1.8 Btu'), 'method states the Celsius heat unit');
assert.ok(record.method.includes('4.184'), 'method states the thermochemical calorie');
assert.ok(record.method.length > 1200, 'method documented');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.equal(record.sources.length, 3, 'three references');
assert.ok(record.sources.every((source) => /^https:\/\//.test(source.url)), 'sources carry https URLs');
assert.equal(record.testCases.length, 20, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 15, 'fifteen golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 5, 'five validation cases');
for (const testCase of record.testCases) {
  const { value, from, to } = testCase.input;
  if (testCase.kind === 'validation') {
    assert.equal(failure(value, from, to), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(value, from, to);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') {
      assert.ok(Math.abs(result[key] - expected) <= Math.abs(expected) * 1e-12 + 1e-300,
        testCase.name + ' ' + key);
    } else {
      assert.deepEqual(result[key], expected, testCase.name + ' ' + key);
    }
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
for (const tag of ['heat-transfer', 'u-value', 'r-value', 'unit-conversion']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && /(?:^|-)(?:heat-transfer|u-value)(?:-|$)/.test(tool.slug)),
  'no other heat transfer slug');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Converters').length, 58, 'Converters count');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 7, 'the page looks up its controls');
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

console.log('heat transfer coefficient converter: 8 units, 15 reference conversions, 260 random round trips, 20 catalog cases and the page contract pass');
