/* Regression checks for the tolerance stack-up core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'tolerance-stack-up-calculator';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* tolerance-stack-core:start */');
const end = html.indexOf('/* tolerance-stack-core:end */');
assert.ok(start > -1 && end > start, 'tolerance stack core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '\nmodule.exports = ToleranceStack;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Tolerance Stack-Up Calculator');
assert.equal(entry.category, 'Mechanical & Structural Engineering');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.reviewedAt, null);
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 10, 'aliases present');
assert.ok(Array.isArray(entry.sources), 'sources array present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 600, 'method documented');
assert.ok(entry.testCases.length >= 10, 'catalog cases present');
assert.equal(catalog.tools.length, 2296, 'catalog total');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Mechanical & Structural Engineering').length, 45,
  'Mechanical & Structural Engineering count');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');
const aliases = catalog.tools.flatMap((tool) => (tool.slug === slug ? [] : tool.aliases || []))
  .map((alias) => alias.toLowerCase());
for (const alias of entry.aliases) {
  assert.ok(!aliases.includes(alias.toLowerCase()), `alias ${alias} is already used`);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug &&
  /tolerance stack|tolerance analysis|root sum square|worst case tolerance|rss tolerance/i
    .test([tool.name, ...(tool.aliases || []), ...(tool.tags || [])].join(' '))),
'no other tolerance stack tool');

const failure = (input) => {
  try {
    C.compute(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
const close = (actual, expected, label) => {
  assert.ok(Math.abs(actual - expected) <= 1e-9, `${label}: ${actual} != ${expected}`);
};

// --- Catalog cases through the shipped core. ---
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expected.error, testCase.name);
    continue;
  }
  const result = C.compute(testCase.input);
  const expected = testCase.expected;
  close(result.nominal, expected.nominal, `${testCase.name}: nominal`);
  close(result.worstCase.tolerance, expected.worstCaseTolerance, `${testCase.name}: worst-case tolerance`);
  close(result.worstCase.min, expected.worstCaseMin, `${testCase.name}: worst-case low`);
  close(result.worstCase.max, expected.worstCaseMax, `${testCase.name}: worst-case high`);
  close(result.rss.tolerance, expected.rssTolerance, `${testCase.name}: RSS tolerance`);
  close(result.rss.min, expected.rssMin, `${testCase.name}: RSS low`);
  close(result.rss.max, expected.rssMax, `${testCase.name}: RSS high`);
  if (expected.worstCaseFits === null) {
    assert.equal(result.limits, null, `${testCase.name}: no limits means no verdict`);
  } else {
    assert.equal(result.limits.worstCaseFits, expected.worstCaseFits, `${testCase.name}: worst-case verdict`);
    assert.equal(result.limits.rssFits, expected.rssFits, `${testCase.name}: RSS verdict`);
  }
}

// --- Input validation. ---
assert.equal(failure({ unit: 'mm', rows: [] }), 'Enter at least one dimension.');
assert.equal(failure({ unit: 'mm', rows: [{ nominal: '', tolerance: '' }] }), 'Enter at least one dimension.');
assert.equal(failure({ unit: 'ft', rows: [{ nominal: 5, tolerance: 0.1 }] }), 'Choose millimetres or inches.');
assert.equal(failure({ unit: 'mm', rows: [{ nominal: 5, tolerance: -0.1 }] }),
  'Enter a tolerance of zero or more for dimension 1.');
assert.equal(failure({ unit: 'mm', rows: [{ nominal: 'five', tolerance: 0.1 }] }),
  'Enter a nominal value for dimension 1.');
assert.equal(failure({ unit: 'mm', rows: [{ nominal: 5, tolerance: '0.1junk' }] }),
  'Enter a tolerance of zero or more for dimension 1.');
assert.equal(failure({ unit: 'mm', rows: [{ nominal: 5, tolerance: 0.1 }], limitMin: 'lo' }),
  'Enter the smallest allowed total as a number.');
assert.equal(failure({ unit: 'mm', rows: [{ nominal: 5, tolerance: 0.1 }], limitMax: 'hi' }),
  'Enter the largest allowed total as a number.');
assert.equal(failure({ unit: 'mm', rows: [{ nominal: 5, tolerance: 0.1 }], limitMin: 6, limitMax: 5 }),
  'The smallest allowed total must not exceed the largest.');
assert.equal(failure({ unit: 'mm', rows: Array.from({ length: 13 }, () => ({ nominal: 1, tolerance: 0.1 })) }),
  'Keep the stack to 12 dimensions or fewer.');

// --- Blank tolerance means zero, blank rows are skipped, signs act on nominal only. ---
const skipped = C.compute({ unit: 'mm', rows: [{ nominal: 10, tolerance: '' }, { nominal: '', tolerance: '' }] });
assert.equal(skipped.count, 1);
assert.equal(skipped.nominal, 10);
assert.equal(skipped.worstCase.tolerance, 0);
assert.equal(skipped.rss.tolerance, 0);
assert.equal(skipped.contributions[0].worstCaseShare, 0, 'no spread means no share');

// --- Generated stacks against an independent model written here. ---
const independent = (rows) => {
  let nominal = 0;
  let magnitudes = [];
  rows.forEach((row) => {
    const value = Number(row.nominal);
    const tolerance = row.tolerance === '' ? 0 : Number(row.tolerance);
    nominal += (row.sign === '-' ? -1 : 1) * value;
    magnitudes.push(tolerance);
  });
  const worst = magnitudes.reduce((total, value) => total + value, 0);
  const squares = magnitudes.map((value) => value * value);
  const rss = Math.sqrt(squares.reduce((total, value) => total + value, 0));
  return { nominal, worst, rss };
};
let generated = 0;
let seed = 20261114;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let run = 0; run < 600; run += 1) {
  const count = 1 + Math.floor(random() * 6);
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    rows.push({
      nominal: (random() * 200 - 20).toFixed(3),
      tolerance: (random() * 0.5).toFixed(3),
      sign: random() < 0.3 ? '-' : '+'
    });
  }
  const result = C.compute({ unit: 'mm', rows });
  const expected = independent(rows);
  close(result.nominal, expected.nominal, `generated ${run}: nominal`);
  close(result.worstCase.tolerance, expected.worst, `generated ${run}: worst case`);
  close(result.rss.tolerance, expected.rss, `generated ${run}: RSS`);
  assert.ok(result.rss.tolerance <= result.worstCase.tolerance + 1e-12, `generated ${run}: RSS within worst case`);
  close(result.worstCase.max - result.worstCase.min, 2 * result.worstCase.tolerance, `generated ${run}: band width`);
  const shareTotal = result.contributions.reduce((total, item) => total + item.worstCaseShare, 0);
  close(shareTotal, 1, `generated ${run}: shares add up`);
  generated += 1;
}

// --- One more dimension never narrows a band. ---
const short = C.compute({ unit: 'mm', rows: [{ nominal: 30, tolerance: 0.1 }] });
const longer = C.compute({ unit: 'mm', rows: [{ nominal: 30, tolerance: 0.1 }, { nominal: 2, tolerance: 0.05 }] });
assert.ok(longer.worstCase.tolerance > short.worstCase.tolerance, 'adding tolerance widens the worst case');
assert.ok(longer.rss.tolerance > short.rss.tolerance, 'adding tolerance widens the RSS band');
assert.equal(short.worstCase.tolerance, short.rss.tolerance, 'one dimension: both methods agree');

// --- A single limit is enough for a verdict. ---
const lowerOnly = C.compute({ unit: 'mm', rows: [{ nominal: 12.5, tolerance: 0.3 }], limitMin: 12.2 });
assert.equal(lowerOnly.limits.worstCaseFits, true);
const upperOnly = C.compute({ unit: 'mm', rows: [{ nominal: 12.5, tolerance: 0.3 }], limitMax: 12.7 });
assert.equal(upperOnly.limits.worstCaseFits, false);
assert.equal(C.compute({ unit: 'mm', rows: [{ nominal: 12.5, tolerance: 0.3 }], limitMin: '' }).limits, null);

// --- Shipped defaults and examples. ---
assert.equal(C.MAX_ROWS, 12);
assert.equal(C.DEFAULTS.unit, 'mm');
assert.equal(C.DEFAULTS.rows.length, 3);
assert.equal(Object.keys(C.EXAMPLES).length, 4);
for (const example of Object.values(C.EXAMPLES)) {
  const result = C.compute({ unit: example.unit, rows: example.rows, limitMin: example.limitMin, limitMax: example.limitMax });
  assert.ok(Number.isFinite(result.nominal) && result.nominal > 0, 'example total is finite');
}
const clearance = C.compute(Object.assign({}, C.EXAMPLES.clearance));
assert.equal(clearance.limits.worstCaseFits, false, 'clearance example fails at worst case');
assert.equal(clearance.limits.rssFits, true, 'clearance example passes at RSS');
assert.match(C.summarise(clearance), /worst case 0\.25 to 0\.75/);
assert.match(C.summarise(clearance), /does not fit at worst case/);

// --- Page contract. ---
assert.match(html, /<title>Tolerance Stack-Up Calculator — virt\.tools<\/title>/);
assert.match(html, /name="description" content="[^"]*Runs locally in your browser/);
assert.match(html, /<h1>Tolerance Stack-Up Calculator<\/h1>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
for (const id of ['unit', 'limit-min', 'limit-max', 'dims', 'add', 'calculate', 'reset', 'result', 'copy']) {
  assert.ok(html.includes(`id="${id}"`), `control ${id}`);
}
assert.ok(html.includes('<label for="unit">') && html.includes('<label for="limit-min">') &&
  html.includes('<label for="limit-max">'), 'limits are labelled');
assert.match(html, /role="status" aria-live="polite"/);
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no third-party scripts');
assert.ok(!/<link[^>]+href="https?:/.test(html), 'no third-party styles');
assert.ok(!/\son(click|change|input|submit)=/i.test(html), 'no inline event handlers');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), 'no network or storage');
assert.ok(html.includes('overflow-x:auto'), 'wide breakdown table scrolls inside its wrapper');
assert.ok(html.includes('min-height:44px'), 'controls stay finger sized');

console.log(`tolerance stack-up: ${entry.testCases.length} catalog cases, ${generated} generated stacks ok`);
