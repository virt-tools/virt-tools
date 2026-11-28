/* Regression checks for the JSON Canonicalizer (RFC 8785): the catalog cases,
   the six official test-data pairs, the RFC's own sort-order example, the
   Appendix B number table, the string escaping rules, the I-JSON refusals and
   the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'json-canonicalizer';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* json-jcs-core:start */';
const endMarker = '/* json-jcs-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|localStorage|fetch\(|XMLHttpRequest/.test(coreSource),
  'the core stays free of DOM, storage and network access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = JsonJcs;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'JSON Canonicalizer (RFC 8785)');
assert.equal(record.category, 'Encoding');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
for (const tag of ['encoding', 'json', 'canonicalization', 'jcs', 'rfc-8785', 'serialization', 'deterministic']) {
  assert.ok(record.tags.includes(tag), `tag ${tag}`);
}
assert.ok(record.aliases.length >= 6, 'aliases cover the search spellings');
assert.ok(record.method.length > 1200, 'method records the arithmetic');
assert.ok(typeof record.guidance === 'string' && record.guidance.length > 60 && record.guidance.length < 500,
  'guidance states the limits and stays a banner');
assert.equal(record.sources.length, 2, 'two sources');
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'source has an https URL');
  assert.ok(source.title.length > 80, 'source title is specific');
}
assert.match(record.sources[0].url, /rfc8785/, 'the RFC is cited');
assert.ok(/Appendix B/.test(record.sources[0].title), 'the number table is named');
assert.match(record.sources[1].url, /json-canonicalization/, 'the reference test data is cited');

assert.equal(catalog.tools.length, 2531, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2270, 'public tools');
assert.equal(
  catalog.tools.filter((tool) => tool.category === 'Encoding').length,
  58,
  'Encoding count'
);

const meta = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-meta', slug + '.json'), 'utf8'));
assert.equal(meta.slug, slug);
assert.equal(meta.testCaseCount, 12);
assert.ok(meta.related.length >= 2 && meta.related.every((item) => item.slug !== slug),
  'related tools are neighbours only');

// The slug, name and aliases must not be shared with another record.
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  const others = [tool.slug, tool.name, ...(tool.aliases || []), ...(tool.tags || [])]
    .map((value) => value.toLowerCase());
  for (const value of [record.name, ...record.aliases]) {
    assert.ok(!others.includes(value.toLowerCase()), `"${value}" collides with ${tool.slug}`);
  }
}

const failure = (input) => {
  try {
    C.analyze(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

const kinds = { golden: 0, boundary: 0, validation: 0 };
for (const testCase of record.testCases) {
  kinds[testCase.kind] = (kinds[testCase.kind] || 0) + 1;
  if (testCase.kind === 'validation') {
    const message = failure(testCase.input.json);
    assert.ok(message, `${testCase.name}: expected a refusal`);
    assert.equal(message, testCase.expectedError,
      `${testCase.name}: the refusal is the catalogued sentence`);
    assert.ok(message.endsWith('.'), `${testCase.name}: the refusal is a full sentence`);
    continue;
  }
  const result = C.analyze(testCase.input.json);
  assert.equal(result.canonical, testCase.expected.canonical, `${testCase.name}: canonical form`);
  assert.equal(result.bytes, testCase.expected.bytes, `${testCase.name}: UTF-8 bytes`);
  assert.equal(C.analyze(result.canonical).canonical, result.canonical,
    `${testCase.name}: canonicalization is idempotent`);
}
assert.equal(kinds.golden, 4, 'four golden cases');
assert.equal(kinds.boundary, 2, 'two boundary cases');
assert.equal(kinds.validation, 6, 'six validation cases');
assert.equal(record.testCases.length, 12, 'twelve catalog cases');

// ---- The six official RFC 8785 test-data pairs, byte for byte. ----
const vectors = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/jcs_rfc8785_vectors.json'), 'utf8'));
assert.equal(vectors.files.length, 6, 'six reference pairs');
for (const file of vectors.files) {
  const result = C.analyze(file.input);
  assert.equal(result.canonical, file.output, `${file.name}: canonical text`);
  assert.ok(Buffer.from(result.canonical, 'utf8').equals(Buffer.from(file.output, 'utf8')),
    `${file.name}: the UTF-8 bytes match, including any raw control characters`);
  assert.equal(result.bytes, Buffer.byteLength(file.output, 'utf8'), `${file.name}: byte count`);
  assert.equal(C.analyze(file.output).canonical, file.output, `${file.name}: the published output is a fixed point`);
  assert.equal(result.warnings.length, 0, `${file.name}: no rounding warning`);
}

// ---- The RFC 8785 section 3.2.3 sort order: UTF-16 code units, not locale. ----
const sortInput = '{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh",'
  + '"1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control","\\u00f6":"Latin Small Letter O With Diaeresis"}';
const sortOrder = ['Carriage Return', 'One', 'Control', 'Latin Small Letter O With Diaeresis',
  'Euro Sign', 'Emoji: Grinning Face', 'Hebrew Letter Dalet With Dagesh'];
const sorted = C.parse(sortInput).value;
assert.deepEqual(Array.from(Object.keys(sorted).sort(), (key) => sorted[key]), sortOrder, 'the RFC argument order');
const sortedCanonical = C.analyze(sortInput).canonical;
let cursor = -1;
for (const label of sortOrder) {
  const at = sortedCanonical.indexOf('"' + label + '"');
  assert.ok(at > cursor, `${label} sorts after the previous property`);
  cursor = at;
}

// ---- Appendix B: number serialization, from the IEEE 754 bit patterns. ----
const APPENDIX_B = [
  ['0000000000000000', '0'], ['8000000000000000', '0'], ['0000000000000001', '5e-324'],
  ['8000000000000001', '-5e-324'], ['7fefffffffffffff', '1.7976931348623157e+308'],
  ['ffefffffffffffff', '-1.7976931348623157e+308'], ['4340000000000000', '9007199254740992'],
  ['c340000000000000', '-9007199254740992'], ['4430000000000000', '295147905179352830000'],
  ['44b52d02c7e14af5', '9.999999999999997e+22'], ['44b52d02c7e14af6', '1e+23'],
  ['44b52d02c7e14af7', '1.0000000000000001e+23'], ['444b1ae4d6e2ef4e', '999999999999999700000'],
  ['444b1ae4d6e2ef4f', '999999999999999900000'], ['444b1ae4d6e2ef50', '1e+21'],
  ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'], ['3eb0c6f7a0b5ed8d', '0.000001'],
  ['41b3de4355555553', '333333333.3333332'], ['41b3de4355555554', '333333333.33333325'],
  ['41b3de4355555555', '333333333.3333333'], ['41b3de4355555556', '333333333.3333334'],
  ['41b3de4355555557', '333333333.33333343'], ['becbf647612f3696', '-0.0000033333333333333333'],
  ['43143ff3c1cb0959', '1424953923781206.2'],
];
for (const [bits, expected] of APPENDIX_B) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt('0x' + bits));
  assert.equal(C.canonicalize(buffer.readDoubleBE(0)), expected, `IEEE 754 ${bits}`);
}
assert.equal(C.analyze('[1E30,4.50,2e-3,-0,1e-7]').canonical, '[1e+30,4.5,0.002,0,1e-7]',
  'JSON number literals collapse to their double form');

// ---- Strings: the five short escapes, lowercase \\uhhhh, and everything else raw. ----
const escapeInput = '{"s":"\\u0000\\u0001\\u0008\\u0009\\u000a\\u000b\\u000c\\u000d\\u001f\\u007f\\u2028\\u2029\\"\\\\\\/"}';
const escapeOutput = C.analyze(escapeInput).canonical;
assert.ok(escapeOutput.includes('\\u0000'), 'NUL uses lowercase \\u0000');
assert.ok(escapeOutput.includes('\\u0001'), 'U+0001 uses lowercase \\u0001');
assert.ok(escapeOutput.includes('\\b') && escapeOutput.includes('\\t') && escapeOutput.includes('\\n'),
  'backspace, tab and newline use their short forms');
assert.ok(escapeOutput.includes('\\f') && escapeOutput.includes('\\r'), 'form feed and carriage return use short forms');
assert.ok(escapeOutput.includes('\\u000b') && escapeOutput.includes('\\u001f'), 'other controls use \\uhhhh');
assert.ok(!escapeOutput.includes('\\u0008') && !escapeOutput.includes('\\u0009') && !escapeOutput.includes('\\u000a'),
  'the short forms are not written in hex');
assert.ok(escapeOutput.includes('\u007f') && !escapeOutput.includes('\\u007f'), 'U+007F stays raw');
assert.ok(escapeOutput.includes('\u2028') && escapeOutput.includes('\u2029'), 'line separators stay raw');
assert.equal(JSON.parse(escapeOutput).s, JSON.parse(escapeInput).s, 'the escaping round-trips through JSON.parse');
assert.equal(C.analyze('"\u00e9\u20ac\ud83d\ude00"').bytes, 2 + 3 + 4 + 2, 'UTF-8 byte counter');

// ---- Integers outside 2^53 are rounded, and the page says so. ----
const rounded = C.analyze('{"n": 9007199254740993}');
assert.equal(rounded.canonical, '{"n":9007199254740992}');
assert.equal(rounded.warnings.length, 1);
assert.equal(rounded.warnings[0].rendered, '9007199254740992');
assert.match(C.warningText(rounded.warnings), /9007199254740993 \u2192 9007199254740992/);
assert.match(C.warningText(rounded.warnings), /IEEE-754 double/);
assert.equal(C.analyze('{"n": 9007199254740992}').warnings.length, 0, '2^53 itself is exact and silent');
assert.equal(C.analyze('{"n": 1e21}').warnings.length, 0, 'an exact power of ten is not flagged');
assert.equal(C.analyze('{"n": 1.5}').warnings.length, 0, 'fractions are not flagged');

// ---- Refusals the catalog does not cover: malformed input and I-JSON edges. ----
const refusals = [
  ['', 'Enter JSON to canonicalize.'],
  ['   \n\t ', 'Enter JSON to canonicalize.'],
  ['{"a":"\\ud800"}', 'Invalid JSON at line 1, column 13: a lone surrogate was found; JCS needs well-formed Unicode.'],
  ['{"a":"\\udc00"}', 'Invalid JSON at line 1, column 9: a lone surrogate was found; JCS needs well-formed Unicode.'],
  ['{"a":"x\u0001"}', 'Invalid JSON at line 1, column 8: an unescaped control character was found in a string.'],
  ['{"a":1} trailing', 'Invalid JSON at line 1, column 9: unexpected character "t" after the JSON value.'],
  ['{"a":1', 'Invalid JSON at line 1, column 1: the object is not terminated.'],
  ['[1 2]', 'Invalid JSON at line 1, column 4: a comma or "]" was expected.'],
  ['1.2.3', 'Invalid JSON at line 1, column 1: the number is not valid JSON.'],
  ['{"a":tru}', 'Invalid JSON at line 1, column 9: "true" was expected.'],
  ['{"a":+1}', 'Invalid JSON at line 1, column 6: unexpected character "+"; a value was expected.'],
];
for (const [input, expected] of refusals) {
  assert.equal(failure(input), expected, `refusal for ${JSON.stringify(input)}`);
}

// A byte-order mark is skipped rather than refused.
assert.equal(C.analyze('\ufeff{"a":1}').canonical, '{"a":1}');
assert.equal(C.analyze('{"a":"\\u00e9"}').canonical, '{"a":"\u00e9"}');

// 128 levels are accepted, 129 refused; the character cap is 200,000.
assert.equal(C.analyze('['.repeat(128) + ']'.repeat(128)).bytes, 256);
assert.equal(failure('['.repeat(129) + ']'.repeat(129)),
  'Invalid JSON at line 1, column 129: the document nests deeper than 128 levels.');
const atCap = '"' + 'a'.repeat(199998) + '"';
assert.equal(C.analyze(atCap).bytes, 200000, 'exactly 200,000 characters are accepted');
assert.equal(failure('"' + 'a'.repeat(199999) + '"'),
  'The input is longer than 200,000 characters; paste a smaller excerpt.');

// ---- Page contract. ----
assert.match(html, /<html lang="en">/, 'language declared');
assert.match(html, /name="viewport"/, 'viewport declared');
assert.match(html, /<main>/, 'main landmark');
assert.match(html, /<h1>JSON Canonicalizer \(RFC 8785\)<\/h1>/, 'page heading');
assert.match(html, /<form id="jcs-form" novalidate>/, 'form is marked novalidate');
assert.match(html, /<button type="submit">Canonicalize<\/button>/, 'submit button');
for (const id of ['json-input', 'out', 'err']) {
  assert.match(html, new RegExp(`id="${id}"`), `element ${id}`);
}
assert.match(html, /<label for="json-input">JSON document<\/label>/, 'textarea has a label');
assert.match(html, /id="err" role="alert" aria-live="polite"/, 'errors are announced');
assert.match(html, /id="out" aria-live="polite" aria-atomic="true"/, 'result is announced');
assert.match(html, /not signing and not encryption/, 'the page says canonicalization is not signing');
assert.match(html, /UTF-16 code units/, 'the page names the sort key');
assert.match(html, /duplicate property names/, 'the page names the duplicate rule');
assert.match(html, /nothing is sent or stored/, 'the local-only promise is stated');
assert.match(html, /SHA-256/, 'the digest is described');
assert.ok(!/src="https?:\/\//.test(html), 'no off-site script or image');
assert.ok(!/<a [^>]*href="https?:/.test(html), 'no off-site link in the page body');
const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'no duplicate element ids');

console.log('json-canonicalizer: 12 catalog cases, 6 reference pairs, 24 number samples, sort order, escapes, refusals and page contract OK');
