/* Regression checks for the latitude/longitude degree-length core, its catalog
   cases and the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'lat-lon-degree-length-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* degree-length-core:start */');
const end = html.indexOf('/* degree-length-core:end */');
assert.ok(start > -1 && end > start, 'degree core markers missing');
const core = html.slice(start, end + '/* degree-length-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = DegreeLengthCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.analyze(input));

// Documented constants.
assert.equal(C.STEPS, 64);
assert.deepEqual(plain(C.TABLE_LATITUDES), [0, 15, 30, 45, 60, 75, 90]);
assert.deepEqual(plain(C.ellipsoids()), ['wgs84', 'grs80', 'airy1830', 'clarke1866', 'bessel1841', 'intl1924']);
assert.equal(C.MESSAGES.range, 'Latitude must be between -90 and 90 degrees.');

// Textbook values: the equator and the poles.
const equator = run({ latitude: '0', ellipsoid: 'wgs84' });
assert.ok(Math.abs(equator.latDegree - 110574.304) < 0.01, 'equator degree of latitude ' + equator.latDegree);
assert.ok(Math.abs(equator.lonDegree - 111319.491) < 0.01, 'equator degree of longitude ' + equator.lonDegree);
assert.ok(Math.abs(equator.ratio - 1.006739) < 1e-6, 'equator ratio ' + equator.ratio);
assert.equal(equator.ellipsoidLabel, 'WGS 84');
assert.equal(equator.a, 6378137);
assert.equal(equator.invF, 298.257223563);
assert.ok(Math.abs(equator.meridionalRadius - 6335439.327) < 0.05, 'equator M ' + equator.meridionalRadius);
assert.ok(Math.abs(equator.primeVerticalRadius - 6378137) < 0.001, 'equator N ' + equator.primeVerticalRadius);

const mid = run({ latitude: '45', ellipsoid: 'wgs84' });
assert.ok(Math.abs(mid.latDegree - 111131.778) < 0.01, '45 degree of latitude ' + mid.latDegree);
assert.ok(Math.abs(mid.lonDegree - 78846.835) < 0.01, '45 degree of longitude ' + mid.lonDegree);
assert.ok(Math.abs(mid.meridionalRadius - 6367381.816) < 0.5, '45 M ' + mid.meridionalRadius);

const pole = run({ latitude: '90', ellipsoid: 'wgs84' });
assert.equal(pole.lonDegree, 0);
assert.equal(pole.ratio, 0);
assert.ok(Math.abs(pole.latDegree - 111693.865) < 0.01, 'pole degree of latitude ' + pole.latDegree);
assert.ok(Math.abs(pole.meridionalRadius - 6399593.626) < 0.05, 'pole M ' + pole.meridionalRadius);

// Minutes and seconds are the same integral over a narrower span.
assert.ok(Math.abs(mid.latMinute * 60 - mid.latDegree) < 1e-3, 'minute and degree latitudes disagree');
assert.ok(Math.abs(mid.lonSecond * 3600 - mid.lonDegree) < 1e-3, 'second and degree longitudes disagree');
assert.ok(mid.latSecond > 30 && mid.latSecond < 31, 'a second of latitude is about 30.9 m: ' + mid.latSecond);

// Longitude always shrinks as latitude grows, and vanishes only at the poles.
let previous = Infinity;
for (const row of C.referenceTable('wgs84')) {
  assert.ok(row.lonDegree <= previous, 'longitude arc grew at ' + row.latitude);
  previous = row.lonDegree;
}
const table = C.referenceTable('wgs84');
assert.equal(table.length, 7);
assert.equal(table[6].lonDegree, 0);
assert.equal(table[0].latitude, 0);
assert.ok(table[3].ratio > 0.7 && table[3].ratio < 0.71, 'ratio at 45 degrees');

// Older ellipsoids move the arcs by hundreds of metres, not kilometres.
const airy = run({ latitude: '51.4779', ellipsoid: 'airy1830' });
const wgs = run({ latitude: '51.4779', ellipsoid: 'wgs84' });
assert.ok(Math.abs(airy.latDegree - wgs.latDegree) > 5 && Math.abs(airy.latDegree - wgs.latDegree) < 300,
  'Airy 1830 should differ slightly at London');
assert.ok(airy.lonDegree < wgs.lonDegree, 'Airy 1830 longitude should be shorter at London');
assert.equal(airy.ellipsoidLabel, 'Airy 1830');

// The parser accepts the three usual notations, in both hemispheres.
const closeTo = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9,
  label + ': ' + actual + ' vs ' + expected);
closeTo(run({ latitude: "51\u00b028'40\"N", ellipsoid: 'wgs84' }).latitude, 51 + 28 / 60 + 40 / 3600, 'DMS');
closeTo(run({ latitude: '51 28.5 N', ellipsoid: 'wgs84' }).latitude, 51 + 28.5 / 60, 'decimal minutes');
closeTo(run({ latitude: '67.5 N', ellipsoid: 'wgs84' }).latitude, 67.5, 'hemisphere letter');
closeTo(run({ latitude: '12.25 s', ellipsoid: 'wgs84' }).latitude, -12.25, 'lowercase south');
closeTo(run({ latitude: '-33.8688', ellipsoid: 'wgs84' }).latitude, -33.8688, 'signed decimal');
closeTo(C.parseLatitude('0'), 0, 'zero');
assert.equal(run({ latitude: '0', ellipsoid: 'wgs84' }).latitude, 0);

// Validation: each refusal names the problem.
const bad = (input, pattern) => assert.throws(() => C.analyze(input), pattern);
bad({ latitude: '', ellipsoid: 'wgs84' }, /Enter a latitude between 0 and 90 degrees\./);
bad({ latitude: '   ', ellipsoid: 'wgs84' }, /Enter a latitude between 0 and 90 degrees\./);
bad({ latitude: 'north', ellipsoid: 'wgs84' }, /Enter a latitude such as 51\.4779, 51\.4779 N or 51 28 40 N\./);
bad({ latitude: '51.4.2', ellipsoid: 'wgs84' }, /Enter a latitude such as/);
bad({ latitude: '91', ellipsoid: 'wgs84' }, /Latitude must be between -90 and 90 degrees\./);
bad({ latitude: '-90.5', ellipsoid: 'wgs84' }, /Latitude must be between -90 and 90 degrees\./);
bad({ latitude: '51 61 N', ellipsoid: 'wgs84' }, /Minutes must be a number below 60\./);
bad({ latitude: '51 30 61 N', ellipsoid: 'wgs84' }, /Seconds must be a number below 60\./);
bad({ latitude: '-33 S', ellipsoid: 'wgs84' }, /A minus sign and N or S disagree; use one or the other\./);
bad({ latitude: '51.4 E', ellipsoid: 'wgs84' }, /Latitude uses N or S, not E or W\./);
bad({ latitude: 'N51.4S', ellipsoid: 'wgs84' }, /Use N or S once\./);
bad({ latitude: '51.4779', ellipsoid: 'clarke1880' }, /Choose a known ellipsoid\./);
bad({ latitude: '51.4779', ellipsoid: '' }, /Choose a known ellipsoid\./);

// A polar window keeps its full width instead of losing length.
assert.equal(run({ latitude: '89.9999', ellipsoid: 'wgs84' }).latDegree,
  run({ latitude: '90', ellipsoid: 'wgs84' }).latDegree);
assert.ok(run({ latitude: '-90', ellipsoid: 'wgs84' }).latDegree > 111600, 'south pole degree of latitude');
assert.ok(run({ latitude: '89.9999', ellipsoid: 'wgs84' }).lonDegree > 0, 'longitude just below the pole');

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="degree-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/role="alert"/.test(html), 'errors are announced as alerts');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/type="text" id="latitude"/.test(html), 'latitude is a text field');
for (const control of ['latitude', 'ellipsoid']) {
  assert.ok(new RegExp(`<label class="f" for="${control}">`).test(html), `${control} is labelled`);
}
assert.ok(/min-height:44px/.test(html), 'controls keep a 44 px target');
assert.ok(/<table id="reference">/.test(html), 'page shows the reference table');
assert.ok(/<tbody id="reference-body">/.test(html), 'table body is addressable');
assert.ok(/<html lang=/.test(html) && /name="viewport"/.test(html), 'page has language and viewport');
assert.ok(/<h1>Latitude &amp; Longitude Degree Length Calculator<\/h1>/.test(html), 'page has its heading');
assert.ok(/<caption>/.test(html), 'table has a caption');

// Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Latitude & Longitude Degree Length Calculator');
assert.equal(record.category, 'Geography');
assert.equal(record.subcategory, 'Coordinates');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(/no storage, uploads or network access/.test(record.method), 'method documents local limits');
assert.ok(/Simpson/.test(record.method), 'method states the integration');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 26, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 8, 'eight boundary cases');
assert.equal(kinds('validation'), 10, 'ten validation cases');

const flatten = (result) => ({
  latitude: result.latitude,
  a: result.a,
  invF: result.invF,
  meridionalRadius: result.meridionalRadius,
  primeVerticalRadius: result.primeVerticalRadius,
  latDegree: result.latDegree,
  latMinute: result.latMinute,
  latSecond: result.latSecond,
  lonDegree: result.lonDegree,
  lonMinute: result.lonMinute,
  lonSecond: result.lonSecond,
  ratio: result.ratio
});

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let checked = 0;
for (const testCase of record.testCases) {
  const { expected } = testCase;
  if (expected.error) {
    assert.throws(() => C.analyze(testCase.input), new RegExp(escape(expected.error)), testCase.name);
    continue;
  }
  const actual = flatten(run(testCase.input));
  for (const [key, value] of Object.entries(expected)) {
    const tolerance = Math.max(Math.abs(value) * 1e-9, 1e-9);
    assert.ok(Math.abs(actual[key] - value) <= tolerance,
      `${testCase.name}.${key}: ${actual[key]} vs ${value}`);
    checked += 1;
  }
}

console.log('lat-lon-degree-length-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + checked + ' numeric fields)');
