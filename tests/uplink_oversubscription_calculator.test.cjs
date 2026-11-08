/* Regression checks for the uplink oversubscription core, its catalog cases and
   the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'uplink-oversubscription-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* uplink-oversubscription-core:start */');
const end = html.indexOf('/* uplink-oversubscription-core:end */');
assert.ok(start > -1 && end > start, 'uplink oversubscription core markers missing');
const core = html.slice(start, end + '/* uplink-oversubscription-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = UplinkOversubscriptionCore;', sandbox);
const T = sandbox.module.exports;

const closeTo = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9,
  label + ': ' + actual + ' vs ' + expected);

function run(input) {
  return T.analyze(input);
}

function failure(input) {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
}

const base = { ports: '48', accessSpeed: '1', utilization: '20', uplinks: '2', uplinkSpeed: '10', target: '4' };

// Documented surface.
assert.deepEqual(Array.from(T.SPEEDS), [0.1, 1, 2.5, 5, 10, 25, 40, 100]);
assert.deepEqual(Array.from(T.LIMITS.ports), [1, 4096]);
assert.deepEqual(Array.from(T.LIMITS.uplinks), [1, 256]);
assert.deepEqual(Array.from(T.LIMITS.utilization), [1, 100]);
assert.deepEqual(Array.from(T.LIMITS.target), [1, 100]);
assert.match(T.MESSAGES.nonblocking, /matches or exceeds/);
assert.match(T.MESSAGES.within, /stay within the target/);
assert.match(T.MESSAGES.peak, /peak demand/);
assert.match(T.MESSAGES.above, /exceed the target/);

// Golden: 48 access ports at 1 Gbps behind two 10 Gbps uplinks.
const typical = run(base);
assert.equal(typical.ports, 48);
assert.equal(typical.uplinks, 2);
closeTo(typical.accessCapacity, 48, 'typical access capacity');
closeTo(typical.uplinkCapacity, 20, 'typical uplink capacity');
closeTo(typical.ratio, 2.4, 'typical ratio');
closeTo(typical.demand, 9.6, 'typical peak demand');
closeTo(typical.uplinkLoad, 48, 'typical uplink load');
closeTo(typical.headroom, 10.4, 'typical headroom');
assert.equal(typical.requiredUplinks, 2);
assert.equal(typical.extraUplinks, 0);
closeTo(typical.targetHeadroom, 32, 'typical target headroom');
assert.equal(typical.verdict, 'within');

// Golden: one 10 Gbps uplink behind the same ports breaks a 4:1 target.
const single = run(Object.assign({}, base, { uplinks: '1' }));
closeTo(single.ratio, 4.8, 'single uplink ratio');
closeTo(single.uplinkLoad, 96, 'single uplink load');
closeTo(single.headroom, 0.4, 'single uplink headroom');
assert.equal(single.requiredUplinks, 2);
assert.equal(single.extraUplinks, 1);
closeTo(single.targetHeadroom, -8, 'single uplink target headroom');
assert.equal(single.verdict, 'above');

// Golden: 24 ports at 10 Gbps behind two 100 Gbps uplinks is a 1.2:1 boundary.
const fast = run({ ports: '24', accessSpeed: '10', utilization: '50', uplinks: '2', uplinkSpeed: '100', target: '4' });
closeTo(fast.accessCapacity, 240, 'fast access capacity');
closeTo(fast.uplinkCapacity, 200, 'fast uplink capacity');
closeTo(fast.ratio, 1.2, 'fast ratio');
closeTo(fast.demand, 120, 'fast demand');
closeTo(fast.uplinkLoad, 60, 'fast load');
closeTo(fast.headroom, 80, 'fast headroom');
assert.equal(fast.requiredUplinks, 1);
closeTo(fast.targetHeadroom, 560, 'fast target headroom');
assert.equal(fast.verdict, 'within');

// Golden: 48 ports at 100 Mbps behind a single 1 Gbps uplink meets a 20:1 target
// but the assumed peak demand is 168% of the uplink.
const congested = run({ ports: '48', accessSpeed: '0.1', utilization: '35', uplinks: '1', uplinkSpeed: '1', target: '20' });
closeTo(congested.accessCapacity, 4.8, 'congested access capacity');
closeTo(congested.uplinkCapacity, 1, 'congested uplink capacity');
closeTo(congested.ratio, 4.8, 'congested ratio');
closeTo(congested.demand, 1.68, 'congested demand');
closeTo(congested.uplinkLoad, 168, 'congested load');
closeTo(congested.headroom, -0.68, 'congested headroom');
assert.equal(congested.requiredUplinks, 1);
assert.equal(congested.extraUplinks, 0);
closeTo(congested.targetHeadroom, 15.2, 'congested target headroom');
assert.equal(congested.verdict, 'peak');

// Golden: uplink capacity above access capacity is not oversubscribed at all.
const nonblocking = run({ ports: '24', accessSpeed: '10', utilization: '80', uplinks: '4', uplinkSpeed: '100', target: '4' });
assert.equal(nonblocking.verdict, 'nonblocking');
closeTo(nonblocking.ratio, 0.6, 'nonblocking ratio');

// Identities across a spread of inputs, including both ends of every range.
const speeds = T.SPEEDS.map(String);
for (const ports of [1, 24, 48, 1000, 4096]) {
  for (const uplinks of [1, 2, 17, 256]) {
    for (const accessSpeed of ['0.1', '1', '10', '25']) {
      for (const uplinkSpeed of ['1', '10', '40', '100']) {
        const input = {
          ports: String(ports),
          accessSpeed,
          utilization: '37.5',
          uplinks: String(uplinks),
          uplinkSpeed,
          target: '6'
        };
        const result = run(input);
        const access = Number(ports) * Number(accessSpeed);
        const uplink = Number(uplinks) * Number(uplinkSpeed);
        closeTo(result.accessCapacity, access, 'access capacity identity');
        closeTo(result.uplinkCapacity, uplink, 'uplink capacity identity');
        closeTo(result.ratio, access / uplink, 'ratio identity');
        closeTo(result.demand, access * 0.375, 'demand identity');
        closeTo(result.uplinkLoad, (access * 0.375) / uplink * 100, 'load identity');
        closeTo(result.headroom, uplink - access * 0.375, 'headroom identity');
        closeTo(result.targetHeadroom, 6 * uplink - access, 'target headroom identity');
        // The required uplink count is the smallest number that meets the target.
        const each = 6 * Number(uplinkSpeed);
        assert.ok((result.requiredUplinks - 1) * each < access - 1e-9,
          'one fewer uplink would miss the target for ' + JSON.stringify(input));
        assert.ok(result.requiredUplinks * each >= access - 1e-9,
          'the reported uplink count meets the target for ' + JSON.stringify(input));
        assert.equal(result.extraUplinks, Math.max(0, result.requiredUplinks - uplinks));
        const expectedVerdict = result.ratio <= 1 ? 'nonblocking'
          : (result.ratio > 6 ? 'above' : (result.uplinkLoad > 100 ? 'peak' : 'within'));
        assert.equal(result.verdict, expectedVerdict, 'verdict rule for ' + JSON.stringify(input));
      }
    }
  }
}
assert.ok(speeds.length === 8);

// Adding uplinks or faster uplinks always lowers the ratio; the ratio ignores
// peak utilization, and a looser target never asks for more uplink ports.
for (const input of [base, { ports: '96', accessSpeed: '2.5', utilization: '62.5', uplinks: '3', uplinkSpeed: '25', target: '8' }]) {
  let previous = Infinity;
  for (const uplinks of [1, 2, 3, 8, 64]) {
    const ratio = run(Object.assign({}, input, { uplinks: String(uplinks) })).ratio;
    assert.ok(ratio < previous, 'ratio must fall as uplinks are added at ' + uplinks);
    previous = ratio;
  }
  previous = Infinity;
  for (const uplinkSpeed of ['1', '2.5', '10', '40', '100']) {
    const ratio = run(Object.assign({}, input, { uplinkSpeed })).ratio;
    assert.ok(ratio < previous, 'ratio must fall as uplink speed rises at ' + uplinkSpeed);
    previous = ratio;
  }
  const quiet = run(Object.assign({}, input, { utilization: '1' }));
  const busy = run(Object.assign({}, input, { utilization: '100' }));
  closeTo(quiet.ratio, busy.ratio, 'ratio ignores utilization');
  assert.ok(busy.uplinkLoad > quiet.uplinkLoad, 'load must rise with utilization');
  let previousNeed = Infinity;
  for (const target of ['1', '2', '4', '8', '20', '100']) {
    const need = run(Object.assign({}, input, { target })).requiredUplinks;
    assert.ok(need <= previousNeed, 'a looser target must not need more uplinks at ' + target);
    previousNeed = need;
  }
}

// Boundaries: both ends of every accepted range compute.
const smallest = run({ ports: '1', accessSpeed: '0.1', utilization: '1', uplinks: '1', uplinkSpeed: '100', target: '100' });
closeTo(smallest.accessCapacity, 0.1, 'smallest access capacity');
closeTo(smallest.ratio, 0.001, 'smallest ratio');
closeTo(smallest.demand, 0.001, 'smallest demand');
closeTo(smallest.targetHeadroom, 9999.9, 'smallest target headroom');
assert.equal(smallest.requiredUplinks, 1);
assert.equal(smallest.verdict, 'nonblocking');
const largest = run({ ports: '4096', accessSpeed: '25', utilization: '100', uplinks: '256', uplinkSpeed: '100', target: '1' });
closeTo(largest.accessCapacity, 102400, 'largest access capacity');
closeTo(largest.uplinkCapacity, 25600, 'largest uplink capacity');
closeTo(largest.ratio, 4, 'largest ratio');
closeTo(largest.uplinkLoad, 400, 'largest load');
closeTo(largest.headroom, -76800, 'largest headroom');
assert.equal(largest.requiredUplinks, 1024);
assert.equal(largest.verdict, 'above');

// Validation refusals, in the order the page reports them.
assert.equal(failure(Object.assign({}, base, { ports: '' })), 'Enter the access ports.');
assert.equal(failure(Object.assign({}, base, { ports: '48.5' })), 'Access ports must be a whole number from 1 to 4096 ports.');
assert.equal(failure(Object.assign({}, base, { ports: '4097' })), 'Access ports must be a whole number from 1 to 4096 ports.');
assert.equal(failure(Object.assign({}, base, { ports: '0' })), 'Access ports must be a whole number from 1 to 4096 ports.');
assert.equal(failure(Object.assign({}, base, { accessSpeed: '7' })), 'Choose the access port speed from the list.');
assert.equal(failure(Object.assign({}, base, { accessSpeed: '' })), 'Choose the access port speed.');
assert.equal(failure(Object.assign({}, base, { utilization: '' })), 'Enter the peak access utilization.');
assert.equal(failure(Object.assign({}, base, { utilization: '0' })), 'Peak access utilization must be between 1 and 100%.');
assert.equal(failure(Object.assign({}, base, { utilization: '101' })), 'Peak access utilization must be between 1 and 100%.');
assert.equal(failure(Object.assign({}, base, { utilization: 'fast' })), 'Peak access utilization must be a number.');
assert.equal(failure(Object.assign({}, base, { uplinks: '257' })), 'Uplink ports must be a whole number from 1 to 256 ports.');
assert.equal(failure(Object.assign({}, base, { uplinkSpeed: '' })), 'Choose the uplink port speed.');
assert.equal(failure(Object.assign({}, base, { uplinkSpeed: '3' })), 'Choose the uplink port speed from the list.');
assert.equal(failure(Object.assign({}, base, { target: '0.5' })), 'Target ratio must be between 1 and 100.');
assert.equal(failure(Object.assign({}, base, { target: '101' })), 'Target ratio must be between 1 and 100.');
// Order: ports, access speed, utilization, uplinks, uplink speed, target.
assert.equal(failure({ ports: '', accessSpeed: '', utilization: '', uplinks: '', uplinkSpeed: '', target: '' }),
  'Enter the access ports.');
assert.equal(failure({ ports: '48', accessSpeed: '', utilization: '', uplinks: '', uplinkSpeed: '', target: '' }),
  'Choose the access port speed.');
assert.equal(failure({ ports: '48', accessSpeed: '1', utilization: '', uplinks: '', uplinkSpeed: '', target: '' }),
  'Enter the peak access utilization.');
assert.equal(failure({ ports: '48', accessSpeed: '1', utilization: '20', uplinks: '', uplinkSpeed: '', target: '' }),
  'Enter the uplink ports.');
assert.equal(failure({ ports: '48', accessSpeed: '1', utilization: '20', uplinks: '2', uplinkSpeed: '', target: '' }),
  'Choose the uplink port speed.');
assert.equal(failure({ ports: '48', accessSpeed: '1', utilization: '20', uplinks: '2', uplinkSpeed: '10', target: '' }),
  'Enter the target ratio.');

// Decimal commas are accepted like the rest of the catalog.
const comma = run({ ports: '48', accessSpeed: '2,5', utilization: '12,5', uplinks: '2', uplinkSpeed: '10', target: '4,5' });
closeTo(comma.accessCapacity, 120, 'decimal comma access capacity');
closeTo(comma.demand, 15, 'decimal comma demand');
closeTo(comma.ratio, 6, 'decimal comma ratio');
assert.equal(comma.verdict, 'above');
assert.equal(comma.requiredUplinks, 3);

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'IT & Networking');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.ok(entry.testCases.length >= 10, 'expected at least ten catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = run(testCase.input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      if (typeof value === 'number') closeTo(result[key], value, testCase.name + ' ' + key);
      else assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page must not build raw HTML');
assert.ok(html.includes('<form id="oversub-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('aria-describedby="utilization-help"'), 'utilization field must reference its help text');
assert.ok(html.includes('id="reset"'), 'reset control missing');
assert.ok(html.includes('<option value="1" selected>1 Gbps</option>'), 'default access speed must be 1 Gbps');
assert.ok(html.includes('<option value="10" selected>10 Gbps</option>'), 'default uplink speed must be 10 Gbps');
assert.ok(html.includes('value="48"'), 'default access port count missing');
assert.ok(html.includes('value="4"'), 'default target ratio missing');

console.log('uplink oversubscription calculator: ' + entry.testCases.length + ' catalog cases and invariants passed');
