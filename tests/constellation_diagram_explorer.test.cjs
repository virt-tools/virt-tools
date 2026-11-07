/* Regression checks for the digital modulation constellation explorer. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/constellation-diagram-explorer/index.html'), 'utf8');
const startMarker = '/* constellation-core:start */';
const endMarker = '/* constellation-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'constellation core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = ConstellationCore;', sandbox);
const C = sandbox.module.exports;

const result = C.calculate({scheme: 'qpsk', bits: '00 01 11 10'});
assert.equal(result.name, 'QPSK');
assert.equal(result.bitsPerSymbol, 2);
assert.equal(result.bitCount, 8);
assert.equal(result.symbolCount, 4);
assert.deepEqual(Array.from(result.symbols, (symbol) => symbol.bits), ['00', '01', '11', '10']);
assert.ok(Math.abs(result.symbols[0].i - 1 / Math.sqrt(2)) < 1e-12);
assert.ok(Math.abs(result.symbols[0].q - 1 / Math.sqrt(2)) < 1e-12);
assert.equal(result.symbols[0].coordinateText, 'I +0.7071, Q +0.7071');
assert.equal(result.copyText, 'QPSK — 8 bits, 4 symbols\n1. 00  I +0.7071  Q +0.7071\n2. 01  I -0.7071  Q +0.7071\n3. 11  I -0.7071  Q -0.7071\n4. 10  I +0.7071  Q -0.7071');
assert.equal(C.getConstellation('qpsk').length, 4);

const expected = {
  bpsk: {name: 'BPSK', bitsPerSymbol: 1, points: 2, example: '01101001', first: ['0', -1, 0]},
  qpsk: {name: 'QPSK', bitsPerSymbol: 2, points: 4, example: '00 01 11 10', first: ['00', 1 / Math.sqrt(2), 1 / Math.sqrt(2)]},
  '8psk': {name: '8-PSK', bitsPerSymbol: 3, points: 8, example: '000 001 011 010', first: ['000', 1, 0]},
  '16qam': {name: '16-QAM', bitsPerSymbol: 4, points: 16, example: '0001 0111 1110 1000', first: ['0001', -3 / Math.sqrt(10), -1 / Math.sqrt(10)]},
  '64qam': {name: '64-QAM', bitsPerSymbol: 6, points: 64, example: '000001 011111 110100', first: ['000001', -7 / Math.sqrt(42), -5 / Math.sqrt(42)]}
};
function hamming(a, b) {
  return Array.from(a).reduce((count, bit, index) => count + (bit !== b[index] ? 1 : 0), 0);
}
let mappedPoints = 0;
for (const [scheme, config] of Object.entries(expected)) {
  const points = C.getConstellation(scheme);
  assert.equal(points.length, config.points, scheme);
  assert.equal(new Set(Array.from(points, (point) => point.bits)).size, config.points, `${scheme} labels unique`);
  const meanPower = Array.from(points).reduce((sum, point) => sum + point.i * point.i + point.q * point.q, 0) / points.length;
  assert.ok(Math.abs(meanPower - 1) < 1e-12, `${scheme} has unit average power: ${meanPower}`);
  assert.equal(C.exampleFor(scheme), config.example);
  const exampleResult = C.calculate({scheme, bits: config.example});
  assert.equal(exampleResult.name, config.name);
  assert.equal(exampleResult.bitsPerSymbol, config.bitsPerSymbol);
  assert.equal(exampleResult.symbols[0].bits, config.first[0]);
  assert.ok(Math.abs(exampleResult.symbols[0].i - config.first[1]) < 1e-12, `${scheme} first I`);
  assert.ok(Math.abs(exampleResult.symbols[0].q - config.first[2]) < 1e-12, `${scheme} first Q`);
  if (scheme === 'bpsk' || scheme === 'qpsk' || scheme === '8psk') {
    for (let index = 0; index < points.length; index += 1) {
      assert.equal(hamming(points[index].bits, points[(index + 1) % points.length].bits), 1, `${scheme} cyclic Gray adjacency`);
    }
  } else {
    for (const point of Array.from(points)) {
      const horizontal = Array.from(points).filter((other) => other.q === point.q && other.i > point.i).sort((a, b) => a.i - b.i)[0];
      const vertical = Array.from(points).filter((other) => other.i === point.i && other.q > point.q).sort((a, b) => a.q - b.q)[0];
      if (horizontal) assert.equal(hamming(point.bits, horizontal.bits), 1, `${scheme} horizontal Gray adjacency`);
      if (vertical) assert.equal(hamming(point.bits, vertical.bits), 1, `${scheme} vertical Gray adjacency`);
    }
  }
  mappedPoints += points.length;
}
assert.equal(mappedPoints, 94);
assert.equal(C.calculate({scheme: '16qam', bits: '00 00'}).symbols[0].coordinateText, 'I -0.9487, Q -0.9487');
assert.equal(C.calculate({scheme: '64qam', bits: '111111'}).symbols[0].coordinateText, 'I +0.4629, Q +0.4629');
assert.equal(C.calculate({scheme: '64qam', bits: '100100'}).symbols[0].coordinateText, 'I +1.0801, Q +1.0801');
assert.equal(C.calculate({scheme: 'BPSK', bits: '0\n1\t1'}).symbolCount, 3);

const invalid = [
  [{scheme: '32qam', bits: '0'}, 'Choose a supported modulation scheme.'],
  [{scheme: 'qpsk', bits: ' \n\t'}, 'Enter at least one binary digit.'],
  [{scheme: 'qpsk', bits: '0102'}, 'Binary sequence can contain only 0, 1 and whitespace.'],
  [{scheme: '8psk', bits: '0101'}, '8-PSK needs complete groups of 3 bits; 4 bits were entered.'],
  [{scheme: 'bpsk', bits: '0'.repeat(97)}, 'Use at most 96 binary digits.']
];
for (const [input, message] of invalid) assert.throws(() => C.calculate(input), (error) => error.message === message, message);
assert.equal(C.calculate({scheme: 'bpsk', bits: '0'.repeat(96)}).symbolCount, 96);

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'constellation-diagram-explorer');
assert.equal(records.length, 1, 'catalog must contain exactly one constellation diagram explorer');
const record = records[0];
assert.equal(record.name, 'Constellation Diagram Explorer');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Reference');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('QAM Constellation Mapper'));
assert.ok(record.testCases.length >= 10, 'catalog carries mapping and validation checks');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.calculate(testCase.input), (error) => error.message === testCase.expected.error, testCase.name);
    continue;
  }
  assert.equal(testCase.kind, 'golden', testCase.name);
  const actual = C.calculate(testCase.input);
  for (const [key, expectedValue] of Object.entries(testCase.expected)) assert.equal(actual[key], expectedValue, `${testCase.name}: ${key}`);
}

console.log(`constellation-diagram-explorer: all checks passed (${record.testCases.length} catalog cases, ${mappedPoints} constellation points)`);
