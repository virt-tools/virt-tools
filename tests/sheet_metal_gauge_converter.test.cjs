/* Sheet metal gauge converter: the four published gauge tables, exact inch to
   millimetre conversion, input parsing, nearest-gauge lookup, catalog replay,
   uniqueness and the page contract. The fixture table was transcribed from
   the Cascadia Metals and American Steel & Aluminum gauge charts and checked
   against the Turn2 Engineering multi-material table, so a typo in the page
   data or in a conversion factor fails here. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'sheet-metal-gauge-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* sheet-metal-gauge-core:start */';
const endMarker = '/* sheet-metal-gauge-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SheetMetalGaugeCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (value, material) => plain(C.convert(value, material));
const failure = (value, material) => {
  try { run(value, material); } catch (error) { return error.message; }
  return null;
};
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);

// ---- Published tables, decimal inches, gauge 7 to 30.
// steel = Manufacturers' Standard Gauge, galvanized = MSG plus the 0.0037 in
// coating allowance (no gauge 7 published), stainless = stainless sheet gauge,
// aluminum = Brown & Sharpe / American Wire Gauge.
const PUBLISHED = [
  [7, 0.1793, null, 0.1875, 0.1443],
  [8, 0.1644, 0.1681, 0.1719, 0.1285],
  [9, 0.1495, 0.1532, 0.1563, 0.1144],
  [10, 0.1345, 0.1382, 0.1406, 0.1019],
  [11, 0.1196, 0.1233, 0.1250, 0.0907],
  [12, 0.1046, 0.1084, 0.1094, 0.0808],
  [13, 0.0897, 0.0934, 0.0938, 0.0720],
  [14, 0.0747, 0.0785, 0.0781, 0.0641],
  [15, 0.0673, 0.0710, 0.0703, 0.0571],
  [16, 0.0598, 0.0635, 0.0625, 0.0508],
  [17, 0.0538, 0.0575, 0.0563, 0.0453],
  [18, 0.0478, 0.0516, 0.0500, 0.0403],
  [19, 0.0418, 0.0456, 0.0438, 0.0359],
  [20, 0.0359, 0.0396, 0.0375, 0.0320],
  [21, 0.0329, 0.0366, 0.0344, 0.0285],
  [22, 0.0299, 0.0336, 0.0313, 0.0253],
  [23, 0.0269, 0.0306, 0.0281, 0.0226],
  [24, 0.0239, 0.0276, 0.0250, 0.0201],
  [25, 0.0209, 0.0247, 0.0219, 0.0179],
  [26, 0.0179, 0.0217, 0.0187, 0.0159],
  [27, 0.0164, 0.0202, 0.0172, 0.0142],
  [28, 0.0149, 0.0187, 0.0156, 0.0126],
  [29, 0.0135, 0.0172, 0.0141, 0.0113],
  [30, 0.0120, 0.0157, 0.0125, 0.0100]
];

assert.deepEqual(plain(C.ROWS), PUBLISHED, 'the page table matches the published gauge charts');
assert.equal(C.MM_PER_INCH, 25.4, 'the international inch is exactly 25.4 mm');
assert.equal(C.GAUGE_MIN, 7);
assert.equal(C.GAUGE_MAX, 30);
assert.equal(C.THICKNESS_MIN_MM, 0.05);
assert.equal(C.THICKNESS_MAX_MM, 25);
assert.equal(C.DEFAULT_MATERIAL, 'steel');
assert.equal(C.DEFAULT_VALUE, '16');
assert.deepEqual(plain(C.MATERIALS.map((material) => material.id)), ['steel', 'galvanized', 'stainless', 'aluminum']);
assert.deepEqual(plain(C.MATERIALS.map((material) => material.label)), ['Carbon steel', 'Galvanized steel', 'Stainless steel', 'Aluminum']);

// ---- Table shape and monotonicity: every column gets thinner as the number grows.
for (let index = 0; index < PUBLISHED.length; index += 1) {
  assert.equal(C.ROWS[index][0], 7 + index, 'gauges run 7 to 30 without a gap');
}
const gaps = [];
for (let column = 1; column <= 4; column += 1) {
  let previous = null;
  for (const row of C.ROWS) {
    if (row[column] == null) { gaps.push([row[0], column]); continue; }
    if (previous !== null) assert.ok(row[column] < previous, 'column ' + column + ' decreases with gauge number');
    previous = row[column];
  }
}
assert.deepEqual(gaps, [[7, 2]], 'only galvanized gauge 7 is unpublished');

// ---- Exact conversions derived from the inch definition, not from the page.
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' vs ' + expected);
near(C.thicknessOf(16, 'steel').mm, 0.0598 * 25.4, 1e-12, '16 ga steel mm');
near(C.thicknessOf(16, 'steel').mm, 1.51892, 1e-12, '16 ga steel 1.51892 mm');
near(C.thicknessOf(16, 'galvanized').mm, 0.0635 * 25.4, 1e-12, '16 ga galvanized mm');
near(C.thicknessOf(16, 'stainless').mm, 1.5875, 1e-12, '16 ga stainless is a sixteenth of an inch');
near(C.thicknessOf(16, 'aluminum').mm, 1.29032, 1e-12, '16 ga aluminum mm');
near(C.thicknessOf(30, 'galvanized').mm, 0.39878, 1e-12, '30 ga galvanized mm');
near(C.thicknessOf(7, 'steel').mm, 4.55422, 1e-12, '7 ga steel mm');
assert.equal(C.thicknessOf(7, 'galvanized'), null, 'galvanized gauge 7 does not exist');
assert.equal(C.inchesAt(1, 'steel'), null, 'gauge 1 is outside the table');
assert.equal(C.inchesAt(31, 'steel'), null, 'gauge 31 is outside the table');

// ---- Formatting rules: inches to four places, millimetres to three, signed per cent.
assert.equal(C.formatIn(0.0598), '0.0598');
assert.equal(C.formatIn(0.012), '0.0120');
assert.equal(C.formatMm(1.51892), '1.519');
assert.equal(C.formatMm(0.3048), '0.305');
assert.equal(C.formatMm(1.5875), '1.588');
assert.equal(C.formatPct(6.1876), '+6.2%');
assert.equal(C.formatPct(-15.05), '\u221215.1%');
assert.equal(C.formatPct(0), '+0.0%');

// ---- Parsing: gauges, thicknesses with units, and decimal commas.
assert.deepEqual(plain(C.parse('16')), { mode: 'gauge', gauge: 16 });
assert.deepEqual(plain(C.parse(' 16 ')), { mode: 'gauge', gauge: 16 });
assert.deepEqual(plain(C.parse('16 ga')), { mode: 'gauge', gauge: 16 });
assert.deepEqual(plain(C.parse('16GA')), { mode: 'gauge', gauge: 16 });
assert.deepEqual(plain(C.parse('gauge 16')), { mode: 'gauge', gauge: 16 });
assert.deepEqual(plain(C.parse('Gauge16')), { mode: 'gauge', gauge: 16 });
assert.deepEqual(plain(C.parse('#16')), { mode: 'gauge', gauge: 16 });
assert.deepEqual(plain(C.parse('1.52 mm')), { mode: 'thickness', mm: 1.52, unit: 'mm' });
assert.deepEqual(plain(C.parse('1,52 mm')), { mode: 'thickness', mm: 1.52, unit: 'mm' });
assert.deepEqual(plain(C.parse('0.0598 in')), { mode: 'thickness', mm: 1.5189199999999998, unit: 'in' });
assert.deepEqual(plain(C.parse('0.0598"')), { mode: 'thickness', mm: 1.5189199999999998, unit: 'in' });
assert.deepEqual(plain(C.parse('1.52')), { mode: 'thickness', mm: 1.52, unit: 'mm' });
assert.deepEqual(plain(C.parse('.5')), { mode: 'thickness', mm: 0.5, unit: 'mm' });
assert.equal(failure('', 'steel'), 'Enter a gauge number or a thickness.');
assert.equal(failure('   ', 'steel'), 'Enter a gauge number or a thickness.');
assert.equal(failure('thick', 'steel'), 'Enter a gauge number such as 16, or a thickness such as 1.52 mm or 0.0598 in.');
assert.deepEqual(plain(C.parse('16 in')), { mode: 'thickness', mm: 406.4, unit: 'in' }, '16 in is a thickness, not a gauge');
assert.equal(failure('6.5 ga', 'steel'), 'A gauge number is a whole number; write the thickness with a unit, such as 1.52 mm.');
assert.equal(failure('gauge 6.5', 'steel'), 'Enter a gauge number such as 16, or a thickness such as 1.52 mm or 0.0598 in.');

// ---- A gauge conversion names the metal and every other table at that number.
const steel16 = run('16', 'steel');
assert.equal(steel16.mode, 'gauge');
assert.equal(steel16.gauge, 16);
assert.equal(steel16.inches, 0.0598);
near(steel16.mm, 1.51892, 1e-12, 'result mm');
assert.equal(steel16.bigLabel, 'Thickness');
assert.equal(steel16.bigText, '1.519 mm');
assert.equal(steel16.subText, "Gauge 16 \u00b7 Carbon steel \u00b7 Manufacturers' Standard Gauge");
assert.equal(steel16.copyText, '1.519 mm');
assert.deepEqual(steel16.rows, [
  { k: 'Decimal inches', v: '0.0598 in' },
  { k: 'Millimetres', v: '1.519 mm' },
  { k: 'Galvanized steel, 16 ga', v: '1.613 mm (+6.2%)' },
  { k: 'Stainless steel, 16 ga', v: '1.588 mm (+4.5%)' },
  { k: 'Aluminum, 16 ga', v: '1.290 mm (\u221215.1%)' }
]);
assert.equal(run('16', 'galvanized').bigText, '1.613 mm');
assert.equal(run('16', 'stainless').bigText, '1.588 mm');
assert.equal(run('16', 'aluminum').bigText, '1.290 mm');
assert.equal(run('30', 'galvanized').bigText, '0.399 mm');
assert.equal(run('7', 'steel').bigText, '4.554 mm');
const steel7 = run('7', 'steel');
assert.equal(steel7.rows[2].k, 'Galvanized steel, 7 ga');
assert.equal(steel7.rows[2].v, 'no gauge 7');
assert.equal(run('16', 'galvanized').rows.length, 5, 'three other metals plus the two thickness rows');

// ---- The percentage row is relative to the selected metal, so it flips sign.
const galv16 = run('16', 'galvanized');
assert.equal(galv16.rows[2].v, '1.519 mm (\u22125.8%)');
assert.equal(galv16.rows[3].v, '1.588 mm (\u22121.6%)');
assert.equal(galv16.rows[4].v, '1.290 mm (\u221220.0%)');

// ---- Thickness to nearest gauge, checked against the rows by hand.
const mm15 = run('1.5 mm', 'steel');
assert.equal(mm15.mode, 'thickness');
assert.equal(mm15.gauge, 16);
assert.equal(mm15.bigLabel, 'Nearest gauge \u00b7 Carbon steel');
assert.equal(mm15.bigText, '16 ga');
assert.equal(mm15.subText, '1.500 mm is closest to 16 gauge at 1.519 mm, 0.019 mm (+1.3%) thicker');
assert.deepEqual(mm15.rows.map((row) => row.k), ['Entered', 'Carbon steel (selected)', 'Galvanized steel', 'Stainless steel', 'Aluminum']);
assert.equal(mm15.rows[0].v, '1.500 mm (0.0591 in)');
assert.equal(mm15.rows[1].v, '16 ga \u00b7 1.519 mm (+1.3%)');
assert.equal(mm15.rows[2].v, '17 ga \u00b7 1.461 mm (\u22122.6%)');
assert.equal(mm15.rows[3].v, '17 ga \u00b7 1.430 mm (\u22124.7%)');
assert.equal(mm15.rows[4].v, '15 ga \u00b7 1.450 mm (\u22123.3%)');

const exact = run('0.0598 in', 'steel');
assert.equal(exact.gauge, 16);
assert.equal(exact.subText, '1.519 mm is exactly 16 gauge, 0.0598 in');
assert.equal(exact.rows[1].v, '16 ga \u00b7 1.519 mm (+0.0%)');

const thin = run('0.254 mm', 'aluminum');
assert.equal(thin.gauge, 30);
assert.equal(thin.subText, '0.254 mm is exactly 30 gauge, 0.0100 in');

const alu3 = run('3 mm', 'aluminum');
assert.equal(alu3.gauge, 9, '3 mm is nearest the 9 gauge aluminum row at 2.906 mm');
assert.equal(C.nearest(3, 'aluminum').gauge, 9);
assert.equal(C.nearest(1.5, 'steel').gauge, 16);
assert.equal(C.nearest(1.6, 'steel').gauge, 16);
assert.equal(C.nearest(1.7, 'steel').gauge, 15, 'the 15 gauge row at 1.709 mm is nearer than 16 at 1.519');

// ---- Refusals and their exact wording.
assert.equal(failure('6', 'steel'),
  'Gauge numbers in this converter run from 7 to 30; heavier sheet is normally ordered by decimal thickness.');
assert.equal(failure('31', 'steel'),
  'Gauge numbers in this converter run from 7 to 30; heavier sheet is normally ordered by decimal thickness.');
assert.equal(failure('7', 'galvanized'),
  'Galvanized sheet has no gauge 7 in the published tables; the galvanized column runs from 8 to 30.');
assert.equal(failure('5 mm', 'steel'),
  'That is thicker than 7 gauge in every table here (4.763 mm); thicker plate is ordered by decimal thickness.');
assert.equal(failure('0.1 mm', 'steel'),
  'That is thinner than 30 gauge in every table here (0.254 mm); foil is ordered by thickness.');
assert.equal(failure('0.01 mm', 'steel'), 'Enter a thickness of at least 0.05 mm.');
assert.equal(failure('30 mm', 'steel'), 'Enter a thickness of at most 25 mm.');
assert.equal(failure('16', 'wood'), 'Choose one of the four sheet metals.');

// ---- The chart export repeats the table with display strings.
const chart = plain(C.chart());
assert.equal(chart.length, 24);
assert.deepEqual(chart[0].cells[0], { inches: 0.1793, mm: 4.554219999999999, inText: '0.1793 in', mmText: '4.554 mm' });
assert.deepEqual(chart[0].cells[1], { inches: null, mm: null, inText: '\u2014', mmText: '' });
assert.deepEqual(chart[23].cells[3], { inches: 0.01, mm: 0.254, inText: '0.0100 in', mmText: '0.254 mm' });

// ---- Catalog record.
assert.ok(record, 'catalog record exists');
assert.equal(record.name, 'Sheet Metal Gauge Converter');
assert.equal(record.category, 'Converters');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(record.added), 'added is a UTC timestamp');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.method.length > 800, 'method explains the arithmetic');
assert.ok(record.tags.includes('sheet-metal') && record.tags.includes('gauge'));
assert.ok(record.sources.length >= 4, 'sources are cited');
const urls = record.sources.filter((source) => source.url);
assert.ok(urls.length >= 3, 'three published tables carry a URL');
for (const source of urls) assert.ok(/^https:\/\//.test(source.url), 'source URL is https');
assert.equal(record.sources.filter((source) => /^https:\/\/(www\.)?cmetals\.com\//.test(source.url || '')).length, 1);
assert.equal(record.sources.filter((source) => /americansteelandaluminum\.com/.test(source.url || '')).length, 1);

// ---- Replay every catalog case against the core.
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 20, 'catalog case count');
assert.equal(kinds('golden'), 9, 'nine golden cases');
assert.equal(kinds('boundary'), 3, 'three boundary cases');
assert.equal(kinds('validation'), 8, 'eight validation cases');
for (const testCase of record.testCases) {
  const value = testCase.input.value;
  const material = testCase.input.material;
  if (testCase.expectedError) {
    assert.equal(failure(value, material), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(value, material);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], expected, testCase.name + ': ' + key);
  }
}

// ---- No duplicate: slug, name and aliases are unique across the catalog.
const slugHits = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(slugHits.length, 1);
const nameHits = catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase());
assert.equal(nameHits.length, 1, 'name is unique');
const aliasHits = catalog.tools.filter((tool) => (tool.aliases || [])
  .some((alias) => alias.toLowerCase() === 'metal gauge converter'));
assert.equal(aliasHits.length, 1, 'alias points only at the new tool');
assert.equal(catalog.tools.filter((tool) => /sheet[- ]metal (gauge|thickness)/i.test(tool.name)).length, 1,
  'no other sheet-metal gauge tool');
assert.equal(catalog.tools.filter((tool) => /^(gauge|sheet gauge|metal gauge)$/i.test(tool.slug)).length, 0);

// ---- Page contract.
assert.ok(html.includes('<html lang="en">'));
assert.ok(/<title>Sheet Metal Gauge Converter &mdash; Virtual Tools<\/title>/.test(html));
assert.ok(/<meta name="description" content="[^"]{80,}">/.test(html));
assert.ok(html.includes('<script src="/assets/theme-init.js"></script>'));
assert.ok(html.includes('<link rel="stylesheet" href="/assets/style.css">'));
assert.ok(html.includes('<script src="/assets/app.js"></script>'));
assert.ok(html.includes('<div id="site-header"></div>'));
assert.ok(/<h1>Sheet Metal Gauge Converter<\/h1>/.test(html));
assert.ok(/<label for="material">Sheet metal<\/label>/.test(html));
assert.ok(/<label for="value">Gauge number or thickness<\/label>/.test(html));
assert.ok(/<button type="submit">Convert gauge<\/button>/.test(html));
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('@media (max-width:560px)'));
const headers = [...html.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((match) => match[1]);
assert.deepEqual(headers, ['Gauge', 'Carbon steel', 'Galvanized', 'Stainless', 'Aluminum']);
assert.ok(!/https?:\/\//.test(html), 'the page fetches nothing from the network');
assert.ok(!/\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), 'no fetch or storage');
assert.ok(/Everything runs in your browser/.test(html));
