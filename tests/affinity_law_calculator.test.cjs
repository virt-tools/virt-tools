/* Regression checks for the Fan & Pump Affinity Law Calculator: the catalog cases,
   an independent exact-rational scaling model, the law invariants, the page
   contract and catalog integrity. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'affinity-law-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* affinity-law-core:start */';
const endMarker = '/* affinity-law-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|localStorage|fetch\(|XMLHttpRequest/.test(coreSource),
  'the core stays free of DOM, storage and network access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = AffinityLaw;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Fan & Pump Affinity Law Calculator');
assert.equal(record.category, 'Mechanical & Structural Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
for (const tag of ['affinity-laws', 'fan-laws', 'pump-laws', 'impeller', 'speed-scaling']) {
  assert.ok(record.tags.includes(tag), `tag ${tag}`);
}
assert.ok(record.aliases.length >= 6, 'aliases cover the search spellings');
assert.ok(record.method.length > 1200, 'method records the arithmetic');
assert.ok(typeof record.guidance === 'string' && record.guidance.length > 60 && record.guidance.length < 500,
  'guidance states the limits and stays a banner');
assert.equal(record.sources.length, 2, 'two sources');
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'source has an https URL');
  assert.ok(source.title.length > 80, 'source title is specific');
}
assert.ok(record.sources.some((source) => source.url.includes('engineeringtoolbox.com/affinity-laws-d_408')),
  'Engineering ToolBox affinity-law source');
assert.ok(record.sources.some((source) => source.url.includes('Affinity_laws')), 'Wikipedia affinity-law source');

assert.equal(catalog.tools.length, 2521, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2260, 'public tools');
assert.equal(
  catalog.tools.filter((tool) => tool.category === 'Mechanical & Structural Engineering').length,
  57,
  'Mechanical & Structural Engineering count'
);

// The slug, name and aliases must not be shared with another record.
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  const others = [tool.slug, tool.name, ...(tool.aliases || []), ...(tool.tags || [])]
    .map((value) => value.toLowerCase());
  for (const value of [record.name, ...record.aliases]) {
    assert.ok(!others.includes(value.toLowerCase()), `"${value}" collides with ${tool.slug}`);
  }
}

const close = (actual, expected, label, tolerance = 1e-6) => {
  assert.ok(Number.isFinite(actual), `${label}: not finite (${actual})`);
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${label}: ${actual} != ${expected}`);
};

const failure = (input) => {
  try {
    C.compute(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

const kinds = { golden: 0, boundary: 0, validation: 0 };
for (const testCase of record.testCases) {
  kinds[testCase.kind] = (kinds[testCase.kind] || 0) + 1;
  if (testCase.kind === 'validation') {
    const message = failure(testCase.input);
    assert.ok(message, `${testCase.name}: expected a refusal`);
    assert.ok(message.includes(testCase.expectedError),
      `${testCase.name}: "${message}" does not mention "${testCase.expectedError}"`);
    assert.ok(message.endsWith('.'), `${testCase.name}: the refusal is a full sentence`);
    continue;
  }
  const result = C.compute(testCase.input);
  for (const key of ['flowFactor', 'headFactor', 'powerFactor', 'flowOut', 'headOut', 'powerOut']) {
    close(result[key], testCase.expected[key], `${testCase.name}: ${key}`);
  }
}
assert.equal(kinds.golden, 5, 'five golden cases');
assert.equal(kinds.boundary, 3, 'three boundary cases');
assert.equal(kinds.validation, 6, 'six validation cases');
assert.equal(record.testCases.length, 14, 'fourteen catalog cases');

// ---- Independent fixture: exact rational scaling at 240 duty points. ----
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/affinity_law_cases.json'), 'utf8'));
assert.equal(fixture.cases.length, 240, 'two hundred and forty oracle fixtures');
for (const testCase of fixture.cases) {
  const result = C.compute(testCase.input);
  for (const key of ['flowFactor', 'headFactor', 'powerFactor', 'flowOut', 'headOut', 'powerOut']) {
    close(result[key], testCase.expected[key], `fixture ${JSON.stringify(testCase.input)}: ${key}`, 1e-9);
  }
}

// ---- Invariants of the shipped scaling model. ----
const base = { n1: '1450', n2: '1750', d1: '250', d2: '250', flow: '100', head: '25', power: '5.5' };
const scaled = C.compute(base);
close(scaled.headFactor, scaled.flowFactor ** 2, 'head factor is the square of the flow factor');
close(scaled.powerFactor, scaled.flowFactor ** 3, 'power factor is the cube of the flow factor');
close(scaled.speedRatio, 1750 / 1450, 'speed ratio');
close(scaled.diameterRatio, 1, 'equal diameters hold the wheel');
close(scaled.flowOut, 100 * 1750 / 1450, 'flow scales with speed');
close(scaled.headOut, 25 * (1750 / 1450) ** 2, 'head scales with speed squared');
close(scaled.powerOut, 5.5 * (1750 / 1450) ** 3, 'power scales with speed cubed');
close(scaled.flowChange, (1750 / 1450 - 1) * 100, 'flow change in percent');
close(scaled.powerChange, ((1750 / 1450) ** 3 - 1) * 100, 'power change in percent');

// The published worked example: doubling the speed doubles flow, quadruples
// head and multiplies power by eight; an 8-to-6 inch trim keeps 75/56.25/42.1875 %.
const doubled = C.compute({ ...base, n1: '1750', n2: '3500', flow: '100', head: '30.48', power: '3.7285' });
close(doubled.flowOut, 200, 'doubling doubles flow');
close(doubled.headOut, 121.92, 'doubling quadruples head');
close(doubled.powerOut, 29.828, 'doubling multiplies power by eight');
const trimmed = C.compute({ ...base, n1: '1450', n2: '1450', d1: '200', d2: '150', head: '30.48' });
close(trimmed.flowFactor, 0.75, 'a 200-to-150 mm trim keeps three quarters of the flow');
close(trimmed.headFactor, 0.5625, 'the head keeps 56.25 %');
close(trimmed.powerFactor, 0.421875, 'the power keeps 42.1875 %');
close(trimmed.powerOut, 5.5 * 0.421875, 'trimmed power');

// A speed and a diameter change multiply: 1.25 speed and 0.8 diameter cancel in flow.
const mixed = C.compute({ ...base, n1: '1600', n2: '2000', d1: '250', d2: '200' });
close(mixed.flowFactor, 1, 'the speed and diameter ratios cancel in flow');
close(mixed.headFactor, 1, 'and therefore in head');
close(mixed.powerFactor, 1, 'and in power');

// Zero flow at the reference point stays zero; head and power still scale.
const shutoff = C.compute({ ...base, flow: '0' });
assert.equal(shutoff.flowOut, 0, 'zero reference flow stays zero');
assert.ok(shutoff.headOut > 0 && shutoff.powerOut > 0, 'head and power still scale at shut-off');

// ---- Page contract. ----
assert.match(html, /<html lang="en">/, 'language declared');
assert.match(html, /name="viewport"/, 'viewport declared');
assert.match(html, /<main>/, 'main landmark');
assert.match(html, /<h1>Fan &amp; Pump Affinity Law Calculator<\/h1>/, 'page heading');
assert.match(html, /<form id="affinity-form" novalidate>/, 'form is marked novalidate');
assert.match(html, /<button type="submit">Scale the duty point<\/button>/, 'submit button');
for (const id of ['n1', 'n2', 'd1', 'd2', 'flow', 'head', 'power']) {
  assert.match(html, new RegExp(`<label for="${id}">`), `label for ${id}`);
  assert.match(html, new RegExp(`id="${id}"`), `input ${id}`);
}
assert.match(html, /id="err" role="alert" aria-live="polite"/, 'errors are announced');
assert.match(html, /id="out" aria-live="polite" aria-atomic="true"/, 'result is announced');
assert.match(html, /<table id="duty-table">/, 'the nearby-speed table is present');
assert.match(html, /<th scope="col">Speed \(rpm\)<\/th>/, 'table header cells are scoped');
assert.match(html, /do not intersect the result with the system curve/, 'the system-curve limit is stated');
assert.match(html, /nothing is sent or stored/, 'the local-only promise is stated');
assert.ok(!/src="https?:\/\//.test(html), 'no off-site script or image');

console.log('affinity-law-calculator: 14 catalog cases, 240 oracle fixtures, invariants and page contract OK');
