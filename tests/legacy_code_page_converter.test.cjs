/* Legacy code page converter: replay catalog fixtures, pin published EBCDIC
   and OEM byte positions, and compare against arithmetic reference encoders. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'legacy-code-page-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* codepage-core:start */');
const end = html.indexOf('/* codepage-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = CodePageCore;', sandbox);
const C = sandbox.module.exports;
// Arrays created inside the vm realm have a different prototype, so copy them
// into host arrays before deep comparisons.
const list = (value) => (Array.isArray(value) ? Array.from(value) : value);

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Legacy Code Page Converter');
assert.equal(entry.category, 'Encoding');
assert.equal(entry.subcategory, 'Conversion');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 1000, 'method must document the tables and limits');
assert.equal(entry.sources.length, 4);
for (const source of entry.sources) assert.match(source.url, /^https:\/\//);
assert.equal(entry.testCases.length, 23, 'catalog case count');
assert.equal(entry.testCases.filter((t) => t.kind === 'golden').length, 9);
assert.equal(entry.testCases.filter((t) => t.kind === 'boundary').length, 6);
assert.equal(entry.testCases.filter((t) => t.kind === 'validation').length, 8);

function failure(input) {
  try { C.run(input); } catch (error) { return error.message; }
  return null;
}
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.ok(testCase.expectedError, testCase.name + ' needs an expectedError');
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.run(testCase.input);
  for (const [field, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(list(result[field]), expected, testCase.name + ' ' + field);
  }
  assert.equal(result.rows.length, result.outputUnits, testCase.name + ' row count');
  assert.equal(result.reversible, result.replaced === 0, testCase.name + ' reversibility');
  if (testCase.input.mode === 'encode') {
    assert.deepEqual(list(C.parseHex(result.output)), list(result.bytes), testCase.name + ' hex output parses back');
    if (result.reversible) {
      assert.equal(C.decodeBytes(result.bytes, testCase.input.page).output, testCase.input.input, testCase.name + ' round trip');
    }
  } else if (result.reversible) {
    assert.deepEqual(list(C.encodeText(result.output, testCase.input.page).bytes), list(result.bytes), testCase.name + ' round trip');
  }
}

// The markup sample, the select default and the core default must not drift.
const sampleStart = html.indexOf('<textarea id="input"');
const sample = html.slice(html.indexOf('>', sampleStart) + 1, html.indexOf('</textarea>', sampleStart));
assert.equal(sample, C.defaults.text, 'markup sample differs from the core default');
assert.equal(C.run({}).output, C.run({ input: sample, page: C.defaults.page }).output, 'default result differs');
const options = [...html.matchAll(/<option value="([a-z0-9]+)"([^>]*)>/g)];
assert.deepEqual(options.map((match) => match[1]), list(C.order), 'select options must match the core page order');
const selected = options.find((match) => /selected/.test(match[2]));
assert.ok(selected, 'a default code page must be selected');
assert.equal(selected[1], C.defaults.page, 'select default differs from the core default');
for (const id of C.order) assert.ok(C.label(id).length > 5, 'page label missing for ' + id);

// Published byte positions: EBCDIC letters and digits are laid out in runs, so
// an arithmetic reference checks the page without consulting its own table.
function ebcdicReference(ch) {
  const code = ch.charCodeAt(0);
  if (ch === ' ') return 0x40;
  if (code >= 0x30 && code <= 0x39) return 0xf0 + (code - 0x30);
  if (code >= 0x41 && code <= 0x49) return 0xc1 + (code - 0x41);
  if (code >= 0x4a && code <= 0x52) return 0xd1 + (code - 0x4a);
  if (code >= 0x53 && code <= 0x5a) return 0xe2 + (code - 0x53);
  throw new Error('no EBCDIC reference for ' + ch);
}
for (const page of ['cp037', 'cp500']) {
  const table = C.table(page);
  assert.equal(table.length, 256, page + ' table length');
  for (const ch of ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    assert.equal(table[ebcdicReference(ch)], ch.charCodeAt(0), page + ' byte for ' + ch);
  }
  assert.equal(C.encodeText('HELLO WORLD', page).output, 'C8 C5 D3 D3 D6 40 E6 D6 D9 D3 C4');
}
assert.equal(C.table('cp037')[0x7b], 0x23, 'CP037 # is 0x7B');
assert.equal(C.table('cp037')[0x4b], 0x2e, 'CP037 . is 0x4B');
assert.equal(C.table('cp037')[0x6c], 0x25, 'CP037 % is 0x6C');
assert.equal(C.table('cp037')[0xba], 0x5b, 'CP037 [ is 0xBA');
assert.equal(C.table('cp500')[0x4a], 0x5b, 'CP500 [ is 0x4A');
assert.equal(C.table('cp500')[0x5a], 0x5d, 'CP500 ] is 0x5A');
assert.equal(C.table('cp500')[0x6c], 0x25, 'CP500 % is 0x6C');

// ASCII identity for the OEM, Windows and Latin-1 pages, and pinned graphics.
for (const page of ['cp437', 'cp850', 'cp1252', 'latin1']) {
  const table = C.table(page);
  assert.equal(table.length, 256, page + ' table length');
  for (let code = 0x20; code <= 0x7e; code += 1) assert.equal(table[code], code, page + ' ASCII identity');
}
assert.equal(C.table('cp437')[0xe1], 0xdf, 'CP437 sharp s');
assert.equal(C.table('cp437')[0xdb], 0x2588, 'CP437 full block');
assert.equal(C.table('cp437')[0xb0], 0x2591, 'CP437 light shade');
assert.equal(C.table('cp850')[0x9e], 0xd7, 'CP850 multiplication sign');
assert.equal(C.table('cp850')[0xf8], 0xb0, 'CP850 degree sign');
assert.equal(C.table('cp1252')[0x80], 0x20ac, 'Windows-1252 euro sign');
assert.equal(C.table('cp1252')[0x93], 0x201c, 'Windows-1252 left double quote');
assert.equal(C.table('cp1252')[0x94], 0x201d, 'Windows-1252 right double quote');
assert.equal(C.table('latin1')[0xe9], 0xe9, 'Latin-1 e acute');

// Windows-1252 leaves five positions undefined; the converter must report them.
const UNDEFINED_1252 = [0x81, 0x8d, 0x8f, 0x90, 0x9d];
const windows = C.table('cp1252');
for (const byte of UNDEFINED_1252) assert.equal(windows[byte], -1, 'undefined byte ' + byte.toString(16));
for (const page of C.order) {
  const table = C.table(page);
  assert.equal(table.length, 256, page + ' table length');
  const seen = new Map();
  for (const [byte, cp] of table.entries()) {
    if (cp === -1) {
      assert.deepEqual(UNDEFINED_1252, list(C.table('cp1252').map((value, index) => (value === -1 ? index : -1)).filter((index) => index !== -1)), 'only Windows-1252 may leave bytes undefined');
      assert.equal(page, 'cp1252', page + ' must define every byte');
      continue;
    }
    assert.ok(cp >= 0 && cp <= 0xffff, page + ' code point range');
    assert.ok(!seen.has(cp), page + ' duplicate code point at byte ' + byte);
    seen.set(cp, byte);
  }
}

// Random ASCII strings through an arithmetic reference encoder per page.
let seed = 0x1ec0de;
function random() { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed; }
const ALPHABET_EBCDIC = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
for (let index = 0; index < 1500; index += 1) {
  const length = 1 + (random() % 24);
  let text = '';
  for (let position = 0; position < length; position += 1) text += ALPHABET_EBCDIC[random() % ALPHABET_EBCDIC.length];
  for (const page of ['cp037', 'cp500']) {
    const expected = [...text].map((ch) => ebcdicReference(ch));
    assert.deepEqual(list(C.encodeText(text, page).bytes), expected, page + ' reference vector ' + index);
  }
  const ascii = [...text].map((ch) => ch.charCodeAt(0));
  for (const page of ['cp437', 'cp850', 'latin1']) {
    assert.deepEqual(list(C.encodeText(text, page).bytes), ascii, page + ' ASCII vector ' + index);
  }
  assert.deepEqual(list(C.decodeBytes(ascii, 'latin1').bytes), ascii);
}

// Random byte streams: every page maps a byte to one character and back.
for (let index = 0; index < 1500; index += 1) {
  const page = C.order[random() % C.order.length];
  const length = 1 + (random() % 40);
  const bytes = [];
  for (let position = 0; position < length; position += 1) bytes.push(random() & 0xff);
  const result = C.decodeBytes(bytes, page);
  assert.equal(result.rows.length, length, 'row per byte');
  assert.equal(result.outputUnits <= length, true, 'no character expansion');
  const undefinedBytes = page === 'cp1252' ? bytes.filter((byte) => UNDEFINED_1252.includes(byte)).length : 0;
  assert.equal(result.replaced, undefinedBytes, page + ' undefined byte count');
  assert.equal(result.reversible, undefinedBytes === 0, page + ' reversibility');
  if (result.reversible) {
    assert.deepEqual(list(C.encodeText(result.output, page).bytes), bytes, page + ' byte round trip ' + index);
  } else {
    assert.ok(result.output.includes('\ufffd'), 'undefined bytes render as U+FFFD');
  }
}

// Substitution is counted, positioned and never silent.
const lossy = C.encodeText('A😀B', 'cp1252');
assert.equal(lossy.output, '41 3F 42');
assert.equal(lossy.replaced, 1);
assert.deepEqual(list(lossy.replacedAt), [2]);
assert.equal(lossy.reversible, false);
assert.equal(lossy.rows[1].replaced, true);
assert.equal(lossy.rows[1].code, 'U+1F600');
const emDash = C.encodeText('—', 'cp037');
assert.equal(emDash.output, '3F');
assert.equal(emDash.replaced, 1);
assert.equal(C.encodeText('—', 'cp1252').output, '97', 'Windows-1252 does define the em dash');

// Limits and parsing.
assert.equal(failure({ mode: 'encode', input: 'a'.repeat(4096), page: 'cp1252' }), null);
assert.equal(failure({ mode: 'encode', input: 'a'.repeat(4097), page: 'cp1252' }), 'Text input must be 4,096 characters or fewer.');
assert.equal(C.parseHex(' '.repeat(10) + '41 42').length, 2);
assert.equal(C.parseHex('\n41\r\n42\t43\n').length, 3);
assert.equal(failure({ mode: 'decode', input: '41 4', page: 'cp037' }), 'Hex input must contain complete two-digit bytes.');
assert.equal(failure({ mode: 'decode', input: 'ZZ', page: 'cp037' }), 'Hex input may contain only hexadecimal digits and whitespace.');
assert.equal(failure({ mode: 'decode', input: '', page: 'cp037' }), 'Enter hexadecimal bytes to decode.');
assert.equal(failure({ mode: 'encode', input: '', page: 'cp037' }), 'Enter text to encode.');
assert.equal(failure({ mode: 'encode', input: 'A', page: 'cp999' }), 'Choose a supported code page.');
assert.equal(failure({ mode: 'encode', input: 'A', page: 'constructor' }), 'Choose a supported code page.');
assert.equal(failure({ mode: 'encode', input: 'A', page: '__proto__' }), 'Choose a supported code page.');
assert.equal(failure({ mode: 'sideways', input: 'A', page: 'cp037' }), 'Choose either encode or decode mode.');
assert.throws(() => C.decodeBytes([256], 'latin1'));
assert.throws(() => C.decodeBytes([1.5], 'latin1'));
assert.throws(() => C.decodeBytes(null, 'latin1'));
assert.equal(C.decodeBytes([], 'latin1').output, '');
assert.deepEqual(C.decodeBytes([0x00, 0x7f, 0x20], 'latin1').output, '\u0000\u007f ');

// Page contract: shared shell, accessible controls and no runtime foreign APIs.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html), 'network or storage API found');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'remote script');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'remote stylesheet');
assert.ok(!/on(?:click|input|change|submit)=/i.test(html), 'inline handler');
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html), 'unsafe script evaluation');
assert.ok(html.includes('for="input"'), 'input label missing');
assert.ok(html.includes('for="page-select"'), 'page select label missing');
assert.ok(html.includes('aria-describedby="input-help"'), 'help reference missing');
for (const match of html.matchAll(/\$\("([a-z0-9-]+)"\)/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'script references missing id ' + match[1]);
}
assert.ok(html.includes('<form id="codec-form" novalidate>'), 'form missing');
assert.ok(html.includes('type="submit"'), 'submit missing');
assert.ok(html.includes('id="reset"'), 'reset missing');
assert.ok(html.includes('id="output" readonly'), 'read-only output missing');
assert.ok(html.includes('role="alert"'), 'error announcement missing');
assert.ok(html.includes('role="status" aria-live="polite"'), 'result announcement missing');
assert.ok(html.includes('<caption>'), 'table caption missing');
assert.equal((html.match(/scope="col"/g) || []).length, 5, 'five column headers');
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'), 'shared shell assets missing');

console.log('legacy-code-page-converter: 23 catalog cases, published byte anchors and 3000 reference vectors passed');
