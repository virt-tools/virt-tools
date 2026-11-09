/* Regression checks for the ECEF coordinate converter core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/ecef-coordinate-converter/index.html'), 'utf8');
const startMarker = '/* ecef-core:start */';
const endMarker = '/* ecef-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'ECEF core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = EcefCore;', sandbox);
const C = sandbox.module.exports;

function close(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} differs from ${expected} by more than ${tolerance}`);
}

// Reference values computed independently with 60-digit decimal arithmetic,
// including an original Taylor-series sine/cosine and a bisection solve for
// the reverse direction.
const anchors = [
  {lat: '51.5074', lon: '-0.1278', height: '0', x: 3977994.273815, y: -8873.053402, z: 4968874.937267, norm: 6365079.364453},
  {lat: '0', lon: '0', height: '0', x: 6378137, y: 0, z: 0, norm: 6378137},
  {lat: '90', lon: '0', height: '0', x: 0, y: 0, z: 6356752.314245, norm: 6356752.314245},
  {lat: '-90', lon: '0', height: '0', x: 0, y: 0, z: -6356752.314245, norm: 6356752.314245},
  {lat: '0', lon: '180', height: '0', x: -6378137, y: 0, z: 0, norm: 6378137},
  {lat: '45', lon: '0', height: '0', x: 4517590.878849, y: 0, z: 4487348.408866, norm: 6367489.543863},
  {lat: '60', lon: '10', height: '100', x: 3148582.624781, y: 555180.067739, z: 5500563.736479, norm: 6362232.223973},
  {lat: '-33.8688', lon: '151.2093', height: '58', x: -4646093.477288, y: 2553229.535817, z: -3534404.710910, norm: 6371591.820164},
  {lat: '89.9', lon: '45', height: '-500', x: 7897.335879, y: 7897.335879, z: 6356242.567871, norm: 6356252.379936},
  {lat: '0', lon: '-179.999999', height: '1000', x: -6379137, y: -0.111337, z: 0, norm: 6379137},
  {lat: '51.5074', lon: '-0.1278', height: '400000', x: 4226959.076155, y: -9428.377979, z: 5281950.357590, norm: 6765077.346627},
  {lat: '-45', lon: '-120', height: '2500', x: -2259679.322901, y: -3913879.396077, z: -4489116.175819, norm: 6369989.529770}
];

for (const a of anchors) {
  const result = C.calculate({mode: 'toEcef', lat: a.lat, lon: a.lon, height: a.height});
  close(result.x, a.x, 1e-6, `X at ${a.lat},${a.lon},${a.height}`);
  close(result.y, a.y, 1e-6, `Y at ${a.lat},${a.lon},${a.height}`);
  close(result.z, a.z, 1e-6, `Z at ${a.lat},${a.lon},${a.height}`);
  close(result.norm, a.norm, 1e-6, `norm at ${a.lat},${a.lon},${a.height}`);

  const back = C.calculate({
    mode: 'toGeodetic',
    x: String(a.x), y: String(a.y), z: String(a.z)
  });
  close(back.lat, Number(a.lat), 1e-6, `reverse latitude for ${a.lat},${a.lon}`);
  if (Math.abs(Number(a.lat)) < 89.999999) {
    close(back.lon, Number(a.lon), 1e-5, `reverse longitude for ${a.lat},${a.lon}`);
  }
  close(back.height, Number(a.height), 2e-3, `reverse height for ${a.lat},${a.lon}`);
  assert.equal(back.mode, 'toGeodetic');
}

// Fixed axes: the prime meridian at the equator lies on the X axis, 90 east on
// Y, and the pole on Z, at the WGS84 axis lengths.
assert.equal(C.WGS84.a, 6378137);
close(C.WGS84.b, 6356752.314245, 1e-6, 'semi-minor axis');
assert.equal(C.calculate({mode: 'toEcef', lat: '0', lon: '0', height: '0'}).x, 6378137);
assert.equal(C.calculate({mode: 'toEcef', lat: '0', lon: '90', height: '0'}).y, 6378137);
close(C.calculate({mode: 'toEcef', lat: '90', lon: '0', height: '0'}).z, 6356752.314245, 1e-6, 'polar axis');

// Geocentric latitude differs from geodetic latitude except on the equator and
// at the poles; the 45 degree case is the standard maximum difference.
const london = C.calculate({mode: 'toEcef', lat: '51.5074', lon: '-0.1278', height: '0'});
close(london.geocentricLat, 51.319777827, 1e-6, 'London geocentric latitude');
const fortyFive = C.calculate({mode: 'toEcef', lat: '45', lon: '0', height: '0'});
close(fortyFive.geocentricLat, 44.807576, 1e-6, '45 degree geocentric latitude');
close(C.calculate({mode: 'toEcef', lat: '90', lon: '0', height: '0'}).geocentricLat, 90, 1e-9, 'pole geocentric latitude');
close(C.calculate({mode: 'toEcef', lat: '0', lon: '0', height: '0'}).geocentricLat, 0, 1e-9, 'equator geocentric latitude');

// Round-trip a grid of geodetic positions through ECEF and back.
let gridChecks = 0;
for (let lat = -80; lat <= 80; lat += 20) {
  for (let lon = -180; lon <= 150; lon += 30) {
    for (const height of ['-500', '0', '2500', '400000']) {
      const forward = C.calculate({mode: 'toEcef', lat: String(lat), lon: String(lon), height});
      const back = C.calculate({
        mode: 'toGeodetic',
        x: forward.x.toFixed(6), y: forward.y.toFixed(6), z: forward.z.toFixed(6)
      });
      close(back.lat, lat, 1e-8, `grid latitude ${lat},${lon},${height}`);
      close(back.lon, lon, 1e-8, `grid longitude ${lat},${lon},${height}`);
      close(back.height, Number(height), 1e-3, `grid height ${lat},${lon},${height}`);
      gridChecks += 1;
    }
  }
}
assert.equal(gridChecks, 9 * 12 * 4);

// Poles have no longitude; the exact axis is reported as 0 degrees and flagged.
const northAxis = C.calculate({mode: 'toGeodetic', x: '0', y: '0', z: '7000000'});
assert.equal(northAxis.lat, 90);
assert.equal(northAxis.lon, 0);
close(northAxis.height, 643247.685755, 1e-6, 'height above the north pole');
assert.equal(northAxis.warnings.length, 2);
assert.match(northAxis.warnings[0], /Longitude is undefined at the pole/);
assert.match(northAxis.warnings[1], /usual -12 km to 100 km range/);
const southAxis = C.calculate({mode: 'toGeodetic', x: '0', y: '-0', z: '-6356752.314245'});
assert.equal(southAxis.lat, -90);
assert.equal(southAxis.lon, 0);

// High and low ellipsoid heights warn but still convert.
assert.equal(C.calculate({mode: 'toEcef', lat: '0', lon: '0', height: '400000'}).warnings.length, 1);
assert.equal(C.calculate({mode: 'toEcef', lat: '0', lon: '0', height: '-15000'}).warnings.length, 1);
assert.equal(C.calculate({mode: 'toEcef', lat: '0', lon: '0', height: '-12000'}).warnings.length, 0);
assert.equal(C.calculate({mode: 'toEcef', lat: '0', lon: '0', height: '100000'}).warnings.length, 0);

// Display helpers trim trailing zeros and name hemispheres.
assert.equal(C.latitude(51.5074), '51.5074\u00b0 N');
assert.equal(C.latitude(-33.8688), '33.8688\u00b0 S');
assert.equal(C.latitude(0), '0\u00b0 N');
assert.equal(C.longitude(-0.1278), '0.1278\u00b0 W');
assert.equal(C.longitude(180), '180\u00b0 E');
assert.equal(C.trim(6365079.364452725, 3), '6365079.364');
assert.equal(C.trim(-0.000094, 3), '0');
assert.equal(C.trim(0.1 + 0.2, 6), '0.3');

// Defaults convert without arguments.
const defaults = C.calculate();
assert.equal(defaults.mode, 'toEcef');
close(defaults.x, 3977994.273815, 1e-6, 'default X');
close(defaults.norm, 6365079.364453, 1e-6, 'default norm');

// Validation: boundaries are accepted, out-of-range and malformed input is refused.
assert.equal(C.calculate({mode: 'toEcef', lat: '-90', lon: '-180', height: '0'}).lat, -90);
assert.equal(C.calculate({mode: 'toEcef', lat: '90', lon: '180', height: '0'}).lon, 180);
assert.equal(C.calculate({mode: 'toEcef', lat: '0', lon: '0', height: '-20000'}).height, -20000);
assert.equal(C.calculate({mode: 'toEcef', lat: '0', lon: '0', height: '2000000'}).height, 2000000);
assert.equal(C.calculate({mode: 'toGeodetic', x: '20000000', y: '0', z: '0'}).x, 20000000);

function expectError(input, message) {
  assert.throws(() => C.calculate(input), (error) => error.message === message,
    `expected ${JSON.stringify(message)} for ${JSON.stringify(input)}`);
}

expectError({mode: 'toEcef', lat: ''}, 'Latitude is required.');
expectError({mode: 'toEcef', lat: '   '}, 'Latitude is required.');
expectError({mode: 'toEcef', lat: '91'}, 'Latitude must be from -90 to 90 degrees.');
expectError({mode: 'toEcef', lat: '-90.000001'}, 'Latitude must be from -90 to 90 degrees.');
expectError({mode: 'toEcef', lat: 'north'}, 'Latitude must be a decimal number with at most 6 decimals, for example 51.5074.');
expectError({mode: 'toEcef', lat: '1e1'}, 'Latitude must be a decimal number with at most 6 decimals, for example 51.5074.');
expectError({mode: 'toEcef', lat: '51.1234567'}, 'Latitude must be a decimal number with at most 6 decimals, for example 51.5074.');
expectError({mode: 'toEcef', lat: {}}, 'Latitude must be a decimal number with at most 6 decimals, for example 51.5074.');
expectError({mode: 'toEcef', lon: '180.000001'}, 'Longitude must be from -180 to 180 degrees.');
expectError({mode: 'toEcef', lon: '-180.000001'}, 'Longitude must be from -180 to 180 degrees.');
expectError({mode: 'toEcef', lon: 'west'}, 'Longitude must be a decimal number with at most 6 decimals, for example -0.1278.');
expectError({mode: 'toEcef', height: '1e3'}, 'Ellipsoid height must be a decimal number with at most 3 decimals, for example 0.');
expectError({mode: 'toEcef', height: '2000001'}, 'Ellipsoid height must be from -20000 to 2000000 metres.');
expectError({mode: 'toEcef', height: '-20001'}, 'Ellipsoid height must be from -20000 to 2000000 metres.');
expectError({mode: 'toGeodetic', x: '21000000'}, 'ECEF X must be from -20000000 to 20000000 metres.');
expectError({mode: 'toGeodetic', y: 'abc'}, 'ECEF Y must be a decimal number with at most 9 decimals, for example -8873.053.');
expectError({mode: 'toGeodetic', z: '0.1234567891'}, 'ECEF Z must be a decimal number with at most 9 decimals, for example 4968874.937.');
expectError({mode: 'toGeodetic', x: '0', y: '0', z: '0'},
  "X, Y and Z cannot all be zero; the geodetic position is undefined at the Earth's centre.");
expectError({mode: 'sideways'}, 'Choose geodetic to ECEF or ECEF to geodetic.');

console.log('ecef-coordinate-converter: anchor, reverse, grid, formatting and validation checks passed');
