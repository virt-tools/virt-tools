/* Time dilation calculator: the Lorentz factor, the traveller's proper time,
   the analytic anchors, precision near c, the formatter, catalog replay and the
   page contract. The catalog goldens come from an independent Python model. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'time-dilation-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* time-dilation-core:start */';
const endMarker = '/* time-dilation-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = TimeDilationCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (percent, distance) => plain(C.compute({ percent, distance }));
const failure = (percent, distance) => {
  try { run(percent, distance); } catch (error) { return error.message; }
  return null;
};
const close = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * tolerance,
    `${label}: ${actual} != ${expected}`);

// ---- Constants and defaults.
assert.equal(C.KM_PER_SECOND, 299792.458);
assert.equal(C.DEFAULT_PERCENT, '90');
assert.equal(C.DEFAULT_DISTANCE, '4.24');

// ---- The formatter: six significant digits, trailing zeros dropped.
assert.equal(C.significant(2.2941573387, 6), '2.29416');
assert.equal(C.significant(0.5, 6), '0.5');
assert.equal(C.significant(2, 6), '2');
assert.equal(C.significant(1, 6), '1');
assert.equal(C.significant(0, 6), '0');
assert.equal(C.significant(-3.14159265, 6), '-3.14159');
assert.equal(C.significant(424000, 6), '424000');
assert.equal(C.significant(1.2345678e6, 6), '1.23457e6');
assert.equal(C.significant(0.000123456789, 6), '0.000123457');

// ---- Analytic anchors: gamma is 2 at beta = sqrt(3)/2, sqrt(2) at 1/sqrt(2),
//      1.25 at 0.6, and exactly 1 in the Newtonian limit.
close(run(100 * Math.sqrt(3) / 2, 1).gamma, 2, 1e-12, 'gamma at sqrt(3)/2');
close(run(100 / Math.sqrt(2), 1).gamma, Math.SQRT2, 1e-12, 'gamma at 1/sqrt(2)');
close(run(60, 10).gamma, 1.25, 1e-15, 'gamma at 0.6c');
close(run(0.0001, 1).gamma, 1, 1e-9, 'gamma at walking pace');

// ---- The default case: 4.24 ly at 90% of c.
const base = run('90', '4.24');
close(base.beta, 0.9, 1e-15, 'beta');
close(base.gamma, 1 / Math.sqrt(1 - 0.81), 1e-12, 'gamma');
close(base.earthYears, 4.24 / 0.9, 1e-12, 'Earth-frame time');
close(base.travellerYears, (4.24 / 0.9) / base.gamma, 1e-12, 'traveller time');
close(base.contractedLy, 4.24 / base.gamma, 1e-12, 'contracted distance');
close(base.speedKmS, 0.9 * 299792.458, 1e-12, 'speed');
assert.equal(base.travellerText, '2.05353 years');
assert.equal(base.earthText, '4.71111 years');
assert.equal(base.distanceText, '1.84817 light-years');
assert.equal(base.speedText, '269,813 km/s');
assert.equal(base.gammaText, '2.29416');
assert.match(base.subText, /traveller's clock reads 2\.05353 years/);

// ---- Identities over a sweep of speeds and distances.
for (let step = 1; step <= 90; step += 1) {
  const percent = step;
  for (const distance of [0.01, 1, 4.24, 1000]) {
    const r = run(percent, distance);
    close(r.earthYears * r.beta, distance, 1e-12, 'distance = beta c t');
    close(r.travellerYears * r.gamma, r.earthYears, 1e-12, 'proper time = Earth time / gamma');
    close(r.contractedLy * r.gamma, distance, 1e-12, 'contracted distance times gamma');
    close(r.gamma * r.gamma * (1 - r.beta * r.beta), 1, 1e-12, 'gamma^2 (1 - beta^2) = 1');
    assert.ok(r.travellerYears < r.earthYears, 'the traveller always ages less');
    assert.ok(r.contractedLy < distance, 'the crew always measures a shorter distance');
  }
}

// ---- Monotonicity: gamma grows with speed, proper time shrinks at fixed distance.
let lastGamma = 1;
let lastTraveller = Infinity;
for (let percent = 1; percent < 100; percent += 1) {
  const r = run(percent, 1);
  assert.ok(r.gamma > lastGamma, `gamma rises at ${percent}%`);
  assert.ok(r.travellerYears < lastTraveller, `traveller time falls at ${percent}%`);
  lastGamma = r.gamma;
  lastTraveller = r.travellerYears;
}

// ---- Precision close to c: (1 - b)(1 + b) keeps the digits that 1 - b^2 loses.
const fast = run(99.999999, 4.24);
assert.ok(Math.abs(fast.gamma - 1 / Math.sqrt(2e-8)) / fast.gamma < 1e-8, 'gamma at five nines');
assert.ok(fast.gamma > 7000 && fast.gamma < 7100, 'gamma is about 7,071');
assert.equal(fast.speedText, '299,792 km/s');
assert.ok(run(99.99999999999, 4.24).gamma > 1e6, 'gamma keeps climbing past a million');

// ---- Typed input: numbers, surrounding spaces and thousands separators.
assert.equal(run(90, 4.24).travellerText, base.travellerText, 'numeric input');
assert.equal(run(' 90 ', ' 4.24 ').travellerText, base.travellerText, 'trimmed input');
const grouped = run('42', '1,000');
assert.equal(grouped.distance, 1000, 'commas are thousands separators');
close(grouped.earthYears, 1000 / 0.42, 1e-12, 'grouped distance time');
assert.equal(run('0.5', '1').speedText, '1,499 km/s');
assert.equal(run('0.0001', '0.01').speedText, '300 m/s');
assert.equal(run('0.0001', '0.01').travellerText, '10000 years', 'large times print in full');

// ---- Refusals.
assert.equal(failure('', '4.24'), 'Enter a speed as a percentage of the speed of light.');
assert.equal(failure('   ', '4.24'), 'Enter a speed as a percentage of the speed of light.');
assert.equal(failure('ninety', '4.24'), 'Enter the speed as a number, such as 90.');
assert.equal(failure('9 0', '4.24'), 'Enter the speed as a number, such as 90.');
assert.equal(failure('0', '4.24'), 'Enter a speed above 0% of the speed of light.');
assert.equal(failure('-10', '4.24'), 'Enter a speed above 0% of the speed of light.');
assert.equal(failure('100', '4.24'), 'A speed of 100% of c or more is impossible; enter less than 100.');
assert.equal(failure(100, 4.24), 'A speed of 100% of c or more is impossible; enter less than 100.');
assert.equal(failure('150', '4.24'), 'A speed of 100% of c or more is impossible; enter less than 100.');
assert.equal(failure('90', ''), 'Enter the trip distance in light-years.');
assert.equal(failure('90', 'far'), 'Enter the distance as a number, such as 4.24.');
assert.equal(failure('90', '0'), 'Enter a distance greater than 0 light-years.');
assert.equal(failure('90', '-1'), 'Enter a distance greater than 0 light-years.');
assert.equal(failure('90', 'Infinity'), 'Enter the distance as a number, such as 4.24.');

// ---- Rows carry the same figures as the named fields.
assert.deepEqual(base.rows.map((row) => row.k), [
  'Lorentz factor (\u03b3)', 'Time on Earth', "Traveller's elapsed time",
  'Distance measured on board', 'Speed',
]);
assert.deepEqual(base.rows.map((row) => row.v), [
  base.gammaText, base.earthText, base.travellerText, base.distanceText, base.speedText,
]);

// ---- Catalog: totals, the record and every case replayed.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2531, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2270, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Time').length, 58, 'Time count');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Time Dilation Calculator');
assert.equal(record.category, 'Time');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.icon, '\u{1f680}');
assert.ok(record.tags.includes('relativity'));
assert.ok(record.aliases.includes('Lorentz Factor Calculator'));
assert.ok(record.description.length > 90, 'description is descriptive');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('1 - b squared'), 'method explains the precision choice');
assert.ok(record.method.includes('gravitational time dilation'), 'method states the limits');
assert.equal(record.sources.length, 2, 'two sources');
for (const source of record.sources) assert.match(source.url, /^https?:\/\//);

const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 21, 'catalog case count');
assert.equal(kinds('golden'), 11, 'eleven golden cases');
assert.equal(kinds('validation'), 10, 'ten validation cases');
for (const testCase of record.testCases) {
  const { percent, distance } = testCase.input;
  if (testCase.expectedError) {
    assert.equal(failure(percent, distance), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = run(percent, distance);
  const expected = testCase.expected;
  for (const key of ['gamma', 'earthYears', 'travellerYears', 'contractedLy', 'speedKmS']) {
    close(actual[key], expected[key], 1e-12, `${testCase.name} ${key}`);
  }
  for (const key of ['gammaText', 'earthText', 'travellerText', 'distanceText', 'speedText', 'subText']) {
    assert.equal(actual[key], expected[key], `${testCase.name} ${key}`);
  }
}

// ---- The new name, slug and aliases collide with no other record.
const others = catalog.tools.filter((tool) => tool.slug !== slug);
const otherKeys = new Set();
for (const tool of others) {
  otherKeys.add(tool.slug);
  otherKeys.add(tool.name.toLowerCase());
  for (const alias of tool.aliases) otherKeys.add(alias.toLowerCase());
}
assert.equal(otherKeys.has('lorentz factor calculator'), false, 'the new alias is free');
for (const key of [slug, record.name.toLowerCase(), ...record.aliases.map((alias) => alias.toLowerCase())]) {
  assert.ok(!otherKeys.has(key), `duplicate key ${key}`);
}

// ---- Page contract.
assert.match(html, /<title>Time Dilation Calculator/);
assert.match(html, /<meta name="description" content="[^"]{40,}">/);
assert.match(html, /<script src="\/assets\/theme-init\.js"><\/script>/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<label for="percent">Speed \(% of the speed of light\)<\/label>/);
assert.match(html, /<label for="distance">Trip distance \(light-years\)<\/label>/);
assert.match(html, /id="err" role="alert" aria-live="polite"/);
assert.match(html, /id="out" aria-live="polite" aria-atomic="true"/);
assert.match(html, /nothing is sent or stored/);
assert.ok(!/class="back"|All tools/.test(html), 'the shell owns the back link');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html.replace(/<meta name="description"[^>]*>/g, '')),
  'the page itself makes no outbound reference');

console.log('time dilation calculator: all checks passed');
