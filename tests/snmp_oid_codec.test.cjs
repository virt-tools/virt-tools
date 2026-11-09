/* Regression checks for SNMP OID BER conversion, independent OpenSSL vectors,
   catalog cases and the page's local-only, accessible markup contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'snmp-oid-codec';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* snmp-oid-core:start */');
const end = html.indexOf('/* snmp-oid-core:end */');
assert.ok(start > -1 && end > start, 'OID core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '\nmodule.exports = SnmpOidCore;', sandbox);
const C = sandbox.module.exports;
const analyze = (input) => JSON.parse(JSON.stringify(C.analyze(input)));
const failure = (input) => {
  try { C.analyze(input); } catch (error) { return error.message; }
  return null;
};

// OpenSSL 3.5.7 `asn1parse -genstr OID:<oid>` generated these TLVs.
const opensslVectors = [
  ['0.0', '06 01 00'],
  ['0.39', '06 01 27'],
  ['1.39', '06 01 4f'],
  ['2.40', '06 01 78'],
  ['2.999.3', '06 03 88 37 03'],
  ['1.2.840.113549', '06 06 2a 86 48 86 f7 0d'],
  ['1.3.6.1.2.1.1.1.0', '06 08 2b 06 01 02 01 01 01 00'],
  ['1.3.6.1.2.1.1.3.0', '06 08 2b 06 01 02 01 01 03 00'],
  ['1.3.6.1.4.1', '06 05 2b 06 01 04 01'],
  ['1.3.6.1.4.1.4294967295', '06 0a 2b 06 01 04 01 8f ff ff ff 7f'],
  ['2.4294967295', '06 05 90 80 80 80 4f'],
];
for (const [oid, tlv] of opensslVectors) {
  const encoded = analyze(oid);
  assert.equal(encoded.oid, oid, oid);
  assert.equal(encoded.tlvHex, tlv, `OpenSSL encoding for ${oid}`);
  assert.equal(analyze(tlv).oid, oid, `TLV decoding for ${oid}`);
  assert.equal(analyze(tlv).inputForm, 'BER TLV');
  assert.equal(analyze('value:' + encoded.valueHex).oid, oid, `value decoding for ${oid}`);
  assert.equal(analyze(encoded.valueHex).oid, oid, `unprefixed value decoding for ${oid}`);
}

// Every legal first/second combination under roots 0 and 1, plus root 2 edges.
for (let first = 0; first <= 1; first += 1) {
  for (let second = 0; second <= 39; second += 1) {
    const oid = `${first}.${second}`;
    const result = analyze(oid);
    assert.equal(result.oid, oid);
    assert.equal(result.firstValue, String(first * 40 + second));
    assert.equal(analyze(result.tlvHex).oid, oid);
  }
}
for (const second of [0, 1, 39, 40, 127, 128, 999, 4294967295]) {
  const oid = `2.${second}`;
  assert.equal(analyze(analyze(oid).tlvHex).oid, oid);
}
for (const arc of [0, 1, 127, 128, 129, 16383, 16384, 2097151, 2097152, 268435455, 268435456, 4294967295]) {
  const oid = `1.3.${arc}`;
  assert.equal(analyze(analyze(oid).tlvHex).oid, oid, `base-128 boundary ${arc}`);
}

// Deterministic varied OIDs round-trip through both accepted hex forms.
let state = 0x6902578;
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state;
};
for (let n = 0; n < 500; n += 1) {
  const count = 2 + random() % 30;
  const first = random() % 3;
  const second = first < 2 ? random() % 40 : random();
  const arcs = [first, second];
  for (let i = 2; i < count; i += 1) arcs.push(random());
  const oid = arcs.join('.');
  const result = analyze(oid);
  assert.equal(analyze(result.tlvHex).oid, oid, `TLV round trip ${oid}`);
  assert.equal(analyze(result.valueHex).oid, oid, `value round trip ${oid}`);
}

const longOid = ['1', '3', ...Array(126).fill('128')].join('.');
const longResult = analyze(longOid);
assert.equal(longResult.arcCount, 128);
assert.equal(longResult.valueBytes, 253);
assert.equal(longResult.tlvBytes, 256);
assert.ok(longResult.tlvHex.startsWith('06 81 fd 2b 81 00'), 'minimal long-form BER length');
assert.equal(analyze(longResult.tlvHex).oid, longOid, 'long-form TLV round trip');
assert.equal(analyze('.01.003.0006.1').oid, '1.3.6.1');
assert.equal(analyze('0X2A:86:48:86:F7:0D').oid, '1.2.840.113549');
assert.equal(analyze('content:06 01').oid, '0.6.1', 'forced value form disambiguates tag 06');
assert.match(failure('06 01'), /TLV length says 1 content bytes, but 0 are present/);
assert.equal(analyze('06 02 06 01').oid, '0.6.1', 'the same bytes are unambiguous as a TLV');

// Parser and structural failures beyond the catalog vectors.
assert.match(failure('1.a.3'), /Arc 2 must be a non-negative decimal integer/);
assert.match(failure('1.-3'), /Arc 2 must be a non-negative decimal integer/);
assert.match(failure('1.3.'), /Arc 3 is empty/);
assert.match(failure('gg'), /Hex bytes may contain only/);
assert.match(failure('06'), /missing its length byte/);
assert.match(failure('06 82 01'), /invalid or truncated length field/);
assert.match(failure('06 81 00 00'), /without a leading zero byte/);
assert.match(failure('value:90 80 80 80 50 00'), /Decoded arc exceeds/);
assert.match(failure('value:2b 90 80 80 80 40'), /Decoded arc 3 exceeds/);
assert.match(failure('value:' + Array(128).fill('00').join(' ')), /limit of 128 arcs/);

// The page is self-contained and uses safe DOM construction.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="oid-form"/.test(html) && /type="submit"/.test(html), 'form and submit control');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<label class="f" for="oid">/.test(html), 'input is labelled');
assert.ok(/min-height:44px/.test(html), 'tap targets are at least 44 px');
for (const match of html.matchAll(/\$\("([^"]+)"\)/g)) {
  assert.ok(html.includes(`id="${match[1]}"`), `DOM id exists: ${match[1]}`);
}
for (const match of html.matchAll(/class="chip" data-value="([^"]+)"/g)) {
  assert.ok(analyze(match[1]).oid, `example converts: ${match[1]}`);
}
assert.equal((html.match(/class="chip"/g) || []).length, 4, 'four examples');

// Catalog metadata and every declared golden/boundary/validation case replay.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog slug exists exactly once');
const record = records[0];
assert.equal(record.name, 'SNMP OID Codec');
assert.equal(record.category, 'IT & Networking');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('browser') && record.method.includes('OpenSSL'));
assert.equal(record.sources.length, 2);
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 27);
assert.equal(kinds('golden'), 9);
assert.equal(kinds('boundary'), 3);
assert.equal(kinds('validation'), 15);
for (const testCase of record.testCases) {
  const { input, expected } = testCase;
  if (expected.error) {
    assert.equal(failure(input.value), expected.error, testCase.name);
    continue;
  }
  const result = analyze(input.value);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(result[key], value, `${testCase.name} ${key}`);
  }
}

console.log(`snmp-oid-codec: all checks passed (${record.testCases.length} catalog cases, ${opensslVectors.length} OpenSSL vectors, 500 randomized round trips, 128-arc long-form TLV)`);
