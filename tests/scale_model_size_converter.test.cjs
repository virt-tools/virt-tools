/* Scale model size converter: catalog fixtures, ratio model, independent reference and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'scale-model-size-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* scale-model-core:start */';
const endMarker = '/* scale-model-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = ModelScaleCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one scale model converter');
const record = records[0];
assert.equal(record.name, 'Scale Model Size Converter');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.equal(new Set(record.tags).size, record.tags.length);
assert.equal(new Set(record.aliases).size, record.aliases.length);
assert.ok(record.method.length > 1200, 'method documents the ratio and its limits');
assert.match(record.method, /1:72/);
assert.match(record.method, /5184/);
assert.match(record.method, /373,248/);
assert.match(record.method, /1 in = 25\.4 mm/);
assert.equal(record.sources.length, 0, 'bespoke ratio arithmetic carries no invented citation');
assert.equal(record.testCases.length, 21);
assert.equal(record.testCases.filter((item) => item.kind === 'golden').length, 5);
assert.equal(record.testCases.filter((item) => item.kind === 'boundary').length, 5);
assert.equal(record.testCases.filter((item) => item.kind === 'validation').length, 11);
assert.equal(catalog.tools.length, 2528, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2267, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Crafts & Hobbies').length, 58,
  'Crafts & Hobbies count');

// No other record claims this slug, name, alias or distinctive tag.
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name.toLowerCase(), record.name.toLowerCase(), 'name is unique: ' + other.slug);
  for (const alias of record.aliases) {
    assert.ok(!other.aliases.map((aliasValue) => aliasValue.toLowerCase()).includes(alias.toLowerCase()),
      'alias is unique: ' + alias + ' in ' + other.slug);
  }
  for (const tag of ['scale-model', 'miniatures', 'model-making']) {
    assert.ok(!other.tags.includes(tag), tag + ' tag is unique: ' + other.slug);
  }
}
for (const lookalike of ['picture-frame-calculator', 'map-scale-calculator', 'time-scale-converter',
  'type-scale', 'scale-generator', 'knitting-gauge-calculator']) {
  assert.equal(catalog.tools.filter((tool) => tool.slug === lookalike).length, 1,
    'the neighbouring ' + lookalike + ' page stays separate');
}

// Catalog fixtures replay through the page core.
for (const fixture of record.testCases) {
  if (fixture.expectedError) {
    assert.throws(() => C.calculate(fixture.input), (error) => error.message === fixture.expectedError,
      fixture.name + ': ' + fixture.expectedError);
  } else {
    const result = C.calculate(fixture.input);
    for (const [key, expected] of Object.entries(fixture.expected)) {
      assert.equal(result[key], expected, fixture.name + ': ' + key);
    }
  }
}

// The core rounds to four decimals, so the published figures are reproduced exactly.
const exact = C.calculate({ mode: 'real', unit: 'm', scale: '72', length: '12' });
assert.equal(exact.modelMm, 166.6667);
assert.equal(exact.areaFactor, 5184);
assert.equal(exact.volumeFactor, 373248);
assert.equal(C.calculate({ mode: 'real', unit: 'm', scale: '72', length: '24' }).modelMm, 333.3333);

// Independent reference implementation: convert everything to millimetres and divide.
const MM_PER = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
function reference(input) {
  const unit = MM_PER[input.unit];
  const realMm = input.mode === 'real' ? Number(input.length) * unit
    : input.mode === 'model' ? Number(input.length) * unit * Number(input.scale)
      : Number(input.realLength) * unit;
  const modelMm = input.mode === 'real' ? realMm / Number(input.scale)
    : input.mode === 'model' ? Number(input.length) * unit
      : Number(input.modelLength) * unit;
  return { realMm, modelMm, n: realMm / modelMm };
}
let worstMm = 0;
const units = ['mm', 'cm', 'm', 'in', 'ft'];
for (let i = 0; i < 120; i++) {
  const unit = units[i % units.length];
  const scale = [1, 12, 24, 32, 35, 48, 72, 76, 87.1, 144, 200, 350, 500][i % 13];
  const length = 0.05 + i * 3.7;
  const mode = i % 2 === 0 ? 'real' : 'model';
  const result = C.calculate({ mode, unit, scale: String(scale), length: String(length) });
  const ref = reference({ mode, unit, scale, length });
  worstMm = Math.max(worstMm, Math.abs(result.realMm - ref.realMm), Math.abs(result.modelMm - ref.modelMm));
  assert.ok(Math.abs(result.scaleN - ref.n) < 1e-4, 'scale denominator');
  assert.ok(result.modelMm <= result.realMm, 'the model is never larger than the real object');
  assert.ok(Math.abs(result.areaFactor - ref.n * ref.n) < 1e-3, 'area ratio');
  assert.ok(Math.abs(result.volumeFactor - ref.n * ref.n * ref.n) < 1e-2, 'volume ratio');
}
assert.ok(worstMm < 0.001, 'independent conversion agrees within a thousandth of a millimetre: ' + worstMm);

// A recovered scale round-trips through the forward calculation.
for (const [real, model, unit] of [['120', '0.25', 'm'], ['8.8', '0.1', 'm'], ['12000', '166.6667', 'mm'], ['5', '2', 'in']]) {
  const found = C.calculate({ mode: 'scale', unit, realLength: real, modelLength: model });
  assert.ok(found.scaleN > 1, 'recovered scale is above 1:1');
  const back = C.calculate({ mode: 'real', unit, scale: String(found.scaleN), length: real });
  assert.ok(Math.abs(back.modelMm - found.modelMm) < 0.01, 'round trip: ' + unit + ' ' + real + '/' + model);
}

// The table repeats the real length at the ten common scales and shrinks as the scale grows.
const table = C.calculate({ mode: 'real', unit: 'm', scale: '72', length: '12' }).table;
assert.equal(table.length, 10);
assert.equal(table[0].scale, 12);
assert.equal(table[9].scale, 350);
assert.equal(table[5].scale, 72);
assert.ok(Math.abs(table[5].mm - exact.modelMm) < 1e-3, 'the 1:72 row repeats the answer');
for (let i = 1; i < table.length; i++) {
  assert.ok(table[i].scale > table[i - 1].scale, 'scales ascend');
  assert.ok(table[i].mm < table[i - 1].mm, 'model sizes descend');
}

// The nearest common scale is offered only when the ratio is close to it.
assert.equal(C.calculate({ mode: 'scale', unit: 'm', realLength: '8.8', modelLength: '0.1' }).nearestScale, 87);
assert.equal(C.calculate({ mode: 'scale', unit: 'm', realLength: '87.1', modelLength: '1' }).nearestScale, 87);
assert.equal(C.calculate({ mode: 'scale', unit: 'mm', realLength: '1000', modelLength: '0.1' }).nearestScale, null,
  '1:10,000 is not near a kit scale');
assert.equal(C.calculate({ mode: 'scale', unit: 'mm', realLength: '350', modelLength: '1' }).nearestScale, 350);
assert.equal(C.calculate({ mode: 'real', unit: 'm', scale: '72', length: '12' }).nearestScale, null,
  'forward modes do not guess a nearest scale');

// Boundary refusals beyond the catalog fixtures.
assert.throws(() => C.calculate({ mode: 'real', unit: 'm', scale: '72', length: '1e3' }), /must be a number/);
assert.throws(() => C.calculate({ mode: 'real', unit: 'm', scale: '0.5', length: '12' }), /from 1 to 10,000/);
assert.throws(() => C.calculate({ mode: 'model', unit: 'm', scale: '72', length: '0' }), /between 0.01 mm and 1,000,000 mm/);
assert.throws(() => C.calculate({ mode: 'scale', unit: 'm', realLength: '1', modelLength: '1' }),
  /must be smaller than the real length/);
assert.throws(() => C.calculate({ mode: 'sideways', unit: 'm', scale: '72', length: '12' }), /Mode must be/);
assert.equal(C.calculate({ mode: 'real', unit: 'mm', scale: '48', length: '914.4' }).modelMm, 19.05);

// The page keeps the defaults and the accessibility contract.
assert.match(html, /<h1>Scale Model Size Converter<\/h1>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /src="\/assets\/theme-init\.js"/);
assert.match(html, /href="\/assets\/style\.css"/);
assert.match(html, /src="\/assets\/app\.js"/);
assert.match(html, /id="in-mode"/);
assert.match(html, /id="in-scale"/);
assert.match(html, /id="in-length"/);
assert.match(html, /id="in-real"/);
assert.match(html, /id="in-model"/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /min-height:44px/);
assert.match(html, /inputmode="decimal"/);
assert.ok(!/https?:\/\//.test(html), 'no outbound URLs in the page');
assert.ok(!/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|innerHTML/.test(html),
  'no network, storage or HTML injection');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no external scripts');
assert.ok(!/\son(?:click|input|change|submit|load)\s*=/i.test(html), 'no inline event handlers');

console.log('scale model size converter: 21 catalog cases, 120 reference states and the page contract pass');
