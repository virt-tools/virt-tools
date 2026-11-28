/* Regression checks for the AM Modulation Index & Power tool: the catalog cases,
   an independent double-sideband model over a grid of powers and depths, the
   inverse from a measured total, the page contract and catalog integrity. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'am-modulation-index-power-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* am-mod-core:start */';
const endMarker = '/* am-mod-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|localStorage|fetch\(|XMLHttpRequest/.test(coreSource), 'the core stays free of DOM, storage and network access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = AmModulationCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'AM Modulation Index & Power Calculator');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.tags.includes('amplitude-modulation') && record.tags.includes('pep'), 'tags name the domain');
assert.ok(record.aliases.length >= 8, 'aliases cover the search spellings');
assert.ok(record.method.length > 1500, 'method records the arithmetic');
assert.ok(typeof record.guidance === 'string' && record.guidance.length > 60, 'guidance states the limits');
assert.equal(record.sources.length, 2, 'two sources');
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'source has an https URL');
  assert.ok(source.title.length > 80, 'source title is specific');
}
assert.ok(record.sources.some((source) => source.url === 'https://en.wikipedia.org/wiki/Amplitude_modulation'), 'amplitude modulation source');
assert.ok(record.sources.some((source) => source.url === 'https://en.wikipedia.org/wiki/Peak_envelope_power'), 'peak envelope power source');

assert.equal(catalog.tools.length, 2529, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2268, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Communications Engineering').length, 58, 'Communications Engineering count');

// The slug, name, aliases and tags must not be shared with another record.
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  const others = [tool.slug, tool.name, ...(tool.aliases || []), ...(tool.tags || [])].map((value) => value.toLowerCase());
  for (const value of [record.name, ...record.aliases]) {
    assert.ok(!others.includes(value.toLowerCase()), `"${value}" collides with ${tool.slug}`);
  }
}

const failure = (input) => {
  try {
    C.calculate(input);
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
    assert.ok(
      message.includes(testCase.expectedError),
      `${testCase.name}: "${message}" does not mention "${testCase.expectedError}"`
    );
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
  assert.equal('impliedDepth' in testCase.expected, result.impliedDepth !== null,
    `${testCase.name}: the inverse row appears only with a measured total`);
}
assert.equal(kinds.golden, 8, 'eight golden cases');
assert.equal(kinds.boundary, 4, 'four boundary cases');
assert.equal(kinds.validation, 12, 'twelve validation cases');
assert.equal(record.testCases.length, 24, 'twenty-four catalog cases');

// ---- Independent model, written from the sideband power rather than the page. ----
const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
};
/* The page rounds every figure to six decimals, so allow 1e-6 absolute (plus
   float slack on megawatt-scale values). */
const tol = (expected) => Math.max(1e-6, Math.abs(expected) * 1e-9);
let checked = 0;
for (const power of [0.001, 0.01, 0.1, 1, 2.5, 7, 10, 25, 50, 100, 400, 1000, 5000, 1000000]) {
  for (const depth of [0, 5, 10, 25, 30, 50, 75, 80, 90, 95, 100, 110, 125, 150, 199, 200]) {
    const m = depth / 100;
    const sidebandEach = power * m * m / 4;
    const result = C.calculate({ power, depth, frequency: 1 });
    near(result.totalPower, power + 2 * sidebandEach, tol(power + 2 * sidebandEach), `${power} W at ${depth} %: total`);
    near(result.sidebandEach, sidebandEach, tol(sidebandEach), `${power} W at ${depth} %: each sideband`);
    near(result.pep, power * (1 + m) * (1 + m), tol(power * (1 + m) * (1 + m)), `${power} W at ${depth} %: PEP`);
    /* The carrier is untouched, so the sideband pair is the whole increase. */
    near(result.totalPower - power, 2 * sidebandEach, 2 * tol(power), `${power} W at ${depth} %: rise`);
    near(result.efficiency, depth === 0 ? 0 : (1 - 2 / (2 + m * m)) * 100, 1e-5, `${power} W at ${depth} %: efficiency`);
    near(result.sidebandShare, 50 * m, 1e-9, `${power} W at ${depth} %: sideband amplitude`);
    assert.equal(result.overmodulated, m > 1, `${power} W at ${depth} %: overmodulation flag`);
    assert.ok(result.totalPower <= result.pep + 1e-9, `${power} W at ${depth} %: total cannot exceed PEP`);
    checked++;
  }
}
assert.equal(checked, 14 * 16, 'the whole power and depth grid is covered');

// ---- Known values from the AM power relations. ----
const exact = (input, key, value, label) => {
  assert.equal(C.calculate(input)[key], value, label);
};
exact({ power: 100, depth: 100, frequency: 1 }, 'totalPower', 150, '100 % doubles nothing: Pc + Pc/2');
exact({ power: 100, depth: 100, frequency: 1 }, 'sidebandPower', 50, '100 % puts half the carrier power in the sidebands');
exact({ power: 100, depth: 100, frequency: 1 }, 'pep', 400, '100 % PEP is four times the carrier');
exact({ power: 100, depth: 50, frequency: 1 }, 'efficiency', 11.111111, '50 % efficiency');
exact({ power: 100, depth: 100, frequency: 1 }, 'efficiency', 33.333333, '100 % efficiency');
exact({ power: 25, depth: 100, frequency: 1 }, 'totalPower', 37.5, '25 W carrier at 100 %');
exact({ power: 1, depth: 20, frequency: 1 }, 'totalPower', 1.02, '20 % adds 2 % of the carrier');
exact(record.testCases[0].input, 'riseDb', 0.511525, '50 % rises 0.5115 dB');

// ---- Inverse: a measured total recovers the depth that produced it. ----
for (const power of [1, 10, 100, 1000]) {
  for (const depth of [10, 33, 50, 75, 100, 140]) {
    const forward = C.calculate({ power, depth, frequency: 1 });
    const back = C.calculate({ power, depth, frequency: 1, measured: forward.totalPower });
    assert.ok(Math.abs(back.impliedDepth - depth) <= 1e-6, `${power} W at ${depth} %: implied depth ${back.impliedDepth}`);
    assert.equal(back.depthDeviation, 0, `${power} W at ${depth} %: zero deviation`);
  }
}
const mismatch = C.calculate({ power: 200, depth: 40, frequency: 1, measured: 240 });
near(mismatch.impliedDepth, Math.sqrt(2 * (240 / 200 - 1)) * 100, 1e-6, 'measured depth');
near(mismatch.depthDeviation, mismatch.impliedDepth - 40, 1e-6, 'deviation in points');

// ---- Refusals for values the page must not guess at ----
const refusals = [
  [{ power: 100, depth: 50, frequency: 1, measured: 99.9 }, 'at least the carrier power'],
  [{ power: 0.0005, depth: 50, frequency: 1 }, '0.001 to 1000000 W'],
  [{ power: 100, depth: 200.5, frequency: 1 }, '0 to 200 %'],
  [{ power: 100, depth: '50 %', frequency: 1 }, '0 to 200 %'],
  [{ power: 100, depth: 50, frequency: 100001 }, '0.001 to 100000 kHz'],
  [{ power: '1,000', depth: 50, frequency: 1 }, '0.001 to 1000000 W'],
  [{ power: 100, depth: 50, frequency: 1, measured: '1e2' }, '0.001 to 1000000 W'],
];
for (const [input, expected] of refusals) {
  const message = failure(input);
  assert.ok(message, `${JSON.stringify(input)} should be refused`);
  assert.ok(message.includes(expected), `${JSON.stringify(input)}: "${message}" does not mention "${expected}"`);
}

// ---- Page contract ----
const markup = html.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, '');
assert.equal((markup.match(/<h1\b/g) || []).length, 1, 'one h1');
assert.match(markup, /<form id="am-form" novalidate>/, 'the form is present');
assert.match(markup, /aria-live="polite"/, 'the result is annunciated');
assert.match(markup, /<label[^>]*for="in-power"[^>]*>/, 'the carrier power field is labelled');
assert.match(markup, /<label[^>]*for="in-depth"[^>]*>/, 'the depth field is labelled');
assert.match(markup, /<label[^>]*for="in-freq"[^>]*>/, 'the frequency field is labelled');
assert.match(markup, /<label[^>]*for="in-measured"[^>]*>/, 'the measured total field is labelled');
assert.match(markup, /min-height:46px/, 'the button is touch sized');
assert.ok(!/https?:\/\//.test(html), 'the page makes no external reference');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'nothing is stored');
assert.ok(!/fetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(html), 'nothing is sent');
assert.ok(html.includes('id="site-header"') && html.includes('/assets/app.js'), 'shared header and app script');

console.log(`am modulation index & power: ${record.testCases.length} catalog cases and ${checked} modelled combinations pass`);
