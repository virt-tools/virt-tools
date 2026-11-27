/* Regression checks for the Earth Station G/T Ratio Calculator: the catalog cases,
   an independent antenna-port cascade model over a wide grid, the reference-plane
   invariance, the page contract and catalog integrity. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'earth-station-gt-ratio-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* gt-ratio-core:start */';
const endMarker = '/* gt-ratio-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|localStorage|fetch\(|XMLHttpRequest/.test(coreSource),
  'the core stays free of DOM, storage and network access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = GtRatio;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Earth Station G/T Ratio Calculator');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.tags.includes('g-t') && record.tags.includes('noise-temperature'), 'tags name the figure of merit');
assert.ok(record.aliases.length >= 6, 'aliases cover the search spellings');
assert.ok(record.method.length > 1200, 'method records the arithmetic');
assert.ok(typeof record.guidance === 'string' && record.guidance.length > 60 && record.guidance.length < 500,
  'guidance states the limits and stays a banner');
assert.equal(record.sources.length, 2, 'two sources');
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'source has an https URL');
  assert.ok(source.title.length > 80, 'source title is specific');
}
assert.ok(record.sources.some((source) => source.url.includes('R-REC-S.733-2')), 'ITU-R S.733-2 source');
assert.ok(record.sources.some((source) => source.url.includes('Noise_figure')), 'noise figure source');

assert.equal(catalog.tools.length, 2512, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2251, 'public tools');
assert.equal(
  catalog.tools.filter((tool) => tool.category === 'Communications Engineering').length,
  57,
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
  for (const key of ['gt', 'tsys', 'receiverTemp']) {
    close(result[key], testCase.expected[key], `${testCase.name}: ${key}`);
  }
}
assert.equal(kinds.golden, 4, 'four golden cases');
assert.equal(kinds.boundary, 3, 'three boundary cases');
assert.equal(kinds.validation, 5, 'five validation cases');
assert.equal(record.testCases.length, 12, 'twelve catalog cases');

// ---- Independent fixture: cascade the chain at the antenna port. ----
// T_port = T_a + T_phys (alpha - 1) + alpha T_R, G/T = G - 10 log10(T_port).
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/gt_ratio_cases.json'), 'utf8'));
assert.equal(fixture.cases.length, 220, 'two hundred and twenty oracle fixtures');
for (const testCase of fixture.cases) {
  const result = C.compute(testCase.input);
  for (const key of ['gt', 'tsys', 'receiverTemp']) {
    close(result[key], testCase.expected[key], `fixture ${JSON.stringify(testCase.input)}: ${key}`);
  }
}

// ---- Invariants of the shipped chain model. ----
const base = { gain: '45', antenna: '50', loss: '0.5', nf: '1', phys: '290' };
const plain = C.compute({ ...base, loss: '0', phys: '290' });
close(plain.tsys, 50 + 290 * (Math.pow(10, 0.1) - 1), 'no feed loss keeps Ta and adds only TR');
const withLoss = C.compute(base);
close(withLoss.gt, withLoss.receiveGain - 10 * Math.log10(withLoss.tsys), 'G/T from the receive gain');
close(withLoss.gt, 45 - 10 * Math.log10(withLoss.tsys * withLoss.alpha), 'G/T is the same at the antenna port');
close(withLoss.antennaTerm + withLoss.feedTerm + withLoss.receiverTemp, withLoss.tsys, 'terms sum to T_sys');
close(withLoss.alpha, Math.pow(10, 0.5 / 10), 'alpha is the loss ratio');
close(withLoss.receiverTemp, 290 * (Math.pow(10, 1 / 10) - 1), 'noise figure to noise temperature at 290 K');

// More feed loss and a worse LNA both lower G/T; a colder feed raises it.
const moreLoss = C.compute({ ...base, loss: '1.5' });
assert.ok(moreLoss.gt < withLoss.gt, 'more feed loss lowers G/T');
const worseLna = C.compute({ ...base, nf: '2' });
assert.ok(worseLna.gt < withLoss.gt, 'a worse noise figure lowers G/T');
const coldFeed = C.compute({ ...base, phys: '100' });
assert.ok(coldFeed.gt > withLoss.gt, 'a colder feed raises G/T');
const coldSky = C.compute({ ...base, antenna: '10' });
assert.ok(coldSky.gt > withLoss.gt, 'a colder sky raises G/T');

// ---- Page contract. ----
assert.match(html, /<html lang="en">/, 'language declared');
assert.match(html, /name="viewport"/, 'viewport declared');
assert.match(html, /<main>/, 'main landmark');
assert.match(html, /<h1>Earth Station G\/T Ratio Calculator<\/h1>/, 'page heading');
assert.match(html, /<form id="gt-form" novalidate>/, 'form is marked novalidate');
assert.match(html, /<button type="submit">Calculate G\/T<\/button>/, 'submit button');
for (const id of ['gain', 'antenna', 'loss', 'nf', 'phys']) {
  assert.match(html, new RegExp(`<label for="${id}">`), `label for ${id}`);
  assert.match(html, new RegExp(`id="${id}"`), `input ${id}`);
}
assert.match(html, /id="err" role="alert" aria-live="polite"/, 'errors are announced');
assert.match(html, /id="out" aria-live="polite" aria-atomic="true"/, 'result is announced');
assert.match(html, /antenna port or to the receiver input/, 'the reference plane is stated');
assert.match(html, /not included/, 'the exclusions are stated');
assert.ok(!/src="https?:\/\//.test(html), 'no off-site script or image');

console.log('earth-station-gt-ratio-calculator: 12 catalog cases, 220 oracle fixtures, invariants and page contract OK');
