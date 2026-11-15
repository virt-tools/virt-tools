/* Crockford Base32 codec: the alphabet, encoding against an independent model,
   decoding with the case and I/L/O rules, the modulo-37 check symbol, grouping,
   validation messages, the catalog record and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'crockford-base32';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* crockford-core:start */';
const endMarker = '/* crockford-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CrockfordCore;', sandbox);
const C = sandbox.module.exports;

const failure = (fn) => {
  try { fn(); } catch (error) { return error.message; }
  return null;
};
const value = (text) => C.parseNumber(text);
const decoded = (text) => C.decode(text).value.toString();

// ---- Constants.
assert.equal(C.SYMBOLS, '0123456789ABCDEFGHJKMNPQRSTVWXYZ');
assert.equal(C.SYMBOLS.length, 32);
assert.equal(C.CHECK_SYMBOLS, '0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U');
assert.equal(C.CHECK_SYMBOLS.length, 37);
assert.equal(C.CHECK_MODULUS, 37);
assert.equal(C.MAX_INPUT, 4096);
assert.equal(C.GROUP_SIZE, 5);
assert.ok(!/[ILOU]/.test(C.SYMBOLS), 'the alphabet omits I, L, O and U');

// ---- Number parsing.
assert.equal(value('0').toString(), '0');
assert.equal(value('1000').toString(), '1000');
assert.equal(value(' 1 000 ').toString(), '1000');
assert.equal(value('1_000').toString(), '1000');
assert.equal(value('0xFF').toString(), '255');
assert.equal(value('0X10').toString(), '16');
assert.equal(value('0x0').toString(), '0');
assert.equal(value('0x' + 'f'.repeat(40)).toString(), ((2n ** 160n) - 1n).toString());

// ---- Encoding, pinned against an independent Python model.
const encodeCases = [
  ['0', '0'],
  ['1', '1'],
  ['9', '9'],
  ['10', 'A'],
  ['31', 'Z'],
  ['32', '10'],
  ['255', '7Z'],
  ['1000', 'Z8'],
  ['1024', '100'],
  ['65535', '1ZZZ'],
  ['2147483647', '1ZZZZZZ'],
  ['18446744073709551615', 'FZZZZZZZZZZZZ'],
  ['123456789012345678901234567890', '33Q91ZVC6WZ0XS73Y2PJ'],
  ['10000000000000000000000000000000000000000', '7B357RW6Q54QYNVKXB100000000']
];
for (const [input, expected] of encodeCases) {
  assert.equal(C.encode(value(input)), expected, 'encode ' + input);
}
assert.equal(C.encode(0n), '0', 'BigInt zero');
assert.equal(C.encode(2n ** 64n - 1n), 'FZZZZZZZZZZZZ', 'BigInt maximum');

// ---- The check symbol is the value modulo 37.
const checkCases = [
  ['0', '0'],
  ['1', '1'],
  ['32', '*'],
  ['36', 'U'],
  ['255', '~'],
  ['1000', '1'],
  ['1024', 'S'],
  ['18446744073709551615', 'B']
];
for (const [input, expected] of checkCases) {
  assert.equal(C.checkFor(value(input)), expected, 'check ' + input);
}
assert.equal(C.CHECK_SYMBOLS.indexOf(C.checkFor(1000n)), Number(1000n % 37n), 'check value equals the remainder');
assert.ok(C.checkFor(36n) === 'U' && C.checkFor(35n) === '=', 'the extra check symbols are reachable');

// ---- Grouping.
assert.equal(C.group('1234567890', 5), '12345-67890');
assert.equal(C.group('123456', 5), '12345-6');
assert.equal(C.group('1234', 5), '1234');
assert.equal(C.group('1234567890', 0), '1234567890');
assert.equal(C.group('1234567890', null), '1234567890');
assert.equal(C.group('123456789012345678901234567890', 5), '12345-67890-12345-67890-12345-67890');

// ---- Decoding, including the case and I/L/O corrections.
assert.equal(decoded('0'), '0');
assert.equal(decoded('Z8'), '1000');
assert.equal(decoded('z8'), '1000');
assert.equal(decoded('Z8 '), '1000');
assert.equal(decoded(' z-8 '), '1000');
assert.equal(decoded('33Q91-ZVC6-WZ0XS-73Y2PJ'), '123456789012345678901234567890');
assert.equal(decoded('1O'), '32', 'O reads as zero');
assert.equal(decoded('o'), '0');
assert.equal(decoded('il'), '33', 'I and L read as one');
assert.equal(decoded('0000'), '0', 'leading zeros carry no value');
assert.equal(decoded('1Z'), '63');
assert.equal(C.decode('Z8').count, 2);
assert.equal(C.decode('1O').symbols, '10', 'the decoded symbols are normalised');

// ---- Round trips, including values wider than 64 bits.
const roundTrip = ['0', '1', '31', '32', '1000', '4294967296', '18446744073709551616',
  '123456789012345678901234567890123456789', (2n ** 512n).toString()];
for (const input of roundTrip) {
  const code = C.encode(value(input));
  assert.equal(decoded(code), value(input).toString(), 'round trip ' + input);
  const checked = code + C.checkFor(value(input));
  const result = C.decode(checked, { check: true });
  assert.equal(result.value.toString(), value(input).toString(), 'checked round trip ' + input);
  assert.equal(result.check, C.checkFor(value(input)), 'check symbol reported ' + input);
}

// ---- Checked decoding.
assert.deepEqual({ ...C.decode('Z81', { check: true }) }, {
  value: 1000n, symbols: 'Z8', count: 2, check: '1', expected: '1'
});
assert.equal(C.decode('00', { check: true }).value.toString(), '0');
assert.equal(C.decode('zz', { check: true }).value.toString(), '31');
assert.equal(failure(() => C.decode('Z82', { check: true })),
  'Check symbol \u201c2\u201d does not match this number: expected \u201c1\u201d.');
assert.equal(failure(() => C.decode('Z8@', { check: true })),
  'Invalid check symbol \u201c@\u201d: use 0-9, A-Z without I, L, O or U, or one of * ~ $ = U.');
assert.equal(failure(() => C.decode('00', { check: true })), null, 'a matching zero check passes');

// ---- Validation messages.
assert.equal(failure(() => value('')), 'Enter a number to convert.');
assert.equal(failure(() => value('   ')), 'Enter a number to convert.');
assert.equal(failure(() => value('-5')), 'Enter a non-negative whole number.');
assert.equal(failure(() => value('12a')), 'Use only the digits 0-9.');
assert.equal(failure(() => value('1.5')), 'Use only the digits 0-9.');
assert.equal(failure(() => value('0xZZ')), 'Use only hexadecimal digits 0-9 and A-F after 0x.');
assert.equal(failure(() => value('0x')), 'Enter hexadecimal digits after 0x.');
assert.equal(failure(() => value('9'.repeat(4097))), 'Enter at most 4096 characters.');
assert.equal(failure(() => C.decode('')), 'Enter a Base32 code to decode.');
assert.equal(failure(() => C.decode(' - ')), 'Enter a Base32 code to decode.');
assert.equal(failure(() => C.decode('Z', { check: true })),
  'A checked code needs at least one data symbol and a check symbol.');
assert.equal(failure(() => C.decode('U', { check: true })),
  'A checked code needs at least one data symbol and a check symbol.');
assert.equal(failure(() => C.decode('Z8!')),
  'Invalid symbol \u201c!\u201d at position 3: it is not in the Base32 alphabet.');
assert.equal(failure(() => C.decode('Z8U')),
  'Invalid symbol \u201cU\u201d at position 3: it is not in the Base32 alphabet.');
assert.equal(failure(() => C.decode('-'.repeat(4098))), 'Enter at most 4096 characters.');

// ---- Formatting helpers.
assert.equal(C.hex(0n), '0x0');
assert.equal(C.hex(1000n), '0x3e8');
assert.equal(C.bits(0n), 1);
assert.equal(C.bits(1n), 1);
assert.equal(C.bits(1000n), 10);
assert.equal(C.bits(2n ** 64n - 1n), 64);

// ---- Catalog record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2314, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(record.name, 'Crockford Base32 Encoder / Decoder');
assert.equal(record.category, 'Encoding');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.deepEqual(record.tags, ['encoding', 'base32', 'crockford', 'check-symbol', 'document', 'conversion']);
assert.ok(record.aliases.includes('Crockford Base 32'), 'alias present');
assert.equal(record.sources.length, 1);
assert.equal(record.sources[0].url, 'https://www.crockford.com/base32.html');
assert.ok(record.sources[0].title.includes('Base 32 by Douglas Crockford'), 'source title names the specification');
assert.ok(record.testCases.length >= 10, 'catalog carries test cases');

// ---- Replay the catalog test cases against the shipped core.
for (const item of record.testCases) {
  if (item.kind === 'validation') {
    const got = item.input.code === undefined
      ? failure(() => value(item.input.value))
      : failure(() => C.decode(item.input.code, { check: !!item.input.check }));
    assert.equal(got, item.expected.error, 'replay ' + item.name);
    continue;
  }
  if (item.input.code !== undefined) {
    const result = C.decode(item.input.code, { check: !!item.input.check });
    assert.equal(result.value.toString(), item.expected.value, 'replay ' + item.name);
    if (item.expected.check) assert.equal(result.check, item.expected.check, 'replay check ' + item.name);
    continue;
  }
  const number = value(item.input.value);
  const code = C.encode(number);
  const grouped = item.input.group ? C.group(code, item.input.group) : code;
  assert.equal(grouped, item.expected.code, 'replay ' + item.name);
  assert.equal(C.checkFor(number), item.expected.check, 'replay check ' + item.name);
}

const duplicates = catalog.tools.filter((tool) => tool.slug === slug || tool.name === record.name);
assert.equal(duplicates.length, 1, 'the slug and name stay unique');
assert.equal(catalog.tools.filter((tool) => /crockford/.test(tool.slug)).length, 1, 'no sibling Crockford tool');
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && /crockford/i.test(tool.name)), 'no other tool claims the name');

// ---- Page contract.
assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'one h1');
assert.ok(html.includes('<meta name="description"'), 'description meta');
assert.ok(html.includes('href="/assets/style.css"'), 'shared stylesheet');
assert.ok(html.includes('src="/assets/app.js"'), 'shared header script');
assert.ok(html.includes('id="site-header"'), 'shared header slot');
assert.ok(html.includes('aria-live="polite"'), 'live region');
assert.ok(html.includes('role="alert"'), 'error alert role');
assert.ok(!/tool-sources|Sources<\/h2>/.test(html), 'sources come from the shared renderer, not the page');
assert.ok(/<label for="mode">/.test(html) && /<label for="check">/.test(html), 'labelled selects');
assert.ok(/<label for="group">/.test(html) && /<label for="input" id="input-label">/.test(html), 'labelled input');
assert.ok(/<button type="submit">/.test(html), 'explicit submit button');
assert.ok(html.includes('<form id="convert-form" novalidate>'), 'form wraps the controls');
assert.ok(html.includes('id="facts"'), 'detail list');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie/.test(html), 'no network or storage');
assert.ok(!/https?:\/\//.test(html), 'the page hardcodes no URLs');
assert.ok(!/[^\x00-\x7F]/.test(html), 'source stays ASCII');
assert.ok(html.includes('crockford-core:start') && html.includes('crockford-core:end'), 'core markers');
assert.ok(!/eval\(|new Function/.test(html), 'no dynamic evaluation');
assert.equal((html.match(/<html lang="en">/g) || []).length, 1, 'english document');
assert.ok(html.includes('name="viewport"'), 'viewport meta');

// ---- Repeated conversions are identical and the core holds no state.
assert.equal(C.encode(value('123456789012345678901234567890')), '33Q91ZVC6WZ0XS73Y2PJ');
assert.equal(C.encode(value('123456789012345678901234567890')), '33Q91ZVC6WZ0XS73Y2PJ');

console.log('crockford base32 codec: all checks passed');
