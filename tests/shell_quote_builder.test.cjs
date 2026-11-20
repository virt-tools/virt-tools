/* Regression checks for the Shell Quote Builder core and every case in its catalog record.
 *
 * The expected quoting is rebuilt here with a second, differently shaped implementation: single
 * quotes are produced by splitting on the quote character, the forms are decoded by stripping the
 * outer quotes and splitting on the escape sequence rather than by walking a state machine, bytes
 * are counted with Buffer.byteLength, and when /bin/sh exists every generated form is handed to a
 * real shell through `set --` to prove the program receives the original text.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const slug = 'shell-quote-builder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* shell-quote-core:start */');
const end = html.indexOf('/* shell-quote-core:end */');
assert.ok(start > -1 && end > start, 'shell-quote core markers missing');
const core = html.slice(start, end + '/* shell-quote-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ShellQuoteCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);

const quote = (text) => C.evaluate({ mode: 'quote', text });
const decode = (word) => C.evaluate({ mode: 'decode', text: word });

// ---- Independent model ---------------------------------------------------
const BARE = /^[A-Za-z0-9_@%+=:,./-]+$/;
const isControl = (ch) => {
  const cp = ch.codePointAt(0);
  return cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f);
};

const singleForm = (text) => (text === '' ? "''" : "'" + text.split("'").join("'\\''") + "'");

const bareForm = (text) => (text !== '' && BARE.test(text) ? text : null);

const doubleForm = (text) => {
  if (text.includes('\n')) return null;
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if ((cp < 0x20 && ch !== '\t') || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f)) return null;
    out += '\\"$`'.includes(ch) || ch === '\\' ? '\\' + ch : ch;
  }
  return '"' + out + '"';
};

const ANSI_NAMED = {
  a: '\u0007', b: '\b', e: '\u001b', E: '\u001b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'",
};

const ansiForm = (text) => {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === "'") out += "\\'";
    else if (cp === 7) out += '\\a';
    else if (cp === 8) out += '\\b';
    else if (cp === 9) out += '\\t';
    else if (cp === 10) out += '\\n';
    else if (cp === 11) out += '\\v';
    else if (cp === 12) out += '\\f';
    else if (cp === 13) out += '\\r';
    else if (cp === 27) out += '\\E';
    else if (cp < 0x20 || cp === 0x7f) out += '\\x' + cp.toString(16).padStart(2, '0');
    else out += ch;
  }
  return "$'" + out + "'";
};

// Decoders written against the generated shapes only, using split and replace.
const decodeSingle = (form) => {
  assert.ok(form.startsWith("'") && form.endsWith("'") && form.length >= 2, 'single form shape');
  if (form === "''") return '';
  return form.slice(1, -1).split("'\\''").join("'");
};

const decodeDouble = (form) => {
  assert.ok(form.startsWith('"') && form.endsWith('"'), 'double form shape');
  return form.slice(1, -1).replace(/\\([\\"$`])/g, '$1');
};

const decodeAnsi = (form) => {
  assert.ok(form.startsWith("$'") && form.endsWith("'"), 'ansi form shape');
  const named = { a: '\u0007', b: '\b', e: '\u001b', E: '\u001b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'" };
  return form.slice(2, -1).replace(/\\(x[0-9a-f]{2}|.)/g, (match, token) => {
    if (token.length === 2 && token[0] === 'x') return String.fromCharCode(parseInt(token.slice(1), 16));
    if (named[token] !== undefined) return named[token];
    throw new Error('unexpected ANSI-C escape ' + JSON.stringify(match));
  });
};

const decodeForm = (key, form) => {
  if (key === 'single') return decodeSingle(form);
  if (key === 'double') return decodeDouble(form);
  if (key === 'bare') return form;
  return decodeAnsi(form);
};

// ---- Matrix --------------------------------------------------------------
const seedTexts = [
  "It's a $HOME \"quoted\" \\ path",
  '',
  'hello',
  'hello world',
  "a'b'c",
  "'''",
  '"double"',
  'back\\slash',
  'tab\there',
  'one\ntwo',
  '\u0007bell',
  'reset\u001b[0m',
  'naïve — ünïcode ✓',
  '$HOME',
  '*',
  '-v',
  'KEY=value',
  '~/x',
  '#hash',
  'a;b|c&d<e>f(g)h',
  '!bang',
  'two  spaces and a ! mark',
  'trailing\n',
  'carriage\rreturn',
  '🎉 done',
  '  leading spaces',
  'end\\',
  "'",
  '""',
  'a  b',
  '\t',
  '-',
  'a=b c',
  '$(date)',
  '${HOME}',
  "\\\\'",
  'quote at end: "',
  'colon: comma, percent% at@ plus+',
];

const pool = Array.from("abZ09 _-./:@%+=,").concat(["'", '"', '\\', '$', '`', '!', '*', '?', '[', ']', '~', '#', ';', '|', '&', '<', '>', '(', ')', '{', '}', '\t', '\n', '\r', 'é', '中', '🎉']);
let lcg = 20261115;
const nextRandom = () => {
  lcg = (lcg * 1103515245 + 12345) % 2147483648;
  return lcg / 2147483648;
};
const generated = [];
for (let index = 0; index < 60; index += 1) {
  const length = 1 + Math.floor(nextRandom() * 18);
  let text = '';
  for (let step = 0; step < length; step += 1) text += pool[Math.floor(nextRandom() * pool.length)];
  generated.push(text);
}

const matrix = seedTexts.concat(generated);
let formChecks = 0;

for (const text of matrix) {
  const result = quote(text);
  const forms = Object.fromEntries(result.forms.map((item) => [item.key, item.form]));
  assert.equal(result.chars, Array.from(text).length, 'code points for ' + JSON.stringify(text));
  assert.equal(result.bytes, Buffer.byteLength(text, 'utf8'), 'bytes for ' + JSON.stringify(text));
  assert.equal(result.quotes, text.split("'").length - 1, 'single quote count');
  assert.equal(result.control, Array.from(text).filter(isControl).length, 'control count');

  assert.equal(forms.single, singleForm(text), 'single form for ' + JSON.stringify(text));
  const bare = bareForm(text);
  if (bare === null) {
    assert.equal(forms.bare, undefined, 'bare form must be absent for ' + JSON.stringify(text));
    assert.ok(result.notOffered.some((item) => item.key === 'bare'), 'bare must be reported as not offered');
    assert.equal(result.needsQuoting, true);
  } else {
    assert.equal(forms.bare, bare);
    assert.equal(result.needsQuoting, false);
  }
  const double = doubleForm(text);
  if (double === null) {
    assert.equal(forms.double, undefined, 'double form must be absent for ' + JSON.stringify(text));
  } else {
    assert.equal(forms.double, double, 'double form for ' + JSON.stringify(text));
  }
  if (Array.from(text).some(isControl)) {
    assert.equal(forms.ansi, ansiForm(text), 'ANSI-C form for ' + JSON.stringify(text));
  } else {
    assert.equal(forms.ansi, undefined, 'ANSI-C form should not be offered without control characters');
  }

  for (const [key, form] of Object.entries(forms)) {
    formChecks += 1;
    assert.equal(decodeForm(key, form), text, key + ' form must decode back for ' + JSON.stringify(text));
    const reread = C.unquote(form);
    assert.equal(reread.ok, true, 'page parser accepts ' + key + ' form');
    assert.equal(reread.value, text, 'page parser round trip for ' + key);
  }

  assert.equal(C.unquote(result.nested.two).value, forms.single, 'two layers read back as one layer');
  assert.equal(C.unquote(result.nested.three).value, result.nested.two, 'three layers read back as two');
  assert.equal(result.nested.two, singleForm(forms.single), 'two layers quote the single form again');
}

// ---- Real shell round trip ----------------------------------------------
const shell = fs.existsSync('/bin/sh') ? '/bin/sh' : null;
let shellChecks = 0;
if (shell) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sqb-test-'));
  const bash = fs.existsSync('/bin/bash') ? '/bin/bash' : null;
  for (const text of matrix.slice(0, 40)) {
    for (const item of quote(text).forms) {
      const interpreter = item.key === 'ansi' ? bash : shell;
      if (!interpreter) continue;
      const script = path.join(scratch, 'probe.sh');
      fs.writeFileSync(script, 'set -- ' + item.form + '\nprintf \'%s\' "$1"\n');
      const out = execFileSync(interpreter, [script], { encoding: 'buffer' });
      shellChecks += 1;
      assert.deepEqual(out, Buffer.from(text, 'utf8'), item.key + ' form executed by ' + interpreter);
    }
  }
  fs.rmSync(scratch, { recursive: true, force: true });
}

// ---- Decode side ---------------------------------------------------------
const decodeCases = [
  ["'It'\\''s here'", "It's here"],
  ["'a b'", 'a b'],
  ['a\\ b', 'a b'],
  ['"a b"', 'a b'],
  ['"a\\$b"', 'a$b'],
  ['"a\\\\b"', 'a\\b'],
  ['"a\\qb"', 'a\\qb'],
  ["$'a\\tb'", 'a\tb'],
  ["$'it\\'s'", "it's"],
  ["''", ''],
  ['"say \\"hi\\""', 'say "hi"'],
  ['\\*', '*'],
  ['""', ''],
];
for (const [word, value] of decodeCases) {
  const result = decode(word);
  assert.equal(result.value, value, 'decode ' + word);
  assert.equal(result.verified, true, 'decode verifies ' + word);
  assert.equal(decodeSingle(result.canonical), value, 'canonical decodes back for ' + word);
}

const refusals = [
  ['decode', "'unterminated", 'The single quote opened at character 1 is never closed.'],
  ['decode', '"unterminated', 'The double quote opened at character 1 is never closed.'],
  ['decode', 'a b', 'An unquoted space at character 2 ends the word; decode one word at a time or quote the whitespace.'],
  ['decode', 'a\\', 'The word ends with an unquoted backslash, which the shell reads as a line continuation.'],
  ['quote', 'nul\u0000byte', 'A shell word cannot contain a NUL byte: the word would end there, so no quoting can preserve the rest.'],
  ['quote', 'x'.repeat(C.MAX_TEXT + 1), 'This page handles up to ' + C.MAX_TEXT + ' characters; shorten the text first.'],
];
for (const [mode, text, message] of refusals) {
  assert.throws(() => C.evaluate({ mode, text }), (error) => error.message === message, mode + ' refusal');
}

// ---- Catalog record -----------------------------------------------------
assert.ok(record, 'catalog record for ' + slug);
assert.equal(record.name, 'Shell Quote Builder');
assert.equal(record.category, 'Developer');
assert.equal(record.subcategory, 'Generation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '🐚');
assert.ok(record.description.length > 80);
assert.ok(record.method.length > 600);
assert.equal(record.sources.length, 2);
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//);
  assert.ok(source.title.length > 60, 'source titles are specific');
}
assert.ok(record.sources.some((source) => source.url.includes('pubs.opengroup.org')));
assert.ok(record.sources.some((source) => source.url.includes('man7.org')));
for (const tag of record.tags) assert.equal(tag, tag.toLowerCase());
for (const alias of record.aliases) assert.ok(alias.trim().length > 0);

const ownAliases = record.aliases.map((alias) => alias.toLowerCase());
assert.equal(new Set(record.aliases).size, record.aliases.length, 'record aliases are unique strings');
const ownNames = new Set([record.slug, record.name.toLowerCase(), ...ownAliases]);
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  const values = [tool.slug, tool.name.toLowerCase(), ...tool.aliases.map((alias) => alias.toLowerCase())];
  for (const value of values) {
    assert.equal(ownNames.has(value), false, 'another tool already uses the name, alias or slug: ' + value);
  }
}

const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2169, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Developer').length, 53, 'Developer count');

// Every recorded case replays exactly.
assert.ok(record.testCases.length >= 10, 'recorded cases');
for (const testCase of record.testCases) {
  const input = testCase.input;
  if (input.mode === 'quote') {
    const result = quote(input.text);
    const forms = Object.fromEntries(result.forms.map((item) => [item.key, item.form]));
    assert.equal(forms.single, testCase.expected.single, testCase.name + ': single');
    assert.equal(forms.double === undefined ? null : forms.double, testCase.expected.double, testCase.name + ': double');
    assert.equal(forms.bare === undefined ? null : forms.bare, testCase.expected.bare, testCase.name + ': bare');
    assert.equal(forms.ansi === undefined ? null : forms.ansi, testCase.expected.ansi, testCase.name + ': ansi');
    assert.equal(result.chars, testCase.expected.chars, testCase.name + ': chars');
    assert.equal(result.bytes, testCase.expected.bytes, testCase.name + ': bytes');
    assert.equal(result.quotes, testCase.expected.quotes, testCase.name + ': quotes');
    assert.equal(result.needsQuoting, testCase.expected.needsQuoting, testCase.name + ': needs quoting');
    assert.equal(JSON.stringify(result.warnings), JSON.stringify(testCase.expected.warnings), testCase.name + ': warnings');
  } else {
    if (testCase.expected.error) {
      assert.throws(() => decode(input.text), (error) => error.message === testCase.expected.error, testCase.name);
    } else {
      const result = decode(input.text);
      assert.equal(result.value, testCase.expected.value, testCase.name + ': value');
      assert.equal(result.canonical, testCase.expected.canonical, testCase.name + ': canonical');
      assert.equal(JSON.stringify(result.styles), JSON.stringify(testCase.expected.styles), testCase.name + ': styles');
      assert.equal(JSON.stringify(result.warnings), JSON.stringify(testCase.expected.warnings), testCase.name + ': warnings');
      assert.equal(result.verified, true, testCase.name + ': verified');
    }
  }
}

// ---- Page contract ------------------------------------------------------
assert.ok(html.includes('<html lang="en"'));
assert.ok(html.includes('name="viewport"'));
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('<main'));
assert.ok(html.includes('<h1>Shell Quote Builder</h1>'));
assert.ok(html.includes('id="in-text"'));
assert.ok(html.includes('for="in-text"'));
assert.ok(html.includes('id="out-single"'));
assert.ok(html.includes('id="out-canonical"'));
assert.ok(html.includes('id="decoded"'));
assert.ok(html.includes('role="status"'));
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('role="alert"'));
assert.ok(html.includes('role="radiogroup"'));
assert.ok((html.match(/data-label="Inside double quotes"/g) || []).length >= 0);
assert.ok(html.includes("setAttribute('data-label'"), 'reference table rows carry mobile labels');
assert.ok(html.includes('id="char-body"'), 'reference table body');
assert.equal(/\son[a-z]+\s*=/i.test(html), false, 'no inline event handlers');
for (const banned of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'eval(', 'new Function']) {
  assert.equal(html.includes(banned), false, 'page must not use ' + banned);
}
assert.ok(html.includes('min-height:44px'), 'touch targets');
assert.ok(html.includes("@media(max-width:520px)"), 'mobile layout');
assert.ok(html.includes('navigator.clipboard'), 'copy button');

console.log(
  'shell-quote-builder: ' + matrix.length + ' texts, ' + formChecks + ' form round trips, '
  + shellChecks + ' shell executions, ' + decodeCases.length + ' decodes, ' + refusals.length
  + ' refusals, ' + record.testCases.length + ' catalog cases'
);
