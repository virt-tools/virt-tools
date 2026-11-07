/* Regression checks for the Web Mercator map tile coordinate core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/map-tile-coordinate-calculator/index.html'), 'utf8');
const startMarker = '/* map-tile-coordinate-core:start */';
const endMarker = '/* map-tile-coordinate-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'map tile coordinate core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = MapTileCoordinateCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-12) => {
  assert.ok(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)), `${label}: expected ${expected}, got ${actual}`);
};
const london = C.calculate({});
assert.equal(london.zxy, '12/2046/1362');
assert.equal(london.quadkey, '031313131130');
assert.equal(london.mode, 'forward');
near(london.north, 51.50874245880333, 'London north');
near(london.centerLon, -0.1318359375, 'London center longitude');
assert.match(C.summary(london), /Input coordinate: 51\.5074, -0\.1278/);
assert.match(C.summary(london), /XYZ tile \(z\/x\/y\): 12\/2046\/1362/);
assert.match(C.summary(london), /Quadkey: 031313131130/);
const reverseLondon = C.calculate({ mode: 'reverse' });
assert.equal(reverseLondon.zxy, london.zxy);
assert.equal(reverseLondon.quadkey, london.quadkey);
near(reverseLondon.centerLat, 51.481382896100975, 'London reverse center');
assert.match(C.summary(reverseLondon), /Input tile: 12\/2046\/1362/);
assert.equal(C.coordinate(0, -0), '0, 0');
assert.equal(C.quadkey(0, 0, 0), '');
assert.equal(C.quadkey(2, 1, 2), '21');

// Independently project a coordinate grid, including both longitude edges and projection limits.
let referenceCoordinates = 0;
const latitudes = [-C.MAX_LAT, -66.5, -33.8688, 0, 35.6762, 66.5, C.MAX_LAT];
const longitudes = [-180, -90, -0.1278, 0, 90, 180];
for (const zoom of [0, 1, 2, 5, 12, 20, 30]) {
  const n = 2 ** zoom;
  for (const latitude of latitudes) {
    for (const longitude of longitudes) {
      const x = Math.min(n - 1, Math.max(0, Math.floor((longitude + 180) / 360 * n)));
      const radians = latitude * Math.PI / 180;
      const rawY = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * n;
      const y = Math.min(n - 1, Math.max(0, Math.floor(rawY)));
      const actual = C.calculate({ mode: 'forward', latitude, longitude, zoom });
      assert.equal(actual.x, x, `reference x at ${latitude}, ${longitude}, z${zoom}`);
      assert.equal(actual.y, y, `reference y at ${latitude}, ${longitude}, z${zoom}`);
      let key = '';
      for (let bit = zoom - 1; bit >= 0; bit -= 1) {
        key += String((Math.floor(x / 2 ** bit) % 2) + 2 * (Math.floor(y / 2 ** bit) % 2));
      }
      assert.equal(actual.quadkey, key, `reference quadkey at ${latitude}, ${longitude}, z${zoom}`);
      referenceCoordinates += 1;
    }
  }
}
assert.equal(referenceCoordinates, 294);

// Decode tile centers and re-encode them; every result must return to the same tile.
let roundTrips = 0;
for (let zoom = 0; zoom <= 24; zoom += 1) {
  const n = 2 ** zoom;
  const candidates = [...new Set([0, Math.floor((n - 1) / 3), Math.floor((n - 1) / 2), n - 1])];
  for (const x of candidates) {
    for (const y of candidates) {
      const tile = C.calculate({ mode: 'reverse', zoom, x, y });
      assert.equal(tile.zoom, zoom);
      assert.ok(tile.west < tile.east);
      assert.ok(tile.north > tile.south);
      assert.ok(tile.centerLon > tile.west && tile.centerLon < tile.east);
      assert.ok(tile.centerLat < tile.north && tile.centerLat > tile.south);
      const encoded = C.calculate({ mode: 'forward', latitude: tile.centerLat, longitude: tile.centerLon, zoom });
      assert.equal(encoded.x, x, `round-trip x at z${zoom} ${x}/${y}`);
      assert.equal(encoded.y, y, `round-trip y at z${zoom} ${x}/${y}`);
      assert.equal(encoded.quadkey, tile.quadkey);
      roundTrips += 1;
    }
  }
}

for (const latitude of ['', '1e1', '+10', NaN, Infinity, null, true, {}, -85.0511287798067, 85.0511287798067]) {
  assert.throws(() => C.calculate({ latitude }), /Latitude/);
}
for (const longitude of ['', '1e2', '+10', NaN, Infinity, null, false, [], -180.000001, 180.000001]) {
  assert.throws(() => C.calculate({ longitude }), /Longitude/);
}
for (const zoom of ['', '1.5', '1e1', '-1', 31, NaN, Infinity, null, false, []]) {
  assert.throws(() => C.calculate({ zoom }), /Zoom/);
}
for (const x of ['', '1.5', '1e1', '-1', 4096, NaN, Infinity, null, false, []]) {
  assert.throws(() => C.calculate({ mode: 'reverse', zoom: 12, x }), /Tile X/);
}
for (const y of ['', '1.5', '1e1', '-1', 4096, NaN, Infinity, null, false, []]) {
  assert.throws(() => C.calculate({ mode: 'reverse', zoom: 12, y }), /Tile Y/);
}
assert.throws(() => C.calculate({ mode: 'sideways' }), /Choose coordinates to tile or tile to bounds/);

// Replay every canonical catalog case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'map-tile-coordinate-calculator');
assert.equal(records.length, 1, 'catalog must contain exactly one map tile coordinate calculator');
const record = records[0];
assert.equal(record.name, 'Map Tile Coordinate Calculator');
assert.equal(record.category, 'Geography');
assert.equal(record.subcategory, 'Coordinates');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 20, 'catalog carries golden, boundary and validation checks');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.calculate(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') near(result[key], expected, `${testCase.name}: ${key}`);
    else assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
}

console.log(`map-tile-coordinate-calculator: all checks passed (${record.testCases.length} catalog cases, ${referenceCoordinates} reference coordinates and ${roundTrips} tile round-trips)`);
