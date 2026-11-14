/* Regression checks for the yEnc encoder/decoder core and its catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const slug = 'yenc-encoder-decoder';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* yenc-core:start */');
const end = html.indexOf('/* yenc-core:end */');
assert.ok(start > -1 && end > start, 'yenc core markers missing');
const core = html.slice(start, end + '/* yenc-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = YencCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];

const encode = (text, options) => C.encodeText(text, options);
const decode = (text) => C.decodeText(text);
const failure = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.message;
  }
  return null;
};
const bytes = (values) => new Uint8Array(values);

// --- Anchors a reviewer can check by hand. ---
assert.equal(C.hex32(C.crc32(C.utf8Encode('123456789'))), 'cbf43926', 'CRC-32 check value');
assert.equal(C.crc32(bytes([])), 0, 'empty CRC is zero');
assert.equal(C.crc32(bytes([0x00])), 0xD202EF8D, 'single NUL CRC');

const hello = encode('Hello', { name: '', lineLength: 128, headers: false });
assert.equal(hello.body, 'r\u008f\u0096\u0096\u0099', 'Hello shifts by 42');
assert.equal(hello.crc32, 'f7d18982');
const helloFull = encode('Hello', { name: 'h.txt', lineLength: 128, headers: true });
assert.equal(helloFull.output,
  '=ybegin line=128 size=5 name=h.txt\nr\u008f\u0096\u0096\u0099\n=yend size=5 crc32=f7d18982');

// Bytes 19, 214, 224, 227 are the values whose shifted characters are '=', NUL, LF and CR.
const escapes = C.encodeBytes(bytes([19, 214, 224, 227, 9, 32]), { lineLength: 128, headers: false });
assert.equal(escapes.output, '=}=@=J=M3J', 'escape pairs use character + 64');
assert.deepEqual(Array.from(decode(escapes.output).bytesRaw), [19, 214, 224, 227, 9, 32]);

// A space character (byte 246) at the start of a wrapped line must be escaped, mid-line it must not.
const leadingBytes = [...new Array(16).fill(0x41), 246, 0x42];
const leading = C.encodeBytes(bytes(leadingBytes), { lineLength: 16, headers: false });
assert.deepEqual(leading.body.split('\n'), ['k'.repeat(16), '=`l']);
assert.deepEqual(Array.from(decode(leading.output).bytesRaw), leadingBytes);

// --- Independent reference encoder: build the token stream, then chunk it. ---
const referenceEncode = (data, lineLength, name, headers) => {
  const special = (code) => code === 0 || code === 10 || code === 13 || code === 61;
  const escaped = (code) => '=' + String.fromCharCode((code + 64) & 0xFF);
  const lines = [];
  let current = '';
  for (const byte of data) {
    const code = (byte + 42) & 0xFF;
    let text = special(code) ? escaped(code) : String.fromCharCode(code);
    if (current !== '' && current.length + text.length > lineLength) {
      lines.push(current);
      current = '';
    }
    if (current === '' && (code === 9 || code === 32)) text = escaped(code);
    current += text;
  }
  if (current !== '') lines.push(current);
  const crc = zlib.crc32(Buffer.from(data)) >>> 0;
  const header = `=ybegin line=${lineLength} size=${data.length}${name ? ' name=' + name : ''}`;
  const trailer = `=yend size=${data.length} crc32=${crc.toString(16).padStart(8, '0')}`;
  const body = lines.join('\n');
  return headers ? `${header}\n${body}\n${trailer}` : body;
};

let seed = 987654321;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 8; };
let compared = 0;
for (let n = 0; n < 240; n += 1) {
  const length = n % 17 === 0 ? 0 : 1 + (rand() % 400);
  const data = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) data[i] = rand() & 0xFF;
  const lineLength = [16, 32, 64, 76, 128, 256, 998][n % 7];
  const headers = n % 3 !== 0;
  const name = n % 2 ? `r${n}.bin` : '';
  const encoded = C.encodeBytes(data, { lineLength, headers, name });
  assert.equal(encoded.output, referenceEncode(data, lineLength, name, headers), `reference mismatch at case ${n}`);
  if (headers) assert.equal(encoded.output, `=ybegin line=${lineLength} size=${length}${name ? ' name=' + name : ''}\n${encoded.body}\n=yend size=${length} crc32=${encoded.crc32}`);
  for (const line of encoded.body.split('\n')) {
    if (line === '') continue;
    assert.ok(line.length <= lineLength, `line over limit at case ${n}`);
    assert.ok(!line.endsWith('='), `escape split at line end, case ${n}`);
  }
  const back = C.decodeText(encoded.output);
  assert.equal(Buffer.from(back.bytesRaw).toString('hex'), Buffer.from(data).toString('hex'), `round trip at case ${n}`);
  assert.equal(back.crc32, (zlib.crc32(Buffer.from(data)) >>> 0).toString(16).padStart(8, '0'), `crc at case ${n}`);
  if (headers) {
    assert.equal(back.crcMatch, true, `crc verification at case ${n}`);
    assert.equal(back.sizeMatch, true, `size verification at case ${n}`);
  } else {
    assert.equal(back.crcMatch, null, `body-only must not claim a trailer at case ${n}`);
  }
  compared += 1;
}
assert.ok(compared >= 200, `reference comparison too small: ${compared}`);

// --- Decoder structure and edge handling. ---
const textSample = 'Line one\nLine two with \u0000 and = and\t\u00e9 \ud83d\ude80';
const textBlock = encode(textSample, { name: 'note.txt', lineLength: 64, headers: true });
const textBack = decode(textBlock.output);
assert.equal(textBack.text, textSample);
assert.equal(textBack.crcMatch, true);
assert.equal(textBack.bytes, Buffer.byteLength(textSample, 'utf8'));

const posted = 'From: a@b.invalid\nSubject: [1/1] note.txt\n\n' + textBlock.output + '\n\n-- \nsignature\n';
assert.equal(decode(posted).text, textSample, 'article preamble and signature ignored');

const crlf = decode(textBlock.output.replace(/\n/g, '\r\n'));
assert.equal(crlf.text, textSample, 'CRLF accepted');
assert.equal(crlf.crcMatch, true);

const partBody = C.encodeBytes(new Uint8Array([1, 2, 3, 4]), { lineLength: 32, headers: false }).output;
const partBlock = `=ybegin line=32 size=8 name=p.bin\n=ypart begin=1 end=4\n${partBody}\n=yend size=4 crc32=${C.hex32(C.crc32(bytes([1, 2, 3, 4])))}`;
const part = decode(partBlock);
assert.equal(part.partCount, 1);
assert.equal(part.crcMatch, true);
assert.deepEqual(Array.from(part.bytesRaw), [1, 2, 3, 4]);

const badCrc = decode(textBlock.output.replace(/crc32=[0-9a-f]{8}/, 'crc32=00000000'));
assert.equal(badCrc.crcMatch, false);
assert.equal(badCrc.warningCount, 1);
assert.match(badCrc.warnings[0], /does not match/);

const badSize = decode(textBlock.output.replace(/\n=yend size=\d+/, '\n=yend size=999'));
assert.equal(badSize.sizeMatch, false);
assert.equal(badSize.warningCount, 1);
assert.match(badSize.warnings[0], /decodes to/);

const upper = decode(textBlock.output.replace(/crc32=([0-9a-f]{8})/, (m, h) => 'crc32=' + h.toUpperCase()));
assert.equal(upper.crcMatch, true);
assert.equal(upper.crcExpected, textBack.crc32);

const binary = C.encodeBytes(new Uint8Array([0xff, 0xfe, 0x41]), { lineLength: 128, headers: true }).output;
const binaryBack = decode(binary);
assert.equal(binaryBack.validUtf8, false);
assert.equal(binaryBack.warningCount, 1);
assert.match(binaryBack.warnings[0], /not valid UTF-8/);
assert.equal(binaryBack.text, '\uFFFD\uFFFDA');

assert.equal(decode('').bytes, 0, 'empty input decodes to no bytes');
assert.equal(decode('\n\n').bytes, 0, 'blank lines carry no payload');
assert.equal(decode('ab').bytes, 2, 'a bare body decodes without headers');
assert.equal(decode('ab').hasHeaders, false);

// --- Refusals. ---
const refusals = [
  [() => encode('x', { lineLength: 15 }), 'Line length must be a whole number from 16 to 998 characters.'],
  [() => encode('x', { lineLength: 999 }), 'Line length must be a whole number from 16 to 998 characters.'],
  [() => encode('x', { lineLength: 12.5 }), 'Line length must be a whole number from 16 to 998 characters.'],
  [() => encode('x', { lineLength: 'many' }), 'Line length must be a whole number from 16 to 998 characters.'],
  [() => encode('x', { name: 'my file.txt' }), 'The file name cannot contain spaces: yEnc header attributes are space-separated.'],
  [() => encode('x', { name: 'a\nb' }), 'The file name cannot contain a line break.'],
  [() => encode('x', { name: 'n'.repeat(121) }), 'The file name is limited to 120 characters.'],
  [() => encode('a'.repeat(C.MAX_CHARS + 1), {}), 'The text is too large for this page (limit 100,000 characters).'],
  [() => decode('a'.repeat(C.MAX_CHARS * 2 + 1)), 'The yEnc input is too large for this page (over 200,000 characters).'],
  [() => decode('=ybegin line=128 size=5 name=x\nabc=\n=yend size=5 crc32=00000000'),
    'Line 2: the escape "=" is the last character on the line; yEnc escapes are always two characters and cannot be split.'],
  [() => decode('=ybegin line=128 size=1 name=x\n\u20ac\n=yend size=1 crc32=00000000'),
    'Line 2: character "\u20ac" is outside the single-byte range that yEnc bodies use.'],
  [() => decode('=ybegin line=128 size=1 name=x\n=\u20ac\n=yend size=1 crc32=00000000'),
    'Line 2: the escaped character is outside the single-byte range that yEnc bodies use.'],
];
for (const [fn, message] of refusals) assert.equal(failure(fn), message);

// --- Catalog case replay. ---
assert.ok(Array.isArray(entry.testCases) && entry.testCases.length > 0, 'catalog cases missing');
let golden = 0;
let boundary = 0;
let validation = 0;
for (const testCase of entry.testCases) {
  const input = testCase.input;
  if (testCase.kind === 'validation') {
    validation += 1;
    const run = input.mode === 'encode'
      ? () => encode(input.text, { name: input.name, lineLength: input.lineLength, headers: input.headers })
      : () => decode(input.text);
    assert.equal(failure(run), testCase.expectedError, `${testCase.name}: wrong message`);
    continue;
  }
  if (testCase.kind === 'golden') golden += 1;
  else if (testCase.kind === 'boundary') boundary += 1;
  else assert.fail(`${testCase.name}: unknown kind ${testCase.kind}`);
  const actual = input.mode === 'encode'
    ? encode(input.text, { name: input.name, lineLength: input.lineLength, headers: input.headers })
    : decode(input.text);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (expected === null) assert.equal(actual[key], null, `${testCase.name} ${key}`);
    else assert.equal(actual[key], expected, `${testCase.name} ${key}`);
  }
}
assert.equal(golden, 8);
assert.equal(boundary, 7);
assert.equal(validation, 10);
assert.equal(entry.testCases.length, 25);

// --- Static offline, accessibility and DOM-wiring contract. ---
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|navigator\.clipboard/.test(html), 'no network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'no remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote styles');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(!/\beval\(|new Function/.test(html), 'no dynamic code evaluation');
assert.ok(html.includes('<form id="encode-form"'), 'encode form missing');
assert.ok(html.includes('<form id="decode-form"'), 'decode form missing');
assert.ok(html.includes('aria-live="polite"'), 'live result missing');
assert.ok(html.includes('role="status"'), 'status role missing');
assert.ok(html.includes('@media(max-width:600px)'), 'mobile breakpoint missing');
assert.ok(html.includes('min-height:44px'), '44 px controls required');
assert.ok(html.includes('max-width:none'), 'text inputs must escape the shared 720 px cap');
for (const id of ['encode-input', 'decode-input', 'file-name', 'line-length', 'headers',
  'encode', 'decode', 'encode-output', 'decode-output', 'encode-status', 'decode-status',
  'encode-detail', 'decode-detail', 'decode-warnings', 'decode-result', 'encode-result']) {
  assert.ok(html.includes(`id="${id}"`), `element ${id} missing`);
}
for (const id of ['encode-input', 'decode-input', 'file-name', 'line-length', 'encode-output', 'decode-output']) {
  assert.ok(html.includes(`for="${id}"`), `label ${id} missing`);
}
const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate HTML id');
for (const match of html.matchAll(/getElementById\('([^']+)'\)|\$\('([^']+)'\)/g)) {
  const id = match[1] || match[2];
  assert.ok(ids.includes(id), `script references missing id ${id}`);
}
assert.ok(html.includes('src="/assets/theme-init.js"'), 'theme bootstrap missing');
assert.ok(html.includes('href="/assets/style.css"'), 'shared stylesheet missing');
assert.ok(html.includes('src="/assets/tools.js"') && html.includes('src="/assets/app.js"'), 'shared scripts missing');
assert.ok(html.includes('value="message.txt"'), 'file name default missing');
assert.ok(html.includes('<option value="128" selected>'), 'line length default missing');
assert.ok(html.includes('id="headers" checked'), 'header checkbox must default on');

// --- Catalog record contract. ---
assert.equal(entry.name, 'yEnc Encoder / Decoder');
assert.equal(entry.category, 'Encoding');
assert.equal(entry.subcategory, 'General');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.ok(entry.sources.length >= 3, 'at least three sources');
assert.ok(entry.method.includes('42') && entry.method.includes('106') && entry.method.includes('CRC-32')
  && entry.method.includes('browser'), 'method must state the shift, the inverse, the checksum and local execution');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.equal(catalog.tools.length, 2271);
const allAliases = new Map();
for (const tool of catalog.tools) {
  for (const alias of tool.aliases || []) {
    const key = alias.toLowerCase();
    if (!allAliases.has(key)) allAliases.set(key, new Set());
    allAliases.get(key).add(tool.slug);
  }
}
for (const alias of entry.aliases) {
  const owners = allAliases.get(alias.toLowerCase());
  assert.deepEqual([...owners], [slug], `alias ${alias} must belong only to ${slug}`);
}
for (const value of [entry.slug, entry.name]) {
  const key = value.toLowerCase();
  const clash = catalog.tools.filter((tool) => tool.slug !== slug
    && (tool.slug.toLowerCase() === key || tool.name.toLowerCase() === key));
  assert.equal(clash.length, 0, `${value} clashes with ${clash.map((tool) => tool.slug).join(', ')}`);
}

console.log(`yenc: ${compared} reference cases, ${golden} golden, ${boundary} boundary, ${validation} validation checks passed`);
