/* TLS cipher-suite decoder: the IANA registry table compiled into the page is checked
   row by row against the registry CSV it was built from, with an independent Python
   implementation of the naming grammar supplying the expected components; the codes
   the current TLS specification prints are pinned as published anchors; then the
   list mode, the GREASE and signalling values, the error contract and the page. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/tls-cipher-suite-decoder/index.html'), 'utf8');
const start = html.indexOf('/* tls-core:start */');
const end = html.indexOf('/* tls-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + '/* tls-core:end */'.length);
assert.ok(!/document\.|window\.|fetch\(|XMLHttpRequest/.test(coreSource), 'the core stays free of DOM and network access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = TlsSuites;', sandbox);
const C = sandbox.module.exports;

const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/tls_cipher_suites.json'), 'utf8'));
const single = (value) => C.analyze({ value }).suites[0];
const failure = (value) => {
  try { C.analyze({ value }); } catch (error) { return error.message; }
  return null;
};

// ---- Constants and the message contract.
assert.equal(C.MAX_VALUES, 32);
assert.equal(C.registrySize, 358);
assert.deepEqual(Object.keys(C.MESSAGES).sort(), ['empty', 'tooMany', 'unknown']);
assert.equal(C.MESSAGES.empty, 'Enter a cipher-suite name or code.');
assert.equal(C.MESSAGES.tooMany, 'Decode at most 32 values at a time.');
assert.equal(C.MESSAGES.unknown, 'No registry name or four-digit hexadecimal code matches that value.');

// ---- Published anchors: the codes the TLS 1.3 specification prints in its cipher-suite
//      table, and a row of the TLS 1.2 table, each decoded from its name and its code.
const anchors = [
  ['TLS_AES_128_GCM_SHA256', 0x1301, 'AES', 128, 'GCM', 'SHA-256'],
  ['TLS_AES_256_GCM_SHA384', 0x1302, 'AES', 256, 'GCM', 'SHA-384'],
  ['TLS_CHACHA20_POLY1305_SHA256', 0x1303, 'ChaCha20-Poly1305', 256, 'AEAD', 'SHA-256'],
  ['TLS_AES_128_CCM_SHA256', 0x1304, 'AES', 128, 'CCM', 'SHA-256'],
  ['TLS_AES_128_CCM_8_SHA256', 0x1305, 'AES', 128, 'CCM with an 8-byte tag', 'SHA-256'],
  ['TLS_RSA_WITH_AES_128_CBC_SHA', 0x002F, 'AES', 128, 'CBC', 'SHA-1'],
  ['TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256', 0xC02F, 'AES', 128, 'GCM', 'SHA-256'],
  ['TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256', 0xCCA9, 'ChaCha20-Poly1305', 256, 'AEAD', 'SHA-256'],
  ['TLS_PSK_WITH_AES_256_GCM_SHA384', 0x00A9, 'AES', 256, 'GCM', 'SHA-384']
];
for (const [name, code, cipher, bits, mode, mac] of anchors) {
  const byName = single(name);
  assert.equal(byName.code, code, name + ' has the published code');
  assert.equal(byName.hex, '0x' + code.toString(16).toUpperCase().padStart(4, '0'), name + ' prints its code');
  assert.equal(byName.parsed.cipher, cipher, name + ' bulk cipher');
  assert.equal(byName.parsed.bits, bits, name + ' key length');
  assert.equal(byName.parsed.mode, mode, name + ' mode');
  assert.equal(byName.parsed.mac, mac, name + ' hash');
  assert.equal(single(byName.hex).code, code, name + ' code round trip');
}

// ---- The whole registry: every row decodes to its own code, name, status and reference,
//      and the components match the independent Python grammar on the same name.
let compared = 0;
for (const [code, hex, name, , recommended, reference, expected] of fixture.rows) {
  const suite = single(hex);
  assert.equal(suite.code, code, hex + ' code');
  assert.equal(suite.name, name, hex + ' name');
  assert.equal(suite.recommended, recommended, hex + ' registry status');
  assert.equal(suite.reference, reference, hex + ' reference');
  assert.equal(single(name).code, code, name + ' name lookup');
  assert.equal(single(name.toLowerCase()).code, code, name + ' lower-case lookup');
  if (expected && expected.signaling) {
    assert.equal(suite.kind, 'signaling', hex + ' is signalling');
    assert.equal(suite.parsed, null, hex + ' decodes no components');
    continue;
  }
  assert.ok(suite.parsed, hex + ' ' + name + ' parses');
  for (const field of ['keyExchange', 'auth', 'cipher', 'bits', 'mode', 'aead', 'mac', 'forwardSecret', 'integrityOnly']) {
    assert.deepEqual(suite.parsed[field], expected[field], hex + ' ' + name + ' ' + field);
  }
  assert.equal(Boolean(suite.parsed.exportGrade), Boolean(expected.export), hex + ' ' + name + ' export grade');
  compared++;
}
assert.equal(compared, 356, '356 registry suites plus the two signalling values');

// ---- Grammar corners the registry exercises.
assert.equal(single('TLS_RSA_EXPORT_WITH_RC4_40_MD5').parsed.exportGrade, true, 'export-era suites are flagged');
assert.equal(single('TLS_RSA_EXPORT_WITH_RC4_40_MD5').parsed.bits, 40, 'export RC4 is 40 bits');
assert.equal(single('TLS_DH_anon_WITH_3DES_EDE_CBC_SHA').parsed.auth, 'none', 'anonymous suites authenticate nobody');
assert.equal(single('TLS_NULL_WITH_NULL_NULL').parsed.keyExchange, 'none (initial state)', 'the initial state suite');
assert.equal(single('TLS_RSA_WITH_AES_128_CCM').parsed.noHashInName, true, 'the CCM suites name no hash');
assert.equal(single('TLS_RSA_WITH_AES_128_CCM').parsed.mac, null, 'and report none');
assert.equal(single('TLS_SHA256_SHA256').parsed.integrityOnly, true, 'RFC 9150 integrity-only suite');
assert.equal(single('TLS_SHA256_SHA256').parsed.bits, 0, 'integrity-only carries no bulk key');
assert.equal(single('TLS_ECCPWD_WITH_AES_128_GCM_SHA256').parsed.auth, 'password', 'ECCPWD authenticates a password');
assert.equal(single('TLS_GOSTR341112_256_WITH_KUZNYECHIK_MGM_S').parsed.cipher, 'Kuznyechik', 'GOST suite');
assert.equal(single('TLS_PSK_DHE_WITH_AES_128_CCM_8').parsed.forwardSecret, true, 'PSK_DHE is ephemeral');

// ---- Codes: case, prefix and padding are all accepted; the value is hexadecimal.
for (const value of ['0x1301', '1301', '0X1301']) assert.equal(single(value).code, 0x1301, value + ' reads as hex');
assert.equal(single('c02f').hex, '0xC02F', 'lower-case hex is upper-cased in the output');
assert.equal(single('0x00ff').kind, 'signaling', 'the renegotiation SCSV is signalling');
assert.equal(single('0x5600').kind, 'signaling', 'the fallback SCSV is signalling');
assert.equal(single('0x0a0a').kind, 'grease', '0x0A0A is a GREASE value');
for (const grease of ['0x1a1a', '0x2a2a', '0xDADA', '0x3A3A', '0xFafa'.toLowerCase()]) {
  assert.equal(single(grease).kind, 'grease', grease + ' is GREASE');
}
assert.equal(single('0x1306').kind, 'suite', '0x1306 is a registered AEGIS suite, not GREASE');
assert.equal(single('0x1309').kind, 'unassigned', '0x1309 has no registry entry');

// ---- List mode: order is kept, each value costs two bytes, nothing is de-duplicated.
const list = C.analyze({ value: '1301, 1302\n1303\tc02f' });
assert.equal(list.mode, 'list');
assert.equal(list.count, 4);
assert.equal(list.bytes, 8);
assert.equal(JSON.stringify(list.suites.map((suite) => suite.hex)), JSON.stringify(['0x1301', '0x1302', '0x1303', '0xC02F']));
assert.equal(C.analyze({ value: 'TLS_AES_128_GCM_SHA256' }).mode, 'single', 'one value is single mode');
const many = C.analyze({ value: Array.from({ length: 32 }, (_, i) => '0x13' + (i + 1).toString(16).padStart(2, '0')).join(' ') });
assert.equal(many.count, 32, '32 values is the limit and is accepted');
assert.equal(many.bytes, 64, '32 suites take 64 bytes');

// ---- Validation: every refusal is the page's own sentence.
assert.equal(failure(''), C.MESSAGES.empty, 'empty input');
assert.equal(failure('   '), C.MESSAGES.empty, 'blank input');
assert.equal(failure('zzzz'), C.MESSAGES.unknown, 'not hexadecimal and not a name');
assert.equal(failure('0xZZZZ'), C.MESSAGES.unknown, 'hex prefix with bad digits');
assert.equal(failure('TLS_NOT_A_SUITE'), C.MESSAGES.unknown, 'unknown registry name');
assert.equal(failure('0x12345'), C.MESSAGES.unknown, 'five hex digits');
assert.equal(failure('1301,zzzz'), C.MESSAGES.unknown, 'one bad value refuses the list');
const tooMany = Array.from({ length: 33 }, (_, i) => '0x13' + (i + 1).toString(16).padStart(2, '0')).join(' ');
assert.equal(failure(tooMany), C.MESSAGES.tooMany, '33 values is one too many');

// ---- Status labels follow the registry's own column.
assert.equal(C.statusLabel('Y'), 'Recommended');
assert.equal(C.statusLabel('N'), 'Not recommended');
assert.equal(C.statusLabel('D'), 'Discouraged');
assert.equal(C.statusLabel(''), 'Not stated');

// ---- Page contract.
assert.match(html, /<div id="site-header"><\/div>/, 'shared header');
assert.match(html, /<form id="tls-form" novalidate>/, 'form');
assert.match(html, /<label class="f" for="suite">/, 'labelled input');
assert.match(html, /id="suite"[^>]*autocomplete="off"/, 'input does not autocomplete');
assert.match(html, /<div class="err" id="tls-err" role="alert" aria-live="polite">/, 'assertive error region');
assert.match(html, /<div class="out" id="tls-out" aria-live="polite" aria-atomic="true">/, 'polite result region');
assert.match(html, /min-height:44px/, 'touch targets');
assert.match(html, /@media \(max-width:420px\)/, 'narrow-screen layout');
assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/, 'no remote asset or citation link in the page body');
assert.doesNotMatch(html, /<script src="http/, 'no remote script');
assert.match(html, /<title>TLS Cipher Suite Decoder — Virtual Tools<\/title>/, 'title');
assert.equal(html.split('<script').length - 1, 4, 'theme bootstrap, shared app, core and UI');
assert.ok(html.indexOf('tls-core:start') < html.indexOf('tls-core:end'), 'markers in order');

console.log('tls cipher suite decoder: ' + compared + ' registry rows, ' + anchors.length + ' anchors, list, errors and page contract pass');
