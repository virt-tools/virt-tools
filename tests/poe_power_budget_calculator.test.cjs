/* Regression checks for the PoE power budget core, its catalog cases and the
   arithmetic behind the load, headroom and per-port limits. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'poe-power-budget-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* poe-budget-core:start */');
const end = html.indexOf('/* poe-budget-core:end */');
assert.ok(start > -1 && end > start, 'poe budget core markers missing');
const core = html.slice(start, end + '/* poe-budget-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PoeBudgetCore;', sandbox);
const C = sandbox.module.exports;
const run = (input) => C.calculate(input);
const close = (actual, expected, label, eps = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= eps,
    `${label}: expected ${expected}, got ${actual}`);
};

// The default plan: twelve 12.95 W devices on a 370 W 802.3at switch.
const base = run({});
assert.equal(base.standard, 'at');
assert.equal(base.standardLabel, '802.3at Type 2');
close(base.perPortW, 30, 'default per-port limit');
close(base.budgetW, 370, 'default budget');
close(base.ports, 24, 'default ports');
close(base.deviceW, 12.95, 'default draw');
close(base.devices, 12, 'default devices');
close(base.loadW, 155.4, 'default load');
close(base.headroomW, 214.6, 'default headroom');
close(base.usedPercent, 42, 'default used percent');
assert.equal(base.maxDevicesByPower, 28);
assert.equal(base.maxDevicesByPorts, 24);
assert.equal(base.supportedDevices, 24);
assert.equal(base.limiting, 'ports');
assert.equal(base.sparePorts, 12);
assert.equal(base.portShortfall, 0);
assert.equal(base.overBudget, false);

// An over-budget plan reports the shortfall instead of clamping it away.
const over = run({ standard: 'at', budget: '100', ports: '24', device: '25.5', devices: '6' });
close(over.loadW, 153, 'over-budget load');
close(over.headroomW, -53, 'over-budget headroom');
assert.equal(over.overBudget, true);
assert.equal(over.maxDevicesByPower, 3);
assert.equal(over.supportedDevices, 3);
assert.equal(over.limiting, 'power');

// A device count above the port count reports the extra ports needed.
const short = run({ standard: 'bt3', budget: '600', ports: '8', device: '51', devices: '10' });
close(short.loadW, 510, 'short-port load');
close(short.headroomW, 90, 'short-port headroom');
assert.equal(short.sparePorts, -2);
assert.equal(short.portShortfall, 2);
assert.equal(short.limiting, 'ports');

// Balanced plans are labelled when power and ports allow the same count.
const balanced = run({ standard: 'af', budget: '155.4', ports: '12', device: '12.95', devices: '12' });
assert.equal(balanced.limiting, 'balanced');
assert.equal(balanced.maxDevicesByPower, 12);
close(balanced.headroomW, 0, 'balanced headroom');

// Every reported figure must follow from the inputs alone across the ranges.
let referenceCases = 0;
for (const standard of ['af', 'at', 'bt3', 'bt4']) {
  const per = C.STANDARDS[standard].perPortW;
  for (const budget of ['0.1', '15.4', '100', '370', '600', '1000', '10000']) {
    for (const device of ['0.1', '1', '4', '12.95', '25.5', String(per)]) {
      if (Number(device) > per) continue;
      for (const ports of ['1', '8', '24', '48', '512']) {
        for (const devices of ['1', '7', '12', '513', '1024']) {
          const result = run({ standard, budget, ports, device, devices });
          const load = Number(devices) * Number(device);
          const maxPower = Math.floor((Number(budget) + 1e-9) / Number(device));
          const expectedLimiting = maxPower < Number(ports) ? 'power'
            : (Number(ports) < maxPower ? 'ports' : 'balanced');
          close(result.loadW, load, `${standard} ${budget} ${device} ${devices} load`);
          close(result.headroomW, Number(budget) - load, `${standard} ${budget} ${device} ${devices} headroom`);
          close(result.usedPercent, load / Number(budget) * 100, `${standard} ${budget} ${device} ${devices} percent`);
          assert.equal(result.maxDevicesByPower, maxPower, `${standard} ${budget} ${device} max by power`);
          assert.equal(result.maxDevicesByPorts, Number(ports), `${standard} ${budget} ${device} max by ports`);
          assert.equal(result.supportedDevices, Math.min(maxPower, Number(ports)), `${standard} ${budget} ${device} supported`);
          assert.equal(result.limiting, expectedLimiting, `${standard} ${budget} ${device} limiting`);
          assert.equal(result.sparePorts, Number(ports) - Number(devices), `${standard} ${budget} ${device} spare ports`);
          assert.equal(result.portShortfall, Math.max(0, Number(devices) - Number(ports)), `${standard} ${budget} ${device} shortfall`);
          assert.equal(result.overBudget, load - Number(budget) > 1e-9, `${standard} ${budget} ${device} over budget`);
          referenceCases += 1;
        }
      }
    }
  }
}

// The per-port limit matches the standard exactly, and a draw above it is refused.
for (const standard of ['af', 'at', 'bt3', 'bt4']) {
  const per = C.STANDARDS[standard].perPortW;
  close(run({ standard, budget: '2000', device: String(per), devices: '1' }).deviceW, per, `${standard} exact draw`);
  // The absolute 90 W ceiling coincides with the Type 4 per-port limit, so a
  // draw above it is refused by the range check before the per-port check.
  if (per < C.LIMITS.device.max) {
    assert.throws(() => run({ standard, budget: '2000', device: String(per + 0.1), devices: '1' }),
      /exceeds the .* per-port limit/);
  } else {
    assert.throws(() => run({ standard, budget: '2000', device: String(per + 0.1), devices: '1' }),
      /Draw per device must be a number from 0\.1 to 90 W/);
  }
}

// Inclusive bounds at both ends of each accepted range.
close(run({ standard: 'af', budget: '0.1', ports: '1', device: '0.1', devices: '1' }).headroomW, 0, 'smallest accepted plan');
close(run({ standard: 'af', budget: '10000', ports: '512', device: '1', devices: '1024' }).headroomW, 8976, 'largest budget');
assert.equal(run({ standard: 'af', budget: '512', ports: '512', device: '1', devices: '512' }).limiting, 'balanced');
assert.equal(run({ standard: 'af', budget: '1024', ports: '512', device: '1', devices: '1024' }).portShortfall, 512);

// Bad input fails with an actionable message, never a silent default.
assert.throws(() => run({ device: '31', standard: 'at' }), /A 31 W device exceeds the 30 W per-port limit of 802\.3at Type 2\./);
assert.throws(() => run({ budget: '0' }), /Switch PoE budget must be a number from 0\.1 to 10000 W/);
assert.throws(() => run({ budget: '370.123' }), /at most two decimals/);
assert.throws(() => run({ budget: '10001' }), /Switch PoE budget must be a number from 0\.1 to 10000 W/);
assert.throws(() => run({ budget: '1,000' }), /Switch PoE budget must be a number from 0\.1 to 10000 W/);
assert.throws(() => run({ budget: '-5' }), /Switch PoE budget must be a number from 0\.1 to 10000 W/);
assert.throws(() => run({ ports: '0' }), /PoE ports must be a whole number from 1 to 512\./);
assert.throws(() => run({ ports: '24.5' }), /PoE ports must be a whole number from 1 to 512\./);
assert.throws(() => run({ ports: '513' }), /PoE ports must be a whole number from 1 to 512\./);
assert.throws(() => run({ devices: '0' }), /Number of devices must be a whole number from 1 to 1024\./);
assert.throws(() => run({ devices: '2.5' }), /Number of devices must be a whole number from 1 to 1024\./);
assert.throws(() => run({ devices: '1025' }), /Number of devices must be a whole number from 1 to 1024\./);
assert.throws(() => run({ device: '0' }), /Draw per device must be a number from 0\.1 to 90 W/);
assert.throws(() => run({ device: '91' }), /Draw per device must be a number from 0\.1 to 90 W/);
assert.throws(() => run({ standard: 'poe++' }), /Choose a PoE standard\./);
assert.throws(() => run({ device: 'ten' }), /Draw per device must be a number from 0\.1 to 90 W/);
// Missing or null options fall back to the documented defaults.
close(run({ standard: null, budget: null, ports: null, device: null, devices: null }).loadW, 155.4, 'null falls back to defaults');

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html.replace(/https:\/\/virt\.tools[^"]*/g, '')), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="poe-form"/.test(html), 'page has a submittable form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/<select id="in-standard"/.test(html), 'page lets you choose the PoE standard');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'PoE Power Budget Calculator');
assert.equal(record.category, 'IT & Networking');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.testCases.length >= 20, 'catalog has the full test case set');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 9, 'nine golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 5, 'five boundary cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 15, 'fifteen validation cases');
for (const testCase of record.testCases) {
  const options = { ...C.DEFAULTS, ...testCase.input };
  if (testCase.expected && testCase.expected.error) {
    assert.throws(
      () => C.calculate(options),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = C.calculate(options);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') {
      close(result[key], value, testCase.name + ' ' + key);
    } else {
      assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

console.log('poe-power-budget-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + referenceCases + ' reference cases)');
