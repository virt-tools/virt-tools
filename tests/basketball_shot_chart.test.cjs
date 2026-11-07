/* Regression checks for the basketball shot chart state and shooting statistics. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/basketball-shot-chart/index.html'), 'utf8');
const startMarker = '/* basketball-shot-chart-core:start */';
const endMarker = '/* basketball-shot-chart-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'basketball shot chart core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = BasketballShotChartCore;', sandbox);
const C = sandbox.module.exports;

function runCase(testCase) {
  const input = testCase.input;
  const state = C.makeState();
  for (const shot of input.shots || []) C.addShot(state, shot.zone, shot.made);
  if (input.repeat) {
    for (let index = 0; index < input.repeat.count; index += 1) C.addShot(state, input.repeat.zone, input.repeat.made);
  }
  for (let index = 0; index < (input.undo || 0); index += 1) C.undo(state);
  const summary = C.summarize(state);
  summary.copyText = C.copyText(summary);
  return summary;
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'basketball-shot-chart');
assert.equal(records.length, 1, 'catalog must contain exactly one basketball shot chart');
const record = records[0];
assert.equal(record.name, 'Basketball Shot Chart');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('Basketball Shooting Chart'));
assert.ok(record.testCases.length >= 10, 'catalog carries statistics and validation checks');

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => runCase(testCase), (error) => error.message === testCase.expected.error, testCase.name);
    continue;
  }
  assert.equal(testCase.kind, 'golden', testCase.name);
  const actual = runCase(testCase);
  for (const [key, expectedValue] of Object.entries(testCase.expected)) {
    if (expectedValue === null) assert.equal(actual[key], null, `${testCase.name}: ${key}`);
    else if (typeof expectedValue === 'number' && !Number.isInteger(expectedValue)) assert.ok(Math.abs(actual[key] - expectedValue) < 1e-12, `${testCase.name}: ${key}`);
    else assert.equal(actual[key], expectedValue, `${testCase.name}: ${key}`);
  }
}

const zones = C.getZones();
assert.equal(zones.length, 8);
assert.equal(new Set(Array.from(zones, (zone) => zone.id)).size, 8, 'zone ids unique');
for (const zone of Array.from(zones)) {
  assert.ok(zone.points === 2 || zone.points === 3, `${zone.id} point value`);
  const state = C.makeState();
  C.addShot(state, zone.id, true);
  const summary = C.summarize(state);
  assert.equal(summary.points, zone.points, `${zone.id} scoring`);
  assert.equal(summary.makes, 1);
  assert.equal(summary.attempts, 1);
  assert.equal(summary.fgPct, 100);
  assert.equal(summary.efgPct, zone.points === 3 ? 150 : 100);
}

{
  const state = C.makeState();
  C.addShot(state, 'rim', true);
  C.addShot(state, 'top-3', false);
  const removed = C.undo(state);
  assert.equal(removed.zone, 'top-3');
  assert.equal(removed.made, false);
  assert.equal(C.summarize(state).attempts, 1);
  assert.equal(C.undo(state).zone, 'rim');
  assert.equal(C.undo(state), null);
  assert.equal(C.summarize(state).attempts, 0);
}
{
  const state = C.makeState();
  for (let index = 0; index < 500; index += 1) C.addShot(state, 'rim', index % 2 === 0);
  assert.equal(C.summarize(state).attempts, 500);
  assert.throws(() => C.addShot(state, 'rim', true), /Keep at most 500 shots/);
  assert.equal(C.summarize(state).attempts, 500, 'rejected shot must not mutate state');
  C.reset(state);
  assert.equal(C.summarize(state).attempts, 0);
}
for (const invalid of ['free-throw', '', null, undefined, 'RIM']) {
  assert.throws(() => C.addShot(C.makeState(), invalid, true), /Choose a valid court zone\./);
}
for (const invalid of ['yes', 1, 0, null, undefined]) {
  assert.throws(() => C.addShot(C.makeState(), 'rim', invalid), /Shot result must be made \(true\) or missed \(false\)\./);
}
assert.throws(() => C.summarize({}), /Shot chart state is invalid\./);

console.log(`basketball-shot-chart: all checks passed (${record.testCases.length} catalog cases, ${zones.length} court zones)`);
