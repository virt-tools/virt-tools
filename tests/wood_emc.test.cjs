/* Regression checks for the Wood Equilibrium Moisture Content Calculator: the
   catalog cases, the published Wood Handbook table 4-2 row, the unit path, the
   accepted domain by sweep, the humidity table and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'wood-equilibrium-moisture-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* wood-emc-core:start */';
const endMarker = '/* wood-emc-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|localStorage|fetch\(|XMLHttpRequest/.test(coreSource),
  'the core stays free of DOM, storage and network access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = WoodEmc;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Wood Equilibrium Moisture Content Calculator');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
for (const tag of ['crafts-&-hobbies', 'woodworking', 'wood', 'moisture', 'equilibrium-moisture-content', 'emc', 'humidity', 'sorption']) {
  assert.ok(record.tags.includes(tag), `tag ${tag}`);
}
assert.ok(record.aliases.length >= 6, 'aliases cover the search spellings');
assert.ok(record.method.length > 1200, 'method records the arithmetic');
assert.ok(typeof record.guidance === 'string' && record.guidance.length > 60 && record.guidance.length < 500,
  'guidance states the limits and stays a banner');
assert.equal(record.sources.length, 1, 'one source');
assert.match(record.sources[0].url, /^https:\/\//, 'source has an https URL');
assert.ok(record.sources[0].title.length > 80, 'source title is specific');
assert.ok(/equation 4-5/.test(record.sources[0].title) && /table 4-2/i.test(record.sources[0].title),
  'the source names the equation and the table it validates against');

assert.equal(catalog.tools.length, 2508, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2247, 'public tools');
assert.equal(
  catalog.tools.filter((tool) => tool.category === 'Crafts & Hobbies').length,
  57,
  'Crafts & Hobbies count'
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

const close = (actual, expected, label, tolerance = 1e-9) => {
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

const numericKeys = ['emc', 'celsius', 'fahrenheit', 'w', 'k', 'k1', 'k2', 'headroom'];

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
}
assert.equal(kinds.golden, 4, 'four golden cases');
assert.equal(kinds.boundary, 2, 'two boundary cases');
assert.equal(kinds.validation, 6, 'six validation cases');
assert.equal(record.testCases.length, 12, 'twelve catalog cases');

// ---- The published table 4-2 row: 30 F (-1.11 C), 5% to 95% relative humidity. ----
const TABLE_30F = [
  [5, 1.4], [10, 2.6], [15, 3.7], [20, 4.6], [25, 5.5], [30, 6.3], [35, 7.1], [40, 7.9],
  [45, 8.7], [50, 9.5], [55, 10.4], [60, 11.3], [65, 12.4], [70, 13.5], [75, 14.9],
  [80, 16.5], [85, 18.5], [90, 21.0], [95, 24.3],
];
let worst = 0;
for (const [rh, published] of TABLE_30F) {
  const result = C.compute({ temp: '30', unit: 'f', rh: String(rh) });
  const difference = Math.abs(result.emc - published);
  worst = Math.max(worst, difference);
  assert.ok(difference <= 0.051, `table 4-2 at 50 F and ${rh}%: ${result.emc.toFixed(3)} vs ${published}`);
}
assert.ok(worst > 0.02 && worst <= 0.051, `the fit tracks the table to its own rounding (worst ${worst.toFixed(3)})`);

// ---- Unit path: the same air in Celsius and Fahrenheit is the same wood. ----
for (const celsius of [-1.1, 0, 5, 12.5, 20, 37, 60, 98.9]) {
  const fahrenheit = celsius * 9 / 5 + 32;
  for (const rh of [5, 35, 65, 95]) {
    const inC = C.compute({ temp: String(celsius), unit: 'c', rh: String(rh) });
    const inF = C.compute({ temp: String(fahrenheit), unit: 'f', rh: String(rh) });
    close(inF.emc, inC.emc, `${celsius} C vs ${fahrenheit} F at ${rh}%`, 1e-6);
    close(inF.celsius, celsius, `${fahrenheit} F converts back to ${celsius} C`, 1e-6);
  }
}

// ---- Domain sweep: the result grows with humidity, stays below fibre saturation. ----
let pairs = 0;
for (let celsius = -1; celsius <= 98; celsius += 1) {
  let previous = -1;
  for (let rh = 5; rh <= 95; rh += 1) {
    const result = C.compute({ temp: String(celsius), unit: 'c', rh: String(rh) });
    assert.ok(result.emc > previous, `EMC grows with humidity at ${celsius} C, ${rh}%`);
    assert.ok(result.emc > 0 && result.emc < 30, `EMC stays below fibre saturation at ${celsius} C, ${rh}%`);
    assert.ok(Math.abs(result.headroom - (30 - result.emc)) < 1e-9, 'headroom is 30 minus EMC');
    previous = result.emc;
    pairs += 1;
  }
}
assert.equal(pairs, 100 * 91, 'one hundred temperatures by ninety humilities');

// ---- Humidity table: the grid, the inserted reading and the highlight. ----
const at65 = C.compute({ temp: '20', unit: 'c', rh: '65' });
assert.equal(at65.rows.length, 10, 'nine grid rows plus the entered reading');
assert.equal(Array.from(at65.rows, (row) => row.rh).join(','), '20,30,40,50,60,65,70,80,90,95',
  'the rows are sorted and the entered humidity is inserted');
assert.equal(at65.rows.filter((row) => row.current).length, 1, 'exactly one row is current');
assert.equal(at65.rows.find((row) => row.current).rh, 65, 'the current row is the entered humidity');
const at50 = C.compute({ temp: '20', unit: 'c', rh: '50' });
assert.equal(at50.rows.length, 9, 'a humidity on the grid adds no row');
assert.equal(at50.rows.filter((row) => row.current).length, 1, 'the grid row is highlighted');
assert.equal(at50.rows.find((row) => row.current).rh, 50, 'the highlighted row is 50%');
for (const row of at65.rows) {
  close(row.emc, C.compute({ temp: '20', unit: 'c', rh: String(row.rh) }).emc, `table row at ${row.rh}%`);
}

// ---- Ranges and refusals that the catalog does not already cover. ----
assert.equal(failure({ temp: '20', unit: 'c', rh: '4' }), 'Relative humidity must be between 5 and 95 %.');
assert.equal(failure({ temp: '20', unit: 'c', rh: '96' }), 'Relative humidity must be between 5 and 95 %.');
assert.equal(failure({ temp: '30', unit: 'f', rh: '50' }), null, '30 F is accepted');
assert.equal(failure({ temp: '29.9', unit: 'f', rh: '50' }), 'Air temperature must be between 30 and 210 \u00b0F.');
assert.equal(failure({ temp: '-1.1', unit: 'c', rh: '50' }), null, '-1.1 C is accepted');
assert.equal(failure({ temp: '-1.2', unit: 'c', rh: '50' }), 'Air temperature must be between -1.1 and 98.9 \u00b0C.');
assert.equal(failure({ temp: '20', unit: 'c', rh: 'abc' }), 'Relative humidity must be a number.');
assert.equal(failure({ temp: '20', unit: 'x', rh: '65' }), 'Choose the temperature unit.');

// ---- Page contract. ----
assert.match(html, /<html lang="en">/, 'language declared');
assert.match(html, /name="viewport"/, 'viewport declared');
assert.match(html, /<main>/, 'main landmark');
assert.match(html, /<h1>Wood Equilibrium Moisture Content Calculator<\/h1>/, 'page heading');
assert.match(html, /<form id="emc-form" novalidate>/, 'form is marked novalidate');
assert.match(html, /<button type="submit">Calculate moisture content<\/button>/, 'submit button');
for (const id of ['temp', 'temp-unit', 'rh']) {
  assert.match(html, new RegExp(`<label for="${id}">`), `label for ${id}`);
  assert.match(html, new RegExp(`id="${id}"`), `control ${id}`);
}
assert.match(html, /id="err" role="alert" aria-live="polite"/, 'errors are announced');
assert.match(html, /id="out" aria-live="polite" aria-atomic="true"/, 'result is announced');
assert.match(html, /table&nbsp;4&ndash;2/, 'the page names the table it follows');
assert.match(html, /sorption hysteresis/, 'the page states the hysteresis limit');
assert.match(html, /not a meter reading/, 'the page says it does not measure the board');
assert.match(html, /nothing is sent or stored/, 'the local-only promise is stated');
assert.ok(!/src="https?:\/\//.test(html), 'no off-site script or image');
assert.ok(!/<a [^>]*href="https?:/.test(html), 'no off-site link in the page body');

console.log('wood-equilibrium-moisture-calculator: 12 catalog cases, table 4-2 row, 9,100-cell sweep, unit path and page contract OK');
