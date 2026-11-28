/* Typography and print units: exact absolute-length ratios, four-significant-digit
   display, range edges, catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'typography-unit-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* typography-unit-core:start */';
const endMarker = '/* typography-unit-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TypographyUnitCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (value, unit) => plain(C.parse(value, unit));
const failure = (value, unit) => {
  try { run(value, unit); } catch (error) { return error.message; }
  return null;
};
const rowMap = (result) => new Map(result.rows.map((row) => [row.id, row.text]));

// ---- Exported contract. CSS absolute lengths are definitions, not measurements.
assert.equal(C.MIN_POINTS, 0.1);
assert.equal(C.MAX_POINTS, 20000);
assert.equal(C.POINTS_PER_INCH, 72);
assert.equal(C.DEFAULT_VALUE, '11');
assert.equal(C.DEFAULT_UNIT, 'pt');
assert.deepEqual(plain(C.UNITS.map((unit) => [unit.id, unit.perInch])),
  [['pt', 72], ['pc', 6], ['twip', 1440], ['in', 1], ['mm', 25.4], ['cm', 2.54], ['q', 101.6], ['px', 96]]);

// ---- Four significant digits, half up, grouped and trimmed.
assert.equal(C.format(11), '11');
assert.equal(C.format(0.9166666666666666), '0.9167');
assert.equal(C.format(3.8805555555555555), '3.881');
assert.equal(C.format(0.1527777777777778), '0.1528');
assert.equal(C.format(15.522222222222222), '15.52');
assert.equal(C.format(14.666666666666666), '14.67');
assert.equal(C.format(220), '220');
assert.equal(C.format(288000), '288,000');
assert.equal(C.format(999.96), '1,000', 'a carry into the next decade still reads cleanly');
assert.equal(C.format(0.000012345678), '0.00001235');
assert.equal(C.format(0), '0');

// ---- Exact ratios: one inch is 72 pt, 6 pc, 1440 twip, 96 px, 25.4 mm, 2.54 cm and 101.6 Q.
for (const unit of C.UNITS) {
  const result = run('1', 'in');
  const row = result.rows.find((entry) => entry.id === unit.id);
  if (unit.id === 'pt') {
    assert.equal(result.points, 72, 'an inch is 72 points');
    continue;
  }
  assert.equal(row.value, unit.perInch, 'one inch in ' + unit.id);
}
for (const unit of C.UNITS) {
  const result = run(String(unit.perInch), unit.id);
  assert.ok(Math.abs(result.points - 72) < 1e-12, 'one inch written in ' + unit.id + ' is 72 points');
}

// ---- Reference sizes, each figure worked out from the ratios above.
const REFERENCE = [
  { value: '11', unit: 'pt', short: 'pt', points: '11 pt', pc: '0.9167 pc', twip: '220 twip', inch: '0.1528 in' },
  { value: '12', unit: 'pc', short: 'pc', points: '144 pt', pc: '12 pc', twip: '2,880 twip', inch: '2 in' },
  { value: '220', unit: 'twip', short: 'twip', points: '11 pt', pc: '0.9167 pc', twip: '220 twip', inch: '0.1528 in' },
  { value: '1', unit: 'in', short: 'in', points: '72 pt', pc: '6 pc', twip: '1,440 twip', inch: '1 in' },
  { value: '3.881', unit: 'mm', short: 'mm', points: '11 pt', pc: '0.9168 pc', twip: '220 twip', inch: '0.1528 in' },
  { value: '2.54', unit: 'cm', short: 'cm', points: '72 pt', pc: '6 pc', twip: '1,440 twip', inch: '1 in' },
  { value: '8', unit: 'q', short: 'Q', points: '5.669 pt', pc: '0.4724 pc', twip: '113.4 twip', inch: '0.07874 in' },
  { value: '96', unit: 'px', short: 'px', points: '72 pt', pc: '6 pc', twip: '1,440 twip', inch: '1 in' }
];
for (const item of REFERENCE) {
  const result = run(item.value, item.unit);
  const rows = rowMap(result);
  assert.equal(result.pointsText, item.points, item.value + ' ' + item.unit + ' points');
  assert.equal(rows.get('pc'), item.pc, item.value + ' ' + item.unit + ' picas');
  assert.equal(rows.get('twip'), item.twip, item.value + ' ' + item.unit + ' twips');
  assert.equal(rows.get('in'), item.inch, item.value + ' ' + item.unit + ' inches');
  assert.equal(result.fromText, item.value + ' ' + item.short, 'the entry is echoed back');
  assert.ok(result.subText.startsWith('Entered as ' + item.value + ' ' + item.short), 'sub line echoes the entry');
}

// Millimetres, centimetres and quarter-millimetres at a size a designer would type.
const body = run('11', 'pt');
assert.equal(rowMap(body).get('mm'), '3.881 mm');
assert.equal(rowMap(body).get('cm'), '0.3881 cm');
assert.equal(rowMap(body).get('q'), '15.52 Q');
assert.equal(rowMap(body).get('px'), '14.67 px');
assert.equal(body.subText, 'Entered as 11 pt \u00b7 1 in = 72 pt = 6 pc = 96 px = 25.4 mm');
assert.equal(run('1', 'q').pointsText, '0.7087 pt', 'a quarter-millimetre is 0.25 mm');
assert.equal(rowMap(run('1', 'q')).get('mm'), '0.25 mm');

// ---- Random sizes: every row is the same physical length in another unit.
let seed = 20261120;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let iteration = 0; iteration < 200; iteration += 1) {
  const places = iteration % 4;
  const points = Number((0.1 + random() * 19999.9).toFixed(places));
  const label = 'random ' + points + ' pt';
  const result = run(String(points), 'pt');
  const inches = points / 72;

  assert.equal(result.unit, 'pt', label + ' unit');
  assert.equal(result.rows.length, 7, label + ' seven rows beside the headline');
  assert.deepEqual(result.rows.map((row) => row.id), ['pc', 'twip', 'in', 'mm', 'cm', 'q', 'px'],
    label + ' row order');

  for (const row of result.rows) {
    const perInch = C.UNITS.find((unit) => unit.id === row.id).perInch;
    const expected = inches * perInch;
    assert.ok(Math.abs(row.value - expected) <= 1e-12 * Math.abs(expected), label + ' ' + row.id + ' value');
    assert.match(row.text, /^[\d,]+(?:\.\d+)? [A-Za-z]+$/, label + ' ' + row.id + ' text shape');
  }

  // A displayed row, typed back in its own unit, returns the same size to display precision.
  const millimetres = result.rows.find((row) => row.id === 'mm').value;
  const again = run(String(millimetres), 'mm');
  assert.ok(Math.abs(again.points - points) / points < 0.001, label + ' millimetre round trip');

  const pixels = result.rows.find((row) => row.id === 'px').value;
  const viaPixels = run(String(pixels), 'px');
  assert.ok(Math.abs(viaPixels.points - points) / points < 0.001, label + ' pixel round trip');

  assert.deepEqual(run(String(points), 'pt'), result, label + ' deterministic');
}

// ---- Range edges.
assert.equal(run('0.1', 'pt').pointsText, '0.1 pt');
assert.equal(run('20000', 'pt').pointsText, '20,000 pt');
assert.equal(rowMap(run('20000', 'pt')).get('twip'), '400,000 twip');
assert.equal(run('4', 'px').pointsText, '3 pt', 'four CSS pixels are three points');
assert.equal(failure('20000.5', 'pt'),
  'That is larger than 20,000 pt (about 7 m); this converter covers type and print sizes.');
assert.equal(failure('0.09', 'pt'), 'Enter a size of at least 0.1 pt.');

// ---- Validation messages.
assert.equal(failure('', 'pt'), 'Enter a size to convert.');
assert.equal(failure('   ', 'mm'), 'Enter a size to convert.');
assert.equal(failure(null, 'pt'), 'Enter a size to convert.');
assert.equal(failure('eighty', 'pt'), 'Enter the size as a number, such as 11 or 12.5.');
assert.equal(failure('11 pt', 'pt'), 'Enter the size as a number, such as 11 or 12.5.');
assert.equal(failure('1e3', 'pt'), 'Enter the size as a number, such as 11 or 12.5.');
assert.equal(failure('11.', 'pt'), 'Enter the size as a number, such as 11 or 12.5.');
assert.equal(failure('1,00', 'pt'), 'Enter the size as a number, such as 11 or 12.5.');
assert.equal(failure('0', 'pt'), 'Enter a size of at least 0.1 pt.');
assert.equal(failure('-2', 'pt'), 'Enter a size of at least 0.1 pt.');
assert.equal(run('1,000', 'twip').pointsText, '50 pt', 'grouped thousands are accepted');
assert.equal(run('.5', 'in').pointsText, '36 pt', 'a leading decimal point is accepted');
assert.equal(run('.5', 'in').fromText, '0.5 in');
assert.equal(C.unitOf('GSM').id, 'pt', 'an unknown unit falls back to points');
assert.equal(C.unitOf('MM').id, 'mm', 'units are matched case-insensitively');

// ---- Catalog record and its cases must agree with the page core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.length, 2515, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2254, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Converters').length, 57,
  'Converters count');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Typography & Print Unit Converter');
assert.equal(record.category, 'Converters');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1F520}');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('25.4'), 'method states the exact inch');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.equal(record.sources.length, 2, 'both ratio sources are cited');
assert.equal(record.sources[0].url, 'https://www.w3.org/TR/css-values-4/#absolute-lengths');
assert.equal(record.sources[1].url, 'https://en.wikipedia.org/wiki/Twip');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 18, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 6, 'six validation cases');
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
      assert.deepEqual(result.rows.map((row) => [row.id, row.text]), expected, testCase.name + ' rows');
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
for (const tag of ['typography', 'typographic-units', 'point-size', 'pica', 'twip', 'print-units']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 6, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="size">/.test(html) && /<label for="unit">/.test(html), 'both controls have visible labels');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status"/.test(html), 'copy feedback is announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="decimal"/.test(html), 'a numeric keyboard is offered on touch');
assert.equal((html.match(/<option value="/g) || []).length, 8, 'eight units in the picker');
for (const unit of C.UNITS) {
  assert.ok(html.includes('<option value="' + unit.id + '"'), 'unit option present: ' + unit.id);
}
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('typography unit converter: 8 reference sizes, 200 random spans, 18 catalog cases and the page contract pass');
