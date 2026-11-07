/* Regression checks for the Erlang B trunking core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/erlang-b-trunking-calculator/index.html'), 'utf8');
const start = html.indexOf('/* erlang-core:start */');
const end = html.indexOf('/* erlang-core:end */');
assert.ok(start > -1 && end > start, 'erlang core markers missing');
const core = html.slice(start, end + '/* erlang-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ErlangCore;', sandbox);
const C = sandbox.module.exports;

// Values created inside the vm context have foreign prototypes, so compare by value, not identity.
const same = (actual, expected, label) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), label);
const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const analyse = (options) => C.analyse(options);

// Ten erlangs offered to fifteen trunks blocks about 3.65% of calls.
const standard = analyse({ traffic: '10', trunks: '15', target: '1' });
near(standard.blocking, 0.0364969454723708, 'default blocking');
near(standard.blockingPercent, 3.64969454723708, 'default blocking percent');
near(standard.carried, 9.635030545276292, 'default carried erlangs');
near(standard.blockedTraffic, 0.364969454723708, 'default blocked erlangs');
assert.equal(standard.required, 18, 'eighteen trunks for a 1% target');
assert.equal(standard.table.length, 7, 'seven trunk rows');
same(standard.table.map((row) => row.trunks), [15, 16, 17, 18, 19, 20, 21], 'table trunk counts');
same(standard.table.map((row) => row.meetsTarget), [false, false, false, true, true, true, true], 'table target flags');
near(standard.table[0].blockingPercent, 3.64969454723708, 'table row 15');
near(standard.table[2].blockingPercent, 1.294887522472657, 'table row 17');
near(standard.table[3].blockingPercent, 0.714243815789978, 'table row 18');
near(standard.table[6].carried, 9.991107676986417, 'table row 21 carried');

// Blocking falls as trunks are added and carried traffic rises towards the offered load.
let previous = 1;
for (const trunks of [10, 12, 15, 18, 20, 25, 30]) {
  const result = analyse({ traffic: '10', trunks: String(trunks), target: '1' });
  assert.ok(result.blocking < previous, `blocking must fall at ${trunks} trunks`);
  assert.ok(result.carried <= result.traffic, 'carried traffic cannot exceed offered');
  previous = result.blocking;
}
const ten = analyse({ traffic: '10', trunks: '10', target: '1' });
near(ten.blockingPercent, 21.45823431072275, 'ten trunks at ten erlangs');
near(ten.carried, 7.854176568927724, 'ten trunks carried load');

// One erlang on one trunk blocks exactly half of the calls, and the 50% target is met inclusively.
const half = analyse({ traffic: '1', trunks: '1', target: '50' });
assert.equal(half.blocking, 0.5, 'one erlang on one trunk');
assert.equal(half.blockingPercent, 50, 'fifty percent blocking');
assert.equal(half.required, 1, 'one trunk meets a 50% target');
same(half.table.map((row) => row.meetsTarget), [true, true, true, true], 'all rows meet 50%');
same(half.table.map((row) => row.trunks), [1, 2, 3, 4], 'table starts at one trunk');

// The minimum offered load still finds a one-trunk answer.
const tiny = analyse({ traffic: '0.01', trunks: '1', target: '1' });
near(tiny.blockingPercent, 0.9900990099009901, 'minimum traffic blocking');
assert.equal(tiny.required, 1, 'minimum traffic needs one trunk');

// Large groups stay finite and still find the target trunk count.
const big = analyse({ traffic: '1000', trunks: '1200', target: '0.01' });
near(big.blocking, 7.992642851948638e-11, 'large group blocking');
assert.equal(big.required, 1100, 'large group required trunks');
assert.ok(Number.isFinite(big.carried), 'carried traffic stays finite');
near(big.carried, 999.9999999200736, 'large group carried traffic');
const crowded = analyse({ traffic: '1000', trunks: '1000', target: '0.01' });
near(crowded.blockingPercent, 2.4811917646160406, 'overloaded group blocking');

// Every table row follows the entered target, and the first row is the minimum that meets it.
for (const [traffic, target] of [['3', '2'], ['25', '1'], ['100', '1']]) {
  const result = analyse({ traffic, trunks: '5', target });
  assert.ok(result.required !== null, 'target reachable');
  const first = result.table[0];
  if (first.trunks === 1) assert.equal(first.meetsTarget, true, 'first row meets target at one trunk');
  else assert.equal(first.meetsTarget, false, 'rows below the minimum miss the target');
  const atMinimum = result.table.find((row) => row.trunks === result.required);
  assert.equal(atMinimum.meetsTarget, true, 'minimum trunk count meets the target');
  if (atMinimum.trunks > 1) {
    const below = analyse({ traffic, trunks: String(atMinimum.trunks - 1), target });
    assert.ok(below.blockingPercent > Number(target), 'one trunk fewer misses the target');
  }
}

// Independent closed-form check: B = (A^N / N!) / sum(A^k / k!) for small groups.
const closedForm = (traffic, trunks) => {
  let term = 1;
  let sum = 1;
  for (let k = 1; k <= trunks; k += 1) {
    term = term * traffic / k;
    sum += term;
  }
  return term / sum;
};
for (const traffic of [0.5, 1, 3, 10, 25, 100]) {
  for (let trunks = 1; trunks <= 40; trunks += 1) {
    const result = analyse({ traffic: String(traffic), trunks: String(trunks), target: '1' });
    near(result.blocking, closedForm(traffic, trunks), `closed form A=${traffic} N=${trunks}`, 1e-12);
  }
}

// Parsing and validation rejections.
assert.throws(() => analyse({ traffic: '   ' }), /Offered traffic is required\./);
assert.throws(() => analyse({ traffic: 'busy' }), /Offered traffic must be a number between 0\.01 and 1,000 erlangs\./);
assert.throws(() => analyse({ traffic: '0' }), /Offered traffic must be between 0\.01 and 1,000 erlangs\./);
assert.throws(() => analyse({ traffic: '1001' }), /Offered traffic must be between 0\.01 and 1,000 erlangs\./);
assert.throws(() => analyse({ traffic: '10', trunks: '' }), /Trunk count is required\./);
assert.throws(() => analyse({ traffic: '10', trunks: 'many' }), /Trunk count must be a whole number from 1 to 1,500\./);
assert.throws(() => analyse({ traffic: '10', trunks: '1.5' }), /Trunk count must be a whole number from 1 to 1,500\./);
assert.throws(() => analyse({ traffic: '10', trunks: '0' }), /Trunk count must be a whole number from 1 to 1,500\./);
assert.throws(() => analyse({ traffic: '10', trunks: '1501' }), /Trunk count must be a whole number from 1 to 1,500\./);
assert.throws(() => analyse({ traffic: '10', trunks: '15', target: '' }), /Target blocking is required\./);
assert.throws(() => analyse({ traffic: '10', trunks: '15', target: 'low' }), /Target blocking must be a number between 0\.01 and 50 percent\./);
assert.throws(() => analyse({ traffic: '10', trunks: '15', target: '0' }), /Target blocking must be between 0\.01 and 50 percent\./);
assert.throws(() => analyse({ traffic: '10', trunks: '15', target: '51' }), /Target blocking must be between 0\.01 and 50 percent\./);

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'erlang-b-trunking-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.risk, 'low');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 24, 'catalog has the full test case set');
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
  for (const [key, value] of Object.entries(testCase.expected)) {
    compare(result[key], value, `${testCase.name} ${key}`);
  }
}

console.log('erlang-b-trunking-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
