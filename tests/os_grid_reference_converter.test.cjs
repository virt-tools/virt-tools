/* Regression checks for the OS National Grid converter core and its catalog test cases.
 *
 * Two published worked examples from the Ordnance Survey guide are the anchors:
 * annexe C.1 (Airy 1830 latitude/longitude to National Grid eastings and northings) and
 * annexe D (the seven-parameter Helmert transformation from ETRS89/WGS84 to OSGB36, then
 * the same projection). Their printed intermediates are the independent expectation;
 * nothing below is copied back out of the page.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'os-grid-reference-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* osgrid-core:start */';
const endMarker = '/* osgrid-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'osgrid core markers missing');
const core = html.slice(start, end + endMarker.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = OsGridCore;', sandbox);
const C = sandbox.module.exports;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const AIRY_A = 6377563.396;
const AIRY_B = 6356256.909;
const AIRY_E2 = (AIRY_A * AIRY_A - AIRY_B * AIRY_B) / (AIRY_A * AIRY_A);
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: got ${actual}, expected ${expected} within ${tolerance}`);

// ---- Annexe C.1: latitude 52 39 27.2531 N, longitude 1 43 04.5177 E on Airy 1830.
{
  const lat = (52 + 39 / 60 + 27.2531 / 3600) * D2R;
  const lon = (1 + 43 / 60 + 4.5177 / 3600) * D2R;
  const grid = C.project(lat, lon);
  near(grid.east, 651409.903, 0.001, 'annexe C.1 easting');
  near(grid.north, 313177.270, 0.001, 'annexe C.1 northing');
  // The published reference for this example is TG 51409 13177 (Caister water tower).
  assert.equal(C.lettersFor(grid.east, grid.north), 'TG', 'annexe C.1 square');
  const back = C.unproject(651409.903, 313177.270);
  near(back.lat * R2D, 52 + 39 / 60 + 27.2531 / 3600, 1e-8, 'annexe C.1 inverse latitude');
  near(back.lon * R2D, 1 + 43 / 60 + 4.5177 / 3600, 1e-8, 'annexe C.1 inverse longitude');
}

// ---- Annexe D: ETRS89/WGS84 XYZ -> OSGB36 XYZ -> latitude/longitude/height -> eastings.
{
  const xA = [3790644.900, -110149.210, 5111482.970];
  const xB = C.helmertToOsgb(xA);
  near(xB[0], 3790269.549, 0.001, 'annexe D X');
  near(xB[1], -110038.064, 0.001, 'annexe D Y');
  near(xB[2], 5111050.261, 0.001, 'annexe D Z');
  const round = C.helmertToWgs(xB);
  near(round[0], xA[0], 0.005, 'annexe D inverse X');
  near(round[1], xA[1], 0.005, 'annexe D inverse Y');
  near(round[2], xA[2], 0.005, 'annexe D inverse Z');
  const geodetic = C.fromEcef(xB[0], xB[1], xB[2], AIRY_A, AIRY_E2);
  const lat = 53 + 36 / 60 + 42.2972 / 3600;
  const lon = -(1 + 39 / 60 + 46.5416 / 3600);
  near(geodetic[0] * R2D, lat, 1e-7, 'annexe D latitude');
  near(geodetic[1] * R2D, lon, 1e-7, 'annexe D longitude');
  near(geodetic[2], 249.950, 0.01, 'annexe D height');
  const grid = C.project(geodetic[0], geodetic[1]);
  near(grid.east, 422297.792, 0.001, 'annexe D easting');
  near(grid.north, 412878.741, 0.001, 'annexe D northing');
  assert.equal(C.lettersFor(grid.east, grid.north), 'SE', 'annexe D square');
}

// ---- The letter grid: 25 letters without I, and every square origin round trips.
assert.equal(C.LETTERS, 'ABCDEFGHJKLMNOPQRSTUVWXYZ', 'letter alphabet');
assert.equal(C.LETTERS.length, 25, 'twenty-five letters');
assert.equal(C.LETTERS.indexOf('I'), -1, 'no letter I');
let squares = 0;
for (let n100 = 0; n100 <= 12; n100 += 1) {
  for (let e100 = 0; e100 <= 6; e100 += 1) {
    const east = e100 * 100000 + 50000;
    const north = n100 * 100000 + 50000;
    const letters = C.lettersFor(east, north);
    assert.ok(letters && /^[A-HJ-Z]{2}$/.test(letters), `square for ${east}/${north}`);
    const origin = C.squareOrigin(letters);
    assert.ok(origin, `${letters}: origin resolved`);
    assert.equal(origin.east, e100 * 100000, `${letters}: easting origin`);
    assert.equal(origin.north, n100 * 100000, `${letters}: northing origin`);
    squares += 1;
  }
}
assert.equal(squares, 7 * 13, 'every square in the British grid window round trips');
assert.equal(C.squareOrigin('XX'), null, 'XX is not a National Grid square');
assert.equal(C.squareOrigin('WA'), null, 'WA is not a National Grid square');
assert.equal(C.squareOrigin('I'), null, 'single letter has no square');
assert.equal(C.lettersFor(-1, 0), null, 'negative easting has no square');

// ---- Forward conversions at every offered precision, with truncation and zero padding.
const FORWARD = [
  [51.4779, -0.0015, '5', 'TQ 38882 77331'],
  [51.4779, -0.0015, '4', 'TQ 3888 7733'],
  [51.4779, -0.0015, '3', 'TQ 388 773'],
  [51.4779, -0.0015, '2', 'TQ 38 77'],
  [51.4779, -0.0015, '0', 'TQ'],
  [51.5074, -0.1278, '3', 'TQ 300 803'],
  [55.9533, -3.1883, '4', 'NT 2589 7400'],
  [50.2632, -5.0510, '2', 'SW 82 44'],
  [60.1545, -1.1494, '5', 'HU 47323 41416'],
  [53.4808, -2.2426, '0', 'SJ'],
  [49.95, -7.5, '5', 'SV 05611 20048']
];
for (const [lat, lon, digits, expected] of FORWARD) {
  const result = C.toGrid(lat, lon, digits);
  assert.equal(result.gridRef, expected, `${lat},${lon} at ${digits} figures`);
  assert.equal(result.digits, Number(digits), `${lat},${lon}: digit count`);
  const figures = expected.split(' ');
  if (Number(digits)) {
    assert.equal(figures[1].length, Number(digits), `${expected}: easting figures`);
    assert.equal(figures[2].length, Number(digits), `${expected}: northing figures`);
  } else {
    assert.equal(figures.length, 1, `${expected}: letters only`);
  }
  assert.equal(result.precision, C.PRECISION_TEXT[Number(digits)], `${expected}: precision label`);
  assert.equal(result.cell, C.PRECISION[Number(digits)], `${expected}: cell size`);
  assert.ok(result.easting >= 0 && result.northing >= 0, `${expected}: positive ordinates`);
  assert.equal(C.lettersFor(result.easting, result.northing), result.letters, `${expected}: square`);
}

// Truncation, not rounding: a cell never reports the next cell up.
{
  const result = C.toGrid(51.4779, -0.0015, '3');
  assert.equal(result.gridRef, 'TQ 388 773', 'greenwich at 100 m');
  assert.ok(result.eastWithin < 38900 && result.eastWithin >= 38800, 'easting truncates into its 100 m cell');
  const coarse = C.toGrid(51.4779, -0.0015, '2');
  assert.equal(coarse.gridRef, 'TQ 38 77', 'greenwich at 1 km');
}

// ---- Reverse conversions, and the round trip back to the same cell.
const REVERSE = [
  ['TG 51409 13177', 52.657976586, 1.716038478],
  ['TQ 388 773', 51.477637905, -0.002704619],
  ['NT 257 728', 55.942479336, -3.191126199],
  ['SX 40 60', 50.418015400, -4.253530100],
  ['HU 4 7', 60.411898319, -1.275654808],
  ['SS 500 300', 51.049707200, -4.141382600]
];
for (const [ref, lat, lon] of REVERSE) {
  const result = C.fromGrid(ref);
  near(result.lat, lat, 2e-6, `${ref}: WGS84 latitude`);
  near(result.lon, lon, 2e-6, `${ref}: WGS84 longitude`);
  assert.ok(result.osgbLat > 49 && result.osgbLat < 62, `${ref}: OSGB36 latitude in Britain`);
  const back = C.toGrid(result.lat, result.lon, String(result.digits));
  assert.equal(back.gridRef, result.gridRef, `${ref}: round trip holds the cell`);
}

// Case and spacing tolerance, and a bare 100 km square.
assert.equal(C.fromGrid('tg5140913177').gridRef, 'TG 51409 13177', 'lower case and no spaces');
assert.equal(C.fromGrid('  TG   51409   13177 ').gridRef, 'TG 51409 13177', 'extra spacing');
assert.equal(C.fromGrid('TG').gridRef, 'TG', 'letters only is the whole 100 km square');
assert.equal(C.fromGrid('TG').digits, 0, 'letters only has no figures');
assert.equal(C.toGrid(51.4779, -0.0015, '5').gridRef.split(' ').length, 3, 'figures come in two groups');

// ---- Refusals name what is wrong.
const refuses = (fn, message, label) => assert.throws(fn, (error) => {
  assert.equal(error.message, message, label);
  return true;
}, label);

refuses(() => C.toGrid('', -0.0015, '5'), 'Enter a latitude in decimal degrees.', 'blank latitude');
refuses(() => C.toGrid('north', -0.0015, '5'), 'Enter a latitude in decimal degrees.', 'word latitude');
refuses(() => C.toGrid('95', -0.0015, '5'), 'Latitude must be between -90 and 90 degrees.', 'latitude range');
refuses(() => C.toGrid(51.4779, '', '5'), 'Enter a longitude in decimal degrees.', 'blank longitude');
refuses(() => C.toGrid(51.4779, '200', '5'), 'Longitude must be between -180 and 180 degrees.', 'longitude range');
refuses(() => C.toGrid(51.4779, -0.0015, '7'), 'Choose a grid reference precision from the list.', 'bad precision');
refuses(() => C.toGrid(0, 0, '5'), 'That position is outside the National Grid, which covers Great Britain.', 'null island');
refuses(() => C.toGrid(40.7128, -74.006, '5'), 'That position is outside the National Grid, which covers Great Britain.', 'new york');
refuses(() => C.toGrid(61.5, -8, '5'), 'That position is outside the National Grid, which covers Great Britain.', 'faroe');
refuses(() => C.fromGrid(''), 'Enter a grid reference such as TG 51409 13177.', 'blank reference');
refuses(() => C.fromGrid('51409'), 'A grid reference is two letters followed by figures, such as TG 51409 13177.', 'figures first');
refuses(() => C.fromGrid('TI 51409 13177'), 'Grid squares leave out the letter I, so no square contains it.', 'letter I');
refuses(() => C.fromGrid('TG 5140 1317 7'),
  'Put the same number of figures in the easting and the northing, such as TG 51409 13177.', 'odd figures');
refuses(() => C.fromGrid('TG 514091 131770'),
  'Use at most five figures each for the easting and the northing.', 'six figures');
refuses(() => C.fromGrid('XX 000 000'), 'That two-letter square is not part of the National Grid.', 'unknown square');
refuses(() => C.fromGrid('WA 1 1'), 'That two-letter square is not part of the National Grid.', 'square below the grid');

// ---- The copyable summary is clean and names both forms.
for (const text of ['TG 51409 13177', 'TQ 388 773', 'HU 4 7']) {
  const summary = C.copyText(C.fromGrid(text));
  assert.ok(!/undefined|NaN|null/.test(summary), `${text}: clean summary`);
  assert.ok(summary.includes(C.fromGrid(text).gridRef), `${text}: summary names it`);
}
for (const [lat, lon, digits] of FORWARD) {
  const summary = C.copyText(C.toGrid(lat, lon, digits));
  assert.ok(!/undefined|NaN|null/.test(summary), `${lat},${lon}: clean summary`);
  assert.equal(summary.indexOf(C.toGrid(lat, lon, digits).gridRef), 0, `${lat},${lon}: summary leads with the reference`);
}

// ---- Catalog record and every case in it must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2221, 'public tools');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'OS National Grid Reference Converter');
assert.equal(record.category, 'Geography');
assert.equal(record.subcategory, 'Coordinates');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(Array.isArray(record.sources) && record.sources.length >= 2, 'sources present');
assert.ok(record.sources.some((source) => /ordnancesurvey\.co\.uk/.test(source.url || '')), 'the OS guide is cited with its URL');
assert.ok(typeof record.method === 'string' && record.method.length > 500, 'method documented');
assert.ok(Array.isArray(record.aliases) && record.aliases.length >= 6, 'aliases present');
assert.ok(Array.isArray(record.tags) && record.tags.length >= 6, 'tags present');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags unique');
assert.ok(record.description.length > 80, 'description present');
assert.ok(record.testCases.length >= 9, `expected at least 9 cases, found ${record.testCases.length}`);
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug unique');
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.ok(!record.aliases.map((alias) => alias.toLowerCase()).includes(other.name.toLowerCase()),
    `alias collides with ${other.slug}`);
}

for (const testCase of record.testCases) {
  const label = testCase.name;
  const run = () => (testCase.input.ref !== undefined
    ? C.fromGrid(testCase.input.ref)
    : C.toGrid(testCase.input.lat, testCase.input.lon, testCase.input.digits));
  if (testCase.expected.error) {
    assert.throws(run, (error) => {
      assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
      return true;
    }, `${label}: expected a refusal`);
    continue;
  }
  const result = run();
  if (testCase.expected.gridRef !== undefined) assert.equal(result.gridRef, testCase.expected.gridRef, `${label}: reference`);
  if (testCase.expected.letters !== undefined) assert.equal(result.letters, testCase.expected.letters, `${label}: square`);
  if (testCase.expected.digits !== undefined) assert.equal(result.digits, testCase.expected.digits, `${label}: digits`);
  if (testCase.expected.lat !== undefined) near(result.lat, testCase.expected.lat, 2e-6, `${label}: latitude`);
  if (testCase.expected.lon !== undefined) near(result.lon, testCase.expected.lon, 2e-6, `${label}: longitude`);
}

// ---- Page contract: an input, an action, a live result, no network or storage.
assert.match(html, /<label class="f" for="in-lat">/, 'latitude label');
assert.match(html, /<label class="f" for="in-lon">/, 'longitude label');
assert.match(html, /<label class="f" for="in-ref">/, 'grid reference label');
assert.match(html, /<button type="submit">Convert<\/button>/, 'submit button');
assert.match(html, /id="out" aria-live="polite"/, 'live result region');
assert.match(html, /<div id="site-header"><\/div>/, 'shared header slot');
assert.match(html, /\/assets\/app\.js/, 'shared app script');
assert.match(html, /type="radio" name="mode" value="latlon"/, 'mode toggle present');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/onclick=|onchange=|oninput=/.test(html), 'no inline handlers');
assert.ok(!/https?:\/\//.test(html), 'no third-party requests in the page');
