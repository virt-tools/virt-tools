/* Regression checks for the satellite look-angle core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/satellite-look-angle-calculator/index.html'), 'utf8');
const start = html.indexOf('/* lookangle-core:start */');
const end = html.indexOf('/* lookangle-core:end */');
assert.ok(start > -1 && end > start, 'look-angle core markers missing');
const core = html.slice(start, end + '/* lookangle-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = LookAngleCore;', sandbox);
const C = sandbox.module.exports;

const run = (input) => C.analyse(input);

// The default is London pointing at the 28.2 E broadcast slot.
const base = run({});
assert.equal(base.latitude, 51.5);
assert.equal(base.satelliteLongitude, 28.2);
assert.ok(Math.abs(base.elevation - 25.420152) < 1e-5);
assert.ok(Math.abs(base.azimuth - 145.583440) < 1e-5);
assert.equal(base.compass, 'SE');
assert.equal(base.visible, true);
assert.ok(Math.abs(base.slantRange - 39030.9628) < 1e-3);

// A satellite on the site's own meridian is due south in the north and due north in the south.
assert.equal(run({ latitude: 51.5, longitude: 0, satelliteLongitude: 0 }).azimuth, 180);
assert.equal(run({ latitude: 40.7128, longitude: -74.006, satelliteLongitude: -74.006 }).compass, 'S');
assert.equal(run({ latitude: -1.2921, longitude: 36.8219, satelliteLongitude: 36.8219 }).azimuth, 0);
assert.equal(run({ latitude: -1.2921, longitude: 36.8219, satelliteLongitude: 36.8219 }).compass, 'N');

// Equal east and west offsets from the equator mirror elevation and range, with bearings 90 and 270.
const east = run({ latitude: 0, longitude: 10, satelliteLongitude: 40 });
const west = run({ latitude: 0, longitude: 70, satelliteLongitude: 40 });
assert.ok(Math.abs(east.elevation - west.elevation) < 1e-12);
assert.ok(Math.abs(east.slantRange - west.slantRange) < 1e-9);
assert.equal(east.azimuth, 90);
assert.equal(west.azimuth, 270);
assert.equal(east.compass, 'E');
assert.equal(west.compass, 'W');

// Below the horizon is reported as such rather than hidden.
const anchorage = run({ latitude: 61.2181, longitude: -149.9003, satelliteLongitude: 0 });
assert.equal(anchorage.visible, false);
assert.ok(anchorage.elevation < -30);
assert.equal(anchorage.compass, 'NNE');
assert.equal(anchorage.zenithAngle, 90 - anchorage.elevation);

// At a pole the sub-satellite point is a quarter of the circumference away.
const pole = run({ latitude: 90, longitude: 0, satelliteLongitude: 0 });
assert.ok(Math.abs(pole.centralAngle - 90) < 1e-9);
assert.ok(Math.abs(pole.groundDistance - C.earthRadiusKm * Math.PI / 2) < 1e-9);
assert.ok(pole.elevation < 0);

// Geometry bounds: the satellite is always between the GEO radius and the GEO radius plus a diameter.
for (const input of [
  { latitude: 0, longitude: 0, satelliteLongitude: 0 },
  { latitude: 90, longitude: 180, satelliteLongitude: -180 },
  { latitude: -90, longitude: -180, satelliteLongitude: 180 },
  { latitude: 69.6492, longitude: 18.9553, satelliteLongitude: 0 },
]) {
  const result = run(input);
  assert.ok(result.slantRange > C.geoRadiusKm - C.earthRadiusKm - 1e-6, 'slant range is at least the orbital altitude');
  assert.ok(result.slantRange < C.geoRadiusKm + C.earthRadiusKm + 1e-6, 'slant range is below the far-side maximum');
  assert.ok(result.azimuth >= 0 && result.azimuth < 360, 'azimuth is normalised');
  assert.ok(Math.abs(result.groundDistance - C.earthRadiusKm * result.centralAngle * Math.PI / 180) < 1e-9);
  assert.equal(result.compass, C.compass[Math.round(result.azimuth / 22.5) % 16]);
}

// North-south mirror keeps the elevation and reflects the bearing about the meridian.
const north = run({ latitude: 30, longitude: 0, satelliteLongitude: 10 });
const south = run({ latitude: -30, longitude: 0, satelliteLongitude: 10 });
assert.ok(Math.abs(north.elevation - south.elevation) < 1e-12);
assert.ok(Math.abs((north.azimuth + south.azimuth) - 180) < 1e-9);
assert.equal(north.compass, 'SSE');
assert.equal(south.compass, 'NNE');

// Bad input fails with an actionable message, never a silent default.
assert.throws(() => run({ latitude: '' }), /Latitude is required\./);
assert.throws(() => run({ latitude: 'north' }), /Latitude must be a number between -90 and 90 degrees\./);
assert.throws(() => run({ latitude: 90.5 }), /Latitude must be between -90 and 90 degrees\./);
assert.throws(() => run({ latitude: -90.5 }), /Latitude must be between -90 and 90 degrees\./);
assert.throws(() => run({ longitude: '' }), /Longitude is required\./);
assert.throws(() => run({ longitude: 181 }), /Longitude must be between -180 and 180 degrees\./);
assert.throws(() => run({ longitude: 'east' }), /Longitude must be a number between -180 and 180 degrees\./);
assert.throws(() => run({ satelliteLongitude: '' }), /Satellite longitude is required\./);
assert.throws(() => run({ satelliteLongitude: -200 }), /Satellite longitude must be between -180 and 180 degrees\./);
assert.throws(() => run({ satelliteLongitude: 'slot' }), /Satellite longitude must be a number between -180 and 180 degrees\./);

// The page must not reach the network, store data or use inline handlers. The W3C SVG
// namespace string is an identifier, not a fetch, so it is ignored here.
const withoutSvgNs = html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
assert.ok(!/https?:\/\//.test(withoutSvgNs.replace(/https:\/\/virt\.tools[^"]*/g, '')), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'satellite-look-angle-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 20, 'catalog has the full test case set');
assert.ok(record.method.includes('browser'), 'method documents local execution');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(
      () => C.analyse(testCase.input),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = C.analyse(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number' && !Number.isInteger(value)) {
      assert.ok(Math.abs(result[key] - value) < 1e-9, testCase.name + ' ' + key);
    } else {
      assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

console.log('satellite-look-angle-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
