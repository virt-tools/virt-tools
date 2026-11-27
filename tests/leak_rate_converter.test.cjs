/* Leak rate converter: exact pV/t factors, NIST gas-flow agreement, formatting,
   golden conversions, random round trips, validation messages, catalog replay
   and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'leak-rate-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* leak-rate-core:start */';
const endMarker = '/* leak-rate-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = LeakRateCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (value, from, to) => plain(C.parse(value, from, to));
const failure = (value, from, to) => {
  try { run(value, from, to); } catch (error) { return error.message; }
  return null;
};

// ---- Exported definitions and the unit table.
assert.equal(C.ATMOSPHERE_PASCALS, 101325);
assert.equal(C.TORR_PASCALS, 101325 / 760);
assert.equal(C.LITRE_CUBIC_METRES, 0.001);
assert.equal(C.MINUTE_SECONDS, 60);
assert.equal(C.MAX_BASE, 1000000);
assert.equal(C.SIGNIFICANT_DIGITS, 6);
assert.equal(C.DEFAULT_VALUE, '1');
assert.equal(C.DEFAULT_FROM, 'sccm');
assert.equal(C.DEFAULT_TO, 'mbar-l-s');
assert.deepEqual(plain(C.UNITS.map((unit) => [unit.id, unit.symbol])), [
  ['pa-m3-s', 'Pa\u00b7m\u00b3/s'],
  ['mbar-l-s', 'mbar\u00b7L/s'],
  ['torr-l-s', 'Torr\u00b7L/s'],
  ['lusec', 'lusec'],
  ['atm-cc-s', 'atm\u00b7cm\u00b3/s'],
  ['sccm', 'sccm'],
  ['slm', 'slm']
]);

// ---- Every scale reduces to Pa*m3/s by definition, independently recomputed.
const ATM = 101325;
const TORR = 101325 / 760;
const LITRE = 0.001;
const EXPECTED_SCALES = {
  'pa-m3-s': 1,
  'mbar-l-s': 100 * LITRE,
  'torr-l-s': TORR * LITRE,
  lusec: TORR * LITRE / 1000,
  'atm-cc-s': ATM * 1e-6,
  sccm: ATM * 1e-6 / 60,
  slm: ATM * LITRE / 60
};
for (const unit of C.UNITS) {
  assert.ok(Math.abs(unit.scale - EXPECTED_SCALES[unit.id]) <= Math.abs(EXPECTED_SCALES[unit.id]) * 1e-15,
    unit.id + ' scale');
}
assert.equal(C.unitOf('mbar-l-s').scale, 0.1, 'one mbar-litre is exactly 0.1 Pa m3');
assert.ok(Math.abs(C.unitOf('slm').scale - 1.68875) < 5e-12, 'slm is 1.68875 Pa m3/s');
assert.ok(Math.abs(C.unitOf('atm-cc-s').scale - 0.101325) < 1e-15, 'atm cc/s is 0.101325 Pa m3/s');
assert.equal(C.unitOf('nonsense').id, 'pa-m3-s', 'an unknown unit falls back to SI');
assert.equal(C.unitOf(null).id, 'pa-m3-s', 'a missing unit falls back to SI');
assert.equal(C.unitOf(' SCCM ').id, 'sccm', 'unit ids are case-folded and trimmed');

// ---- The factors must reproduce the numbers NIST prints in its gas-flow table.
// NIST prints four to six significant digits, so compare at 5e-4 relative; the
// exact factors are pinned by the definition loop above.
const near = (got, want, label) => assert.ok(Math.abs(got - want) <= Math.abs(want) * 5e-4,
  label + ': ' + got + ' vs ' + want);
assert.equal(C.unitOf('atm-cc-s').scale, 0.101325, 'NIST: 1 atm cc/s = 0.101325 Pa m3/s');
near(C.unitOf('sccm').scale, 0.001689, 'NIST: 1 sccm = 0.001689 Pa m3/s');
assert.equal(C.unitOf('mbar-l-s').scale, 0.1, 'NIST: 1 mbar l/s = 0.1 Pa m3/s');
near(C.unitOf('torr-l-s').scale, 0.133322, 'NIST: 1 torr l/s = 0.133322 Pa m3/s');
near(C.unitOf('slm').scale, 1.68875, 'NIST: 1 slm = 1.68875 Pa m3/s');
near(run('1', 'pa-m3-s', 'sccm').result, 592.154, 'NIST: 1 Pa m3/s = 592.154 sccm');
near(run('1', 'sccm', 'slm').result, 0.001, 'NIST: 1 sccm = 0.001 slm');
near(run('1', 'atm-cc-s', 'sccm').result, 60, 'NIST: 1 atm cc/s = 60 sccm');
near(run('1', 'mbar-l-s', 'torr-l-s').result, 0.750062, 'NIST: 1 mbar l/s = 0.750062 torr l/s');
near(run('1', 'sccm', 'mbar-l-s').result, 0.0168875, 'NIST: 1 sccm = 0.0168875 mbar l/s');

// ---- Formatting: six significant digits, trailing zeros trimmed, thousands grouped.
assert.equal(C.format(0), '0');
assert.equal(C.format(0.0168875), '0.0168875');
assert.equal(C.format(1000), '1,000');
assert.equal(C.format(10000000), '10,000,000');
assert.equal(C.format(0.00013332236842105263), '0.000133322');
assert.equal(C.format(592.1539600296077), '592.154');
assert.equal(C.format(0.7500616827041698), '0.750062');
assert.equal(C.format(1.68875e-9), '1.68875e-9');
assert.equal(C.format(-0), '0');

// ---- Conversions: the definition of each unit, in both directions.
assert.deepEqual(run('1', 'sccm', 'mbar-l-s'), {
  value: 1,
  from: 'sccm',
  to: 'mbar-l-s',
  base: 101325 * 1e-6 / 60,
  result: 0.0168875,
  fromText: '1 sccm',
  toText: '0.0168875 mbar\u00b7L/s',
  equation: '1 sccm = 0.0168875 mbar\u00b7L/s',
  fromLabel: 'Standard cubic centimetre per minute',
  toLabel: 'Millibar litre per second'
});
assert.equal(run('60', 'sccm', 'slm').toText, '0.06 slm');
assert.equal(run('1', 'atm-cc-s', 'sccm').toText, '60 sccm');
assert.equal(run('1', 'torr-l-s', 'pa-m3-s').toText, '0.133322 Pa\u00b7m\u00b3/s');
assert.equal(run('1', 'pa-m3-s', 'sccm').toText, '592.154 sccm');
assert.equal(run('1', 'mbar-l-s', 'torr-l-s').toText, '0.750062 Torr\u00b7L/s');
assert.equal(run('1', 'lusec', 'pa-m3-s').toText, '0.000133322 Pa\u00b7m\u00b3/s');
assert.equal(run('1000', 'sccm', 'slm').toText, '1 slm');

// ---- Identities that only exact factors satisfy.
const close = (a, b, label) => assert.ok(Math.abs(a - b) <= Math.abs(b) * 1e-12 + 1e-15, label);
close(C.unitOf('slm').scale / C.unitOf('sccm').scale, 1000, 'one slm is 1000 sccm');
close(C.unitOf('atm-cc-s').scale / C.unitOf('sccm').scale, 60, 'one atm cc/s is 60 sccm');
close(C.unitOf('mbar-l-s').scale * 10, C.unitOf('pa-m3-s').scale, 'ten mbar-litres are one Pa m3');
close(C.unitOf('torr-l-s').scale, C.unitOf('lusec').scale * 1000, 'a lusec is a thousandth of a Torr litre');
close(C.unitOf('mbar-l-s').scale / C.unitOf('torr-l-s').scale, 760 / 1013.25, 'mbar and Torr follow the atmosphere');
assert.equal(run('1', 'sccm', 'sccm').result, 1, 'a unit converts to itself');
assert.equal(run('0', 'pa-m3-s', 'mbar-l-s').toText, '0 mbar\u00b7L/s', 'zero stays zero');
close(run('1000', 'sccm', 'slm').result, 1, 'grouped input is accepted');
close(run(' 60 ', 'sccm', 'slm').result, 0.06, 'surrounding space is trimmed');
assert.equal(run('.5', 'mbar-l-s', 'pa-m3-s').result, 0.05, 'a leading point is accepted');

// ---- Validation messages are the page's own wording.
assert.equal(failure('', 'pa-m3-s', 'mbar-l-s'), 'Enter a leak rate to convert.');
assert.equal(failure('   ', 'pa-m3-s', 'mbar-l-s'), 'Enter a leak rate to convert.');
assert.equal(failure(null, 'pa-m3-s', 'mbar-l-s'), 'Enter a leak rate to convert.');
assert.equal(failure('abc', 'pa-m3-s', 'mbar-l-s'), 'Enter the leak rate as a number, such as 1.5.');
assert.equal(failure('1.5 sccm', 'pa-m3-s', 'mbar-l-s'), 'Enter the leak rate as a number, such as 1.5.');
assert.equal(failure('1,2', 'pa-m3-s', 'mbar-l-s'), 'Enter the leak rate as a number, such as 1.5.');
assert.equal(failure('-1', 'sccm', 'mbar-l-s'), 'A leak rate cannot be negative.');
assert.equal(failure('1000001', 'pa-m3-s', 'mbar-l-s'),
  'Enter a leak rate of at most 1,000,000 Pa\u00b7m\u00b3/s.');
assert.equal(failure('1000000', 'pa-m3-s', 'mbar-l-s'), null, 'the ceiling itself is accepted');
assert.equal(failure('20000000', 'mbar-l-s', 'pa-m3-s'),
  'Enter a leak rate of at most 1,000,000 Pa\u00b7m\u00b3/s.',
  'the ceiling is checked on the SI base, not on the typed number');

// ---- Random round trips across every ordered pair of units.
let seed = 20261127;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let iteration = 0; iteration < 200; iteration += 1) {
  const places = iteration % 4;
  const value = Number((random() * 900).toFixed(places));
  const unit = C.UNITS[iteration % C.UNITS.length];
  const target = C.UNITS[(iteration * 5 + 3) % C.UNITS.length];
  const label = 'random ' + value + ' ' + unit.id + ' -> ' + target.id;
  const result = run(String(value), unit.id, target.id);

  assert.equal(result.base, value * unit.scale, label + ' base');
  const slack = Math.abs(result.base) * 1e-12 + 1e-18;
  assert.ok(Math.abs(result.result * target.scale - result.base) <= slack, label + ' back to base');
  assert.ok(Math.abs(result.result - result.base / target.scale) <= slack / target.scale, label + ' quotient');
  assert.match(result.toText, /^-?[\d,]+(?:\.\d+)?(?:e[+-]?\d+)? \S+$/, label + ' text shape');
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
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Leak Rate Converter');
assert.equal(record.category, 'Converters');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1F4A8}');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('101 325') || record.method.includes('101325'), 'method states the exact atmosphere');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 2, 'sources are cited');
for (const source of record.sources) {
  assert.ok(source.title.length > 20, 'a source names the document and the part used');
  assert.match(source.url, /^https:\/\//, 'every source has an absolute https URL');
}
assert.ok(record.sources.some((source) => source.url.includes('nist.gov')), 'the NIST gas-flow table is cited');
assert.ok(record.sources.some((source) => source.url.includes('leybold.com')), 'the leak-detection handbook is cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 15, 'catalog case count');
assert.equal(kinds('golden'), 7, 'seven golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
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
for (const tag of ['leak-rate', 'vacuum', 'unit-conversion', 'gas-flow']) {
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
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="decimal"/.test(html), 'a numeric keyboard is offered on touch');
assert.ok(/<form id="convert-form" novalidate>/.test(html), 'the form is a real form and does not native-validate');
assert.equal((html.match(/<option value="/g) || []).length, 14, 'seven units in each picker');
assert.equal((html.match(/<option value="sccm" selected>/g) || []).length, 1, 'sccm is the default source unit');
assert.equal((html.match(/<option value="mbar-l-s" selected>/g) || []).length, 1, 'mbar-L/s is the default target unit');
assert.ok(/id="value"[^>]*value="1"/.test(html), 'the page opens on its default value');
for (const unit of C.UNITS) {
  assert.ok(html.includes('<option value="' + unit.id + '"'), 'unit option present: ' + unit.id);
}
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('leak rate converter: 7 units, exact pV/t factors, NIST gas-flow agreement, 200 random round trips, 15 catalog cases and the page contract pass');
