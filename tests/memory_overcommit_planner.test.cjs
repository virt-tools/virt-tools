/* Memory overcommit planner: replay the catalog fixtures, cross-check the model
   against an independent commit-limit implementation, and guard the page's
   offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'memory-overcommit-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* memory-overcommit-core:start */');
const end = html.indexOf('/* memory-overcommit-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, end + '/* memory-overcommit-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = MemoryOvercommitCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2272, 'catalog total');
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Memory Overcommit Planner');
assert.equal(entry.category, 'System');
assert.equal(entry.subcategory, 'Planning');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 600, 'method must document the model and its limits');
assert.equal(entry.sources.length, 3);
for (const source of entry.sources) assert.match(source.url, /^https:\/\//);
assert.equal(entry.testCases.length, 20, 'catalog case count');
assert.equal(entry.testCases.filter((test) => test.kind === 'golden').length, 6);
assert.equal(entry.testCases.filter((test) => test.kind === 'boundary').length, 6);
assert.equal(entry.testCases.filter((test) => test.kind === 'validation').length, 8);
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && tool.name.toLowerCase() === entry.name.toLowerCase()), 'name collision');
assert.equal(catalog.tools.filter((tool) => tool.category === 'System').length, 44, 'System count');

function failure(input) {
  try {
    C.plan(input);
  } catch (error) {
    return error.message;
  }
  return null;
}
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.plan(testCase.input);
  for (const [field, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[field], expected, testCase.name + ' ' + field);
  }
  assert.equal(result.statusLabel, C.LABELS[result.status], testCase.name + ' label');
  assert.equal(result.committedAfterMib, result.committedMib + result.requestMib, testCase.name + ' commit sum');
  assert.equal(result.headroomAfterMib, result.ceilingMib - result.committedAfterMib, testCase.name + ' headroom');
}

// ---------------------------------------------------------------------------
// Independent implementation of the documented model: the ratio share is RAM
// scaled by the overcommit ratio, the ceiling is the strict CommitLimit in
// mode 2 and RAM plus swap otherwise, and the verdict comes from the raw
// utilisation of that ceiling. Written from the method text, not copied from
// the page core.
// ---------------------------------------------------------------------------
const MODE_NAMES = { '0': 'heuristic', '1': 'always', '2': 'never' };
const MODE_LABELS = { '0': '0 — heuristic', '1': '1 — always overcommit', '2': '2 — never overcommit' };
const ADMISSION_LABELS = { never: 'Strict commit limit enforced', heuristic: 'Heuristic check only', always: 'No commit limit' };
const VERDICT_LABELS = {
  healthy: 'Healthy headroom',
  watch: 'Watch',
  tight: 'Tight',
  refused: 'Refused — ENOMEM',
  oversubscribed: 'Oversubscribed — OOM risk',
};
function roundTo(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
function oracle(config) {
  const ratioShare = Math.round(config.ramMib * config.ratioPercent / 100);
  const strict = config.swapMib + ratioShare;
  const enforced = config.mode === '2';
  const ceiling = enforced ? strict : config.ramMib + config.swapMib;
  const after = config.committedMib + config.requestMib;
  const utilisation = ceiling > 0 ? roundTo(after / ceiling * 100, 1) : (after > 0 ? 100 : 0);
  const base = enforced ? ratioShare : config.ramMib;
  const requiredSwap = config.mode === '1' ? null : Math.max(0, after - base);
  const swapTopUp = config.mode === '1' ? null : Math.max(0, requiredSwap - config.swapMib);
  let status = 'healthy';
  if (after > ceiling) status = enforced ? 'refused' : 'oversubscribed';
  else if (utilisation >= 85) status = 'tight';
  else if (utilisation >= 70) status = 'watch';
  return {
    ramMib: config.ramMib,
    swapMib: config.swapMib,
    mode: config.mode,
    modeName: MODE_NAMES[config.mode],
    modeText: MODE_LABELS[config.mode],
    ratioPercent: config.ratioPercent,
    committedMib: config.committedMib,
    requestMib: config.requestMib,
    ratioShareMib: ratioShare,
    strictLimitMib: strict,
    admissionLimitMib: enforced ? strict : null,
    ceilingMib: ceiling,
    committedAfterMib: after,
    headroomBeforeMib: ceiling - config.committedMib,
    headroomAfterMib: ceiling - after,
    utilisationPercent: utilisation,
    maxRequestMib: Math.max(0, ceiling - config.committedMib),
    requiredSwapMib: requiredSwap,
    swapTopUpMib: swapTopUp,
    fits: after <= ceiling || config.mode === '1',
    enforced,
    admissionLabel: ADMISSION_LABELS[MODE_NAMES[config.mode]],
    status,
    statusLabel: VERDICT_LABELS[status],
  };
}
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') continue;
  assert.deepEqual({ ...C.plan(testCase.input) }, oracle(testCase.input), testCase.name + ' oracle');
}

// Deterministic sweep over the input space, including all three modes.
let seed = 20261114;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function between(low, high) {
  return low + Math.floor(rand() * (high - low + 1));
}
const BAND_ORDER = ['healthy', 'watch', 'tight', 'refused', 'oversubscribed'];
for (let i = 0; i < 600; i += 1) {
  const config = {
    ramMib: between(1, 2000000),
    swapMib: between(0, 2000000),
    mode: String(between(0, 2)),
    ratioPercent: between(1, 100),
    committedMib: between(0, 3000000),
    requestMib: between(1, 3000000),
  };
  const observed = C.plan(config);
  assert.deepEqual({ ...observed }, oracle(config), 'sweep ' + JSON.stringify(config));
  assert.ok(Number.isFinite(observed.utilisationPercent), 'finite utilisation');
  assert.equal(observed.utilisationPercent >= 0, true, 'utilisation sign');
  // A larger request can only raise utilisation and can never admit a workload
  // that a smaller one already refused.
  const bigger = C.plan({ ...config, requestMib: config.requestMib + 1 });
  assert.ok(bigger.utilisationPercent >= observed.utilisationPercent, 'request monotonicity');
  if (!observed.fits) assert.equal(bigger.fits, false, 'refusal is sticky');
  const smallBand = BAND_ORDER.indexOf(observed.status);
  const bigBand = BAND_ORDER.indexOf(bigger.status);
  assert.ok(bigBand >= smallBand, 'verdict never improves with a larger request');
  // Swap raises the ceiling one for one, so the advertised top-up must fit.
  if (observed.swapTopUpMib !== null && observed.swapTopUpMib > 0) {
    const topped = C.plan({ ...config, swapMib: config.swapMib + observed.swapTopUpMib });
    assert.equal(topped.fits, true, 'top-up fits ' + JSON.stringify(config));
    assert.equal(topped.committedAfterMib, topped.ceilingMib, 'top-up lands on the limit');
    assert.equal(topped.swapTopUpMib, 0, 'top-up is final');
  }
  // Raising the ratio can only lift the strict limit.
  const stricter = C.plan({ ...config, ratioPercent: Math.min(100, config.ratioPercent + 1) });
  assert.ok(stricter.strictLimitMib >= observed.strictLimitMib, 'ratio monotonicity');
}

// Documented limits and defaults.
assert.equal(C.DEFAULTS.ramMib, 16384);
assert.equal(C.DEFAULTS.swapMib, 4096);
assert.equal(C.DEFAULTS.mode, '2');
assert.equal(C.DEFAULTS.ratioPercent, 50);
assert.equal(C.DEFAULTS.committedMib, 4096);
assert.equal(C.DEFAULTS.requestMib, 4096);
const base = { ramMib: 1024, swapMib: 0, mode: '2', ratioPercent: 50, committedMib: 0, requestMib: 1 };
assert.equal(failure({ ...base, ramMib: 16777217 }), 'Physical RAM must be a whole number between 1 and 16,777,216.');
assert.equal(failure({ ...base, swapMib: 16777217 }), 'Swap must be a whole number between 0 and 16,777,216.');
assert.equal(failure({ ...base, ratioPercent: 101 }), 'Overcommit ratio must be a whole number between 1 and 100.');
assert.equal(failure({ ...base, committedMib: 33554433 }), 'Currently committed memory must be a whole number between 0 and 33,554,432.');
assert.equal(failure({ ...base, mode: 'never' }), 'Choose overcommit mode 0, 1 or 2.');
assert.equal(failure({ ...base, mode: ' 2 ' }), null, 'mode is trimmed');
assert.equal(failure({ ...base, swapMib: '  ' }), 'Swap is required.');
assert.equal(failure({ ...base, committedMib: '1,024' }), 'Currently committed memory must be a whole number between 0 and 33,554,432.');

// ---------------------------------------------------------------------------
// Page contract: the markup sample must match the core defaults, and the page
// must stay self-contained, offline and touch-friendly.
// ---------------------------------------------------------------------------
assert.ok(!/\bfetch\s*\(/.test(html), 'no fetch');
assert.ok(!/XMLHttpRequest|WebSocket|navigator\.sendBeacon/.test(html), 'no network APIs');
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), 'no storage');
assert.ok(!/\beval\s*\(|new Function/.test(html), 'no dynamic evaluation');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(!/autofocus/i.test(html), 'no autofocus');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote stylesheets');

const defaults = {};
for (const [id, key] of [['ram', 'ramMib'], ['swap', 'swapMib'], ['ratio', 'ratioPercent'], ['committed', 'committedMib'], ['request', 'requestMib']]) {
  const match = html.match(new RegExp('id="' + id + '"[^>]*value="([^"]*)"'));
  assert.ok(match, 'missing default for ' + id);
  assert.ok(html.includes('<label for="' + id + '">'), 'missing label for ' + id);
  defaults[key] = match[1];
}
assert.ok(html.includes('<label for="mode">'), 'missing label for mode');
const modeInput = html.match(/<select id="mode">([\s\S]*?)<\/select>/);
assert.ok(modeInput, 'missing mode select');
assert.equal((modeInput[1].match(/selected/g) || []).length, 1, 'exactly one selected mode');
defaults.mode = (modeInput[1].match(/value="([012])" selected/) || [])[1];
assert.equal(defaults.mode, C.DEFAULTS.mode, 'selected mode matches the core default');
for (const value of ['0', '1', '2']) assert.ok(modeInput[1].includes('value="' + value + '"'), 'mode ' + value + ' offered');

const fromMarkup = C.plan(defaults);
assert.deepEqual({ ...fromMarkup }, { ...C.plan({}) }, 'markup defaults differ from core defaults');
assert.equal(fromMarkup.status, 'healthy', 'sample should demonstrate a workable load');
assert.equal(fromMarkup.mode, '2', 'sample exercises the enforced mode');

assert.ok(/min-height:44px/.test(html), '44 px controls');
assert.ok(/@media\(max-width:480px\)/.test(html), 'mobile layout');
assert.ok(/aria-live="polite"/.test(html), 'live result region');
assert.ok(/role="alert"/.test(html), 'error region');
assert.ok(/<html lang="en">/.test(html) && /name="viewport"/.test(html), 'document basics');
assert.ok(/vm\.overcommit_ratio/.test(html), 'page explains the ratio');
assert.ok(/ENOMEM/.test(html), 'page explains the refusal');

console.log('memory overcommit planner: all checks passed');
