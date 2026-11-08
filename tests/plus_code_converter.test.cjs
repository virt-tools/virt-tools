/* Regression checks for the Plus Code (Open Location Code) core, its catalog
   cases, the published examples and the geometry the page reports. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'plus-code-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* plus-code-core:start */');
const end = html.indexOf('/* plus-code-core:end */');
assert.ok(start > -1 && end > start, 'plus code core markers missing');
const core = html.slice(start, end + '/* plus-code-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PlusCodeCore;', sandbox);
const C = sandbox.module.exports;
const run = (input) => C.calculate(input);
const close = (actual, expected, label, eps = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= eps,
    `${label}: expected ${expected}, got ${actual}`);
};

// Published examples from Google's Open Location Code documentation.
assert.equal(C.encode(47.365590, 8.524997, 10), '8FVC9G8F+6X', 'Zurich example');
assert.equal(C.encode(0, 0, 10), '6FG22222+22', 'equator and prime meridian example');
assert.equal(C.ALPHABET, '23456789CFGHJMPQRVWX', 'code alphabet');
for (const missing of ['0', '1', 'I', 'L', 'O', 'U']) {
  assert.ok(C.ALPHABET.indexOf(missing) === -1, `alphabet must omit ${missing}`);
}

// The first pair is defined directly by the 20-degree cells.
const firstPair = (lat, lon) => C.ALPHABET.charAt(Math.floor((lat + 90) / 20))
  + C.ALPHABET.charAt(Math.floor((lon + 180) / 20));
assert.equal(firstPair(51.5074, -0.1278), C.encode(51.5074, -0.1278, 8).slice(0, 2));
assert.equal(firstPair(-33.86, 151.2), C.encode(-33.86, 151.2, 8).slice(0, 2));

// The default London page values, and the separator placement for each length.
assert.equal(C.encode(51.5074, -0.1278, 8), '9C3XGV4C+');
assert.equal(C.encode(51.5074, -0.1278, 10), '9C3XGV4C+XV');
assert.equal(C.encode(51.5074, -0.1278, 11), '9C3XGV4C+XV4');
for (const length of [8, 10, 11]) {
  const code = C.encode(51.5074, -0.1278, length);
  assert.equal(code.indexOf('+'), 8, `${length}-character code separator`);
  assert.equal(code.replace('+', '').length, length, `${length}-character code length`);
}

// Cell size follows the documented resolutions.
const sizes = {
  8: [0.0025, 0.0025],
  10: [0.000125, 0.000125],
  11: [0.000125 / 5, 0.000125 / 4]
};
for (const length of [8, 10, 11]) {
  const area = C.decode(C.encode(-12.5, 130.25, length));
  close(area.north - area.south, sizes[length][0], `${length}-character latitude span`, 1e-12);
  close(area.east - area.west, sizes[length][1], `${length}-character longitude span`, 1e-12);
}

// A single core test independent of the encoder: decode a known code by hand.
const known = C.decode('8FVC9G8F+6X');
close(known.south, 47.3655, 'Zurich code south edge');
close(known.north, 47.365625, 'Zurich code north edge');
close(known.west, 8.524875, 'Zurich code west edge');
close(known.east, 8.525, 'Zurich code east edge');
close(known.centreLat, 47.3655625, 'Zurich code centre latitude', 1e-9);
close(known.centreLon, 8.5249375, 'Zurich code centre longitude', 1e-9);

// Round trips and containment across the ranges, including the eleventh character.
let seed = 20261108;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
let referenceCases = 0;
for (let index = 0; index < 1500; index++) {
  const latitude = random() * 178 - 89;
  const longitude = random() * 358 - 179;
  for (const length of [8, 10, 11]) {
    const code = C.encode(latitude, longitude, length);
    const area = C.decode(code);
    assert.ok(latitude >= area.south - 1e-9 && latitude <= area.north + 1e-9,
      `latitude ${latitude} outside ${code}`);
    assert.ok(longitude >= area.west - 1e-9 && longitude <= area.east + 1e-9,
      `longitude ${longitude} outside ${code}`);
    assert.equal(C.encode(area.centreLat, area.centreLon, length), code,
      `centre of ${code} re-encodes to the same code`);
    // A short code shortened at its own point recovers the same full code.
    const short = C.shorten(code, latitude, longitude);
    assert.ok(code.endsWith(short), `${short} is a suffix of ${code}`);
    assert.equal(C.recoverNearest(short, latitude, longitude), code,
      `short code ${short} recovered at its own point`);
    referenceCases += 1;
  }
}

// A reference point in the same cell recovers a short code across all lengths.
for (const length of [8, 10, 11]) {
  const area = C.decode(C.encode(48.85822, 2.2945, length));
  const short = C.shorten(C.encode(48.85822, 2.2945, length), 48.85822, 2.2945);
  assert.equal(C.recoverNearest(short, area.centreLat, area.centreLon),
    C.encode(48.85822, 2.2945, length), `${length}-character short code near its centre`);
}

// Poles, antimeridian and normalisation behave as documented.
assert.equal(C.encode(-90, -180, 10), '22222222+22');
assert.equal(C.encode(90, 180, 10), 'C2X2X2X2+X2');
const pole = C.decode(C.encode(90, 180, 10));
assert.ok(pole.north <= 90 + 1e-9, 'pole code stays inside the map');
assert.equal(C.encode(0, 359.5, 10), C.encode(0, -0.5, 10), 'longitude 359.5 wraps to -0.5');
assert.equal(C.encode(0, -180, 10), C.encode(0, 180, 10), 'longitude 180 reads as -180');

// Validity rules.
assert.ok(C.isValid('8FVC9G8F+6X'));
assert.ok(C.isValid(' 8fvc9g8f+6x '), 'case and surrounding spaces are ignored');
assert.ok(C.isFull('8FVC9G8F+'));
assert.ok(C.isFull('8FVC9G8F+6X4'), 'a code with a second grid character is still full');
assert.equal(C.decode('8FVC9G8F+6X4').codeLength, 11, 'grid characters count toward the code length');
assert.ok(C.isShort('+6X'));
assert.ok(C.isShort('9G8F+6X'));
assert.ok(!C.isValid('8FVC9G8F'), 'a separator is required');
assert.ok(!C.isValid('8FVC9G8F+6O'), 'O is not in the alphabet');
assert.ok(!C.isValid('8FVC9G8F++6X'), 'only one separator');
assert.ok(!C.isShort('8FVC9G8F+6X'), 'a full code is not short');

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="enc-form"/.test(html), 'page has an encode form');
assert.ok(/<form id="dec-form"/.test(html), 'page has a decode form');
assert.ok(/type="submit"/.test(html), 'page has submit buttons');
assert.ok(/role="tab"/.test(html), 'page exposes the two directions as tabs');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Plus Code Converter');
assert.equal(record.category, 'Geography');
assert.equal(record.subcategory, 'Coordinates');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.testCases.length >= 20, 'catalog has the full test case set');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10, 'ten golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 5, 'five boundary cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 13, 'thirteen validation cases');
for (const testCase of record.testCases) {
  if (testCase.expected && testCase.expected.error) {
    assert.throws(
      () => C.calculate(testCase.input),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') {
      close(result[key], value, testCase.name + ' ' + key);
    } else {
      assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

console.log('plus-code-converter: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + referenceCases + ' reference cases)');
