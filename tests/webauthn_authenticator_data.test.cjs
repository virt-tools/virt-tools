/* Regression checks for the WebAuthn authenticator data inspector core, its catalog
   cases, an independent structure builder and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'webauthn-authenticator-data';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* wa-core:start */');
const end = html.indexOf('/* wa-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + '/* wa-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = WebAuthnAuthData;', sandbox);
const C = sandbox.module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const parse = (data, encoding) => plain(C.parse({ data, encoding }));
const failure = (data, encoding) => {
  try {
    C.parse({ data, encoding });
  } catch (error) {
    return error.message;
  }
  return null;
};

const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const hex = (bytes) => Buffer.from(bytes).toString('hex');

// Independent builder: the byte layout comes from the specification, not from the page.
const head = (major, count) => {
  if (count < 24) return [(major << 5) | count];
  if (count < 256) return [(major << 5) | 24, count];
  if (count < 65536) return [(major << 5) | 25, (count >> 8) & 0xff, count & 0xff];
  throw new Error('fixture length too large');
};
const intItem = (value) => (value >= 0 ? head(0, value) : head(1, -1 - value));
const bytesItem = (bytes) => head(2, bytes.length).concat(bytes);
const mapItem = (pairs) => pairs.reduce((out, [key, value]) => out.concat(intItem(key), value), head(5, pairs.length));
const trueItem = (flag) => [flag ? 0xf5 : 0xf4];

const UP = 0x01, RFU1 = 0x02, UV = 0x04, BE = 0x08, BS = 0x10, RFU2 = 0x20, AT = 0x40, ED = 0x80;
const KEY_NAMES = { 1: 'OKP', 2: 'EC2', 3: 'RSA', 4: 'Symmetric' };
const ALG_NAMES = { '-7': 'ES256', '-8': 'EdDSA', '-257': 'RS256' };
const CURVE_NAMES = { 1: 'P-256', 6: 'Ed25519' };

function buildStructure(spec) {
  const bytes = spec.rpIdHash.slice();
  bytes.push(spec.flags);
  bytes.push((spec.signCount >>> 24) & 0xff, (spec.signCount >>> 16) & 0xff,
    (spec.signCount >>> 8) & 0xff, spec.signCount & 0xff);
  if (spec.flags & AT) {
    const key = mapItem([
      [1, intItem(spec.kty)],
      [3, intItem(spec.alg)],
      ...(spec.crv === null ? [] : [[-1, intItem(spec.crv)]]),
      [-2, bytesItem(spec.keyMaterial)],
    ]);
    bytes.push(...spec.aaguid);
    bytes.push((spec.credentialId.length >>> 8) & 0xff, spec.credentialId.length & 0xff);
    bytes.push(...spec.credentialId);
    bytes.push(...key);
    spec.keyLength = key.length;
  }
  if (spec.flags & ED) {
    const extensions = head(5, spec.extensions.length)
      .concat(...spec.extensions.map((entry) => intItem(entry[0]).concat(trueItem(entry[1]))));
    bytes.push(...extensions);
    spec.extensionLength = extensions.length;
  }
  return bytes;
}

function expectedFor(spec, bytes) {
  const warnings = [];
  if (!(spec.flags & UP)) warnings.push('User Present (UP, 0x01) is clear; a relying party rejects an assertion without user presence.');
  if (spec.flags & (RFU1 | RFU2)) warnings.push('A reserved flag bit (0x02 or 0x20) is set; the specification requires both to be zero.');
  if ((spec.flags & BS) && !(spec.flags & BE)) warnings.push('Backup State (BS, 0x10) is set without Backup Eligibility (BE, 0x08); the specification allows BS only on a backup-eligible credential.');
  if (spec.signCount === 0) warnings.push('The signature counter is 0; authenticators without a counter leave it at zero, so it cannot show clone detection here.');
  const aaguidHex = Buffer.from(spec.aaguid).toString('hex');
  return {
    byteLength: bytes.length,
    rpIdHash: Buffer.from(spec.rpIdHash).toString('hex'),
    flagsByte: spec.flags,
    flags: {
      up: Boolean(spec.flags & UP), rfu1: Boolean(spec.flags & RFU1), uv: Boolean(spec.flags & UV),
      be: Boolean(spec.flags & BE), bs: Boolean(spec.flags & BS), rfu2: Boolean(spec.flags & RFU2),
      at: Boolean(spec.flags & AT), ed: Boolean(spec.flags & ED),
    },
    signCount: spec.signCount,
    attested: (spec.flags & AT) ? {
      aaguid: `${aaguidHex.slice(0, 8)}-${aaguidHex.slice(8, 12)}-${aaguidHex.slice(12, 16)}-${aaguidHex.slice(16, 20)}-${aaguidHex.slice(20, 32)}`,
      aaguidHex,
      credentialIdLength: spec.credentialId.length,
      credentialId: Buffer.from(spec.credentialId).toString('hex'),
      publicKeyLength: spec.keyLength,
      keyType: spec.kty,
      keyTypeName: KEY_NAMES[spec.kty],
      algorithm: spec.alg,
      algorithmName: ALG_NAMES[String(spec.alg)],
      curve: spec.crv,
      curveName: spec.crv === null ? null : CURVE_NAMES[spec.crv],
    } : null,
    extensions: (spec.flags & ED) ? { length: spec.extensionLength, entries: spec.extensions.length } : null,
    trailingBytes: 0,
    warnings,
  };
}

// Differential check over generated structures, both encodings, with and without AT/ED.
let state = 20261122;
const random = () => {
  state = (state * 1103515245 + 12345) % 2147483648;
  return state / 2147483648;
};
const int = (max) => Math.floor(random() * (max + 1));
const randomBytes = (count) => Array.from({ length: count }, () => int(255));
for (let trial = 0; trial < 200; trial += 1) {
  let flags = UP | (random() < 0.7 ? UV : 0);
  if (random() < 0.4) flags |= BE;
  if ((flags & BE) && random() < 0.6) flags |= BS;
  if (random() < 0.35) flags |= RFU1;
  if (random() < 0.25) flags |= RFU2;
  if (random() < 0.7) flags |= AT;
  if (random() < 0.6) flags |= ED;
  const kty = [1, 2, 3][int(2)];
  const alg = [1, 2, 3][int(2)] === 1 ? -7 : ([1, 2, 3][int(2)] === 2 ? -257 : -8);
  const spec = {
    rpIdHash: randomBytes(32),
    flags,
    signCount: int(0xffffffff),
    aaguid: randomBytes(16),
    credentialId: randomBytes(1 + int(63)),
    kty,
    alg,
    crv: kty === 1 ? 6 : (kty === 2 ? 1 : null),
    keyMaterial: randomBytes(32 + int(32)),
    extensions: Array.from({ length: int(3) }, (_, index) => [index + 1, random() < 0.5]),
  };
  if (spec.signCount === 0) spec.signCount = 0;
  const bytes = buildStructure(spec);
  const expected = expectedFor(spec, bytes);
  const encoding = random() < 0.5 ? 'base64url' : 'hex';
  const text = encoding === 'base64url' ? b64(bytes) : hex(bytes);
  const label = 'trial ' + trial + ' (' + encoding + ')';
  const actual = parse(text, encoding);
  assert.deepEqual(actual, expected, label);
}

// Truncation and garbage sweeps: every rejection is a page message, never a crash.
for (let trial = 0; trial < 120; trial += 1) {
  const spec = {
    rpIdHash: randomBytes(32),
    flags: UP | AT | ED,
    signCount: trial,
    aaguid: randomBytes(16),
    credentialId: randomBytes(1 + int(8)),
    kty: 2,
    alg: -7,
    crv: 1,
    keyMaterial: randomBytes(32),
    extensions: [[1, true]],
  };
  const bytes = buildStructure(spec);
  const cut = 38 + int(bytes.length - 39);
  const message = failure(b64(bytes.slice(0, cut)), 'base64url');
  assert.ok(message, 'truncated structure at ' + cut + ' is refused');
  assert.match(message, /\.$/, 'message reads as a sentence: ' + message);
}

for (let trial = 0; trial < 120; trial += 1) {
  const bytes = randomBytes(30 + int(120));
  const message = failure(b64(bytes), 'base64url');
  if (message) {
    assert.match(message, /\.$/, 'garbage message reads as a sentence: ' + message);
  } else {
    const result = parse(b64(bytes), 'base64url');
    assert.equal(result.trailingBytes, 0, 'an accepted random prefix has no leftovers');
  }
}

// Boundaries.
assert.equal(parse(hex(new Array(37).fill(0)), 'hex').byteLength, 37, 'the 37-byte header parses');
assert.equal(failure(hex(new Array(36).fill(0)), 'hex'),
  'Authenticator data is at least 37 bytes: a 32-byte RP ID hash, a flags byte and a 4-byte signature counter.');
assert.equal(failure('00'.repeat(4097), 'hex'), 'Authenticator data is larger than the 4,096-byte limit.');
assert.match(failure('00'.repeat(4096), 'hex'), /trailing bytes/, '4,096 bytes pass the size check');
assert.equal(failure('A'.repeat(12289), 'base64url'),
  'Enter no more than 12,288 characters of authenticator data.');
assert.equal(failure('A'.repeat(12288), 'base64url'),
  'Authenticator data is larger than the 4,096-byte limit.');
assert.equal(failure('AAAA', 'raw'), 'Choose how the data is encoded.');

const wideId = Array.from({ length: 1023 }, (_, index) => index & 0xff);
const wideSpec = { rpIdHash: randomBytes(32), flags: UP | AT, signCount: 1, aaguid: randomBytes(16),
  credentialId: wideId, kty: 2, alg: -7, crv: 1, keyMaterial: randomBytes(32) };
const wideBytes = buildStructure(wideSpec);
assert.equal(parse(b64(wideBytes), 'base64url').attested.credentialIdLength, 1023, '1,023-byte credential ID');
const tooWide = buildStructure({ ...wideSpec, credentialId: wideId.concat([0]) });
assert.equal(failure(b64(tooWide), 'base64url'),
  'The credential ID length (1024 bytes) must be from 1 to 1,023 bytes.');
const zeroBytes = wideBytes.slice(0, 37).concat(Array.from(wideSpec.aaguid)).concat([0, 0]);
assert.equal(failure(b64(zeroBytes), 'base64url'), 'The credential ID length (0 bytes) must be from 1 to 1,023 bytes.');

// A key that is a plain integer, a key without alg, and an unknown algorithm.
const keyPrefix = randomBytes(32).concat([UP | AT, 0, 0, 0, 2], randomBytes(16), [0, 2, 1, 2]);
const keyInt = parse(b64(keyPrefix.concat([0x05])), 'base64url');
assert.equal(keyInt.attested.keyType, null, 'a non-map key has no kty');
assert.equal(keyInt.warnings.length, 3, 'a non-map key warns three times');

const noAlgKey = mapItem([[1, intItem(2)], [-1, intItem(1)], [-2, bytesItem(randomBytes(32))]]);
const noAlg = parse(b64(keyPrefix.concat(noAlgKey)), 'base64url');
assert.equal(noAlg.attested.algorithm, null);
assert.equal(noAlg.attested.keyType, 2);
assert.ok(noAlg.warnings.some((line) => line.includes('no alg parameter')), 'missing alg is reported');

const oddAlgBytes = keyPrefix.concat(mapItem([[1, intItem(2)], [3, intItem(-1000)]]));
assert.equal(parse(b64(oddAlgBytes), 'base64url').attested.algorithmName, 'unknown', 'unnamed algorithms stay numeric');

// CBOR limits: indefinite length and excessive nesting.
const indefinite = keyPrefix.concat([0xbf, 0x01, 0x02, 0xff]);
assert.equal(failure(b64(indefinite), 'base64url'),
  'The credential public key uses an indefinite-length CBOR item, which this inspector does not read.');
let nested = [0x05];
for (let level = 0; level < 20; level += 1) nested = head(4, 1).concat(nested);
assert.equal(failure(b64(keyPrefix.concat(nested)), 'base64url'),
  'The credential public key is nested more than 16 CBOR levels deep.');

// The page's prefilled sample.
const sample = html.match(/<textarea id="data"[^>]*>([^<]+)<\/textarea>/)[1].trim();
const sampleResult = parse(sample, 'base64url');
assert.equal(sampleResult.byteLength, 167, 'the sample is 167 bytes');
assert.equal(sampleResult.flagsByte, 0xc5);
assert.equal(sampleResult.signCount, 1234);
assert.equal(sampleResult.attested.aaguid, '00112233-4455-6677-8899-aabbccddeeff');
assert.equal(sampleResult.attested.algorithmName, 'ES256');
assert.deepEqual(sampleResult.extensions, { length: 3, entries: 1 });
assert.equal(sampleResult.warnings.length, 0);

// The catalog record and every published case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record');
assert.equal(record.name, 'WebAuthn Authenticator Data Inspector');
assert.equal(record.category, 'Security');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1FAAA}');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.description.length < 260, 'description stays short');
assert.ok(record.method.length > 900, 'method documents the layout');
for (const phrase of ['at least 37 bytes', '0x40', '1,023', 'CBOR', 'does not verify', 'no storage, uploads']) {
  assert.ok(record.method.includes(phrase), 'method mentions ' + phrase);
}
assert.equal(record.sources.length, 2, 'two published sources');
assert.equal(record.sources[0].url, 'https://www.w3.org/TR/webauthn-3/');
assert.equal(record.sources[1].url, 'https://www.iana.org/assignments/cose/cose.xhtml');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.tags.includes('webauthn'));
assert.ok(record.aliases.includes('Authenticator Data Decoder'));
assert.equal(catalog.tools.length, 2460, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2199, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Security').length, 55, 'Security count');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'no rival record');
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  assert.notEqual(tool.name.toLowerCase(), record.name.toLowerCase(), 'duplicate name: ' + tool.slug);
  const aliases = new Set((tool.aliases || []).map((alias) => alias.trim().toLowerCase()));
  for (const alias of record.aliases) {
    assert.ok(!aliases.has(alias.trim().toLowerCase()), `alias ${alias} clashes with ${tool.slug}`);
  }
  const words = [tool.slug, tool.name, ...(tool.aliases || []), ...(tool.tags || [])].join(' ').toLowerCase();
  assert.ok(!/webauthn|aaguid|passkey|fido/.test(words), 'no rival authenticator-data tool: ' + tool.slug);
}

assert.equal(record.testCases.length, 27, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 9);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 3);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 15);
for (const testCase of record.testCases) {
  assert.ok(testCase.name && testCase.kind && testCase.input, 'catalog case shape');
  assert.ok(['base64url', 'hex', 'raw'].includes(testCase.input.encoding), 'catalog case encoding');
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input.data, testCase.input.encoding), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = parse(testCase.input.data, testCase.input.encoding);
  assert.deepEqual(actual, testCase.expected, testCase.name);
}

// Page contract: no network, storage or external assets; labelled, typed controls.
assert.match(html, /<h1>WebAuthn Authenticator Data Inspector<\/h1>/);
assert.match(html, /<meta name="description" content="[^"]{80,}"/);
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/app.js'));
assert.ok(!/https?:\/\//.test(html), 'no absolute URLs');
assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\b/.test(html),
  'no network or storage');
assert.ok(!/<(?:img|iframe|link[^>]+href="https?:)/.test(html), 'no remote media');
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('role="alert"'));
assert.equal((html.match(/<label\b/g) || []).length, 2, 'every control is labelled');
assert.ok(html.includes('<textarea id="data"'), 'the bytes are a textarea');
assert.ok(html.includes('<select id="encoding"'), 'the encoding is a select');
assert.equal((html.match(/<button\b/g) || []).length, 2);
assert.equal((html.match(/type="(?:(?:button)|(?:submit))"/g) || []).length, 2, 'buttons declare a type');
assert.ok(html.includes('overflow-x:auto'), 'the flag table scrolls inside its own box');
assert.ok(html.includes('<th scope="col">Flag</th>'), 'the table labels its columns');
console.log('webauthn authenticator data inspector: all checks passed');
