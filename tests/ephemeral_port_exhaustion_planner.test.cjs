/* Ephemeral port exhaustion planner: replay the catalog fixtures, cross-check the
   model against an independent Little's-law implementation, and guard the page's
   offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ephemeral-port-exhaustion-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* port-exhaustion-core:start */');
const end = html.indexOf('/* port-exhaustion-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, end + '/* port-exhaustion-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = PortExhaustionCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2271, 'catalog total');
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Ephemeral Port Exhaustion Planner');
assert.equal(entry.category, 'Networking');
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
  assert.equal(result.portsPerIp, result.timeWaitPorts + result.concurrentSockets, testCase.name + ' port sum');
  assert.equal(result.statusLabel, C.LABELS[result.status], testCase.name + ' label');
  assert.equal(result.overCapacity, result.portsPerIp > result.poolPorts, testCase.name + ' over capacity');
}

// ---------------------------------------------------------------------------
// Independent implementation of the documented model: the pool is the size of
// the inclusive range, Little's law fixes the ports parked in TIME_WAIT, and
// the verdict comes from the raw occupancy ratio. Written from the method text,
// not copied from the page core.
// ---------------------------------------------------------------------------
function roundTo(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
function oracle(config) {
  const pool = config.portEnd - config.portStart + 1;
  const held = config.connectionsPerSecond * config.timeWaitSeconds;
  const timeWait = held > 0 ? Math.ceil(held) : 0;
  const needed = timeWait + config.concurrentSockets;
  const ratio = needed / pool;
  let status = 'healthy';
  if (needed >= pool) status = 'exhausted';
  else if (ratio >= 0.85) status = 'tight';
  else if (ratio >= 0.70) status = 'watch';
  return {
    portStart: config.portStart,
    portEnd: config.portEnd,
    poolPorts: pool,
    timeWaitSeconds: config.timeWaitSeconds,
    concurrentSockets: config.concurrentSockets,
    connectionsPerSecond: config.connectionsPerSecond,
    sourceIps: config.sourceIps,
    timeWaitPorts: timeWait,
    portsPerIp: needed,
    freePortsPerIp: pool - needed,
    utilisationPercent: roundTo(ratio * 100, 1),
    safeRatePerIp: roundTo(Math.max(0, pool - config.concurrentSockets) / config.timeWaitSeconds, 2),
    churnCeilingPerSecond: roundTo(pool / config.timeWaitSeconds, 2),
    fleetPoolPorts: pool * config.sourceIps,
    fleetPortsNeeded: needed * config.sourceIps,
    fleetConnectionsPerSecond: roundTo(config.connectionsPerSecond * config.sourceIps, 2),
    status,
    statusLabel: C.LABELS[status],
    overCapacity: needed > pool,
  };
}
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') continue;
  assert.deepEqual({ ...C.plan(testCase.input) }, oracle(testCase.input), testCase.name + ' oracle');
}

// Deterministic sweep over the whole input space, including multi-IP fleets.
let seed = 20261114;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function between(low, high) {
  return low + Math.floor(rand() * (high - low + 1));
}
for (let i = 0; i < 600; i += 1) {
  const portStart = between(1, 65000);
  const config = {
    portStart,
    portEnd: between(portStart, 65535),
    timeWaitSeconds: between(1, 3600),
    concurrentSockets: between(0, 5000),
    connectionsPerSecond: Number((rand() * 5000).toFixed(2)),
    sourceIps: between(1, 64),
  };
  const observed = C.plan(config);
  assert.deepEqual({ ...observed }, oracle(config), 'sweep ' + JSON.stringify(config));
  assert.ok(Number.isFinite(observed.utilisationPercent), 'finite utilisation');
  assert.ok(observed.portsPerIp >= config.concurrentSockets, 'sockets are always held');
  assert.equal(observed.freePortsPerIp >= 0, !observed.overCapacity, 'free ports sign');
  // Raising the rate can only consume more of the pool.
  const faster = C.plan({ ...config, connectionsPerSecond: config.connectionsPerSecond + 1 });
  assert.ok(faster.portsPerIp >= observed.portsPerIp, 'rate monotonicity');
  assert.ok(faster.utilisationPercent >= observed.utilisationPercent, 'utilisation monotonicity');
  // The advertised safe rate puts the pool at (or within rounding of) full.
  if (observed.safeRatePerIp > 0) {
    const atSafe = C.plan({ ...config, connectionsPerSecond: observed.safeRatePerIp });
    assert.ok(atSafe.portsPerIp >= config.concurrentSockets, 'safe rate holds the sockets');
    assert.ok(atSafe.portsPerIp - atSafe.poolPorts <= 0.005 * config.timeWaitSeconds + 1, 'safe rate fills the pool');
  }
}

// Documented limits and defaults.
assert.equal(C.DEFAULTS.portStart, 32768);
assert.equal(C.DEFAULTS.portEnd, 60999);
assert.equal(C.DEFAULTS.timeWaitSeconds, 60);
assert.equal(failure({ portStart: 1, portEnd: 65535, timeWaitSeconds: 3601, concurrentSockets: 0, connectionsPerSecond: 0, sourceIps: 1 }), 'TIME_WAIT duration must be a whole number between 1 and 3,600.');
assert.equal(failure({ portStart: 1, portEnd: 65535, timeWaitSeconds: 60, concurrentSockets: 1000001, connectionsPerSecond: 0, sourceIps: 1 }), 'Concurrent sockets must be a whole number between 0 and 1,000,000.');
assert.equal(failure({ portStart: 1, portEnd: 65535, timeWaitSeconds: 60, concurrentSockets: 0, connectionsPerSecond: 1000000.5, sourceIps: 1 }), 'Connection rate must be a number between 0 and 1,000,000.');
assert.equal(failure({ portStart: 1, portEnd: 65535, timeWaitSeconds: 60, concurrentSockets: 0, connectionsPerSecond: 0, sourceIps: 10001 }), 'Source IP count must be a whole number between 1 and 10,000.');
assert.equal(failure({ portStart: 1.5, portEnd: 65535, timeWaitSeconds: 60, concurrentSockets: 0, connectionsPerSecond: 0, sourceIps: 1 }), 'Port range start must be a whole number between 1 and 65,535.');
assert.equal(failure({ portStart: '  ', portEnd: 65535, timeWaitSeconds: 60, concurrentSockets: 0, connectionsPerSecond: 0, sourceIps: 1 }), 'Port range start is required.');

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
for (const [id, key] of [['port-start', 'portStart'], ['port-end', 'portEnd'], ['time-wait', 'timeWaitSeconds'], ['concurrent', 'concurrentSockets'], ['rate', 'connectionsPerSecond'], ['sources', 'sourceIps']]) {
  const match = html.match(new RegExp('id="' + id + '"[^>]*value="([^"]*)"'));
  assert.ok(match, 'missing default for ' + id);
  assert.equal((html.match(new RegExp('<label for="' + id + '">([^<]+)</label>')) || [])[1] !== undefined, true, 'missing label for ' + id);
  defaults[key] = match[1];
}
const fromMarkup = C.plan(defaults);
assert.deepEqual({ ...fromMarkup }, { ...C.plan({}) }, 'markup defaults differ from core defaults');
assert.equal(fromMarkup.status, 'healthy', 'sample should demonstrate a workable load');

assert.ok(/min-height:44px/.test(html), '44 px controls');
assert.ok(/@media\(max-width:480px\)/.test(html), 'mobile layout');
assert.ok(/aria-live="polite"/.test(html), 'live result region');
assert.ok(/<html lang="en">/.test(html) && /name="viewport"/.test(html), 'document basics');

console.log('ephemeral port exhaustion planner: all checks passed');
