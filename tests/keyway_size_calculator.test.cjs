/* Keyway and key size calculator: the published DIN 6885-1 table, the band
   lookup, the shop measurements derived from it, the refusals, the catalog
   cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'keyway-size-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* keyway-core:start */';
const endMarker = '/* keyway-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = KeywayCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');

const run = (overrides) => C.calculate(Object.assign({ diameter: '25', unit: 'mm' }, overrides || {}));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};

// ---- The published DIN 6885-1 table, transcribed from the two source pages:
//      shaft band from, band to, key width, key height, depth in the shaft,
//      depth in the hub. All in millimetres.
const published = [
  [6, 8, 2, 2, 1.2, 1.0],
  [8, 10, 3, 3, 1.8, 1.4],
  [10, 12, 4, 4, 2.5, 1.8],
  [12, 17, 5, 5, 3.0, 2.3],
  [17, 22, 6, 6, 3.5, 2.8],
  [22, 30, 8, 7, 4.0, 3.3],
  [30, 38, 10, 8, 5.0, 3.3],
  [38, 44, 12, 8, 5.0, 3.3],
  [44, 50, 14, 9, 5.5, 3.8],
  [50, 58, 16, 10, 6.0, 4.3],
  [58, 65, 18, 11, 7.0, 4.4],
  [65, 75, 20, 12, 7.5, 4.9],
  [75, 85, 22, 14, 9.0, 5.4],
  [85, 95, 25, 14, 9.0, 5.4],
  [95, 110, 28, 16, 10.0, 6.4],
  [110, 130, 32, 18, 11.0, 7.4],
  [130, 150, 36, 20, 12.0, 8.4],
  [150, 170, 40, 22, 13.0, 9.4],
  [170, 200, 45, 25, 15.0, 10.4],
  [200, 230, 50, 28, 17.0, 11.4],
  [230, 260, 56, 32, 20.0, 12.4],
  [260, 290, 63, 32, 20.0, 12.4],
  [290, 330, 70, 36, 22.0, 14.4],
  [330, 380, 80, 40, 25.0, 15.4],
  [380, 440, 90, 45, 28.0, 17.4],
  [440, 500, 100, 50, 31.0, 19.5]
];

assert.equal(C.SECTIONS.length, published.length, 'one row per published band');
C.SECTIONS.forEach((section, index) => {
  const expected = published[index];
  assert.deepEqual([section.from, section.to, section.b, section.h, section.shaft, section.hub], expected,
    'row ' + index + ' matches the published table');
});

// ---- The bands are contiguous from 6 to 500 mm, and the sections grow with the shaft.
assert.equal(C.SECTIONS[0].from, 6);
assert.equal(C.SECTIONS[C.SECTIONS.length - 1].to, 500);
for (let i = 1; i < C.SECTIONS.length; i += 1) {
  assert.equal(C.SECTIONS[i].from, C.SECTIONS[i - 1].to, 'no gap between bands');
  assert.ok(C.SECTIONS[i].to > C.SECTIONS[i].from, 'every band is a real range');
  assert.ok(C.SECTIONS[i].b >= C.SECTIONS[i - 1].b, 'width never shrinks');
  assert.ok(C.SECTIONS[i].h >= C.SECTIONS[i - 1].h, 'height never shrinks');
  assert.ok(C.SECTIONS[i].shaft > C.SECTIONS[i].hub, 'the shaft slot is the deeper of the two');
}
assert.equal(new Set(C.SECTIONS.map((section) => section.to)).size, C.SECTIONS.length, 'every band ends once');

// ---- Every whole millimetre from 6 to 500 falls in exactly one band, and the
//      measured values follow the depths in both directions.
for (let diameter = 6; diameter <= 500; diameter += 1) {
  const result = C.calculate({ diameter, unit: 'mm' });
  const band = C.SECTIONS.filter((section) => diameter <= section.to);
  assert.ok(band.length >= 1, 'a band for ' + diameter + ' mm');
  assert.equal(band[0].b, result.b, 'width for ' + diameter + ' mm');
  assert.equal(band[0].h, result.h, 'height for ' + diameter + ' mm');
  assert.equal(result.shaftMeasure, Math.round((diameter - band[0].shaft) * 1000) / 1000);
  assert.equal(result.hubMeasure, Math.round((diameter + band[0].hub) * 1000) / 1000);
  assert.equal(result.area, band[0].b * band[0].h);
  assert.ok(result.shaftMeasure > 0, 'the shaft keeps a core under the keyway');
  assert.equal(result.band,
    (band[0].from === 6 ? '' : 'over ') + band[0].from + ' to ' + band[0].to + ' mm');
}
// The inch conversion picks the same millimetre band.
for (const inches of [0.25, 0.5, 1, 1.5, 2, 3, 6]) {
  const metric = C.calculate({ diameter: inches * 25.4, unit: 'mm' });
  const imperial = C.calculate({ diameter: inches, unit: 'in' });
  assert.equal(imperial.b, metric.b, 'inch width for ' + inches + ' in');
  assert.equal(imperial.h, metric.h, 'inch height for ' + inches + ' in');
  assert.equal(imperial.band, metric.band, 'inch band for ' + inches + ' in');
  assert.equal(imperial.diameterMm, Math.round(inches * 25.4 * 1000) / 1000);
}

// ---- The worked 25 mm and 30 mm examples.
const first = run();
assert.equal(first.headline, '8 \u00D7 7 mm');
assert.equal(first.summary, 'parallel key for a 25 mm shaft, 4 mm deep in the shaft');
assert.equal(first.shaftDepth, 4);
assert.equal(first.hubDepth, 3.3);
assert.equal(first.shaftMeasure, 21);
assert.equal(first.hubMeasure, 28.3);
assert.equal(first.area, 56);
assert.equal(first.nextBand, 'Above 30 mm the table moves to 10 \u00D7 8 mm (up to 38 mm).');
assert.equal(JSON.stringify(first.warnings), '[]');

const thirty = run({ diameter: 30 });
assert.equal(thirty.headline, first.headline, '30 mm keeps the 22-30 band');
assert.equal(thirty.shaftMeasure, 26);
assert.equal(thirty.hubMeasure, 33.3);
assert.match(thirty.summary, /30 mm shaft/);

const above = run({ diameter: 30.01 });
assert.equal(above.headline, '10 \u00D7 8 mm', 'a hair over 30 mm moves up');
assert.equal(above.shaftMeasure, 25.01);

const largest = run({ diameter: 500 });
assert.equal(largest.headline, '100 \u00D7 50 mm');
assert.equal(largest.nextBand, '', 'no band above the largest');

// ---- Inch input is converted, and the page says so.
const inch = run({ diameter: '1', unit: 'in' });
assert.equal(inch.b, 8);
assert.equal(inch.diameterMm, 25.4);
assert.equal(inch.shaftMeasure, 21.4);
assert.equal(JSON.stringify(inch.warnings),
  JSON.stringify(['DIN 6885 is a metric standard; the inch diameter was converted to millimetres to choose the section.']));
assert.equal(JSON.stringify(run({ diameter: 25 }).warnings), '[]', 'millimetre input carries no conversion note');

// ---- Numeric strings behave like numbers.
assert.equal(JSON.stringify(C.calculate({ diameter: '25', unit: 'mm' })), JSON.stringify(first));

// ---- Refusals.
assert.equal(failure({ diameter: '' }), 'The shaft diameter must be a number.');
assert.equal(failure({ diameter: '25 mm' }), 'The shaft diameter must be a number.');
assert.equal(failure({ diameter: 'abc' }), 'The shaft diameter must be a number.');
assert.equal(failure({ diameter: 5.999 }), 'The shaft diameter must be between 6 and 500 mm (0.236 to 19.685 in).');
assert.equal(failure({ diameter: 500.001 }), 'The shaft diameter must be between 6 and 500 mm (0.236 to 19.685 in).');
assert.equal(failure({ diameter: -25 }), 'The shaft diameter must be between 6 and 500 mm (0.236 to 19.685 in).');
assert.equal(failure({ diameter: 0 }), 'The shaft diameter must be between 6 and 500 mm (0.236 to 19.685 in).');
assert.equal(failure({ diameter: 30, unit: 'in' }), 'The shaft diameter must be between 6 and 500 mm (0.236 to 19.685 in).');
assert.equal(C.MIN_DIAMETER, 6);
assert.equal(C.MAX_DIAMETER, 500);

// ---- Catalog record: counts, cases and metadata.
assert.equal(catalog.tools.length, 2526, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2265, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Mechanical & Structural Engineering').length, 57,
  'Mechanical & Structural Engineering count');
assert.equal(record.category, 'Mechanical & Structural Engineering');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.method.length > 600);
assert.equal(record.sources.length, 2);
assert.equal(record.sources[0].url, 'https://somp.com.lb/engineering/Keyways.shtml');
assert.equal(record.sources[1].url, 'https://fasten.it/en/norms/norm/din_6885-1');
for (const source of record.sources) {
  assert.match(source.title, /DIN 6885/, 'the source title names the standard');
  assert.match(source.url, /^https:\/\//);
}
assert.equal(record.tags.length, new Set(record.tags).size, 'tags are internally unique');
assert.match(record.added, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

const counts = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.equal(record.testCases.length, 17);
assert.equal(counts.golden, 4);
assert.equal(counts.boundary, 7);
assert.equal(counts.validation, 6);

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(JSON.stringify(actual[key]), JSON.stringify(expected), testCase.name + ': ' + key);
  }
}

// ---- Uniqueness across the catalog: no other tool claims this name, alias or slug.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1);
for (const alias of record.aliases) {
  assert.equal(catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase())).length,
  1, 'alias is unique: ' + alias);
}
assert.ok(!catalog.tools.some((tool) => /keyway|parallel key/.test(tool.slug) && tool.slug !== slug),
  'no other keyway tool is filed');

// ---- Page contract.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<meta name="description" content="[^"]+">/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Keyway &amp; Key Size Calculator<\/h1>/);
assert.match(html, /<form id="keyway-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label for="/g) || []).length, 1, 'the diameter field is labelled');
assert.equal((html.match(/<input/g) || []).length, 1);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.equal((html.match(/data-example="/g) || []).length, 4);
assert.equal((html.match(/<tbody id="sections"><\/tbody>/g) || []).length, 1, 'the table body is filled by script');
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function|localStorage|sessionStorage/.test(html),
  'no network calls, no eval, no storage');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored and nothing is sent/i, 'the privacy note stays on the page');
assert.match(html, /min-height:46px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* keyway-core:start \*\//g) || []).length, 1);
assert.match(html, /DIN 6885-1/, 'the page names the standard it follows');

console.log('keyway_size_calculator: all checks passed');
