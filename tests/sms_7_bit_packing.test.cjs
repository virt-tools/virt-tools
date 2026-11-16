/* SMS 7-bit packing: the default alphabet and extension table, septet packing
   against an independent model, the filler carriage return, decoding, segment
   arithmetic, validation messages, the catalog record and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'sms-7-bit-packing';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* sms-core:start */';
const endMarker = '/* sms-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SmsCore;', sandbox);
const C = sandbox.module.exports;

const failure = (fn) => {
  try { fn(); } catch (error) { return error.message; }
  return null;
};
const flat = (result) => result.hex.replace(/ /g, '');

// ---- Alphabet and extension table, checked against the 3GPP table.
assert.equal(C.ALPHABET.length, 128, 'the default alphabet holds 128 septets');
assert.equal(C.ALPHABET[0x00], '@');
assert.equal(C.ALPHABET[0x01], '\u00a3');
assert.equal(C.ALPHABET[0x02], '$');
assert.equal(C.ALPHABET[0x09], '\u00c7');
assert.equal(C.ALPHABET[0x0a], '\n');
assert.equal(C.ALPHABET[0x0d], '\r');
assert.equal(C.ALPHABET[0x1b], '\u001b');
assert.equal(C.ALPHABET[0x20], ' ');
assert.equal(C.ALPHABET[0x24], '\u00a4');
assert.equal(C.ALPHABET[0x40], '\u00a1');
assert.equal(C.ALPHABET[0x41], 'A');
assert.equal(C.ALPHABET[0x5b], '\u00c4');
assert.equal(C.ALPHABET[0x5f], '\u00a7');
assert.equal(C.ALPHABET[0x60], '\u00bf');
assert.equal(C.ALPHABET[0x7a], 'z');
assert.equal(C.ALPHABET[0x7f], '\u00e0');
assert.equal(C.ALPHABET.filter((character) => character === 'Q').length, 1, 'no duplicate symbols');
assert.equal(C.EXTENSION['\u000c'], 0x0a, 'form feed is an extension character');
assert.equal(C.EXTENSION['^'], 0x14);
assert.equal(C.EXTENSION['{'], 0x28);
assert.equal(C.EXTENSION['}'], 0x29);
assert.equal(C.EXTENSION['\\'], 0x2f);
assert.equal(C.EXTENSION['['], 0x3c);
assert.equal(C.EXTENSION['~'], 0x3d);
assert.equal(C.EXTENSION[']'], 0x3e);
assert.equal(C.EXTENSION['|'], 0x40);
assert.equal(C.EXTENSION['\u20ac'], 0x65);
assert.equal(Object.keys(C.EXTENSION).length, 10, 'ten extension characters');
assert.equal(C.ESCAPE, 0x1b);
assert.equal(C.FILLER, 0x0d);
assert.equal(C.SINGLE_SEPTETS, 160);
assert.equal(C.PART_SEPTETS, 153);
assert.equal(C.SINGLE_OCTETS, 140);

// ---- Septet mapping.
assert.equal(C.septetsOf('@').septets.join(','), '0');
assert.equal(C.septetsOf('A').septets.join(','), '65');
assert.equal(C.septetsOf('hello').septets.join(','), '104,101,108,108,111');
assert.equal(C.septetsOf('\u20ac').septets.join(','), '27,101');
assert.equal(C.septetsOf('\u20ac').extension, 1, 'the euro sign costs two septets');
assert.equal(C.septetsOf('hellohello').septets.length, 10);
assert.equal(C.septetsOf('hellohello').characters, 10);

// ---- The published example: hellohello packs to E8329BFD4697D9EC37.
assert.equal(flat(C.encode('hellohello')), 'E8329BFD4697D9EC37');
assert.equal(flat(C.encode('hello')), 'E8329BFD06');
assert.equal(flat(C.encode('@')), '00');
assert.equal(flat(C.encode('@@@@')), '00000000');
assert.equal(flat(C.encode('\u20ac100')), '9B720C0603');
assert.equal(flat(C.encode('a\u20acb')), 'E14D590C');

// ---- Packing identities, pinned from an independent bit-serial model.
const pinned = [
  ['Hello, world!', 'C8329BFD6681EE6F399B1C02', 13, 12],
  ['0123456789', 'B0986C46ABD96EB81C', 10, 9],
  ['\u00a3\u00a5\u00e8\u00e9\u00f9\u00ec\u00f2\u00c7', '8101A160382012', 8, 7],
  ['\u0394\u03a6\u0393\u039b\u03a9\u03a0\u03a8\u03a3\u0398\u039e', '10C98452B15C30190D', 10, 9],
  ['[]{}|^~\\', '1BDEC6B7416D521BE086B2E96D5E', 16, 14],
  ['\u00c4\u00d6\u00d1\u00dc\u00a7\u00bf\u00e4\u00f6\u00f1\u00fc\u00e0', '5B6ED7FB05EFF97DFF1F', 11, 10],
  ['Line one\nLine two\r\n', 'CCB4BB0C7ABBCB0A66DA5D06D1EFEF8602', 19, 17],
];
for (const [text, hex, septets, octets] of pinned) {
  const result = C.encode(text);
  assert.equal(flat(result), hex, 'packed hex for ' + JSON.stringify(text));
  assert.equal(result.septets, septets, 'septet count for ' + JSON.stringify(text));
  assert.equal(result.octets.length, octets, 'octet count for ' + JSON.stringify(text));
  const back = C.decode(result.hex, String(result.septets));
  assert.equal(back.text, text, 'round trip for ' + JSON.stringify(text));
}

// ---- Octet count always equals ceil(septets * 7 / 8), filler included.
for (let count = 1; count <= 200; count += 1) {
  const result = C.encode('x'.repeat(count));
  assert.equal(result.octets.length, Math.ceil(count * 7 / 8), 'octets for ' + count + ' septets');
  assert.equal(result.septets, count, 'septets for ' + count + ' characters');
}

// ---- The seven-spare-bit filler is carriage return, not zero.
const seven = C.encode('hello!!');
assert.equal(seven.septets, 7);
assert.equal(seven.octets.length, 7);
assert.equal(C.unpack(seven.octets, 8)[7], 0x0d, 'the filler septet is carriage return');
assert.equal(C.encode('hello!!').hex, seven.hex, 'packing is deterministic');

// ---- Decoding reads the filler back out, and an explicit count keeps it.
const auto = C.decode('E8 32 9B FD 0E 85 1A', '');
assert.equal(auto.text, 'hello!!');
assert.equal(auto.septets, 7);
assert.equal(auto.filler, true);
const explicit = C.decode('E8 32 9B FD 0E 85 1A', '8');
assert.equal(explicit.text, 'hello!!\r');
assert.equal(explicit.filler, false);
assert.equal(C.decode('e8 32 9b fd 46 97 d9 ec 37', '').text, 'hellohello', 'hex is case-insensitive');
assert.equal(C.decode('E8329BFD4697D9EC37', '').text, 'hellohello', 'spaces are optional');
assert.equal(C.decode('9B 32', '2').text, '\u20ac', 'the euro sign decodes from its two septets');
assert.equal(C.decode('9B 32', '2').extension, 1);
assert.equal(flat(C.encode('\u20ac')), '9B32', 'the euro sign packs to an escape and its extension code');

// ---- Segment arithmetic.
const spans = [[0, 1, 160], [1, 1, 160], [160, 1, 160], [161, 2, 306], [306, 2, 306], [307, 3, 459]];
for (const [septets, parts, capacity] of spans) {
  const span = C.partsFor(septets);
  assert.equal(span.parts, parts, 'parts for ' + septets + ' septets');
  assert.equal(span.capacity, capacity, 'capacity for ' + septets + ' septets');
}
const full = C.encode('x'.repeat(160));
assert.equal(full.parts, 1);
assert.equal(full.remaining, 0);
assert.equal(full.octets.length, 140, '160 septets fill the 140-octet payload');
const over = C.encode('x'.repeat(161));
assert.equal(over.parts, 2);
assert.equal(over.remaining, 145);
assert.equal(over.octets.length, 141);
const extended = C.encode('\u20ac'.repeat(10));
assert.equal(extended.characters, 10, 'ten typed characters');
assert.equal(extended.septets, 20, 'twenty septets');
assert.equal(extended.extension, 10, 'ten extension characters');

// ---- Validation messages, exactly as the page shows them.
assert.equal(failure(() => C.encode('')), 'Type a message to encode.');
assert.equal(failure(() => C.encode('x'.repeat(1001))), 'Enter at most 1000 characters.');
assert.equal(failure(() => C.encode('a \u2014 b')),
  '\u201c\u2014\u201d is not in the GSM 7-bit alphabet (character 3). Remove it, or send the message as UCS-2.');
assert.equal(failure(() => C.encode('\ud83d\ude00')),
  '\u201c\ud83d\ude00\u201d is not in the GSM 7-bit alphabet (character 1). Remove it, or send the message as UCS-2.');
assert.equal(failure(() => C.decode('', '')), 'Enter the packed user data as hex.');
assert.equal(failure(() => C.decode('E8 3', '')), 'A packed message needs an even number of hex digits.');
assert.equal(failure(() => C.decode('ZZ', '')), 'Use only the hex digits 0-9 and A-F.');
assert.equal(failure(() => C.decode('00', 'abc')), 'Enter a septet count from 1 to 320, or leave it blank.');
assert.equal(failure(() => C.decode('00', '0')), 'Enter a septet count from 1 to 320, or leave it blank.');
assert.equal(failure(() => C.decode('00', '321')), 'Enter a septet count from 1 to 320, or leave it blank.');
assert.equal(failure(() => C.decode('00', '3')), 'The packed data holds 1 septet; lower the septet count.');
assert.equal(failure(() => C.decode('1B', '1')), 'The data ends with an escape septet and no extension code.');
assert.equal(failure(() => C.decode('1B 00', '2')), 'Extension code 0x00 is not assigned in the default alphabet.');
assert.equal(failure(() => C.decode('9B 3F', '2')), 'Extension code 0x7F is not assigned in the default alphabet.');
assert.equal(failure(() => C.parseHex(' '.repeat(4))), 'Enter the packed user data as hex.');
assert.equal(failure(() => C.decode('00'.repeat(281), '')), 'Enter at most 280 octets.');

// ---- Catalog record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(record.name, 'SMS 7-Bit Packing');
assert.equal(record.category, 'Encoding');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.deepEqual(record.tags, ['encoding', 'sms', 'gsm', 'septet', 'packing', 'conversion']);
assert.ok(record.aliases.includes('GSM 7-Bit Packing'), 'alias present');
assert.equal(record.sources.length, 2);
assert.ok(record.sources[0].url.startsWith('https://en.wikipedia.org/wiki/GSM_03.38'), 'cites the alphabet');
assert.ok(record.sources[1].url.endsWith('gsm-03.38-2009.ucm'), 'cites the mapping table');
assert.ok(record.method.includes('153 septets'), 'method states the concatenated part size');
assert.ok(record.method.includes('carriage return'), 'method states the filler rule');
assert.ok(record.testCases.length >= 15, 'catalog carries test cases');

// ---- Replay the catalog test cases against the shipped core.
for (const item of record.testCases) {
  if (item.kind === 'validation') {
    const got = failure(() => (item.input.hex === undefined
      ? C.encode(item.input.text)
      : C.decode(item.input.hex, item.input.septets === undefined ? '' : item.input.septets)));
    assert.equal(got, item.expected.error, 'replay ' + item.name);
    continue;
  }
  if (item.input.hex !== undefined) {
    const got = C.decode(item.input.hex, item.input.septets === undefined ? '' : item.input.septets);
    assert.equal(got.text, item.expected.text, 'replay ' + item.name);
    if (item.expected.septets !== undefined) assert.equal(got.septets, item.expected.septets, 'replay septets ' + item.name);
    if (item.expected.octets !== undefined) assert.equal(got.octets, item.expected.octets, 'replay octets ' + item.name);
    if (item.expected.filler !== undefined) assert.equal(got.filler, item.expected.filler, 'replay filler ' + item.name);
    continue;
  }
  const got = C.encode(item.input.text);
  if (item.expected.hex !== undefined) assert.equal(got.hex, item.expected.hex, 'replay hex ' + item.name);
  assert.equal(got.septets, item.expected.septets, 'replay septets ' + item.name);
  assert.equal(got.octets.length, item.expected.octets, 'replay octets ' + item.name);
  assert.equal(got.parts, item.expected.parts, 'replay parts ' + item.name);
  if (item.expected.remaining !== undefined) assert.equal(got.remaining, item.expected.remaining, 'replay remaining ' + item.name);
}

// ---- No duplicate tool.
const duplicates = catalog.tools.filter((tool) => tool.slug === slug || tool.name === record.name);
assert.equal(duplicates.length, 1, 'the slug and name stay unique');
assert.equal(catalog.tools.filter((tool) => /sms|septet|gsm-7/.test(tool.slug)).length, 1, 'no sibling packing tool');
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && /septet|7-bit packing|gsm 03\.38/i.test(tool.name)),
  'no other tool claims the capability');

// ---- Page contract.
assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'one h1');
assert.ok(html.includes('<meta name="description"'), 'description meta');
assert.ok(html.includes('href="/assets/style.css"'), 'shared stylesheet');
assert.ok(html.includes('src="/assets/app.js"'), 'shared header script');
assert.ok(html.includes('id="site-header"'), 'shared header slot');
assert.ok(html.includes('aria-live="polite"'), 'live region');
assert.ok(html.includes('role="alert"'), 'error alert role');
assert.ok(!/tool-sources|Sources<\/h2>/.test(html), 'sources come from the shared renderer, not the page');
assert.ok(/<label for="mode">/.test(html), 'labelled mode select');
assert.ok(/<label for="input" id="input-label">/.test(html), 'labelled input');
assert.ok(/<label for="count">/.test(html), 'labelled septet count');
assert.ok(/<button type="submit">/.test(html), 'explicit submit button');
assert.ok(html.includes('<form id="pack-form" novalidate>'), 'form wraps the controls');
assert.ok(html.includes('id="facts"'), 'detail list');
assert.ok(html.includes('id="count-field" hidden'), 'the septet count starts hidden in pack mode');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie/.test(html), 'no network or storage');
assert.ok(!/https?:\/\//.test(html), 'the page hardcodes no URLs');
assert.ok(!/[^\x00-\x7F]/.test(html), 'source stays ASCII');
assert.ok(html.includes('sms-core:start') && html.includes('sms-core:end'), 'core markers');
assert.ok(!/eval\(|new Function/.test(html), 'no dynamic evaluation');
assert.equal((html.match(/<html lang="en">/g) || []).length, 1, 'english document');
assert.ok(html.includes('name="viewport"'), 'viewport meta');

// ---- The core holds no state between calls.
assert.equal(C.encode('Hello, world!').hex, C.encode('Hello, world!').hex);
assert.equal(C.decode('E8 32 9B FD 46 97 D9 EC 37', '').text, 'hellohello');

console.log('sms 7-bit packing: all checks passed');
