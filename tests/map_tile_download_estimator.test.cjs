/* Regression checks for the map tile download core, its catalog cases and the
   page's offline, no-storage contract. The oracle here counts tiles by testing
   each candidate tile's geographic extent against the box, which is a different
   route to the answer than the core's fractional edge arithmetic. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'map-tile-download-estimator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* map-tile-download-core:start */');
const end = html.indexOf('/* map-tile-download-core:end */');
assert.ok(start > -1 && end > start, 'map tile download core markers missing');
const core = html.slice(start, end + '/* map-tile-download-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MapTileDownloadCore;', sandbox);
const C = sandbox.module.exports;

const run = (input) => C.calculate(input);
const plain = (value) => JSON.parse(JSON.stringify(value));
function failure(input) {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
}

// Geometric oracle: a tile counts when its extent overlaps the box interior,
// which is why a box that stops exactly on a tile boundary leaves the next tile
// out.
function tileBounds(x, y, z) {
  const n = 2 ** z;
  return {
    west: (x / n) * 360 - 180,
    east: ((x + 1) / n) * 360 - 180,
    north: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
    south: (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI,
  };
}
function overlaps(tile, box) {
  return tile.east > box.west && tile.west < box.east && tile.north > box.south && tile.south < box.north;
}
function bruteRange(box, z) {
  const n = 2 ** z;
  const xw = Math.floor(((box.west + 180) / 360) * n) - 1;
  const xe = Math.ceil(((box.east + 180) / 360) * n) + 1;
  const yn = Math.floor(((1 - Math.asinh(Math.tan((box.north * Math.PI) / 180)) / Math.PI) / 2) * n) - 1;
  const ys = Math.ceil(((1 - Math.asinh(Math.tan((box.south * Math.PI) / 180)) / Math.PI) / 2) * n) + 1;
  let total = 0;
  for (let x = Math.max(0, xw); x <= Math.min(n - 1, xe); x += 1) {
    for (let y = Math.max(0, yn); y <= Math.min(n - 1, ys); y += 1) {
      if (overlaps(tileBounds(x, y, z), box)) total += 1;
    }
  }
  return total;
}
function brute(box, z) {
  if (box.west < box.east) return bruteRange({ ...box }, z);
  return bruteRange({ ...box, east: 180 }, z) + bruteRange({ ...box, west: -180 }, z);
}
function oracle({ west, south, east, north }, lo, hi, kb) {
  const box = {
    west: Number(String(west).replace(',', '.')),
    south: Number(String(south).replace(',', '.')),
    east: Number(String(east).replace(',', '.')),
    north: Number(String(north).replace(',', '.')),
  };
  const rows = [];
  let totalTiles = 0;
  for (let z = lo; z <= hi; z += 1) {
    const tiles = brute(box, z);
    rows.push({ zoom: z, tiles, bytes: Math.round(tiles * kb * 1024) });
    totalTiles += tiles;
  }
  return { rows, totalTiles };
}

// Documented surface and constants.
assert.equal(C.MAX_ZOOM, 22);
assert.equal(C.MAX_LAT, 85.05112878);
assert.equal(C.MAX_TILE_KB, 1024);
assert.deepEqual({ ...C.DEFAULTS }, {
  west: '-3.5', south: '51.4', east: '0.2', north: '51.7', minZoom: '10', maxZoom: '14', tileKb: '25',
});
assert.equal(C.COORD_MISSING, 'Enter the west, south, east and north edges of the box in degrees.');
assert.equal(C.COORD_ERROR, 'Each edge must be a decimal number of degrees, with no units or exponent notation.');
assert.equal(C.LON_ERROR, 'Longitudes must lie between -180 and 180 degrees.');
assert.equal(C.LAT_ERROR,
  'Latitudes must lie between -85.05112878 and 85.05112878 degrees, the Web Mercator limit.');
assert.equal(C.ORDER_ERROR, 'The south edge must be below the north edge.');
assert.equal(C.FLAT_ERROR, 'The west and east edges must differ; a box with no width covers no columns.');
assert.equal(C.ZOOM_ERROR, 'Zoom levels must be whole numbers from 0 to 22.');
assert.equal(C.ZOOM_ORDER, 'The lowest zoom must not be higher than the highest zoom.');
assert.equal(C.SIZE_ERROR,
  'Average tile size must be a number of kilobytes greater than 0 and at most 1024.');

// Golden: the default box over zooms 10 to 14 at 25 KB.
const base = { west: '-3.5', south: '51.4', east: '0.2', north: '51.7', minZoom: '10', maxZoom: '14', tileKb: '25' };
const gold = run({});
assert.deepEqual(plain(gold.rows), [
  { zoom: 10, columns: 11, rows: 2, tiles: 22, bytes: 563200 },
  { zoom: 11, columns: 22, rows: 3, tiles: 66, bytes: 1689600 },
  { zoom: 12, columns: 43, rows: 6, tiles: 258, bytes: 6604800 },
  { zoom: 13, columns: 85, rows: 12, tiles: 1020, bytes: 26112000 },
  { zoom: 14, columns: 170, rows: 23, tiles: 3910, bytes: 100096000 },
]);
assert.equal(gold.totalTiles, 5276);
assert.equal(gold.totalBytes, 135065600);
assert.equal(gold.maxZoomTiles, 3910);
assert.equal(gold.worldTilesAtMax, 268435456);
assert.equal(gold.coveragePercent, 0.001457);
assert.equal(gold.wraps, false);
assert.equal(gold.west, -3.5);
assert.equal(gold.south, 51.4);
assert.equal(gold.east, 0.2);
assert.equal(gold.north, 51.7);
assert.equal(gold.tileKb, 25);

// A box crossing the antimeridian is counted as two longitude ranges.
const fiji = run({ west: '178', south: '-18', east: '-179', north: '-16', minZoom: '8', maxZoom: '10', tileKb: '25' });
assert.equal(fiji.wraps, true);
assert.deepEqual(plain(fiji.rows), [
  { zoom: 8, columns: 3, rows: 3, tiles: 9, bytes: 230400 },
  { zoom: 9, columns: 5, rows: 4, tiles: 20, bytes: 512000 },
  { zoom: 10, columns: 9, rows: 7, tiles: 63, bytes: 1612800 },
]);
assert.equal(fiji.totalTiles, 92);
assert.equal(fiji.totalBytes, 2355200);
assert.equal(fiji.coveragePercent, 0.006008);

// The whole world quadruples with each zoom level.
const world = run({ west: '-180', south: '-85.05112878', east: '180', north: '85.05112878', minZoom: '0', maxZoom: '2', tileKb: '25' });
assert.deepEqual(plain(world.rows.map((row) => row.tiles)), [1, 4, 16]);
assert.equal(world.totalTiles, 21);
assert.equal(world.totalBytes, 537600);
assert.equal(world.coveragePercent, 100);

// A single zoom level, and a box that ends exactly on tile boundaries.
const single = run({ west: '10', south: '10', east: '11', north: '11', minZoom: '0', maxZoom: '0', tileKb: '40' });
assert.equal(single.rows.length, 1);
assert.equal(single.totalTiles, 1);
assert.equal(single.totalBytes, 40960);
assert.equal(single.coveragePercent, 100);
const half = run({ west: '-90', south: '0', east: '90', north: '85.05112878', minZoom: '2', maxZoom: '2', tileKb: '25' });
assert.deepEqual(plain(half.rows), [{ zoom: 2, columns: 2, rows: 2, tiles: 4, bytes: 102400 }]);
assert.equal(half.coveragePercent, 25);

// High zoom counts stay exact and the world share can round to zero.
const z22 = run({ west: '0', south: '0', east: '1', north: '1', minZoom: '22', maxZoom: '22', tileKb: '25' });
assert.equal(z22.rows[0].columns, 11651);
assert.equal(z22.rows[0].rows, 11652);
assert.equal(z22.totalTiles, 135757452);
assert.equal(z22.totalBytes, 3475390771200);
assert.equal(z22.coveragePercent, 0.000772);
const tiny = run({ west: '0', south: '0', east: '0.0001', north: '0.0001', minZoom: '22', maxZoom: '22', tileKb: '25' });
assert.equal(tiny.totalTiles, 4);
assert.equal(tiny.coveragePercent, 0);

// A box smaller than one tile still counts that tile.
const inside = run({ west: '0.5', south: '0.5', east: '0.6', north: '0.6', minZoom: '10', maxZoom: '10', tileKb: '25' });
assert.equal(inside.totalTiles, 1);

// Decimal commas and signs behave like points, and the size adds up per level.
assert.deepEqual(plain(run({ ...base, west: '-3,5', south: '51,4', east: '0,2', north: '51,7', tileKb: '12,5' }).rows),
  plain(run({ ...base, tileKb: '12.5' }).rows));
assert.equal(run({ ...base, tileKb: '0.5' }).totalBytes, Math.round(5276 * 0.5 * 1024));
for (const result of [gold, fiji, world, z22]) {
  assert.equal(result.totalBytes, result.rows.reduce((sum, row) => sum + row.bytes, 0));
  assert.equal(result.totalTiles, result.rows.reduce((sum, row) => sum + row.tiles, 0));
  result.rows.forEach((row, index) => {
    assert.equal(row.zoom, result.minZoom + index);
    assert.ok(row.columns >= 1 && row.rows >= 1);
    assert.equal(row.tiles, row.columns * row.rows);
    assert.equal(row.bytes, Math.round(row.tiles * result.tileKb * 1024));
  });
}

// The core's counts match tiles walked geometrically for a grid of boxes.
const boxes = [
  [-3.5, 51.4, 0.2, 51.7],
  [0.0, 0.0, 1.0, 1.0],
  [178.0, -18.0, -179.0, -16.0],
  [-180.0, -85.05112878, 180.0, 85.05112878],
  [-74.05, 40.6, -73.7, 40.9],
  [139.5, 35.5, 140.0, 36.0],
  [10.0, 10.0, 10.01, 10.01],
  [-0.5, -0.5, 0.5, 0.5],
];
let gridRows = 0;
for (const [west, south, east, north] of boxes) {
  for (let hi = 0; hi <= 11; hi += 1) {
    const input = {
      west: String(west), south: String(south), east: String(east), north: String(north),
      minZoom: '0', maxZoom: String(hi), tileKb: '25',
    };
    const result = run(input);
    const expected = oracle(input, 0, hi, 25);
    assert.deepEqual(plain(result.rows.map((row) => row.zoom)), expected.rows.map((row) => row.zoom));
    assert.deepEqual(plain(result.rows.map((row) => row.tiles)), expected.rows.map((row) => row.tiles),
      'geo count ' + JSON.stringify([west, south, east, north]) + ' z' + hi);
    assert.deepEqual(plain(result.rows.map((row) => row.bytes)), expected.rows.map((row) => row.bytes));
    assert.equal(result.totalTiles, expected.totalTiles);
    gridRows += result.rows.length;
  }
}

// Every refusal names the rule that was broken.
assert.equal(failure({ ...base, west: '' }), C.COORD_MISSING);
assert.equal(failure({ ...base, north: '   ' }), C.COORD_MISSING);
for (const bad of ['0.2E', '12 degrees', '9e1', '--3.5', '1..2', 'north']) {
  assert.equal(failure({ ...base, east: bad }), C.COORD_ERROR, bad);
}
for (const bad of ['185', '-180.5']) {
  assert.equal(failure({ ...base, west: bad }), C.LON_ERROR, bad);
}
for (const bad of ['85.06', '-86']) {
  assert.equal(failure({ ...base, north: bad }), C.LAT_ERROR, bad);
}
assert.equal(failure({ ...base, south: '51.7' }), C.ORDER_ERROR);
assert.equal(failure({ ...base, south: '60' }), C.ORDER_ERROR);
assert.equal(failure({ ...base, east: '-3.5' }), C.FLAT_ERROR);
for (const bad of ['23', '-1', '10.5', 'ten', '']) {
  assert.equal(failure({ ...base, minZoom: bad }), C.ZOOM_ERROR, bad);
}
assert.equal(failure({ ...base, minZoom: '12', maxZoom: '10' }), C.ZOOM_ORDER);
for (const bad of ['0', '-25', '1024.1', 'two', '', '1e2']) {
  assert.equal(failure({ ...base, tileKb: bad }), C.SIZE_ERROR, bad);
}
assert.equal(run({ ...base, minZoom: '22', maxZoom: '22', west: '0', south: '0', east: '0.001', north: '0.001' }).rows[0].zoom, 22);
assert.equal(run({ ...base, tileKb: '1024' }).tileKb, 1024);
assert.equal(run({ ...base, north: '85.05112878' }).north, 85.05112878);
assert.equal(run({ ...base, west: '-180', east: '180' }).wraps, false);

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(catalog.tools.length, 2269, 'catalog total');
assert.equal(entry.category, 'Geography');
assert.equal(entry.subcategory, 'Planning');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.ok(entry.testCases.length >= 20, 'expected at least twenty catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
let wrapped = 0;
let highZoom = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = run(testCase.input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      if (Array.isArray(value)) {
        assert.deepEqual(JSON.parse(JSON.stringify(result[key])), value, testCase.name + ' ' + key);
      } else if (typeof value === 'number') {
        assert.ok(Math.abs(result[key] - value) < 1e-9, testCase.name + ' ' + key);
      } else {
        assert.equal(result[key], value, testCase.name + ' ' + key);
      }
    }
    if (result.wraps) wrapped += 1;
    if (result.maxZoom === 22) highZoom += 1;
  }
}
assert.ok(wrapped >= 1, 'expected an antimeridian case');
assert.ok(highZoom >= 1, 'expected a zoom 22 case');

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="mtde-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
for (const id of ['in-west', 'in-south', 'in-east', 'in-north', 'in-zoom-min', 'in-zoom-max', 'in-tile-kb']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(new RegExp('for="' + id + '"').test(html), 'label for ' + id + ' missing');
}
assert.ok(html.includes('id="reset"'), 'reset control missing');
assert.ok(html.includes('id="rows"'), 'per-zoom table body missing');
assert.ok(!/<[^>]+\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');

console.log('map tile download estimator: ' + entry.testCases.length + ' catalog cases, '
  + gridRows + ' geometric grid rows and invariants passed');
