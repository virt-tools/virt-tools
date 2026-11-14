/* Regression checks for the choropleth class-breaks core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'choropleth-class-breaks';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* cls-breaks-core:start */');
const end = html.indexOf('/* cls-breaks-core:end */');
assert.ok(start > -1 && end > start, 'choropleth core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '\nmodule.exports = ClassBreaks;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Geography');
assert.equal(entry.subcategory, 'Analysis & validation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.icon, '\u{1F5FA}\u{FE0F}');
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 6, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 3, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 800, 'method documented');
assert.equal(catalog.tools.length, 2278, 'catalog total');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');
const aliases = catalog.tools.flatMap((tool) => (tool.slug === slug ? [] : tool.aliases || []))
  .map((alias) => alias.toLowerCase());
for (const alias of entry.aliases) {
  assert.ok(!aliases.includes(alias.toLowerCase()), `alias ${alias} is already used`);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && /choropleth|class break/i.test(tool.name)),
  'no other choropleth or class-break tool');

const failure = (input) => {
  try {
    C.compute(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
const close = (left, right, tolerance = 1e-9) => Math.abs(Number(left) - Number(right)) <= tolerance ? true : false;
const same = (left, right, label) => assert.equal(JSON.stringify(Array.from(left)), JSON.stringify(right), label);

// --- Constants and defaults. ---
assert.equal(C.MAX_VALUES, 5000);
assert.equal(C.MIN_CLASSES, 2);
assert.equal(C.MAX_CLASSES, 9);
assert.equal(C.MIN_VALUE, -1000000000);
assert.equal(C.MAX_VALUE, 1000000000);
const defaults = C.compute({});
assert.equal(defaults.method, 'quantile');
assert.equal(defaults.classes, 5);
assert.equal(defaults.count, 24);
assert.equal(defaults.min, 12);
assert.equal(defaults.max, 980);
assert.equal(defaults.range, 968);
same(defaults.breaks, [12, 41.8, 75.8, 139.2, 280, 980], 'default breaks');
same(defaults.bins.map((bin) => bin.count), [5, 5, 4, 5, 5], 'default counts');
assert.equal(defaults.median, 101.5);
assert.ok(close(defaults.mean, 190.2083), 'default mean');
assert.equal(defaults.equalWidth, null);

// --- Every catalog case must agree with the core. ---
let goldenCount = 0;
let boundaryCount = 0;
let validationCount = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    validationCount += 1;
    assert.equal(failure(testCase.input), testCase.expectedError, `${testCase.name}: validation message`);
    continue;
  }
  if (testCase.kind === 'golden') goldenCount += 1;
  else if (testCase.kind === 'boundary') boundaryCount += 1;
  else assert.fail(`unexpected test kind ${testCase.kind}`);
  const result = C.compute(testCase.input);
  const expected = testCase.expected;
  for (const key of ['classes', 'count']) {
    assert.equal(result[key], expected[key], `${testCase.name}: ${key}`);
  }
  for (const key of ['min', 'max', 'range', 'mean', 'median']) {
    if (expected[key] === undefined) continue;
    assert.ok(close(result[key], expected[key]), `${testCase.name}: ${key} ${result[key]} != ${expected[key]}`);
  }
  for (const key of ['breaks', 'shares']) {
    assert.equal(result[key === 'breaks' ? 'breaks' : 'bins'].length, expected[key].length,
      `${testCase.name}: ${key} length`);
    result[key === 'breaks' ? 'breaks' : 'bins'].forEach((value, index) => {
      const actual = key === 'breaks' ? value : value.share;
      assert.ok(close(actual, expected[key][index]), `${testCase.name}: ${key}[${index}] ${actual} != ${expected[key][index]}`);
    });
  }
  same(result.bins.map((bin) => bin.count), expected.counts, `${testCase.name}: counts`);
  same(result.bins.filter((bin) => bin.count === 0).map((bin) => bin.index),
    expected.emptyClasses, `${testCase.name}: empty classes`);
  assert.equal(result.largest.index, expected.largest.index, `${testCase.name}: largest class`);
  assert.equal(result.largest.count, expected.largest.count, `${testCase.name}: largest count`);
  assert.ok(close(result.largest.share, expected.largest.share), `${testCase.name}: largest share`);
  if (expected.equalWidth !== undefined) {
    assert.ok(close(result.equalWidth, expected.equalWidth), `${testCase.name}: equal width`);
  }
}
assert.equal(goldenCount, 6, 'expected six golden cases');
assert.equal(boundaryCount, 6, 'expected six boundary cases');
assert.equal(validationCount, 12, 'expected twelve validation cases');

// --- Independent structural checks over many generated datasets. ---
let seed = 20261114;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const round = (value, places) => {
  const factor = Math.pow(10, places);
  return Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
};
const precisionFor = (span) => Math.max(0, Math.min(12, 6 - Math.floor(Math.log10(span))));
let sweeps = 0;
for (let roundIndex = 0; roundIndex < 300; roundIndex += 1) {
  const count = 2 + Math.floor(random() * 40);
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const scale = Math.pow(10, Math.floor(random() * 7) - 3);
    values.push(Math.round(random() * 1000 * scale) / (scale === 0 ? 1 : 1));
  }
  if (new Set(values).size === 1) values[0] += 1;
  const classes = 2 + Math.floor(random() * 8);
  const method = random() < 0.5 ? 'quantile' : 'equal';
  const input = { values: values.join(', '), classes: String(classes), method };
  const result = C.compute(input);

  // Breaks run from the minimum to the maximum and never step backwards.
  assert.equal(result.breaks.length, classes + 1, 'break count');
  assert.equal(result.breaks[0], result.min, 'first break is the minimum');
  assert.equal(result.breaks[classes], result.max, 'last break is the maximum');
  for (let index = 1; index <= classes; index += 1) {
    assert.ok(result.breaks[index] >= result.breaks[index - 1], 'breaks never fall');
  }
  // Counts and shares are exhaustive and consistent.
  const total = result.bins.reduce((sum, bin) => sum + bin.count, 0);
  assert.equal(total, count, 'every value lands in a class');
  for (const bin of result.bins) {
    assert.ok(close(bin.share, round(100 * bin.count / count, 1)), 'share follows the count');
  }
  // Independent membership: count each class straight from its range.
  for (const bin of result.bins) {
    const top = bin.index === classes;
    const expectedCount = values.filter((value) =>
      value >= bin.low && (top ? value <= bin.high : value < bin.high)).length;
    assert.equal(bin.count, expectedCount, `class ${bin.index} count matches its range`);
  }
  // The precision of the output follows the range.
  const places = precisionFor(result.max - result.min);
  for (const value of result.breaks) {
    assert.ok(close(value, round(value, places)), 'breaks carry the documented precision');
  }
  if (method === 'equal') {
    for (let index = 1; index <= classes; index += 1) {
      const width = result.breaks[index] - result.breaks[index - 1];
      const nominal = (result.max - result.min) / classes;
      assert.ok(Math.abs(width - nominal) <= Math.pow(10, -places) + 1e-9,
        `equal interval width ${width} against ${nominal}`);
    }
  } else {
    // Distinct values put floor(n/k) or ceil(n/k) in each class.
    if (new Set(values).size === count) {
      const low = Math.floor(count / classes);
      const high = Math.ceil(count / classes);
      for (const bin of result.bins) {
        assert.ok(bin.count >= low - 1 && bin.count <= high + 1,
          `quantile class ${bin.index} holds ${bin.count} of ${count} in ${classes}`);
      }
    } else {
      for (let index = 1; index < classes; index += 1) {
        const ordered = values.slice().sort((left, right) => left - right);
        const position = (count - 1) * index / classes;
        const lower = ordered[Math.floor(position)];
        const upper = ordered[Math.ceil(position)];
        assert.ok(result.breaks[index] >= Math.min(lower, upper) - 1e-9 &&
          result.breaks[index] <= Math.max(lower, upper) + 1e-9, 'break sits between its order statistics');
      }
    }
  }
  sweeps += 1;
}
assert.equal(sweeps, 300, 'three hundred generated datasets');

// --- Quantile breaks carry the type 7 interpolation. ---
const interpolation = C.compute({ values: '0, 10', classes: '4', method: 'quantile' });
same(interpolation.breaks, [0, 2.5, 5, 7.5, 10], 'interpolated quartiles');
assert.equal(C.quantileAt([0, 10], 0.25), 2.5);
const quartiles = C.compute({ values: '1, 2, 3, 4, 5', classes: '4', method: 'quantile' });
same(quartiles.breaks, [1, 2, 3, 4, 5], 'quartiles of five values');

// --- Equal interval splits the range evenly. ---
const equal = C.compute({ values: '0, 100', classes: '5', method: 'equal' });
same(equal.breaks, [0, 20, 40, 60, 80, 100], 'equal interval breaks');
assert.equal(equal.equalWidth, 20);

// --- A value on a break joins the class above it. ---
const onBreak = C.compute({ values: '0, 10, 20, 30', classes: '3', method: 'equal' });
same(onBreak.breaks, [0, 10, 20, 30], 'breaks on the values');
same(onBreak.bins.map((bin) => bin.count), [1, 1, 2], 'break values join the class above');

// --- Notes. ---
const repeated = C.compute({ values: '1, 1, 1, 1, 2, 2, 2, 2, 3, 4', classes: '4', method: 'quantile' });
same(repeated.bins.map((bin) => bin.count), [0, 4, 0, 6], 'duplicates leave empty classes');
assert.equal(repeated.warnings.length, 2, 'empty classes and dominance both reported');
assert.ok(repeated.warnings[0].includes('Classes 1, 3 are empty'), 'empty class note');
const dominance = C.compute({ classes: '5', method: 'equal' });
assert.ok(dominance.warnings.some((line) => line.includes('dominated by one shade')), 'dominance note');
assert.equal(C.compute({ classes: '5', method: 'quantile' }).warnings.length, 0, 'balanced quantile is quiet');
const small = C.compute({ values: '1, 2, 3', classes: '5', method: 'quantile' });
assert.ok(small.warnings.some((line) => line.includes('fewer than two values per class') ||
  line.includes('Fewer than two values per class')), 'small sample note');

// --- Page contract. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'), 'live status region');
for (const id of ['values', 'classes', 'method', 'calculate', 'reset', 'cls-status', 'headline-out',
  'bins-body', 'min-out', 'max-out', 'mean-out', 'median-out', 'largest-out', 'copy', 'copy-status', 'notes']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or output ${id}`);
}
assert.ok(/<form id="cls-form" novalidate>/.test(html), 'form contract');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(/<option value="quantile" selected>/.test(html), 'quantile selected by default');
assert.ok(/<option value="5" selected>/.test(html), 'five classes by default');
assert.ok(/id="values"[^>]*>12, 18, 24/.test(html), 'default value list');
assert.ok(/id="copy"[^>]*disabled/.test(html), 'copy starts disabled');
assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(html), 'no raw HTML sinks');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'no browser storage');
assert.ok(!/https?:\/\//.test(html.replace(/<meta name="description"[^>]*>/, '')), 'no external requests in the page');
assert.ok(!/\bfetch\(|XMLHttpRequest/.test(html), 'no network calls');
assert.ok(!/\beval\s*\(|new Function\s*\(/.test(html), 'no runtime compilation');

console.log(`${slug}: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed; ` +
  `${sweeps} generated datasets, the type 7 interpolation, equal widths, break membership and the notes agreed`);
