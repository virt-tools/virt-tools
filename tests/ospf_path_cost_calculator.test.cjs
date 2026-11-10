/* Regression and independent exact-integer checks for OSPF path costs. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/ospf-path-cost-calculator/index.html'), 'utf8');
const startMarker = '/* ospf-path-cost-core:start */';
const endMarker = '/* ospf-path-cost-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'OSPF core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = OspfPathCostCore;', sandbox);
const C = sandbox.module.exports;
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-9, Math.abs(expected) * 1e-12), `${label || 'value'}: ${actual} != ${expected}`);
const exactError = (fn, expected) => {
  let thrown = null;
  try { fn(); } catch (error) { thrown = error; }
  assert.ok(thrown, `expected error: ${expected}`);
  assert.equal(thrown.message, expected);
};
const costs = result => Array.from(result.links, link => link.cost);

const standard = C.calculate({});
assert.deepEqual(costs(standard), [1, 1, 10, 64]);
assert.equal(standard.pathCost, 76);
assert.equal(standard.minimumCostCount, 2);
assert.equal(standard.collapsedMinimumCosts, true);
assert.equal(standard.truncatedCount, 1);
close(standard.links[3].rawQuotient, 100 / 1.544, 'published serial quotient');
assert.equal(standard.links[3].cost, 64, 'Cisco example truncates rather than rounds to 65');
assert.match(C.summary(standard), /OSPF path cost: 76/);
assert.match(C.summary(standard), /1\.544 Mbps -> cost 64 \(quotient truncated\)/);

const raisedReference = C.calculate({referenceBandwidth: '10000', bandwidths: '100\n1000\n10000'});
assert.deepEqual(costs(raisedReference), [100, 10, 1]);
assert.equal(raisedReference.pathCost, 111);
assert.equal(raisedReference.minimumCostCount, 1);
assert.equal(raisedReference.collapsedMinimumCosts, false);
assert.deepEqual(costs(C.calculate({referenceBandwidth: '1000', bandwidths: '0.064'})), [15625]);
assert.deepEqual(costs(C.calculate({bandwidths: '1,544\n0,064'})), [64, 1562]);
assert.equal(C.calculate({referenceBandwidth: '65535', bandwidths: '1'}).pathCost, 65535);
assert.equal(C.calculate({referenceBandwidth: '65535', bandwidths: '1\n1'}).pathCost, 131070);
assert.equal(C.calculate({referenceBandwidth: '1000', bandwidths: '100'}).links[0].truncated, false);

// Independent exact-rational oracle: integer micro-Mbps and BigInt division
// reproduce truncation without using the core's Number arithmetic.
let seed = 0x05f2328;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
}
let randomChecks = 0;
let truncatedChecks = 0;
let minimumChecks = 0;
for (let index = 0; index < 5000; index++) {
  const reference = 1 + Math.floor(random() * 100000);
  const numerator = BigInt(reference) * 1000000n;
  const lowestMicros = Number((numerator + 65535n) / 65535n);
  const upperMicros = Math.min(4294967000000, Math.max(lowestMicros + 1, reference * 2000000));
  const span = upperMicros - lowestMicros;
  const micros = lowestMicros + Math.floor(random() * span);
  const bandwidth = String(micros / 1000000);
  const expectedFloor = numerator / BigInt(micros);
  const expectedCost = expectedFloor < 1n ? 1 : Number(expectedFloor);
  const result = C.calculate({referenceBandwidth: String(reference), bandwidths: bandwidth});
  assert.equal(result.links[0].cost, expectedCost, `exact oracle mismatch: ref=${reference}, micro-Mbps=${micros}`);
  assert.equal(result.links[0].truncated, numerator % BigInt(micros) !== 0n, 'exact truncation flag');
  assert.equal(result.links[0].minimumApplied, expectedFloor < 1n, 'minimum flag');
  truncatedChecks += result.links[0].truncated ? 1 : 0;
  minimumChecks += result.links[0].minimumApplied ? 1 : 0;
  randomChecks++;
}
assert.ok(truncatedChecks > 1000 && minimumChecks > 1000, 'random sweep exercises truncation and minimum clamping');

for (const id of Array.from(html.matchAll(/getElementById\("([^"]+)"\)/g), match => match[1])) {
  assert.ok(html.includes(`id="${id}"`), `DOM id missing: ${id}`);
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter(tool => tool.slug === 'ospf-path-cost-calculator');
assert.equal(records.length, 1, 'catalog must contain exactly one OSPF path cost calculator');
const record = records[0];
assert.equal(record.name, 'OSPF Path Cost Calculator');
assert.equal(record.category, 'IT & Networking');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('OSPF Cost Calculator'));
assert.equal(record.testCases.length, 16, 'catalog carries 5 golden, 4 boundary and 7 validation cases');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    exactError(() => C.calculate(testCase.input), testCase.expectedError);
    continue;
  }
  assert.ok(testCase.kind === 'golden' || testCase.kind === 'boundary', testCase.name);
  const result = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') close(result[key], expected, `${testCase.name}: ${key}`);
    else assert.deepEqual(result[key], expected, `${testCase.name}: ${key}`);
  }
}

console.log(`ospf-path-cost-calculator: all checks passed (${record.testCases.length} catalog cases; ${randomChecks} exact random checks, ${truncatedChecks} truncated and ${minimumChecks} minimum-clamped)`);
