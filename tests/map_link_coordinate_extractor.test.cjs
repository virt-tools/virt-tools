/* Map link coordinate extractor: reference links, formatting invariants, random
   round trips, validation messages, catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'map-link-coordinate-extractor';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* map-link-core:start */';
const endMarker = '/* map-link-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MapLinkCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (text) => plain(C.parse(text));
const failure = (text) => {
  try { run(text); } catch (error) { return error.message; }
  return null;
};

// ---- Exported contract.
assert.equal(C.MAX_INPUT, 4000);
assert.equal(C.MAX_DECIMALS, 6);
assert.equal(C.METERS_PER_DEGREE, 111320);
assert.equal(C.DEFAULT_INPUT, '37.7749, -122.4194');

// ---- Formatting.
assert.equal(C.formatDms(37.7749, 'lat'), '37\u00b046\'29.6" N');
assert.equal(C.formatDms(-122.4194, 'lon'), '122\u00b025\'9.8" W');
assert.equal(C.formatDms(0, 'lat'), '0\u00b00\'0.0" N');
assert.equal(C.formatDms(-0.5, 'lon'), '0\u00b030\'0.0" W');
assert.equal(C.formatDms(90, 'lat'), '90\u00b00\'0.0" N');
assert.equal(C.formatDms(59.99999999, 'lat'), '60\u00b00\'0.0" N', 'seconds carrying into the degree');
assert.equal(C.formatDms(12.9999999, 'lat'), '13\u00b00\'0.0" N', 'a rounded minute carries as well');
assert.equal(C.trimNumber(37.5), '37.5');
assert.equal(C.trimNumber(-0.0000001), '0');
assert.equal(C.trimNumber(-122.4194), '-122.4194');
assert.equal(C.trimNumber(1e-7), '0');
assert.equal(C.trimNumber(2.0000005), '2.000001');
assert.equal(C.decimalsOf('37.7749'), 4);
assert.equal(C.decimalsOf('37'), 0);
assert.equal(C.metersText(111320), '111,320');
assert.equal(C.metersText(1113.2), '1,113');
assert.equal(C.metersText(11.132), '11.13');
assert.equal(C.metersText(0.11132), '0.111');
assert.equal(C.metersText(0), '0 m');
assert.deepEqual(plain(C.precisionOf('37.7749', '-122.4194', 37.7749)), {
  decimalPlaces: 4, latStep: 11.132, lonStep: 11.132 * Math.abs(Math.cos(37.7749 * Math.PI / 180)),
  latStepText: '11.13', lonStepText: '8.8',
  text: '11.13 m north-south, 8.8 m east-west',
});

// ---- Reference links, each expectation read off the link by hand.
const REFERENCE = [
  { text: '37.7749, -122.4194', source: 'Plain coordinates', lat: 37.7749, lon: -122.4194, zoom: null },
  { text: '  51.5007 , -0.1246  ', source: 'Plain coordinates', lat: 51.5007, lon: -0.1246, zoom: null },
  { text: '37.7749N, 122.4194W', source: 'Plain coordinates', lat: 37.7749, lon: -122.4194, zoom: null },
  { text: '33.8688S 151.2093E', source: 'Plain coordinates', lat: -33.8688, lon: 151.2093, zoom: null },
  { text: 'geo:48.8584,2.2945', source: 'geo: URI', lat: 48.8584, lon: 2.2945, zoom: null },
  { text: 'geo:35.6595,139.7005;u=30', source: 'geo: URI', lat: 35.6595, lon: 139.7005, zoom: null },
  { text: 'geo:41.9028,12.4964?z=11', source: 'geo: URI', lat: 41.9028, lon: 12.4964, zoom: 11 },
  { text: 'www.google.com/maps/@51.5007,-0.1246,15z', source: 'Map view centre', lat: 51.5007, lon: -0.1246, zoom: 15 },
  { text: 'www.google.com/maps/place/X/@40.7484,-73.9857,17z/data=!3d40.7484405!4d-73.9856644',
    source: 'Place pin', lat: 40.7484405, lon: -73.9856644, zoom: null },
  { text: 'www.openstreetmap.org/#map=12/48.8584/2.2945', source: 'Map view fragment', lat: 48.8584, lon: 2.2945, zoom: 12 },
  { text: 'www.openstreetmap.org/?mlat=-33.8688&mlon=151.2093#map=19/-33.8688/151.2093',
    source: 'Dropped marker', lat: -33.8688, lon: 151.2093, zoom: 19 },
  { text: 'www.bing.com/maps?cp=52.5200~13.4050&lvl=13', source: 'Map centre parameter', lat: 52.52, lon: 13.405, zoom: 13 },
  { text: 'maps.apple.com/?ll=35.6595,139.7005&z=16', source: 'Map parameter (ll)', lat: 35.6595, lon: 139.7005, zoom: 16 },
  { text: 'waze.com/ul?ll=40.7580,-73.9855&navigate=yes', source: 'Map parameter (ll)', lat: 40.758, lon: -73.9855, zoom: null },
  { text: 'www.google.com/maps/search/?api=1&query=41.9028,12.4964', source: 'Map parameter (query)', lat: 41.9028, lon: 12.4964, zoom: null },
  { text: 'example.test/place?lat=-33.8688&lon=151.2093&z=14', source: 'Latitude and longitude parameters',
    lat: -33.8688, lon: 151.2093, zoom: 14 },
];
for (const item of REFERENCE) {
  const result = run(item.text);
  assert.equal(result.source, item.source, 'source for ' + item.text);
  assert.ok(Math.abs(result.lat - item.lat) < 1e-9, 'latitude for ' + item.text);
  assert.ok(Math.abs(result.lon - item.lon) < 1e-9, 'longitude for ' + item.text);
  assert.equal(result.zoom, item.zoom, 'zoom for ' + item.text);
  assert.equal(result.hasZoom, item.zoom !== null, 'hasZoom for ' + item.text);
  assert.equal(result.geoUri, 'geo:' + result.latText + ',' + result.lonText, 'geo URI for ' + item.text);
}

// Marker and centre parameters keep the digits the link wrote.
assert.equal(run('www.bing.com/maps?cp=52.5200~13.4050&lvl=13').latText, '52.5200');
assert.equal(run('waze.com/ul?ll=40.7580,-73.9855').latText, '40.7580');
assert.equal(run('www.bing.com/maps?cp=52.5200~13.4050&lvl=13').decimalPlaces, 4);
assert.equal(failure('www.example.test/map?z=30'), 'No coordinates found. Paste a map link or a decimal coordinate pair.');
assert.equal(run('www.example.test/?ll=1,2&z=30').zoom, null, 'zooms above 22 are dropped');

// ---- The published example.
const published = run(C.DEFAULT_INPUT);
assert.equal(published.pairText, '37.7749, -122.4194');
assert.equal(published.dmsText, '37\u00b046\'29.6" N, 122\u00b025\'9.8" W');
assert.equal(published.precisionDetail, '4 decimal places');
assert.equal(published.precision, '11.13 m north-south, 8.8 m east-west');
assert.equal(published.zoomText, 'Not in this link');
assert.equal(published.latStepText, '11.13');
assert.equal(published.lonStepText, '8.8');

// ---- Random round trips and formatting invariants.
let seed = 20261111;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let iteration = 0; iteration < 200; iteration += 1) {
  const places = iteration % 7;
  const lat = Number((random() * 179.8 - 89.9).toFixed(places));
  const lon = Number((random() * 359.8 - 179.9).toFixed(places));
  const text = lat.toFixed(places) + ', ' + lon.toFixed(places);
  const result = run(text);
  const label = 'random ' + text;

  assert.equal(result.source, 'Plain coordinates', label);
  assert.ok(Math.abs(result.lat) <= 90 && Math.abs(result.lon) <= 180, label + ' stays in range');
  assert.equal(result.hasZoom, false, label + ' has no zoom');
  assert.equal(result.geoUri, 'geo:' + result.latText + ',' + result.lonText, label + ' geo URI');

  const again = run(result.geoUri);
  assert.ok(Math.abs(again.lat - result.lat) < 1e-9, label + ' latitude round trip');
  assert.ok(Math.abs(again.lon - result.lon) < 1e-9, label + ' longitude round trip');
  assert.equal(again.dmsText, result.dmsText, label + ' DMS round trip');

  // DMS components must recombine to the coordinate and carry a matching hemisphere.
  const parts = /^(\d+)\u00b0(\d+)'([\d.]+)" ([NSEW])$/.exec(result.latDms);
  assert.ok(parts, label + ' latitude DMS shape');
  assert.ok(Number(parts[2]) < 60 && Number(parts[3]) < 60, label + ' minutes and seconds stay below 60');
  const recombined = Number(parts[1]) + Number(parts[2]) / 60 + Number(parts[3]) / 3600;
  assert.ok(Math.abs(recombined - Math.abs(result.lat)) < 2e-5, label + ' latitude DMS recombines');
  assert.equal(parts[4], result.lat < 0 ? 'S' : 'N', label + ' latitude hemisphere');
  assert.equal(result.lonDms.slice(-1), result.lon < 0 ? 'W' : 'E', label + ' longitude hemisphere');

  const step = Math.pow(10, -result.decimalPlaces) * C.METERS_PER_DEGREE;
  assert.equal(result.latStepText, C.metersText(step), label + ' latitude step');
  assert.ok(Number(result.lonStepText.replace(/,/g, '')) <= Number(result.latStepText.replace(/,/g, '')) + 1e-9,
    label + ' east-west step never exceeds the north-south step');
  assert.equal(result.decimalPlaces, Math.max(C.decimalsOf(result.latText), C.decimalsOf(result.lonText)),
    label + ' decimal places follow the text');
  assert.deepEqual(run(text), result, label + ' deterministic');
}

// ---- Validation messages.
assert.equal(failure(''), 'Paste a map link or a pair of coordinates.');
assert.equal(failure('    '), 'Paste a map link or a pair of coordinates.');
assert.equal(failure(null), 'Paste a map link or a pair of coordinates.');
assert.equal(failure(undefined), 'Paste a map link or a pair of coordinates.');
assert.equal(failure('x'.repeat(4000)), 'No coordinates found. Paste a map link or a decimal coordinate pair.');
assert.equal(failure('x'.repeat(4001)), 'That input is too long; paste one map link or coordinate pair.');
assert.equal(failure('hello world'), 'No coordinates found. Paste a map link or a decimal coordinate pair.');
assert.equal(failure('12.5'), 'No coordinates found. Paste a map link or a decimal coordinate pair.');
assert.equal(failure('1, 2, 3'), 'No coordinates found. Paste a map link or a decimal coordinate pair.');
assert.equal(failure('40.7128, -74.0060 parking'), 'No coordinates found. Paste a map link or a decimal coordinate pair.');
assert.equal(failure('95, 200'), 'Latitude must be between -90 and 90 and longitude between -180 and 180.');
assert.equal(failure('95, 95'), 'Latitude must be between -90 and 90 and longitude between -180 and 180.');
assert.equal(failure('122.4194, 37.7749'), 'Check the order: latitude comes first and must be between -90 and 90.');
assert.equal(failure('geo:91,0'), 'Check the order: latitude comes first and must be between -90 and 90.');
assert.equal(failure('geo:somewhere'), 'That geo: URI does not carry a latitude, longitude pair.');
assert.equal(failure('geo:1'), 'That geo: URI does not carry a latitude, longitude pair.');
assert.equal(failure('maps.example.test/?ll=1,2,3'), 'No coordinates found. Paste a map link or a decimal coordinate pair.');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2224, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Map Link Coordinate Extractor');
assert.equal(record.category, 'Geography');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1f9ed}');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 4, 'sources are cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 21, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 9, 'nine validation cases');
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input.text), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input.text);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number' && typeof result[key] === 'number') {
      assert.ok(Math.abs(result[key] - value) < 1e-9, testCase.name + ' ' + key);
      continue;
    }
    assert.deepEqual(result[key], value, testCase.name + ' ' + key);
  }
}

// The new record's slug, name and aliases must not collide with any other record.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');
for (const tag of ['map-link', 'geo-uri', 'coordinate-extraction', 'degrees-minutes-seconds', 'map-zoom']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 6, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="link">/.test(html), 'the textarea has a visible label');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status"/.test(html), 'copy feedback is announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/overflow-wrap:anywhere/.test(html), 'long links wrap instead of overflowing');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html.replace(/[\u2190\u2014\u2013\u00b7]/g, '')), 'no unexpected non-ASCII glyphs');

console.log('map link coordinate extractor: 16 reference links, 200 round trips, 21 catalog cases and the page contract pass');
