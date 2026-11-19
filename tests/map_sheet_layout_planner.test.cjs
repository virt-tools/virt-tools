/* Map sheet layout planner: sheet counts from paper, scale, margin and overlap,
   an independent greedy layout model, boundaries, refusals, the catalog cases and
   the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'map-sheet-layout-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* mslp-core:start */';
const endMarker = '/* mslp-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SheetLayoutCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, label, tolerance) => {
  const limit = tolerance === undefined ? 1e-9 : tolerance;
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= limit * scale,
    label + ': ' + actual + ' is not within ' + limit + ' of ' + expected);
};
const solve = (input) => plain(C.describe(input));
const failure = (input) => {
  try { C.describe(input); } catch (error) { return error.message; }
  return null;
};
const input = (width, height, scale, paper, orientation, margin, overlap) => ({
  width: String(width), height: String(height), scale: String(scale), paper, orientation,
  margin: String(margin), overlap: String(overlap)
});
const base = input(30, 20, 25000, 'a4', 'portrait', 10, 10);

// ---- Constants and the exported surface.
assert.deepEqual(plain(C.PAPERS).map((paper) => [paper.id, paper.width, paper.height]), [
  ['a5', 148, 210], ['a4', 210, 297], ['a3', 297, 420],
  ['letter', 215.9, 279.4], ['legal', 215.9, 355.6], ['tabloid', 279.4, 431.8]
], 'ISO 216 A series and the US sizes, in millimetres');
assert.deepEqual(plain(C.COMMON_SCALES), [10000, 25000, 50000, 100000, 250000, 500000]);
assert.equal(C.MIN_KM, 0.01);
assert.equal(C.MAX_KM, 5000);
assert.equal(C.MIN_SCALE, 1000);
assert.equal(C.MAX_SCALE, 1000000);
assert.deepEqual(plain(Object.keys(C)).sort(), [
  'COMMON_SCALES', 'MAX_KM', 'MAX_MARGIN_MM', 'MAX_OVERLAP_MM', 'MAX_SCALE', 'MESSAGES',
  'MIN_KM', 'MIN_SCALE', 'PAPERS', 'coverMetres', 'describe', 'isNumber', 'paperFor',
  'parseKilometres', 'parseMillimetres', 'parseScale', 'round', 'sheetCount'
]);

// ---- Paper orientation swaps the trimmed dimensions.
assert.deepEqual(plain(C.paperFor('a4', 'portrait')),
  { id: 'a4', label: 'A4', orientation: 'portrait', width: 210, height: 297 });
assert.deepEqual(plain(C.paperFor('a4', 'landscape')),
  { id: 'a4', label: 'A4', orientation: 'landscape', width: 297, height: 210 });
assert.equal(C.paperFor('letter', 'landscape').height, 215.9);

// ---- One sheet covers its printable size at the map scale.
near(C.coverMetres(190, 25000), 4750, '190 mm at 1:25,000 is 4.75 km', 1e-12);
near(C.coverMetres(277, 25000), 6925, 'sheet height coverage', 1e-12);
near(C.coverMetres(1, 1000000), 1000, '1 mm at 1:1,000,000 is 1 km', 1e-12);

// ---- Counting: ceil, with an exact fit staying on the smaller count.
assert.equal(C.sheetCount(4750, 4750, 0), 1, 'an exact single sheet');
assert.equal(C.sheetCount(4750.001, 4750, 0), 2, 'a sliver past one sheet');
assert.equal(C.sheetCount(9500, 4750, 0), 2, 'an exact pair');
assert.equal(C.sheetCount(9500.001, 4750, 0), 3);
assert.equal(C.sheetCount(10, 4750, 250), 1, 'a tiny area still needs one sheet');
assert.equal(C.sheetCount(9500, 4750, 250), 3, 'overlap adds a sheet');

// ---- A worked default: 30 x 20 km on A4 portrait at 1:25,000.
const result = solve(base);
assert.equal(result.printableW, 190);
assert.equal(result.printableH, 277);
near(result.coverW, 4750, 'coverage across', 1e-12);
near(result.coverH, 6925, 'coverage down', 1e-12);
near(result.overlapM, 250, 'overlap on the ground', 1e-12);
assert.equal(result.across, 7);
assert.equal(result.down, 3);
assert.equal(result.sheets, 21);
near(result.spanW, 31750, 'grid spans the width', 1e-12);
near(result.spanH, 20275, 'grid spans the height', 1e-12);
near(result.paperAreaM2, 21 * 210 * 297 / 1000000, 'paper area', 1e-12);
near(result.mapAreaM2, 30 * 20 * 1000000 / (25000 * 25000), 'map area on paper', 1e-12);
assert.ok(result.fillRatio > 0 && result.fillRatio < 1, 'paper is not fully covered');
assert.equal(result.metresPerCm, 250, '1 cm on paper is 250 m at 1:25,000');
assert.equal(result.rows.length, 6);
assert.deepEqual(result.rows.map((row) => row.scale), plain(C.COMMON_SCALES));
assert.deepEqual(result.rows.map((row) => row.current), [false, true, false, false, false, false]);
assert.deepEqual(result.rows.map((row) => row.sheets), [136, 21, 8, 2, 1, 1]);
for (let index = 1; index < result.rows.length; index += 1) {
  assert.ok(result.rows[index].sheets <= result.rows[index - 1].sheets,
    'a smaller scale never needs more sheets');
}

// ---- An independent model: lay one sheet down, then add sheets one at a time,
// each advancing the covered edge by the coverage minus one overlap, until the
// target is reached.  It shares no formula with the count under test.
const greedy = (target, cover, overlap) => {
  let covered = cover;
  let count = 1;
  while (covered < target - 1e-9) {
    covered += cover - overlap;
    count += 1;
  }
  return count;
};

let seed = 20261119;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const between = (low, high) => low + (high - low) * random();

const layouts = [];
for (let index = 0; index < 300; index += 1) {
  const paper = C.PAPERS[Math.floor(random() * C.PAPERS.length)];
  const orientation = random() < 0.5 ? 'portrait' : 'landscape';
  const width = orientation === 'landscape' ? paper.height : paper.width;
  const height = orientation === 'landscape' ? paper.width : paper.height;
  const margin = Math.round(between(0, Math.min(30, Math.min(width, height) / 2 - 12)) * 10) / 10;
  const printableW = width - 2 * margin;
  const printableH = height - 2 * margin;
  const overlap = Math.round(between(0, Math.min(40, Math.min(printableW, printableH) - 5)) * 10) / 10;
  const scale = Math.round(between(1000, 500000) / 100) * 100;
  const areaWidth = Math.round(between(0.05, 4000) * 100) / 100;
  const areaHeight = Math.round(between(0.05, 4000) * 100) / 100;
  const area = {
    width: String(areaWidth), height: String(areaHeight), scale: String(scale),
    paper: paper.id, orientation, margin: String(margin), overlap: String(overlap)
  };
  const layout = solve(area);
  const coverW = printableW / 1000 * scale;
  const coverH = printableH / 1000 * scale;
  const overlapM = overlap / 1000 * scale;
  const across = greedy(areaWidth * 1000, coverW, overlapM);
  const down = greedy(areaHeight * 1000, coverH, overlapM);
  assert.equal(layout.across, across, 'sheets across: ' + JSON.stringify(area));
  assert.equal(layout.down, down, 'sheets down: ' + JSON.stringify(area));
  assert.equal(layout.sheets, across * down, 'total sheets: ' + JSON.stringify(area));
  near(layout.coverW, coverW, 'coverage across', 1e-12);
  near(layout.coverH, coverH, 'coverage down', 1e-12);
  near(layout.spanW, across * coverW - (across - 1) * overlapM, 'span across', 1e-12);
  near(layout.spanH, down * coverH - (down - 1) * overlapM, 'span down', 1e-12);
  near(layout.paperAreaM2, across * down * width * height / 1000000, 'paper area', 1e-12);
  assert.ok(layout.spanW >= areaWidth * 1000 - 1e-6, 'the grid covers the width');
  assert.ok(layout.spanH >= areaHeight * 1000 - 1e-6, 'the grid covers the height');
  if (across > 1) {
    assert.ok(layout.spanW - (coverW - overlapM) < areaWidth * 1000 + 1e-6,
      'one fewer sheet would fall short: ' + JSON.stringify(area));
  }
  if (down > 1) {
    assert.ok(layout.spanH - (coverH - overlapM) < areaHeight * 1000 + 1e-6,
      'one fewer row would fall short: ' + JSON.stringify(area));
  }
  layouts.push([area.sheets]);
}
assert.equal(layouts.length, 300, '300 seeded layouts checked');

// ---- Scale is linear in the count per sheet: doubling the denominator halves
// the ground one sheet carries.
const doubled = solve({ ...base, scale: '50000' });
near(doubled.coverW, result.coverW * 2, 'double the scale, double the coverage', 1e-12);
near(doubled.coverH, result.coverH * 2, 'coverage height doubles too', 1e-12);

// ---- Landscape turns the page, so the sheet is wider and shorter.
const landscape = solve({ ...base, orientation: 'landscape' });
near(landscape.coverW, 6925, 'landscape sheet width covers the paper height', 1e-12);
near(landscape.coverH, 4750, 'landscape sheet height covers the paper width', 1e-12);
assert.ok(landscape.across < result.across && landscape.down > result.down,
  'landscape trades columns for rows');

// ---- Zero margin and zero overlap are allowed.
const edgeToEdge = solve({ ...base, margin: '0', overlap: '0' });
assert.equal(edgeToEdge.printableW, 210);
assert.equal(edgeToEdge.coverW, 5250);
assert.equal(edgeToEdge.overlapM, 0);

// ---- The limits themselves are accepted.
assert.equal(solve({ ...base, width: '0.01', height: '0.01' }).sheets, 1);
const biggest = solve({ ...base, width: '5000', height: '5000', scale: '1000000' });
assert.equal(biggest.widthKm, 5000);
assert.equal(biggest.scale, 1000000);
assert.ok(biggest.sheets > 1, 'a 5,000 km square needs more than one sheet');
assert.equal(solve({ ...base, scale: '1000' }).scale, 1000);
assert.equal(solve({ ...base, scale: '1000000' }).scale, 1000000);
assert.equal(solve({ ...base, margin: '0' }).marginMm, 0);
assert.equal(solve({ ...base, overlap: '0' }).overlapMm, 0);

// ---- Refusals.
assert.equal(failure({ ...base, width: '' }), 'Enter the area width.');
assert.equal(failure({ ...base, width: 'thirty' }), 'Write the area width in kilometres, for example 30 or 12.5.');
assert.equal(failure({ ...base, width: '0' }), 'The area width must be between 0.01 and 5,000 km.');
assert.equal(failure({ ...base, width: '5001' }), 'The area width must be between 0.01 and 5,000 km.');
assert.equal(failure({ ...base, height: '' }), 'Enter the area height.');
assert.equal(failure({ ...base, height: 'twenty' }), 'Write the area height in kilometres, for example 20 or 7.5.');
assert.equal(failure({ ...base, height: '0' }), 'The area height must be between 0.01 and 5,000 km.');
assert.equal(failure({ ...base, height: '5001' }), 'The area height must be between 0.01 and 5,000 km.');
assert.equal(failure({ ...base, scale: '' }), 'Enter the map scale.');
assert.equal(failure({ ...base, scale: '1:25000' }), 'Write the scale denominator as a whole number, for example 25000 for 1:25,000.');
assert.equal(failure({ ...base, scale: '25000.5' }), 'Write the scale denominator as a whole number, for example 25000 for 1:25,000.');
assert.equal(failure({ ...base, scale: '500' }), 'The scale denominator must be between 1,000 and 1,000,000.');
assert.equal(failure({ ...base, scale: '2000000' }), 'The scale denominator must be between 1,000 and 1,000,000.');
assert.equal(failure({ ...base, paper: 'a2' }), 'Choose a paper size from the list.');
assert.equal(failure({ ...base, orientation: 'sideways' }), 'Choose portrait or landscape.');
assert.equal(failure({ ...base, margin: '' }), 'Enter the margin.');
assert.equal(failure({ ...base, margin: 'ten' }), 'Write the margin in millimetres, for example 10.');
assert.equal(failure({ ...base, margin: '120' }), 'The margin must be between 0 and 100 mm.');
assert.equal(failure({ ...base, margin: '100', paper: 'a5', orientation: 'portrait' }),
  'That margin leaves no printable width on this paper.');
assert.equal(failure({ ...base, margin: '100', paper: 'a5', orientation: 'landscape' }),
  'That margin leaves no printable height on this paper.');
assert.equal(failure({ ...base, overlap: '' }), 'Enter the sheet overlap.');
assert.equal(failure({ ...base, overlap: 'ten' }), 'Write the overlap in millimetres, for example 10.');
assert.equal(failure({ ...base, overlap: '120' }), 'The overlap must be between 0 and 100 mm.');
assert.equal(failure({ ...base, margin: '30', paper: 'a5', orientation: 'portrait', overlap: '88' }),
  'The overlap must be smaller than the printable width.');
assert.equal(failure({ ...base, margin: '30', paper: 'a5', orientation: 'landscape', overlap: '95' }),
  'The overlap must be smaller than the printable height.');

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Map Sheet Layout Planner');
assert.equal(entry.category, 'Geography');
assert.equal(entry.subcategory, 'Planning');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 700, 'method must document the model and its limits');
assert.equal(entry.sources.length, 2);
assert.ok(entry.sources.every((source) => /^https:\/\//.test(source.url)), 'https sources');
assert.equal(entry.testCases.length, 37, 'catalog case count');
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'golden').length, 6);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'boundary').length, 6);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'validation').length, 25);

for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const answer = solve(testCase.input);
  for (const [field, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') near(answer[field], expected, testCase.name + ' ' + field, 2e-6);
    else assert.equal(answer[field], expected, testCase.name + ' ' + field);
  }
}

// ---- A slug, name or alias belongs to one tool only.
const names = new Map();
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  for (const value of [tool.name, ...(tool.aliases || [])]) {
    const key = value.toLowerCase();
    if (!names.has(key)) names.set(key, new Set());
    names.get(key).add(tool.slug);
  }
}
for (const value of [entry.name, ...entry.aliases]) {
  assert.ok(!names.has(value.toLowerCase()), 'name or alias is not taken: ' + value);
}

// ---- Page contract.
assert.ok(/<h1>Map Sheet Layout Planner<\/h1>/.test(html), 'heading');
assert.ok(/<form id="sheets-form" novalidate>/.test(html), 'form');
for (const id of ['in-width', 'in-height', 'in-scale', 'in-paper', 'in-orientation', 'in-margin',
  'in-overlap', 'err', 'run', 'out', 'headline', 'sub', 'fact-printable', 'fact-sheet',
  'fact-grid', 'fact-paper', 'fact-cm', 'rows']) {
  assert.ok(html.includes('id="' + id + '"'), 'element id: ' + id);
}
for (const label of ['Area width', 'Area height', 'Map scale', 'Paper size', 'Orientation',
  'Margin', 'Sheet overlap']) {
  assert.ok(html.includes('>' + label + '</label>'), 'label: ' + label);
}
assert.ok(/<button type="submit" id="run">Plan the sheets<\/button>/.test(html), 'submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/Nothing is sent or stored/.test(html), 'the note states local only');
assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(html), 'no off-site links or requests');
assert.ok(!/<script[^>]+src="(?!\/assets\/)/.test(html), 'only local scripts');
assert.ok(!/\son(click|input|change|submit|keydown)=/.test(html), 'no inline event handlers');
assert.equal(html.match(/<script/g).length, 3, 'theme init, shared app and the tool script');
assert.ok(/min-height:44px/.test(html), '44px touch targets');
assert.ok(/<caption>/.test(html) && /scope="col"/.test(html), 'table caption and headers');
const ids = html.match(/\bid="[^"]+"/g).map((value) => value.slice(4, -1));
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');

console.log('map sheet layout planner: all assertions passed');
