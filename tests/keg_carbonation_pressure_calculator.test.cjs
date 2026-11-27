/* Keg carbonation pressure: the published draught chart, row fits, altitude,
   units, formatting, validation, random checks, catalog replay and the page
   contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'keg-carbonation-pressure-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* keg-carbonation-core:start */';
const endMarker = '/* keg-carbonation-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = KegCarbonationCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (temperature, temperatureUnit, volumes, altitude, altitudeUnit) =>
  plain(C.parse(temperature, temperatureUnit, volumes, altitude, altitudeUnit));
const failure = (temperature, temperatureUnit, volumes, altitude, altitudeUnit) => {
  try { run(temperature, temperatureUnit, volumes, altitude, altitudeUnit); } catch (error) { return error.message; }
  return null;
};

// ---- The chart is the published table: ten 1 F rows by eleven 0.1-volume columns.
assert.deepEqual(plain(C.TEMPS_F), [33, 34, 35, 36, 37, 38, 39, 40, 41, 42]);
assert.deepEqual(plain(C.VOLUMES.map((value) => Number(value.toFixed(1)))),
  [2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.0, 3.1]);
assert.equal(C.CHART_PSI.length, 10, 'ten temperature rows');
for (const row of C.CHART_PSI) {
  assert.equal(row.length, 11, 'eleven volume columns');
  for (let index = 1; index < row.length; index += 1) {
    assert.ok(row[index] > row[index - 1], 'a row rises with carbonation');
  }
  for (const value of row) {
    assert.equal(Math.round(value * 10) / 10, value, 'every cell is printed to 0.1 psi');
  }
}
for (let column = 0; column < 11; column += 1) {
  for (let row = 1; row < 10; row += 1) {
    assert.ok(C.CHART_PSI[row][column] > C.CHART_PSI[row - 1][column],
      'pressure rises with temperature at volume column ' + column);
  }
}
// The printed anchors the Brewers Association document quotes in its examples.
assert.equal(C.CHART_PSI[C.TEMPS_F.indexOf(38)][C.VOLUMES.indexOf(2.5)], 11.3);
assert.equal(C.CHART_PSI[C.TEMPS_F.indexOf(36)][C.VOLUMES.indexOf(2.6)], 11.3);

// ---- Row fits: independent least squares reproduces every printed cell.
const fit = (row) => {
  const n = row.length;
  const meanX = C.VOLUMES.reduce((sum, value) => sum + value, 0) / n;
  const meanY = row.reduce((sum, value) => sum + value, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let index = 0; index < n; index += 1) {
    sxy += (C.VOLUMES[index] - meanX) * (row[index] - meanY);
    sxx += (C.VOLUMES[index] - meanX) ** 2;
  }
  return { intercept: meanY - (sxy / sxx) * meanX, slope: sxy / sxx };
};
let worst = 0;
C.CHART_PSI.forEach((row, rowIndex) => {
  const expected = fit(row);
  const actual = C.ROWS[rowIndex];
  assert.ok(Math.abs(actual.slope - expected.slope) <= 1e-12, 'row ' + rowIndex + ' slope');
  assert.ok(Math.abs(actual.intercept - expected.intercept) <= 1e-12, 'row ' + rowIndex + ' intercept');
  row.forEach((printed, column) => {
    const deviation = Math.abs(actual.intercept + actual.slope * C.VOLUMES[column] - printed);
    worst = Math.max(worst, deviation);
  });
});
assert.ok(worst <= 0.06, 'a fitted row reproduces every printed cell within rounding, worst ' + worst);
// A synthetic perfect line recovers its own coefficients.
const synthetic = C.fitRow([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
assert.ok(Math.abs(synthetic.slope - 10) < 1e-12, 'a perfect line of slope ten');
assert.ok(Math.abs(synthetic.intercept + 21) < 1e-12, 'its intercept');

// ---- Henry's law: each row is a straight line, so its second differences vanish.
for (const row of C.CHART_PSI) {
  for (let index = 2; index < row.length; index += 1) {
    assert.ok(Math.abs((row[index] - row[index - 1]) - (row[index - 1] - row[index - 2])) <= 0.12,
      'row stays linear in pressure against volumes');
  }
}

// ---- The published worked values, in both directions of the same row.
assert.equal(run('38', 'f', '2.5', '0', 'ft').pressureText, '11.3 psi');
assert.equal(run('36', 'f', '2.6', '0', 'ft').pressureText, '11.3 psi');
assert.equal(run('38', 'f', '2.5', '4000', 'ft').pressureText, '13.3 psi');
assert.equal(run('38', 'f', '2.5', '4000', 'ft').addition, 2, 'the published +1 psi per 2,000 ft');
assert.equal(run('33', 'f', '2.1', '0', 'ft').pressureText, '5.0 psi');
assert.equal(run('42', 'f', '3.1', '0', 'ft').pressureText, '20.1 psi');
assert.equal(run('40', 'f', '2.5', '0', 'ft').pressureText, '12.4 psi');
assert.equal(run('38', 'f', '2.5', '0', 'ft').gauge, C.seaLevelPsi(2.5, 38), 'no altitude, one pressure');

// ---- Temperature interpolation sits on the straight line between two rows.
const half = C.seaLevelPsi(2.7, 37.5);
const low = C.seaLevelPsi(2.7, 37);
const high = C.seaLevelPsi(2.7, 38);
assert.ok(Math.abs(half - (low + high) / 2) < 1e-9, 'half a degree is the midpoint');
for (let temp = 33; temp < 42; temp += 0.5) {
  assert.ok(C.seaLevelPsi(2.5, temp + 0.5) >= C.seaLevelPsi(2.5, temp) - 1e-12,
    'pressure never falls as the beer warms');
}
for (let volume = 2.0; volume < 3.6; volume += 0.05) {
  assert.ok(C.seaLevelPsi(volume + 0.05, 38) > C.seaLevelPsi(volume, 38),
    'pressure rises with carbonation');
}
assert.equal(C.seaLevelPsi(2.5, 33), C.ROWS[0].intercept + C.ROWS[0].slope * 2.5, 'the coldest row is exact');
assert.equal(C.seaLevelPsi(2.5, 42), C.ROWS[9].intercept + C.ROWS[9].slope * 2.5, 'the warmest row is exact');

// ---- Altitude, in feet and metres, follows the chart's own rule.
assert.equal(C.PSI_PER_FT, 1 / 2000);
assert.ok(Math.abs(run('38', 'f', '2.5', '1000', 'ft').addition - 0.5) < 1e-12);
assert.ok(Math.abs(run('38', 'f', '2.5', '10000', 'ft').addition - 5) < 1e-12);
assert.ok(Math.abs(run('38', 'f', '2.5', '3048', 'm').addition - 5) < 1e-9, '3,048 m is 10,000 ft');
assert.equal(run('38', 'f', '2.5', '10000', 'ft').pressureText, '16.3 psi');
assert.equal(run('38', 'f', '2.5', '', 'ft').pressureText, '11.3 psi', 'a blank altitude is sea level');
assert.equal(run('38', 'f', '2.5', '0', 'm').pressureText, '11.3 psi');

// ---- Pressure and gas units.
assert.equal(C.BAR_PER_PSI, 0.06894757293168);
assert.equal(C.KPA_PER_PSI, 6.894757293168);
const example = run('38', 'f', '2.5', '0', 'ft');
assert.ok(Math.abs(example.bar - 11.325454545454544 * 0.06894757293168) < 1e-12);
assert.ok(Math.abs(example.kpa - 11.325454545454544 * 6.894757293168) < 1e-12);
assert.ok(Math.abs(example.kpa - example.bar * 100) < 1e-9, 'a bar is a hundred kilopascals');
assert.ok(Math.abs(C.KPA_PER_PSI - C.BAR_PER_PSI * 100) < 1e-12, 'the constants share one bar');
assert.ok(Math.abs(C.GRAMS_PER_VOLUME - 44.0095 / 22.41397) < 1e-15);
assert.ok(Math.abs(C.GRAMS_PER_VOLUME - 1.9635) < 5e-5, 'one volume is 1.9635 g/L');
assert.ok(Math.abs(example.gramsPerLitre - 4.9087) < 5e-4);

// ---- Formatting is half away from zero and trims only for display.
assert.equal(C.round(0.15, 1), 0.2, 'a binary tie rounds up');
assert.equal(C.round(-0.15, 1), -0.2, 'and away from zero on the negative side');
assert.equal(C.round(2.45, 1), 2.5);
assert.equal(C.fixed(11.325454545454544, 1), '11.3');
assert.equal(C.fixed(0.7808626, 2), '0.78');
assert.equal(C.fixed(78.0862603, 1), '78.1');
assert.equal(C.tidy(38, 1), '38');
assert.equal(C.tidy(2.5, 2), '2.5');
assert.equal(C.tidy(0, 0), '0');
assert.ok(Math.abs(C.celsiusToFahrenheit(3.3) - 37.94) < 1e-9);
assert.ok(Math.abs(C.fahrenheitToCelsius(38) - 3.3333333333333335) < 1e-12);

// ---- Validation: exact wording, and the bounds themselves are accepted.
assert.equal(failure('', 'f', '2.5', '0', 'ft'), 'Enter the beer temperature.');
assert.equal(failure('   ', 'f', '2.5', '0', 'ft'), 'Enter the beer temperature.');
assert.equal(failure(null, 'f', '2.5', '0', 'ft'), 'Enter the beer temperature.');
assert.equal(failure('cold', 'f', '2.5', '0', 'ft'), 'Enter the temperature as a number, such as 38.');
assert.equal(failure('38 F', 'f', '2.5', '0', 'ft'), 'Enter the temperature as a number, such as 38.');
assert.equal(failure('32', 'f', '2.5', '0', 'ft'),
  'The published chart covers 33\u201342 \u00b0F (0.6\u20135.6 \u00b0C).');
assert.equal(failure('43', 'f', '2.5', '0', 'ft'),
  'The published chart covers 33\u201342 \u00b0F (0.6\u20135.6 \u00b0C).');
assert.equal(failure('0.5', 'c', '2.5', '0', 'ft'),
  'The published chart covers 0.6\u20135.6 \u00b0C (33\u201342 \u00b0F).');
assert.equal(failure('5.7', 'c', '2.5', '0', 'ft'),
  'The published chart covers 0.6\u20135.6 \u00b0C (33\u201342 \u00b0F).');
assert.equal(failure('38', 'f', '', '0', 'ft'), 'Enter the target carbonation.');
assert.equal(failure('38', 'f', 'fizzy', '0', 'ft'), 'Enter the carbonation as a number, such as 2.5.');
assert.equal(failure('38', 'f', '1.9', '0', 'ft'),
  'Enter 2.0 to 3.6 volumes of CO\u2082; the chart itself covers 2.1 to 3.1.');
assert.equal(failure('38', 'f', '3.7', '0', 'ft'),
  'Enter 2.0 to 3.6 volumes of CO\u2082; the chart itself covers 2.1 to 3.1.');
assert.equal(failure('38', 'f', '2.5', 'high', 'ft'), 'Enter the altitude as a number, such as 0.');
assert.equal(failure('38', 'f', '2.5', '-1', 'ft'), 'Enter an altitude between 0 and 10,000 ft (0 to 3,048 m).');
assert.equal(failure('38', 'f', '2.5', '10001', 'ft'), 'Enter an altitude between 0 and 10,000 ft (0 to 3,048 m).');
assert.equal(failure('38', 'f', '2.5', '3049', 'm'), 'Enter an altitude between 0 and 10,000 ft (0 to 3,048 m).');
assert.equal(failure('33', 'f', '2.0', '0', 'ft'), null, 'the supported floor is accepted');
assert.equal(failure('42', 'f', '3.6', '0', 'ft'), null, 'the supported ceiling is accepted');
assert.equal(failure('0.6', 'c', '2.1', '0', 'ft'), null, 'the Celsius floor is accepted');
assert.equal(failure('5.6', 'c', '3.1', '0', 'ft'), null, 'the Celsius ceiling is accepted');
assert.equal(failure('38', 'f', '2.5', '10000', 'ft'), null, 'the altitude ceiling is accepted');
assert.equal(failure('38', 'f', '2.5', '1,000', 'ft'), null, 'grouped input is accepted');

// ---- Random cases stay on the fitted row and keep their ordering.
let seed = 20261127;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let iteration = 0; iteration < 200; iteration += 1) {
  const tempF = Number((33 + random() * 9).toFixed(1));
  const volumes = Number((2 + random() * 1.6).toFixed(2));
  const feet = Number((random() * 10000).toFixed(0));
  const label = 'random ' + tempF + ' F ' + volumes + ' vols ' + feet + ' ft';
  const result = run(String(tempF), 'f', String(volumes), String(feet), 'ft');
  const line = C.lineAt(tempF);
  const expected = line.intercept + line.slope * volumes + feet / 2000;
  assert.ok(Math.abs(result.gauge - expected) < 1e-9, label + ' gauge');
  assert.equal(result.pressureText, C.fixed(expected, 1) + ' psi', label + ' text');
  assert.ok(result.gauge >= 0, label + ' non-negative gauge');
  assert.ok(Math.abs(result.bar * C.KPA_PER_PSI - result.kpa * C.BAR_PER_PSI) < 1e-9, label + ' units agree');
  assert.equal(result.extended, volumes < 2.1 || volumes > 3.1, label + ' extension flag');
  assert.deepEqual(run(String(tempF), 'f', String(volumes), String(feet), 'ft'), result, label + ' deterministic');
  const warmer = run(String(Math.min(tempF + 0.1, 42)), 'f', String(volumes), String(feet), 'ft');
  assert.ok(warmer.gauge >= result.gauge - 1e-9, label + ' monotone in temperature');
}

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Keg Carbonation Pressure Calculator');
assert.equal(record.category, 'Food');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.icon, '\u{1F37A}');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.method.includes('Henry'), 'method states the gas law behind the rows');
assert.ok(record.method.includes('2,000 ft') || record.method.includes('2,000'), 'method states the altitude rule');
assert.ok(record.method.includes('browser') || record.method.includes('network'), 'method documents local execution');
assert.ok(record.sources.length >= 2, 'sources are cited');
for (const source of record.sources) {
  assert.ok(source.title.length > 20, 'a source names the document and the part used');
  assert.match(source.url, /^https:\/\//, 'every source has an absolute https URL');
}
assert.ok(record.sources.some((source) => source.url.includes('brewersassociation.org')),
  'the Brewers Association chart is cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 16, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 4, 'four validation cases');
for (const testCase of record.testCases) {
  const { temperature, temperatureUnit, volumes, altitude, altitudeUnit } = testCase.input;
  if (testCase.expectedError) {
    assert.equal(failure(temperature, temperatureUnit, volumes, altitude, altitudeUnit),
      testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(temperature, temperatureUnit, volumes, altitude, altitudeUnit);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (key === 'pressureText') assert.equal(result.pressureText, expected, testCase.name);
    else if (key === 'extended') assert.equal(result.extended, expected, testCase.name);
    else if (key === 'cellPsi') assert.equal(result.cell ? result.cell.psi : null, expected, testCase.name);
    else assert.ok(Math.abs(result[key] - expected) <= 0.05, testCase.name + ' ' + key);
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
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');
for (const tag of ['brewing', 'beer', 'carbonation', 'keg', 'pressure']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 7, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="temperature">/.test(html), 'the temperature field has a visible label');
assert.ok(/<label for="volumes">/.test(html), 'the carbonation field has a visible label');
assert.ok(/<label for="altitude">/.test(html), 'the altitude field has a visible label');
assert.ok(/aria-label="Temperature unit"/.test(html) && /aria-label="Altitude unit"/.test(html), 'the unit pickers are named');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="decimal"/.test(html), 'a numeric keyboard is offered on touch');
assert.ok(/<form id="pressure-form" novalidate>/.test(html), 'the form is a real form and does not native-validate');
assert.equal((html.match(/<select/g) || []).length, 2, 'only the two unit pickers are selects');
assert.equal((html.match(/<option value="f" selected>/g) || []).length, 1, 'Fahrenheit is the default');
assert.equal((html.match(/<option value="ft" selected>/g) || []).length, 1, 'feet are the default altitude unit');
assert.ok(/id="temperature"[^>]*value="38"/.test(html), 'the page opens at 38 F');
assert.ok(/id="volumes"[^>]*value="2.5"/.test(html), 'and 2.5 volumes');
assert.ok(/id="altitude"[^>]*value="0"/.test(html), 'at sea level');
assert.ok(!/https?:\/\//.test(html), 'the page loads nothing from another origin');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'the page stores nothing');
assert.ok(/^[\x00-\x7F]*$/.test(html), 'the source is ASCII so it can be served in any encoding');
assert.ok(/<meta name="description"/.test(html), 'the page carries a description');
assert.ok(html.includes('Brewers Association'), 'the page names the source of the chart');
