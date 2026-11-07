/* Regression checks for the CPU process scheduling visualizer core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/process-scheduling-visualizer/index.html'), 'utf8');
const startMarker = '/* process-scheduling-core:start */';
const endMarker = '/* process-scheduling-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'process scheduling core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = ProcessSchedulingCore;', sandbox);
const C = sandbox.module.exports;

const fcfs = C.calculate({
  algorithm: 'fcfs',
  processes: [
    {id: 'P1', arrival: 0, burst: 5},
    {id: 'P2', arrival: 2, burst: 2}
  ]
});
assert.deepEqual(Array.from(fcfs.segments, (s) => [s.id, s.start, s.end]), [['P1', 0, 5], ['P2', 5, 7]]);
assert.deepEqual(Array.from(fcfs.processes, (p) => [p.id, p.completion, p.turnaround, p.waiting, p.response]), [
  ['P1', 5, 5, 0, 0],
  ['P2', 7, 5, 3, 3]
]);
assert.equal(fcfs.averageWaiting, 1.5);
assert.equal(fcfs.averageTurnaround, 5);
assert.equal(fcfs.makespan, 7);

const sjf = C.calculate({
  algorithm: 'sjf',
  processes: [
    {id: 'P1', arrival: 0, burst: 5},
    {id: 'P2', arrival: 1, burst: 3},
    {id: 'P3', arrival: 2, burst: 8},
    {id: 'P4', arrival: 3, burst: 6}
  ]
});
assert.deepEqual(Array.from(sjf.segments, (s) => [s.id, s.start, s.end]), [
  ['P1', 0, 5], ['P2', 5, 8], ['P4', 8, 14], ['P3', 14, 22]
]);
assert.deepEqual(Array.from(sjf.processes, (p) => [p.id, p.waiting, p.response]), [
  ['P1', 0, 0], ['P2', 4, 4], ['P3', 12, 12], ['P4', 5, 5]
]);
assert.equal(sjf.averageWaiting, 5.25);
assert.equal(sjf.averageTurnaround, 10.75);

const idle = C.calculate({algorithm: 'fcfs', processes: [{id: 'Later', arrival: 3, burst: 2}]});
assert.deepEqual(Array.from(idle.segments, (s) => [s.id, s.start, s.end]), [[null, 0, 3], ['Later', 3, 5]]);

const rr = C.calculate({
  algorithm: 'rr', quantum: 2,
  processes: [
    {id: 'P1', arrival: 0, burst: 5},
    {id: 'P2', arrival: 1, burst: 3},
    {id: 'P3', arrival: 2, burst: 8},
    {id: 'P4', arrival: 3, burst: 6}
  ]
});
assert.deepEqual(Array.from(rr.segments, (s) => [s.id, s.start, s.end]), [
  ['P1', 0, 2], ['P2', 2, 4], ['P3', 4, 6], ['P1', 6, 8],
  ['P4', 8, 10], ['P2', 10, 11], ['P3', 11, 13], ['P1', 13, 14],
  ['P4', 14, 16], ['P3', 16, 18], ['P4', 18, 20], ['P3', 20, 22]
]);
assert.deepEqual(Array.from(rr.processes, (p) => [p.id, p.completion, p.turnaround, p.waiting, p.response]), [
  ['P1', 14, 14, 9, 0], ['P2', 11, 10, 7, 1], ['P3', 22, 20, 12, 2], ['P4', 20, 17, 11, 5]
]);
assert.equal(rr.averageWaiting, 9.75);
assert.equal(rr.averageTurnaround, 15.25);
assert.equal(rr.quantum, 2);

const parsed = C.parseProcesses('Alpha job, 0, 4\nBeta, 2, 1');
assert.deepEqual(Array.from(parsed, (p) => [p.id, p.arrival, p.burst]), [['Alpha job', 0, 4], ['Beta', 2, 1]]);
assert.match(C.summary(rr), /Algorithm: Round Robin/);
assert.match(C.summary(rr), /Quantum: 2 time units/);
assert.match(C.summary(rr), /P1,0,5,14,14,9,0/);
assert.match(C.summary(rr), /Average waiting: 9\.75/);

const one = [{id: 'Only', arrival: 0, burst: 1}];
for (const bad of [undefined, null, [], {}, 'P1,0,1', Array(13).fill({id: 'P', arrival: 0, burst: 1})]) {
  assert.throws(() => C.calculate({algorithm: 'fcfs', processes: bad}), /1 to 12 processes/);
}
for (const bad of ['', ' ', null, {}, [], 'ABCDEFGHIJKLMNOPQ']) {
  assert.throws(() => C.calculate({algorithm: 'fcfs', processes: [{id: bad, arrival: 0, burst: 1}]}), /Process name/);
}
assert.throws(() => C.calculate({algorithm: 'fcfs', processes: [{id: 'Same', arrival: 0, burst: 1}, {id: 'same', arrival: 1, burst: 1}]}), /unique/i);
for (const arrival of [-1, 1.5, 10001, NaN, Infinity, '1', null, false, undefined]) {
  assert.throws(() => C.calculate({algorithm: 'fcfs', processes: [{id: 'P', arrival, burst: 1}]}), /arrival/i);
}
for (const burst of [0, -1, 1.5, 10001, NaN, Infinity, '1', null, false, undefined]) {
  assert.throws(() => C.calculate({algorithm: 'fcfs', processes: [{id: 'P', arrival: 0, burst}]}), /burst/i);
}
for (const quantum of ['', ' ', 0, -1, 1.5, 101, '2x', NaN, Infinity, null, false, undefined, {}, []]) {
  assert.throws(() => C.calculate({algorithm: 'rr', quantum, processes: one}), /quantum/i);
}
for (const text of ['', ' \n ', 'P1,0', 'P1,0,1,extra', 'P1,,1', 'P1,1e2,1', 'P1,-1,1', 'P1,0,0', 'P1,0,1\nP1,1,2']) {
  assert.throws(() => C.parseProcesses(text));
}
assert.equal(C.calculate({algorithm: 'fcfs', processes: [{id: '__proto__', arrival: 0, burst: 1}]}).processes[0].id, '__proto__');
assert.throws(() => C.calculate({algorithm: 'rr', quantum: 1, processes: [{id: 'Long', arrival: 0, burst: 601}]}), /600 slices/);

let invariantCases = 0;
for (const algorithm of ['fcfs', 'sjf', 'rr']) {
  for (let seed = 1; seed <= 60; seed += 1) {
    const processes = Array.from({length: 1 + seed % 8}, (_, index) => ({
      id: `P${index + 1}`,
      arrival: (seed * 17 + index * index * 7 + index * 3) % 29,
      burst: 1 + (seed * 11 + index * 5) % 13
    }));
    const result = C.calculate({algorithm, quantum: 1 + seed % 5, processes});
    let previousEnd = 0;
    const executed = Object.fromEntries(processes.map((p) => [p.id, 0]));
    const starts = Object.fromEntries(processes.map((p) => [p.id, []]));
    for (const segment of result.segments) {
      assert.equal(segment.start, previousEnd, `${algorithm} seed ${seed}: contiguous timeline`);
      assert.ok(segment.end > segment.start);
      previousEnd = segment.end;
      if (segment.id !== null) {
        const source = processes.find((p) => p.id === segment.id);
        assert.ok(segment.start >= source.arrival, `${algorithm} seed ${seed}: no early execution`);
        executed[segment.id] += segment.end - segment.start;
        starts[segment.id].push(segment.start);
        if (algorithm === 'rr') assert.ok(segment.end - segment.start <= result.quantum);
      }
    }
    for (const row of result.processes) {
      const source = processes.find((p) => p.id === row.id);
      assert.equal(executed[row.id], source.burst, `${algorithm} seed ${seed}: exact burst`);
      assert.equal(row.completion - row.arrival, row.turnaround);
      assert.equal(row.turnaround - row.burst, row.waiting);
      assert.equal(row.response, starts[row.id][0] - row.arrival);
      if (algorithm !== 'rr') assert.equal(starts[row.id].length, 1);
    }
    assert.equal(result.makespan, previousEnd);
    invariantCases += 1;
  }
}
assert.equal(invariantCases, 180);

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'process-scheduling-visualizer');
assert.equal(records.length, 1, 'catalog must contain exactly one process scheduling visualizer');
const record = records[0];
assert.equal(record.name, 'Process Scheduling Visualizer');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 13, 'catalog carries golden, boundary and validation checks');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.calculate(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  const result = C.calculate(testCase.input);
  const timeline = result.segments.map((s) => `${s.id === null ? 'Idle' : s.id}:${s.start}-${s.end}`).join('|');
  assert.equal(timeline, testCase.expected.timeline, testCase.name);
  for (const key of ['averageWaiting', 'averageTurnaround', 'makespan']) {
    assert.equal(result[key], testCase.expected[key], `${testCase.name}: ${key}`);
  }
}

console.log(`process-scheduling-visualizer: ${record.testCases.length} catalog cases and ${invariantCases} generated invariant cases passed`);
