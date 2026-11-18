/* Regression checks for the Code 128 core, its decoder and its catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/code128-barcode-generator/index.html'), 'utf8');
const start = html.indexOf('/* code128-core:start */');
const end = html.indexOf('/* code128-core:end */');
assert.ok(start > -1 && end > start, 'code128 core markers missing');
const core = html.slice(start, end + '/* code128-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = Code128Core;', sandbox);
const C = sandbox.module.exports;

const encode = (text) => C.calculate({ text });

// ---------------------------------------------------------------- symbol table
assert.equal(C.PATTERNS.length, 107, 'the table holds values 0 to 106');
assert.equal(new Set(C.PATTERNS).size, 107, 'symbol patterns are unique');
C.PATTERNS.forEach((pattern, value) => {
  assert.equal(pattern.length, 11, 'value ' + value + ' is eleven modules');
  assert.ok(/^[01]+$/.test(pattern), 'value ' + value + ' is binary');
  assert.equal(pattern[0], '1', 'value ' + value + ' starts with a bar');
  assert.equal(pattern[10], '0', 'value ' + value + ' ends with a space');
  const runs = pattern.match(/1+|0+/g).map((run) => run.length);
  assert.equal(runs.length, 6, 'value ' + value + ' has three bars and three spaces');
  runs.forEach((width) => assert.ok(width >= 1 && width <= 4, 'value ' + value + ' width out of range'));
  assert.equal((runs[0] + runs[2] + runs[4]) % 2, 0, 'value ' + value + ' bars sum to an even count');
  assert.equal((runs[1] + runs[3] + runs[5]) % 2, 1, 'value ' + value + ' spaces sum to an odd count');
  assert.equal(runs.reduce((sum, w) => sum + w, 0), 11, 'value ' + value + ' totals eleven modules');
});
assert.equal(C.PATTERNS[16], '10011101100', 'the pattern of value 16 (digit 0 in Code C)');
assert.equal(C.PATTERNS[33], '10100011000', 'the pattern of value 33 (letter A)');
assert.equal(C.PATTERNS[104], '11010010000', 'start code B');
assert.equal(C.PATTERNS[105], '11010011100', 'start code C');
assert.equal(C.PATTERNS[106], '11000111010', 'the stop symbol before its final bar');
assert.equal(C.STOP, '1100011101011', 'the stop pattern with the terminating bar');
assert.equal(C.STOP.length, 13, 'the stop pattern is thirteen modules');

// ------------------------------------------------------------- check symbol
// Published worked example: Code A, "PJJ123C", weighted sum 878, check 54.
const codeA = (ch) => (ch.charCodeAt(0) >= 32 ? ch.charCodeAt(0) - 32 : ch.charCodeAt(0) + 64);
const example = Array.from('PJJ123C', codeA);
const weighted = 103 + example.reduce((sum, value, index) => sum + value * (index + 1), 0);
assert.equal(weighted, 878, 'the reference weighted sum');
assert.equal(weighted % 103, 54, 'the reference check symbol');
// The page encodes the same text in set B, whose start value is one higher.
assert.equal(encode('PJJ123C').check, 55, 'set B shifts the check symbol by one');

const checkSymbol = (values) => {
  const symbols = values.slice(0, -1);
  const sum = symbols.reduce((total, value, index) => total + value * (index === 0 ? 1 : index), 0);
  return sum % 103;
};

// ------------------------------------------------------------------- decoder
const patternIndex = new Map(C.PATTERNS.map((pattern, value) => [pattern, value]));
const decode = (bits) => {
  assert.equal(bits.slice(-13), C.STOP, 'barcode does not end in the stop pattern');
  const body = bits.slice(0, -13);
  assert.equal(body.length % 11, 0, 'symbols are not whole modules');
  const values = [];
  for (let offset = 0; offset < body.length; offset += 11) {
    const value = patternIndex.get(body.slice(offset, offset + 11));
    assert.notEqual(value, undefined, 'unknown symbol pattern at module ' + offset);
    values.push(value);
  }
  assert.ok(values.length >= 2, 'a barcode needs a start and a check symbol');
  const startValue = values[0];
  assert.ok(startValue === 104 || startValue === 105, 'unknown start symbol ' + startValue);
  assert.ok(values[values.length - 1] <= 102, 'the check symbol is a data value');
  let set = startValue === 104 ? 'B' : 'C';
  let text = '';
  for (const value of values.slice(1, -1)) {
    if (set === 'B') {
      if (value === 99) { set = 'C'; continue; }
      assert.ok(value <= 94, 'set B cannot carry value ' + value);
      text += String.fromCharCode(value + 32);
    } else {
      if (value === 100) { set = 'B'; continue; }
      assert.ok(value <= 99, 'set C cannot carry value ' + value);
      text += (value < 10 ? '0' : '') + String(value);
    }
  }
  return { text, values, check: values[values.length - 1], start: startValue };
};

// ------------------------------------------------------------ default result
const base = encode('ABC-1234');
assert.equal(base.start, 104);
assert.equal(base.check, 34);
assert.equal(base.dataSymbols, 7);
assert.equal(base.totalSymbols, 10);
assert.equal(base.modules, 132);
assert.equal(base.sets.join(','), 'B,C');
assert.equal(base.bits.length, 9 * 11 + 13, 'nine symbols plus the stop pattern');
assert.deepEqual(decode(base.bits).text, 'ABC-1234');
assert.equal(decode(base.bits).check, base.check);
assert.equal(C.calculate({}).text, 'ABC-1234', 'the default input still encodes');

// ------------------------------------------------------ every case round-trips
const samples = [
  'ABC-1234', 'PJJ123C', '1234567890', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'hello world',
  'A1B2C3', 'SHIP-2026-000123', '0042', 'X', '12', '0'.repeat(30), 'A'.repeat(48),
  'Code 128', 'INV-7', '9', '   ', '-', '1', 'a', '~', '0', '00', '000', '0000',
  'SKU 12/34', '12AB34CD', '1A2B3C4D', 'x' + '9'.repeat(6) + 'y', 'Price: 19.99',
];
let seed = 20261118;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const printable = () => String.fromCharCode(32 + Math.floor(random() * 95));
for (let i = 0; i < 150; i += 1) {
  const length = 1 + Math.floor(random() * 48);
  let text = '';
  const digitsOnly = i % 3 === 0;
  for (let k = 0; k < length; k += 1) {
    text += digitsOnly || random() < 0.45 ? String(Math.floor(random() * 10)) : printable();
  }
  samples.push(text);
}
for (const text of samples) {
  const result = encode(text);
  const decoded = decode(result.bits);
  assert.equal(decoded.text, text, 'round trip for ' + JSON.stringify(text));
  assert.equal(result.check, decoded.check, 'check symbol in the bits for ' + JSON.stringify(text));
  assert.equal(result.check, checkSymbol(result.symbols), 'weighted sum for ' + JSON.stringify(text));
  assert.equal(result.modules, C.QUIET_MODULES * 2 + result.bits.length, 'module count incl quiet zones');
  assert.equal(result.totalSymbols, result.symbols.length + 1, 'symbol count incl the stop pattern');
  assert.equal(result.dataSymbols, result.symbols.length - 2, 'data symbols between start and check');
}

// -------------------------------------------------------- planner is shortest
const brute = (text) => {
  const n = text.length;
  let best = Infinity;
  const walk = (pos, set, symbols) => {
    if (symbols >= best) return;
    if (pos === n) { best = symbols; return; }
    if (set === 'B') {
      walk(pos + 1, 'B', symbols + 1);
      if (pos + 1 < n && /\d/.test(text[pos]) && /\d/.test(text[pos + 1])) walk(pos + 2, 'C', symbols + 2);
    } else {
      if (pos + 1 < n && /\d/.test(text[pos]) && /\d/.test(text[pos + 1])) walk(pos + 2, 'C', symbols + 1);
      walk(pos + 1, 'B', symbols + 2);
    }
  };
  walk(0, 'B', 1);
  walk(0, 'C', 1);
  return best;
};
const alphabet = ['A', 'B', '1', '2'];
const build = (prefix, length, out) => {
  if (prefix.length === length) { out.push(prefix); return; }
  for (const ch of alphabet) build(prefix + ch, length, out);
};
const strings = [];
for (let length = 1; length <= 5; length += 1) build('', length, strings);
for (const text of strings) {
  assert.equal(encode(text).symbols.length - 1, brute(text), 'shortest plan for ' + text);
}

// A switch is never emitted unless it saves a symbol.
for (const text of samples) {
  const result = encode(text);
  const values = result.dataValues;
  values.forEach((value) => assert.ok(value >= 0 && value <= 102, 'symbol value in range'));
}

// ---------------------------------------------------------------- refusals
const refuse = (text, message) => {
  let caught = null;
  try { encode(text); } catch (error) { caught = error; }
  assert.ok(caught, 'expected a refusal for ' + JSON.stringify(text));
  assert.equal(caught.message, message);
};
refuse('', 'Enter the text to encode.');
refuse('A'.repeat(49), 'Keep the barcode text to 48 characters or fewer.');
const asciiMessage = 'Only printable ASCII can be encoded; remove characters outside U+0020 to U+007E.';
refuse('caf\u00e9', asciiMessage);
refuse('abc\tdef', asciiMessage);
refuse('\u20ac5', asciiMessage);
refuse('na\u00efve', asciiMessage);
refuse('\u{1F600}', asciiMessage);
refuse('price:\u00a35', asciiMessage);
refuse('\u00dcnicode', asciiMessage);
refuse('line\u007fbreak', asciiMessage);
refuse(String.fromCharCode(10), asciiMessage);

// ------------------------------------------------------------------- page
const stripped = html.split('http://www.w3.org/2000/svg').join('');
assert.ok(!/https?:\/\//.test(stripped), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|eval\(|new Function/.test(html), 'page uses storage, network or eval APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/[^\x00-\x7F]/.test(html), 'page source is not ASCII');
assert.ok(/<input[^>]+id="in-text"/.test(html), 'the text input is present');
assert.ok(/<label class="f" for="in-text"/.test(html), 'the text input is labelled');
assert.ok(/aria-describedby="text-help"/.test(html), 'the input is described');
assert.ok(/aria-live="polite"/.test(html), 'the result is announced');
assert.ok(/role="alert"/.test(html), 'the error is announced');
assert.ok(/min-height:44px/.test(html), 'tap targets are sized');
const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate ids in the page');
for (const id of Array.from(html.matchAll(/getElementById\("([^"]+)"\)/g), (match) => match[1])) {
  assert.ok(ids.includes(id), 'script looks up a missing id: ' + id);
}
assert.ok(/createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "svg"\)/.test(html), 'the page draws an SVG');

// -------------------------------------------------- catalog record replay
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'code128-barcode-generator');
assert.ok(record, 'catalog record missing');
assert.equal(record.category, 'Encoding');
assert.equal(record.subcategory, 'Generation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(Array.isArray(record.sources) && record.sources.length >= 1, 'sources recorded');
assert.ok(record.sources.every((item) => /^https:\/\//.test(item.url)), 'source URLs are https');
assert.ok(/browser/.test(record.method), 'method documents local execution');
assert.equal(record.testCases.length, 20, 'the full catalog case set');
for (const testCase of record.testCases) {
  const options = { ...C.DEFAULTS, ...testCase.input };
  if (testCase.kind === 'validation') {
    let caught = null;
    try { C.calculate(options); } catch (error) { caught = error; }
    assert.ok(caught, testCase.name + ' was not refused');
    assert.equal(caught.message, testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.calculate(options);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.equal(result[key], value, testCase.name + ' ' + key);
  }
  assert.equal(decode(result.bits).text, result.text, testCase.name + ' round trip');
}

console.log('code128-barcode-generator: all checks passed (' + record.testCases.length
  + ' catalog cases, ' + samples.length + ' round trips)');
