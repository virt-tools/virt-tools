/* Regression checks for the systemd unit-name core, its catalog cases,
   randomised round-trips and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'systemd-unit-name-escaper';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* systemd-unit-name-core:start */');
const end = html.indexOf('/* systemd-unit-name-core:end */');
assert.ok(start > -1 && end > start, 'unit name core markers missing');
const core = html.slice(start, end + '/* systemd-unit-name-core:end */'.length);
const sandbox = { module: {}, TextEncoder, TextDecoder, Uint8Array };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SystemdUnitNameCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.solve(input));
const failure = (input) => {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// ---- Library surface.
assert.equal(C.MAX_LENGTH, 255);
assert.equal(C.MODES.length, 4);
assert.deepEqual(plain(C.MODES.map((mode) => mode.id)), [
  'path-to-unit', 'text-to-name', 'unit-to-path', 'name-to-text'
]);
assert.equal(C.SUFFIXES.length, 11);
assert.deepEqual(plain(C.SUFFIXES.map((suffix) => suffix.id)), [
  'service', 'socket', 'device', 'mount', 'automount', 'swap', 'target', 'path', 'timer', 'slice', 'scope'
]);

// ---- Golden conversions that match systemd-escape.
const mount = run({ mode: 'path-to-unit', value: '/var/lib/postgresql', suffix: 'mount' });
assert.equal(mount.result, 'var-lib-postgresql.mount');
assert.equal(mount.normalized, '/var/lib/postgresql');
assert.equal(mount.length, 24);
assert.equal(mount.separators, 2);
assert.equal(mount.escapes, 0);
assert.equal(mount.bytes, 0);
assert.deepEqual(mount.changes, [{ from: 'slash', to: '-', count: 2 }]);

const disk = run({ mode: 'path-to-unit', value: '/dev/disk/by-uuid/1234-abcd', suffix: 'device' });
assert.equal(disk.result, 'dev-disk-by\\x2duuid-1234\\x2dabcd.device');
assert.equal(disk.normalized, '/dev/disk/by-uuid/1234-abcd');
assert.equal(disk.separators, 3);
assert.equal(disk.escapes, 2);
assert.equal(disk.bytes, 2);

assert.equal(run({ mode: 'text-to-name', value: 'backup nightly', suffix: 'service' }).result,
  'backup\\x20nightly.service');
assert.equal(run({ mode: 'text-to-name', value: 'srv/data' }).result, 'srv-data');
assert.equal(run({ mode: 'text-to-name', value: 'café' }).result, 'caf\\xc3\\xa9');
assert.equal(run({ mode: 'text-to-name', value: '🚀' }).result, '\\xf0\\x9f\\x9a\\x80');
assert.equal(run({ mode: 'text-to-name', value: '.hidden' }).result, '\\x2ehidden');

// ---- The root path and normalization.
assert.equal(run({ mode: 'path-to-unit', value: '/' }).result, '-');
assert.equal(run({ mode: 'path-to-unit', value: '/', suffix: 'mount' }).result, '-.mount');
assert.equal(run({ mode: 'path-to-unit', value: '//srv//data//' }).result, 'srv-data');
assert.equal(run({ mode: 'path-to-unit', value: '/a/./b/' }).result, 'a-b');

// ---- Decoding mirrors encoding.
assert.equal(run({ mode: 'unit-to-path', value: 'var-lib-postgresql.mount', suffix: 'mount' }).result,
  '/var/lib/postgresql');
assert.equal(run({ mode: 'unit-to-path', value: '-' }).result, '/');
assert.equal(run({ mode: 'unit-to-path', value: 'a-b' }).result, '/a/b');
assert.equal(run({ mode: 'unit-to-path', value: 'a\\x2fb' }).result, '/a/b');
assert.equal(run({ mode: 'name-to-text', value: 'a\\x2db' }).result, 'a-b');
assert.equal(run({ mode: 'name-to-text', value: 'a\\x2Db' }).result, 'a-b');
assert.equal(run({ mode: 'name-to-text', value: 'caf\\xc3\\xa9' }).result, 'café');
assert.equal(run({ mode: 'name-to-text', value: 'backup\\x20nightly.service', suffix: 'service' }).result,
  'backup nightly');

// ---- Refusals name the problem and never guess.
assert.equal(failure({}), 'Choose a conversion direction from the list.');
assert.equal(failure({ mode: 'path-to-unit', value: 'var/lib' }),
  'A path used for a unit name must be absolute and start with /.');
assert.equal(failure({ mode: 'path-to-unit', value: '/a/../b' }),
  'Remove every .. component first: the path must already be normalized.');
assert.equal(failure({ mode: 'path-to-unit', value: '' }),
  'A path used for a unit name must be absolute and start with /.');
assert.equal(failure({ mode: 'text-to-name', value: '' }), 'Enter the text to escape.');
assert.equal(failure({ mode: 'text-to-name', value: 'a\u0000b' }),
  'A NUL character cannot appear in a unit name.');
assert.equal(failure({ mode: 'text-to-name', value: 'a'.repeat(256) }),
  'The escaped name is 256 characters; systemd unit names are limited to 255. Shorten the path or text.');
assert.equal(failure({ mode: 'path-to-unit', value: '/a', suffix: 'busname' }),
  'Choose a unit type from the list, or no suffix.');
assert.equal(failure({ mode: 'unit-to-path', value: '' }),
  'Enter an escaped unit name such as var-lib-postgresql.');
assert.equal(failure({ mode: 'unit-to-path', value: 'var-lib', suffix: 'mount' }),
  'The name does not end in .mount; choose the right unit type or none.');
assert.equal(failure({ mode: 'name-to-text', value: 'a\\x2' }),
  'An escape must be written \\xHH with exactly two hexadecimal digits.');
assert.equal(failure({ mode: 'name-to-text', value: 'a\\xZZ' }),
  'An escape must be written \\xHH with exactly two hexadecimal digits.');
assert.equal(failure({ mode: 'name-to-text', value: 'a\\x00b' }),
  '\\x00 cannot appear in a unit name.');
assert.equal(failure({ mode: 'name-to-text', value: 'a\\xffb' }),
  'The escape sequences are not valid UTF-8.');
assert.equal(failure({ mode: 'name-to-text', value: 'a b' }),
  '" " cannot appear unescaped in an escaped unit name.');
assert.equal(failure({ mode: 'name-to-text', value: '.hidden' }),
  'A unit name cannot begin with an unescaped dot.');
assert.equal(failure({ mode: 'name-to-text', value: 'café' }),
  'An escaped unit name is ASCII; escape non-ASCII text before decoding.');
assert.equal(failure({ mode: 'unit-to-path', value: 'a'.repeat(256) }),
  'The name is 256 characters; systemd unit names are limited to 255.');

// ---- The 255-character boundary is inclusive.
assert.equal(run({ mode: 'text-to-name', value: 'a'.repeat(255) }).length, 255);
assert.equal(run({ mode: 'text-to-name', value: 'a'.repeat(247), suffix: 'service' }).length, 255);
assert.equal(failure({ mode: 'text-to-name', value: 'a'.repeat(248), suffix: 'service' }),
  'The escaped name is 256 characters; systemd unit names are limited to 255. Shorten the path or text.');

// ---- Independent oracle: allowed characters, slash to hyphen, UTF-8 bytes.
const ALLOWED = /^[A-Za-z0-9:_.]$/;
const hexByte = (byte) => '\\x' + byte.toString(16).padStart(2, '0');
const oracleEscape = (text) => {
  let result = '';
  Array.from(text).forEach((char, index) => {
    if (char === '/') {
      result += '-';
      return;
    }
    if (ALLOWED.test(char) && !(index === 0 && char === '.')) {
      result += char;
      return;
    }
    for (const byte of Buffer.from(char, 'utf8')) result += hexByte(byte);
  });
  return result;
};

let seed = 20261109;
const pick = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed;
};
const alphabet = Array.from('abcXYZ019 :_.-/@%\\#!?&+*=,;\'"\t').concat(['é', 'ü', '€', '中', '🚀']);
for (let index = 0; index < 400; index += 1) {
  const length = pick() % 18;
  let text = '';
  for (let position = 0; position < length; position += 1) {
    text += alphabet[pick() % alphabet.length];
  }
  if (text === '') continue;
  const result = run({ mode: 'text-to-name', value: text });
  assert.equal(result.result, oracleEscape(text), 'oracle at ' + index + ' for ' + JSON.stringify(text));
  assert.equal(result.length, result.result.length);
  assert.ok(result.length <= 255);

  // Round-trip through the decoder, with and without a suffix.
  assert.equal(run({ mode: 'name-to-text', value: result.result }).result, text, 'round-trip at ' + index);
  const withSuffix = run({ mode: 'text-to-name', value: text, suffix: 'service' });
  assert.equal(run({ mode: 'name-to-text', value: withSuffix.result, suffix: 'service' }).result, text,
    'suffixed round-trip at ' + index);
}

// ---- Independent path oracle: escape each component, join with hyphens.
const components = ['var', 'lib', 'postgresql', 'my app', 'data-set', '.hidden', 'a.b', 'a:b', 'c_d', 'Ünïcode', '1234-abcd'];
for (let index = 0; index < 250; index += 1) {
  const depth = 1 + (pick() % 4);
  const parts = [];
  for (let position = 0; position < depth; position += 1) {
    parts.push(components[pick() % components.length]);
  }
  const value = '/' + parts.join('/');
  // The leading slash is dropped before escaping, so only a dot at the very
  // start of the joined body is escaped; later component dots stay literal.
  const expected = oracleEscape(parts.join('/'));
  const result = run({ mode: 'path-to-unit', value });
  assert.equal(result.result, expected, 'path oracle at ' + index + ' for ' + value);
  assert.equal(result.normalized, value);
  assert.equal(run({ mode: 'unit-to-path', value: result.result }).result, value,
    'path round-trip at ' + index);
}

// ---- The page must not reach the network, store data or inject markup.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="escape-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<h1>systemd Unit Name Escaper<\/h1>/.test(html), 'page heading');
assert.ok(/name="viewport"/.test(html), 'viewport');
assert.ok(/<meta name="description" content="[^"]{80,}"/.test(html), 'meta description');
for (const id of ['mode', 'value', 'suffix', 'output', 'copy', 'err', 'result', 'changes', 'notes']) {
  assert.ok(new RegExp('id="' + id + '"').test(html), 'page has #' + id);
}
assert.ok(/for="mode"/.test(html) && /for="value"/.test(html) && /for="suffix"/.test(html), 'labels are bound');
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 10, 'the page looks up its controls');
for (const id of requestedIds) {
  assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
}
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/min-height:44px/.test(html), 'touch targets');
assert.ok(/@media \(max-width:620px\)/.test(html), 'mobile layout');

// Every els.<name> used by the page must be looked up: an undefined entry
// would throw before the listeners are attached and leave the page inert.
const elsStart = html.indexOf('var els = {');
assert.ok(elsStart > -1, 'page defines its element map');
const elsLiteral = html.slice(elsStart, html.indexOf('\n  };', elsStart));
const definedNames = new Set([...elsLiteral.matchAll(/^\s{4}([A-Za-z]+):/gm)].map((match) => match[1]));
const elsUsers = html.slice(elsStart, html.indexOf('setModeLabels();\n  convert();'));
const usedNames = new Set([...elsUsers.matchAll(/\bels\.([A-Za-z]+)/g)].map((match) => match[1]));
assert.ok(usedNames.size >= 8, 'the page uses its element map');
for (const name of usedNames) {
  assert.ok(definedNames.has(name), 'els.' + name + ' is used but never looked up');
}

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'systemd Unit Name Escaper');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('255'), 'method documents the length limit');
assert.ok(record.sources.length >= 2, 'sources are recorded');
assert.equal(record.testCases.length, 22, 'catalog case count');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(kinds('golden'), 7, 'seven golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('edge'), 3, 'three edge cases');
assert.equal(kinds('validation'), 8, 'eight validation cases');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug is unique');
for (const testCase of record.testCases) {
  const { input, expected } = testCase;
  if (expected.error) {
    assert.equal(failure(input), expected.error, testCase.name);
    continue;
  }
  const result = run(input);
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result[key], value, testCase.name + ' ' + key);
  }
}

console.log('systemd unit name escaper: all checks passed');
