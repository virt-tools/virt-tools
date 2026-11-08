/* Regression checks for the map fit-bounds zoom calculator: its projection and
   fit arithmetic, catalogue cases and the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'map-fit-bounds-zoom-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* map-fit-bounds-zoom-core:start */');
const end = html.indexOf('/* map-fit-bounds-zoom-core:end */');
assert.ok(start > -1 && end > start, 'fit-bounds core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MapFitBoundsCore;', sandbox);
const C = sandbox.module.exports;

const closeTo = (actual, expected, label, epsilon) => assert.ok(
  Math.abs(actual - expected) < (epsilon === undefined ? 1e-9 : epsilon),
  label + ': ' + actual + ' vs ' + expected);

const base = { north: '51.55', south: '51.45', west: '-0.20', east: '0', width: '800', height: '600', tile: '256' };
const run = (input) => C.analyze(input);

function failure(input) {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
}

// Independent transcription of the documented method, using asinh for the
// Mercator ordinate instead of the log(tan + sec) form the page uses.
const TILES = { '256': 256, '512': 512 };
const MAX_LAT = 85.0511287798066;
const EARTH = 40075016.68557849;

function oracle(input) {
  const num = (value) => Number(String(value).trim().replace(',', '.'));
  const north = Math.min(MAX_LAT, Math.max(-MAX_LAT, num(input.north)));
  const south = Math.min(MAX_LAT, Math.max(-MAX_LAT, num(input.south)));
  const west = num(input.west);
  const east = num(input.east);
  const width = Number(String(input.width).trim());
  const height = Number(String(input.height).trim());
  const tile = TILES[String(input.tile).trim()];
  const yOf = (lat) => 0.5 - Math.asinh(Math.tan(lat * Math.PI / 180)) / (2 * Math.PI);
  const latOf = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;

  const dx = (east < west ? east + 360 - west : east - west) / 360;
  const yNorth = yOf(north);
  const ySouth = yOf(south);
  const dy = ySouth - yNorth;
  const fit = Math.min(Math.log2(width / (dx * tile)), Math.log2(height / (dy * tile)));
  let zoom = Math.floor(fit + 1e-9);
  const cappedHigh = zoom > 22;
  const cappedLow = zoom < 0;
  if (cappedHigh) zoom = 22;
  if (cappedLow) zoom = 0;
  const world = tile * 2 ** zoom;
  let cx = (west + 180) / 360 + dx / 2;
  cx -= Math.floor(cx);
  const centreLat = latOf(yNorth + dy / 2);
  const mpp = EARTH * Math.cos(centreLat * Math.PI / 180) / world;
  const n = 2 ** zoom;
  const columnStart = Math.floor((west + 180) / 360 * n + 1e-9);
  const columns = Math.min(n, Math.max(1,
    Math.floor((west + 180) / 360 * n + dx * n - 1e-9) - columnStart + 1));
  const rowStart = Math.floor(yNorth * n + 1e-9);
  const rows = Math.min(n, Math.max(1, Math.floor(ySouth * n - 1e-9) - rowStart + 1));
  return {
    zoom,
    fitZoom: fit,
    clamped: north !== num(input.north) || south !== num(input.south),
    crosses: east < west,
    cappedHigh,
    cappedLow,
    exact: !cappedHigh && !cappedLow && Math.abs(fit - zoom) < 1e-9,
    dx,
    dy,
    spanX: dx * world,
    spanY: dy * world,
    centreLat,
    centreLon: cx * 360 - 180,
    metresPerPixel: mpp,
    scaleDenominator: mpp * 96 / 0.0254,
    columnStart: columnStart % n,
    columns,
    rowStart,
    rows,
    tiles: columns * rows,
  };
}

// Documented surface.
assert.equal(C.MAX_LAT, MAX_LAT);
assert.equal(C.EARTH_CIRCUMFERENCE, EARTH);
assert.deepEqual(Object.keys(C.TILE_SIZES).sort(), ['256', '512']);
assert.deepEqual([...C.LIMITS.latitude], [-90, 90]);
assert.deepEqual([...C.LIMITS.longitude], [-180, 180]);
assert.deepEqual([...C.LIMITS.width], [1, 10000]);
assert.deepEqual([...C.LIMITS.height], [1, 10000]);
assert.equal(C.LIMITS.maxZoom, 22);
assert.match(C.MESSAGES.meridian, /antimeridian/);
assert.match(C.MESSAGES.clamped, /85\.0511/);
assert.match(C.MESSAGES.cappedHigh, /zoom 22/);
assert.match(C.MESSAGES.cappedLow, /zoom 0/);
assert.match(C.MESSAGES.exact, /exactly/);
assert.match(C.MESSAGES.rounded, /rounded down/);

// Mercator ordinate and its inverse round-trip, including the latitude limit.
closeTo(C.mercatorY(0), 0.5, 'equator ordinate');
closeTo(C.mercatorY(MAX_LAT), 0, 'north limit ordinate');
closeTo(C.mercatorY(-MAX_LAT), 1, 'south limit ordinate');
closeTo(C.mercatorY(90), 0, 'north pole clamps');
for (const lat of [-84, -45, -0.5, 0, 12.25, 51.5, 78.9]) {
  closeTo(C.latitudeFromY(C.mercatorY(lat)), lat, 'latitude round trip ' + lat);
}

// Golden: the default London box in an 800 by 600 view.
const london = run(base);
assert.equal(london.zoom, 12);
closeTo(london.fitZoom, 12.358778783296216, 'London exact fit', 1e-9);
closeTo(london.spanX, 582.5422222222222, 'London screen width', 1e-9);
closeTo(london.spanY, 467.8946450356161, 'London screen height', 1e-9);
closeTo(london.centreLat, 51.500027427261806, 'London centre latitude', 1e-9);
closeTo(london.centreLon, -0.1, 'London centre longitude', 1e-9);
closeTo(london.metresPerPixel, 23.791570126444313, 'London resolution', 1e-9);
closeTo(london.scaleDenominator, 89920.89496608874, 'London scale denominator', 1e-6);
assert.equal(london.columns, 3);
assert.equal(london.rows, 3);
assert.equal(london.tiles, 9);
assert.equal(london.clamped, false);
assert.equal(london.crosses, false);
assert.equal(london.exact, false);

// The same box with 512 px tiles fits one zoom lower at the same screen size.
const retina = run({ ...base, tile: '512' });
assert.equal(retina.zoom, 11);
closeTo(retina.spanX, london.spanX, 'retina keeps the screen width');
closeTo(retina.spanY, london.spanY, 'retina keeps the screen height');
closeTo(retina.metresPerPixel, london.metresPerPixel, 'retina keeps the resolution');

// The whole world in a 1024 by 768 view is height-limited to zoom 1.
const world = run({ north: '85.0511287798066', south: '-85.0511287798066', west: '-180', east: '180', width: '1024', height: '768', tile: '256' });
assert.equal(world.zoom, 1);
closeTo(world.spanX, 512, 'world spans half the view at zoom 1');
closeTo(world.spanY, 512, 'world spans 512 px tall');
assert.equal(world.crosses, false);
assert.equal(world.clamped, false);

// A 45 degree wide box at exactly 256 px is an exact fit at zoom 3.
const exact = run({ north: '10', south: '0', west: '-45', east: '0', width: '256', height: '256', tile: '256' });
assert.equal(exact.exact, true);
assert.equal(exact.zoom, 3);
closeTo(exact.fitZoom, 3, 'exact fit zoom');
closeTo(exact.spanX, 256, 'exact fit fills the width');
assert.equal(exact.columns, 1);
assert.equal(exact.rows, 1);

// A box across the antimeridian is measured eastward through 180 degrees.
const meridian = run({ north: '10', south: '0', west: '179.5', east: '-179.5', width: '800', height: '600', tile: '256' });
assert.equal(meridian.crosses, true);
closeTo(meridian.dx, 1 / 360, 'antimeridian width');
closeTo(Math.abs(meridian.centreLon), 180, 'antimeridian centre', 1e-9);
assert.equal(meridian.columns, 2, 'antimeridian box touches two columns');
assert.deepEqual([meridian.columnStart, (meridian.columnStart + meridian.columns - 1) % 64], [63, 0]);

// Polar boxes are clamped to the projection limit.
const arctic = run({ north: '89', south: '80', west: '0', east: '10', width: '600', height: '400', tile: '256' });
assert.equal(arctic.clamped, true);
closeTo(arctic.north, MAX_LAT, 'clamped north');
closeTo(arctic.centreLat, 82.5, 'clamped centre inside the box', 1);

// A world wider than the view cannot go below zoom 0.
const tooWide = run({ north: '85.0511287798066', south: '-85.0511287798066', west: '-180', east: '180', width: '128', height: '128', tile: '256' });
assert.equal(tooWide.zoom, 0);
assert.equal(tooWide.cappedLow, true);
assert.equal(tooWide.exact, false);
assert.ok(tooWide.spanX > 128, 'zoom 0 overflows a 128 px view');

// A tiny box cannot go beyond the usual maximum zoom.
const tiny = run({ north: '51.5001', south: '51.5', west: '0', east: '0.0001', width: '8000', height: '8000', tile: '256' });
assert.equal(tiny.zoom, 22);
assert.equal(tiny.cappedHigh, true);
assert.ok(tiny.fitZoom > 22, 'the exact fit is beyond the maximum');

// Decimal commas are accepted everywhere numbers are.
const comma = run({ ...base, north: '51,55', south: '51,45', west: '-0,20' });
assert.equal(comma.zoom, london.zoom);
closeTo(comma.centreLat, london.centreLat, 'comma centre latitude');
closeTo(comma.centreLon, london.centreLon, 'comma centre longitude');

// Grid of boxes, viewports and tile sizes against the independent oracle.
const boxes = [
  ['51.55', '51.45', '-0.20', '0'],
  ['1', '0', '0', '1'],
  ['60', '20', '10', '10.2'],
  ['40.2', '40', '-100', '-60'],
  ['-33.7', '-34.1', '151', '151.4'],
  ['85.0511287798066', '84', '-10', '10'],
  ['10', '0', '179.5', '-179.5'],
  ['-84', '-85.0511287798066', '-179', '-178'],
];
const viewports = [['320', '240'], ['800', '600'], ['1024', '768'], ['1440', '900'], ['375', '812'], ['256', '256']];
const fields = ['zoom', 'fitZoom', 'clamped', 'crosses', 'cappedHigh', 'cappedLow', 'exact', 'dx', 'dy',
  'spanX', 'spanY', 'centreLat', 'centreLon', 'metresPerPixel', 'scaleDenominator', 'columnStart',
  'columns', 'rows', 'tiles'];
let checked = 0;
for (const box of boxes) {
  for (const [width, height] of viewports) {
    for (const tile of Object.keys(TILES)) {
      const input = { north: box[0], south: box[1], west: box[2], east: box[3], width, height, tile };
      const result = run(input);
      const expected = oracle(input);
      for (const field of fields) {
        if (typeof expected[field] === 'boolean') assert.equal(result[field], expected[field], field + ' ' + JSON.stringify(input));
        else assert.ok(Math.abs(result[field] - expected[field]) <= 1e-9 + 1e-12 * Math.abs(expected[field]),
          field + ' ' + JSON.stringify(input) + ': ' + result[field] + ' vs ' + expected[field]);
      }
      assert.ok(result.zoom >= 0 && result.zoom <= 22, 'zoom inside the allowed range');
      assert.ok(result.columns >= 1 && result.columns <= 2 ** result.zoom, 'columns inside the tile pyramid');
      assert.ok(result.rows >= 1 && result.rows <= 2 ** result.zoom, 'rows inside the tile pyramid');
      assert.equal(result.tiles, result.columns * result.rows, 'tile product');
      assert.ok(result.spanX <= result.width + 1e-9 || result.cappedLow, 'width fits the viewport');
      assert.ok(result.spanY <= result.height + 1e-9 || result.cappedLow, 'height fits the viewport');
      assert.ok(result.centreLat >= result.south - 1e-9 && result.centreLat <= result.north + 1e-9,
        'centre latitude inside the box');
      if (result.zoom < 22) assert.ok(result.spanX * 2 > result.width - 1e-9 || result.spanY * 2 > result.height - 1e-9,
        'one more zoom would not fit');
      checked += 1;
    }
  }
}
assert.ok(checked >= 90, 'expected at least ninety grid rows');

// A taller viewport never lowers the fit zoom for the same box.
for (const height of ['300', '600', '1200', '2400']) {
  const small = run({ ...base, height: '300' });
  const taller = run({ ...base, height });
  assert.ok(taller.zoom >= small.zoom, 'taller viewport never zooms out');
}
// Doubling both viewport dimensions adds exactly one zoom while it fits.
assert.equal(run({ ...base, width: '1600', height: '1200' }).zoom, london.zoom + 1);

// Refusals name the field in the order it appears on the page.
assert.equal(failure({ ...base, north: '' }), 'Enter the north latitude.');
assert.equal(failure({ ...base, north: '51.5N' }), 'The north latitude must be a number.');
assert.equal(failure({ ...base, north: '91' }), 'The north latitude must be between -90 and 90 degrees.');
assert.equal(failure({ ...base, south: '-91' }), 'The south latitude must be between -90 and 90 degrees.');
assert.equal(failure({ ...base, north: '51.5', south: '51.5' }),
  'The north latitude must be greater than the south latitude.');
assert.equal(failure({ ...base, south: '52' }), 'The north latitude must be greater than the south latitude.');
assert.equal(failure({ ...base, west: '0', east: '0' }),
  'The west and east longitude must differ: a box with no width has no fit zoom.');
assert.equal(failure({ ...base, west: '-181' }), 'The west longitude must be between -180 and 180 degrees.');
assert.equal(failure({ ...base, east: '181' }), 'The east longitude must be between -180 and 180 degrees.');
assert.equal(failure({ ...base, width: '' }), 'Enter the viewport width.');
assert.equal(failure({ ...base, width: '12.5' }), 'The viewport width must be a whole number.');
assert.equal(failure({ ...base, width: '0' }), 'The viewport width must be between 1 and 10000 pixels.');
assert.equal(failure({ ...base, width: '10001' }), 'The viewport width must be between 1 and 10000 pixels.');
assert.equal(failure({ ...base, height: '-5' }), 'The viewport height must be a whole number.');
assert.equal(failure({ ...base, height: '10001' }), 'The viewport height must be between 1 and 10000 pixels.');
assert.equal(failure({ ...base, tile: '' }), 'Choose a tile size from the list.');
assert.equal(failure({ ...base, tile: '128' }), 'Choose a tile size from the list.');
assert.equal(failure({ ...base, north: '86', south: '85.5' }),
  'The box lies beyond the Web Mercator latitude limit, so it has no height to fit.');

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Geography');
assert.equal(entry.subcategory, 'Coordinates');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.deepEqual([...new Set(entry.tags)].sort(), entry.tags.slice().sort(), 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 400, 'method must describe the arithmetic');
assert.ok(entry.testCases.length >= 24, 'expected at least twenty-four catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = run(testCase.input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      if (typeof value === 'string') assert.equal(result[key], value, testCase.name + ' ' + key);
      else if (typeof value === 'boolean') assert.equal(result[key], value, testCase.name + ' ' + key);
      else assert.ok(Math.abs(result[key] - value) <= 1e-9 + 1e-12 * Math.abs(value),
        testCase.name + ' ' + key + ': ' + result[key] + ' vs ' + value);
    }
  }
}

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="fit-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('aria-describedby'), 'fields must reference their help text');
for (const id of ['north', 'south', 'west', 'east', 'width', 'height', 'tile']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label ' + id + ' missing');
  assert.ok(html.includes('aria-describedby="' + id + '-help"'), 'help reference ' + id + ' missing');
}
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet missing');
assert.ok(html.includes('type="submit"'), 'submit button missing');
assert.ok(html.includes('id="reset"'), 'reset button missing');

console.log('map fit-bounds zoom calculator: ' + entry.testCases.length + ' catalog cases, '
  + checked + ' grid rows and invariants passed');
