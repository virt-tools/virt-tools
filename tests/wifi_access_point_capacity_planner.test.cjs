/* Regression checks for the Wi-Fi access point capacity planner core, its
   catalog cases and the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'wifi-access-point-capacity-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* wifi-ap-core:start */');
const end = html.indexOf('/* wifi-ap-core:end */');
assert.ok(start > -1 && end > start, 'ap capacity core markers missing');
const core = html.slice(start, end + '/* wifi-ap-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = WifiApCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (options) => plain(C.calculate(options));
const failure = (options) => {
  try {
    run(options);
  } catch (error) {
    return error.message;
  }
  return null;
};
const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' vs ' + expected);
};
const round1 = (value) => Math.round((value + Number.EPSILON) * 10) / 10;

// ---- Field contract.
assert.deepEqual(plain(C.BINDING), { CAPACITY: 'capacity', COVERAGE: 'coverage', BOTH: 'both' });
assert.deepEqual(plain(C.DEFAULTS), {
  area: 1500, devices: 120, target: 20, apThroughput: 250, coverage: 200, headroom: 20,
});
assert.deepEqual(plain(C.LIMITS), {
  area: { min: 1, max: 100000 },
  devices: { min: 1, max: 100000 },
  target: { min: 0.1, max: 10000 },
  apThroughput: { min: 1, max: 10000 },
  coverage: { min: 1, max: 20000 },
  headroom: { min: 0, max: 50 },
});

// ---- The default: 2400 Mbps of demand against 200 Mbps of usable capacity per AP.
const d = run({});
assert.equal(d.floorArea, 1500);
assert.equal(d.devices, 120);
assert.equal(d.aggregateDemandMbps, 2400);
assert.equal(d.usablePerApMbps, 200);
assert.equal(d.capacityAps, 12);
assert.equal(d.coverageAps, 8);
assert.equal(d.apCount, 12);
assert.equal(d.bindingConstraint, 'capacity');
assert.equal(d.devicesPerAp, 10);
assert.equal(d.demandPerApMbps, 200);
assert.equal(d.airtimeUtilisationPct, 80);
assert.equal(d.capacityPerDeviceMbps, 25);
assert.deepEqual(run(), d);

// ---- Identities across a sweep of device loads and headroom.
for (const devices of [1, 7, 40, 120, 333, 1000]) {
  for (const headroom of [0, 10, 20, 50]) {
    for (const target of [2.5, 20, 100]) {
      const r = run({ devices, target, headroom });
      const usable = 250 * (1 - headroom / 100);
      const demand = devices * target;
      near(r.aggregateDemandMbps, round1(demand), 0.001, 'aggregate demand');
      near(r.usablePerApMbps, round1(usable), 0.001, 'usable per AP');
      near(r.capacityAps, Math.max(1, Math.ceil(demand / usable - 1e-9)), 0,
        'capacity count at ' + devices + '/' + target + '/' + headroom);
      near(r.coverageAps, Math.max(1, Math.ceil(1500 / 200 - 1e-9)), 0, 'coverage count');
      assert.equal(r.apCount, Math.max(r.capacityAps, r.coverageAps), 'plan takes the larger count');
      assert.ok(r.apCount >= 1, 'a plan always places at least one AP');
      near(r.devicesPerAp, round1(devices / r.apCount), 0.001, 'devices per AP');
      near(r.airtimeUtilisationPct, round1(demand / (r.apCount * 250) * 100), 0.001,
        'airtime utilisation');
      near(r.capacityPerDeviceMbps, round1(r.apCount * 250 / devices), 0.001,
        'capacity per device');
      // A capacity-limited plan always lands at or below 100% minus the headroom.
      if (r.bindingConstraint !== 'coverage') {
        assert.ok(r.airtimeUtilisationPct <= 100 - headroom + 0.05,
          'capacity plan respects the headroom at ' + devices + '/' + target + '/' + headroom);
      }
      // Coverage is fixed by the floor, so the coverage count never varies with load.
      assert.equal(r.coverageAps, 8);
    }
  }
}

// ---- The binding constraint is reported honestly.
assert.equal(run({ area: 4000, devices: 60 }).bindingConstraint, 'coverage');
assert.equal(run({ area: 4000, devices: 60 }).apCount, 20);
assert.equal(run({ devices: 100, headroom: 0 }).bindingConstraint, 'both');
assert.equal(run({ devices: 100, headroom: 0 }).apCount, 8);
assert.equal(run({ area: 12000, devices: 30, target: 10, apThroughput: 300, coverage: 250, headroom: 10 })
  .apCount, 48);
assert.equal(run({ area: 12000, devices: 30, target: 10, apThroughput: 300, coverage: 250, headroom: 10 })
  .bindingConstraint, 'coverage');
assert.equal(run({ devices: 10, target: 100, apThroughput: 50, headroom: 0 }).apCount, 20);

// ---- More headroom means more access points for the same demand.
const light = run({ devices: 40, target: 25, apThroughput: 100, headroom: 10 });
const heavy = run({ devices: 40, target: 25, apThroughput: 100, headroom: 50 });
assert.ok(heavy.apCount > light.apCount, 'more headroom needs more access points');
assert.equal(heavy.airtimeUtilisationPct, 50);

// ---- Numeric strings are accepted; devices must be a whole number.
assert.equal(run({ devices: '45', target: '12.5' }).devices, 45);
assert.equal(run({ area: 700, devices: '45', target: '12.5', apThroughput: '220', coverage: '180', headroom: '25' })
  .apCount, 4);
assert.equal(run({ area: '1', devices: '1', target: '0.1', apThroughput: '1', coverage: '1', headroom: '0' })
  .apCount, 1);
assert.equal(failure({ devices: '12.5' }), 'Devices must be a whole number from 1 to 100000.');

// ---- Refusals name the failing field.
assert.equal(failure({ area: '' }), 'Floor area is required.');
assert.equal(failure({ area: '  ' }), 'Floor area is required.');
assert.equal(failure({ area: 0 }), 'Floor area must be a number from 1 to 100000.');
assert.equal(failure({ area: 100001 }), 'Floor area must be a number from 1 to 100000.');
assert.equal(failure({ devices: 0 }), 'Devices must be a whole number from 1 to 100000.');
assert.equal(failure({ devices: 100001 }), 'Devices must be a whole number from 1 to 100000.');
assert.equal(failure({ target: '' }), 'Target throughput is required.');
assert.equal(failure({ target: 0 }), 'Target throughput must be a number from 0.1 to 10000.');
assert.equal(failure({ target: 'ten' }), 'Target throughput must be a number from 0.1 to 10000.');
assert.equal(failure({ apThroughput: 0 }), 'AP throughput must be a number from 1 to 10000.');
assert.equal(failure({ coverage: '' }), 'Coverage area per AP is required.');
assert.equal(failure({ coverage: 0 }), 'Coverage area per AP must be a number from 1 to 20000.');
assert.equal(failure({ headroom: -1 }), 'Headroom must be a number from 0 to 50.');
assert.equal(failure({ headroom: 51 }), 'Headroom must be a number from 0 to 50.');
for (const bad of ['1e2', '0x10', '45 6', '+45', 'NaN', '4.5.6', '--2']) {
  assert.ok(failure({ area: bad }), 'floor area refuses ' + JSON.stringify(bad));
}

// ---- The page must not reach the network, store data or inject markup.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')),
  'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="ap-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<h1>Wi-Fi Access Point Capacity Planner<\/h1>/.test(html), 'page heading');
assert.ok(/name="viewport"/.test(html), 'viewport');
for (const id of ['area', 'devices', 'target', 'ap', 'coverage', 'headroom']) {
  assert.ok(new RegExp('for="in-' + id + '"').test(html), 'label for in-' + id);
  assert.ok(new RegExp('id="in-' + id + '"').test(html), 'control in-' + id);
}
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 8, 'the page looks up its controls');
for (const id of requestedIds) {
  assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
}
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Wi-Fi Access Point Capacity Planner');
assert.equal(record.category, 'IT & Networking');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('site survey'), 'method states the model limits');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 3, 'sources are recorded');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 16, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 2, 'two boundary cases');
assert.equal(kinds('validation'), 6, 'six validation cases');
for (const testCase of record.testCases) {
  const { input, expected } = testCase;
  if (expected.error) {
    assert.throws(
      () => C.calculate(input),
      new RegExp(expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = run(input);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(result[key], value, testCase.name + ' ' + key);
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
for (const key of [record.slug, record.name].concat(record.aliases || [])) {
  const owners = keyOwners.get(String(key).toLowerCase());
  assert.deepEqual(Array.from(owners), [slug], 'catalog key is unique to this tool: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.ok(record.aliases.some((alias) => alias === alias.toLowerCase()), 'lowercase search aliases are present');

console.log('wifi-access-point-capacity-planner: all checks passed ('
  + record.testCases.length + ' catalog cases, 72 identity runs)');
