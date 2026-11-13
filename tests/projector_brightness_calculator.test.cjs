/* Projector brightness calculator: screen geometry, the luminance chain in
   foot-lamberts and cd/m2, gain and flux scaling, the reverse solves, the
   on-target band, validation behaviour, catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'projector-brightness-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* projector-brightness-core:start */';
const endMarker = '/* projector-brightness-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ProjectorBrightnessCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (diagonal, aspect, lumens, gain, target) => plain(C.compute(diagonal, aspect, lumens, gain, target));
const failure = (diagonal, aspect, lumens, gain, target) => {
  try { run(diagonal, aspect, lumens, gain, target); } catch (error) { return error.message; }
  return null;
};
const rows = (result) => new Map(result.rows.map((row) => [row.k, row.v]));
const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    (label || 'value') + ': ' + actual + ' vs ' + expected);
};

// ---- Exported contract.
assert.equal(C.NITS_PER_FOOT_LAMBERT.toFixed(7), '3.4262591', '1 fL is 3.4262591 cd/m2');
assert.equal(C.FT2_PER_M2.toFixed(4), '10.7639', 'one square metre in square feet');
assert.equal(C.ASPECTS.length, 6);
assert.equal(C.TARGETS.length, 3);
assert.equal(C.MIN_DIAGONAL, 10);
assert.equal(C.MAX_DIAGONAL, 1000);
assert.equal(C.MIN_LUMENS, 10);
assert.equal(C.MAX_LUMENS, 100000);
assert.equal(C.MIN_GAIN, 0.1);
assert.equal(C.MAX_GAIN, 10);
assert.equal(C.ON_TARGET_BAND, 0.1);
assert.equal(C.DEFAULT_DIAGONAL, '100');
assert.equal(C.DEFAULT_ASPECT, '16:9');
assert.equal(C.DEFAULT_LUMENS, '1000');
assert.equal(C.DEFAULT_GAIN, '1.00');
assert.equal(C.DEFAULT_TARGET, 'dci');
assert.equal(C.aspectById('16:9').ratio, 16 / 9);
assert.equal(C.aspectById('2.39:1').ratio, 2.39);
assert.equal(C.aspectById('21:9'), null);
assert.equal(C.targetById('dci').fl, 14);
assert.equal(C.targetById('film').fl, 16);
assert.equal(C.targetById('3d').fl, 7);
assert.equal(C.targetById('imax'), null);

// ---- Geometry: a 100 in 16:9 screen is 87.16 x 49.03 in, 29.67 ft2.
const box = plain(C.screen(100, 16 / 9));
near(box.widthIn, 87.1575537, 1e-6, '16:9 width');
near(box.heightIn, 49.0261240, 1e-6, '16:9 height');
near(box.widthCm, 221.3801864, 1e-5, '16:9 width in cm');
near(box.areaFt2, 29.6735905, 1e-6, '16:9 area');
near(box.areaM2, 2.7567668, 1e-6, '16:9 area in m2');
near(Math.hypot(box.widthIn, box.heightIn), 100, 1e-9, 'the diagonal is preserved');
// Wider ratios are wider and shorter for the same diagonal.
const wide = plain(C.screen(100, 2.39));
assert.ok(wide.widthIn > box.widthIn && wide.heightIn < box.heightIn, '2.39:1 is wider and shorter');
near(Math.hypot(wide.widthIn, wide.heightIn), 100, 1e-9, '2.39:1 diagonal');
near(wide.areaFt2, (wide.widthIn * wide.heightIn) / 144, 1e-12, 'area follows width x height');

// ---- The default case: 1,000 lm on 29.67 ft2 at gain 1.00.
let result = run('100', '16:9', '1000', '1.00', 'dci');
near(result.areaFt2, 29.6735905, 1e-6, 'default area');
near(result.fl, 33.7, 1e-6, 'default fL');
near(result.nits, 115.4649317, 1e-6, 'default cd/m2');
near(result.lux, 362.7437810, 1e-6, 'default illuminance');
near(result.ratioToTarget, 2.4071429, 1e-6, 'default ratio to the DCI target');
near(result.lumensForTarget, 415.4302671, 1e-6, 'default lumens for the target');
near(result.maxDiagonalIn, 155.1496973, 1e-6, 'default largest screen');
assert.equal(result.verdict, 'bright');
assert.equal(result.headline, '33.7 fL');
assert.ok(result.subText.includes('115 cd/m\u00b2'), 'the subtitle states cd/m2');
assert.ok(result.subText.includes('363 lx'), 'the subtitle states the illuminance');
assert.equal(rows(result).get('Screen size'), '87.2 \u00d7 49.0 in (221 \u00d7 125 cm)');
assert.equal(rows(result).get('Screen area'), '29.7 ft\u00b2 (2.76 m\u00b2)');
assert.equal(rows(result).get('Luminance (imperial)'), '33.7 fL');
assert.equal(rows(result).get('Luminance (SI)'), '115 cd/m\u00b2');
assert.equal(rows(result).get('Target'), 'DCI cinema 2D \u2014 14 fL (48 cd/m\u00b2)');
assert.equal(rows(result).get('Result vs target'), '2.4\u00d7 the target \u2014 brighter than the target');
assert.equal(rows(result).get('Lumens for the target'), '415 lm');
assert.equal(rows(result).get('Largest screen at the target'), '155 in diagonal (16:9)');
assert.ok(result.summary.includes('100 in 16:9 screen'), 'the summary names the screen');
assert.ok(result.summary.includes('gain 1.00'), 'the summary states the gain');

// ---- The luminance chain holds whatever the inputs.
for (const [diagonal, aspect, lumens, gain, target] of [
  ['60', '16:10', '520', '0.9', 'film'],
  ['150', '2.39:1', '5000', '1.3', 'dci'],
  ['200', '4:3', '8000', '1.0', '3d'],
  ['85', '1.85:1', '1200', '2.4', 'dci'],
]) {
  const item = run(diagonal, aspect, lumens, gain, target);
  near(item.fl, (Number(lumens) * Number(gain)) / item.areaFt2, 1e-9, diagonal + ' fL from flux and area');
  near(item.nits, item.fl * 3.4262590996353905, 1e-9, diagonal + ' cd/m2 from fL');
  near(item.lux, Number(lumens) / item.areaM2, 1e-9, diagonal + ' lux from flux and area');
  near(item.areaM2, item.areaFt2 / 10.763910416709722, 1e-12, diagonal + ' area units agree');
  near(item.targetNits, item.targetFl * 3.4262590996353905, 1e-12, diagonal + ' target conversion');
  near(item.ratioToTarget, item.fl / item.targetFl, 1e-12, diagonal + ' ratio uses the target in fL');
  assert.equal(result.rows.length, 9, 'nine result rows');
}

// ---- Scaling: double the light, double the gain, double the diagonal.
const base = run('100', '16:9', '1000', '1.0', 'dci');
near(run('100', '16:9', '2000', '1.0', 'dci').fl, base.fl * 2, 1e-9, 'twice the lumens doubles fL');
near(run('100', '16:9', '1000', '2.0', 'dci').fl, base.fl * 2, 1e-9, 'twice the gain doubles fL');
near(run('200', '16:9', '1000', '1.0', 'dci').fl, base.fl / 4, 1e-9, 'twice the diagonal quarters fL');
near(run('100', '16:9', '1000', '1.0', 'film').fl, base.fl, 1e-9, 'the target does not change the luminance');
assert.ok(run('100', '16:9', '1000', '1.0', 'film').lumensForTarget > base.lumensForTarget,
  'a brighter target needs more light');
near(run('100', '16:9', '1000', '1.0', 'film').lumensForTarget,
  (16 / 14) * base.lumensForTarget, 1e-9, 'required lumens scale with the target');

// ---- Reverse solve: at the required lumens the current screen is the largest.
const required = run('100', '16:9', String(base.lumensForTarget), '1.0', 'dci');
near(required.fl, 14, 1e-9, 'the required lumens land on the target');
near(required.maxDiagonalIn, 100, 1e-6, 'the largest screen is the current one');
assert.equal(required.verdict, 'on', 'exactly on target');

// ---- The 10% band.
const dim = run('100', '16:9', String(base.lumensForTarget * 0.85), '1.0', 'dci');
assert.equal(dim.verdict, 'dim', '15% short is dimmer');
const onLow = run('100', '16:9', String(base.lumensForTarget * 0.92), '1.0', 'dci');
assert.equal(onLow.verdict, 'on', '8% short is still on target');
const onHigh = run('100', '16:9', String(base.lumensForTarget * 1.08), '1.0', 'dci');
assert.equal(onHigh.verdict, 'on', '8% over is on target');
const bright = run('100', '16:9', String(base.lumensForTarget * 1.15), '1.0', 'dci');
assert.equal(bright.verdict, 'bright', '15% over is brighter');
assert.ok(rows(dim).get('Result vs target').endsWith('dimmer than the target'));
assert.ok(rows(bright).get('Result vs target').endsWith('brighter than the target'));

// ---- Comma grouping and thousands separators.
const grouped = run('1,000', '16:9', '2,500', '1.15', 'dci');
assert.equal(grouped.diagonal, 1000);
assert.equal(grouped.lumens, 2500);
near(grouped.fl, 2500 * 1.15 / (87.1575537 * 49.0261240 * 100 / 144), 1e-3, 'grouped inputs convert');
assert.ok(rows(grouped).get('Screen size').includes('(2,214 \u00d7 1,245 cm)'), 'centimetres keep their separators');
assert.equal(C.group(1234567), '1,234,567');
assert.equal(C.group('1234.5'), '1,234.5');
assert.equal(C.group(48), '48');

// ---- Validation.
assert.equal(failure('', '16:9', '1000', '1.00', 'dci'), 'Enter the image diagonal in inches.');
assert.equal(failure('big', '16:9', '1000', '1.00', 'dci'), 'Enter the image diagonal in inches.');
assert.equal(failure('5', '16:9', '1000', '1.00', 'dci'), 'Diagonal must be between 10 and 1,000 in.');
assert.equal(failure('1200', '16:9', '1000', '1.00', 'dci'), 'Diagonal must be between 10 and 1,000 in.');
assert.equal(failure('100', '16:9', '', '1.00', 'dci'), 'Enter the projector light output in lumens.');
assert.equal(failure('100', '16:9', '0', '1.00', 'dci'), 'Light output must be between 10 and 100,000 lm.');
assert.equal(failure('100', '16:9', '200000', '1.00', 'dci'), 'Light output must be between 10 and 100,000 lm.');
assert.equal(failure('100', '16:9', '1000', '', 'dci'), 'Enter the screen gain.');
assert.equal(failure('100', '16:9', '1000', '0', 'dci'), 'Screen gain must be between 0.1 and 10.');
assert.equal(failure('100', '16:9', '1000', '12', 'dci'), 'Screen gain must be between 0.1 and 10.');
assert.equal(failure('100', '21:9', '1000', '1.00', 'dci'), 'Choose an aspect ratio from the list.');
assert.equal(failure('100', '16:9', '1000', '1.00', 'imax'), 'Choose a brightness target from the list.');
assert.equal(run('10', '16:9', '10', '0.1', '3d').diagonal, 10, 'the smallest diagonal is accepted');
assert.equal(run('1000', '16:9', '100000', '10', 'dci').lumens, 100000, 'the largest light output is accepted');
assert.equal(run(' 100 ', '16:9', ' 1000 ', ' 1 ', 'dci').gain, 1, 'stray spaces are tolerated in the numbers');
assert.equal(run('100', '16:9', '1000', '1.00', 'dci').diagonal, 100, 'the parsed diagonal is reported');

// ---- Determinism.
assert.deepEqual(run('100', '16:9', '1000', '1.00', 'dci'), run('100', '16:9', '1000', '1.00', 'dci'));

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2255, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Projector Brightness Calculator');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1f506}');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('3.4263'), 'method states the fL to cd/m2 factor');
assert.ok(record.method.includes('1,000 in'), 'method states the input limits');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 4, 'sources are cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 25, 'catalog case count');
assert.equal(kinds('golden'), 13, 'thirteen golden cases');
assert.equal(kinds('validation'), 12, 'twelve validation cases');
const FIELDS = ['widthIn', 'heightIn', 'widthCm', 'heightCm', 'areaFt2', 'areaM2', 'lux', 'fl', 'nits',
  'ratioToTarget', 'lumensForTarget', 'maxDiagonalIn'];
for (const testCase of record.testCases) {
  const { diagonal, aspect, lumens, gain, target } = testCase.input;
  if (testCase.kind === 'validation') {
    assert.equal(failure(diagonal, aspect, lumens, gain, target), testCase.expected.error, testCase.name);
    continue;
  }
  const actual = run(diagonal, aspect, lumens, gain, target);
  const expected = testCase.expected;
  for (const field of FIELDS) near(actual[field], expected[field], 1e-5 * Math.max(1, Math.abs(expected[field])),
    testCase.name + ' ' + field);
  assert.equal(actual.verdict, expected.verdict, testCase.name + ' verdict');
  assert.equal(actual.headline, expected.headline, testCase.name + ' headline');
  assert.deepEqual(plain(actual.rows), expected.rows, testCase.name + ' rows');
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
for (const tag of ['projector', 'screen-gain', 'foot-lambert', 'luminance']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 8, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const id of ['diagonal', 'aspect', 'lumens', 'gain', 'target']) {
  assert.ok(html.includes('<label for="' + id + '">'), 'control has a visible label: ' + id);
}
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status"/.test(html), 'copy feedback is announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="decimal"/.test(html), 'decimal keyboards on touch');
assert.equal((html.match(/<input /g) || []).length, 3, 'three text inputs');
assert.equal((html.match(/<select /g) || []).length, 2, 'two selects');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('projector brightness calculator: geometry, luminance chain, reverse solve, 25 catalog cases and the page contract pass');
