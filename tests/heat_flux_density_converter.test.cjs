/* Heat flux density converter: exact unit factors, NIST agreement, formatting,
   golden conversions, random round trips, validation messages, catalog replay
   and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'heat-flux-density-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* heat-flux-density-core:start */';
const endMarker = '/* heat-flux-density-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = HeatFluxDensityCore;', sandbox);
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
assert.equal(C.CENTIMETRE_METRES, 0.01);
assert.equal(C.MAX_BASE, 1000000000);
assert.equal(C.DEFAULT_VALUE, '1000');
assert.equal(C.DEFAULT_FROM, 'w-m2');
assert.equal(C.DEFAULT_TO, 'btu-h-ft2');
assert.deepEqual(plain(C.UNITS.map((unit) => [unit.id, unit.symbol])), [
  ['w-m2', 'W/m\u00b2'],
  ['kw-m2', 'kW/m\u00b2'],
  ['mw-cm2', 'mW/cm\u00b2'],
  ['w-cm2', 'W/cm\u00b2'],
  ['w-in2', 'W/in\u00b2'],
  ['btu-h-ft2', 'Btu/(h\u00b7ft\u00b2)'],
  ['btu-s-ft2', 'Btu/(s\u00b7ft\u00b2)'],
  ['cal-s-cm2', 'cal/(s\u00b7cm\u00b2)'],
  ['kcal-h-m2', 'kcal/(h\u00b7m\u00b2)']
]);

// ---- Every scale follows from the base watt per square metre by definition.
const BTU = 1055.05585262;
const HOUR = 3600;
const FOOT = 0.3048;
const INCH = 0.0254;
const CM = 0.01;
const EXPECTED_SCALES = {
  'w-m2': 1,
  'kw-m2': 1000,
  'mw-cm2': 0.001 / (CM * CM),
  'w-cm2': 1 / (CM * CM),
  'w-in2': 1 / (INCH * INCH),
  'btu-h-ft2': BTU / (HOUR * FOOT * FOOT),
  'btu-s-ft2': BTU / (FOOT * FOOT),
  'cal-s-cm2': 4.184 / (CM * CM),
  'kcal-h-m2': 1000 * 4.184 / HOUR
};
for (const unit of C.UNITS) {
  assert.ok(Math.abs(unit.scale - EXPECTED_SCALES[unit.id]) < 1e-12, unit.id + ' scale');
}

// ---- The factors must reproduce the numbers NIST SP 811 prints for these units.
assert.ok(Math.abs(C.unitOf('btu-h-ft2').scale - 3.154591) < 5e-7, 'NIST: BtuIT/(ft2 h) = 3.154 591');
assert.ok(Math.abs(C.unitOf('btu-s-ft2').scale - 11356.53) < 5e-3, 'NIST: BtuIT/(ft2 s) = 1.135 653E+04');
assert.ok(Math.abs(C.unitOf('w-in2').scale - 1550.003) < 5e-4, 'NIST: W/in2 = 1.550 003E+03');
assert.equal(C.unitOf('cal-s-cm2').scale, 41840, 'NIST: calth/(cm2 s) = 4.184E+04');
assert.equal(C.unitOf('w-cm2').scale, 10000, 'NIST: W/cm2 = 1.0E+04');
assert.equal(C.unitOf('nonsense').id, 'w-m2', 'an unknown unit falls back to SI');
assert.equal(C.unitOf(null).id, 'w-m2', 'a missing unit falls back to SI');
assert.equal(C.unitOf(' BTU-H-FT2 ').id, 'btu-h-ft2', 'unit ids are case-folded and trimmed');

// ---- Formatting: six significant digits, trailing zeros trimmed, thousands grouped.
assert.equal(C.format(0), '0');
assert.equal(C.format(316.9983306281505), '316.998');
assert.equal(C.format(1000), '1,000');
assert.equal(C.format(41840), '41,840');
assert.equal(C.format(6.4516), '6.4516');
assert.equal(C.format(0.11622222222222222), '0.116222');
assert.equal(C.format(316998330.62815046), '316,998,331');
assert.equal(C.format(3.1699833062815046e-7), '3.16998e-7');
assert.equal(C.format(1.1622222222222223), '1.16222');

// ---- Conversions: the definition of each unit, in both directions.
assert.deepEqual(run('1000', 'w-m2', 'btu-h-ft2'), {
  value: 1000,
  from: 'w-m2',
  to: 'btu-h-ft2',
  base: 1000,
  result: 316.9983306281505,
  fromText: '1,000 W/m\u00b2',
  toText: '316.998 Btu/(h\u00b7ft\u00b2)',
  equation: '1,000 W/m\u00b2 = 316.998 Btu/(h\u00b7ft\u00b2)',
  fromLabel: 'Watt per square metre',
  toLabel: 'Btu per hour-square foot'
});
assert.equal(run('1', 'kw-m2', 'w-m2').toText, '1,000 W/m\u00b2');
assert.equal(run('1', 'cal-s-cm2', 'w-m2').toText, '41,840 W/m\u00b2');
assert.equal(run('10', 'btu-h-ft2', 'w-m2').toText, '31.5459 W/m\u00b2');
assert.equal(run('1', 'w-cm2', 'w-in2').toText, '6.4516 W/in\u00b2');
assert.equal(run('1', 'kcal-h-m2', 'mw-cm2').toText, '0.116222 mW/cm\u00b2');
assert.equal(run('0.5', 'btu-s-ft2', 'kw-m2').toText, '5.67826 kW/m\u00b2');
assert.equal(run('1361', 'w-m2', 'btu-h-ft2').toText, '431.435 Btu/(h\u00b7ft\u00b2)');
assert.equal(run('3', 'kcal-h-m2', 'btu-h-ft2').toText, '1.10527 Btu/(h\u00b7ft\u00b2)');

// ---- Identities that only exact factors satisfy.
const close = (a, b, label) => assert.ok(Math.abs(a - b) <= Math.abs(b) * 1e-12 + 1e-15, label);
close(C.unitOf('w-cm2').scale / C.unitOf('mw-cm2').scale, 1000, 'one W/cm2 is 1000 mW/cm2');
close(C.unitOf('w-in2').scale * INCH * INCH, 1, 'a square inch of W/in2 is one watt');
close(C.unitOf('btu-s-ft2').scale, C.unitOf('btu-h-ft2').scale * HOUR, 'a second is an hour of Btu flux');
close(C.unitOf('cal-s-cm2').scale, C.unitOf('kcal-h-m2').scale * 36000, 'a calorie per second-centimetre is 36000 kcal per hour-square metre');
close(run('1', 'w-m2', 'kw-m2').result * 1000, 1, 'kilowatt round trip');
close(run('12', 'w-in2', 'w-m2').base, 12 * 1550.0031000062002, 'watt per square inch base');
assert.equal(run('1', 'w-m2', 'w-m2').result, 1, 'a unit converts to itself');
assert.equal(run('0', 'w-m2', 'btu-h-ft2').toText, '0 Btu/(h\u00b7ft\u00b2)', 'zero stays zero');
assert.equal(run('1200', 'w-m2', 'mw-cm2').toText, '120 mW/cm\u00b2', 'grouped input is accepted');
assert.equal(run(' 1200 ', 'w-m2', 'mw-cm2').result, 120, 'surrounding space is trimmed');
assert.equal(run('.5', 'kw-m2', 'w-m2').result, 500, 'a leading point is accepted');

// ---- Validation messages are the page's own wording.
assert.equal(failure('', 'w-m2', 'btu-h-ft2'), 'Enter a heat flux density value to convert.');
assert.equal(failure('   ', 'w-m2', 'btu-h-ft2'), 'Enter a heat flux density value to convert.');
assert.equal(failure(null, 'w-m2', 'btu-h-ft2'), 'Enter a heat flux density value to convert.');
assert.equal(failure('abc', 'w-m2', 'btu-h-ft2'), 'Enter the value as a number, such as 1000.');
assert.equal(failure('1000 W/m2', 'w-m2', 'btu-h-ft2'), 'Enter the value as a number, such as 1000.');
assert.equal(failure('1,2', 'w-m2', 'btu-h-ft2'), 'Enter the value as a number, such as 1000.');
assert.equal(failure('-5', 'w-m2', 'cal-s-cm2'), 'Heat flux density cannot be negative.');
assert.equal(failure('2000000000', 'w-m2', 'btu-h-ft2'), 'Enter a value of at most 1,000,000,000 W/m\u00b2.');
assert.equal(failure('1000000000', 'w-m2', 'btu-h-ft2'), null, 'the ceiling itself is accepted');
assert.equal(failure('1000000001', 'kw-m2', 'w-m2'), 'Enter a value of at most 1,000,000,000 W/m\u00b2.',
  'the ceiling is checked on the SI base, not on the typed number');

// ---- Random round trips across every ordered pair of units.
let seed = 20261116;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let iteration = 0; iteration < 200; iteration += 1) {
  const places = iteration % 4;
  const value = Number((random() * 400).toFixed(places));
  const unit = C.UNITS[iteration % C.UNITS.length];
  const target = C.UNITS[(iteration * 5 + 3) % C.UNITS.length];
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
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Heat Flux Density Converter');
assert.equal(record.category, 'Converters');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u2600');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('1055.05585262'), 'method states the exact Btu');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 2, 'sources are cited');
for (const source of record.sources) {
  assert.ok(source.title.length > 20, 'a source names the document and the part used');
  assert.match(source.url, /^https:\/\//, 'every source has an absolute https URL');
}
assert.ok(record.sources.some((source) => source.url.includes('nist.gov')), 'the NIST factor table is cited');
assert.ok(record.sources.some((source) => source.url.includes('wikipedia.org/wiki/Heat_flux')), 'the unit definition is cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 16, 'catalog case count');
assert.equal(kinds('golden'), 7, 'seven golden cases');
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
for (const tag of ['thermal', 'heat-transfer', 'heat-flux', 'unit-conversion', 'hvac', 'solar']) {
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
assert.equal((html.match(/<option value="/g) || []).length, 18, 'nine units in each picker');
for (const unit of C.UNITS) {
  assert.ok(html.includes('<option value="' + unit.id + '"'), 'unit option present: ' + unit.id);
}
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('heat flux density converter: 9 units, NIST factors, 200 random round trips, 16 catalog cases and the page contract pass');
