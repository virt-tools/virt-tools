/* Regression checks for the Erlang C call queue core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/erlang-c-call-queue-calculator/index.html'), 'utf8');
const start = html.indexOf('/* erlang-c-core:start */');
const end = html.indexOf('/* erlang-c-core:end */');
assert.ok(start > -1 && end > start, 'Erlang C core markers missing');
const core = html.slice(start, end + '/* erlang-c-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ErlangCCore;', sandbox);
const C = sandbox.module.exports;
const analyse = (options) => C.analyse(options);
const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`);
};
const same = (actual, expected, label) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), label);

// Independent reference: 240 calls/hour x 180 seconds is 12 erlangs.
const standard = analyse({});
near(standard.traffic, 12, 'default offered load');
assert.equal(standard.stable, true, 'default queue is stable');
near(standard.probabilityQueued, 0.31919042511255974, 'default probability queued');
near(standard.probabilityQueuedPercent, 31.919042511255974, 'default queue percentage');
near(standard.averageWaitSeconds, 19.151425506753583, 'default average wait');
near(standard.queuedWaitSeconds, 60, 'default queued wait');
near(standard.serviceLevelPercent, 77.12900663714926, 'default service level');
near(standard.occupancyPercent, 80, 'default occupancy');
assert.equal(standard.requiredAgents, 16, 'sixteen agents meet 80% in 20 seconds');
same(Array.from(standard.staffing, (row) => row.agents), [14, 15, 16, 17, 18], 'default staffing rows');
same(Array.from(standard.staffing, (row) => row.meetsTarget), [false, false, true, true, true], 'default target flags');
near(standard.staffing[0].serviceLevelPercent, 61.428049096120084, 'fourteen-agent service');
near(standard.staffing[2].serviceLevelPercent, 86.88312539855578, 'sixteen-agent service');

// With a zero-second answer threshold, service level is exactly 1 - Erlang C.
const immediate = analyse({ answerSeconds: 0 });
near(immediate.serviceLevel, 1 - immediate.probabilityQueued, 'zero-second service identity');
near(immediate.serviceLevelPercent, 68.08095748874403, 'zero-second service level');
assert.equal(immediate.requiredAgents, 17, 'immediate-answer staffing target');
same(Array.from(immediate.staffing, (row) => row.agents), [15, 16, 17, 18, 19], 'zero-second staffing rows');

// A second published-style example uses ten erlangs and a thirty-second target.
const ten = analyse({ callsPerHour: 120, handleSeconds: 300, agents: 14, answerSeconds: 30, targetPercent: 85 });
near(ten.traffic, 10, 'ten-erlang load');
near(ten.probabilityQueuedPercent, 17.413193359504984, 'ten-erlang queue probability');
near(ten.averageWaitSeconds, 13.059895019628739, 'ten-erlang average wait');
near(ten.queuedWaitSeconds, 75, 'ten-erlang queued wait');
near(ten.serviceLevelPercent, 88.32758742562913, 'ten-erlang service level');
assert.equal(ten.requiredAgents, 14, 'fourteen agents meet 85% in 30 seconds');

// At or above capacity there is no steady-state average, but target staffing remains calculable.
for (const test of [
  { options: { callsPerHour: 600, agents: 20 }, traffic: 30, occupancy: 150, required: 35 },
  { options: { callsPerHour: 360, agents: 18 }, traffic: 18, occupancy: 100, required: 22 },
]) {
  const result = analyse(test.options);
  near(result.traffic, test.traffic, 'unstable offered load');
  assert.equal(result.stable, false, 'unstable flag');
  near(result.occupancyPercent, test.occupancy, 'unstable occupancy');
  assert.equal(result.probabilityQueued, null, 'no steady queue probability');
  assert.equal(result.averageWaitSeconds, null, 'no steady average wait');
  assert.equal(result.queuedWaitSeconds, null, 'no steady queued wait');
  assert.equal(result.serviceLevel, null, 'no steady service level');
  assert.equal(result.serviceLevelPercent, null, 'no steady service percentage');
  assert.equal(result.requiredAgents, test.required, 'unstable target staffing');
  assert.ok(result.staffing.every((row) => row.stable), 'staffing cards have stable steady-state values');
}

// The M/M/1 special case has closed-form queue probability A and queued wait H/(1-A).
const single = analyse({ callsPerHour: 6, handleSeconds: 120, agents: 1, answerSeconds: 60, targetPercent: 50 });
near(single.traffic, 0.2, 'single-agent offered load');
near(single.probabilityQueued, 0.2, 'single-agent queue probability');
near(single.averageWaitSeconds, 30, 'single-agent average wait');
near(single.queuedWaitSeconds, 150, 'single-agent queued wait');
near(single.serviceLevelPercent, 86.59359907928722, 'single-agent service level');
assert.equal(single.requiredAgents, 1, 'one agent meets the small-load target');
same(Array.from(single.staffing, (row) => row.agents), [1, 2, 3], 'small-load staffing starts at one');

// Fractional averages and a large busy-hour group retain unrounded arithmetic.
const fractional = analyse({ callsPerHour: '73.5', handleSeconds: '217.5', agents: '7', answerSeconds: '12.5', targetPercent: '75' });
near(fractional.traffic, 4.440625, 'fractional offered load');
near(fractional.probabilityQueuedPercent, 20.619262848304672, 'fractional queue probability');
near(fractional.averageWaitSeconds, 17.52259699929188, 'fractional average wait');
near(fractional.serviceLevelPercent, 82.20112574221058, 'fractional service level');
assert.equal(fractional.requiredAgents, 7, 'fractional target staffing');
const large = analyse({ callsPerHour: 20000, handleSeconds: 180, agents: 1100, answerSeconds: 20, targetPercent: 80 });
near(large.traffic, 1000, 'large offered load');
near(large.probabilityQueuedPercent, 0.10447979284075119, 'large queue probability');
near(large.averageWaitSeconds, 0.0018806362711335214, 'large average wait');
near(large.serviceLevelPercent, 99.99999843851413, 'large service level');
assert.equal(large.requiredAgents, 1011, 'large target staffing');
assert.ok(Number.isFinite(large.serviceLevel), 'large service level stays finite');

// Adding agents cannot worsen service level or average waiting time.
let previousService = -1;
let previousWait = Infinity;
for (let agents = 13; agents <= 24; agents += 1) {
  const result = analyse({ agents });
  assert.ok(result.serviceLevelPercent > previousService, `service rises at ${agents} agents`);
  assert.ok(result.averageWaitSeconds < previousWait, `wait falls at ${agents} agents`);
  previousService = result.serviceLevelPercent;
  previousWait = result.averageWaitSeconds;
}

// Independent closed-form Erlang B/C oracle for small and medium groups.
const reference = (traffic, handle, answer, agents) => {
  let term = 1;
  let sum = 1;
  for (let k = 1; k <= agents; k += 1) {
    term *= traffic / k;
    sum += term;
  }
  const blocking = term / sum;
  const rho = traffic / agents;
  const queued = blocking / (1 - rho * (1 - blocking));
  return {
    queued,
    wait: queued * handle / (agents - traffic),
    service: (1 - queued * Math.exp(-(agents - traffic) * answer / handle)) * 100,
  };
};
for (const traffic of [0.2, 1, 4.440625, 10, 12, 30]) {
  for (let agents = Math.floor(traffic) + 1; agents <= Math.floor(traffic) + 18; agents += 1) {
    const calls = traffic * 2;
    const result = analyse({ callsPerHour: calls, handleSeconds: 1800, agents, answerSeconds: 25, targetPercent: 80 });
    const expected = reference(traffic, 1800, 25, agents);
    near(result.probabilityQueued, expected.queued, `closed-form queue A=${traffic} N=${agents}`, 1e-11);
    near(result.averageWaitSeconds, expected.wait, `closed-form wait A=${traffic} N=${agents}`, 1e-11);
    near(result.serviceLevelPercent, expected.service, `closed-form service A=${traffic} N=${agents}`, 1e-11);
  }
}

// Strict validation, including the offered-load ceiling.
assert.throws(() => analyse({ callsPerHour: '' }), /Calls per hour is required\./);
assert.throws(() => analyse({ callsPerHour: 'many' }), /Calls per hour must be a number between 0\.01 and 36,000\./);
assert.throws(() => analyse({ callsPerHour: 0 }), /Calls per hour must be between 0\.01 and 36,000\./);
assert.throws(() => analyse({ callsPerHour: 36001 }), /Calls per hour must be between 0\.01 and 36,000\./);
assert.throws(() => analyse({ handleSeconds: '' }), /Average handle time is required\./);
assert.throws(() => analyse({ handleSeconds: 0 }), /Average handle time must be between 1 and 3,600 seconds\./);
assert.throws(() => analyse({ handleSeconds: 3601 }), /Average handle time must be between 1 and 3,600 seconds\./);
assert.throws(() => analyse({ agents: '' }), /Agents available is required\./);
assert.throws(() => analyse({ agents: 'many' }), /Agents available must be a whole number from 1 to 1,500\./);
assert.throws(() => analyse({ agents: 1.5 }), /Agents available must be a whole number from 1 to 1,500\./);
assert.throws(() => analyse({ agents: 0 }), /Agents available must be a whole number from 1 to 1,500\./);
assert.throws(() => analyse({ agents: 1501 }), /Agents available must be a whole number from 1 to 1,500\./);
assert.throws(() => analyse({ answerSeconds: '' }), /Answer time is required\./);
assert.throws(() => analyse({ answerSeconds: -1 }), /Answer time must be between 0 and 3,600 seconds\./);
assert.throws(() => analyse({ answerSeconds: 3601 }), /Answer time must be between 0 and 3,600 seconds\./);
assert.throws(() => analyse({ targetPercent: '' }), /Target service level is required\./);
assert.throws(() => analyse({ targetPercent: 0 }), /Target service level must be between 0\.01 and 99\.9 percent\./);
assert.throws(() => analyse({ targetPercent: 100 }), /Target service level must be between 0\.01 and 99\.9 percent\./);
assert.throws(() => analyse({ callsPerHour: 36000, handleSeconds: 3600 }), /Offered load must not exceed 1,000 erlangs/);

// Replay every canonical catalog test case against the same public core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'erlang-c-call-queue-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.risk, 'low');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 16, 'catalog has the full test case set');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compare = (actual, expected, label) => {
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, `${label} length`);
    expected.forEach((item, index) => compare(actual[index], item, `${label}[${index}]`));
    return;
  }
  if (expected && typeof expected === 'object') {
    for (const [key, value] of Object.entries(expected)) compare(actual[key], value, `${label}.${key}`);
    return;
  }
  if (typeof expected === 'number' && typeof actual === 'number') {
    near(actual, expected, label);
    return;
  }
  assert.equal(actual, expected, label);
};
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => analyse(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  const result = analyse(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) compare(result[key], value, `${testCase.name} ${key}`);
}

console.log('erlang-c-call-queue-calculator: all checks passed (' + record.testCases.length + ' catalog cases, 108 independent reference cases)');
