/* Screen printing ink calculator: the mesh geometry against an independent
   channel count in SI units, the published fabric tables, the unit handling,
   the warnings, the refusals, the catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'screen-printing-ink-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* screenprint-core:start */';
const endMarker = '/* screenprint-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = ScreenPrintCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');

const base = {
  countUnit: 'in', meshCount: '156', threadDia: '64', fabricThick: '101',
  printWidth: '200', printHeight: '280', sizeUnit: 'mm', prints: '24', inkDensity: '1.1'
};
const run = (overrides) => C.calculate(Object.assign({}, base, overrides || {}));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};

// ---- An independent model: count the openings in a square metre, multiply by
// the area of one opening and by the cloth thickness, all in metres, then turn
// cubic metres into cubic centimetres. Nothing here shares a line with the
// page's micrometre arithmetic, so a wrong 25400 or a missing squared term
// shows up as a different volume.
function channelVolume(input) {
  const mpi = input.countUnit === 'cm' ? Number(input.meshCount) * 2.54 : Number(input.meshCount);
  const pitchM = 0.0254 / mpi;
  const apertureM = pitchM - Number(input.threadDia) * 1e-6;
  const thickM = Number(input.fabricThick) * 1e-6;
  const openingsPerM2 = 1 / (pitchM * pitchM);
  return openingsPerM2 * apertureM * apertureM * thickM * 1e6;
}

const modelCases = [
  {},
  { meshCount: '110', threadDia: '80', fabricThick: '118' },
  { meshCount: '305', threadDia: '34', fabricThick: '63' },
  { countUnit: 'cm', meshCount: '43', threadDia: '100', fabricThick: '190' },
  { meshCount: '24', threadDia: '120', fabricThick: '210' },
  { meshCount: '230', threadDia: '35', fabricThick: '79.3' }
];
for (const input of modelCases) {
  const merged = Object.assign({}, base, input);
  const got = C.calculate(merged);
  const want = channelVolume(merged);
  assert.ok(Math.abs(got.inkVolume - want) <= 0.06,
    'the ink volume matches the channel count: ' + got.inkVolume + ' vs ' + want.toFixed(3));
  assert.ok(Math.abs(got.openArea - (1 - Number(merged.threadDia) / (25400 /
    (merged.countUnit === 'cm' ? Number(merged.meshCount) * 2.54 : Number(merged.meshCount)))) ** 2 * 100) <= 0.01,
    'the open area is the squared opening to pitch ratio');
  assert.ok(Math.abs(got.inkVolume - (got.openArea / 100) * Number(merged.fabricThick)) <= 0.15,
    'the volume is the open fraction times the caliper');
  assert.equal(got.wetFilm, got.inkVolume,
    'a micrometre of film over a square metre is a cubic centimetre, so the two readings agree');
}

// ---- Published fabric tables. The mesh catalogue lists nominal counts with
// their thread diameter, aperture and open area: 250 mesh with a 40 micrometre
// thread gives a 62 micrometre aperture and 36.8% open area, 230/35 gives 75
// and 46.7%, 300/30 gives 55 and 41.7%, and 500/18 gives 33 and 41.7%. The
// geometric model has to land on those figures at the catalogue's precision.
const publishedRows = [
  { count: 230, thread: 35, aperture: 75, openArea: 46.7 },
  { count: 250, thread: 40, aperture: 62, openArea: 36.8 },
  { count: 300, thread: 30, aperture: 55, openArea: 41.7 },
  { count: 500, thread: 18, aperture: 33, openArea: 41.7 }
];
for (const row of publishedRows) {
  const got = run({ meshCount: String(row.count), threadDia: String(row.thread), fabricThick: '100' });
  assert.equal(Math.round(got.opening), row.aperture,
    'the aperture matches the catalogue for the ' + row.count + ' mesh');
  assert.ok(Math.abs(got.openArea - row.openArea) <= 0.1,
    'the open area matches the catalogue for the ' + row.count + ' mesh: ' + got.openArea);
}

// ---- One catalogue row publishes all four numbers (103 mesh, 80 micrometre
// thread, 166 micrometre aperture, 133 micrometre caliper, 44.1% open area, 58.6
// cm3/m2). The geometric opening is 166.6, so the open area comes out about a
// point above the measured value, which is the crimp the catalogue measures and
// the model leaves out; the volume still follows within a few per cent.
const catalogueRow = run({ meshCount: '103', threadDia: '80', fabricThick: '133' });
assert.ok(Math.abs(catalogueRow.opening - 166) <= 1, 'the nominal aperture lands within a micrometre of the published 166');
assert.ok(Math.abs(catalogueRow.openArea - 44.1) / 44.1 < 0.05, 'the open area is within 5% of the measured 44.1%');
assert.ok(Math.abs(catalogueRow.inkVolume - 58.6) / 58.6 < 0.05, 'the volume is within 5% of the published 58.6');

// ---- The two count units describe the same fabric.
const inInches = run({ meshCount: '156' });
const inCentimetres = run({ countUnit: 'cm', meshCount: '61.42' });
assert.ok(Math.abs(inCentimetres.meshPerInch - 156) <= 0.01, '61.42 per centimetre is 156 per inch');
assert.ok(Math.abs(inCentimetres.openArea - inInches.openArea) <= 0.05, 'the open area is the same fabric');
assert.ok(Math.abs(inCentimetres.inkVolume - inInches.inkVolume) <= 0.1, 'the volume is the same fabric');
assert.ok(Math.abs(inCentimetres.totalMl - inInches.totalMl) <= 0.2, 'the run is the same fabric');

// ---- The same print size in inches and in millimetres is the same job.
const millimetres = run({});
const inches = run({ printWidth: '7.874015748', printHeight: '11.023622047', sizeUnit: 'in' });
assert.ok(Math.abs(inches.areaM2 - millimetres.areaM2) < 1e-5, 'the area converts');
assert.equal(inches.inkPerPrintMl, millimetres.inkPerPrintMl);

// ---- The run scales with the print count and the density.
const single = run({ prints: '1' });
const ten = run({ prints: '10' });
assert.ok(Math.abs(ten.totalMl - single.totalMl * 10) <= 0.2, 'ten prints need ten times the ink');
assert.ok(Math.abs(ten.totalG - ten.totalMl * 1.1) <= 0.6, 'grams follow the density');

// ---- Warnings.
assert.ok(run({ meshCount: '500', threadDia: '49', fabricThick: '80' }).warnings
  .some((text) => /Under 20% open area/.test(text)), 'a nearly closed mesh is called out');
assert.ok(run({ meshCount: '24', threadDia: '120', fabricThick: '210' }).warnings
  .some((text) => /Over 60% open area/.test(text)), 'a coarse mesh is called out');
assert.ok(run({ prints: '1000', printWidth: '300', printHeight: '400' }).warnings
  .some((text) => /more than a litre/.test(text)), 'a large run is called out');
assert.equal(run({}).warnings.length, 0, 'a routine tee print is quiet');

// ---- Refusals.
assert.equal(failure({ meshCount: '' }), 'Enter the mesh count in threads per inch.');
assert.equal(failure({ countUnit: 'cm', meshCount: '' }), 'Enter the mesh count in threads per centimetre.');
assert.equal(failure({ meshCount: '9' }), 'The mesh count must be between 10 and 500 threads per inch.');
assert.equal(failure({ countUnit: 'cm', meshCount: '3' }), 'The mesh count must be between 4 and 200 threads per centimetre.');
assert.equal(failure({ threadDia: '5' }), 'The thread diameter must be between 10 and 400 micrometres.');
assert.equal(failure({ fabricThick: '10' }), 'The fabric thickness must be between 20 and 1000 micrometres.');
assert.equal(failure({ threadDia: '163' }),
  'The thread diameter must be smaller than the 162.8 micrometre pitch of this mesh; at this count the threads leave no opening.');
assert.equal(failure({ printHeight: '2001' }), 'The print height must be between 1 and 2000 millimetres.');
assert.equal(failure({ sizeUnit: 'in', printWidth: '80' }),
  'The print width must be between 0.04 and 78.74 inches.');
assert.equal(failure({ prints: '0' }), 'The number of prints must be a whole number from 1 to 100000.');
assert.equal(failure({ prints: '100001' }), 'The number of prints must be a whole number from 1 to 100000.');
assert.equal(failure({ inkDensity: '2.1' }), 'The ink density must be between 0.8 and 2.0 grams per millilitre.');
assert.equal(failure({ sizeUnit: 'furlong' }), 'Choose millimetres or inches for the print size.');
const nothing = (value) => {
  try {
    C.calculate(value);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};
assert.equal(nothing(null), 'Nothing to calculate.');
assert.equal(nothing('156 mesh'), 'Nothing to calculate.');
assert.equal(C.UM_PER_INCH, 25400);
assert.equal(C.MAX_PRINTS, 100000);

// ---- Catalog record: counts, cases and metadata.
assert.equal(catalog.tools.length, 2527, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2266, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Crafts & Hobbies').length, 58,
  'Crafts & Hobbies count');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.method.length > 900, 'the method note carries the formulas and the exclusions');
assert.ok(/25400/.test(record.method) && /open area/i.test(record.method));
assert.equal(record.sources.length, 3);
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'every source has a fetched https url');
  assert.ok(source.title.length > 60, 'the citation keeps its wording');
}

const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 5, boundary: 5, validation: 6 });

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

// ---- Uniqueness across the catalog.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
for (const alias of record.aliases) {
  assert.equal(catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase())).length,
  1, 'alias is unique: ' + alias);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && /screen-print|silkscreen/.test(tool.slug)),
  'no other screen printing tool exists');
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && (tool.tags || []).some((tag) => /screen-print|silkscreen/.test(tag))),
  'no other tool carries the screen printing tag');
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug &&
  /theoretical ink volume|mesh opening/i.test((tool.description || '') + ' ' + (tool.method || ''))),
  'no other page computes the mesh open area or the theoretical ink volume');

// ---- Page contract.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Screen Printing Ink Calculator<\/h1>/);
assert.match(html, /<form id="ink-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label for="/g) || []).length, 9, 'every control is labelled');
assert.equal((html.match(/<input/g) || []).length, 7);
assert.equal((html.match(/<select/g) || []).length, 2);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.equal((html.match(/data-example="/g) || []).length, 3);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function|localStorage|sessionStorage/.test(html),
  'no network calls, no eval, no storage');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored and nothing is sent/i, 'the privacy note stays on the page');
assert.match(html, /min-height:46px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* screenprint-core:start \*\//g) || []).length, 1);
assert.equal((html.match(/\/\* screenprint-core:end \*\//g) || []).length, 1);

const ids = ['ink-form', 'countUnit', 'meshCount', 'threadDia', 'fabricThick', 'printWidth',
  'printHeight', 'sizeUnit', 'prints', 'inkDensity', 'err', 'out'];
for (const id of ids) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}

console.log('screen printing ink calculator OK: ' + record.testCases.length +
  ' catalog cases, the SI channel count, the published fabric tables, unit handling, ' +
  'the run scaling, warnings, refusals, uniqueness and page contract OK');
