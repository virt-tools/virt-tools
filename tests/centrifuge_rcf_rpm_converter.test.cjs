/* Centrifuge RCF/rpm converter: pin the arithmetic against the SI definition and the
   published rotor-manual form, replay the catalog cases, and check the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'centrifuge-rcf-rpm-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* centrifuge-core:start */');
const end = html.indexOf('/* centrifuge-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, html.indexOf('*/', end) + 2);
vm.runInThisContext(coreText + '\n;globalThis.__centrifugeCore = CentrifugeCore;');
const C = globalThis.__centrifugeCore;

// ---- Independent SI model: omega = 2*pi*n/60, a = omega^2 * r, RCF = a / g0.
const G0 = 9.80665;
const rcf = (rpm, radiusCm) => Math.pow((2 * Math.PI * rpm) / 60, 2) * (radiusCm / 100) / G0;
const rpm = (force, radiusCm) => (Math.sqrt((force * G0) / (radiusCm / 100)) * 60) / (2 * Math.PI);

const run = (mode, value, radius, unit) => C.parse(mode, value, radius, unit);
const failure = (mode, value, radius, unit) => {
  try { run(mode, value, radius, unit); } catch (error) { return error.message; }
  return null;
};

// The Eppendorf 5702 manual's worked example: 13.5 cm at 4,000 rpm is 2,415 x g.
const example = run('rpm', '4000', '135', 'mm');
assert.ok(Math.abs(example.rcf - rcf(4000, 13.5)) < 1e-9, 'default force matches the SI definition');
assert.equal(Math.round(example.rcf), 2415, 'manual example rounds to 2,415 g');
assert.equal(example.rcfText, '2,415 \u00d7 g');
assert.equal(example.primaryText, '2,415 \u00d7 g');
assert.equal(example.equation, '4,000 rpm at r = 13.5 cm gives 2,415 \u00d7 g');
assert.equal(example.radiusText, '135 mm');
assert.equal(example.radiusCmText, '13.5 cm');
assert.ok(Math.abs(example.omega - 2 * Math.PI * 4000 / 60) < 1e-9, 'angular speed');

// ---- The inverse direction returns the speed the force needs.
const reverse = run('rcf', '12000', '85', 'mm');
assert.ok(Math.abs(reverse.rpm - rpm(12000, 8.5)) < 1e-9, 'reverse matches the SI definition');
assert.equal(reverse.rpmText, '11,236 rpm');
assert.equal(reverse.primaryText, '11,236 rpm');
assert.equal(reverse.equation, '12,000 \u00d7 g at r = 8.5 cm needs 11,236 rpm');

// ---- Round trips over radii and forces, including the limits.
for (const radiusMm of [1, 2.5, 7, 13.5, 85, 100, 160, 250, 1000]) {
  for (const speed of [10, 1000, 4000, 12000, 25000, 200000]) {
    if (rcf(speed, radiusMm / 10) > C.MAX_RCF) continue; // outside the published force range
    const there = C.convert('rpm', speed, radiusMm, 'mm');
    const back = C.convert('rcf', there.rcf, radiusMm, 'mm');
    assert.ok(Math.abs(back.rpm - speed) <= speed * 1e-12 + 1e-9,
      `round trip ${speed} rpm at ${radiusMm} mm`);
  }
}

// ---- Unit handling: 5 in is exactly 127 mm, and the units agree at any radius.
const inches = run('rpm', '5000', '5', 'in');
const millimetres = run('rpm', '5000', '127', 'mm');
assert.equal(inches.radiusMm, 127);
assert.ok(Math.abs(inches.rcf - millimetres.rcf) < 1e-9, 'inches and millimetres agree');
assert.equal(inches.radiusText, '5 in');
assert.equal(inches.radiusCmText, '12.7 cm');
const centimetres = C.convert('rpm', 5000, 12.7, 'cm');
assert.ok(Math.abs(centimetres.rcf - inches.rcf) < 1e-9, 'centimetres agree too');
assert.equal(C.unitOf('MM').id, 'mm', 'unit ids are case-insensitive');

// ---- The linear radius dependence the page states.
const narrow = C.convert('rpm', 4000, 10, 'cm');
const wide = C.convert('rpm', 4000, 20, 'cm');
assert.ok(Math.abs(wide.rcf / narrow.rcf - 2) < 1e-12, 'force doubles with radius at fixed speed');

// ---- Formatting: four significant digits, grouped thousands, trimmed zeros.
assert.equal(C.format(0), '0');
assert.equal(C.format(2415.4069), '2,415');
assert.equal(C.format(905.7776), '905.8');
assert.equal(C.format(11.18244), '11.18');
assert.equal(C.format(1234567), '1,234,567');
assert.equal(C.format(0.00001234567), '1.235e-5');

// ---- Limits and refusals.
const message = (mode, value, radius, unit) => failure(mode, value, radius, unit);
assert.equal(message('rpm', '4000', '0.5', 'mm'), 'Enter a rotor radius between 1 mm and 1,000 mm.');
assert.equal(message('rpm', '4000', '1001', 'mm'), 'Enter a rotor radius between 1 mm and 1,000 mm.');
assert.equal(message('rpm', '4000', '0', 'mm'), 'Enter a rotor radius between 1 mm and 1,000 mm.');
assert.equal(message('rpm', '200001', '100', 'mm'), 'Enter a speed of at most 200,000 rpm.');
assert.equal(message('rcf', '5000001', '100', 'mm'), 'Enter a force of at most 5,000,000 \u00d7 g.');
assert.equal(message('rcf', '5000000', '50', 'mm'),
  'That force needs more than 200,000 rpm at this radius; check the radius and the force.');
assert.equal(message('rpm', '200000', '1000', 'mm'),
  'That speed gives more than 5,000,000 \u00d7 g at this radius; check the radius and the speed.');
assert.equal(message('rpm', '', '135', 'mm'), 'Enter a speed or a force to convert.');
assert.equal(message('rpm', 'fast', '135', 'mm'), 'Enter the number as digits, such as 4000 or 12.5.');
assert.equal(message('rpm', '4000', '', 'mm'), 'Enter the rotor radius.');
assert.equal(message('rpm', '4000', 'wide', 'mm'), 'Enter the rotor radius as a number, such as 135.');
assert.equal(message('rpm', '-1', '135', 'mm'), 'Enter a speed of 0 rpm or more.');
assert.equal(message('rcf', '-1', '135', 'mm'), 'Enter a force of 0 \u00d7 g or more.');
assert.equal(message('sideways', '4000', '135', 'mm'), 'Choose a conversion direction.');
assert.equal(run('rpm', '0', '135', 'mm').rcf, 0, 'a stopped rotor is zero force');
assert.equal(run('rpm', '4,000', '135', 'mm').rpm, 4000, 'grouping commas are accepted');

// Every rejection is deterministic and returns the same message twice.
for (const [mode, value, radius, unit] of [
  ['rpm', '4000', '0.5', 'mm'], ['rpm', '4000', '1001', 'mm'], ['rpm', 'fast', '135', 'mm'],
  ['rpm', '200001', '100', 'mm'], ['rcf', '5000001', '100', 'mm'], ['rcf', '5000000', '50', 'mm']
]) {
  assert.equal(message(mode, value, radius, unit), message(mode, value, radius, unit));
}

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.length, 2531, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2270, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Converters').length, 58,
  'Converters count');

const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug is unique');
assert.equal(record.name, 'Centrifuge RCF & RPM Converter');
assert.equal(record.category, 'Converters');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1F9EB}');
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('9.80665'), 'method states standard gravity');
assert.ok(record.method.includes('DIN 58 970'), 'method names the standard');
assert.ok(record.method.includes('200,000 rpm'), 'method states the speed limit');
assert.ok(record.guidance.includes('r_max') && record.guidance.includes('r_av'),
  'guidance names both radius conventions');

assert.ok(record.sources.length >= 2, 'sources are cited');
for (const source of record.sources) {
  assert.ok(source.title.length > 40, 'a source names the document and the part used');
  assert.match(source.url, /^https:\/\//, 'every source has an absolute https URL');
}
assert.ok(record.sources.some((source) => source.url.includes('eppendorf') || source.url.includes('BA_Centrifuge5702')),
  'the Eppendorf rotor manual is cited');
assert.ok(record.sources.some((source) => source.url.includes('wikipedia.org/wiki/Centrifugation')),
  'the centrifugation article is cited');

const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 15, 'catalog case count');
assert.equal(kinds('golden'), 6, 'six golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 5, 'five validation cases');
for (const testCase of record.testCases) {
  const { mode, value, radius, radiusUnit } = testCase.input;
  if (testCase.expectedError) {
    assert.equal(failure(mode, value, radius, radiusUnit), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(mode, value, radius, radiusUnit);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[key], expected, testCase.name + ' ' + key);
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
  assert.equal(keyOwners.get(String(key).toLowerCase()).size, 1, 'duplicate key: ' + key);
}

// ---- Page contract: shared shell, accessible result, no network access.
assert.ok(html.includes('<div id="site-header"></div>'), 'shared header mount');
assert.ok(html.includes('<script src="/assets/app.js"></script>'), 'shared app script');
assert.ok(html.includes('aria-live="polite"'), 'result is announced');
assert.ok(html.includes('role="alert"'), 'errors are announced');
assert.ok(!/\bfetch\s*\(/.test(html), 'no network call');
assert.ok(!/XMLHttpRequest/.test(html), 'no network call');
assert.ok(html.includes('rpm \u2192 \u00d7g') || html.includes('rpm &rarr; &times;g'), 'direction control');
