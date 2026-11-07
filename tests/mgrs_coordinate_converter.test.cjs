/* Regression checks for the MGRS converter core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/mgrs-coordinate-converter/index.html'), 'utf8');
const start = html.indexOf('/* mgrs-core:start */');
const end = html.indexOf('/* mgrs-core:end */');
assert.ok(start > -1 && end > start, 'mgrs core markers missing');
const core = html.slice(start, end + '/* mgrs-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MgrsCore;', sandbox);
const M = sandbox.module.exports;

const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, label + ' (' + actual + ' vs ' + expected + ')');
};

// Published grid references: London, Paris, Washington, Sydney, Svalbard and the date line.
// Each was also reproduced by an independent WGS84 transverse Mercator implementation.
assert.equal(M.encode({ latitude: 51.5074, longitude: -0.1278 }).reference, '30UXC 99316 10163');
assert.equal(M.encode({ latitude: 48.8583, longitude: 2.2945 }).reference, '31UDQ 48251 11943');
assert.equal(M.encode({ latitude: 38.8977, longitude: -77.0365 }).reference, '18SUJ 23394 07395');
assert.equal(M.encode({ latitude: -33.8688, longitude: 151.2093 }).reference, '56HLH 34368 50948');
assert.equal(M.encode({ latitude: 78.2232, longitude: 15.6267 }).reference, '33XWG 14278 83355');
assert.equal(M.encode({ latitude: 65, longitude: -179.9 }).reference, '1WCN 63283 11591');

// The 100 km letters follow the zone modulo 3 column sets and the five-letter row shift
// on even zones, so London (zone 30) and Paris (zone 31) must sit in XC and DQ.
assert.equal(M.encode({ latitude: 51.5074, longitude: -0.1278 }).square, 'XC');
assert.equal(M.encode({ latitude: 48.8583, longitude: 2.2945 }).square, 'DQ');

// An independent check of the northing: numerically integrate the WGS84 meridian from
// the equator and compare with the projected northing on a central meridian.
const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const meridianRadius = (latitude) => A * (1 - E2) / Math.pow(1 - E2 * Math.pow(Math.sin(latitude), 2), 1.5);
function integrateMeridian(latitudeDegrees) {
  const target = latitudeDegrees * Math.PI / 180;
  const steps = 4000;
  const h = target / steps;
  let total = meridianRadius(0) + meridianRadius(target);
  for (let step = 1; step < steps; step += 1) {
    total += meridianRadius(step * h) * (step % 2 === 0 ? 2 : 4);
  }
  return (total * h / 3) * 0.9996;
}
for (const latitude of [1, 8, 24, 45, 51.5, 63, 72, 83.9]) {
  const zone = Math.floor((3 + 180) / 6) + 1;
  const projected = M.project(latitude, zone * 6 - 183, zone);
  near(projected.easting, 500000, 1e-6, 'central meridian easting at ' + latitude + '°');
  near(projected.northing, integrateMeridian(latitude), 0.5, 'meridian northing at ' + latitude + '°');
}

// The equator has no false northing, and a southern latitude adds the 10,000,000 m one.
near(M.project(0, 0, 31).northing, 0, 1e-9, 'equator northing');
near(M.project(-10, 0, 31).northing, 10000000 - M.project(10, 0, 31).northing, 1e-6, 'southern false northing');

// Encoding and decoding must be inverse operations: the decoded south-west corner of a
// 1 m cell lies within a cell of the original point.
const samples = [];
for (let latitude = -79.5; latitude < 84; latitude += 6.1) {
  for (let longitude = -179; longitude < 180; longitude += 17.3) {
    samples.push([Number(latitude.toFixed(6)), Number(longitude.toFixed(6))]);
  }
}
samples.push([0, 0], [48.8583, 2.2945], [-77.8419, 166.6863], [78.2232, 15.6267], [83.999, -179.999]);
for (const [latitude, longitude] of samples) {
  const encoded = M.encode({ latitude, longitude, precision: 5 });
  assert.ok(/^\d{1,2}[A-Z][A-Z]{2} \d{5} \d{5}$/.test(encoded.reference), 'reference format ' + encoded.reference);
  const decoded = M.decode({ mgrs: encoded.reference });
  assert.equal(decoded.gridZone, encoded.gridZone, 'zone round trip ' + encoded.reference);
  assert.equal(decoded.square, encoded.square, 'square round trip ' + encoded.reference);
  assert.equal(decoded.digits, 5);
  near(decoded.latitude, latitude, 0.00002, 'latitude round trip ' + encoded.reference);
  near(decoded.longitude, longitude, 0.0006, 'longitude round trip ' + encoded.reference);
  near(decoded.southWest.latitude, latitude, 0.00002, 'south-west latitude ' + encoded.reference);
  assert.ok(decoded.northEast.latitude > decoded.southWest.latitude, 'cell has height');
  assert.ok(decoded.northEast.longitude > decoded.southWest.longitude, 'cell has width');
}

// Coarser digits keep the same 100 km square and only widen the named cell.
for (const [precision, step] of [[5, 1], [4, 10], [3, 100], [2, 1000], [1, 10000], [0, 100000]]) {
  const encoded = M.encode({ latitude: 48.8583, longitude: 2.2945, precision });
  assert.equal(encoded.step, step, 'step for precision ' + precision);
  assert.ok(encoded.reference.startsWith('31UDQ'), 'square is unchanged at precision ' + precision);
}

// The sibling UTM zone page must agree on every grid zone, since both apply the same
// Norway and Svalbard exceptions.
const utmPage = fs.readFileSync(path.join(root, 'frontend/tools/utm-zone-calculator/index.html'), 'utf8');
const utmStart = utmPage.indexOf('/* utm-zone-core:start */');
const utmEnd = utmPage.indexOf('/* utm-zone-core:end */');
assert.ok(utmStart > -1 && utmEnd > utmStart, 'utm zone core markers missing');
const utmSandbox = { module: {} };
vm.createContext(utmSandbox);
vm.runInContext(utmPage.slice(utmStart, utmEnd + 23) + '\nmodule.exports = UTMZoneCore;', utmSandbox);
const U = utmSandbox.module.exports;
for (const [latitude, longitude] of samples) {
  const mine = M.encode({ latitude, longitude });
  const theirs = U.calculate({ latitude, longitude });
  assert.equal(mine.gridZone, theirs.gridZone, 'grid zone agreement at ' + latitude + ',' + longitude);
  assert.equal(mine.rule, theirs.rule, 'zone rule agreement at ' + latitude + ',' + longitude);
}

// Decoding is case insensitive and tolerates spaces.
assert.equal(M.decode({ mgrs: '31u dq 48251 11943' }).gridZone, '31U');
assert.equal(M.decode({ mgrs: '31UDQ4825111943' }).gridZone, '31U');
assert.equal(M.decode({ mgrs: '31UDQ' }).step, 100000);

// Validation keeps the input surface honest.
assert.throws(() => M.encode({ latitude: '', longitude: 0 }), /Latitude is required\./);
assert.throws(() => M.encode({ latitude: 84, longitude: 0 }), /not including, 84°N/);
assert.throws(() => M.encode({ latitude: 0, longitude: 0, precision: 9 }), /Precision must be a whole number/);
assert.throws(() => M.decode({ mgrs: '' }), /MGRS reference is required\./);
assert.throws(() => M.decode({ mgrs: '32XMM1234512345' }), /Zones 32X, 34X and 36X do not exist/);
assert.throws(() => M.decode({ mgrs: '31UDQ482511194' }), /two equal groups/);
assert.throws(() => M.decode({ mgrs: '31UQQ4825111943' }), /does not belong to zone 31/);

// The page must not reach the network, store data or use inline handlers. The W3C SVG
// namespace string is an identifier, not a fetch, so it is ignored here.
const withoutSvgNs = html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
assert.ok(!/https?:\/\//.test(withoutSvgNs), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/<textarea/i.test(html), 'page keeps the input surface to simple fields');
assert.ok(html.includes('/assets/style.css') && html.includes('/assets/theme-init.js'), 'page uses the shared styles');
assert.ok(html.includes('<h1>MGRS Coordinate Converter</h1>'), 'page has its own heading');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'mgrs-coordinate-converter');
assert.ok(record, 'catalog record missing');
assert.equal(record.category, 'Geography');
assert.equal(record.subcategory, 'Coordinates');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 45, 'catalog carries the full case set');
assert.ok(record.method.includes('truncated'), 'method documents digit truncation');

const encodeFields = {
  reference: (result) => result.reference,
  zone: (result) => result.zone,
  band: (result) => result.band,
  gridZone: (result) => result.gridZone,
  square: (result) => result.square,
  easting: (result) => result.easting,
  northing: (result) => result.northing,
  digits: (result) => result.digits,
  step: (result) => result.step,
  rule: (result) => result.rule,
  hemisphere: (result) => result.hemisphere,
  latitude: (result) => result.latitude,
  longitude: (result) => result.longitude
};
const decodeFields = {
  gridZone: (result) => result.gridZone,
  band: (result) => result.band,
  square: (result) => result.square,
  digits: (result) => result.digits,
  step: (result) => result.step,
  easting: (result) => result.easting,
  northing: (result) => result.northing,
  latitude: (result) => result.latitude,
  longitude: (result) => result.longitude
};

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    const run = testCase.operation === 'decode' ? () => M.decode(testCase.input) : () => M.encode(testCase.input);
    assert.throws(run, new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), testCase.name);
    continue;
  }
  const decode = testCase.kind === 'decode';
  const fields = decode ? decodeFields : encodeFields;
  const result = decode ? M.decode(testCase.input) : M.encode(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    const pick = fields[key];
    assert.ok(pick, 'unknown expected field ' + key);
    const actual = pick(result);
    if (typeof value === 'number') {
      // Coordinates are pinned to a tenth of a metre; lat/lon to a microwhatever is not needed.
      const tolerance = key === 'easting' || key === 'northing' ? 0.01 : (key === 'latitude' || key === 'longitude' ? 1e-6 : 0);
      near(actual, value, tolerance, testCase.name + ' ' + key);
    } else {
      assert.equal(actual, value, testCase.name + ' ' + key);
    }
  }
}

console.log('mgrs-coordinate-converter: all checks passed (' + record.testCases.length + ' catalog cases)');
