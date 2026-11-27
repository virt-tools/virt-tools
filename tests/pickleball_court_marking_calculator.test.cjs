/* Pickleball court marking: the line schedule against an independent segment
   model over a sweep of court sizes, the USA Pickleball constants, every
   refusal, the catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'pickleball-court-marking-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* pickleball-court-core:start */';
const endMarker = '/* pickleball-court-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PickleballCourtCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const compute = (length, width, unit) => plain(C.compute({ length, width, unit }));
const failure = (length, width, unit) => {
  try { compute(length, width, unit); } catch (error) { return error.message; }
  return null;
};

// ---- The published constants of the rulebook, stated independently here.
const FT = { nvz: 7, line: 2 / 12, side: 5, end: 8, regL: 44, regW: 20, area: 'sq ft' };
const M = { nvz: 2.13, line: 0.0508, side: 1.52, end: 2.44, regL: 13.41, regW: 6.1, area: 'sq m' };
assert.equal(C.UNITS.ft.nvz, 7);
assert.equal(C.UNITS.m.nvz, 2.13);
assert.equal(C.UNITS.ft.lineWidth, 2 / 12);
assert.equal(C.UNITS.m.lineWidth, 0.0508);

// An independent model: eight named segments, each built from the court's own
// geometry rather than the page's closed form.
function model(length, width, spec) {
  const half = length / 2;
  return {
    near: half - spec.nvz,
    far: half + spec.nvz,
    service: half - spec.nvz,
    segments: [width, width, length, length, width, width, half - spec.nvz, half - spec.nvz],
    painted: 2 * width + 2 * length + 2 * width + 2 * (half - spec.nvz)
  };
}

// ---- A regulation court, from the rulebook figures.
const reg = compute('44', '20', 'ft');
assert.equal(reg.headline, '198 ft of line');
assert.equal(reg.paintLength, 198, '198 ft of painted line');
assert.equal(reg.paintArea, 33, '198 ft at 2 in wide is 33 sq ft');
assert.equal(reg.netLine, 22);
assert.equal(reg.nearNvz, 15, 'the near zone line is 15 ft from the baseline');
assert.equal(reg.farNvz, 29, 'the far zone line is 29 ft from the baseline');
assert.equal(reg.centerlineLength, 15, 'each centerline runs 15 ft');
assert.equal(reg.serviceWidth, 10, 'each service court is 10 ft wide');
assert.equal(reg.diagonal, 48.332, 'the full-court diagonal');
assert.equal(reg.kitchenDiagonal, 21.19, 'the 7 by 20 ft zone diagonal');
assert.equal(reg.footprintWidth, 30, '30 ft of playing surface');
assert.equal(reg.footprintLength, 60, '60 ft of playing surface');
assert.equal(reg.regulation, true);
assert.equal(reg.warning, '');
assert.equal(reg.lineCount, 8);
assert.equal(reg.lines.length, 8);
assert.equal(reg.sub, '8 lines, 33 sq ft of paint');

// The schedule is the eight lines, each with coordinates to the outside edge.
assert.deepEqual(plain(reg.lines.map((line) => line.name)), [
  'Baseline 1', 'Baseline 2', 'Sideline 1', 'Sideline 2',
  'Non-volley zone line 1', 'Non-volley zone line 2', 'Centerline 1', 'Centerline 2'
]);
assert.deepEqual(plain(reg.lines[0].from), [0, 0]);
assert.deepEqual(plain(reg.lines[0].to), [0, 20]);
assert.deepEqual(plain(reg.lines[2].from), [0, 0]);
assert.deepEqual(plain(reg.lines[2].to), [44, 0]);
assert.deepEqual(plain(reg.lines[4].from), [15, 0], 'the first zone line sits at x = 15');
assert.deepEqual(plain(reg.lines[5].from), [29, 0], 'the second zone line sits at x = 29');
assert.deepEqual(plain(reg.lines[6].from), [0, 10], 'the centerline starts on the baseline');
assert.deepEqual(plain(reg.lines[6].to), [15, 10], 'and stops on the zone line');
assert.deepEqual(plain(reg.lines[7].from), [29, 10]);
assert.deepEqual(plain(reg.lines[7].to), [44, 10]);
assert.equal(reg.lines[4].text, '20 ft');

// ---- The metric court, from the rulebook's rounded equivalents.
const metric = compute('13.41', '6.10', 'm');
assert.equal(metric.headline, '60.37 m of line');
assert.equal(metric.paintLength, 60.37);
assert.equal(metric.paintArea, 3.067, '60.37 m at 5.08 cm wide');
assert.equal(metric.nearNvz, 4.575);
assert.equal(metric.farNvz, 8.835);
assert.equal(metric.centerlineLength, 4.575);
assert.equal(metric.diagonal, 14.732);
assert.equal(metric.footprintWidth, 9.14);
assert.equal(metric.footprintLength, 18.29);
assert.equal(metric.regulation, true);
assert.equal(metric.rows[metric.rows.length - 1][1], 'yes, 13.41 x 6.10 m');
assert.equal(reg.rows[reg.rows.length - 1][1], 'yes, 44 x 20 ft');

// ---- A practice court is allowed but never called regulation.
const short = compute('40', '20', 'ft');
assert.equal(short.regulation, false);
assert.equal(short.paintLength, 186);
assert.equal(short.warning, 'This is a practice or makeshift court: a regulation court is 44 by 20 ft');
assert.equal(short.rows[short.rows.length - 1][1], 'no, a regulation court is 44 x 20 ft');

// ---- Sweep every size in both units against the segment model.
let swept = 0;
function check(length, width, unit, spec) {
  const text = String(length);
  const result = compute(text, String(width), unit);
  const reference = model(length, width, spec);
  const total = reference.segments.reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(result.paintLength - total) < 0.002,
    'painted length ' + text + ' x ' + width + ' ' + unit + ': ' + result.paintLength + ' vs ' + total);
  assert.ok(Math.abs(result.nearNvz - reference.near) < 0.002, 'near zone line at ' + text + ' x ' + width);
  assert.ok(Math.abs(result.farNvz - reference.far) < 0.002, 'far zone line at ' + text + ' x ' + width);
  assert.ok(Math.abs(result.centerlineLength - reference.service) < 0.002, 'centerline at ' + text + ' x ' + width);
  assert.ok(Math.abs(result.serviceWidth - width / 2) < 0.002, 'service width at ' + text + ' x ' + width);
  assert.ok(Math.abs(result.paintArea - total * spec.line) < 0.002, 'paint area at ' + text + ' x ' + width);
  assert.ok(Math.abs(result.diagonal - Math.sqrt(length * length + width * width)) < 0.002,
    'diagonal at ' + text + ' x ' + width);
  assert.ok(Math.abs(result.kitchenDiagonal - Math.sqrt(spec.nvz * spec.nvz + width * width)) < 0.002,
    'zone diagonal at ' + text + ' x ' + width);
  assert.ok(Math.abs(result.footprintWidth - (width + 2 * spec.side)) < 0.002, 'surface width at ' + text);
  assert.ok(Math.abs(result.footprintLength - (length + 2 * spec.end)) < 0.002, 'surface length at ' + text);
  assert.equal(result.regulation,
    Math.abs(length - spec.regL) < 0.005 && Math.abs(width - spec.regW) < 0.005, 'regulation flag at ' + text);
  assert.equal(result.lines.length, 8);
  let schedule = 0;
  result.lines.forEach((line, index) => {
    const dx = line.to[0] - line.from[0];
    const dy = line.to[1] - line.from[1];
    assert.ok(Math.abs(Math.hypot(dx, dy) - line.length) < 0.003,
      'line ' + index + ' length at ' + text + ' x ' + width);
    assert.ok(Math.abs(line.length - reference.segments[index]) < 0.002,
      'line ' + index + ' against the model at ' + text + ' x ' + width);
    schedule += line.length;
  });
  assert.ok(Math.abs(schedule - result.paintLength) < 0.006, 'the schedule sums to the total at ' + text);
  assert.equal(result.headline, C.show(result.paintLength) + ' ' + result.label + ' of line');
  assert.equal(result.sub, '8 lines, ' + C.show(result.paintArea) + ' ' + spec.area + ' of paint');
  swept += 1;
}
for (let length = 20; length <= 60.001; length += 0.5) {
  for (let width = 10; width <= 40.001; width += 1) {
    check(length, width, 'ft', FT);
  }
}
for (let length = 6; length <= 18.301; length += 0.1) {
  for (let width = 3; width <= 12.201; width += 0.2) {
    check(Math.round(length * 10) / 10, Math.round(width * 10) / 10, 'm', M);
  }
}
assert.ok(swept > 2500, 'the sweep covers every size: ' + swept);

// ---- Numbers are accepted directly by the core as well as as text.
assert.equal(plain(C.compute({ length: 44, width: 20, unit: 'ft' })).paintLength, 198);
assert.equal(plain(C.compute({ length: 13.41, width: 6.1, unit: 'm' })).paintLength, 60.37);
assert.equal(plain(C.compute({ length: '44', width: '20' })).paintLength, 198, 'feet are the default unit');
assert.equal(plain(C.compute({ length: ' 44 ', width: ' 20 ', unit: 'ft' })).paintLength, 198, 'whitespace is trimmed');

// ---- Refusals, with the exact wording the page shows.
for (const [label, length, width, unit, message] of [
  ['empty length', '', '20', 'ft', 'Enter the court length in feet.'],
  ['empty width', '44', '', 'ft', 'Enter the court width in feet.'],
  ['words', 'abc', '20', 'ft', '"abc" is not a decimal number; enter the court length in feet.'],
  ['suffix', '44 ft', '20', 'ft', '"44 ft" is not a decimal number; enter the court length in feet.'],
  ['negative', '-44', '20', 'ft', '"-44" is not a decimal number; enter the court length in feet.'],
  ['exponent', '1e2', '20', 'ft', '"1e2" is not a decimal number; enter the court length in feet.'],
  ['length below range', '19', '20', 'ft', 'A court length is 20 to 60 ft; a regulation court is 44 ft.'],
  ['length above range', '60.5', '20', 'ft', 'A court length is 20 to 60 ft; a regulation court is 44 ft.'],
  ['width below range', '44', '9', 'ft', 'A court width is 10 to 40 ft; a regulation court is 20 ft.'],
  ['width above range', '44', '41', 'ft', 'A court width is 10 to 40 ft; a regulation court is 20 ft.'],
  ['metric length below range', '5.9', '6.1', 'm', 'A court length is 6 to 18.3 m; a regulation court is 13.41 m.'],
  ['metric width below range', '13.41', '2.9', 'm', 'A court width is 3 to 12.2 m; a regulation court is 6.10 m.'],
  ['unknown unit', '44', '20', 'yards', 'Choose feet or meters for the court dimensions.'],
  ['uppercase unit', '44', '20', 'FT', 'Choose feet or meters for the court dimensions.']
]) {
  assert.equal(failure(length, width, unit), message, label);
}
assert.equal(failure('44', '20', null), null, 'a missing unit falls back to feet');

// ---- Determinism.
for (const [length, width, unit] of [['44', '20', 'ft'], ['13.41', '6.10', 'm'], ['40', '20', 'ft']]) {
  assert.deepEqual(compute(length, width, unit), compute(length, width, unit), 'deterministic: ' + length);
}

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Pickleball Court Marking Calculator');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(record.added), 'added is a UTC timestamp');
assert.ok(record.description.length > 100, 'description is descriptive');
assert.ok(record.method.includes('3L + 4W - 14'), 'method states the painted-length relation');
assert.ok(record.method.includes('198 ft'), 'method pins the regulation painted length');
assert.ok(record.method.includes('7 ft'), 'method states the non-volley zone depth');
assert.ok(record.method.includes('48.33 ft'), 'method pins the diagonal');
assert.ok(record.method.includes('30 by 60 ft'), 'method states the minimum playing surface');
assert.ok(record.method.includes('36 in') && record.method.includes('34 in'), 'method states the net heights');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.equal(record.sources.length, 2, 'two references are cited');
assert.ok(record.sources.every((source) => typeof source.title === 'string' && source.title.length > 60),
  'every reference is titled specifically');
assert.ok(record.sources.every((source) => /^https:\/\/usapickleball\.org\//.test(source.url)),
  'the references are USA Pickleball pages');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 30, 'catalog case count');
assert.equal(kinds('golden'), 12, 'twelve golden cases');
assert.equal(kinds('boundary'), 5, 'five boundary cases');
assert.equal(kinds('validation'), 13, 'thirteen validation cases');

let replayed = 0;
for (const testCase of record.testCases) {
  const length = testCase.input.length;
  const width = testCase.input.width;
  const unit = testCase.input.unit;
  if (testCase.kind === 'validation') {
    assert.equal(failure(length, width, unit), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = compute(length, width, unit);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(actual[key], expected, testCase.name + ' ' + key);
    replayed += 1;
  }
  assert.ok(actual.lines.length === 8, testCase.name + ' schedule');
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
for (const tag of ['sports-&-outdoors', 'estimation-calculation', 'pickleball', 'court-marking', 'line-marking']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}
assert.equal(catalog.tools.length, 2506, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2245, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Sports & Outdoors').length, 57,
  'Sports & Outdoors count');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 8, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.equal(markupIds.size, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])).size,
  'no duplicate ids');
assert.ok(/<label[^>]*for="length">/.test(html) && /<label[^>]*for="width">/.test(html), 'both fields are labelled');
assert.ok(/<label[^>]*for="unit">/.test(html), 'the unit select is labelled');
assert.ok(/<option value="ft" selected>/.test(html), 'feet are the default unit');
assert.ok(/<option value="m">/.test(html), 'meters are offered');
assert.ok(/id="length"[^>]*value="44"/.test(html) && /id="width"[^>]*value="20"/.test(html),
  'the regulation size is the default');
assert.equal((html.match(/class="chip"/g) || []).length, 3, 'three starting points are offered');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/min-height:46px/.test(html), 'the inputs keep a comfortable height');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="decimal"/.test(html), 'a numeric keyboard is offered on touch');
assert.ok(/@media \(max-width:560px\)/.test(html), 'the layout has a narrow breakpoint');
assert.ok(/<table class="mk"/.test(html), 'the schedule is a table');
assert.ok(/data-label/.test(html), 'stacked cells carry their column labels');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('pickleball court marking: ' + swept + ' court sizes, ' + replayed
  + ' replayed catalog values, refusals and the page contract pass');
