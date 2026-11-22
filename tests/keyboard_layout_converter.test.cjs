/* Keyboard layout converter: the QWERTY, Dvorak and Colemak key tables, the
   position-based remap and its inverse, the pass-through accounting, the
   catalog cases, uniqueness and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'keyboard-layout-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* layout-core:start */';
const endMarker = '/* layout-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = KeyboardLayoutCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');

const convert = (source, target, text) => C.convert({ source, target, text });
const failure = (input) => {
  try {
    C.convert(input);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};

// ---- The key tables: 47 ANSI keys, unshifted and shifted, from XKB's us layouts.
const TABLES = {
  qwerty: {
    base: '`1234567890-=qwertyuiop[]\\asdfghjkl;\'zxcvbnm,./',
    shift: '~!@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:"ZXCVBNM<>?'
  },
  dvorak: {
    base: '`1234567890[]\',.pyfgcrl/=\\aoeuidhtns-;qjkxbmwvz',
    shift: '~!@#$%^&*(){}"<>PYFGCRL?+|AOEUIDHTNS_:QJKXBMWVZ'
  },
  colemak: {
    base: '`1234567890-=qwfpgjluy;[]\\arstdhneio\'zxcvbkm,./',
    shift: '~!@#$%^&*()_+QWFPGJLUY:{}|ARSTDHNEIO"ZXCVBKM<>?'
  }
};
assert.equal(C.KEYS.length, 47, 'the ANSI key list');
assert.equal(C.KEYS[0], 'TLDE');
assert.equal(C.KEYS[13], 'AD01');
assert.equal(C.KEYS[25], 'BKSL');
assert.equal(C.KEYS[26], 'AC01');
assert.equal(C.KEYS[46], 'AB10');
for (const layout of C.LAYOUTS) {
  const expected = TABLES[layout.id];
  assert.ok(expected, 'known layout ' + layout.id);
  assert.equal(layout.base, expected.base, layout.id + ' unshifted table');
  assert.equal(layout.shift, expected.shift, layout.id + ' shifted table');
  assert.equal(layout.base.length, C.KEYS.length);
  assert.equal(layout.shift.length, C.KEYS.length);
  assert.equal(layout.rows.join(''), layout.base, layout.id + ' legend rows rebuild the base row');
  assert.equal(layout.shiftRows.join(''), layout.shift, layout.id + ' legend rows rebuild the shift row');
  const characters = layout.base + layout.shift;
  assert.equal(new Set(characters).size, characters.length, layout.id + ' maps every character to one key');
}
assert.equal(C.LAYOUTS.length, 3);
assert.ok(C.layoutOf(' Dvorak ') === C.layoutOf('dvorak'), 'layout ids ignore case and space');
assert.equal(C.layoutOf('azerty'), null);

// ---- Physical keys: the same key is read on the other layout.
assert.equal(convert('dvorak', 'qwerty', 'd.nnr').output, 'hello');
assert.equal(convert('qwerty', 'dvorak', 'hello').output, 'd.nnr');
assert.equal(convert('dvorak', 'qwerty', 'aoeuidhtns').output, 'asdfghjkl;');
assert.equal(convert('qwerty', 'colemak', 'hello world').output, 'hfiiy wypis');
assert.equal(convert('qwerty', 'dvorak', '1234567890').output, '1234567890', 'digits stay on their keys');
assert.equal(convert('qwerty', 'dvorak', 'H').output, 'D', 'the H key types d on Dvorak');
assert.equal(convert('dvorak', 'qwerty', 'j').output, 'c');
assert.equal(C.characterAt(C.layoutOf('dvorak'), C.KEYS.indexOf('AC06'), 0), 'd');
assert.equal(C.characterAt(C.layoutOf('qwerty'), C.KEYS.indexOf('AC06'), 1), 'H');
assert.equal(C.reverseOf(C.layoutOf('colemak')).q.position, C.KEYS.indexOf('AD01'));

// ---- Every ordered pair of layouts is its own inverse over printable ASCII.
const printable = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join('');
for (const first of C.LAYOUTS) {
  for (const second of C.LAYOUTS) {
    const forward = convert(first.id, second.id, printable);
    assert.equal(forward.mapped, 94, first.id + '->' + second.id + ' remaps all 94 printable key characters');
    assert.equal(forward.untouched, 0);
    assert.equal(JSON.stringify(forward.unsupported), '[]', 'nothing is left over');
    const back = convert(second.id, first.id, forward.output);
    assert.equal(back.output, printable, first.id + '<->' + second.id + ' round-trips');
  }
}

// ---- Pass-through accounting.
const accents = convert('qwerty', 'dvorak', 'na\u00efve \u2014 caf\u00e9');
assert.equal(accents.output, 'ba\u00efk. \u2014 jau\u00e9');
assert.equal(accents.mapped, 7);
assert.equal(accents.untouched, 3);
assert.equal(JSON.stringify(accents.unsupported), JSON.stringify(['\u00e9', '\u00ef', '\u2014']));
const emoji = convert('qwerty', 'dvorak', 'h\u00e9llo \u{1F642}');
assert.equal(emoji.output, 'd\u00e9nnr \u{1F642}');
assert.equal(emoji.untouched, 2);
assert.equal(JSON.stringify(emoji.unsupported), JSON.stringify(['\u00e9', '\u{1F642}']),
  'a surrogate pair counts as one character');
const blank = convert('qwerty', 'colemak', '\n\t\r ');
assert.equal(blank.output, '\n\t\r ');
assert.equal(blank.mapped, 0);
assert.equal(blank.untouched, 0, 'whitespace is not reported as untypable');
assert.equal(convert('qwerty', 'dvorak', '').output, '');
assert.equal(convert('dvorak', 'dvorak', 'hello').output, 'hello');
assert.equal(convert('qwerty', 'dvorak', 'Hello').mapped, 5, 'the same layout still walks every key');
const repeated = convert('qwerty', 'dvorak', '\u00e9\u00e9\u00e9');
assert.equal(repeated.untouched, 3);
assert.equal(JSON.stringify(repeated.unsupported), JSON.stringify(['\u00e9']), 'an untypable character is listed once');
assert.equal(JSON.stringify(convert('qwerty', 'dvorak', 'zb').unsupported), '[]', 'sorted output list stays empty here');

// ---- Refusals.
assert.equal(failure({ source: '', target: 'qwerty', text: 'x' }), 'Choose the layout the text came out as.');
assert.equal(failure({ source: 'azerty', target: 'qwerty', text: 'x' }), 'Choose the layout the text came out as.');
assert.equal(failure({ source: 'qwerty', target: '', text: 'x' }), 'Choose the layout you meant to type on.');
assert.equal(failure({ source: 'qwerty', target: 'workman', text: 'x' }), 'Choose the layout you meant to type on.');
assert.equal(failure({ source: null, target: 'qwerty', text: 'x' }), 'Choose the layout the text came out as.');

// ---- Catalog metadata and cases.
assert.equal(record.category, 'Encoding');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.legacyCategory, null);
assert.equal(record.listed, true);
assert.ok(record.description.length > 80);
assert.ok(record.method.length > 400);
assert.ok(record.guidance.length > 80);
assert.deepEqual(record.sources.map((source) => source.url), [
  'https://en.wikipedia.org/wiki/Dvorak_keyboard_layout',
  'https://en.wikipedia.org/wiki/Colemak'
]);
assert.match(record.sources[0].title, /Dvorak/);
assert.match(record.sources[1].title, /Colemak/);

const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 9, boundary: 7, validation: 4 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = C.convert(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(JSON.stringify(actual[key]), JSON.stringify(expected), testCase.name + ': ' + key);
  }
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(testCase.expected).sort(),
    'the case covers every result field: ' + testCase.name);
}

// ---- Uniqueness across the catalog.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
assert.equal(record.tags.length, new Set(record.tags).size, 'tags are internally unique');
assert.ok(record.tags.includes('encoding'));
assert.ok(record.aliases.length >= 1);
for (const alias of record.aliases) {
  assert.equal(catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase())).length,
  1, 'alias is unique: ' + alias);
}
assert.deepEqual(
  catalog.tools.filter((tool) => tool.slug !== slug && /dvorak|colemak|keyboard-layout/.test(tool.slug)).map((tool) => tool.slug),
  [],
  'no other layout tool exists'
);
assert.ok(catalog.tools.some((tool) => tool.slug === 'keyboard-tester'),
  'the keyboard tester stays a separate tool');

// ---- Page contract.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Keyboard Layout Converter<\/h1>/);
assert.match(html, /<form id="layout-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label for="/g) || []).length, 3, 'every control is labelled');
assert.equal((html.match(/<select/g) || []).length, 2);
assert.equal((html.match(/<textarea/g) || []).length, 1);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function|localStorage|sessionStorage/.test(html),
  'no network calls, no eval, no storage');
assert.ok(!/<iframe|<img|<canvas|<link rel="(?!stylesheet)/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored and nothing is sent/i, 'the privacy note stays on the page');
assert.match(html, /min-height:46px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* layout-core:start \*\//g) || []).length, 1);
assert.equal((html.match(/\/\* layout-core:end \*\//g) || []).length, 1);

const ids = ['layout-form', 'source', 'target', 'text', 'swap', 'clear', 'err', 'out', 'legend'];
for (const id of ids) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}

console.log('keyboard layout converter OK: ' + record.testCases.length +
  ' catalog cases, 3 layouts x 94 characters, 9 ordered round trips over 95 printable characters,' +
  ' pass-through accounting, refusals, uniqueness and page contract OK');
