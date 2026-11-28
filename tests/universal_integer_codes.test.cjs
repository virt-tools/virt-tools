/* Universal integer codes: the published Elias gamma, Elias delta and Fibonacci
   tables, the Golomb and Golomb-Rice constructions with truncated binary,
   bit-length formulas, prefix freedom, encode/decode round trips, the decoding
   paths, the catalog test cases and the page contract. The tables and the
   worked examples (delta 001010011 = 19, Fibonacci 0100100011 = 65, Golomb
   m = 10 of 42 = 11110 010) come from the cited Wikipedia articles; a separate
   Python implementation written from the same definitions agrees with every
   code word the page produces. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'universal-integer-codes';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* universal-code-core:start */';
const endMarker = '/* universal-code-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = UniversalCodeCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const encode = (input) => plain(C.encodeAll(input));
const codes = (input) => {
  const out = {};
  encode(input).rows.forEach((row) => { out[row.scheme] = row.code; });
  return out;
};
const failure = (run) => {
  try { run(); } catch (error) { return error.message; }
  return null;
};
const decode = (input) => plain(C.decodeOne(input));
const base = { value: '5', k: '2', m: '10' };
const withInput = (patch) => Object.assign({}, base, patch);

// ---- Limits stay small enough for the page to stay responsive.
assert.equal(C.MAX_VALUE, 1000000);
assert.equal(C.MAX_CODE_BITS, 4096);
assert.equal(C.MAX_INPUT_BITS, 4096);
assert.equal(C.MAX_K, 30);
assert.equal(C.MAX_M, 1000000);
assert.deepEqual(plain(C.SCHEMES), ['gamma', 'delta', 'fibonacci', 'rice', 'golomb']);

// ---- Elias gamma: N zeros then the (N+1)-bit value, from the published table.
const GAMMA = {
  1: '1', 2: '010', 3: '011', 4: '00100', 5: '00101', 6: '00110', 7: '00111',
  8: '0001000', 9: '0001001', 10: '0001010', 11: '0001011', 12: '0001100',
  13: '0001101', 14: '0001110', 15: '0001111', 16: '000010000', 17: '000010001',
};
for (const [value, code] of Object.entries(GAMMA)) {
  assert.equal(C.gamma(Number(value)), code, 'gamma of ' + value);
}

// ---- Elias delta: gamma of the bit length, then the bits after the leading one.
const DELTA = {
  1: '1', 2: '0100', 3: '0101', 4: '01100', 5: '01101', 6: '01110', 7: '01111',
  8: '00100000', 9: '00100001', 10: '00100010', 11: '00100011', 12: '00100100',
  13: '00100101', 14: '00100110', 15: '00100111', 16: '001010000', 17: '001010001',
};
for (const [value, code] of Object.entries(DELTA)) {
  assert.equal(C.delta(Number(value)), code, 'delta of ' + value);
}

// ---- Fibonacci: Zeckendorf digits least significant first, then an appended 1.
const FIBONACCI = {
  1: '11', 2: '011', 3: '0011', 4: '1011', 5: '00011', 6: '10011', 7: '01011',
  8: '000011', 9: '100011', 10: '010011', 11: '001011', 12: '101011',
  13: '0000011', 14: '1000011',
};
for (const [value, code] of Object.entries(FIBONACCI)) {
  assert.equal(C.fibonacci(Number(value)), code, 'fibonacci of ' + value);
}

// ---- The Fibonacci code words end in 11 and have no earlier 11.
for (let value = 1; value <= 200; value += 1) {
  const code = C.fibonacci(value);
  assert.ok(code.endsWith('11'), 'fibonacci ends with 11 at ' + value);
  assert.equal(code.slice(0, -2).includes('11'), false, 'no earlier 11 at ' + value);
  assert.equal(code.slice(0, -1).endsWith('1'), true, 'the last digit before the terminator is a 1');
}

// ---- Bit lengths follow the published formulas.
for (let value = 1; value <= 500; value += 1) {
  const floorLog = Math.floor(Math.log2(value));
  assert.equal(C.gamma(value).length, 2 * floorLog + 1, 'gamma length at ' + value);
  const inner = Math.floor(Math.log2(floorLog + 1));
  assert.equal(C.delta(value).length, floorLog + 2 * inner + 1, 'delta length at ' + value);
}

// ---- None of the codes is a prefix of another, which is what makes them self-delimiting.
const prefixFree = (list) => {
  const sorted = list.slice().sort();
  for (let index = 1; index < sorted.length; index += 1) {
    assert.equal(sorted[index].startsWith(sorted[index - 1]), false,
      'prefix collision: ' + sorted[index - 1] + ' / ' + sorted[index]);
  }
};
prefixFree(Array.from({ length: 64 }, (_, index) => C.gamma(index + 1)));
prefixFree(Array.from({ length: 64 }, (_, index) => C.delta(index + 1)));
prefixFree(Array.from({ length: 64 }, (_, index) => C.fibonacci(index + 1)));
prefixFree(Array.from({ length: 129 }, (_, index) => C.golomb(index, 5)));
prefixFree(Array.from({ length: 129 }, (_, index) => C.rice(index, 3)));

// ---- Golomb construction: unary quotient, truncated-binary remainder.
assert.deepEqual(plain(C.golombParts(10)), { bits: 3, cutoff: 6 });
assert.deepEqual(plain(C.golombParts(3)), { bits: 1, cutoff: 1 });
assert.deepEqual(plain(C.golombParts(8)), { bits: 3, cutoff: 8 });
assert.deepEqual(plain(C.golombParts(1)), { bits: 0, cutoff: 1 });
assert.equal(C.golomb(42, 10), '11110010', 'the published m = 10 example');
const M10 = ['0000', '0001', '0010', '0011', '0100', '0101', '01100', '01101',
  '01110', '01111', '10000'];
M10.forEach((code, value) => assert.equal(C.golomb(value, 10), code, 'golomb m = 10 of ' + value));
const M3 = ['00', '010', '011', '100', '1010', '1011'];
M3.forEach((code, value) => assert.equal(C.golomb(value, 3), code, 'golomb m = 3 of ' + value));

// ---- A divisor of one is unary coding, and Rice is Golomb with a power-of-two divisor.
for (let value = 0; value <= 40; value += 1) {
  assert.equal(C.golomb(value, 1), C.unary(value), 'm = 1 is unary at ' + value);
  for (let k = 0; k <= 8; k += 1) {
    assert.equal(C.rice(value, k), C.golomb(value, Math.pow(2, k)), 'rice k = ' + k + ' at ' + value);
  }
}

// ---- Encoded lengths agree with the code strings.
for (const input of [base, withInput({ value: '1', k: '0', m: '1' }), withInput({ value: '0', k: '0', m: '1' }),
  withInput({ value: '64', k: '4', m: '13' }), withInput({ value: '1000000', k: '20', m: '1000000' })]) {
  const result = encode(input);
  result.rows.forEach((row) => {
    if (row.code === null) assert.equal(row.bits, null, 'no code, no length');
    else assert.equal(row.bits, row.code.length, 'bit count for ' + row.scheme);
  });
}

// ---- The same value feeds every scheme, and zero only fits the Golomb pair.
const zero = encode(withInput({ value: '0', k: '0', m: '1' }));
assert.deepEqual(zero.rows.map((row) => row.scheme), ['gamma', 'delta', 'fibonacci', 'rice', 'golomb']);
assert.deepEqual(zero.rows.map((row) => row.code), [null, null, null, '0', '0']);
assert.deepEqual(zero.rows.map((row) => row.startsAtOne), [true, true, true, false, false]);
assert.deepEqual(codes(withInput({ value: '5' })),
  { gamma: '00101', delta: '01101', fibonacci: '00011', rice: '1001', golomb: '0101' });
assert.deepEqual(codes(withInput({ value: '1', k: '0', m: '1' })),
  { gamma: '1', delta: '1', fibonacci: '11', rice: '10', golomb: '10' });
assert.deepEqual(codes(withInput({ value: '42' })),
  { gamma: '00000101010', delta: '0011001010', fibonacci: '000010011', rice: '1111111111010', golomb: '11110010' });
assert.equal(encode(base).value, 5);
assert.equal(encode(withInput({ value: ' 42 ' })).value, 42, 'padding is ignored');

// ---- Decoding the published examples and reading back every encoded value.
assert.deepEqual(decode({ bits: '001010011', scheme: 'delta', k: '2', m: '10' }),
  { value: 19, scheme: 'delta', label: 'Elias delta (\u03b4)', code: '001010011', bits: 9, leftover: '', canonical: true });
assert.deepEqual(decode({ bits: '0100100011', scheme: 'fibonacci', k: '2', m: '10' }),
  { value: 65, scheme: 'fibonacci', label: 'Fibonacci (Zeckendorf)', code: '0100100011', bits: 10, leftover: '', canonical: true });
assert.equal(decode({ bits: '11110 010', scheme: 'golomb', k: '2', m: '10' }).value, 42);
assert.equal(decode({ bits: '1001', scheme: 'rice', k: '2', m: '10' }).value, 5);
assert.equal(decode({ bits: '1', scheme: 'gamma', k: '2', m: '10' }).value, 1);
const twoWords = decode({ bits: '11110010 0101', scheme: 'golomb', k: '2', m: '10' });
assert.equal(twoWords.value, 42);
assert.equal(twoWords.code, '11110010');
assert.equal(twoWords.bits, 8);
assert.equal(twoWords.leftover, '0101');
assert.equal(decode({ bits: '11110010 0101', scheme: 'golomb', k: '2', m: '10' }).leftover.length, 4);
assert.equal(decode({ bits: '10', scheme: 'rice', k: '0', m: '1' }).value, 1, 'a zero-bit remainder');

// ---- Every scheme round-trips, with seeded parameters and values.
let seed = 20261115;
const random = (limit) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % limit;
};
for (let round = 0; round < 400; round += 1) {
  const value = random(10001);
  const k = random(11);
  const m = 1 + random(5000);
  const checks = [
    ['gamma', C.gamma(value + 1), C.decodeGamma],
    ['delta', C.delta(value + 1), C.decodeDelta],
    ['fibonacci', C.fibonacci(value + 1), C.decodeFibonacci],
    ['rice', C.rice(value, k), (bits) => C.decodeGolomb(bits, Math.pow(2, k), 'Golomb\u2013Rice')],
    ['golomb', C.golomb(value, m), (bits) => C.decodeGolomb(bits, m, 'Golomb')],
  ];
  checks.forEach(([scheme, code, decoder]) => {
    const decoded = decoder(code);
    assert.equal(decoded.value, scheme === 'rice' || scheme === 'golomb' ? value : value + 1,
      scheme + ' round trip at ' + value);
    assert.equal(decoded.consumed, code.length, scheme + ' consumes its whole code word at ' + value);
  });
}

// ---- Decode refusals, one per failure path.
assert.equal(failure(() => C.decodeOne({ bits: '', scheme: 'gamma', k: '2', m: '10' })), 'Enter a bit string.');
assert.equal(failure(() => C.decodeOne({ bits: '102', scheme: 'gamma', k: '2', m: '10' })),
  'Enter only 0s and 1s, with spaces if you like.');
assert.equal(failure(() => C.decodeOne({ bits: '0'.repeat(4097), scheme: 'gamma', k: '2', m: '10' })),
  'Enter at most 4,096 bits.');
assert.equal(failure(() => C.decodeOne({ bits: '000', scheme: 'gamma', k: '2', m: '10' })),
  'An Elias gamma code word needs a 1 after its leading zeros; that string is all zeros.');
assert.equal(failure(() => C.decodeOne({ bits: '001', scheme: 'gamma', k: '2', m: '10' })),
  'That Elias gamma code word is truncated: it needs 5 bits.');
assert.equal(failure(() => C.decodeOne({ bits: '000', scheme: 'delta', k: '2', m: '10' })),
  'An Elias delta code word needs a 1 after its leading zeros; that string is all zeros.');
assert.equal(failure(() => C.decodeOne({ bits: '00100', scheme: 'delta', k: '2', m: '10' })),
  'That Elias delta code word is truncated: it needs 8 bits.');
assert.equal(failure(() => C.decodeOne({ bits: '0101', scheme: 'fibonacci', k: '2', m: '10' })),
  'A Fibonacci code word ends with two 1s; that string has none.');
assert.equal(failure(() => C.decodeOne({ bits: '1111', scheme: 'golomb', k: '2', m: '10' })),
  'A Golomb code word ends with a 0 after its quotient; that string has none.');
assert.equal(failure(() => C.decodeOne({ bits: '10', scheme: 'golomb', k: '2', m: '10' })),
  'That Golomb code word is truncated: it needs 5 bits.');
assert.equal(failure(() => C.decodeOne({ bits: '110' + '0'.repeat(30), scheme: 'rice', k: '30', m: '10' })),
  'That code word decodes to a value above 1,000,000.');
assert.equal(failure(() => C.decodeOne({ bits: '1', scheme: 'nope', k: '2', m: '10' })),
  'Choose one of the five codes.');

// ---- Encode refusals.
assert.equal(failure(() => encode(withInput({ value: '' }))), 'Enter an integer.');
assert.equal(failure(() => encode(withInput({ value: ' ' }))), 'Enter an integer.');
assert.equal(failure(() => encode(withInput({ value: '4.5' }))),
  'Enter a whole number of 0 or more, such as 42.');
assert.equal(failure(() => encode(withInput({ value: '-3' }))),
  'Enter a whole number of 0 or more, such as 42.');
assert.equal(failure(() => encode(withInput({ value: '1e3' }))),
  'Enter a whole number of 0 or more, such as 42.');
assert.equal(failure(() => encode(withInput({ value: '1000001' }))),
  'Enter an integer from 0 to 1,000,000.');
assert.equal(failure(() => encode(withInput({ k: '' }))), 'Enter a Rice parameter k from 0 to 30.');
assert.equal(failure(() => encode(withInput({ k: '31' }))), 'Enter a Rice parameter k from 0 to 30.');
assert.equal(failure(() => encode(withInput({ k: 'x' }))),
  'Enter the Rice parameter k as a whole number from 0 to 30.');
assert.equal(failure(() => encode(withInput({ m: '0' }))),
  'Enter a Golomb divisor m from 1 to 1,000,000.');
assert.equal(failure(() => encode(withInput({ m: '1000001' }))),
  'Enter a Golomb divisor m from 1 to 1,000,000.');
assert.equal(failure(() => encode({ value: '1000000', k: '0', m: '1' })),
  'A code word longer than 4,096 bits is refused: raise k or m for a value this large.');

// ---- Labels name the parameter that is actually used.
assert.equal(C.labelFor('gamma', 2, 10), 'Elias gamma (\u03b3)');
assert.equal(C.labelFor('delta', 2, 10), 'Elias delta (\u03b4)');
assert.equal(C.labelFor('fibonacci', 2, 10), 'Fibonacci (Zeckendorf)');
assert.equal(C.labelFor('rice', 3, 10), 'Golomb\u2013Rice, k = 3');
assert.equal(C.labelFor('golomb', 2, 99), 'Golomb, m = 99');
assert.equal(decode({ bits: '010', scheme: 'golomb', k: '2', m: '3' }).label, 'Golomb, m = 3');

// ---- The catalog record and every test case it carries.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(record.name, 'Universal Integer Codes');
assert.equal(record.category, 'Encoding');
assert.equal(record.subcategory, 'Reference');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.sources.length, 4);
record.sources.forEach((source) => assert.match(source.url, /^https:\/\/en\.wikipedia\.org\/wiki\//));
assert.ok(record.method && record.method.length > 400, 'the method explains the conventions');
assert.equal(record.testCases.length, 26);
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    const payload = testCase.input;
    const run = Object.prototype.hasOwnProperty.call(payload, 'bits')
      ? () => C.decodeOne(payload)
      : () => C.encodeAll(payload);
    assert.equal(failure(run), testCase.expectedError, testCase.name);
    continue;
  }
  if (Object.prototype.hasOwnProperty.call(testCase.input, 'bits')) {
    const result = decode(testCase.input);
    assert.equal(result.value, testCase.expected.value, testCase.name + ' value');
    assert.equal(result.bits, testCase.expected.bits, testCase.name + ' bits');
    assert.equal(result.leftover, testCase.expected.leftover, testCase.name + ' leftover');
    continue;
  }
  assert.deepEqual(codes(testCase.input), testCase.expected, testCase.name);
}
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2266, 'public tools');

// ---- Page contract: shared shell, labelled controls, one hash-pinnable script.
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.match(html, /\/assets\/style\.css/);
assert.match(html, /<h1>Universal Integer Codes<\/h1>/);
assert.match(html, /<meta name="description" content="[^"]+">/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /role="tablist"/);
assert.match(html, /role="tabpanel"/);
assert.match(html, /min-height:44px/);
assert.equal(/<a\b[^>]*href="http/.test(html), false, 'no off-site links in the page');
assert.equal(/fetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), false, 'no network or storage');
const formIds = ['value', 'rice-k', 'golomb-m', 'bits', 'scheme', 'dec-k', 'dec-m'];
formIds.forEach((id) => assert.ok(html.includes('for="' + id + '"'), 'label for ' + id));
formIds.forEach((id) => assert.ok(html.includes('id="' + id + '"'), 'control ' + id));
assert.equal((html.match(/<button\b[^>]*>/g) || []).every((tag) => /type="(button|submit)"/.test(tag)), true,
  'every button has a type');
assert.equal((html.match(/<script[^>]*src=/g) || []).length, 2, 'theme-init and app.js only');

console.log('universal integer codes: passed');
