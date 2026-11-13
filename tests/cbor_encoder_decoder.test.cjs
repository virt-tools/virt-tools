/* CBOR encoder and decoder: RFC 8949 vectors, canonical encoding, validation
   paths, catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'cbor-encoder-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* cbor-core:start */';
const endMarker = '/* cbor-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {}, DataView, ArrayBuffer, BigInt, Object, JSON, Math, Number, String };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CborCore;', sandbox);
const C = sandbox.module.exports;

const canon = (value) => {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canon(value[key]);
    return out;
  }
  return value;
};
const decode = (hex) => JSON.parse(C.decodeHex(hex).jsonText);
const same = (actual, expected) => JSON.stringify(canon(actual)) === JSON.stringify(canon(expected));
const failure = (mode, input) => {
  try {
    if (mode === 'encode') C.encodeJson(input.json);
    else if (input.format === 'base64') C.decodeBase64(input.data);
    else C.decodeHex(input.data);
  } catch (error) {
    return error.message;
  }
  return null;
};

// ---- Exported contract.
assert.equal(C.MAX_BYTES, 4096);
assert.equal(C.MAX_ITEMS, 2000);
assert.equal(C.MAX_DEPTH, 32);
assert.equal(C.MAX_SAFE, 9007199254740991);
assert.equal(C.typeLabel({ type: 'map' }), 'Map');
assert.equal(C.numberText(-0), '-0');
assert.equal(C.numberText(NaN), 'NaN');
assert.equal(C.toHex([0, 15, 255]), '000fff');
assert.equal(JSON.stringify(C.bytesFromHex('0x01 02')), '[1,2]');
assert.equal(JSON.stringify(C.bytesFromBase64('YWE=')), '[97,97]');

// ---- RFC 8949 Appendix A examples.
const vectors = [
  ['00', 0], ['17', 23], ['1818', 24], ['1903e8', 1000], ['1a000f4240', 1000000],
  ['1b000000e8d4a51000', 1000000000000], ['1bffffffffffffffff', { $bigint: '18446744073709551615' }],
  ['3bffffffffffffffff', { $bigint: '-18446744073709551616' }],
  ['20', -1], ['3863', -100], ['3903e7', -1000],
  ['f90000', 0], ['f93c00', 1], ['f93e00', 1.5], ['f97bff', 65504],
  ['fa47c35000', 100000], ['fb3ff199999999999a', 1.1], ['fbc010666666666666', -4.1],
  ['f90001', 5.960464477539063e-8], ['f90400', 0.00006103515625], ['f9c400', -4],
  ['f97c00', { $float: 'Infinity' }], ['f97e00', { $float: 'NaN' }], ['f9fc00', { $float: '-Infinity' }],
  ['f98000', { $float: '-0' }],
  ['f4', false], ['f5', true], ['f6', null], ['f7', { $undefined: true }],
  ['f0', { $simple: 16 }], ['f8ff', { $simple: 255 }],
  ['c074323031332d30332d32315432303a30343a30305a', { $tag: 0, value: '2013-03-21T20:04:00Z' }],
  ['c11a514b67b0', { $tag: 1, value: 1363896240 }],
  ['d74401020304', { $tag: 23, value: { $bytes: '01020304' } }],
  ['40', { $bytes: '' }], ['4401020304', { $bytes: '01020304' }],
  ['60', ''], ['6161', 'a'], ['6449455446', 'IETF'], ['62225c', '"\\'], ['62c3bc', '\u00fc'],
  ['63e6b0b4', '\u6c34'], ['64f0908591', '\u{10151}'],
  ['80', []], ['83010203', [1, 2, 3]], ['8301820203820405', [1, [2, 3], [4, 5]]],
  ['a0', {}], ['a201020304', { $map: [[1, 2], [3, 4]] }],
  ['a26161016162820203', { a: 1, b: [2, 3] }], ['826161a161626163', ['a', { b: 'c' }]],
  ['5f42010243030405ff', { $bytes: '0102030405' }], ['7f657374726561646d696e67ff', 'streaming'],
  ['9fff', []], ['bfff', {}], ['bf61610161629f0203ffff', { a: 1, b: [2, 3] }],
  ['bf6346756ef563416d7421ff', { Fun: true, Amt: -2 }]
];
for (const [hex, expected] of vectors) {
  const result = C.decodeHex(hex);
  assert.ok(same(JSON.parse(result.jsonText), expected), 'decode ' + hex);
  assert.equal(result.bytes, hex.length / 2, 'byte count ' + hex);
}

// ---- Flags and edge behaviour.
assert.equal(C.decodeHex('1bffffffffffffffff').table[0].notes, 'above 2^53');
assert.equal(C.decodeHex('c249010000000000000000').table[0].notes, 'bignum 18446744073709551616');
assert.equal(C.decodeHex('c349010000000000000000').table[0].notes, 'bignum -18446744073709551617');
assert.equal(C.decodeHex('190018').nonMinimal, 1, 'non-minimal integer counted');
assert.equal(C.decodeHex('190018').jsonText, '24');
assert.equal(C.decodeHex('9f01820203ff').indefinite, 1);
assert.equal(C.decodeHex('a2616101616102').duplicateKeys, 1);
assert.ok(same(decode('a2616101616102'), { $map: [['a', 1], ['a', 2]] }));
assert.equal(C.decodeHex('0102').items, 2, 'a sequence of top-level items');
assert.ok(same(decode('0102'), [1, 2]));
assert.equal(C.decodeHex('9fff').items, 1);
assert.equal(C.decodeHex('f97e00').table[0].type, 'Float');
assert.equal(C.decodeHex('f97e00').rows[3].v, '1', 'one value scanned');

// ---- Canonical encoding.
const encodings = [
  ['0', '00'], ['23', '17'], ['24', '1818'], ['1000', '1903e8'], ['-1', '20'], ['-1000', '3903e7'],
  ['1.1', 'fb3ff199999999999a'], ['true', 'f5'], ['false', 'f4'], ['null', 'f6'],
  ['"IETF"', '6449455446'], ['""', '60'], ['[]', '80'], ['{}', 'a0'],
  ['[1,2,3]', '83010203'], ['[1,[2,3],[4,5]]', '8301820203820405'],
  ['{"a":1,"b":[2,3]}', 'a26161016162820203'], ['{"b":[2,3],"a":1}', 'a26161016162820203'],
  ['{"$bytes":"0102ff"}', '430102ff'], ['{"$bytes":""}', '40'],
  ['{"$tag":0,"value":"x"}', 'c06178'], ['{"$simple":16}', 'f0'],
  ['{"$undefined":true}', 'f7'], ['{"$float":"NaN"}', 'f97e00'],
  ['{"$bigint":"18446744073709551615"}', '1bffffffffffffffff']
];
for (const [json, hex] of encodings) {
  assert.equal(C.encodeJson(json).hex, hex, 'encode ' + json);
}

// ---- Round trips through both directions.
for (const json of ['[1,2,3]', '{"a":1,"b":[2,3]}', '{"$bytes":"0102030405"}', '{"$tag":1,"value":2}', '{"x":["y",true,null]}']) {
  const encoded = C.encodeJson(json);
  assert.ok(same(JSON.parse(C.decodeHex(encoded.hex).jsonText), JSON.parse(json)), 'round trip ' + json);
}

// ---- Validation messages.
assert.equal(failure('decode', { format: 'hex', data: '' }), 'Enter hexadecimal bytes to decode.');
assert.equal(failure('decode', { format: 'hex', data: '0' }), 'Hexadecimal input needs two digits per byte, but 1 digits were given.');
assert.equal(failure('decode', { format: 'hex', data: 'zz' }), 'Only hexadecimal digits and spaces are allowed in hex input.');
assert.equal(failure('decode', { format: 'hex', data: '18' }), 'Unexpected end of input at byte 1: another byte was expected.');
assert.equal(failure('decode', { format: 'hex', data: '1c' }), 'Reserved additional information 28 at byte 0.');
assert.equal(failure('decode', { format: 'hex', data: 'ff' }), 'Unexpected break (0xff) at byte 0.');
assert.equal(failure('decode', { format: 'hex', data: '61c3' }), 'Invalid UTF-8 at byte 0: the character is cut off.');
assert.equal(failure('decode', { format: 'hex', data: '62c0af' }), 'Invalid UTF-8 at byte 0: 0xc0 cannot start a character.');
assert.equal(failure('decode', { format: 'hex', data: '63e08080' }), 'Invalid UTF-8 at byte 0: overlong encoding.');
assert.equal(failure('decode', { format: 'hex', data: '9f01' }), 'Indefinite-length array at byte 0 is not terminated by a break.');
assert.equal(failure('decode', { format: 'hex', data: '81' }), 'Unexpected end of input at byte 1: another byte was expected.');
assert.equal(failure('decode', { format: 'base64', data: 'AAAAA' }), 'Base64 input has an impossible length after removing padding.');
assert.equal(failure('encode', { json: '' }), 'Enter JSON to encode.');
assert.equal(failure('encode', { json: '{' }), 'That is not valid JSON. Check the syntax and try again.');
assert.equal(failure('encode', { json: '{"$simple":28}' }), 'Simple values 24 to 31 are reserved by the CBOR format.');
assert.equal(failure('encode', { json: '{"$bytes":"0"}' }), '$bytes needs two digits per byte, but 1 digits were given.');
assert.equal(failure('encode', { json: '1e999' }), 'Numbers must be finite; use {"$float":"NaN"} or {"$float":"Infinity"}.');
assert.equal(failure('encode', { json: '['.repeat(40) + ']'.repeat(40) }), 'JSON nesting is deeper than 32 levels.');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2246, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'CBOR Encoder & Decoder');
assert.equal(record.category, 'Encoding');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1f5c3}');
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.method.includes('RFC 8949'), 'method names the specification');
assert.ok(record.method.includes('4,096'), 'method states the byte limit');
assert.ok(record.method.includes('-1 - n'), 'method states the negative-integer rule');
assert.ok(record.sources.length >= 4, 'sources are cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 31, 'catalog case count');
assert.equal(kinds('golden'), 18, 'eighteen golden cases');
assert.equal(kinds('validation'), 13, 'thirteen validation cases');
for (const testCase of record.testCases) {
  const input = testCase.input;
  if (testCase.kind === 'validation') {
    assert.equal(failure(input.mode, input), testCase.expected.error, testCase.name);
    continue;
  }
  if (input.mode === 'decode') {
    const result = input.format === 'base64' ? C.decodeBase64(input.data) : C.decodeHex(input.data);
    assert.ok(same(JSON.parse(result.jsonText), testCase.expected.json), testCase.name + ' json');
    assert.equal(result.bytes, testCase.expected.bytes, testCase.name + ' bytes');
    assert.equal(result.items, testCase.expected.items, testCase.name + ' items');
    assert.equal(result.headline, testCase.expected.headline, testCase.name + ' headline');
    continue;
  }
  const result = C.encodeJson(input.json);
  assert.equal(result.hex, testCase.expected.hex, testCase.name + ' hex');
  assert.equal(result.bytes, testCase.expected.bytes, testCase.name + ' bytes');
  assert.equal(result.headline, testCase.expected.headline, testCase.name + ' headline');
}

// The new record's slug, name and aliases must not collide with any other record.
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

console.log('cbor encoder & decoder: RFC 8949 examples, canonical encoding, validation, 31 catalog cases and the page contract pass');
