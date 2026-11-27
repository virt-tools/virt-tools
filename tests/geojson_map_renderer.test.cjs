/* Regression checks for the GeoJSON map renderer core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/geojson-map-renderer/index.html'), 'utf8');
const start = html.indexOf('/* geojson-map-core:start */');
const end = html.indexOf('/* geojson-map-core:end */');
assert.ok(start > -1 && end > start, 'geojson map core markers missing');
const core = html.slice(start, end + '/* geojson-map-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = GeoMap;', sandbox);
const G = sandbox.module.exports;

const same = (actual, expected, message) =>
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
const near = (actual, expected, message, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'geojson-map-renderer');
assert.ok(entry, 'catalog entry missing');
assert.equal(catalog.tools.length, 2504, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2243, 'public tools');
assert.ok(entry.testCases.length >= 30, `expected at least 30 cases, found ${entry.testCases.length}`);

// The projection constants and the published Mercator ordinate at 45 degrees.
near(G.MAX_MERCATOR_LAT, 85.05112878, 'Mercator latitude limit');
same(G.STEPS.slice(0, 6), [0.005, 0.01, 0.02, 0.05, 0.1, 0.2], 'graticule steps');
near(G.project(0, 45, 'mercator')[1], 50.49898671052621, 'Mercator y at 45 degrees');
near(G.project(0, -45, 'mercator')[1], -50.49898671052621, 'Mercator y at -45 degrees');
near(G.project(0, 0, 'mercator')[1], 0, 'Mercator y at the equator', 1e-12);
near(G.project(0, 90, 'mercator')[1], 180, 'Mercator clamps the pole to 180', 1e-6);
same(G.project(0, 90, 'mercator')[2], true, 'the pole is reported as clamped');
same(G.project(10, 45, 'equirectangular'), [10, 45, false], 'equirectangular keeps degrees');

// Replay every catalog case: refusals by exact message, results by the documented fields.
const keys = ['featureCount', 'geometryCount', 'positionCount', 'bounds', 'width', 'height', 'padding',
  'warnings', 'screenPositions'];
const graticuleKeys = ['on', 'lonStep', 'latStep', 'meridians', 'parallels'];
for (const testCase of entry.testCases) {
  const label = testCase.name;
  const input = Object.assign({}, testCase.input);
  input.text = typeof input.geojson === 'string' ? input.geojson : JSON.stringify(input.geojson);
  delete input.geojson;
  if (testCase.expected.error) {
    assert.throws(
      () => G.render(input),
      (error) => {
        assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
        return true;
      },
      `${label}: expected a refusal`
    );
    continue;
  }
  const result = G.render(input);
  for (const key of keys) {
    if (!(key in testCase.expected)) continue;
    assert.deepEqual(JSON.parse(JSON.stringify(result[key])), testCase.expected[key], `${label}: ${key}`);
  }
  for (const key of graticuleKeys) {
    if (!(key in testCase.expected.graticule)) continue;
    assert.deepEqual(JSON.parse(JSON.stringify(result.graticule[key])), testCase.expected.graticule[key], `${label}: graticule.${key}`);
  }
  assert.ok(typeof result.svg === 'string' && result.svg.startsWith('<svg '), `${label}: SVG output`);
  assert.ok(!JSON.stringify(result).includes('undefined'), `${label}: missing value`);
}

// The square polygon is fitted inside the padding on its limiting axis and centred on the other.
const square = JSON.stringify({ type: 'Polygon', coordinates: [[[10, 53], [10.4, 53], [10.4, 53.5], [10, 53.5], [10, 53]]] });
const squareResult = G.render({ text: square, projection: 'equirectangular', width: 480, grid: 'off' });
const squareXs = squareResult.screenPositions.map((p) => p[0]);
const squareYs = squareResult.screenPositions.map((p) => p[1]);
near(Math.min(...squareYs), squareResult.padding, 'square touches the top padding', 1e-9);
near(Math.max(...squareYs), squareResult.height - squareResult.padding, 'square touches the bottom padding', 1e-9);
near(Math.min(...squareXs) + Math.max(...squareXs), squareResult.width, 'square is centred horizontally', 1e-9);

// Every rendered point stays inside the padded frame, for both projections and all widths.
for (const projection of ['mercator', 'equirectangular']) {
  for (const width of [240, 480, 720, 1600]) {
    const result = G.render({ text: square, projection, width, grid: 'on' });
    for (const point of result.screenPositions) {
      assert.ok(point[0] >= result.padding - 0.01 && point[0] <= result.width - result.padding + 0.01, `${projection} ${width}: x ${point[0]}`);
      assert.ok(point[1] >= result.padding - 0.01 && point[1] <= result.height - result.padding + 0.01, `${projection} ${width}: y ${point[1]}`);
    }
    assert.ok(result.screenPositions.every((point) => Number.isFinite(point[0]) && Number.isFinite(point[1])), `${projection} ${width}: finite screen point`);
  }
}

// A dateline polygon is unwrapped to a continuous 20-degree strip, not a 340-degree one.
const dateline = G.render({
  text: JSON.stringify({ type: 'Polygon', coordinates: [[[170, 10], [-170, 10], [-170, 20], [170, 20], [170, 10]]] }),
  projection: 'equirectangular', width: 720, grid: 'on'
});
same(dateline.bounds, [170, 10, 190, 20], 'dateline bounds');
same(dateline.widthDegrees, 20, 'dateline width in degrees');
assert.match(dateline.warnings.join(' '), /antimeridian/);
assert.ok(dateline.graticule.meridians.includes(180) && dateline.graticule.meridians.includes(190), 'unwrapped meridians');

// A dateline line keeps consecutive longitudes within half a turn.
const datelineLine = G.render({
  text: JSON.stringify({ type: 'LineString', coordinates: [[179, 10], [-179, 12]] }),
  projection: 'equirectangular', width: 720, grid: 'off'
});
same(datelineLine.bounds, [179, 10, 181, 12], 'dateline line bounds');

// Mercator clamps only the far end beyond the limit, and equirectangular keeps the poles.
const clamped = G.render({
  text: JSON.stringify({ type: 'LineString', coordinates: [[0, 84], [10, 89]] }),
  projection: 'mercator', width: 720, grid: 'off'
});
same(clamped.warnings, ['1 position lies beyond \u00b185.05\u00b0 and was clamped for Web Mercator.']);
same(clamped.bounds, [0, 84, 10, 89], 'clamping does not change the reported latitude bounds');
const poles = G.render({
  text: JSON.stringify({ type: 'LineString', coordinates: [[0, -90], [0, 90]] }),
  projection: 'equirectangular', width: 720, grid: 'off'
});
same(poles.warnings, [], 'equirectangular accepts the poles');

// The graticule never exceeds eight intervals on either axis.
for (const span of [0.01, 0.04, 0.3, 2, 8, 30, 90, 180]) {
  const polygon = JSON.stringify({ type: 'Polygon', coordinates: [[[0, -span / 2], [span, -span / 2], [span, span / 2], [0, span / 2], [0, -span / 2]]] });
  const result = G.render({ text: polygon, projection: 'equirectangular', width: 720, grid: 'on' });
  assert.ok(result.graticule.meridians.length <= 9, `meridians for span ${span}: ${result.graticule.meridians.length}`);
  assert.ok(result.graticule.parallels.length <= 9, `parallels for span ${span}: ${result.graticule.parallels.length}`);
  assert.ok(result.graticule.meridians.length >= 1 && result.graticule.parallels.length >= 1, `graticule present for span ${span}`);
}

// A single point is centred and a null geometry is skipped rather than fatal.
const point = G.render({ text: JSON.stringify({ type: 'Point', coordinates: [7, 46] }), width: 400, grid: 'off' });
same(point.screenPositions, [[200, 150]], 'single point centred');
const nullGeometry = G.render({
  text: JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: {}, geometry: null },
    { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } }
  ] }),
  width: 400, grid: 'off'
});
same(nullGeometry.featureCount, 2, 'both features counted');
same(nullGeometry.warnings, ['A feature has no geometry and was skipped.']);

// Refusals name the offending field.
for (const [text, pattern] of [
  [JSON.stringify({ type: 'Point', coordinates: [200, 10] }), /Longitude 200/],
  [JSON.stringify({ type: 'Point', coordinates: [10, 95] }), /Latitude 95/],
  [JSON.stringify({ type: 'LineString', coordinates: [[0, 0]] }), /two positions/],
  [JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }), /three positions/],
]) {
  assert.throws(() => G.render({ text }), pattern);
}

// The standalone SVG carries its namespace, a viewBox, a background and a title, and no script or remote URL.
const svg = squareResult.svg;
assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 480 360"/);
assert.match(svg, /<rect width="480" height="360" fill="#0f172a"\/>/);
assert.match(svg, /<title>GeoJSON map in Equirectangular/);
assert.match(svg, /<path d="M[0-9.]+ [0-9.]+L/);
assert.match(svg, /<\/svg>$/);
assert.ok(!/<script|foreignObject|<image/i.test(svg), 'no script, foreign object or image');
const urls = svg.match(/https?:\/\/[^\s"'<>]+/g) || [];
assert.deepEqual(urls, ['http://www.w3.org/2000/svg'], 'only the SVG namespace URL');

// The summary is copyable prose with both bounds and the projection.
const summary = G.summary(squareResult);
assert.match(summary, new RegExp('10\\u00b0, 53\\u00b0 to 10\\.4\\u00b0, 53\\.5\\u00b0'));
assert.match(summary, /Equirectangular/);

// The slug, name, aliases and tags stay unique against the rest of the catalog.
const others = catalog.tools.filter((tool) => tool.slug !== entry.slug);
const folded = new Set();
for (const tool of others) {
  folded.add(tool.slug);
  folded.add(tool.name.toLowerCase());
  for (const alias of tool.aliases || []) folded.add(alias.toLowerCase());
}
assert.ok(!folded.has(entry.slug), 'slug collides');
assert.ok(!folded.has(entry.name.toLowerCase()), 'name collides');
for (const alias of entry.aliases) assert.ok(!folded.has(alias.toLowerCase()), `alias collides: ${alias}`);
assert.ok(entry.tags.includes('geojson') && entry.tags.includes('svg'));
assert.equal(entry.category, 'Geography');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Geography').length, 56, 'Geography count');
assert.equal(entry.listed, true);
assert.equal(entry.risk, 'low');
assert.ok(entry.sources.length >= 2);
assert.ok(entry.sources.every((source) => source.url && source.url.startsWith('https://')), 'https sources');
assert.ok(entry.sources.some((source) => source.url.includes('rfc7946')), 'RFC 7946 cited');

// Page contract: the shared shell, one labelled form, and no network or dynamic-code sinks.
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.match(html, /href="\/assets\/style\.css"/);
assert.match(html, /href="\/assets\/tool-css\/tool-form-[0-9a-f]+\.css"/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.equal((html.match(/<h1>/g) || []).length, 1);
assert.ok(!/\beval\s*\(/.test(html), 'eval is not allowed');
assert.ok(!/new\s+Function\s*\(/.test(html), 'new Function is not allowed');
assert.ok(!/\.innerHTML\s*=/.test(html), 'innerHTML is not allowed');
assert.ok(!/XMLHttpRequest|fetch\(|sendBeacon|WebSocket/.test(html), 'no network calls');
const pageUrls = (html.match(/https?:\/\/[^\s"'<>]+/g) || []).filter((url) => !url.includes('www.w3.org'));
assert.deepEqual(pageUrls, [], 'page markup is offline');
for (const id of ['in-geojson', 'in-projection', 'in-width', 'in-grid']) {
  assert.ok(html.includes(`for="${id}"`), `label for ${id}`);
  assert.ok(html.includes(`id="${id}"`), `control ${id}`);
}
for (const id of ['err', 'out']) assert.ok(html.includes(`id="${id}"`), `container ${id}`);
assert.ok(!/<button(?![^>]*\btype=)/.test(html), 'every button declares a type');
assert.match(html, /role="alert"/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /new DOMParser\(\)/);

console.log(`geojson map renderer: ${entry.testCases.length} catalog cases replayed`);
