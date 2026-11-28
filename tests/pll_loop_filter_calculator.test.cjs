/* Regression checks for the PLL Loop Filter Calculator: the catalog cases, an
   independent complex-gain model over a wide grid, the open-loop identities, the
   page contract and catalog integrity. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'pll-loop-filter-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* pll-loop-filter-core:start */';
const endMarker = '/* pll-loop-filter-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|localStorage|fetch\(|XMLHttpRequest/.test(coreSource),
  'the core stays free of DOM, storage and network access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = PllLoop;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'PLL Loop Filter Calculator');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.tags.includes('pll') && record.tags.includes('loop-filter'), 'tags name the loop');
assert.ok(record.aliases.length >= 6, 'aliases cover the search spellings');
assert.ok(record.method.length > 1200, 'method records the arithmetic');
assert.ok(typeof record.guidance === 'string' && record.guidance.length > 60 && record.guidance.length < 500,
  'guidance states the limits and stays a banner');
assert.equal(record.sources.length, 2, 'two sources');
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'source has an https URL');
  assert.ok(source.title.length > 80, 'source title is specific');
}
assert.ok(record.sources.some((source) => source.url.includes('snaa106c')), 'TI PLL book source');
assert.ok(record.sources.some((source) => source.url.includes('Phase-locked_loop')), 'PLL topology source');

assert.equal(catalog.tools.length, 2531, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2270, 'public tools');
assert.equal(
  catalog.tools.filter((tool) => tool.category === 'Communications Engineering').length,
  58,
  'Communications Engineering count'
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

const FIELDS = ['phaseMargin', 'fcHz', 'zeroHz', 'poleHz', 'naturalHz', 'damping', 'ratioPct'];
const close = (actual, expected, label) => {
  assert.ok(Number.isFinite(actual), `${label}: not finite (${actual})`);
  assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
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
  for (const key of FIELDS) {
    close(result[key], testCase.expected[key], `${testCase.name}: ${key}`);
  }
}
assert.equal(kinds.golden, 4, 'four golden cases');
assert.equal(kinds.boundary, 3, 'three boundary cases');
assert.equal(kinds.validation, 5, 'five validation cases');
assert.equal(record.testCases.length, 12, 'twelve catalog cases');

// ---- Independent fixture: evaluate the complex open-loop gain and search for |G| = 1. ----
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/pll_loop_filter_cases.json'), 'utf8'));
assert.equal(fixture.cases.length, 220, 'two hundred and twenty oracle fixtures');
for (const testCase of fixture.cases) {
  const result = C.compute(testCase.input);
  for (const key of FIELDS) {
    close(result[key], testCase.expected[key], `fixture ${JSON.stringify(testCase.input)}: ${key}`);
  }
}

// ---- Identities of the shipped continuous-time loop model. ----
const base = { icp: '500', kvco: '30', n: '1000', fpd: '10', r2: '4.7', c1: '10', c2: '0.47' };
const model = C.compute(base);

function openLoop(input, freqHz) {
  const icp = Number(input.icp) * 1e-6;
  const kvco = Number(input.kvco) * 1e6 * 2 * Math.PI;
  const n = Number(input.n);
  const r2 = Number(input.r2) * 1e3;
  const c1 = Number(input.c1) * 1e-9;
  const c2 = Number(input.c2) * 1e-9;
  const k = (icp / (2 * Math.PI)) * kvco / (n * (c1 + c2));
  const wz = 1 / (r2 * c1);
  const wp = (c1 + c2) / (r2 * c1 * c2);
  // G(jw) = K (1 + j w/wz) / (-w^2 (1 + j w/wp)) as a complex number.
  const w = 2 * Math.PI * freqHz;
  const numerator = { re: k, im: k * w / wz };
  const denominator = { re: -w * w, im: -w * w * w / wp };
  const mag2 = (numerator.re ** 2 + numerator.im ** 2) / (denominator.re ** 2 + denominator.im ** 2);
  return { k, wz, wp, mag: Math.sqrt(mag2), phase: Math.atan2(numerator.im, numerator.re) - Math.atan2(denominator.im, denominator.re) };
}

const loop = openLoop(base, model.fcHz);
close(loop.mag, 1, 'the returned loop bandwidth has unity open-loop gain');
close(model.zeroHz, loop.wz / (2 * Math.PI), 'zero frequency from R2 and C1');
close(model.poleHz, loop.wp / (2 * Math.PI), 'pole frequency from C1 + C2 over R2 C1 C2');
close(model.naturalHz, Math.sqrt(loop.k) / (2 * Math.PI), 'natural frequency is sqrt(K)');
close(model.damping, Math.sqrt(loop.k) / (2 * loop.wz), 'damping is sqrt(K) over two zeros');
close(model.phaseMargin, (Math.atan(model.fcHz / model.zeroHz) - Math.atan(model.fcHz / model.poleHz)) * 180 / Math.PI,
  'phase margin from the zero and pole');
close(model.ratioPct, model.fcHz / 10e6 * 100, 'loop bandwidth as a percentage of the phase detector');
assert.ok(model.poleHz > model.zeroHz, 'the pole sits above the zero');
assert.ok(model.phaseMargin > 45, 'the default design clears the 45 degree warning');

// A faster charge pump or a larger VCO gain raises the loop bandwidth; a larger N lowers it.
assert.ok(C.compute({ ...base, icp: '1000' }).fcHz > model.fcHz, 'more charge-pump current speeds the loop');
assert.ok(C.compute({ ...base, kvco: '60' }).fcHz > model.fcHz, 'a higher VCO gain speeds the loop');
assert.ok(C.compute({ ...base, n: '2000' }).fcHz < model.fcHz, 'a larger divider slows the loop');
assert.ok(C.compute({ ...base, r2: '9.4' }).zeroHz < model.zeroHz, 'a larger R2 lowers the zero');
assert.ok(C.compute({ ...base, c2: '0.94' }).poleHz < model.poleHz, 'a larger C2 lowers the pole');

// Numbers are accepted directly, so a JavaScript sweep need not stringify.
const numeric = C.compute({ icp: 500, kvco: 30, n: 1000, fpd: 10, r2: 4.7, c1: 10, c2: 0.47 });
for (const key of FIELDS) close(numeric[key], model[key], `numeric input: ${key}`);

// Refusals stay full sentences and name the field.
assert.equal(failure({ ...base, n: '0' }),
  'Feedback divider ratio must be between 1 and 1,000,000.');
assert.equal(failure({ ...base, c1: '' }), 'Enter the filter capacitor C1 in nF.');
assert.equal(failure({ ...base, r2: '4.7 kohm' }), 'Filter resistor R2 must be a number.');
assert.equal(failure({ ...base, fpd: '0.0001' }),
  'Phase-detector frequency must be between 0.001 and 1,000 MHz.');

// ---- Page contract. ----
assert.match(html, /<html lang="en">/, 'language declared');
assert.match(html, /name="viewport"/, 'viewport declared');
assert.match(html, /<main>/, 'main landmark');
assert.match(html, /<h1>PLL Loop Filter Calculator<\/h1>/, 'page heading');
assert.match(html, /<form id="pll-form" novalidate>/, 'form is marked novalidate');
assert.match(html, /<button type="submit">Calculate loop response<\/button>/, 'submit button');
for (const id of ['icp', 'kvco', 'n', 'fpd', 'r2', 'c1', 'c2']) {
  assert.match(html, new RegExp(`<label for="${id}">`), `label for ${id}`);
  assert.match(html, new RegExp(`id="${id}"`), `input ${id}`);
}
assert.match(html, /id="err" role="alert" aria-live="polite"/, 'errors are announced');
assert.match(html, /id="out" aria-live="polite" aria-atomic="true"/, 'result is announced');
assert.match(html, /phase-detector sampling/, 'the excluded sampling effect is named');
assert.match(html, /nothing is sent or stored/, 'the local-only promise is stated');
assert.ok(!/src="https?:\/\//.test(html), 'no off-site script or image');

console.log('pll-loop-filter-calculator: 12 catalog cases, 220 oracle fixtures, identities and page contract OK');
