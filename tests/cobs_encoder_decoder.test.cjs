/* COBS encoder / decoder: catalog replay, the paper's published vectors, an
   independent chunk-based reference implementation, the zero-free guarantee,
   formatting, refusals and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'cobs-encoder-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* cobs-core:start */';
const endMarker = '/* cobs-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {}, TextDecoder, Uint8Array };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CobsCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.run(input));
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};
const bytesOf = (hex) => {
  const text = hex.replace(/[\s,]+/g, '');
  const out = [];
  for (let index = 0; index < text.length; index += 2) out.push(parseInt(text.slice(index, index + 2), 16));
  return out;
};
const hexOf = (bytes) => bytes.map((value) => value.toString(16).padStart(2, '0').toUpperCase()).join('');

// ---- An independent reference written from the prose, not from the page:
// append the phantom zero, cut the packet into zero-terminated chunks, split
// each chunk into 254-byte blocks, then write each block's code byte.
function referenceEncode(data) {
  const packet = Array.from(data).concat(0);
  const out = [];
  let index = 0;
  while (index < packet.length) {
    let stop = packet.indexOf(0, index);
    if (stop === -1) stop = packet.length;
    let run = stop - index;
    while (run > 254) {
      out.push(0xFF);
      for (let take = 0; take < 254; take += 1) out.push(packet[index + take]);
      index += 254;
      run -= 254;
    }
    if (run === 254) {
      out.push(0xFF);
      for (let take = 0; take < 254; take += 1) out.push(packet[index + take]);
      index += 254;
      run = 0;
    } else {
      out.push(run + 1);
      for (let take = 0; take < run; take += 1) out.push(packet[index + take]);
      index += run;
    }
    // Skip the zero that terminated the chunk; the phantom zero ends the loop.
    if (index < packet.length && packet[index] === 0) index += 1;
  }
  return out;
}

function referenceDecode(frame) {
  const out = [];
  let index = 0;
  while (index < frame.length) {
    const code = frame[index];
    index += 1;
    for (let take = 1; take < code; take += 1) out.push(frame[index + take - 1]);
    index += code - 1;
    const atEnd = index === frame.length;
    if (code < 0xFF && !atEnd) out.push(0);
  }
  return out;
}

// ---- Exported contract.
assert.equal(C.MAX_BYTES, 4096);
assert.equal(typeof C.MESSAGES.badHex, 'string');
assert.deepEqual(plain(Object.keys(C)).sort(),
  ['MAX_BYTES', 'MESSAGES', 'compact', 'decode', 'encode', 'formatHex', 'parseHex', 'percent', 'preview', 'run']);

// ---- Published vectors from the paper (Cheshire & Baker 1999).
const fig3 = run({ mode: 'encode', input: '45 00 00 2C 4C 79 00 00 40 06 4F 37' });
assert.equal(fig3.output, '024501042C4C79010540064F37', 'Fig. 3 frame');
assert.equal(fig3.frameBytes, 13);
assert.equal(fig3.dataBytes, 12);
assert.equal(fig3.overhead, 1);
assert.deepEqual(fig3.blocks.map((block) => block.code), [2, 1, 4, 1, 5], 'Fig. 3 code bytes');
assert.deepEqual(fig3.blocks.map((block) => block.data), [1, 0, 3, 0, 4], 'Fig. 3 data counts');
assert.equal(fig3.blocks[4].last, true);
assert.equal(fig3.overheadText, '1 byte (8.3%)');

const back = run({ mode: 'decode', input: fig3.output });
assert.equal(back.output, '4500002C4C79000040064F37', 'Fig. 3 decode');
assert.equal(back.dataBytes, 12);
assert.equal(back.strippedDelimiter, false);

// Fig. 1: an 11-byte chunk without a zero opens with the code byte 0C.
const hello = run({ mode: 'encode', input: hexOf([...Buffer.from('Hello World', 'utf8')]) });
assert.equal(hello.output, '0C48656C6C6F20576F726C64');
assert.equal(hello.blocks.length, 1);
assert.equal(run({ mode: 'decode', input: hello.output }).text, 'Hello World', 'text preview');

// Fig. 2 and Table 1: 254 data bytes per 0xFF block and no implied zero.
const run254 = Array.from({ length: 254 }, (_, index) => index + 1);
const enc254 = run({ mode: 'encode', input: hexOf(run254) });
assert.equal(enc254.frameBytes, 256, 'a 254-byte run costs the FF block plus one code byte');
assert.deepEqual(enc254.blocks.map((block) => block.code), [255, 1]);
assert.equal(enc254.blocks[0].impliedZero, false);
assert.equal(enc254.blocks[1].last, true);
assert.equal(run({ mode: 'decode', input: enc254.output }).output, hexOf(run254), '254-byte round trip');

const run679 = Array.from({ length: 679 }, (_, index) => (index % 255) + 1);
const enc679 = run({ mode: 'encode', input: hexOf(run679) });
assert.equal(enc679.frameBytes, 682, 'Fig. 2: 679 non-zero bytes fill three blocks');
assert.deepEqual(enc679.blocks.map((block) => block.code), [255, 255, 0xAC]);
assert.deepEqual(enc679.blocks.map((block) => block.data), [254, 254, 171]);
assert.equal(run({ mode: 'decode', input: enc679.output }).dataBytes, 679);
assert.equal(run({ mode: 'encode', input: hexOf(run679.concat([0])) }).frameBytes, 683,
  'a packet ending in a zero pays for the phantom block');

// ---- The zero-free guarantee: no frame ever contains 00.
const probes = [
  [], [0], [0, 0, 0], [0x41], [0x41, 0], [0xFF], [0xFF, 0xFF],
  Array.from({ length: 255 }, () => 0), Array.from({ length: 300 }, (_, index) => index % 256)
];
for (const probe of probes) {
  if (probe.length === 0) {
    assert.equal(C.compact(C.encode(new Uint8Array(0)).frame), '01', 'an empty packet is one code byte');
    continue;
  }
  const result = run({ mode: 'encode', input: hexOf(probe) });
  assert.equal(bytesOf(result.output).includes(0), false, 'no zero byte in the frame');
  assert.equal(run({ mode: 'decode', input: result.output }).output, hexOf(probe), 'round trip');
}

// ---- Seeded packets: the page must agree with the reference in both directions.
let seed = 20261117;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
for (let trial = 0; trial < 300; trial += 1) {
  const length = Math.floor(random() * 320);
  const style = random();
  const data = [];
  for (let index = 0; index < length; index += 1) {
    if (style < 0.3) data.push(0);
    else if (style < 0.6) data.push(1 + Math.floor(random() * 255));
    else data.push(random() < 0.35 ? 0 : 1 + Math.floor(random() * 255));
  }
  const expected = referenceEncode(data);
  if (length === 0) {
    assert.equal(C.compact(C.encode(new Uint8Array(0)).frame), '01');
    continue;
  }
  const encoded = run({ mode: 'encode', input: hexOf(data) });
  assert.equal(encoded.output, hexOf(expected), 'reference encoding, ' + length + ' bytes');
  assert.equal(bytesOf(encoded.output).includes(0), false, 'zero-free, ' + length + ' bytes');
  assert.equal(encoded.frameBytes, expected.length);
  assert.equal(encoded.frameBytes - length, encoded.overhead);
  const decoded = run({ mode: 'decode', input: hexOf(expected) });
  assert.equal(decoded.output, hexOf(data), 'reference decoding, ' + length + ' bytes');
  assert.deepEqual(Array.from(referenceDecode(expected)), data, 'reference decoder agrees');
  // Whitespace and case do not matter on the way in.
  const messy = hexOf(expected).toLowerCase().replace(/(.{8})/g, '$1\n  ');
  assert.equal(run({ mode: 'decode', input: messy }).output, hexOf(data), 'messy input');
}

// ---- The block table adds up: code bytes plus data bytes are the frame.
for (const probe of ['45 00 2C', '00', '41 42 43', 'FF 00 01 02']) {
  const result = run({ mode: 'encode', input: probe });
  const total = result.blocks.reduce((sum, block) => sum + block.code, 0);
  assert.equal(total, result.frameBytes, 'block lengths sum to the frame: ' + probe);
  const data = result.blocks.reduce((sum, block) => sum + block.data, 0);
  assert.ok(data <= result.dataBytes, 'blocks never claim more data than went in');
}

// ---- Formatting.
assert.equal(C.compact(new Uint8Array([0, 1, 255])), '0001FF');
assert.equal(C.formatHex(new Uint8Array([0, 1, 255])), '00 01 FF');
assert.equal(C.formatHex(new Uint8Array(17).fill(0x41)).split('\n').length, 2, 'sixteen bytes a row');
assert.equal(C.formatHex(new Uint8Array(17).fill(0x41)).split('\n')[1], '41');
assert.equal(C.percent(1, 12), '8.3%');
assert.equal(C.percent(2, 3), '67%');
assert.equal(C.percent(0, 5), '0.0%');
assert.equal(C.percent(1, 0), '\u2014');
assert.equal(C.preview(new Uint8Array([0x41, 0x42])), 'AB');
assert.equal(C.preview(new Uint8Array([0x00, 0x01])), '', 'binary data gets no preview');

// ---- Catalog replay of the published cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug appears once');
assert.equal(record.name, 'COBS Encoder / Decoder');
assert.equal(record.category, 'Encoding');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.sources.length, 1, 'the paper is cited');
assert.ok(/^https:\/\/www\.stuartcheshire\.org\/papers\/COBSforToN\.pdf$/.test(record.sources[0].url));
assert.ok(/Consistent Overhead Byte Stuffing/.test(record.sources[0].title));
assert.ok(/Table 1/.test(record.sources[0].title), 'the title names the part used');
assert.equal(record.testCases.length, 25, '25 catalog cases');
assert.equal(record.testCases.filter((entry) => entry.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((entry) => entry.kind === 'boundary').length, 6);
assert.equal(record.testCases.filter((entry) => entry.kind === 'validation').length, 9);

for (const testCase of record.testCases) {
  const input = { mode: testCase.input.mode, input: testCase.input.input };
  if (testCase.expected.error) {
    assert.equal(failure(input), testCase.expected.error, 'refusal: ' + testCase.name);
    continue;
  }
  const result = run(input);
  if (testCase.expected.output !== undefined) {
    assert.equal(result.output, testCase.expected.output, testCase.name + ' output');
  }
  assert.equal(result.frameBytes, testCase.expected.frameBytes, testCase.name + ' frame bytes');
  assert.equal(result.dataBytes, testCase.expected.dataBytes, testCase.name + ' data bytes');
  assert.equal(result.blocks.length, testCase.expected.blocks, testCase.name + ' blocks');
  if (testCase.expected.overhead !== undefined) {
    assert.equal(result.overhead, testCase.expected.overhead, testCase.name + ' overhead');
  }
  if (testCase.expected.strippedDelimiter !== undefined) {
    assert.equal(result.strippedDelimiter, testCase.expected.strippedDelimiter, testCase.name + ' delimiter');
  }
  if (testCase.expected.text !== undefined) {
    assert.equal(result.text, testCase.expected.text, testCase.name + ' text');
  }
}

// ---- The catalog is the single place a slug, name or alias may live.
const names = new Map();
for (const tool of catalog.tools) {
  for (const value of [tool.name, ...(tool.aliases || [])]) {
    const key = value.toLowerCase();
    if (!names.has(key)) names.set(key, new Set());
    names.get(key).add(tool.slug);
  }
}
for (const value of [record.name, ...record.aliases]) {
  const owners = names.get(value.toLowerCase());
  assert.equal(owners.size, 1, 'name or alias belongs to one tool: ' + value);
  assert.ok(owners.has(slug), 'name or alias belongs to this tool: ' + value);
}

// ---- Refusals stay specific.
assert.equal(failure({ mode: 'encode', input: '' }),
  'Enter the bytes to encode as hexadecimal, such as 45 00 00 2C.');
assert.equal(failure({ mode: 'decode', input: '   ' }),
  'Paste a COBS frame as hexadecimal, such as 02 45 01 05 40 06 4F 37.');
assert.equal(failure({ mode: 'encode', input: '4g' }), 'Use only hexadecimal digits 0-9 and A-F.');
assert.equal(failure({ mode: 'encode', input: '0x41' }), 'Use only hexadecimal digits 0-9 and A-F.');
assert.equal(failure({ mode: 'encode', input: '450' }),
  'Hex needs an even number of digits \u2014 each byte is two digits.');
assert.equal(failure({ mode: 'encode', input: '41'.repeat(4097) }),
  'That is more than 4,096 bytes; split the packet into smaller frames.');
assert.equal(failure({ mode: 'decode', input: '00' }),
  'That is only the 00 delimiter. Paste the frame bytes that come before it.');
assert.equal(failure({ mode: 'decode', input: '00 00' }),
  'Byte 1 is 00. A COBS frame never contains 00 \u2014 that byte is the delimiter, so paste only the bytes before it.');
assert.equal(failure({ mode: 'decode', input: '02 45 00 01' }),
  'Byte 3 is 00. A COBS frame never contains 00 \u2014 that byte is the delimiter, so paste only the bytes before it.');
assert.equal(failure({ mode: 'decode', input: '05 40 06' }),
  'Code byte 0x05 at byte 1 needs 4 data bytes, but only 2 remain.');
assert.equal(failure({ mode: 'decode', input: 'FF 41' }),
  'Code byte 0xFF at byte 1 needs 254 data bytes, but only 1 remain.');
assert.equal(failure({ mode: 'decode', input: '01 FF 41' }),
  'Code byte 0xFF at byte 2 needs 254 data bytes, but only 1 remain.');
assert.equal(failure({ mode: 'flip', input: '41' }), 'Pick encode or decode.');

// ---- Page contract.
assert.ok(/<h1>COBS Encoder \/ Decoder<\/h1>/.test(html), 'heading');
assert.ok(/<form id="cobs-form" novalidate>/.test(html), 'form');
for (const id of ['input', 'input-label', 'input-hint', 'err', 'run', 'copy', 'clear', 'status',
  'out', 'out-label', 'hex-out', 'stats', 'preview', 'blocks-body', 'blocks-title']) {
  assert.ok(html.includes('id="' + id + '"'), 'element id: ' + id);
}
assert.ok(/<label for="input" id="input-label">Hex bytes<\/label>/.test(html), 'input label');
assert.ok(/<input type="radio" name="mode" id="m-enc" value="encode" checked>/.test(html), 'encode radio');
assert.ok(/<label for="m-dec">Decode<\/label>/.test(html), 'decode label');
assert.ok(/<button type="submit" id="run">Encode frame<\/button>/.test(html), 'submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<th scope="col">Code<\/th>/.test(html), 'block table header');
assert.ok(/phantom zero/.test(html), 'the method note explains the phantom byte');
assert.ok(/without its optional trailing-block optimisation/.test(html), 'the method note states the variant');
assert.ok(!/https?:\/\//.test(html), 'no off-site links or requests');
assert.ok(!/<script[^>]+src="(?!\/assets\/)/.test(html), 'only local scripts');
assert.ok(!/\son(click|input|change|submit|keydown)=/.test(html), 'no inline event handlers');
assert.equal(html.match(/<script/g).length, 3, 'theme init, shared app and the tool script');
const ids = html.match(/\bid="[^"]+"/g).map((value) => value.slice(4, -1));
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');

console.log('cobs encoder / decoder: all assertions passed');
