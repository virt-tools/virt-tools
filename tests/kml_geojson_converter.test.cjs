/* KML <-> GeoJSON converter: the XML reader, the KML to GeoJSON mapping, the
   GeoJSON to KML writer, a seeded round-trip oracle, exact refusals, the
   catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'kml-geojson-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* kgj-core:start */';
const endMarker = '/* kgj-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|navigator\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = KmlGeoJsonCore;', sandbox);
const C = sandbox.module.exports;

const convert = (mode, text) => C.solve({ mode, text });
const failure = (mode, text) => {
  try { C.solve({ mode, text }); } catch (error) { return error.message; }
  return null;
};
const parse = (text) => JSON.parse(convert('kml', text).output);
const wrap = (body) => '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>' + body + '</Document></kml>';

// ---- Exported contract and number formatting.
assert.deepEqual(Object.keys(C).sort(),
  ['MAX_TEXT', 'formatNumber', 'geoJsonToKml', 'kmlToGeoJson', 'parseXml', 'solve']);
assert.equal(C.formatNumber(47.6592), '47.6592');
assert.equal(C.formatNumber(-0), '0');
assert.equal(C.formatNumber(1e-7), '0.0000001');
assert.equal(C.formatNumber(122.5), '122.5');

// ---- The XML reader: comments, CDATA, entities, numeric references, self closing tags.
const tree = C.parseXml('<?xml version="1.0"?><!-- lead --><a x="1 &amp; 2"><b/><c><![CDATA[<raw>]]>&#65;&#x42;</c></a>');
assert.equal(tree.name, 'a');
assert.equal(tree.attrs.x, '1 & 2');
assert.equal(tree.children.length, 2);
assert.equal(tree.children[0].name, 'b');
assert.equal(tree.children[1].text, '<raw>AB');

// ---- Hand-written golden fixtures: the expected GeoJSON is built here, not by the core.
{
  const point = wrap('<Placemark><name>Ferry terminal</name>' +
    '<ExtendedData><Data name="kind"><value>pier</value></Data>' +
    '<Data name="berths"><value>4</value></Data></ExtendedData>' +
    '<Point><coordinates>-122.40579,47.6592,0</coordinates></Point></Placemark>');
  const result = convert('kml', point);
  assert.equal(result.featureCount, 1);
  assert.equal(result.geometryCount, 1);
  assert.equal(result.coordinateCount, 1);
  assert.deepEqual(Array.from(result.warnings), []);
  assert.deepEqual(JSON.parse(result.output), {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { name: 'Ferry terminal', kind: 'pier', berths: '4' },
      geometry: { type: 'Point', coordinates: [-122.40579, 47.6592, 0] }
    }]
  });
}

{
  const doc = wrap('<Folder><Folder><Placemark><name>First</name>' +
    '<LineString><coordinates>\n  -122.4065,47.6588,0\n  -122.4051,47.6594\n  -122.4037,47.6601,12.5\n</coordinates></LineString>' +
    '</Placemark></Folder></Folder>' +
    '<Placemark><name>Second</name><Polygon>' +
    '<outerBoundaryIs><LinearRing><coordinates>0,0 2,0 2,2 0,2 0,0</coordinates></LinearRing></outerBoundaryIs>' +
    '<innerBoundaryIs><LinearRing><coordinates>0.5,0.5 1.5,0.5 1.5,1.5 0.5,1.5 0.5,0.5</coordinates></LinearRing></innerBoundaryIs>' +
    '</Polygon></Placemark>');
  const result = convert('kml', doc);
  assert.equal(result.featureCount, 2);
  assert.equal(result.geometryCount, 2);
  assert.equal(result.coordinateCount, 13);
  const data = JSON.parse(result.output);
  assert.deepEqual(data.features.map((feature) => feature.properties.name), ['First', 'Second']);
  assert.deepEqual(data.features[0].geometry.coordinates, [
    [-122.4065, 47.6588, 0], [-122.4051, 47.6594], [-122.4037, 47.6601, 12.5]
  ]);
  assert.deepEqual(data.features[1].geometry.coordinates, [
    [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]],
    [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]]
  ]);
}

{
  const mixed = wrap('<Placemark><MultiGeometry>' +
    '<Point><coordinates>1,2</coordinates></Point>' +
    '<LineString><coordinates>3,4 5,6</coordinates></LineString>' +
    '</MultiGeometry></Placemark>');
  const data = parse(mixed);
  assert.equal(data.features[0].geometry.type, 'GeometryCollection');
  assert.deepEqual(data.features[0].geometry.geometries.map((item) => item.type), ['Point', 'LineString']);
}

{
  const same = wrap('<Placemark><MultiGeometry>' +
    '<Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon>' +
    '<Polygon><outerBoundaryIs><LinearRing><coordinates>2,2 3,2 3,3 2,2</coordinates></LinearRing></outerBoundaryIs></Polygon>' +
    '</MultiGeometry></Placemark>');
  const result = convert('kml', same);
  assert.equal(result.warningCount === undefined ? result.warnings.length : result.warningCount, 0);
  const data = JSON.parse(result.output);
  assert.equal(data.features[0].geometry.type, 'MultiPolygon');
  assert.equal(data.features[0].geometry.coordinates.length, 2);
}

// ---- A seeded generator builds KML and the exact GeoJSON it must produce.
let seed = 20261118;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const coordinate = () => [
  Number((-179.9 + random() * 359.8).toFixed(6)),
  Number((-89.9 + random() * 179.8).toFixed(6))
];
const placemarkXml = (name, geometryXml) => '<Placemark><name>' + name + '</name>' + geometryXml + '</Placemark>';

for (let round = 0; round < 150; round += 1) {
  const point = coordinate();
  const line = [coordinate(), coordinate(), coordinate()];
  const ring = [coordinate(), coordinate(), coordinate(), coordinate()];
  const closedRing = ring.concat([ring[0]]);
  const body = placemarkXml('Point ' + round, '<Point><coordinates>' + point.join(',') + ',0</coordinates></Point>') +
    placemarkXml('Line ' + round, '<LineString><coordinates>' + line.map((p) => p.join(',')).join(' ') + '</coordinates></LineString>') +
    placemarkXml('Area ' + round, '<Polygon><outerBoundaryIs><LinearRing><coordinates>' +
      closedRing.map((p) => p.join(',')).join(' ') + '</coordinates></LinearRing></outerBoundaryIs></Polygon>');
  const result = convert('kml', wrap(body));
  const expected = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'Point ' + round }, geometry: { type: 'Point', coordinates: point.concat([0]) } },
      { type: 'Feature', properties: { name: 'Line ' + round }, geometry: { type: 'LineString', coordinates: line } },
      { type: 'Feature', properties: { name: 'Area ' + round }, geometry: { type: 'Polygon', coordinates: [closedRing] } }
    ]
  };
  assert.deepEqual(JSON.parse(result.output), expected);
  assert.equal(result.coordinateCount, 1 + 3 + 5);

  // The reverse direction must reproduce the same geometry through KML.
  const back = convert('geojson', result.output);
  assert.equal(back.warnings.length, 0);
  const again = JSON.parse(convert('kml', back.output).output);
  assert.deepEqual(again.features.map((feature) => feature.geometry), expected.features.map((feature) => feature.geometry));
}

// ---- The GeoJSON writer: structure, escaping, property handling and statistics.
{
  const text = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'A & B <c>', berths: 4, open: true }, geometry: { type: 'Point', coordinates: [-122.4, 47.6, 0] } },
      { type: 'Feature', properties: {}, geometry: null },
      { type: 'Feature', properties: { nested: { a: 1 } }, geometry: { type: 'GeometryCollection', geometries: [
        { type: 'Point', coordinates: [1, 2] },
        { type: 'LineString', coordinates: [[3, 4], [5, 6]] }
      ] } }
    ]
  });
  const result = convert('geojson', text);
  assert.equal(result.featureCount, 3);
  assert.equal(result.geometryCount, 2);
  assert.equal(result.coordinateCount, 4);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /nested/);
  assert.match(result.output, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(result.output, /<kml xmlns="http:\/\/www\.opengis\.net\/kml\/2\.2">/);
  assert.match(result.output, /<name>A &amp; B &lt;c&gt;<\/name>/);
  assert.match(result.output, /<Data name="berths">\s*<value>4<\/value>/);
  assert.match(result.output, /<Placemark\/>/);
  assert.equal((result.output.match(/<MultiGeometry>/g) || []).length, 1);
  assert.match(result.output, /<coordinates>1,2<\/coordinates>/);
}

{
  const polygon = convert('geojson', JSON.stringify({ type: 'Polygon', coordinates: [
    [[0, 0], [1, 0], [1, 1], [0, 0]],
    [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.2]]
  ] }));
  assert.equal(polygon.featureCount, 1);
  assert.equal(polygon.coordinateCount, 8);
  assert.equal((polygon.output.match(/<outerBoundaryIs>/g) || []).length, 1);
  assert.equal((polygon.output.match(/<innerBoundaryIs>/g) || []).length, 1);
}

// ---- Exact refusals.
assert.equal(failure('kml', '   '), 'Paste a KML document to convert.');
assert.equal(failure('geojson', ''), 'Paste a GeoJSON document to convert.');
assert.equal(failure('nope', '<kml/>'), 'Choose a direction: KML to GeoJSON or GeoJSON to KML.');
assert.equal(failure('kml', 'not xml'), 'The KML is not well formed: text sits outside the root element on line 1.');
assert.equal(failure('kml', '<gpx></gpx>'), 'This is not a KML document: the root element is <gpx>.');
assert.equal(failure('kml', '<kml><Document/></kml>'), 'No Placemark elements were found in this KML.');
assert.equal(failure('kml', '<kml><Document></kml>'), 'The KML is not well formed: <Document> is closed by </kml> on line 1.');
assert.equal(failure('kml', wrap('<Placemark><Point><coordinates>1,2,3,4</coordinates></Point></Placemark>')),
  'A coordinate has 4 comma-separated values; KML allows longitude, latitude and an optional altitude.');
assert.equal(failure('kml', wrap('<Placemark><Point><coordinates>10,91</coordinates></Point></Placemark>')),
  'Latitude 91 is outside -90 to 90.');
assert.equal(failure('kml', wrap('<Placemark><LineString><coordinates>1,2</coordinates></LineString></Placemark>')),
  'A LineString needs at least 2 positions; this one has 1.');
assert.equal(failure('kml', wrap('<Placemark><Point><coordinates>1,north</coordinates></Point></Placemark>')),
  'A coordinate has a latitude that is not a number: \u201Cnorth\u201D.');
assert.equal(failure('kml', wrap('<Placemark><Point/></Placemark>')), 'A Point has no coordinates element.');
assert.equal(failure('kml', wrap('<Placemark><Polygon><LinearRing><coordinates>0,0 1,0 1,1 0,1</coordinates></LinearRing></Polygon></Placemark>')),
  'A Polygon has no outerBoundaryIs element.');
assert.equal(failure('geojson', '{"type": "Point", '), 'This is not valid JSON; check the GeoJSON syntax.');
assert.equal(failure('geojson', '[]'), 'This JSON is not GeoJSON: it is not an object.');
assert.equal(failure('geojson', '{"type": "Circle", "coordinates": [0, 0]}'),
  'This JSON is not GeoJSON: the type must be FeatureCollection, Feature or a geometry type.');
assert.equal(failure('geojson', '{"type": "FeatureCollection", "features": []}'), 'This FeatureCollection holds no features.');
assert.equal(failure('geojson', JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] })),
  'A Polygon ring is not closed: its first and last positions differ.');
assert.equal(failure('geojson', JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] })),
  'A Polygon ring needs at least 4 positions.');
assert.equal(failure('geojson', JSON.stringify({ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], []] })),
  'A Polygon has no rings.');
assert.equal(failure('geojson', JSON.stringify({ type: 'Point', coordinates: [0, 90.5] })), 'Latitude 90.5 is outside -90 to 90.');
assert.equal(failure('geojson', JSON.stringify({ type: 'Point', coordinates: ['a', 2] })),
  'A Point position holds a value that is not a number.');
assert.equal(failure('geojson', JSON.stringify({ type: 'LineString', coordinates: [[0, 0]] })),
  'A LineString needs at least 2 positions.');
assert.equal(failure('geojson', JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'Unknown', coordinates: [] } })),
  'This geometry type cannot be written as KML: Unknown.');
assert.equal(failure('geojson', JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Thing' }] })),
  'Feature 1 of this FeatureCollection is not a Feature object.');

// ---- Warning paths.
{
  const unclosed = convert('kml', wrap('<Placemark><Polygon><outerBoundaryIs><LinearRing>' +
    '<coordinates>0,0 1,0 1,1 0,1</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>'));
  assert.equal(unclosed.warnings.length, 1);
  assert.match(unclosed.warnings[0], /not closed/);
  assert.equal(unclosed.coordinateCount, 5);
  assert.deepEqual(JSON.parse(unclosed.output).features[0].geometry.coordinates[0].length, 5);
}
{
  const ringOnly = convert('kml', wrap('<Placemark><LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></Placemark>'));
  assert.equal(ringOnly.warnings.length, 1);
  assert.match(ringOnly.warnings[0], /closed LineString/);
}
{
  const track = convert('kml', '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">' +
    '<Placemark><name>Walk</name><gx:Track><when>2026-01-01T00:00:00Z</when></gx:Track></Placemark></kml>');
  assert.equal(track.geometryCount, 0);
  assert.equal(track.warnings.length, 1);
  assert.match(track.warnings[0], /gx:Track/);
}
{
  const marked = convert('kml', wrap('<Placemark><description>Hello <b>world</b></description>' +
    '<Point><coordinates>1,2</coordinates></Point></Placemark>'));
  assert.equal(marked.warnings.length, 1);
  assert.match(marked.warnings[0], /tags were dropped/);
  assert.equal(JSON.parse(marked.output).features[0].properties.description, 'Hello world');
}

// ---- Catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.category, 'Geography');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.description.length >= 60 && record.description.length <= 220, 'description length');
assert.ok(record.method.length > 400, 'method notes');
assert.ok(record.sources.length >= 2, 'two documented sources');
record.sources.forEach((source) => {
  assert.ok(source.title.length > 20, 'source title');
  assert.match(source.url, /^https:\/\//);
});
assert.ok(record.testCases.length >= 18, 'catalog cases');
const kinds = new Set(record.testCases.map((item) => item.kind));
['golden', 'boundary', 'validation'].forEach((kind) => assert.ok(kinds.has(kind), 'missing ' + kind + ' cases'));

const names = new Set();
for (const item of record.testCases) {
  assert.ok(!names.has(item.name), 'duplicate case name: ' + item.name);
  names.add(item.name);
  const message = failure(item.input.mode, item.input.text);
  if (item.expectedError) {
    assert.equal(message, item.expectedError, item.name);
    continue;
  }
  assert.equal(message, null, item.name + ' should convert');
  const result = C.solve(item.input);
  Object.keys(item.expected).forEach((key) => {
    const want = item.expected[key];
    if (key === 'outputContains') {
      want.forEach((fragment) => assert.ok(result.output.indexOf(fragment) > -1, item.name + ' missing ' + fragment));
    } else if (key === 'outputNotContains') {
      want.forEach((fragment) => assert.equal(result.output.indexOf(fragment), -1, item.name + ' has ' + fragment));
    } else if (key === 'warnings') {
      assert.deepEqual(Array.from(result.warnings), want, item.name);
    } else {
      assert.equal(result[key], want, item.name + ' / ' + key);
    }
  });
}

// ---- Page contract.
assert.match(html, /<title>KML ⇄ GeoJSON Converter — Virtual Tools<\/title>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.ok(html.indexOf('/assets/style.css') > -1 && html.indexOf('/assets/app.js') > -1, 'shared assets');
assert.ok(html.indexOf('<div id="site-header"></div>') > -1, 'shared header mount');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no off-site script');
assert.ok(!/(?:href|src)="https?:\/\//.test(html), 'no off-site assets or links');
const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
['source', 'convert-form', 'convert-err', 'convert-out', 'run', 'example', 'clear', 'method'].forEach((id) => {
  assert.ok(ids.indexOf(id) > -1, 'missing id ' + id);
});
assert.ok(/<label class="f" for="source"/.test(html), 'the textarea has a label');
assert.ok(/aria-live="polite"/.test(html), 'the result is announced');
assert.ok(/id="result"/.test(html) === false, 'the result textarea is built at runtime');

console.log('kml-geojson-converter: ' + record.testCases.length + ' catalog cases and the core suite passed');
