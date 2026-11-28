/* Gas meter input rate: replays every catalog case, checks the arithmetic against
   independently worked examples and the definition of the formula, and pins the
   refusals, determinism and the offline page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'gas-meter-input-rate-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* gas-meter-core:start */';
const endMarker = '/* gas-meter-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|navigator\.|fetch\(|localStorage|XMLHttpRequest/.test(core),
  'the core stays free of DOM, storage and network access');

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = GasMeterCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(catalog.tools.length, 2515, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2254, 'public tools');
assert.equal(entry.category, 'Home Systems', 'category');
assert.equal(entry.risk, 'low', 'risk');
assert.ok(entry.sources.length >= 3, 'the formula and heating value are cited');
assert.ok(entry.testCases.length >= 20, `expected at least 20 cases, found ${entry.testCases.length}`);
assert.ok(entry.testCases.some((testCase) => testCase.kind === 'validation'), 'refusals are pinned');
assert.ok(entry.testCases.some((testCase) => testCase.kind === 'golden'), 'goldens are pinned');

const close = (actual, expected, message) => {
  assert.ok(Number.isFinite(actual), `${message}: not a finite number`);
  const tolerance = Math.max(1e-9, Math.abs(expected) * 1e-9);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
};

// ---- Catalog cases: every golden and every refusal.
for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(() => C.compute(testCase.input), (error) => error.message === testCase.expected.error,
      label);
    continue;
  }
  const result = C.compute(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'boolean') {
      assert.equal(result[key], value, `${label}: ${key}`);
    } else {
      close(result[key], value, `${label}: ${key}`);
    }
  }
}

// ---- Definition of the formula, worked independently.
const cases = [
  { input: { dial: '0.5', revolutions: '1', seconds: '20', heatingValue: '1,030' }, cfh: 90 },
  { input: { dial: '1', revolutions: '1', seconds: '42', heatingValue: '1,050' }, cfh: 3600 / 42 },
  { input: { dial: '2', revolutions: '3', seconds: '132', heatingValue: '1,000' }, cfh: 2 * 3 * 3600 / 132 },
  { input: { dial: '5', revolutions: '2', seconds: '240', heatingValue: '1,030' }, cfh: 150 },
  { input: { dial: '0.5', revolutions: '10', seconds: '200', heatingValue: '1,020' }, cfh: 90 }
];
for (const item of cases) {
  const result = C.compute(item.input);
  close(result.cfh, item.cfh, 'flow from dial timing');
  close(result.cfm, item.cfh / 60, 'flow per minute');
  const heatingValue = Number(item.input.heatingValue.replace(/,/g, ''));
  close(result.btu, item.cfh * heatingValue, 'input from flow and heating value');
  close(result.kw, result.btu / 3412.14, 'kilowatts');
  close(result.therms, result.btu / 100000, 'therms per hour');
}

// Beckett's published worked example: 1 ft3 dial at 42 s with 1,050 BTU/ft3 is 90,000 BTU/h.
const beckett = C.compute({ dial: '1', revolutions: '1', seconds: '42', heatingValue: '1,050' });
close(beckett.btu, 90000, 'published worked example');

// ---- Nameplate comparison arithmetic and the band edges.
const plate = { dial: '0.5', revolutions: '1', seconds: '20', heatingValue: '1,030' };
const rated = (rating) => C.compute({ ...plate, rating });
close(rated('90,000').percent, 103, 'percent of nameplate');
close(rated('90,000').deviation, 3, 'signed deviation');
assert.equal(rated('90,000').within, true, 'three percent is on rate');
close(rated('90,000').expectedPerRevolution, 3600 * 0.5 * 1030 / 90000, 'expected revolution time');
close(rated('90,000').expectedForRun, 3600 * 0.5 * 1030 / 90000, 'expected run time for one revolution');
assert.equal(rated('90,000').far, false, 'three percent is not far off');

// 92,700 BTU/h against a 88,285.71 plate is exactly +5%: inside. Against 97,578.95 it is -5%: inside.
close(rated(String(92700 / 1.05)).deviation, 5, 'upper band edge');
assert.equal(rated(String(92700 / 1.05)).within, true, 'exactly five percent above is on rate');
assert.equal(rated(String(92700 / 0.95)).within, true, 'exactly five percent below is on rate');
assert.equal(rated(String(92700 / 1.0501)).within, false, 'just outside five percent fails the band');
assert.equal(rated(String(92700 / 1.0501)).far, false, 'just outside five percent is still inside ten');
assert.equal(rated(String(92700 / 1.11)).far, true, 'eleven percent is far off');
assert.equal(C.compute({ ...plate }).rating, null, 'no plate value means no comparison');

// ---- Timing sensitivity follows the 1/time relation.
const sensitive = C.compute({ dial: '1', revolutions: '1', seconds: '50', heatingValue: '1,000' });
close(sensitive.perSecond, sensitive.btu / 50, 'one second of timing error');
close(sensitive.perSecond, 72 * 1000 / 50, 'sensitivity example');

// ---- Inputs that are accepted at the edges.
assert.ok(Number.isFinite(C.compute({ dial: '0.5', revolutions: '1', seconds: '0.5', heatingValue: '500' }).btu),
  'minimum time and heating value are accepted');
assert.ok(Number.isFinite(C.compute({ dial: '5', revolutions: '20', seconds: '3600', heatingValue: '3000' }).btu),
  'maximum time, revolutions and heating value are accepted');
close(C.compute({ dial: '0.5', revolutions: '20', seconds: '400', heatingValue: '1,000' }).cfh, 90,
  'twenty revolutions are accepted');
close(C.compute({ dial: '1', revolutions: '1', seconds: '36', heatingValue: '1 037' }).btu, 103700,
  'spaces inside a number are ignored');
close(C.compute({ dial: '1', revolutions: '1', seconds: '36', heatingValue: '1.030' }).btu, 103000,
  'a thousands point is read as a separator');
close(C.compute({ dial: '0.5', revolutions: '1', seconds: '20,5', heatingValue: '1,030' }).btu,
  1800 / 20.5 * 1030, 'a decimal comma is accepted');

// ---- Refusals beyond the catalog cases.
assert.equal(C.compute({ dial: '0.5', revolutions: '1', seconds: '20', heatingValue: '1,030', rating: '  ' }).rating, null,
  'whitespace in the optional plate means no comparison');
assert.throws(() => C.compute({ dial: '0.25', revolutions: '1', seconds: '20', heatingValue: '1,030' }),
  /test dial size/, 'a quarter-foot dial is not offered');
assert.throws(() => C.compute({ dial: '0.5', revolutions: '', seconds: '20', heatingValue: '1,030' }),
  /Enter the revolutions timed/, 'blank revolutions are refused');
close(C.compute({ dial: '0.5', revolutions: '1', seconds: ' 20 ', heatingValue: '1,030' }).btu, 92700,
  'surrounding spaces in the time are tolerated');

// ---- Determinism: the same input gives identical output.
const once = JSON.stringify(C.compute({ dial: '2', revolutions: '3', seconds: '132', heatingValue: '1,000', rating: '200,000' }));
const twice = JSON.stringify(C.compute({ dial: '2', revolutions: '3', seconds: '132', heatingValue: '1,000', rating: '200,000' }));
assert.equal(once, twice, 'deterministic result');

// ---- Page contract: one self-contained page, shared shell, no remote resources.
assert.ok(/<html lang="en">/.test(html), 'language declared');
assert.ok(html.includes('name="viewport"'), 'viewport declared');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('<div id="site-header"></div>'), 'shared header mount');
assert.ok(html.includes('/assets/app.js'), 'shared app script');
assert.ok(/<main[\s>]/.test(html), 'main landmark');
assert.ok(/<h1[^>]*>Gas Meter Input Rate Calculator<\/h1>/.test(html), 'page heading');
assert.ok(!/<script[^>]+src="(?:https?:)?\/\//.test(html), 'no remote scripts');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage/.test(html.slice(html.indexOf('<body>'))), 'no network or storage in the page');
assert.ok(!/<form[^>]+action=/.test(html), 'the form does not post anywhere');
for (const id of ['dial', 'revolutions', 'seconds', 'heating-value', 'nameplate']) {
  assert.ok(html.includes(`<label for="${id}"`), `label for ${id}`);
  assert.ok(html.includes(`id="${id}"`), `control ${id}`);
}
assert.ok(html.includes('role="alert"'), 'error region is announced');
assert.ok(html.includes('aria-live="polite"'), 'result region is announced');

console.log(`gas meter input rate: ${entry.testCases.length} catalog cases and the definition checks passed`);
