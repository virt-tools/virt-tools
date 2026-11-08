/* Regression checks for the virtualization host sizing core, its catalog
   cases and the arithmetic behind host counts, binding constraints and HA. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const page = path.join(root, 'frontend/tools/virtualization-host-sizing-calculator/index.html');
const html = fs.readFileSync(page, 'utf8');
const start = html.indexOf('/* vm-host-sizing-core:start */');
const end = html.indexOf('/* vm-host-sizing-core:end */');
assert.ok(start > -1 && end > start, 'host sizing core markers missing');
const core = html.slice(start, end + '/* vm-host-sizing-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = VmHostSizingCore;', sandbox);
const C = sandbox.module.exports;
const run = (input) => C.calculate(input);
const close = (actual, expected, label, eps = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= eps,
    `${label}: expected ${expected}, got ${actual}`);
};
const err = (input) => {
  try {
    C.calculate(input);
  } catch (error) {
    return error.message;
  }
  throw new Error('expected an error for ' + JSON.stringify(input));
};

// The textbook case: 120 four-vCPU guests fit four 32-core hosts at 4:1 and
// four hosts of 512 GB, so one spare host makes five.
const base = run({});
assert.equal(base.vmCount, 120);
assert.equal(base.vcpusPerVm, 4);
assert.equal(base.coresPerHost, 32);
assert.equal(base.vcpuPerCore, 4);
assert.equal(base.ramPerVmGb, 16);
assert.equal(base.ramPerHostGb, 512);
assert.equal(base.haSpareHosts, 1);
assert.equal(base.totalVcpus, 480);
assert.equal(base.coresRequired, 120);
assert.equal(base.hostsForCpu, 4);
assert.equal(base.ramRequiredGb, 1920);
assert.equal(base.hostsForRam, 4);
assert.equal(base.baseHosts, 4);
assert.equal(base.totalHosts, 5);
assert.equal(base.binding, 'balanced');
close(base.vmsPerHost, 24);
assert.equal(base.provisionedCores, 160);
close(base.achievedVcpuPerCore, 3);
assert.equal(base.memoryCapacityGb, 2560);
close(base.memoryPercent, 75);
assert.equal(base.cpuHeadroomVcpus, 160);
assert.equal(base.ramHeadroomGb, 640);

// The binding constraint is whichever side needs more hosts.
const cpuBound = run({ vmCount: '300', vcpusPerVm: '2', coresPerHost: '16',
  vcpuPerCore: '3', ramPerVmGb: '8', ramPerHostGb: '256', haSpareHosts: '1' });
assert.equal(cpuBound.hostsForCpu, 13);
assert.equal(cpuBound.hostsForRam, 10);
assert.equal(cpuBound.binding, 'cpu');
const memBound = run({ ramPerHostGb: '128' });
assert.equal(memBound.hostsForCpu, 4);
assert.equal(memBound.hostsForRam, 15);
assert.equal(memBound.binding, 'memory');
assert.equal(memBound.baseHosts, 15);

// Spare hosts carry no workload: they add capacity but never raise the ratio.
const noSpare = run({ haSpareHosts: '0' });
assert.equal(noSpare.totalHosts, 4);
assert.equal(noSpare.cpuHeadroomVcpus, 32);
close(noSpare.achievedVcpuPerCore, 3.75);
assert.ok(base.achievedVcpuPerCore < noSpare.achievedVcpuPerCore, 'spares dilute the ratio');
assert.equal(run({ haSpareHosts: '' }).totalHosts, 4, 'blank spare means none');
assert.equal(run({ haSpareHosts: null }).totalHosts, 5, 'null spare uses the default');

// Rounding can never undersize: each host count covers the demand, and one
// host fewer would not.
let referenceCases = 0;
for (const vmCount of [1, 7, 120, 333, 1000]) {
  for (const vcpusPerVm of [1, 2, 4, 8, 64]) {
    for (const coresPerHost of [1, 8, 32, 64, 256]) {
      for (const ratio of [1, 2, 3.5, 4, 16]) {
        const result = run({ vmCount: String(vmCount), vcpusPerVm: String(vcpusPerVm),
          coresPerHost: String(coresPerHost), vcpuPerCore: String(ratio) });
        assert.equal(result.totalVcpus, vmCount * vcpusPerVm, 'vCPUs to place');
        assert.equal(result.coresRequired, Math.ceil(vmCount * vcpusPerVm / ratio), 'cores required');
        assert.ok(result.hostsForCpu * coresPerHost >= result.coresRequired, 'CPU hosts cover demand');
        if (result.hostsForCpu > 1) {
          assert.ok((result.hostsForCpu - 1) * coresPerHost < result.coresRequired,
            'CPU hosts are minimal');
        }
        assert.equal(result.hostsForRam, Math.ceil(vmCount * 16 / 512), 'memory hosts');
        assert.equal(result.baseHosts, Math.max(result.hostsForCpu, result.hostsForRam), 'base hosts');
        assert.equal(result.totalHosts, result.baseHosts + 1, 'spare added after the base');
        assert.equal(result.provisionedCores, result.totalHosts * coresPerHost, 'provisioned cores');
        close(result.achievedVcpuPerCore, result.totalVcpus / (result.totalHosts * coresPerHost),
          'achieved ratio');
        assert.ok(result.achievedVcpuPerCore <= ratio + 1e-9, 'ratio never exceeds the target');
        close(result.memoryPercent, result.ramRequiredGb / result.memoryCapacityGb * 100,
          'memory percent');
        assert.ok(result.memoryPercent <= 100, 'committed memory fits');
        close(result.cpuHeadroomVcpus, result.provisionedCores * ratio - result.totalVcpus,
          'vCPU headroom');
        assert.ok(result.cpuHeadroomVcpus >= 0, 'headroom is not negative');
        close(result.vmsPerHost, vmCount / result.totalHosts, 'average VMs per host');
        referenceCases += 1;
      }
    }
  }
}
for (const ramPerVm of [0.25, 1.5, 16, 1024]) {
  for (const ramPerHost of [1, 64, 128, 512, 8192]) {
    const result = run({ vmCount: '250', ramPerVmGb: String(ramPerVm), ramPerHostGb: String(ramPerHost) });
    const expected = Math.ceil(250 * ramPerVm / ramPerHost);
    assert.equal(result.hostsForRam, expected, `${ramPerVm} GB ${ramPerHost} GB hosts`);
    assert.ok(expected * ramPerHost >= 250 * ramPerVm, 'memory hosts cover demand');
    if (expected > 1) {
      assert.ok((expected - 1) * ramPerHost < 250 * ramPerVm, 'memory hosts are minimal');
    }
    referenceCases += 1;
  }
}

// Inclusive bounds at both ends of each accepted range.
const smallest = run({ vmCount: '1', vcpusPerVm: '1', coresPerHost: '1', vcpuPerCore: '1',
  ramPerVmGb: '0.25', ramPerHostGb: '1', haSpareHosts: '0' });
assert.equal(smallest.totalHosts, 1);
assert.equal(smallest.binding, 'balanced');
const largest = run({ vmCount: '10000', vcpusPerVm: '64', coresPerHost: '256', vcpuPerCore: '16',
  ramPerVmGb: '1024', ramPerHostGb: '8192', haSpareHosts: '8' });
assert.equal(largest.totalVcpus, 640000);
assert.equal(largest.totalHosts, 1258);
assert.equal(largest.binding, 'memory');

// Bad input fails with an actionable message, never a silent default.
assert.equal(err({ vmCount: '' }), 'VMs to place is required.');
assert.equal(err({ vmCount: '  ' }), 'VMs to place is required.');
assert.equal(err({ vmCount: '0' }), 'VMs to place must be a whole number from 1 to 10000 VMs.');
assert.equal(err({ vmCount: '10001' }), 'VMs to place must be a whole number from 1 to 10000 VMs.');
assert.equal(err({ vmCount: '12.5' }), 'VMs to place must be a whole number from 1 to 10000 VMs.');
assert.equal(err({ vmCount: '1e3' }), 'VMs to place must be a whole number from 1 to 10000 VMs.');
assert.equal(err({ vcpusPerVm: '0' }), 'vCPUs per VM must be a whole number from 1 to 64 vCPUs.');
assert.equal(err({ vcpusPerVm: '65' }), 'vCPUs per VM must be a whole number from 1 to 64 vCPUs.');
assert.equal(err({ coresPerHost: '' }), 'Cores per host is required.');
assert.equal(err({ coresPerHost: '32.5' }), 'Cores per host must be a whole number from 1 to 256 cores.');
assert.equal(err({ coresPerHost: '257' }), 'Cores per host must be a whole number from 1 to 256 cores.');
assert.equal(err({ vcpuPerCore: '0.5' }),
  'vCPU per core must be a number from 1 to 16 vCPUs per physical core.');
assert.equal(err({ vcpuPerCore: '17' }),
  'vCPU per core must be a number from 1 to 16 vCPUs per physical core.');
assert.equal(err({ ramPerVmGb: '' }), 'RAM per VM is required.');
assert.equal(err({ ramPerVmGb: '0.1' }), 'RAM per VM must be a number from 0.25 to 1024 GB.');
assert.equal(err({ ramPerHostGb: '0' }), 'Usable RAM per host must be a number from 1 to 8192 GB.');
assert.equal(err({ ramPerHostGb: '9000' }), 'Usable RAM per host must be a number from 1 to 8192 GB.');
assert.equal(err({ haSpareHosts: '-1' }), 'HA spare hosts must be a whole number from 0 to 8 hosts.');
assert.equal(err({ haSpareHosts: '9' }), 'HA spare hosts must be a whole number from 0 to 8 hosts.');
// Missing options fall back to the documented defaults.
assert.equal(run({ vmCount: null, ramPerHostGb: null }).totalHosts, 5, 'nulls use defaults');

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html.replace(/https:\/\/virt\.tools[^"]*/g, '')), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="vh-form"/.test(html), 'page has a submittable form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/<label class="f" for="in-spare"/.test(html), 'page labels the HA spare field');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'virtualization-host-sizing-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Virtualization Host Sizing Calculator');
assert.equal(record.category, 'IT & Networking');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10, 'ten golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 11, 'eleven validation cases');
for (const testCase of record.testCases) {
  const options = { ...C.DEFAULTS, ...testCase.input };
  if (testCase.expected && testCase.expected.error) {
    assert.equal(err(options), testCase.expected.error, testCase.name);
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

console.log('virtualization-host-sizing-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + referenceCases + ' reference cases)');
