/* Regression checks for the Ship Gross & Net Tonnage Calculator: the catalog
   cases, an independent 60-digit Decimal oracle over 120 ships, the published
   gross-tonnage table, the regulatory floors and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ship-tonnage-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* ship-tonnage-core:start */';
const endMarker = '/* ship-tonnage-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|localStorage|fetch\(|XMLHttpRequest/.test(coreSource),
  'the core stays free of DOM, storage and network access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = ShipTonnage;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Ship Gross & Net Tonnage Calculator');
assert.equal(record.category, 'Oil, Gas & Marine Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
for (const tag of ['oil-gas-marine', 'tonnage', 'gross-tonnage', 'net-tonnage', 'itc-1969', 'ship-measurement']) {
  assert.ok(record.tags.includes(tag), `tag ${tag}`);
}
assert.ok(record.aliases.length >= 6, 'aliases cover the search spellings');
assert.ok(record.method.length > 1200, 'method records the arithmetic');
assert.ok(typeof record.guidance === 'string' && record.guidance.length > 60 && record.guidance.length < 500,
  'guidance states the limits and stays a banner');
assert.equal(record.sources.length, 3, 'three sources');
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'source has an https URL');
  assert.ok(source.title.length > 80, 'source title is specific');
}
assert.ok(record.sources.some((source) => source.url.includes('treaties.un.org')), 'Convention text source');
assert.ok(record.sources.some((source) => source.url.includes('TM.5-Circ.6')), 'rounded-down interpretation source');
assert.ok(record.sources.some((source) => source.url.includes('steamshipmutual.com')), 'plain-notation source');

assert.equal(catalog.tools.length, 2530, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2269, 'public tools');
assert.equal(
  catalog.tools.filter((tool) => tool.category === 'Oil, Gas & Marine Engineering').length,
  58,
  'Oil, Gas & Marine Engineering count'
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

const numericKeys = ['k1', 'gross', 'gt', 'k2', 'cargoTerm', 'cargoMinimum', 'draftFactor',
  'k3', 'passengerTerm', 'netMinimum', 'net', 'nt'];
const flagKeys = ['cargoFloorApplied', 'capped', 'counted'];

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
  for (const key of numericKeys) {
    close(result[key], testCase.expected[key], `${testCase.name}: ${key}`);
  }
  for (const key of flagKeys) {
    assert.equal(result[key], testCase.expected[key], `${testCase.name}: ${key}`);
  }
}
assert.equal(kinds.golden, 5, 'five golden cases');
assert.equal(kinds.boundary, 3, 'three boundary cases');
assert.equal(kinds.validation, 6, 'six validation cases');
assert.equal(record.testCases.length, 14, 'fourteen catalog cases');

// ---- Independent fixture: a 60-digit Decimal oracle over 120 ships. ----
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/ship_tonnage_cases.json'), 'utf8'));
assert.equal(fixture.cases.length, 120, 'one hundred and twenty oracle fixtures');
for (const testCase of fixture.cases) {
  const result = C.compute(testCase.input);
  for (const key of numericKeys) {
    close(result[key], testCase.expected[key], `fixture ${JSON.stringify(testCase.input)}: ${key}`, 1e-9);
  }
  for (const key of flagKeys) {
    assert.equal(result[key], testCase.expected[key], `fixture ${JSON.stringify(testCase.input)}: ${key}`);
  }
}

// ---- Published gross-tonnage table from the Convention. ----
const table = [
  [1, 0.2, 0], [10, 2.2, 2], [100, 24, 24], [1000, 260, 260],
  [10000, 2800, 2800], [100000, 30000, 30000], [1000000, 320000, 320000],
];
for (const [volume, gross, gt] of table) {
  const result = C.compute({ volume: String(volume), cargo: '1', depth: '10', draft: '5', n1: '0', n2: '0' });
  close(result.gross, gross, `gross tonnage at ${volume} m3`, 1e-12);
  assert.equal(result.gt, gt, `rounded gross tonnage at ${volume} m3`);
}

// ---- The three regulatory clips and the passenger rule. ----
const base = { volume: '100000', cargo: '40000', depth: '16', draft: '12', n1: '0', n2: '0' };
const normal = C.compute(base);
assert.equal(normal.capped, false, 'a draft of 3/4 depth is not capped');
close(normal.draftFactor, 1, 'the draft factor is unity at 3/4 depth');
assert.equal(normal.cargoFloorApplied, false, 'the cargo term is above 0.25 GT');
assert.equal(normal.netFloorApplied, false, 'the net tonnage is above 0.30 GT');

const capped = C.compute({ ...base, draft: '14' });
assert.equal(capped.capped, true, 'a deeper draft caps the factor');
assert.equal(capped.draftFactor, 1, 'the capped factor is one');

const smallCargo = C.compute({ ...base, cargo: '1' });
assert.equal(smallCargo.cargoFloorApplied, true, 'a tiny cargo volume hits the 0.25 GT floor');
close(smallCargo.cargoTerm, 0.25 * normal.gross, 'the cargo term is raised to 0.25 GT');
assert.equal(smallCargo.netFloorApplied, true, 'the sum then falls below 0.30 GT');
assert.equal(smallCargo.nt, 9000, 'net tonnage is raised to 0.30 GT and rounded down');

const twelve = C.compute({ ...base, n1: '8', n2: '4' });
assert.equal(twelve.counted, false, 'twelve passengers are not counted');
assert.equal(twelve.passengerTerm, 0, 'their passenger term is zero');
const thirteen = C.compute({ ...base, n1: '13', n2: '0' });
assert.equal(thirteen.counted, true, 'thirteen passengers are counted');
assert.ok(thirteen.passengerTerm > 0, 'their passenger term is positive');
close(thirteen.passengerTerm, thirteen.k3 * 13, 'N2 is divided by ten, N1 is not');

// GT is a strictly increasing function of volume, and NT never falls below the floor.
let previous = -1;
for (const volume of [1, 10, 100, 1000, 10000, 100000, 1000000]) {
  const result = C.compute({ ...base, volume: String(volume), cargo: String(Math.max(1, volume / 2)) });
  assert.ok(result.gross > previous, `gross tonnage grows at ${volume} m3`);
  previous = result.gross;
  assert.ok(result.net >= 0.30 * result.gross - 1e-9, 'net tonnage respects the 0.30 GT floor');
  assert.equal(result.gt, Math.floor(result.gross + 1e-9 * Math.max(1, result.gross)), 'GT is the gross value rounded down');
  assert.equal(result.nt, Math.floor(result.net + 1e-9 * Math.max(1, result.net)), 'NT is the net value rounded down');
}

// ---- Page contract. ----
assert.match(html, /<html lang="en">/, 'language declared');
assert.match(html, /name="viewport"/, 'viewport declared');
assert.match(html, /<main>/, 'main landmark');
assert.match(html, /<h1>Ship Gross &amp; Net Tonnage Calculator<\/h1>/, 'page heading');
assert.match(html, /<form id="tonnage-form" novalidate>/, 'form is marked novalidate');
assert.match(html, /<button type="submit">Calculate the tonnages<\/button>/, 'submit button');
for (const id of ['volume', 'cargo', 'depth', 'draft', 'n1', 'n2']) {
  assert.match(html, new RegExp(`<label for="${id}">`), `label for ${id}`);
  assert.match(html, new RegExp(`id="${id}"`), `input ${id}`);
}
assert.match(html, /id="err" role="alert" aria-live="polite"/, 'errors are announced');
assert.match(html, /id="out" aria-live="polite" aria-atomic="true"/, 'result is announced');
assert.match(html, /dimensionless/, 'the dimensionless warning is stated');
assert.match(html, /International Tonnage Certificate/, 'the certificate caveat is stated');
assert.match(html, /nothing is sent or stored/, 'the local-only promise is stated');
assert.ok(!/src="https?:\/\//.test(html), 'no off-site script or image');

console.log('ship-tonnage-calculator: 14 catalog cases, 120 oracle fixtures, public table, floors and page contract OK');
