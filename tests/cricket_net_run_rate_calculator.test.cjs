/* Regression checks for the cricket net run rate calculator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/cricket-net-run-rate-calculator/index.html'), 'utf8');
const startMarker = '/* cricket-net-run-rate-core:start */';
const endMarker = '/* cricket-net-run-rate-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'Cricket NRR core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = CricketNetRunRateCore;', sandbox);
const C = sandbox.module.exports;
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-12, Math.abs(expected) * 1e-11), `${label || 'value'}: ${actual} != ${expected}`);

const standard = C.calculate({});
assert.equal(standard.runsFor, 250);
assert.equal(standard.runsAgainst, 200);
assert.equal(standard.actualForBalls, 300);
assert.equal(standard.actualAgainstBalls, 273);
assert.equal(standard.quotaBalls, 300);
assert.equal(standard.forBalls, 300);
assert.equal(standard.againstBalls, 300);
close(standard.forRate, 5, 'scoring rate');
close(standard.againstRate, 4, 'conceding rate');
close(standard.netRunRate, 1, 'net run rate');
assert.equal(C.formatOvers(273), '45.3');
assert.equal(C.formatRate(standard.netRunRate, true), '+1.000');
assert.match(C.summary(standard), /Net run rate: \+1\.000/);
assert.match(C.summary(standard), /Opposition all out: yes; 50 overs counted/);

assert.throws(() => C.calculate({quotaOvers: 20, oversFor: '20.1'}), /Overs faced cannot exceed the scheduled quota of 20 overs/);
assert.throws(() => C.calculate({quotaOvers: 20, oversFor: 20, oversAgainst: '20.1'}), /Overs bowled cannot exceed the scheduled quota of 20 overs/);
assert.equal(C.calculate({quotaOvers: 20, oversFor: 20, oversAgainst: 20, allOutAgainst: false}).netRunRate, 2.5);

const actualOvers = C.calculate({runsFor: 180, runsAgainst: 175, oversFor: '19.5', oversAgainst: 20, quotaOvers: 20, allOutFor: false, allOutAgainst: false});
assert.equal(actualOvers.actualForBalls, 119);
assert.equal(actualOvers.forBalls, 119);
assert.equal(actualOvers.againstBalls, 120);
close(actualOvers.forRate, 180 * 6 / 119);
close(actualOvers.againstRate, 8.75);
close(actualOvers.netRunRate, 180 * 6 / 119 - 8.75);

const bothAllOut = C.calculate({runsFor: 150, runsAgainst: 151, oversFor: 30, oversAgainst: 20, quotaOvers: 50, allOutFor: true, allOutAgainst: true});
assert.equal(bothAllOut.forBalls, 300);
assert.equal(bothAllOut.againstBalls, 300);
close(bothAllOut.forRate, 3);
close(bothAllOut.againstRate, 3.02);
close(bothAllOut.netRunRate, -0.02);
assert.equal(C.formatRate(bothAllOut.netRunRate, true), '-0.020');

const scoreless = C.calculate({runsFor: 0, runsAgainst: 0, oversFor: 20, oversAgainst: 20, quotaOvers: 20, allOutAgainst: false});
assert.equal(scoreless.netRunRate, 0);
assert.equal(C.formatRate(scoreless.netRunRate, true), '0.000');
assert.equal(C.formatRate(-0.00001, true), '0.000');
assert.equal(C.formatOvers(300), '50');
assert.equal(C.formatOvers(1), '0.1');
assert.equal(C.oversToBalls('0.1', null, 'Overs'), 1);
assert.equal(C.oversToBalls('1000', null, 'Overs'), 6000);

for (const value of ['', ' ', -1, 1.5, '1e2', '+20', 'NaN', Infinity, 100001]) {
  assert.throws(() => C.calculate({runsFor: value}), /Runs scored/);
}
for (const value of ['', ' ', 0, '0.0', '0.6', '19.50', '19.55', '.5', '-1', '1e1', 1000.1, '1000.1']) {
  assert.throws(() => C.calculate({oversFor: value}), /Overs faced/);
}
assert.throws(() => C.calculate({quotaOvers: 0}), /Scheduled overs/);
assert.throws(() => C.calculate({allOutFor: 'yes'}), /Team all out must be true or false/);
assert.throws(() => C.calculate({allOutAgainst: 1}), /Opposition all out must be true or false/);

// Independently enumerate valid six-ball overs and all-out substitutions.
let enumerated = 0;
for (const quotaOvers of [20, 50]) {
  const quotaBalls = quotaOvers * 6;
  for (const actualForBalls of [1, 5, 6, 119, quotaBalls - 1, quotaBalls]) {
    if (actualForBalls > quotaBalls) continue;
    for (const actualAgainstBalls of [1, 11, 120, quotaBalls - 1, quotaBalls]) {
      if (actualAgainstBalls > quotaBalls) continue;
      for (const allOutFor of [false, true]) {
        for (const allOutAgainst of [false, true]) {
          const input = {
            runsFor: 237, runsAgainst: 219, quotaOvers,
            oversFor: C.formatOvers(actualForBalls), oversAgainst: C.formatOvers(actualAgainstBalls),
            allOutFor, allOutAgainst
          };
          const result = C.calculate(input);
          const expectedForBalls = allOutFor ? quotaBalls : actualForBalls;
          const expectedAgainstBalls = allOutAgainst ? quotaBalls : actualAgainstBalls;
          assert.equal(result.forBalls, expectedForBalls);
          assert.equal(result.againstBalls, expectedAgainstBalls);
          close(result.forRate, 237 * 6 / expectedForBalls);
          close(result.againstRate, 219 * 6 / expectedAgainstBalls);
          close(result.netRunRate, 237 * 6 / expectedForBalls - 219 * 6 / expectedAgainstBalls);
          enumerated += 1;
        }
      }
    }
  }
}
assert.equal(enumerated, 240);

// Replay every canonical catalog case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'cricket-net-run-rate-calculator');
assert.equal(records.length, 1, 'catalog must contain exactly one cricket NRR calculator');
const record = records[0];
assert.equal(record.name, 'Cricket Net Run Rate Calculator');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('Cricket NRR Calculator'));
assert.ok(record.testCases.length >= 12, 'catalog carries golden and validation checks');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.calculate(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  assert.equal(testCase.kind, 'golden', testCase.name);
  const result = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) close(result[key], expected, `${testCase.name}: ${key}`);
}

console.log(`cricket-net-run-rate-calculator: all checks passed (${record.testCases.length} catalog cases and ${enumerated} independently checked configurations)`);
