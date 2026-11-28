/* Regression checks for the API gravity converter core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'api-gravity-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* api-gravity-core:start */');
const end = html.indexOf('/* api-gravity-core:end */');
assert.ok(start > -1 && end > start, 'api gravity core markers missing');
const core = html.slice(start, end + '/* api-gravity-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ApiGravityCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= eps * scale,
    `${label}: expected ${expected}, got ${actual}`);
};
// A published or displayed value keeps a fixed number of decimals; accept half
// of the last one plus float slack and nothing looser.
const closeTo = (actual, expected, label) => {
  const text = String(expected);
  const decimals = text.includes('.') ? text.split('.')[1].length : 0;
  const tolerance = 0.5 * Math.pow(10, -decimals) + Math.abs(expected) * 1e-9;
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`);
};
const published = closeTo;
const run = (mode, value) => C.calculate({ mode, value: String(value) });
const refuses = (input, message) => {
  assert.throws(() => C.calculate(input), (error) => {
    assert.equal(error.message, message);
    return true;
  }, `expected the refusal "${message}"`);
};

// ---- Published hydrometer table: API gravity to specific gravity at 60 °F.
// The four-decimal entries are the standard roundings of 141.5 / (API + 131.5).
const PUBLISHED = [
  [10, 1.0000], [20, 0.9340], [30, 0.8762], [35, 0.8498],
  [40, 0.8251], [45, 0.8017], [50, 0.7796]
];
for (const [api, sg] of PUBLISHED) {
  const result = run('api', api);
  published(result.sg, sg, `${api} API specific gravity`);
  near(result.api, api, `${api} API round trip`);
}

// ---- Both definitions in the page are the documented ones.
assert.equal(C.WATER_KG_M3, 999.016, 'water at 60 °F');
near(C.BBL_M3, 42 * 3.785411784e-3, 'a barrel is 42 US gallons', 1e-12);

// 10 °API is exactly water at 60 °F: SG 1 and 999.016 kg/m³.
const water = run('api', 10);
near(water.sg, 1, '10 API is SG 1');
near(water.densityKgM3, 999.016, 'SG 1 density');
near(water.densityKgL, 0.999016, 'SG 1 kg/L');
near(water.densityLbFt3, 999.016 / 16.01846337396014, 'SG 1 lb/ft3');
published(water.bblPerTonne, 6.296, '10 API barrels per tonne');

// 35 °API: 849.0 kg/m³ and 7.408 barrels per tonne.
const mid = run('api', 35);
published(mid.sg, 0.8498, '35 API specific gravity');
published(mid.densityKgM3, 849.0, '35 API density');
published(mid.bblPerTonne, 7.408, '35 API barrels per tonne');
published(mid.tonnesPerBarrel, 0.1350, '35 API tonnes per barrel');
assert.equal(mid.grade, 'Light crude');

// Wikipedia's worked example: a metric tonne of 39.6 °API WTI is about 7.6 barrels.
const wti = run('api', 39.6);
assert.ok(wti.bblPerTonne > 7.55 && wti.bblPerTonne < 7.65,
  `39.6 API barrels per tonne near 7.6, got ${wti.bblPerTonne}`);

// ---- Every mode reaches the same answer from its own measure.
for (const api of [-5, 0, 8, 10, 22.3, 31.1, 35, 39.6, 45, 50, 60]) {
  const byApi = run('api', api);
  const bySg = run('sg', byApi.sg);
  const byDensity = run('density', byApi.densityKgM3);
  near(bySg.api, api, `${api} API from specific gravity`, 1e-9);
  near(byDensity.api, api, `${api} API from density`, 1e-9);
  near(bySg.densityKgM3, byApi.densityKgM3, `${api} density from SG`);
  near(byDensity.bblPerTonne, byApi.bblPerTonne, `${api} barrels from density`);
  near(bySg.mode === 'sg' ? 1 : 0, 1, 'mode reported');
}

// Lighter oil is less dense and gives more barrels per tonne.
let previous = null;
for (let api = -10; api <= 150; api += 5) {
  const result = run('api', api);
  if (previous) {
    assert.ok(result.sg < previous.sg, `${api} API is lighter than ${api - 5}`);
    assert.ok(result.densityKgM3 < previous.densityKgM3, `${api} API density falls`);
    assert.ok(result.bblPerTonne > previous.bblPerTonne, `${api} API barrels per tonne rise`);
  }
  previous = result;
}

// ---- Grade cut-offs: light above 31.1, medium 22.3 to 31.1, heavy below 22.3, extra heavy below 10.
assert.equal(run('api', 31.2).grade, 'Light crude');
assert.equal(run('api', 31.1).grade, 'Medium crude');
assert.equal(run('api', 22.31).grade, 'Medium crude');
assert.equal(run('api', 22.3).grade, 'Medium crude');
assert.equal(run('api', 22.29).grade, 'Heavy crude');
assert.equal(run('api', 10).grade, 'Heavy crude');
assert.equal(run('api', 9.99).grade, 'Extra heavy (bitumen)');
assert.equal(run('api', -10).grade, 'Extra heavy (bitumen)');

// The limits are exposed so the page and the tests agree on them.
assert.equal(C.LIMITS.api.min, -10);
assert.equal(C.LIMITS.api.max, 150);
assert.equal(C.LIMITS.sg.min, 0.3);
assert.equal(C.LIMITS.sg.max, 2.5);
assert.equal(C.LIMITS.density.min, 300);
assert.equal(C.LIMITS.density.max, 2500);

// ---- Refusals.
refuses({ mode: 'api', value: '' }, 'Enter a value to convert.');
refuses({ mode: 'api', value: '   ' }, 'Enter a value to convert.');
refuses({ mode: 'api' }, 'Enter a value to convert.');
refuses({ mode: 'api', value: 'thirty-five' }, 'Enter the value as a number.');
refuses({ mode: 'api', value: '35.1.2' }, 'Enter the value as a number.');
refuses({ mode: 'api', value: '-11' }, 'Enter an API gravity from -10 to 150 °API.');
refuses({ mode: 'api', value: '150.5' }, 'Enter an API gravity from -10 to 150 °API.');
refuses({ mode: 'sg', value: '0' }, 'Enter a specific gravity from 0.3 to 2.5.');
refuses({ mode: 'sg', value: '2.6' }, 'Enter a specific gravity from 0.3 to 2.5.');
refuses({ mode: 'density', value: '299' }, 'Enter a density from 300 to 2500 kg/m³.');
refuses({ mode: 'density', value: '2501' }, 'Enter a density from 300 to 2500 kg/m³.');
refuses({ mode: 'volume', value: '1' }, 'Choose API gravity, specific gravity or density.');
refuses({}, 'Choose API gravity, specific gravity or density.');

// ---- Catalog record, totals, and every case stored in the record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.length, 2522, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2261, 'public tools');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'API Gravity Converter');
assert.equal(record.category, 'Oil, Gas & Marine Engineering');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(Array.isArray(record.sources) && record.sources.length >= 2, 'sources present');
assert.ok(record.sources.some((entry) => (entry.title + ' ' + (entry.url || '')).includes('141.5')),
  'the API gravity definition is cited');
assert.ok(record.sources.some((entry) => (entry.url || '').includes('eia.gov')),
  'the barrel definition is cited');
assert.ok(typeof record.method === 'string' && record.method.length > 500, 'method documented');
assert.ok(Array.isArray(record.aliases) && record.aliases.length >= 6, 'aliases present');
assert.ok(Array.isArray(record.tags) && record.tags.length >= 6, 'tags present');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags unique');
assert.ok(record.description.length > 80, 'description present');
assert.equal(record.testCases.length, 16, 'catalog cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 5,
  'validation cases');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug unique');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Oil, Gas & Marine Engineering').length,
  57, 'Oil, Gas & Marine Engineering count');
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.ok(!record.aliases.map((alias) => alias.toLowerCase()).includes(other.name.toLowerCase()),
    `alias collides with ${other.slug}`);
  assert.ok(other.name !== record.name, `name collides with ${other.slug}`);
}

for (const testCase of record.testCases) {
  const label = testCase.name;
  if (testCase.expectedError) {
    assert.throws(() => C.calculate(testCase.input), (error) => {
      assert.equal(error.message, testCase.expectedError, `${label}: wrong refusal`);
      return true;
    }, `${label}: expected a refusal`);
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const [field, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'string') {
      assert.equal(result[field], value, `${label}: ${field}`);
      continue;
    }
    assert.ok(typeof result[field] === 'number', `${label}: ${field} should be a number`);
    closeTo(result[field], value, `${label}: ${field}`);
  }
}

// ---- Page contract: local-only, keyboard-submittable, one form.
assert.ok(html.includes('id="api-form"'), 'form present');
assert.ok(html.includes('id="in-mode"') && html.includes('id="in-value"'), 'inputs present');
assert.ok(html.includes('id="ref-body"'), 'reference table present');
assert.ok(!html.includes('fetch(') && !html.includes('XMLHttpRequest'), 'no network calls');
assert.ok(!/https?:\/\//.test(html.replace(/<script src="[^"]*"><\/script>/g, '')),
  'no external URLs in the page');
assert.equal((html.match(/<script src="\/assets\/theme-init\.js"><\/script>/g) || []).length, 1,
  'theme init once');
assert.equal((html.match(/<script src="\/assets\/app\.js"><\/script>/g) || []).length, 1, 'app shell once');
assert.ok(html.includes('<button type="submit">'), 'submit button present');

console.log('api gravity converter: all assertions passed');
