/* Bed and mattress size converter: catalog fixtures, chart arithmetic, independent gap model and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'bed-size-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* bed-size-core:start */';
const endMarker = '/* bed-size-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = BedSizeCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one bed size converter');
const record = records[0];
assert.equal(record.name, 'Bed & Mattress Size Converter');
assert.equal(record.category, 'Converters');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.equal(new Set(record.tags).size, record.tags.length);
assert.equal(new Set(record.aliases).size, record.aliases.length);
assert.ok(record.method.length > 1200, 'method documents the chart, the matching rule and its limits');
assert.match(record.method, /2\.54/);
assert.match(record.method, /40 to 300 cm/);
assert.match(record.method, /33 sizes/);
assert.equal(record.sources.length, 1, 'the chart carries one named source');
assert.equal(record.sources[0].url, 'https://en.wikipedia.org/wiki/Bed_size');
assert.match(record.sources[0].title, /Bed size/);
assert.equal(record.testCases.length, 22);
assert.equal(record.testCases.filter((item) => item.kind === 'golden').length, 5);
assert.equal(record.testCases.filter((item) => item.kind === 'boundary').length, 5);
assert.equal(record.testCases.filter((item) => item.kind === 'validation').length, 12);
assert.equal(catalog.tools.length, 2411, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2151, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Converters').length, 52,
  'Converters count');

// No other record claims this slug, name, alias or distinctive tag.
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name.toLowerCase(), record.name.toLowerCase(), 'name is unique: ' + other.slug);
  for (const alias of record.aliases) {
    assert.ok(!other.aliases.map((aliasValue) => aliasValue.toLowerCase()).includes(alias.toLowerCase()),
      'alias is unique: ' + alias + ' in ' + other.slug);
  }
  for (const tag of ['bed-size', 'mattress', 'mattress-size', 'size-chart']) {
    assert.ok(!other.tags.includes(tag), tag + ' tag is unique: ' + other.slug);
  }
}
for (const neighbour of ['clothing-size-converter', 'shoe-size-converter', 'ring-size-converter',
  'paper-weight-converter', 'paper-sizes', 'knitting-needle-size-converter']) {
  assert.equal(catalog.tools.filter((tool) => tool.slug === neighbour).length, 1,
    'the neighbouring ' + neighbour + ' page stays separate');
}

// Catalog fixtures replay through the page core.
for (const fixture of record.testCases) {
  if (fixture.expectedError) {
    assert.throws(() => C.calculate(fixture.input), (error) => error.message === fixture.expectedError,
      fixture.name + ': ' + fixture.expectedError);
  } else {
    const result = C.calculate(fixture.input);
    for (const [key, expected] of Object.entries(fixture.expected)) {
      assert.deepEqual(JSON.parse(JSON.stringify(result[key])), expected, fixture.name + ': ' + key);
    }
  }
}

// The published chart is intact and each chart lists its sizes narrowest first.
assert.equal(C.systems.length, 5);
assert.deepEqual(JSON.parse(JSON.stringify(C.systems.map((system) => system.id))), ['us', 'uk', 'eu', 'au', 'jp']);
let sizeCount = 0;
for (const system of C.systems) {
  const list = C.sizes[system.id];
  sizeCount += list.length;
  assert.equal(new Set(list.map((size) => size.id)).size, list.length, system.id + ' ids are unique');
  assert.equal(new Set(list.map((size) => size.name)).size, list.length, system.id + ' names are unique');
  for (const size of list) {
    assert.ok(size.cm[0] >= 70 && size.cm[0] <= 210, system.id + '/' + size.id + ' width is plausible');
    assert.ok(size.cm[1] >= 180 && size.cm[1] <= 215, system.id + '/' + size.id + ' length is plausible');
    assert.ok(size.cm[1] >= size.cm[0], system.id + '/' + size.id + ' length is the longer side');
  }
}
assert.equal(sizeCount, 33, '33 charted sizes');

// A US queen is exactly 60 by 79.5 inches and both unit views agree through 2.54.
const queen = C.calculate({ mode: 'named', system: 'us', size: 'queen' });
assert.equal(queen.dimsCm, '152.4 \u00d7 201.9 cm');
assert.equal(queen.dimsIn, '60 \u00d7 79.5 in');
assert.equal(queen.cm[0], 152.4);
assert.ok(Math.abs(queen.cm[0] - queen.inch[0] * 2.54) < 0.06, 'centimetres and inches agree');
assert.ok(Math.abs(queen.cm[1] - queen.inch[1] * 2.54) < 0.06, 'centimetres and inches agree');
assert.equal(queen.rows.length, 4, 'a named size is compared with the other four charts');
assert.ok(!queen.rows.some((row) => row.system === 'US'), 'the source chart is not repeated');

// Independent model: the gap is the sum of the two side differences, recomputed from the chart.
function exactGap(widthCm, lengthCm, size) {
  const sw = Math.min(widthCm, lengthCm);
  const sl = Math.max(widthCm, lengthCm);
  const w = Math.min(size.cm[0], size.cm[1]);
  const l = Math.max(size.cm[0], size.cm[1]);
  return Math.abs(sw - w) + Math.abs(sl - l);
}
for (let i = 0; i < 150; i++) {
  const unit = i % 2 === 0 ? 'cm' : 'in';
  const widthCm = 45 + ((i * 7.3) % 150);
  const lengthCm = widthCm + ((i * 3.1) % 100);
  const factor = unit === 'in' ? 2.54 : 1;
  const width = widthCm / factor;
  const length = lengthCm / factor;
  const result = C.calculate({ mode: 'measure', unit, width: String(width), length: String(length) });
  assert.equal(result.rows.length, 5, 'measurement mode covers all five charts');
  for (const row of result.rows) {
    const system = C.systems.filter((entry) => entry.short === row.system)[0];
    const chosen = C.sizes[system.id].filter((size) => size.name === row.name)[0];
    assert.ok(chosen, row.system + ' row names a charted size: ' + row.name);
    const gap = exactGap(widthCm, lengthCm, chosen);
    assert.ok(Math.abs(row.off - gap) < 0.051, 'gap agrees with the oracle: ' + row.off + ' vs ' + gap);
    const smallest = Math.min(...C.sizes[system.id].map((size) => exactGap(widthCm, lengthCm, size)));
    assert.ok(gap <= smallest + 0.049, 'the chosen ' + system.id + ' size is the closest in its chart');
  }
  const closest = Math.min(...result.rows.map((row) => row.off));
  for (const row of result.rows) {
    if (row.best) assert.equal(row.off, closest, 'the highlighted row is the closest');
  }
  assert.equal(result.rows.filter((row) => row.best).length, 1, 'exactly one row is highlighted');
  assert.equal(result.exact, result.rows.some((row) => row.off === 0), 'exact means a zero gap');
}

// Every charted size is found exactly when its own dimensions are measured, in both units.
for (const system of C.systems) {
  for (const size of C.sizes[system.id]) {
    const measured = C.calculate({ mode: 'measure', unit: 'cm', width: String(size.cm[0]), length: String(size.cm[1]) });
    const match = measured.rows.filter((row) => row.system === system.short)[0];
    assert.equal(match.off, 0, 'exact measurement of ' + system.id + '/' + size.id);
    assert.equal(match.near, true);
    assert.equal(measured.exact, true);
  }
}

// Swapping width and length changes nothing: the shorter side is always compared first.
const straight = C.calculate({ mode: 'measure', unit: 'cm', width: '140', length: '200' });
const swapped = C.calculate({ mode: 'measure', unit: 'cm', width: '200', length: '140' });
assert.deepEqual(JSON.parse(JSON.stringify(swapped.rows)), JSON.parse(JSON.stringify(straight.rows)));
assert.equal(straight.exact, true, '140 x 200 cm is an EU double exactly');

// Boundary refusals beyond the catalog fixtures.
assert.throws(() => C.calculate({ mode: 'measure', unit: 'cm', width: '1e2', length: '200' }), /must be a number/);
assert.throws(() => C.calculate({ mode: 'measure', unit: 'cm', width: '150', length: '  ' }), /Length is required/);
assert.throws(() => C.calculate({ mode: 'measure', unit: 'in', width: '15', length: '80' }), /between 40 and 300 cm/);
assert.throws(() => C.calculate({ mode: 'measure', unit: 'in', width: '60', length: '119' }), /between 40 and 300 cm/);
assert.equal(C.calculate({ mode: 'measure', unit: 'in', width: '118.11', length: '60' }).exact, false);
assert.equal(C.calculate({ mode: 'named', system: 'eu', size: 'extra-wide' }).dimsCm, '200 \u00d7 200 cm');
assert.equal(C.calculate({ mode: 'named', system: 'au', size: 'queen' }).rows.filter((row) => row.best).length, 0,
  'a named lookup does not rank the other charts');

// The page keeps the defaults and the accessibility contract.
assert.match(html, /<h1>Bed &amp; Mattress Size Converter<\/h1>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /src="\/assets\/theme-init\.js"/);
assert.match(html, /href="\/assets\/style\.css"/);
assert.match(html, /src="\/assets\/app\.js"/);
assert.match(html, /id="in-mode"/);
assert.match(html, /id="in-system"/);
assert.match(html, /id="in-size"/);
assert.match(html, /id="in-width"/);
assert.match(html, /id="in-length"/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /min-height:44px/);
assert.match(html, /inputmode="decimal"/);
assert.ok(!/https?:\/\//.test(html), 'no outbound URLs in the page');
assert.ok(!/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|innerHTML/.test(html),
  'no network, storage or HTML injection');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no external scripts');
assert.ok(!/\son(?:click|input|change|submit|load)\s*=/i.test(html), 'no inline event handlers');

console.log('bed size converter: 22 catalog cases, 150 oracle states, every chart size matched and the page contract pass');
