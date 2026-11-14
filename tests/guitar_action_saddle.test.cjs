/* Regression checks for the guitar action & saddle adjustment core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'guitar-action-saddle-calculator';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* guitar-action-core:start */');
const end = html.indexOf('/* guitar-action-core:end */');
assert.ok(start > -1 && end > start, 'guitar action core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '\nmodule.exports = GuitarAction;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Music');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.icon, '\u{1F3B8}');
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 8, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 3, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 800, 'method documented');
assert.equal(catalog.tools.length, 2278, 'catalog total');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Music').length, 44, 'Music count');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');
const aliases = catalog.tools.flatMap((tool) => (tool.slug === slug ? [] : tool.aliases || []))
  .map((alias) => alias.toLowerCase());
for (const alias of entry.aliases) {
  assert.ok(!aliases.includes(alias.toLowerCase()), `alias ${alias} is already used`);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && /saddle height|string action|action adjustment|nut slot/i
  .test([tool.name, ...(tool.aliases || [])].join(' '))), 'no other action-adjustment tool');

const failure = (input) => {
  try {
    C.compute(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
const close = (left, right, tolerance = 1e-9) =>
  assert.ok(Math.abs(Number(left) - Number(right)) <= tolerance, `${left} != ${right}`);

// --- Constants, defaults and the documented geometry. ---
assert.equal(C.MIN_FRET, 1);
assert.equal(C.MAX_FRET, 24);
assert.equal(C.MM_PER_INCH, 25.4);
close(C.heightFactor(1), 0.0561256873, 1e-9);
close(C.heightFactor(12), 0.5, 1e-12);
close(C.heightFactor(24), 0.75, 1e-12);
const defaults = C.compute({});
assert.equal(defaults.unit, 'mm');
assert.equal(defaults.fret, 12);
close(defaults.currentMm, 2);
close(defaults.targetMm, 1.6);
close(defaults.changeMm, -0.4);
close(defaults.saddleMm, -0.8);
close(defaults.nutMm, -0.8);
close(defaults.factor, 0.5);
close(defaults.saddleFactor, 2);
close(defaults.nutFactor, 2);
assert.equal(defaults.direction, 'lower');
assert.equal(defaults.chart.length, 24);
assert.equal(defaults.notes.length, 2, 'relief and precision notes');
assert.equal(defaults.warnings.length, 0, 'a 0.4 mm change is not a caution');

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
  close(result.factor, expected.factor, 1e-8);
  close(result.changeMm, expected.changeMm, 1e-9);
  close(result.saddleMm, expected.saddleMm, 1e-9);
  close(result.nutMm, expected.nutMm, 1e-9);
  assert.equal(result.direction, expected.direction, `${testCase.name}: direction`);
  const unit = result.unit;
  const digits = unit === 'mm' ? 2 : 3;
  const toUnit = (value) => (unit === 'in' ? value / 25.4 : value);
  assert.equal(C.round(toUnit(result.currentMm), digits), expected.currentDisplay, `${testCase.name}: current display`);
  assert.equal(C.round(toUnit(result.targetMm), digits), expected.targetDisplay, `${testCase.name}: target display`);
  assert.equal(C.round(toUnit(result.changeMm), digits), expected.changeDisplay, `${testCase.name}: change display`);
  assert.equal(C.round(toUnit(result.saddleMm), digits), expected.saddleDisplay, `${testCase.name}: saddle display`);
  assert.equal(C.round(toUnit(result.nutMm), digits), expected.nutDisplay, `${testCase.name}: nut display`);
}
assert.equal(goldenCount, 6, 'expected six golden cases');
assert.equal(boundaryCount, 6, 'expected six boundary cases');
assert.equal(validationCount, 12, 'expected twelve validation cases');

// --- Three hundred generated measurements against the algebraic relations. ---
let seed = 20261114;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
let sweeps = 0;
for (let index = 0; index < 300; index += 1) {
  const fret = 1 + Math.floor(random() * 24);
  const unit = random() < 0.75 ? 'mm' : 'in';
  const bounds = C.BOUNDS[unit];
  const span = bounds.max - bounds.min;
  const current = (bounds.min + random() * span).toFixed(3);
  const target = (bounds.min + random() * span).toFixed(3);
  const input = { unit, fret: String(fret), current, target };
  const result = C.compute(input);
  const x = 1 - Math.pow(2, -fret / 12);
  close(result.factor, x, 1e-12);
  // A saddle movement of change/x changes the action at the fret by exactly the change.
  close(result.saddleMm * result.factor, result.changeMm, 1e-9);
  close(result.nutMm * (1 - result.factor), result.changeMm, 1e-9);
  close(result.currentMm + result.saddleMm * result.factor, result.targetMm, 1e-9);
  close(result.currentMm + result.nutMm * (1 - result.factor), result.targetMm, 1e-9);
  const change = result.targetMm - result.currentMm;
  const direction = Math.abs(change) < 5e-10 ? 'none' : (change < 0 ? 'lower' : 'raise');
  assert.equal(result.direction, direction, 'direction follows the sign');
  assert.equal(result.chart.length, 24, 'one row per fret');
  assert.equal(result.chart[fret - 1].fret, fret, 'chart is indexed by fret');
  close(result.chart[fret - 1].saddleFactor, result.saddleFactor, 1e-9);
  for (let row = 1; row < result.chart.length; row += 1) {
    assert.ok(result.chart[row].factor > result.chart[row - 1].factor, 'height factor rises with the fret');
    assert.ok(result.chart[row].saddleFactor < result.chart[row - 1].saddleFactor, 'saddle multiplier falls');
    assert.ok(result.chart[row].nutFactor > result.chart[row - 1].nutFactor, 'nut multiplier rises');
  }
  const digits = unit === 'mm' ? 2 : 3;
  const toUnit = (value) => (unit === 'in' ? value / 25.4 : value);
  const saddleWarn = Math.abs(C.round(toUnit(result.saddleMm), digits)) > 3;
  const nutWarn = Math.abs(C.round(toUnit(result.nutMm), digits)) > (unit === 'mm' ? 0.8 : 0.03);
  const expectedWarnings = direction === 'none' ? 0 : Number(saddleWarn) + Number(nutWarn);
  const expectedNotes = direction === 'none' ? 1 : 2 + expectedWarnings + (fret < 5 ? 1 : 0) + (fret > 12 ? 1 : 0);
  assert.equal(result.warnings.length, expectedWarnings, `warning count in ${JSON.stringify(input)}`);
  assert.equal(result.notes.length, expectedNotes, `note count in ${JSON.stringify(input)}`);
  for (const line of result.warnings) {
    assert.ok(result.notes.includes(line), 'every warning also appears in the notes');
  }
  sweeps += 1;
}
assert.equal(sweeps, 300, 'three hundred generated measurements');

// --- Fret-specific behaviour the sweeps cannot reach reliably. ---
const noChange = C.compute({ unit: 'mm', fret: '12', current: '1.75', target: '1.75' });
assert.equal(noChange.direction, 'none');
close(noChange.saddleMm, 0);
close(noChange.nutMm, 0);
assert.equal(noChange.notes.length, 1);
assert.equal(noChange.warnings.length, 0);

const twice = C.compute({ unit: 'mm', fret: '12', current: '2.00', target: '1.60' });
close(twice.saddleFactor, 2);
assert.ok(twice.notes.some((line) => line.includes('Set the relief first')), 'relief note');

const lowFret = C.compute({ unit: 'mm', fret: '1', current: '1.20', target: '1.00' });
assert.equal(lowFret.warnings.length, 1, 'a 3.56 mm saddle movement is a caution');
assert.ok(lowFret.notes.some((line) => line.includes('nut slot sets almost all of the height')), 'nut-height note');
assert.ok(lowFret.notes.some((line) => line.includes('larger than most saddles allow')), 'saddle caution');

const highFret = C.compute({ unit: 'mm', fret: '24', current: '7.50', target: '8.00' });
assert.ok(highFret.nutFactor > highFret.saddleFactor, 'near the saddle the nut needs the larger movement');
assert.ok(highFret.notes.some((line) => line.includes('closer to the saddle')), 'upper-fret note');

const inch = C.compute({ unit: 'in', fret: '12', current: '0.080', target: '0.070' });
close(inch.currentMm, 2.032, 1e-12);
close(inch.saddleMm, -0.508, 1e-12);
assert.equal(C.round(inch.saddleMm / 25.4, 3), -0.02, 'inch display of the saddle change');

// --- Page contract. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'), 'live status region');
for (const id of ['unit', 'fret', 'current', 'target', 'calculate', 'reset', 'action-status', 'headline-out',
  'headline-sub', 'current-out', 'target-out', 'change-out', 'saddle-out', 'nut-out', 'factor-out',
  'fret-body', 'copy', 'copy-status', 'notes', 'mode-cap', 'action-note']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or output ${id}`);
}
assert.ok(/<form id="action-form" novalidate>/.test(html), 'form contract');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(/<option value="mm" selected>/.test(html), 'millimetres selected by default');
assert.ok(/id="fret"[^>]*value="12"/.test(html), 'default measuring fret');
assert.ok(/id="current"[^>]*value="2.00"/.test(html), 'default current action');
assert.ok(/id="target"[^>]*value="1.60"/.test(html), 'default target action');
assert.ok(/id="copy"[^>]*disabled/.test(html), 'copy starts disabled');
assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(html), 'no raw HTML sinks');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'no browser storage');
assert.ok(!/https?:\/\//.test(html.replace(/<meta name="description"[^>]*>/, '')), 'no external requests');
assert.ok(!/\bfetch\(|XMLHttpRequest/.test(html), 'no network calls');
assert.ok(!/\beval\s*\(|new Function\s*\(/.test(html), 'no runtime compilation');
assert.ok(!/\son[a-z]+\s*=/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no inline handlers');

console.log(`${slug}: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed; ` +
  `${sweeps} generated measurements, the doubled saddle rule, the nut-height caution, the upper-fret note and the ` +
  'page contract agreed');
