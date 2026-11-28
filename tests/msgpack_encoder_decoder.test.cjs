/* MessagePack codec: replay the catalog cases, pin the byte layouts of the format table,
   and check the decoder against structures produced by an independent implementation
   (u-msgpack-python 2.9.0) during development. The page core is loaded on its own so the
   codec can be exercised without a browser. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'msgpack-encoder-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* msgpack-core:start */');
const end = html.indexOf('/* msgpack-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, html.indexOf('*/', end) + 2);
vm.runInThisContext(coreText + '\n;globalThis.__msgpackCore = MsgpackCore;');
const C = globalThis.__msgpackCore;

function failure(run) {
  try { run(); } catch (error) { return error.message; }
  return null;
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');

// ---- The format table, pinned byte for byte from the specification.
const integerCases = [
  ['0', '00'], ['1', '01'], ['127', '7f'], ['128', 'cc80'], ['255', 'ccff'],
  ['256', 'cd0100'], ['65535', 'cdffff'], ['65536', 'ce00010000'],
  ['4294967295', 'ceffffffff'], ['4294967296', 'cf0000000100000000'],
  ['9007199254740991', 'cf001fffffffffffff'],
  ['-1', 'ff'], ['-32', 'e0'], ['-33', 'd0df'], ['-128', 'd080'], ['-129', 'd1ff7f'],
  ['-32768', 'd18000'], ['-32769', 'd2ffff7fff'], ['-2147483648', 'd280000000'],
  ['-2147483649', 'd3ffffffff7fffffff']
];
for (const [json, hex] of integerCases) {
  assert.equal(C.encodeJson(json).hex, hex, 'integer ' + json);
  assert.equal(C.decode(Array.from(Buffer.from(hex, 'hex'))).json, Number(json), 'decode ' + json);
}
assert.equal(C.encodeJson('{"$bigint":"18446744073709551615"}').hex, 'cfffffffffffffffff');
assert.equal(C.encodeJson('{"$bigint":"9223372036854775807"}').hex, 'cf7fffffffffffffff');
assert.equal(C.encodeJson('{"$bigint":"-9223372036854775808"}').hex, 'd38000000000000000');
assert.deepEqual(C.decodeHex('cfffffffffffffffff').json, { $bigint: '18446744073709551615' });
assert.deepEqual(C.decodeHex('d38000000000000000').json, { $bigint: '-9223372036854775808' });

assert.equal(C.encodeJson('null').hex, 'c0');
assert.equal(C.encodeJson('true').hex, 'c3');
assert.equal(C.encodeJson('false').hex, 'c2');
assert.equal(C.encodeJson('1.1').hex, 'cb3ff199999999999a');
assert.equal(C.encodeJson('{"$float":"NaN"}').hex, 'cb7ff8000000000000');
assert.equal(C.encodeJson('{"$float":"Infinity"}').hex, 'cb7ff0000000000000');
assert.equal(C.encodeJson('{"$float":"-Infinity"}').hex, 'cbfff0000000000000');
assert.deepEqual(C.decodeHex('cb7ff8000000000000').json, { $float: 'NaN' });
assert.deepEqual(C.decodeHex('cb7ff0000000000000').json, { $float: 'Infinity' });
assert.deepEqual(C.decodeHex('cbfff0000000000000').json, { $float: '-Infinity' });
assert.equal(C.decodeHex('ca3f8ccccd').json, 1.100000023841858, 'float 32 is single precision');

// String headers at every boundary reachable inside the 4,096-byte limit.
for (const length of [0, 1, 31, 32, 255, 256]) {
  const text = 'x'.repeat(length);
  const result = C.encodeJson(JSON.stringify(text));
  assert.equal(C.decodeHex(result.hex).json, text, 'string round trip ' + length);
}
assert.equal(C.encodeJson(JSON.stringify('x'.repeat(31))).hex.slice(0, 2), 'bf');
assert.equal(C.encodeJson(JSON.stringify('x'.repeat(32))).hex.slice(0, 4), 'd920');
assert.equal(C.encodeJson(JSON.stringify('x'.repeat(255))).hex.slice(0, 4), 'd9ff');
assert.equal(C.encodeJson(JSON.stringify('x'.repeat(256))).hex.slice(0, 6), 'da0100');

// Array and map headers: fix, then the 16-bit form.
assert.equal(C.encodeJson(JSON.stringify(Array.from({ length: 15 }, (_, i) => i))).hex.slice(0, 2), '9f');
assert.equal(C.encodeJson(JSON.stringify(Array.from({ length: 16 }, (_, i) => i))).hex.slice(0, 6), 'dc0010');
const fifteen = Object.fromEntries(Array.from({ length: 15 }, (_, i) => ['k' + i, i]));
const sixteen = Object.fromEntries(Array.from({ length: 16 }, (_, i) => ['k' + i, i]));
assert.equal(C.encodeJson(JSON.stringify(fifteen)).hex.slice(0, 2), '8f');
assert.equal(C.encodeJson(JSON.stringify(sixteen)).hex.slice(0, 6), 'de0010');

// Binary and extension headers: fixext for 1, 2, 4, 8 and 16 bytes, ext 8 otherwise.
assert.equal(C.encodeJson('{"$bin":"ff"}').hex, 'c401ff');
assert.equal(C.encodeJson('{"$bin":"' + '00'.repeat(256) + '"}').hex.slice(0, 6), 'c50100');
assert.equal(C.encodeJson('{"$ext":{"type":5,"data":"aa"}}').hex, 'd405aa');
assert.equal(C.encodeJson('{"$ext":{"type":5,"data":"aabb"}}').hex, 'd505aabb');
assert.equal(C.encodeJson('{"$ext":{"type":5,"data":"aabbcc"}}').hex, 'c70305aabbcc');
assert.equal(C.encodeJson('{"$ext":{"type":5,"data":"' + 'aa'.repeat(4) + '"}}').hex.slice(0, 4), 'd605');
assert.equal(C.encodeJson('{"$ext":{"type":5,"data":"' + 'aa'.repeat(8) + '"}}').hex.slice(0, 4), 'd705');
assert.equal(C.encodeJson('{"$ext":{"type":-1,"data":"' + 'aa'.repeat(16) + '"}}').hex.slice(0, 4), 'd8ff');
assert.equal(C.encodeJson('{"$ext":{"type":5,"data":"' + 'aa'.repeat(17) + '"}}').hex.slice(0, 4), 'c711');

// Timestamps: 32, 64 and 96 bit forms follow the specification's rules.
const stamp = (seconds, nanoseconds) => C.encodeJson(JSON.stringify({ $timestamp: { seconds, nanoseconds } }));
assert.equal(stamp(1600000000, 0).hex, 'd6ff5f5e1000');
assert.equal(stamp(4294967295, 0).hex, 'd6ffffffffff');
assert.equal(stamp(4294967296, 0).hex, 'd7ff0000000100000000');
assert.equal(stamp(1600000000, 123456789).hex, 'd7ff1d6f34545f5e1000');
assert.equal(stamp(-1, 0).hex, 'c70cff00000000ffffffffffffffff');
assert.equal(stamp(17179869184, 0).hex, 'c70cff000000000000000400000000');
assert.equal(C.decodeHex('d6ff5f5e1000').json.$ext.timestamp, '2020-09-13T12:26:40Z');
assert.equal(C.decodeHex('d7ff1d6f34545f5e1000').json.$ext.timestamp, '2020-09-13T12:26:40.123456789Z');
assert.equal(C.decodeHex('c70cff00000000ffffffffffffffff').json.$ext.timestamp, '1969-12-31T23:59:59Z');
assert.equal(C.decodeHex('c70cff000000000000000400000000').json.$ext.timestamp, '2514-05-30T01:53:04Z');

// ---- Non-minimal encodings are accepted, counted and explained.
assert.equal(C.decodeHex('cc05').nonMinimal, 1);
assert.equal(C.decodeHex('cc05').table[0].notes[0], 'Positive fixint would be shorter.');
assert.equal(C.decodeHex('d1ffdf').table[0].notes[0], 'int 8 would be shorter.');
assert.equal(C.decodeHex('d90161').table[0].notes[0], 'fixstr would be shorter.');
assert.equal(C.decodeHex('dc0001c0').table[0].notes[0], 'fixarray would be shorter.');
assert.equal(C.decodeHex('de0001a16101').table[0].notes[0], 'fixmap would be shorter.');
assert.equal(C.decodeHex('c8000301010203').table[0].notes[0], 'ext 8 would be shorter.');
assert.equal(C.decodeHex('c5000100').table[0].notes[0], 'bin 8 would be shorter.');

// ---- Decoder structure: offsets, lengths, labels and nesting.
const canonical = C.decodeHex('82a7636f6d70616374c3a6736368656d6100');
assert.deepEqual(canonical.table.map((row) => row.offset), [0, 1, 9, 10, 17]);
assert.deepEqual(canonical.table.map((row) => row.length), [18, 8, 1, 7, 1]);
assert.deepEqual(canonical.table.map((row) => row.type), ['Fixmap', 'Fixstr', 'Boolean', 'Fixstr', 'Positive fixint']);
assert.equal(canonical.items, 5);
assert.equal(canonical.depth, 2);
assert.equal(C.decodeHex('81a16181a16281a163c0').depth, 4);
assert.equal(C.decodeHex('c3').depth, 1);
assert.equal(C.decodeHex('80').jsonText, '{}');
assert.deepEqual(C.decodeHex('8101a161').json, { $map: [[1, 'a']] });
assert.deepEqual(C.decodeHex('82a16101a16102').json, { $map: [['a', 1], ['a', 2]] });
assert.equal(C.decodeHex('82a16101a16102').table[0].notes.length, 1);

// A "__proto__" key must stay an own property instead of reaching the prototype.
const proto = C.decodeHex('81a95f5f70726f746f5f5fc3');
assert.equal(Object.getPrototypeOf(proto.json), Object.prototype);
assert.equal(Object.prototype.hasOwnProperty.call(proto.json, '__proto__'), true);
assert.equal(JSON.stringify(proto.json), '{"__proto__":true}');

// Extension payloads that are not timestamps keep their type and data.
assert.deepEqual(C.decodeHex('d5020102').json, { $ext: { type: 2, data: '0102' } });
assert.deepEqual(C.decodeHex('c703ff010203').json, { $ext: { type: -1, data: '010203' } });
assert.ok(C.decodeHex('c703ff010203').table[0].notes[0].includes('not a timestamp'));
assert.equal(C.decodeHex('d7ffee6b280000000000').table[0].notes.length, 2, 'invalid nanoseconds are flagged');

// ---- Refusals, including the reserved byte and the limits.
assert.equal(failure(() => C.decodeHex('')), 'Enter hexadecimal bytes to decode.');
assert.equal(failure(() => C.decodeHex('0')), 'Hexadecimal input needs two digits per byte, but 1 digit was given.');
assert.equal(failure(() => C.decodeHex('zz')), 'Only hexadecimal digits and spaces are allowed in hex input.');
assert.equal(failure(() => C.decodeBase64('AAAAA')), 'Base64 input has an impossible length after removing padding.');
assert.equal(failure(() => C.decodeHex('c1')), 'The byte 0xc1 at byte 0 is reserved and never used by MessagePack.');
assert.equal(failure(() => C.decodeHex('cc')), 'Unexpected end of input at byte 1: 1 more byte was expected.');
assert.equal(failure(() => C.decodeHex('a5' + '61')), 'Unexpected end of input at byte 1: 4 more bytes were expected.');
assert.equal(failure(() => C.decodeHex('0102')), '1 byte after the first value at byte 1 is not part of it.');
assert.equal(failure(() => C.decodeHex('a1ff')), 'Invalid UTF-8 at byte 1: 0xff cannot start a character.');
assert.equal(failure(() => C.decodeHex('a2c0af')), 'Invalid UTF-8 at byte 1: 0xc0 cannot start a character.');
assert.equal(failure(() => C.decodeHex('a3e08080')), 'Invalid UTF-8 at byte 1: overlong encoding.');
assert.equal(failure(() => C.decodeHex('a3eda080')), 'Invalid UTF-8 at byte 1: surrogate code point.');
assert.equal(failure(() => C.decodeHex('a4f4908080')), 'Invalid UTF-8 at byte 1: code point above U+10FFFF.');
assert.equal(failure(() => C.decodeHex('00'.repeat(4097))), 'Input is limited to 4096 bytes.');
assert.equal(failure(() => C.decodeHex('91'.repeat(33) + 'c0')), 'Input nests deeper than 32 levels.');
assert.equal(failure(() => C.encodeJson('')), 'Enter JSON to encode.');
assert.equal(failure(() => C.encodeJson('{')), 'That is not valid JSON. Check the syntax and try again.');
assert.equal(failure(() => C.encodeJson('1e309')), 'Use the $float marker for NaN or Infinity.');
assert.equal(failure(() => C.encodeJson('{"$bin":"0"}')), '$bin needs two digits per byte, but 1 digit was given.');
assert.equal(failure(() => C.encodeJson('{"$bin":"xyz"}')), '$bin needs hexadecimal digits only.');
assert.equal(failure(() => C.encodeJson('{"$ext":{"type":200,"data":"00"}}')), '$ext type must be a whole number from -128 to 127.');
assert.equal(failure(() => C.encodeJson('{"$map":[[1]]}')), '$map must be an array of two-item key and value arrays.');
assert.equal(failure(() => C.encodeJson('{"$timestamp":{"seconds":1,"nanoseconds":1000000000}}')), '$timestamp nanoseconds must be a whole number from 0 to 999999999.');
assert.equal(failure(() => C.encodeJson('['.repeat(33) + ']'.repeat(33))), 'Value nests deeper than 32 levels.');
assert.equal(failure(() => C.encodeJson(JSON.stringify('x'.repeat(4097)))), 'Encoded output would exceed 4096 bytes.');

// ---- Round trips over the value space the encoder accepts.
const values = [
  null, true, false, 0, 1, -1, 127, 128, 255, 256, 65535, 65536, 4294967295, 4294967296,
  -32, -33, -128, -129, -32768, -32769, -2147483648, -2147483649, 1.5, -0.25,
  '', 'a', 'Hello World!', 'x'.repeat(300), '\u00e9\u4e2d\ud83d\ude00',
  [], [1, 2, 3], [[1], [2, [3]]], {}, { a: 1, b: [true, null] }, { nested: { deep: [{ x: 'y' }] } },
  { '\u00fc': '\u00df', arr: [[], {}, ''] }, Array.from({ length: 20 }, (_, i) => i)
];
for (const value of values) {
  const encoded = C.encodeJson(JSON.stringify(value));
  assert.deepEqual(C.decodeHex(encoded.hex).json, value, 'round trip ' + JSON.stringify(value).slice(0, 40));
}
for (let length = 0; length <= 70; length += 1) {
  const text = 'a'.repeat(length);
  assert.equal(C.decodeHex(C.encodeJson(JSON.stringify(text)).hex).json, text, 'string length ' + length);
}

// ---- Catalog record and its cases must agree with the core.
assert.equal(record.name, 'MessagePack Encoder & Decoder');
assert.equal(record.category, 'Encoding');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.legacyCategory, null);
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1f4e6}');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.method.length > 1500, 'method documents the format');
assert.ok(record.method.includes('0xc1'), 'method names the reserved byte');
assert.ok(record.method.includes('4,096'), 'method states the byte limit');
assert.equal(record.sources.length, 2, 'sources are cited');
assert.equal(record.sources[0].url, 'https://github.com/msgpack/msgpack/blob/master/spec.md');
assert.equal(record.sources[1].url, 'https://msgpack.org/');

const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 38, 'catalog case count');
assert.equal(kinds('golden'), 19, 'nineteen golden cases');
assert.equal(kinds('boundary'), 7, 'seven boundary cases');
assert.equal(kinds('validation'), 12, 'twelve validation cases');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(() => C.run(testCase.input)), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.run(testCase.input);
  for (const [field, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[field], expected, testCase.name + ' ' + field);
  }
}

// The page's example and its placeholder must decode to the same value.
const placeholder = html.match(/placeholder="([0-9a-f]+)"/);
assert.ok(placeholder, 'the textarea carries an example');
assert.deepEqual(C.decodeHex(placeholder[1]).json, { compact: true, schema: 0 });
assert.ok(html.includes('"' + placeholder[1] + '"'), 'the example button uses the same bytes');

// Slugs, names and aliases must not collide with any other record.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');

// The catalog keeps growing and every listed record has a page.
const pageDirs = fs.readdirSync(path.join(root, 'frontend/tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, 'frontend/tools', entry.name, 'index.html')))
  .length;
assert.equal(catalog.tools.length, 2530, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2269, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, pageDirs, 'listed records and page directories agree');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Encoding').length, 58, 'Encoding count');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 8, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const id of ['mode', 'format', 'input']) {
  assert.ok(html.includes('<label for="' + id + '"'), 'control has a visible label: ' + id);
}
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status"/.test(html), 'copy feedback is announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus/.test(html), 'keyboard focus is visible');
assert.ok(/\.field\[hidden\]\{display:none\}/.test(html), 'the hidden field is actually hidden');
assert.ok(/pre\.view\{/.test(html), 'the JSON view is styled');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');
