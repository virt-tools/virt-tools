/* Stained-glass materials calculator: catalog replay, seam geometry,
   formatting, unit conversion, random identities, validation and contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'stained-glass-materials-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* stained-glass-core:start */';
const endMarker = '/* stained-glass-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = StainedGlassCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.parse(input));
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};
const near = (actual, expected, label) => {
  assert.ok(Math.abs(actual - expected) <= Math.max(1e-6, Math.abs(expected) * 1e-9),
    label + ': ' + actual + ' vs ' + expected);
};
const rows = (input) => run(input).pieces;

// ---- Exported contract.
assert.equal(C.UNITS.length, 2, 'inches and centimetres');
assert.deepEqual(plain(C.UNITS.map((unit) => unit.id)), ['in', 'cm']);
assert.equal(C.UNITS[0].lengthFactor, 1);
assert.equal(C.UNITS[1].lengthFactor, 2.54);
assert.equal(C.UNITS[1].areaFactor, 2.54 * 2.54);
assert.equal(C.UNITS[1].altAreaFactor, 2.54 * 2.54 / 10000);
assert.equal(C.UNITS[0].altAreaFactor, 1 / 144);
assert.equal(C.MIN_PIECE, 0.1);
assert.equal(C.MAX_PIECE, 500);
assert.equal(C.MIN_PANEL, 1);
assert.equal(C.MAX_PANEL, 1000);
assert.equal(C.MAX_COUNT, 200);
assert.equal(C.MAX_PIECES, 400);
assert.equal(C.MAX_ROWS, 40);
assert.equal(C.DEFAULTS.in.pieces.length, 4);
assert.equal(C.DEFAULTS.cm.pieces.length, 4);

// ---- Number and percentage formatting.
assert.equal(C.formatNumber(0), '0');
assert.equal(C.formatNumber(192), '192');
assert.equal(C.formatNumber(1200), '1,200');
assert.equal(C.formatNumber(1000000), '1,000,000');
assert.equal(C.formatNumber(0.01), '0.01');
assert.equal(C.formatNumber(0.00999), '9.99e-3');
assert.equal(C.formatNumber(22.5), '22.5');
assert.equal(C.formatNumber(84.256), '84.26');
assert.equal(C.formatNumber(-12.5), '-12.5');
assert.equal(C.formatPercent(1), '100%');
assert.equal(C.formatPercent(0.25), '25%');
assert.equal(C.formatPercent(1 / 6), '16.7%');
assert.equal(C.formatPercent(4), '400%');

// ---- The definitions themselves: came = (perimeters + border) / 2.
const demo = run({
  units: 'in', panelWidth: '12', panelHeight: '16',
  pieces: [{ width: '8', height: '12', count: '1' }, { width: '8', height: '4', count: '1' },
    { width: '4', height: '12', count: '1' }, { width: '4', height: '4', count: '1' }]
});
assert.equal(demo.totalPieces, 4);
assert.equal(demo.glassAreaIn2, 192, 'four pieces fill a 12 x 16 panel');
assert.equal(demo.panelAreaIn2, 192);
assert.equal(demo.perimeterIn, 112, '40 + 24 + 32 + 16');
assert.equal(demo.borderIn, 56, '2 x (12 + 16)');
assert.equal(demo.cameIn, 84, '(112 + 56) / 2');
assert.equal(demo.foilIn, 112, 'foil is one strip around every piece');
assert.equal(demo.solderIn, 168, 'both faces of every seam');
assert.equal(demo.coverage, 1);
assert.equal(demo.bigText, '192 in\u00b2');
assert.equal(demo.subText, '4 pieces, 1.33 ft\u00b2');
assert.equal(demo.caution, '', 'a full panel is not a caution');
const demoRows = Object.fromEntries(demo.rows.map((row) => [row.key, row.value]));
assert.equal(demoRows['Glass area, ft\u00b2'], '1.33 ft\u00b2');
assert.equal(demoRows['Panel area'], '192 in\u00b2');
assert.equal(demoRows['Glass coverage'], '100%');
assert.equal(demoRows['Lead came'], '84 in');
assert.equal(demoRows['Lead came, ft'], '7 ft');
assert.equal(demoRows['Copper foil'], '112 in');
assert.equal(demoRows['Solder seam, both faces'], '168 in');
assert.equal(demo.copyText, '192 in\u00b2 of glass, 84 in of lead came, 112 in of copper foil');

// ---- A single piece is the check case: came = foil = border, solder = 2 border.
const single = run({ units: 'in', panelWidth: '10', panelHeight: '10', pieces: [{ width: '10', height: '10', count: '1' }] });
assert.equal(single.cameIn, 40);
assert.equal(single.foilIn, 40);
assert.equal(single.solderIn, 80);
assert.equal(single.cameIn, single.borderIn);

// ---- Catalog replay of the published cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Stained Glass Materials Calculator');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.deepEqual(record.sources, [], 'the geometry is bespoke, so no sources are claimed');
assert.equal(record.testCases.length, 25, '25 catalog cases');
assert.equal(record.testCases.filter((entry) => entry.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((entry) => entry.kind === 'boundary').length, 6);
assert.equal(record.testCases.filter((entry) => entry.kind === 'validation').length, 9);

for (const testCase of record.testCases) {
  if (testCase.expected.error) {
    assert.equal(failure(testCase.input), testCase.expected.error, 'refusal: ' + testCase.name);
    continue;
  }
  const result = run(testCase.input);
  for (const key of ['glassAreaIn2', 'panelAreaIn2', 'cameIn', 'foilIn', 'solderIn']) {
    near(result[key], testCase.expected[key], testCase.name + ' ' + key);
  }
  assert.equal(result.totalPieces, testCase.expected.totalPieces, testCase.name + ' pieces');
  assert.equal(result.bigText, testCase.expected.bigText, testCase.name + ' area text');
  assert.equal(C.formatPercent(result.coverage), testCase.expected.coverageText, testCase.name + ' coverage');
}

// ---- The catalogue is the single place a slug, name or alias may live.
const names = new Map();
for (const tool of catalog.tools) {
  for (const value of [tool.name, ...(tool.aliases || [])]) {
    const key = value.toLowerCase();
    if (!names.has(key)) names.set(key, new Set());
    names.get(key).add(tool.slug);
  }
}
for (const value of [record.name, ...record.aliases]) {
  const owners = names.get(value.toLowerCase());
  assert.equal(owners.size, 1, 'name or alias belongs to one tool: ' + value);
  assert.ok(owners.has(slug), 'name or alias belongs to this tool: ' + value);
}
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1);

// ---- Seeded random panels keep the seam identities and the unit conversion.
let seed = 20261117;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
for (let trial = 0; trial < 300; trial += 1) {
  const pieces = [];
  const count = 1 + Math.floor(random() * 6);
  for (let index = 0; index < count; index += 1) {
    pieces.push({
      width: (0.2 + random() * 40).toFixed(2),
      height: (0.2 + random() * 40).toFixed(2),
      count: String(1 + Math.floor(random() * 4))
    });
  }
  const panelWidth = (2 + random() * 200).toFixed(2);
  const panelHeight = (2 + random() * 200).toFixed(2);
  const result = run({ units: 'in', panelWidth, panelHeight, pieces });
  let area = 0;
  let perimeter = 0;
  for (const piece of result.pieces) {
    assert.equal(piece.perimeter, 2 * (piece.width + piece.height) * piece.count, 'piece perimeter');
    assert.equal(piece.area, piece.width * piece.height * piece.count, 'piece area');
    area += piece.area;
    perimeter += piece.perimeter;
  }
  near(result.glassAreaIn2, area, 'summed area');
  near(result.foilIn, perimeter, 'foil is the perimeter sum');
  near(result.cameIn, (perimeter + result.borderIn) / 2, 'came is half the seam length');
  near(result.solderIn, perimeter + result.borderIn, 'solder covers both faces');
  near(result.panelAreaIn2, Number(panelWidth) * Number(panelHeight), 'panel area');
  near(result.coverage, result.glassAreaIn2 / result.panelAreaIn2, 'coverage');
}

// ---- The same panel in centimetres is the same panel in inches.
const inches = run({ units: 'in', panelWidth: '12', panelHeight: '16',
  pieces: [{ width: '8', height: '12', count: '1' }, { width: '8', height: '4', count: '1' },
    { width: '4', height: '12', count: '1' }, { width: '4', height: '4', count: '1' }] });
const centimetres = run({ units: 'cm', panelWidth: '30.48', panelHeight: '40.64',
  pieces: [{ width: '20.32', height: '30.48', count: '1' }, { width: '20.32', height: '10.16', count: '1' },
    { width: '10.16', height: '30.48', count: '1' }, { width: '10.16', height: '10.16', count: '1' }] });
near(centimetres.glassAreaIn2, inches.glassAreaIn2, 'same glass in cm');
near(centimetres.cameIn, inches.cameIn, 'same came in cm');
assert.equal(centimetres.bigText, '1,238.71 cm\u00b2');
assert.equal(centimetres.subText, '4 pieces, 0.12 m\u00b2');
assert.equal(centimetres.rows[0].value, '0.12 m\u00b2');

// ---- Blank rows are skipped, a blank count is one, and counts multiply.
const blankRow = run({ units: 'in', panelWidth: '6', panelHeight: '6',
  pieces: [{ width: '2', height: '3', count: '' }, { width: '', height: '', count: '' }] });
assert.equal(blankRow.totalPieces, 1);
assert.equal(blankRow.glassAreaIn2, 6);
const multiplied = run({ units: 'in', panelWidth: '12', panelHeight: '16', pieces: [{ width: '6', height: '8', count: '4' }] });
assert.equal(multiplied.totalPieces, 4);
assert.equal(multiplied.glassAreaIn2, 192);
assert.equal(multiplied.cameIn, 84);

// ---- Refusals stay specific.
assert.equal(failure({ units: 'in', panelWidth: '12', panelHeight: '16',
  pieces: [{ width: '8', height: '12', count: '1' }], }), null);
assert.equal(failure({ units: 'yd', panelWidth: '12', panelHeight: '16', pieces: [] }), 'Pick inches or centimetres.');
assert.equal(failure({ units: 'in', panelWidth: '1001', panelHeight: '16', pieces: [] }),
  'The panel width must be between 1 and 1,000 in.');
assert.equal(failure({ units: 'cm', panelWidth: '0.5', panelHeight: '16', pieces: [] }),
  'The panel width must be between 2.54 and 2,540 cm.');
assert.equal(failure({ units: 'in', panelWidth: '12', panelHeight: '16',
  pieces: [{ width: '8', height: '12', count: '201' }] }),
  'Piece 1 needs a whole-number count from 1 to 200.');
assert.equal(failure({ units: 'in', panelWidth: '12', panelHeight: '16',
  pieces: [{ width: '1,5', height: '12', count: '1' }] }),
  'Enter piece 1 width as a number, such as 12.');
assert.equal(failure({ units: 'in', panelWidth: '12', panelHeight: '16',
  pieces: [{ width: '0.05', height: '12', count: '1' }] }),
  'Piece 1 width must be between 0.1 and 500 in.');
const rowsOver = [];
for (let index = 0; index < 41; index += 1) rowsOver.push({ width: '1', height: '1', count: '1' });
assert.equal(failure({ units: 'in', panelWidth: '12', panelHeight: '16', pieces: rowsOver }),
  'That is more than 40 piece rows; group identical pieces with a count.');

// ---- A piece list bigger than the panel is reported, not silently accepted.
const over = run({ units: 'in', panelWidth: '4', panelHeight: '4', pieces: [{ width: '8', height: '8', count: '1' }] });
assert.equal(C.formatPercent(over.coverage), '400%');
assert.ok(/do not fit inside it/.test(over.caution), 'the caution explains the mismatch');
assert.equal(over.cameIn, (32 + 16) / 2, 'the geometry still follows the pieces');

// ---- Page contract.
assert.ok(/<h1>Stained Glass Materials Calculator<\/h1>/.test(html), 'heading');
assert.ok(/<form id="materials-form" novalidate>/.test(html), 'form');
for (const id of ['units', 'panel-w', 'panel-h', 'rows', 'add', 'clear', 'copy', 'out', 'err', 'status']) {
  assert.ok(html.includes('id="' + id + '"'), 'element id: ' + id);
}
assert.ok(/<label for="panel-w">Panel width<\/label>/.test(html), 'panel width label');
assert.ok(/<label for="panel-h">Panel height<\/label>/.test(html), 'panel height label');
assert.ok(/<label for="units">Units<\/label>/.test(html), 'units label');
assert.ok(/row\.querySelector\("\.cell\.width span"\)\.textContent = "Width \("/.test(html), 'piece inputs are labelled');
assert.ok(/id="panel-hint"/.test(html), 'panel hint');
assert.ok(!/https?:\/\//.test(html), 'no off-site links or requests');
assert.ok(!/<script[^>]+src="(?!\/assets\/)/.test(html), 'only local scripts');
assert.ok(!/\son(click|input|change|submit)=/.test(html), 'no inline event handlers');
assert.ok(/sum of all the piece perimeters plus the panel perimeter/.test(html), 'the method note explains the formula');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.equal(html.match(/<script/g).length, 3, 'theme init, shared app and the tool script');

console.log('stained-glass materials calculator: all assertions passed');
