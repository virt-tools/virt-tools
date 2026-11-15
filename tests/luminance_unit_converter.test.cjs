/* Luminance unit converter: exact unit factors, formatting, golden conversions,
   random round trips, validation messages, catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'luminance-unit-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* luminance-core:start */';
const endMarker = '/* luminance-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = LuminanceCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (value, from, to) => plain(C.parse(value, from, to));
const failure = (value, from, to) => {
  try { run(value, from, to); } catch (error) { return error.message; }
  return null;
};

// ---- Exported constants and the unit table.
assert.equal(C.SIGNIFICANT_DIGITS, 6);
assert.equal(C.FOOT_METRES, 0.3048);
assert.equal(C.SQUARE_FOOT_SQUARE_METRES, 0.09290304);
assert.equal(C.STILB_CD_PER_SQUARE_METRE, 10000);
assert.equal(C.MAX_BASE, 10000000000);
assert.equal(C.DEFAULT_VALUE, '250');
assert.equal(C.DEFAULT_FROM, 'cd-m2');
assert.equal(C.DEFAULT_TO, 'fl');
assert.ok(Math.abs(C.PI - Math.PI) < 1e-15, 'pi is the platform constant');
assert.deepEqual(plain(C.UNITS.map((unit) => [unit.id, unit.symbol])), [
  ['cd-m2', 'cd/m\u00b2'],
  ['kcd-m2', 'kcd/m\u00b2'],
  ['mcd-m2', 'mcd/m\u00b2'],
  ['cd-cm2', 'cd/cm\u00b2'],
  ['cd-ft2', 'cd/ft\u00b2'],
  ['fl', 'fL'],
  ['lambert', 'L'],
  ['asb', 'asb']
]);

// ---- Every scale follows from the base candela per square metre by definition.
const SQ_FOOT = 0.3048 * 0.3048;
const CD_PER_SQFT = 1 / SQ_FOOT;
const EXPECTED_SCALES = {
  'cd-m2': 1,
  'kcd-m2': 1000,
  'mcd-m2': 0.001,
  'cd-cm2': 10000,
  'cd-ft2': CD_PER_SQFT,
  fl: CD_PER_SQFT / Math.PI,
  lambert: 10000 / Math.PI,
  asb: 1 / Math.PI
};
for (const unit of C.UNITS) {
  assert.ok(Math.abs(unit.scale - EXPECTED_SCALES[unit.id]) <= Math.abs(EXPECTED_SCALES[unit.id]) * 1e-15,
    unit.id + ' scale');
}
assert.ok(Math.abs(C.unitOf('cd-ft2').scale - 10.763910416709722) < 1e-12, 'candela per square foot');
assert.ok(Math.abs(C.unitOf('fl').scale - 3.4262590996353905) < 1e-12, 'foot-lambert');
assert.ok(Math.abs(C.unitOf('lambert').scale - 3183.098861837907) < 1e-9, 'lambert');
assert.ok(Math.abs(C.unitOf('asb').scale - 0.3183098861837907) < 1e-15, 'apostilb');
assert.equal(C.unitOf('nonsense').id, 'cd-m2', 'an unknown unit falls back to SI');
assert.equal(C.unitOf(null).id, 'cd-m2', 'a missing unit falls back to SI');
assert.equal(C.unitOf(' FL ').id, 'fl', 'unit ids are case-folded and trimmed');

// ---- Formatting: six significant digits, trailing zeros trimmed, thousands grouped.
assert.equal(C.format(0), '0');
assert.equal(C.format(1), '1');
assert.equal(C.format(0.5), '0.5');
assert.equal(C.format(3.4262590996353905), '3.42626');
assert.equal(C.format(10.763910416709722), '10.7639');
assert.equal(C.format(3183.098861837907), '3,183.1');
assert.equal(C.format(0.3183098861837907), '0.31831');
assert.equal(C.format(0.006283185307179587), '0.00628319');
assert.equal(C.format(466981613.038), '466,981,613');
assert.equal(C.format(0.000001), '0.000001');
assert.equal(C.format(1e-7), '1e-7');
assert.equal(C.format(1e12), '1e12');
assert.equal(C.format(-2.5), '-2.5', 'the formatter itself keeps a sign');

// ---- Base conversion helpers.
assert.ok(Math.abs(C.toBase(250, 'cd-m2') - 250) < 1e-12);
assert.ok(Math.abs(C.toBase(1, 'cd-cm2') - 10000) < 1e-12);
assert.ok(Math.abs(C.fromBase(1000, 'cd-cm2') - 0.1) < 1e-15);
assert.ok(Math.abs(C.fromBase(10000, 'stilb') - 10000) < 1e-12, 'unknown target falls back to SI');
assert.ok(Math.abs(C.fromBase(C.toBase(16, 'fl'), 'cd-m2') - 54.82014559336625) < 1e-9);

// Every ordered pair round trips through the base unit.
for (const from of C.UNITS) {
  for (const to of C.UNITS) {
    const result = C.convert(3.14159, from.id, to.id);
    const back = C.convert(result.result, to.id, from.id);
    assert.ok(Math.abs(back.result - 3.14159) < 1e-12, from.id + ' -> ' + to.id + ' round trip');
  }
}

// ---- Golden conversions, each derived independently from 0.3048 m per foot and pi.
const REFERENCE = [
  { value: '250', from: 'cd-m2', to: 'fl', toText: '72.9659 fL' },
  { value: '1000', from: 'cd-m2', to: 'cd-ft2', toText: '92.903 cd/ft\u00b2' },
  { value: '16', from: 'fl', to: 'cd-m2', toText: '54.8201 cd/m\u00b2' },
  { value: '1', from: 'cd-cm2', to: 'kcd-m2', toText: '10 kcd/m\u00b2' },
  { value: '1', from: 'lambert', to: 'cd-m2', toText: '3,183.1 cd/m\u00b2' },
  { value: '1', from: 'asb', to: 'mcd-m2', toText: '318.31 mcd/m\u00b2' },
  { value: '2', from: 'mcd-m2', to: 'asb', toText: '0.00628319 asb' },
  { value: '1600000000', from: 'cd-m2', to: 'fl', toText: '466,981,613 fL' },
  { value: '0', from: 'cd-m2', to: 'fl', toText: '0 fL' },
  { value: '1,000', from: 'cd-m2', to: 'kcd-m2', toText: '1 kcd/m\u00b2' },
  { value: '.5', from: 'fl', to: 'cd-m2', toText: '1.71313 cd/m\u00b2' },
  { value: '123.456789', from: 'cd-m2', to: 'cd-m2', toText: '123.457 cd/m\u00b2' }
];
for (const item of REFERENCE) {
  const result = run(item.value, item.from, item.to);
  assert.equal(result.toText, item.toText, item.value + ' ' + item.from + ' -> ' + item.to);
  assert.equal(result.equation,
    C.format(Number(item.value.replace(/,/g, ''))) + ' ' + C.unitOf(item.from).symbol + ' = ' + item.toText,
    item.value + ' ' + item.from + ' equation');
  const expected = Number(item.value.replace(/,/g, '')) * EXPECTED_SCALES[item.from] / EXPECTED_SCALES[item.to];
  assert.ok(Math.abs(result.result - expected) <= Math.abs(expected) * 1e-12 + 1e-300,
    item.value + ' ' + item.from + ' -> ' + item.to + ' value');
}

// ---- The identity case never drifts and keeps six digits.
const identity = run('0.000123456789', 'cd-m2', 'cd-m2');
assert.equal(identity.result, 0.000123456789);
assert.equal(identity.toText, '0.000123457 cd/m\u00b2');

// ---- Reference table: typical values, pinned and descending.
assert.deepEqual(plain(C.TYPICAL.map((item) => [item.name, item.cd])), [
  ['Sun disc, as seen from Earth', 1600000000],
  ['Overcast sky', 2000],
  ['HDR television highlight, peak patch', 1000],
  ['Office laptop display, full white', 250],
  ['White paper in a 300 lx office', 76],
  ['Cinema screen, SMPTE 196M (16 fL)', 54.8]
]);
for (let index = 1; index < C.TYPICAL.length; index += 1) {
  assert.ok(C.TYPICAL[index].cd <= C.TYPICAL[index - 1].cd, 'typical values run from bright to dim');
}
assert.equal(C.format(C.fromBase(1600000000, C.unitOf('fl'))), '466,981,613');
assert.equal(C.format(C.fromBase(54.8, C.unitOf('fl'))), '15.9941');

// ---- Range edges and refusals.
assert.equal(run('10000000000', 'cd-m2', 'cd-m2').toText, '10,000,000,000 cd/m\u00b2');
assert.equal(run('10000000', 'kcd-m2', 'cd-m2').toText, '10,000,000,000 cd/m\u00b2');
assert.equal(failure('10000000001', 'cd-m2', 'cd-m2'), 'Enter a value of at most 10,000,000,000 cd/m\u00b2.');
assert.equal(failure('10000001', 'kcd-m2', 'mcd-m2'), 'Enter a value of at most 10,000,000,000 cd/m\u00b2.');
assert.equal(failure('1000000000', 'lambert', 'cd-m2'), 'Enter a value of at most 10,000,000,000 cd/m\u00b2.');
assert.equal(run('0', 'asb', 'cd-cm2').toText, '0 cd/cm\u00b2');
assert.equal(run('3141.59265358979', 'cd-ft2', 'asb').toText, '106,236 asb');

// ---- Input parsing.
assert.equal(failure('', 'cd-m2', 'fl'), 'Enter a luminance value to convert.');
assert.equal(failure('   ', 'cd-m2', 'fl'), 'Enter a luminance value to convert.');
assert.equal(failure(null, 'cd-m2', 'fl'), 'Enter a luminance value to convert.');
assert.equal(failure(undefined, 'cd-m2', 'fl'), 'Enter a luminance value to convert.');
assert.equal(failure('abc', 'cd-m2', 'fl'), 'Enter the value as a number, such as 250.');
assert.equal(failure('250 cd/m2', 'cd-m2', 'fl'), 'Enter the value as a number, such as 250.');
assert.equal(failure('1e3', 'cd-m2', 'fl'), 'Enter the value as a number, such as 250.');
assert.equal(failure('1.2.3', 'cd-m2', 'fl'), 'Enter the value as a number, such as 250.');
assert.equal(failure('1,00', 'cd-m2', 'fl'), 'Enter the value as a number, such as 250.');
assert.equal(failure('-1', 'cd-m2', 'fl'), 'Luminance cannot be negative.');
assert.equal(failure('-0.001', 'asb', 'cd-m2'), 'Luminance cannot be negative.');
assert.equal(run(' 250 ', 'cd-m2', 'fl').toText, '72.9659 fL', 'whitespace is trimmed');
assert.equal(run('1,000,000', 'cd-m2', 'kcd-m2').toText, '1,000 kcd/m\u00b2', 'grouped thousands are accepted');

// ---- Random values: linear in the base unit, stable formatted round trips.
let seed = 20261114;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let iteration = 0; iteration < 240; iteration += 1) {
  const places = iteration % 4;
  const value = Number((random() * 2000).toFixed(places));
  const unit = C.UNITS[iteration % C.UNITS.length];
  const target = C.UNITS[(iteration * 3 + 5) % C.UNITS.length];
  const label = 'random ' + value + ' ' + unit.id + ' -> ' + target.id;
  const result = run(String(value), unit.id, target.id);

  assert.equal(result.base, value * unit.scale, label + ' base');
  const slack = Math.abs(result.base) * 1e-12 + 1e-12;
  assert.ok(Math.abs(result.result * target.scale - result.base) <= slack, label + ' back to base');
  assert.ok(Math.abs(result.result - result.base / target.scale) <= slack / target.scale, label + ' quotient');
  assert.match(result.toText, /^[\d,]+(?:\.\d+)?(?:e[+-]?\d+)? \S+$/, label + ' text shape');
  assert.deepEqual(run(String(value), unit.id, target.id), result, label + ' deterministic');

  const again = run(result.toText.split(' ')[0].replace(/,/g, ''), target.id, unit.id);
  const tolerance = Math.max(Math.abs(value), 1e-12) * 2e-5;
  assert.ok(Math.abs(again.result - value) <= tolerance, label + ' six-digit round trip');
}

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2297, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Luminance Unit Converter');
assert.equal(record.category, 'Converters');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1f506}');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('3168') === false, 'no placeholder numbers');
assert.ok(record.method.includes('10.76391041670972'), 'method states the square-foot factor');
assert.ok(record.method.includes('3.426259099635391'), 'method states the foot-lambert factor');
assert.ok(record.method.length > 900, 'method documented');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(Array.isArray(record.sources) && record.sources.length === 0, 'no invented citation');
assert.equal(record.testCases.length, 16, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 12, 'twelve golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 4, 'four validation cases');
for (const testCase of record.testCases) {
  const { value, from, to } = testCase.input;
  if (testCase.kind === 'validation') {
    assert.equal(failure(value, from, to), testCase.expected.error, testCase.name);
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
for (const tag of ['photometry', 'luminance', 'nits', 'foot-lambert', 'unit-conversion']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && /(?:^|-)luminance(?:-|$)/i.test(tool.slug)),
  'no other luminance tool slug');

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

console.log('luminance unit converter: 8 units, 12 reference conversions, 240 random round trips, 16 catalog cases and the page contract pass');
