/* Data transfer rate converter: reference conversions, formatting, exact unit
   identities, round trips, validation messages, catalog replay and the page
   contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'data-transfer-rate-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* data-rate-core:start */';
const endMarker = '/* data-rate-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = DataRateCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (value, from, to) => plain(C.parse(value, from, to));
const failure = (value, from, to) => {
  try { run(value, from, to); } catch (error) { return error.message; }
  return null;
};

// ---- Exported contract.
assert.equal(C.BITS_PER_BYTE, 8);
assert.equal(C.MAX_BPS, 1e15);
assert.equal(C.MIN_EXPONENT, 0.0001);
assert.equal(C.MAX_DECIMAL, 1e13);
assert.equal(C.DEFAULT_VALUE, '100');
assert.equal(C.DEFAULT_FROM, 'mbps');
assert.equal(C.DEFAULT_TO, 'mb-s');
assert.equal(C.UNITS.length, 14, 'fourteen rate units');
assert.equal(C.FAMILIES.length, 3, 'three unit families');

// ---- Unit table: ids are unique and every factor is exact.
assert.equal(new Set(C.UNITS.map((unit) => unit.id)).size, 14);
assert.equal(new Set(C.UNITS.map((unit) => unit.short)).size, 14);
for (const unit of C.UNITS) {
  assert.ok(C.FAMILIES.some((family) => family.id === unit.family), 'unit family exists: ' + unit.id);
  assert.ok(unit.bits > 0 && Number.isFinite(unit.bits), 'unit factor is a positive number: ' + unit.id);
}
const byId = (id) => C.UNITS.find((unit) => unit.id === id);
assert.equal(byId('bps').bits, 1);
assert.equal(byId('kbps').bits, 1000);
assert.equal(byId('mbps').bits, 1e6);
assert.equal(byId('gbps').bits, 1e9);
assert.equal(byId('tbps').bits, 1e12);
assert.equal(byId('b-s').bits, 8);
assert.equal(byId('kb-s').bits, 8000);
assert.equal(byId('mb-s').bits, 8e6);
assert.equal(byId('gb-s').bits, 8e9);
assert.equal(byId('tb-s').bits, 8e12);
assert.equal(byId('kib-s').bits, 8192);
assert.equal(byId('mib-s').bits, 8388608);
assert.equal(byId('gib-s').bits, 8589934592);
assert.equal(byId('tib-s').bits, 8796093022208);
for (const unit of C.UNITS) {
  if (unit.family === 'bits') assert.equal(unit.bits, byId(unit.id.replace('bps', 'b-s')).bits / 8, 'bit unit is one eighth of its byte unit: ' + unit.id);
}

// ---- Formatting: six significant digits, grouped thousands, exponent at the edges.
assert.equal(C.formatRate(0), '0');
assert.equal(C.formatRate(12.5), '12.5');
assert.equal(C.formatRate(100), '100');
assert.equal(C.formatRate(1048.576), '1,048.58');
assert.equal(C.formatRate(8192), '8,192');
assert.equal(C.formatRate(999999), '999,999');
assert.equal(C.formatRate(1000000), '1,000,000');
assert.equal(C.formatRate(1234.5678), '1,234.57');
assert.equal(C.formatRate(0.0001), '0.0001');
assert.equal(C.formatRate(0.00009999), '9.999e-5');
assert.equal(C.formatRate(1e15), '1e+15');
assert.equal(C.formatRate(1e-12), '1e-12');
assert.equal(C.formatRate(1.005), '1.005');
assert.equal(C.formatRate(0.5), '0.5');

// ---- Reference conversions (exact arithmetic on integer factors).
const golden = [
  ['100', 'mbps', 'mb-s', 12.5, '12.5 MB/s'],
  ['1', 'gbps', 'mbps', 1000, '1,000 Mbit/s'],
  ['12.5', 'mb-s', 'mbps', 100, '100 Mbit/s'],
  ['1', 'gib-s', 'mib-s', 1024, '1,024 MiB/s'],
  ['1', 'kib-s', 'bps', 8192, '8,192 bit/s'],
  ['2.5', 'gbps', 'mb-s', 312.5, '312.5 MB/s'],
  ['1', 'tb-s', 'tbps', 8, '8 Tbit/s'],
  ['0', 'b-s', 'mbps', 0, '0 Mbit/s']
];
for (const [value, from, to, want, text] of golden) {
  const result = run(value, from, to);
  assert.ok(Math.abs(result.value - want) <= Math.abs(want) * 1e-12, value + ' ' + from + ' -> ' + to);
  assert.equal(result.bigText, text, value + ' ' + from + ' -> ' + to + ' text');
  assert.equal(result.subText, C.formatRate(Number(value.replace(/,/g, ''))) + ' ' + byId(from).short + ' = ' + text
    + (byId(from).family === byId(to).family ? '' : ' - a byte is eight bits'));
}
const mib = run('1', 'mib-s', 'kb-s');
assert.ok(Math.abs(mib.value - 1048.576) < 1e-9, '1 MiB/s in kB/s');
assert.equal(mib.bigText, '1,048.58 kB/s');
const tib = run('3.5', 'tib-s', 'tb-s');
assert.ok(Math.abs(tib.value - 3.5 * 1099511627776 / 1e12) < 1e-9, '3.5 TiB/s in TB/s');
assert.equal(tib.bigText, '3.84829 TB/s');
const tiny = run('1', 'bps', 'tib-s');
assert.equal(tiny.bigText, '1.137e-13 TiB/s');

// ---- Every supported unit is listed once, grouped under its family.
const table = run('100', 'mbps', 'mb-s');
assert.equal(table.families.length, 3);
let listed = 0;
for (const family of table.families) {
  assert.ok(family.label.length > 0);
  for (const item of family.items) {
    listed += 1;
    assert.equal(item.text, C.formatRate(item.value), 'table text matches the value: ' + item.id);
    assert.equal(item.value, table.bitsPerSecond / byId(item.id).bits, 'table value uses the bit base: ' + item.id);
  }
}
assert.equal(listed, 14, 'the table covers every unit');
assert.equal(table.bitsPerSecond, 100e6, '100 Mbit/s is 100 million bits per second');
assert.equal(table.families[1].items.find((item) => item.id === 'mb-s').text, '12.5');

// ---- Exactness and round trips across every unit pair.
const seeded = (() => {
  let state = 20261116;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
})();
let roundTrips = 0;
for (let index = 0; index < 400; index += 1) {
  const from = C.UNITS[Math.floor(seeded() * C.UNITS.length)];
  const to = C.UNITS[Math.floor(seeded() * C.UNITS.length)];
  const ceiling = Math.min(1e6, C.MAX_BPS / from.bits);
  const value = Math.round(seeded() * ceiling * 1e4) / 1e4;
  const result = C.convert(value, from.id, to.id);
  const expected = value * from.bits / to.bits;
  assert.ok(Math.abs(result.value - expected) <= Math.abs(expected) * 1e-12 + 1e-12,
    'conversion ' + value + ' ' + from.id + ' -> ' + to.id);
  const back = C.convert(result.value, to.id, from.id);
  assert.ok(Math.abs(back.value - value) <= Math.abs(value) * 1e-9 + 1e-9,
    'round trip ' + value + ' ' + from.id + ' -> ' + to.id);
  roundTrips += 1;
}
assert.equal(roundTrips, 400);
const same = C.convert(42.125, 'mib-s', 'mib-s');
assert.equal(same.value, 42.125, 'same-unit conversion is the identity');
assert.ok(Math.abs(C.convert(1, 'MIB-S', 'mib-s').value - 1) === 0, 'unit lookup is case-insensitive');

// ---- A byte is exactly eight bits at every prefix pair.
for (const [bitsUnit, bytesUnit] of [['bps', 'b-s'], ['kbps', 'kb-s'], ['mbps', 'mb-s'], ['gbps', 'gb-s'], ['tbps', 'tb-s']]) {
  assert.ok(Math.abs(C.convert(8, bitsUnit, bytesUnit).value - 1) < 1e-12, '8 ' + bitsUnit + ' is 1 ' + bytesUnit);
  assert.ok(Math.abs(C.convert(1, bytesUnit, bitsUnit).value - 8) < 1e-12, '1 ' + bytesUnit + ' is 8 ' + bitsUnit);
}
// ---- A binary prefix is 2^10 of its decimal counterpart.
assert.ok(Math.abs(C.convert(1, 'kib-s', 'kb-s').value - 1.024) < 1e-12, '1 KiB/s is 1.024 kB/s');
assert.ok(Math.abs(C.convert(1, 'gib-s', 'gb-s').value - 1.073741824) < 1e-12, '1 GiB/s is 1.073741824 GB/s');

// ---- Validation.
assert.equal(failure('', 'mbps', 'mb-s'), 'Enter a rate to convert.');
assert.equal(failure('   ', 'mbps', 'mb-s'), 'Enter a rate to convert.');
assert.equal(failure('fast', 'mbps', 'mb-s'), 'Enter the rate as a number, such as 100 or 12.5.');
assert.equal(failure('1e6', 'mbps', 'mb-s'), 'Enter the rate as a number, such as 100 or 12.5.');
assert.equal(failure('1,5', 'mbps', 'mb-s'), 'Enter the rate as a number, such as 100 or 12.5.');
assert.equal(failure('1.2.3', 'mbps', 'mb-s'), 'Enter the rate as a number, such as 100 or 12.5.');
assert.equal(failure('12 Mbps', 'mbps', 'mb-s'), 'Enter the rate as a number, such as 100 or 12.5.');
assert.equal(failure('-5', 'mbps', 'mb-s'), 'Enter a rate of zero or more.');
assert.equal(failure('1001', 'tbps', 'mbps'), 'That is above 1 Pbit/s, the largest rate this converter covers.');
assert.equal(failure('100', 'fps', 'mbps'), 'Pick the unit the rate is written in.');
assert.equal(failure('100', 'mbps', 'fps'), 'Pick the unit to convert to.');
assert.equal(run('1000', 'tbps', 'bps').bitsPerSecond, 1e15, 'the ceiling is inclusive');
assert.equal(run(' 0 ', 'mbps', 'mb-s').value, 0, 'a zero rate is accepted');

// ---- The catalog record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(record.name, 'Data Transfer Rate Converter');
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
assert.equal(record.testCases.length, 22);
assert.equal(record.testCases.filter((test) => test.kind === 'golden').length, 8);
assert.equal(record.testCases.filter((test) => test.kind === 'boundary').length, 6);
assert.equal(record.testCases.filter((test) => test.kind === 'validation').length, 8);
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
for (const tag of record.tags) assert.equal(tag, tag.toLowerCase(), 'tags are lowercase');
for (const tag of ['converters', 'data-transfer-rate', 'mbps', 'mb-s', 'bandwidth']) {
  assert.ok(record.tags.includes(tag), 'tag present: ' + tag);
}
for (const alias of ['Mbps to MB/s Converter', 'mbps to mb/s converter', 'Network Speed Converter', 'network speed converter']) {
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
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2124, 'public total');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Converters').length, 50, 'Converters count');

// ---- Replay every catalog case.
const pick = (result, key) => {
  switch (key) {
    case 'value': return result.value;
    case 'text': return result.bigText;
    case 'bitsPerSecond': return result.bitsPerSecond;
    default: throw new Error('unknown expected key: ' + key);
  }
};
let replayed = 0;
for (const testCase of record.testCases) {
  const input = testCase.input;
  if (testCase.kind === 'validation') {
    assert.equal(failure(input.value, input.from, input.to), testCase.expectedError, testCase.name);
    replayed += 1;
    continue;
  }
  const result = C.parse(input.value, input.from, input.to);
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
assert.ok(requestedIds.length >= 8, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="rate">/.test(html) && /<label for="from">/.test(html) && /<label for="to">/.test(html),
  'all three controls have visible labels');
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
assert.equal(options.length, 28, 'two pickers of fourteen units');
for (const unit of C.UNITS) {
  assert.equal(options.filter((id) => id === unit.id).length, 2, 'unit option appears in both pickers: ' + unit.id);
}
assert.ok(/<option value="mb-s" selected>/.test(html) && /<option value="mbps" selected>/.test(html), 'defaults are marked selected');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('data transfer rate converter: 8 golden conversions, 400 round trips, 22 catalog cases and the page contract pass');
