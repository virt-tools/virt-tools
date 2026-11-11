/* Shooting-ratio regression checks: independent arithmetic grid, both modes,
   input boundaries, catalog replay and the offline DOM contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'shooting-ratio-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* shooting-ratio-core:start */';
const endMarker = '/* shooting-ratio-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'shooting-ratio core markers missing');
const core = html.slice(start, end + endMarker.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ShootingRatioCore;', sandbox);
const C = sandbox.module.exports;

const closeTo = (actual, expected, label, epsilon = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= epsilon,
  `${label}: ${actual} vs ${expected}`);
const run = (input) => C.calculate({ ...C.DEFAULTS, ...(input || {}) });
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};

// Independent oracle: read the clock text, count seconds, then apply the
// documented identities with plain arithmetic.
function seconds(text) {
  return String(text).trim().split(':').reduce((total, part) => total * 60 + Number(part), 0);
}
function oracle(input) {
  const value = { ...C.DEFAULTS, ...(input || {}) };
  const runtime = seconds(value.runtime);
  let footage;
  let ratio;
  if (value.mode === 'ratio') {
    footage = seconds(value.footage);
    ratio = footage / runtime;
  } else {
    ratio = Number(String(value.target).trim().replace(',', '.'));
    footage = Math.round(ratio * runtime);
  }
  return {
    mode: value.mode,
    runtimeSeconds: runtime,
    footageSeconds: footage,
    ratio,
    ratioLabel: `${Math.round(ratio * 100) / 100}:1`,
    unusedSeconds: footage - runtime,
    usedSharePercent: runtime / footage * 100,
  };
}
function checkExpected(result, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === 'number') closeTo(result[key], value, `${label} ${key}`);
    else assert.equal(result[key], value, `${label} ${key}`);
  }
}

assert.equal(C.DEFAULTS.mode, 'ratio');
assert.equal(C.DEFAULTS.runtime, '0:50:00');
assert.equal(C.DEFAULTS.footage, '10:30:00');
assert.equal(C.DEFAULTS.target, '6');
assert.equal(C.RUNTIME_MAX, 360000);
assert.equal(C.FOOTAGE_MAX, 36000000);
assert.equal(C.RATIO_MIN, 1);
assert.equal(C.RATIO_MAX, 1000);

// Published defaults: 10 h 30 min shot for a 50 minute cut is 12.6:1.
const published = run({});
checkExpected(published, {
  mode: 'ratio', runtimeSeconds: 3000, footageSeconds: 37800, ratio: 12.6,
  ratioLabel: '12.6:1', unusedSeconds: 34800, usedSharePercent: 3000 / 37800 * 100,
}, 'default route');
assert.equal(C.parseDuration('90', 'Clip', 86400, '24 hours'), 90);
assert.equal(C.parseDuration('2:30', 'Clip', 86400, '24 hours'), 150);
assert.equal(C.parseDuration('1:02:03', 'Clip', 86400, '24 hours'), 3723);
assert.equal(C.parseRatio('2.5'), 2.5);
assert.equal(C.parseRatio('2,5'), 2.5);
assert.equal(C.ratioText(4 / 3), '1.33:1');
assert.equal(C.ratioText(100 / 3), '33.33:1');
assert.equal(C.ratioText(1), '1:1');

// Reverse direction rounds required footage to whole seconds.
assert.equal(run({ mode: 'footage', target: '6' }).footageSeconds, 18000);
assert.equal(run({ mode: 'footage', runtime: '1:00:00', target: '2.5' }).footageSeconds, 9000);
assert.equal(run({ mode: 'footage', runtime: '1:00:00', target: '1000' }).footageSeconds, 3600000);
assert.equal(run({ mode: 'footage', runtime: '0:00:01', target: '1' }).footageSeconds, 1);

// Boundaries.
assert.equal(run({ runtime: '45:00', footage: '45:00' }).unusedSeconds, 0);
assert.equal(run({ runtime: '1', footage: '1' }).ratio, 1);
assert.equal(run({ runtime: '100:00:00', footage: '10000:00:00' }).ratio, 100);
assert.equal(run({ runtime: '59:59', footage: '1:00:00' }).unusedSeconds, 1);
checkExpected(run({ runtime: '59:59', footage: '1:00:00' }), { ratioLabel: '1:1' }, 'sub-second ratio label');

// Every valid combination agrees with the independent oracle and keeps the
// footage/runtime identities intact.
let rows = 0;
const runtimes = ['1', '30:00', '59:59', '1:00:00', '2:30:00', '100:00:00'];
const footages = ['1', '1:30', '45:00', '10:30:00', '100:00:00', '10000:00:00'];
for (const runtime of runtimes) {
  for (const footage of footages) {
    if (seconds(footage) < seconds(runtime)) continue;
    const input = { mode: 'ratio', runtime, footage };
    const result = run(input);
    const expected = oracle(input);
    checkExpected(result, expected, JSON.stringify(input));
    assert.equal(result.unusedSeconds, result.footageSeconds - result.runtimeSeconds, 'unused identity');
    closeTo(result.usedSharePercent, 100 / result.ratio, 'share identity');
    rows += 1;
  }
}
for (const target of ['1', '1.25', '2', '2.5', '6', '10', '100', '1000']) {
  for (const runtime of ['1', '30:00', '1:00:00', '100:00:00']) {
    const input = { mode: 'footage', runtime, target };
    const result = run(input);
    checkExpected(result, oracle(input), JSON.stringify(input));
    assert.equal(result.footageSeconds, Math.round(Number(target) * result.runtimeSeconds), 'rounded footage');
    rows += 1;
  }
}
assert.equal(rows, 53);

// Refusals name the field and its accepted range.
assert.equal(failure({ runtime: '' }), 'Final runtime is required.');
assert.equal(failure({ runtime: '1:2:3:4' }), 'Final runtime must be seconds, mm:ss or h:mm:ss.');
assert.equal(failure({ runtime: '1:60' }), 'Final runtime minutes and seconds must be under 60.');
assert.equal(failure({ runtime: '0' }), 'Final runtime must be from 1 second to 100 hours.');
assert.equal(failure({ runtime: '100:00:01' }), 'Final runtime must be from 1 second to 100 hours.');
assert.equal(failure({ mode: 'both' }), 'Choose ratio from footage or footage for a target ratio.');
assert.equal(failure({ footage: '' }), 'Footage shot is required.');
assert.equal(failure({ footage: '10:00', runtime: '20:00' }), 'Footage shot must be at least the final runtime.');
assert.equal(failure({ footage: '10001:00:00' }), 'Footage shot must be from 1 second to 10,000 hours.');
assert.equal(failure({ mode: 'footage', target: '' }), 'Target ratio is required.');
assert.equal(failure({ mode: 'footage', target: 'six' }), 'Target ratio must be a number.');
assert.equal(failure({ mode: 'footage', target: '0.5' }), 'Target ratio must be from 1 to 1000.');
assert.equal(failure({ mode: 'footage', target: '1000.5' }), 'Target ratio must be from 1 to 1000.');
assert.equal(failure({ mode: 'footage', target: '1001' }), 'Target ratio must be from 1 to 1000.');

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Shooting Ratio Calculator');
assert.equal(entry.category, 'Video');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.sources.length, 0);
assert.ok(entry.method.includes('recorded footage divided by the finished runtime') && entry.method.includes('10,000 hours'));
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.equal(catalog.tools.length, 2200);
const kinds = Object.fromEntries(['golden', 'boundary', 'validation'].map((kind) =>
  [kind, entry.testCases.filter((testCase) => testCase.kind === kind).length]));
assert.deepEqual(kinds, { golden: 7, boundary: 6, validation: 15 });
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = run(testCase.input);
    checkExpected(result, testCase.expected, testCase.name);
    const expected = oracle(testCase.input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      if (typeof value === 'number') closeTo(expected[key], value, `${testCase.name} oracle ${key}`);
    }
  }
}

// Static offline, accessibility and DOM-wiring contract.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'no remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote styles');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(html.includes('<form id="ratio-form"'), 'form missing');
assert.ok(html.includes('aria-live="polite"'), 'live result missing');
assert.ok(html.includes('role="alert"'), 'error alert missing');
for (const id of ['mode', 'runtime', 'footage', 'target']) {
  assert.ok(html.includes(`id="in-${id}"`), `control in-${id} missing`);
  assert.ok(html.includes(`for="in-${id}"`), `label ${id} missing`);
}
const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate HTML id');
for (const match of html.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(ids.includes(match[1]), `script references missing id ${match[1]}`);
}
assert.ok(html.includes('min-height:44px'), '44 px controls required');
assert.ok(html.includes('@media (max-width:400px)'), 'mobile result rows must stack');

console.log(`Shooting ratio: ${entry.testCases.length} catalog cases, ${rows} independent grid rows and boundary anchors passed`);
