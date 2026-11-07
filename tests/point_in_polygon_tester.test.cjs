/* Regression checks for the point-in-polygon core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/point-in-polygon-tester/index.html'), 'utf8');
const start = html.indexOf('/* point-in-polygon-core:start */');
const end = html.indexOf('/* point-in-polygon-core:end */');
assert.ok(start > -1 && end > start, 'point-in-polygon core markers missing');
const core = html.slice(start, end + '/* point-in-polygon-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PointInPolygonCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const geojson = (value) => JSON.stringify(value);
const polygon = (rings) => geojson({ type: 'Polygon', coordinates: rings });

const square = polygon([[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]]);
const test = (lat, lon, shape = square) => C.test({ geojson: shape, lat, lon });

// A point in the middle of a one-degree square is inside, one degree of
// latitude from every horizontal edge.
const middle = test('0', '0');
assert.equal(middle.status, 'inside');
assert.equal(middle.polygons, 1);
assert.equal(middle.rings, 1);
assert.equal(middle.vertices, 4);
assert.equal(middle.containedPolygons, 1);
near(middle.nearestDistanceM, 110540, 'distance to the nearest edge');
assert.deepEqual(plain(middle.nearest), { polygon: 1, ring: 0, segment: 1 });
assert.deepEqual(plain(middle.bounds), { minLat: -1, maxLat: 1, minLon: -1, maxLon: 1 });
assert.deepEqual(plain(middle.warnings), []);

// One degree of longitude at the equator is 111,320 m, one degree of
// latitude is 110,540 m, so the four edge distances match those values.
near(test('0', '3').nearestDistanceM, 2 * 111320, 'two degrees of longitude away');
near(test('3', '0').nearestDistanceM, 2 * 110540, 'two degrees of latitude away');
assert.equal(test('0', '3').status, 'outside');
assert.equal(test('3', '0').status, 'outside');

// A point on the square's edge is reported as a boundary, not as inside or
// outside, and its distance is zero.
const edge = test('0', '1');
assert.equal(edge.status, 'boundary');
near(edge.nearestDistanceM, 0, 'edge distance');
assert.equal(test('1', '0').status, 'boundary');
assert.equal(test('-1', '-1').status, 'boundary');

// The boundary tolerance is 1 cm, so a point a few centimetres away is a
// normal inside or outside result rather than an edge.
const justInside = test('0', String(1 - 1e-6));
assert.equal(justInside.status, 'inside');
assert.ok(justInside.nearestDistanceM > 0.1, 'tolerance keeps points off the boundary');
assert.equal(test('0', String(1 + 1e-5)).status, 'outside');

// A hole removes the points it encloses even though the outer ring contains
// them, while points between the rings stay inside.
const holed = polygon([
  [[-2, -2], [2, -2], [2, 2], [-2, 2], [-2, -2]],
  [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]
]);
const inHole = test('0', '0', holed);
assert.equal(inHole.status, 'outside');
assert.equal(inHole.rings, 2);
assert.equal(inHole.vertices, 8);
assert.equal(inHole.containedPolygons, 0);
near(inHole.nearestDistanceM, 110540, 'distance from the hole centre to its edge');
const inRing = test('0', '1.5', holed);
assert.equal(inRing.status, 'inside');
assert.equal(inRing.containedPolygons, 1);
near(inRing.nearestDistanceM, 55660, 'half a degree to the hole edge');

// Rings are unwrapped across the antimeridian, so a polygon at 179 to -179
// longitude contains points on both sides of 180.
const antimeridian = polygon([[[179, -1], [-179, -1], [-179, 1], [179, 1], [179, -1]]]);
assert.equal(test('0', '180', antimeridian).status, 'inside');
assert.equal(test('0', '-179.5', antimeridian).status, 'inside');
assert.equal(test('0', '-180', antimeridian).status, 'inside');
assert.equal(test('0', '179.5', antimeridian).status, 'inside');
assert.equal(test('0', '170', antimeridian).status, 'outside');
near(test('0', '170', antimeridian).nearestDistanceM, 9 * 111320, 'nine degrees west of the ring');
assert.deepEqual(plain(antimeridianBounds(antimeridian)), { minLat: -1, maxLat: 1, minLon: -179, maxLon: 179 });
function antimeridianBounds(shape) {
  return C.test({ geojson: shape, lat: '0', lon: '180' }).bounds;
}

// A MultiPolygon reports the polygon that contains the point and the nearest
// edge across all of its parts.
const multi = geojson({
  type: 'MultiPolygon',
  coordinates: [
    [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]]
  ]
});
const multiSecond = test('5.5', '5.5', multi);
assert.equal(multiSecond.status, 'inside');
assert.equal(multiSecond.polygons, 2);
assert.equal(multiSecond.rings, 2);
assert.equal(multiSecond.containedPolygons, 1);
assert.deepEqual(plain(multiSecond.nearest), { polygon: 2, ring: 0, segment: 1 });
assert.equal(test('3', '3', multi).status, 'outside');

// Features and feature collections are accepted, and a point inside any of
// the collection's polygons is inside the collection.
const collection = geojson({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
    { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[10, 0], [11, 0], [11, 1], [10, 1], [10, 0]]] } }
  ]
});
const inSecond = test('0.5', '10.5', collection);
assert.equal(inSecond.status, 'inside');
assert.equal(inSecond.polygons, 2);
assert.equal(inSecond.vertices, 8);
assert.deepEqual(plain(inSecond.nearest), { polygon: 2, ring: 0, segment: 1 });
near(inSecond.nearestDistanceM, 55270, 'half a degree from the second polygon');
const feature = geojson({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } });
assert.equal(test('0.5', '0.5', feature).status, 'inside');
const geometryCollection = geojson({
  type: 'GeometryCollection',
  geometries: [{ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }]
});
assert.equal(test('0.5', '0.5', geometryCollection).status, 'inside');

// An unclosed ring is closed automatically and the result says so.
const unclosed = polygon([[[0, 0], [1, 0], [1, 1], [0, 1]]]);
const closed = test('0.5', '0.5', unclosed);
assert.equal(closed.status, 'inside');
assert.equal(closed.vertices, 4);
assert.equal(closed.warnings.length, 1);
assert.match(closed.warnings[0], /was not closed/);

// Decimal degrees are accepted in either sign and through a leading zero.
assert.equal(test('+0.5', '-0.5').status, 'inside');
assert.equal(test('.5', '.5').status, 'inside');
assert.equal(test('-0.5', '0.5').status, 'inside');
assert.equal(test('1.0', '1.0').status, 'boundary');

// Malformed or out-of-model input is rejected with a readable message.
const rejects = (input, pattern) => assert.throws(() => C.test(input), pattern);
const base = { geojson: square, lat: '0', lon: '0' };
rejects({ ...base, geojson: '' }, /Paste a GeoJSON polygon first\./);
rejects({ ...base, geojson: '   ' }, /Paste a GeoJSON polygon first\./);
rejects({ ...base, geojson: '{' }, /not valid JSON/);
rejects({ ...base, geojson: '[0,0]' }, /must be a JSON object/);
rejects({ ...base, geojson: '{"type":"Point","coordinates":[0,0]}' }, /Unsupported geometry type "Point"/);
rejects({ ...base, geojson: '{"type":"Polygon","coordinates":[]}' }, /Polygon 1 has no rings\./);
rejects({ ...base, geojson: polygon([[[0, 0], [1, 0], [1, 1]]]) }, /needs at least four positions/);
rejects({ ...base, geojson: polygon([[[0, 0], [1, 0], [1, 1], ["0", "0"]]]) }, /must be numbers, not strings/);
rejects({ ...base, geojson: polygon([[[0, 0], [1, 0], [1, 91], [0, 0]]]) }, /latitude 91; it must be between -90 and 90/);
rejects({ ...base, geojson: polygon([[[0, 0], [1, 0], [1, 1], [181, 0]]]) }, /longitude 181; it must be between -180 and 180/);
rejects({ ...base, geojson: '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[0,0]}}]}' }, /Unsupported geometry type "Point"/);
rejects({ ...base, geojson: '{"type":"Feature","properties":{}}' }, /needs a geometry object/);
rejects({ ...base, geojson: 'x'.repeat(C.MAX_TEXT + 1) }, /longer than 200,000 characters/);
rejects({ ...base, lat: '' }, /Latitude is required\./);
rejects({ ...base, lat: 'north' }, /Latitude must be a number/);
rejects({ ...base, lat: '1e2' }, /Latitude must be a number/);
rejects({ ...base, lat: '91' }, /Latitude must be between -90 and 90\./);
rejects({ ...base, lon: '-181' }, /Longitude must be between -180 and 180\./);
rejects({ ...base, lon: 'abc' }, /Longitude must be a number/);

// Missing options are rejected rather than crashing.
assert.throws(() => C.test(), /Latitude is required\./);
assert.equal(C.BOUNDARY_M, 0.01);
assert.equal(C.MAX_VERTICES, 20000);

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'point-in-polygon-tester');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Geography');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 12, 'catalog has the full test case set');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(
      () => C.test({ ...base, ...testCase.input }),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = C.test({ ...base, ...testCase.input });
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') near(result[key], value, testCase.name + ' ' + key);
    else assert.equal(result[key], value, testCase.name + ' ' + key);
  }
}

console.log('point-in-polygon-tester: all checks passed (' + record.testCases.length + ' catalog cases)');
