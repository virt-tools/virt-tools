/* Regression checks for the digital line-coding visualizer core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/line-coding-visualizer/index.html'), 'utf8');
const startMarker = '/* line-coding-core:start */';
const endMarker = '/* line-coding-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'line-coding core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = LineCodingCore;', sandbox);
const C = sandbox.module.exports;

const basic = C.encode({scheme: 'nrz-l', bits: '0101'});
assert.equal(basic.scheme, 'nrz-l');
assert.equal(basic.name, 'NRZ-L');
assert.equal(basic.bits, '0101');
assert.equal(basic.bitCount, 4);
assert.deepEqual(Array.from(basic.cells, (cell) => Array.from(cell.levels)), [
  [-1, -1], [1, 1], [-1, -1], [1, 1]
]);
assert.equal(basic.transitionCount, 3);
assert.equal(basic.meanLevel, 0);
assert.match(basic.copyText, /NRZ-L — 4 bits, 3 transitions, mean level 0/);
assert.match(basic.copyText, /1\. 0 {2}-1 → -1/);

const nrzi = C.encode({scheme: 'nrz-i', bits: '010110'});
assert.equal(nrzi.name, 'NRZ-I');
assert.deepEqual(Array.from(nrzi.cells, (cell) => Array.from(cell.levels)), [
  [-1, -1], [1, 1], [1, 1], [-1, -1], [1, 1], [1, 1]
]);
assert.equal(nrzi.transitionCount, 3);
assert.match(nrzi.convention, /1 causes a transition/);

const manchester = C.encode({scheme: 'manchester', bits: '0101'});
assert.equal(manchester.name, 'Manchester');
assert.deepEqual(Array.from(manchester.cells, (cell) => Array.from(cell.levels)), [
  [-1, 1], [1, -1], [-1, 1], [1, -1]
]);
assert.equal(manchester.transitionCount, 4);
assert.equal(manchester.meanLevel, 0);
assert.match(manchester.convention, /IEEE 802\.3/);

const differential = C.encode({scheme: 'differential-manchester', bits: '0101'});
assert.equal(differential.name, 'Differential Manchester');
assert.deepEqual(Array.from(differential.cells, (cell) => Array.from(cell.levels)), [
  [1, -1], [-1, 1], [-1, 1], [1, -1]
]);
assert.equal(differential.transitionCount, 5);
assert.match(differential.convention, /0 adds a start-bit transition/);

const ami = C.encode({scheme: 'ami', bits: '110101'});
assert.equal(ami.name, 'Bipolar AMI');
assert.deepEqual(Array.from(ami.cells, (cell) => Array.from(cell.levels)), [
  [1, 1], [-1, -1], [0, 0], [1, 1], [0, 0], [-1, -1]
]);
assert.equal(ami.transitionCount, 5);
assert.equal(ami.meanLevel, 0);
assert.match(ami.convention, /alternating positive and negative pulses/);

assert.throws(() => C.encode({scheme: 'nrz-l', bits: ' '}), /Enter at least one binary digit\./);
assert.throws(() => C.encode({scheme: 'nrz-l', bits: '10x1'}), /Binary sequence can contain only 0, 1 and whitespace\./);
assert.throws(() => C.encode({scheme: 'nrz-l', bits: '1'.repeat(65)}), /Use at most 64 binary digits\./);
assert.throws(() => C.encode({scheme: 'unknown', bits: '10'}), /Choose a supported line-coding scheme\./);

let enumerated = 0;
let levelsChecked = 0;
for (const scheme of ['nrz-l', 'nrz-i', 'manchester', 'differential-manchester', 'ami']) {
  for (let length = 1; length <= 6; length++) {
    for (let value = 0; value < 2 ** length; value++) {
      const bits = value.toString(2).padStart(length, '0');
      const result = C.encode({scheme, bits});
      const cells = Array.from(result.cells);
      const flat = cells.flatMap((cell) => Array.from(cell.levels));
      assert.equal(result.bitCount, length);
      assert.equal(cells.length, length);
      assert.equal(flat.length, length * 2);
      assert.equal(result.bits, bits);
      assert.equal(C.encode({scheme, bits}).copyText, result.copyText, 'encoding must be deterministic');
      let transitions = 0;
      let sum = 0;
      flat.forEach((level, index) => {
        assert.ok([-1, 0, 1].includes(level));
        if (index && level !== flat[index - 1]) transitions++;
        sum += level;
        levelsChecked++;
      });
      assert.equal(result.transitionCount, transitions);
      assert.equal(result.meanLevel, sum / flat.length);
      cells.forEach((cell, index) => {
        assert.equal(cell.index, index + 1);
        assert.equal(cell.bit, bits[index]);
        if (scheme === 'nrz-l') assert.deepEqual(Array.from(cell.levels), cell.bit === '1' ? [1, 1] : [-1, -1]);
        if (scheme === 'manchester') assert.deepEqual(Array.from(cell.levels), cell.bit === '1' ? [1, -1] : [-1, 1]);
        if (scheme === 'differential-manchester') assert.equal(cell.levels[0], -cell.levels[1]);
        if (scheme === 'ami' && cell.bit === '0') assert.deepEqual(Array.from(cell.levels), [0, 0]);
      });
      if (scheme === 'ami') {
        const pulses = cells.filter((cell) => cell.bit === '1').map((cell) => cell.levels[0]);
        pulses.forEach((pulse, index) => assert.equal(pulse, index % 2 === 0 ? 1 : -1));
      }
      enumerated++;
    }
  }
}
assert.equal(enumerated, 630);

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'line-coding-visualizer');
assert.equal(records.length, 1, 'catalog must contain exactly one digital line-coding visualizer');
const record = records[0];
assert.equal(record.name, 'Digital Line Coding Visualizer');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Signal Encoding');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('Manchester Encoding Visualizer'));
assert.ok(record.testCases.length >= 9, 'catalog carries golden and validation checks');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.encode(testCase.input), (error) => error.message === testCase.expected.error, testCase.name);
    continue;
  }
  assert.equal(testCase.kind, 'golden', testCase.name);
  const result = C.encode(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (key === 'levels') {
      const actual = Array.from(result.cells).flatMap((cell) => Array.from(cell.levels));
      assert.deepEqual(actual, expected, `${testCase.name}: levels`);
    } else {
      assert.equal(result[key], expected, `${testCase.name}: ${key}`);
    }
  }
}

console.log(`line-coding-visualizer: all checks passed (${record.testCases.length} catalog cases, ${enumerated} sequences and ${levelsChecked} half-bit levels)`);
