/* QRD diffuser geometry: the quadratic residue sequence, the well depth scale,
   the half-wavelength clear width, the page parser's refusals, the independent
   fixtures, the catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'qrd-diffuser-designer';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* qrd-diffuser-core:start */';
const endMarker = '/* qrd-diffuser-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = QrdCore;', sandbox);
const C = sandbox.module.exports;

const design = (input) => JSON.parse(JSON.stringify(C.design(input)));
const seq = (wells) => Array.from(C.sequence(wells));
const refused = (input) => {
  try { C.design(input); } catch (error) { return error.message; }
  return null;
};

// ---- The sequence is n^2 mod N: the published rows for the small primes.
assert.deepEqual(seq(5), [0, 1, 4, 4, 1]);
assert.deepEqual(seq(7), [0, 1, 4, 2, 2, 4, 1]);
assert.deepEqual(seq(11), [0, 1, 4, 9, 5, 3, 3, 5, 9, 4, 1]);
assert.deepEqual(seq(13), [0, 1, 4, 9, 3, 12, 10, 10, 12, 3, 9, 4, 1]);
assert.equal(seq(43).length, 43);
for (let n = 0; n < 43; n += 1) assert.equal(seq(43)[n], (n * n) % 43, 'residue ' + n);
assert.equal(seq(7).filter((value) => value === 0).length, 1, 'only well 0 has no depth');

// ---- The well counts the page offers are prime; composites are refused.
for (const prime of [5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43]) {
  assert.equal(C.isPrime(prime), true, prime + ' is prime');
}
for (const composite of [1, 9, 15, 21, 25, 27, 33, 39, 44]) {
  assert.equal(C.isPrime(composite), false, composite + ' is not prime');
}

// ---- The default design: 500 Hz, 2 kHz upper, seven wells.
const base = design({ design: '500', upper: '2000', wells: 7 });
assert.equal(base.wells, 7);
assert.equal(base.speed, 343);
assert.equal(base.designWavelengthMm, 686, '343 m/s over 500 Hz is 686 mm');
assert.equal(base.stepMm, 49, 'lambda0 / (2N) is 49 mm per residue unit');
assert.deepEqual(base.depthsMm, [0, 49, 196, 98, 98, 196, 49]);
for (let n = 0; n < base.wells; n += 1) {
  assert.equal(base.depthsMm[n], base.residues[n] * base.stepMm, 'well ' + n + ' depth');
}
assert.equal(base.maxResidue, 4);
assert.equal(base.maxDepthMm, 196, 'the deepest well follows the largest residue, not (N-1)/2');
assert.equal(base.wellWidthMm, 85.75, 'half a wavelength at the upper frequency');
assert.equal(base.wellWidthMm, (C.speedOfSound / (2 * 2000)) * 1000);
assert.equal(base.panelWidthMm, 600.25, 'seven clear wells of 85.75 mm');
assert.deepEqual(base.warnings, [], 'the default design needs no warning');
assert.equal(base.bandRatio, 4);

// ---- A numeric payload and a string payload agree; the panel tracks the wells.
const numeric = design({ design: 500, upper: 2000, wells: 7 });
assert.equal(numeric.maxDepthMm, base.maxDepthMm);
assert.equal(numeric.wellWidthMm, base.wellWidthMm);
const wide = design({ design: '250', upper: '1000', wells: 13 });
assert.equal(wide.depthsMm.length, 13);
assert.equal(wide.maxResidue, 12, 'for 13 wells the largest residue is 12');
assert.equal(wide.maxDepthMm, 633.23);
assert.ok(Math.abs(wide.panelWidthMm - wide.wells * wide.wellWidthMm) <= 0.25,
  'the panel width is the wells times the clear width, within rounding');

// ---- Warning boundaries: depth 400 mm, width 10 mm and 2,400 mm are not over.
assert.deepEqual(design({ design: '343', upper: '1000', wells: 5 }).warnings, [],
  'a well exactly 400 mm deep does not warn');
assert.equal(design({ design: '342', upper: '1000', wells: 5 }).warnings.length, 1,
  'a well over 400 mm deep warns');
assert.deepEqual(design({ design: '1000', upper: '17150', wells: 7 }).warnings, [],
  'a clear width of exactly 10 mm does not warn');
assert.deepEqual(design({ design: '1000', upper: '17160', wells: 7 }).warnings,
  ['Clear wells under 10 mm are hard to cut consistently; lower the upper frequency for a buildable width.']);
assert.equal(design({ design: '400', upper: '500', wells: 7 }).warnings.length, 1,
  'a 2,401 mm panel warns');
assert.deepEqual(design({ design: '400', upper: '501', wells: 7 }).warnings, [],
  'a 2,396 mm panel does not warn');

// ---- A frequency at the upper limit, and the tightest allowed band.
const top = design({ design: '500', upper: '20000', wells: 7 });
assert.equal(top.wellWidthMm, 8.58);
assert.equal(top.warnings.length, 1, 'wells under 10 mm are called out');
const tight = design({ design: '500', upper: '501', wells: 7 });
assert.equal(tight.bandRatio, 1.002);
assert.equal(tight.wellWidthMm, 342.32);

// ---- The parser refuses rather than guesses.
assert.equal(refused({ design: '', upper: '2000', wells: 7 }),
  'Enter the design frequency from 20 to 8,000 Hz.');
assert.equal(refused({ design: '5oo', upper: '2000', wells: 7 }),
  'Enter the design frequency in hertz as a number, such as 500.');
assert.equal(refused({ design: '10', upper: '2000', wells: 7 }),
  'Enter the design frequency from 20 to 8,000 Hz.');
assert.equal(refused({ design: '9000', upper: '2000', wells: 7 }),
  'Enter the design frequency from 20 to 8,000 Hz.');
assert.equal(refused({ design: '500', upper: '2k', wells: 7 }),
  'Enter the upper frequency in hertz as a number, such as 2000.');
assert.equal(refused({ design: '500', upper: '25000', wells: 7 }),
  'Enter the upper frequency from 40 to 20,000 Hz.');
assert.equal(refused({ design: '500', upper: '500', wells: 7 }),
  'The upper frequency must be above the design frequency.');
assert.equal(refused({ design: '2000', upper: '500', wells: 7 }),
  'The upper frequency must be above the design frequency.');
assert.equal(refused({ design: '500', upper: '2000', wells: 9 }),
  'Choose a prime well count, such as 7, 11 or 13.');
assert.equal(refused({ design: '500', upper: '2000', wells: 47 }),
  'Choose a prime well count up to 43.');

// ---- The independent fixtures: geometry built from the field widths, replayed.
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/qrd_diffuser_cases.json'), 'utf8'));
assert.ok(fixtures.cases.length >= 12, 'the fixture set covers primes, bands and warnings');
for (const item of fixtures.cases) {
  const actual = design(item.input);
  for (const [key, value] of Object.entries(item.expected)) {
    assert.deepEqual(actual[key], value, item.name + ': ' + key);
  }
  assert.equal(actual.depthsMm.length, actual.wells);
  assert.equal(actual.maxDepthMm, Math.max(...actual.depthsMm));
  assert.ok(actual.panelWidthMm >= actual.wellWidthMm, item.name + ': a panel is at least one well wide');
}
const fortyThree = fixtures.cases.find((item) => item.input.wells === 43);
assert.ok(fortyThree, 'the fixture set includes the widest well count the page offers');
assert.equal(fortyThree.expected.residues.length, 43);

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug appears once');
assert.equal(record.name, 'QRD Diffuser Designer');
assert.equal(record.category, 'Audio');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(typeof record.method, 'string', 'method is a plain string');
assert.equal(typeof record.guidance, 'string', 'guidance is a plain string');
assert.ok(record.sources.length >= 3);
for (const source of record.sources) assert.match(source.url, /^https:\/\//);
const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 8, validation: 9 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(refused(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = design(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(actual[key], value, testCase.name + ': ' + key);
  }
}

// ---- Uniqueness across the catalog: name and aliases stay distinct.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
for (const alias of record.aliases) {
  const owners = catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase()));
  assert.deepEqual(owners.map((tool) => tool.slug), [slug], 'alias is unique: ' + alias);
}
for (const tag of record.tags) assert.ok(tag.length > 1);

// ---- Page contract: one self-contained page on the shared shell.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>QRD Diffuser Designer<\/h1>/);
assert.match(html, /<form id="diffuser-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.match(html, /<label for="design">/);
assert.match(html, /<label for="upper">/);
assert.match(html, /<label for="wells">/);
assert.match(html, /<input id="design"[^>]*value="500"/);
assert.match(html, /<input id="upper"[^>]*value="2000"/);
assert.match(html, /<option value="7" selected>7<\/option>/);
assert.equal((html.match(/<option /g) || []).length, 12, 'twelve prime well counts');
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(/.test(html), 'no network calls');
assert.ok(!/<iframe|<img|<canvas|<svg/.test(html), 'no embedded media');
assert.match(html, /aria-hidden="true"/, 'the depth profile is decorative');
assert.match(html, /nothing is sent anywhere else/i, 'the privacy note stays on the page');
assert.equal((html.match(/\/\* qrd-diffuser-core:start \*\//g) || []).length, 1);

console.log('qrd-diffuser-designer: residues, depth scale, half-wavelength widths, warnings, '
  + fixtures.cases.length + ' fixtures, ' + record.testCases.length + ' catalog cases, '
  + 'uniqueness and page contract OK');
