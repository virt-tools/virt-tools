/* Air cleaner CADR sizing: replays every catalog case, re-derives the EPA chart rows
   and the clean-air decay arithmetic by hand, and pins the refusals, determinism and
   the offline page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'air-cleaner-cadr-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* cadr-core:start */';
const endMarker = '/* cadr-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|navigator\.|fetch\(|localStorage|XMLHttpRequest/.test(core),
  'the core stays free of DOM, storage and network access');

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CadrCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(catalog.tools.length, 2520, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2259, 'public tools');
assert.equal(entry.category, 'Environment', 'category');
assert.equal(entry.risk, 'low', 'risk');
assert.equal(entry.maturity, 'draft', 'maturity');
assert.equal(entry.listed, true, 'listed');
assert.ok(entry.sources.length >= 2, 'the EPA sizing chart and the CADR definition are cited');
assert.ok(entry.sources.some((source) => /epa\.gov/.test(source.url || '')), 'EPA source');
assert.ok(entry.testCases.length >= 30, `expected at least 30 cases, found ${entry.testCases.length}`);
assert.ok(entry.testCases.some((testCase) => testCase.kind === 'validation'), 'refusals are pinned');
assert.ok(entry.testCases.some((testCase) => testCase.kind === 'golden'), 'goldens are pinned');

const close = (actual, expected, message) => {
  assert.ok(Number.isFinite(actual), `${message}: not a finite number`);
  const tolerance = Math.max(1e-9, Math.abs(expected) * 1e-9);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
};

// ---- Catalog cases: every golden and every refusal, replayed through the page core.
for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(() => C.calculate(testCase.input), (error) => error.message === testCase.expected.error,
      label);
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (key === 'unitsNeeded') {
      assert.equal(result[key], value, `${label}: ${key}`);
    } else {
      close(result[key], value, `${label}: ${key}`);
    }
  }
}

// ---- The EPA chart rows: 0.65 cfm per square foot at an 8 ft ceiling.
const chart = (areaFt2, cadrCfm = '5000') => C.calculate({ units: 'imperial', area: String(areaFt2), height: '8', cadr: cadrCfm });
close(chart(100).requiredCfm, 65, 'the chart gives 65 cfm for 100 ft2');
close(chart(200).requiredCfm, 130, 'the chart gives 130 cfm for 200 ft2');
close(chart(300).requiredCfm, 195, 'the chart gives 195 cfm for 300 ft2');
close(chart(400).requiredCfm, 260, 'the chart gives 260 cfm for 400 ft2');
close(chart(600).requiredCfm, 390, 'the chart gives 390 cfm for 600 ft2');
close(C.calculate({ units: 'imperial', area: '300', height: '8', cadr: '195' }).requiredM3h,
  195 * 1.69901079552, 'the metric rate is the chart rate converted');

// ---- A taller ceiling asks for proportionally more clean air.
close(chart(300).requiredCfm * 1.25,
  C.calculate({ units: 'imperial', area: '300', height: '10', cadr: '5000' }).requiredCfm,
  'a 10 ft ceiling needs a quarter more CADR than 8 ft');
close(C.calculate({ units: 'metric', area: '27.870912', height: '2.4384', cadr: '5000' }).requiredCfm,
  195, '2.4384 m is 8 ft and 27.870912 m2 is 300 ft2');

// ---- Air changes are CADR divided by volume, in both unit systems.
const room = C.calculate({ units: 'metric', area: '20', height: '2.5', cadr: '300' });
close(room.volumeM3, 50, 'twenty square metres at 2.5 m is 50 cubic metres');
close(room.achRequired * room.volumeM3, room.requiredM3h, 'air changes times volume is the CADR');
close(room.achRequired, room.requiredM3h / 50, 'the required air changes use the room volume');
close(room.deliveredAch, 300 / 50, 'the cleaner delivers six air changes an hour');

// ---- Clearance times follow the well-mixed exponential decay.
close(room.timeTo90Min / 60, Math.log(10) * 50 / 300, '90% takes ln 10 room volumes of clean air');
close(room.timeTo99Min / 60, Math.log(100) * 50 / 300, '99% takes ln 100 room volumes');
close(room.timeTo99Min / room.timeTo90Min, 2, 'clearing 99% takes twice as long as 90%');

// ---- Unit switching keeps the same physical room.
const imperial = C.calculate({
  units: 'imperial',
  area: String(20 / C.M2_PER_FT2),
  height: String(2.5 / C.M_PER_FT),
  cadr: String(300 / C.M3H_PER_CFM)
});
close(imperial.requiredCfm, room.requiredCfm, 'the minimum CADR is unit-free');
close(imperial.achRequired, room.achRequired, 'air changes are unit-free');
close(imperial.timeTo90Min, room.timeTo90Min, 'clearance time is unit-free');
close(imperial.volumeM3, room.volumeM3, 'volume is unit-free');

// ---- Units needed rounds up, and an exact match stays at one.
assert.equal(chart(300, '195').unitsNeeded, 1, 'an exact match needs one cleaner');
assert.equal(chart(300, '194').unitsNeeded, 2, 'one cfm short needs a second cleaner');
assert.equal(chart(600, '390').unitsNeeded, 1, 'the chart top row is exactly covered');
assert.equal(chart(600, '389').unitsNeeded, 2, 'the chart top row one cfm short needs two');
assert.equal(C.calculate({ units: 'imperial', area: '300', height: '8', cadr: '3000' }).unitsNeeded, 1,
  'a larger cleaner still counts as one');

// ---- The largest room figure inverts the same rule.
close(C.calculate({ units: 'imperial', area: '300', height: '8', cadr: '195' }).coverageFt2, 300,
  '195 cfm covers 300 ft2 at 8 ft');
close(C.calculate({ units: 'imperial', area: '300', height: '10', cadr: '195' }).coverageFt2, 240,
  'the same cleaner covers a fifth less floor at 10 ft');
close(C.calculate({ units: 'metric', area: '20', height: '2.5', cadr: '300' }).coverageM2,
  300 / C.M3H_PER_CFM * 8 / (0.65 * (2.5 / C.M_PER_FT)) * C.M2_PER_FT2,
  'the metric coverage is the converted imperial figure');

// ---- Accepted bounds and number parsing.
assert.ok(Number.isFinite(C.calculate({ units: 'metric', area: '2', height: '1.8', cadr: '10' }).requiredM3h),
  'the smallest metric room is accepted');
assert.ok(Number.isFinite(C.calculate({ units: 'metric', area: '1000', height: '6', cadr: '5000' }).requiredM3h),
  'the largest metric room is accepted');
assert.ok(Number.isFinite(C.calculate({ units: 'imperial', area: '20', height: '6', cadr: '20' }).requiredM3h),
  'the smallest imperial room is accepted');
assert.ok(Number.isFinite(C.calculate({ units: 'imperial', area: '10000', height: '20', cadr: '10000' }).requiredM3h),
  'the largest imperial room is accepted');
close(C.calculate({ units: 'metric', area: ' 20 ', height: ' 2,5 ', cadr: '300' }).volumeM3, 50,
  'spaces and a decimal comma are read');
close(C.calculate({ units: 'imperial', area: '1,000', height: '8', cadr: '5000' }).areaFt2, 1000,
  'a thousands separator is read');
close(C.calculate({ units: 'Metric', area: '20', height: '2.5', cadr: '300' }).volumeM3, 50,
  'the unit name is case-insensitive');
const decimals = C.calculate({ units: 'imperial', area: '215.278', height: '8.2021', cadr: '176.573' });
close(decimals.areaFt2, 215.278, 'three decimals after the point are a decimal, not a thousands group');
close(decimals.heightFt, 8.2021, 'a four-decimal height is read as a decimal');
close(decimals.cadrCfm, 176.573, 'a three-decimal CADR is read as a decimal');
close(decimals.requiredCfm, 0.65 * 215.278 * (8.2021 / 8), 'the sizing of a converted room uses its real decimals');

// ---- Refusals beyond the catalog cases.
assert.throws(() => C.calculate({ units: 'metric', height: '2.5', cadr: '300' }), /Enter the floor area/,
  'a missing area is refused');
assert.throws(() => C.calculate(null), /Choose metric or imperial units/, 'missing input is refused');
assert.throws(() => C.calculate({ units: 'metric', area: '20', height: '2.5', cadr: '' }),
  /Enter the air cleaner CADR/, 'a blank CADR is refused');
assert.throws(() => C.calculate({ units: 'metric', area: '20', height: '2.5', cadr: '300 cfm' }),
  /is not a number for the air cleaner CADR/, 'a unit typed into the CADR field is refused');

// ---- Determinism: the same input gives identical output.
const once = JSON.stringify(C.calculate({ units: 'metric', area: '20', height: '2.5', cadr: '300' }));
const twice = JSON.stringify(C.calculate({ units: 'metric', area: '20', height: '2.5', cadr: '300' }));
assert.equal(once, twice, 'deterministic result');

// ---- Page contract: one self-contained page, shared shell, no remote resources.
assert.ok(/<html lang="en">/.test(html), 'language declared');
assert.ok(html.includes('name="viewport"'), 'viewport declared');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('<div id="site-header"></div>'), 'shared header mount');
assert.ok(html.includes('/assets/app.js'), 'shared app script');
assert.ok(/<main[\s>]/.test(html), 'main landmark');
assert.ok(/<h1[^>]*>Air Cleaner CADR Sizing Calculator<\/h1>/.test(html), 'page heading');
assert.ok(!/<script[^>]+src="(?:https?:)?\/\//.test(html), 'no remote scripts');
assert.ok(!/https?:\/\//.test(html), 'the page carries no outbound links; citations render from the catalog');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage/.test(html.slice(html.indexOf('<body>'))),
  'no network or storage in the page');
assert.ok(!/<form[^>]+action=/.test(html), 'the form does not post anywhere');
for (const id of ['units', 'area', 'height', 'cadr']) {
  assert.ok(html.includes(`<label for="${id}"`), `label for ${id}`);
  assert.ok(html.includes(`id="${id}"`), `control ${id}`);
}
assert.ok(/<option value="metric" selected>/.test(html), 'metric is the default');
assert.ok(/<option value="imperial">/.test(html), 'imperial is offered');
assert.ok(html.includes('role="alert"'), 'error region is announced');
assert.ok(html.includes('aria-live="polite"'), 'result region is announced');
assert.ok(html.includes('id="method"'), 'method note present');
assert.ok(html.includes('@media (max-width:560px)'), 'small-screen rule present');

console.log(`air cleaner CADR: ${entry.testCases.length} catalog cases and the chart and decay checks passed`);
