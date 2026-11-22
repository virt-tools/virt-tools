/* iSCSI name builder: an independent RFC 7143 validator, a seeded sweep of
   built and mutated names, catalog replay and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'iscsi-name-builder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* iscsi-name-core:start */';
const endMarker = '/* iscsi-name-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = IscsiNameCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.solve(input));
const failure = (input) => {
  try { C.solve(input); } catch (error) { return error.message; }
  return null;
};
const bytes = (text) => Buffer.byteLength(text, 'utf8');

// ---- An independent validator, written from the RFC 7143 text and not from the page.
const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
function oracleIqn(name) {
  if (!/^iqn\./.test(name)) return false;
  const body = name.slice(4);
  const match = /^(\d{4})-(0[1-9]|1[0-2])\.([a-z0-9.:-]+)$/.exec(body);
  if (!match) return false;
  const colon = match[3].indexOf(':');
  const authority = colon === -1 ? match[3] : match[3].slice(0, colon);
  const suffix = colon === -1 ? '' : match[3].slice(colon + 1);
  if (colon !== -1 && (suffix === '' || suffix.endsWith(':'))) return false;
  const labels = authority.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => label.length > 0 && label.length <= 63 && LABEL.test(label));
}
function oracleValid(name) {
  if (bytes(name) > 223) return false;
  if (/^iqn\./.test(name)) return oracleIqn(name);
  if (/^eui\./.test(name)) return /^eui\.[0-9A-Fa-f]{16}$/.test(name);
  if (/^naa\./.test(name)) {
    const identifier = name.slice(4);
    return /^[0-9A-Fa-f]+$/.test(identifier)
      && identifier.length >= 2 && identifier.length <= 32 && identifier.length % 2 === 0;
  }
  return false;
}
function reverse(domain) { return domain.split('.').reverse().join('.'); }

// ---- The names printed in RFC 7143 section 4.2.7 are valid exactly as printed.
const anchors = [
  'iqn.2001-04.com.example:storage:diskarrays-sn-a8675309',
  'iqn.2001-04.com.example',
  'iqn.2001-04.com.example:storage.tape1.sys1.xyz',
  'iqn.2001-04.com.example:storage.disk2.sys1.xyz',
  'eui.02004567A425678D',
  'naa.52004567BA64678D',
  'naa.62004567BA64678D0123456789ABCDEF'
];
for (const name of anchors) {
  assert.equal(oracleValid(name), true, 'the oracle accepts ' + name);
  const result = run({ mode: 'check', name });
  assert.equal(result.valid, true, 'the page accepts ' + name + ': ' + result.errors.join('; '));
  assert.deepEqual(result.errors, [], name);
}
const anchor = run({ mode: 'build', date: '2001-04', domain: 'example.com', suffix: 'storage:diskarrays-sn-a8675309' });
assert.equal(anchor.name, 'iqn.' + '2001-04' + '.' + reverse('example.com') + ':' + 'storage:diskarrays-sn-a8675309', 'RFC example assembled');
assert.equal(anchor.length, bytes(anchor.name), 'length counts characters');
assert.deepEqual(anchor.warnings, [], 'no warning on the RFC example');

// The date code in the name is the month the naming authority owned the domain,
// so the same domain can produce a different, equally valid name in another month.
const otherMonth = run({ mode: 'build', date: '2026-11', domain: 'example.com', suffix: '' });
assert.equal(otherMonth.name, 'iqn.2026-11.com.example', 'date code comes from the month field');

// ---- The 223-byte boundary, in both directions.
const PREFIX = 'iqn.2026-11.com.example:';
assert.equal(PREFIX.length, 24);
const exactly = PREFIX + 'a'.repeat(199);
assert.equal(exactly.length, 223);
const built223 = run({ mode: 'build', date: '2026-11', domain: 'example.com', suffix: 'a'.repeat(199) });
assert.equal(built223.length, 223, 'a 223-character name is built');
assert.deepEqual(built223.warnings, [C.WARNINGS.long.replace('{n}', '223')], 'the long-name warning fires');
assert.equal(run({ mode: 'check', name: exactly }).valid, true, '223 characters is accepted');
assert.equal(failure({ mode: 'build', date: '2026-11', domain: 'example.com', suffix: 'a'.repeat(200) }),
  C.MESSAGES.tooLong.replace('{n}', '224'), '224 characters is refused when building');
const tooLongCheck = run({ mode: 'check', name: exactly + 'a' });
assert.equal(tooLongCheck.valid, false);
assert.ok(tooLongCheck.errors.indexOf(C.MESSAGES.nameTooLong.replace('{n}', '224')) > -1, 'the check reports 224 bytes');

// ---- A seeded sweep: build random valid names, then read each one back.
let seed = 20261122;
function random() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function pick(list) { return list[Math.floor(random() * list.length)]; }
function label() {
  const length = 1 + Math.floor(random() * 12);
  let text = 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(random() * 36));
  for (let index = 1; index < length - 1; index += 1) {
    text += 'abcdefghijklmnopqrstuvwxyz0123456789-'.charAt(Math.floor(random() * 37));
  }
  if (length > 1) text += 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(random() * 36));
  return text;
}
function domainOf(count) {
  const labels = [];
  for (let index = 0; index < count; index += 1) labels.push(label());
  return labels.join('.');
}
function suffixOf() {
  if (random() < 0.4) return '';
  const parts = [];
  const count = 1 + Math.floor(random() * 3);
  for (let index = 0; index < count; index += 1) {
    const length = 1 + Math.floor(random() * 8);
    let text = 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(random() * 36));
    for (let step = 1; step < length; step += 1) {
      text += 'abcdefghijklmnopqrstuvwxyz0123456789.-'.charAt(Math.floor(random() * 38));
    }
    parts.push(text);
  }
  return parts.join(':');
}
const built = [];
for (let index = 0; index < 1500; index += 1) {
  const year = 1985 + Math.floor(random() * 46);
  const month = 1 + Math.floor(random() * 12);
  const date = String(year) + '-' + String(month).padStart(2, '0');
  const domain = domainOf(2 + Math.floor(random() * 3));
  const suffix = suffixOf();
  const result = run({ mode: 'build', date, domain, suffix });
  const expected = 'iqn.' + date + '.' + reverse(domain) + (suffix === '' ? '' : ':' + suffix);
  assert.equal(result.name, expected, 'generated name: ' + expected);
  assert.equal(result.dateCode, date, 'date code kept');
  assert.equal(result.domain, domain, 'domain kept');
  assert.equal(result.authority, reverse(domain), 'authority reversed');
  assert.equal(result.suffix, suffix, 'suffix kept');
  assert.equal(result.length, bytes(expected), 'length in bytes');
  assert.ok(result.length <= 223, 'generated name within the limit');
  const readBack = run({ mode: 'check', name: result.name });
  assert.equal(readBack.valid, true, 'a built name is valid: ' + result.name + ' ' + readBack.errors.join('; '));
  assert.equal(readBack.type, 'iqn', 'read back as iqn');
  assert.deepEqual(readBack.parts, { dateCode: date, authority: reverse(domain), suffix }, 'parts read back: ' + result.name);
  assert.equal(oracleValid(result.name), true, 'the oracle agrees the built name is valid: ' + result.name);
  built.push(result.name);
}

// ---- Mutations: the page and the oracle must agree on validity.
let agreements = 0;
const mutations = built.slice(0, 700);
for (const name of mutations) {
  const body = name.slice(4);
  const variants = [
    name.toUpperCase(),
    'iqn.' + body.replace('-', '--'),
    'iqn.' + body.replace(/\./, ''),
    'iqn.' + body.replace(/:/, '@'),
    'iqn.' + body.replace(/^(....)-/, '$1_'),
    'iqn.' + body.replace(/^(\d{4})-(\d{2})/, '$1-13'),
    'iqn.' + body.replace(/^(\d{4})/, '20'),
    'iqn.' + body + ':extra',
    'iqn.' + body + ':',
    'eui.' + body,
    'naa.' + body,
    body,
    name + 'X',
    'iqn.' + body.replace(/\.([a-z0-9]+)$/, '.$1.')
  ];
  for (const variant of variants) {
    const result = run({ mode: 'check', name: variant });
    assert.equal(result.valid, oracleValid(variant), 'page and oracle agree: ' + JSON.stringify(variant));
    agreements += 1;
  }
}
assert.ok(agreements > 8000, 'the sweep covers both verdicts');

// ---- Hex forms: lengths and digits.
const hexChecks = [
  ['eui.02004567A425678D', true],
  ['eui.02004567a425678d', true],
  ['eui.02004567A425678', false],
  ['eui.02004567A425678G', false],
  ['eui.02004567A42567890', false],
  ['naa.52004567BA64678D', true],
  ['naa.52004567ba64678d', true],
  ['naa.62004567BA64678D0123456789ABCDEF', true],
  ['naa.5', false],
  ['naa.52004567BA64678', false],
  ['naa.52004567BA64678D0', false],
  ['naa.52004567BA64678Z', false],
  ['naa.5200456789ABCDEF0123456789ABCDEF00', false],
  ['eui.02004567A425678D0', false]
];
for (const [name, expected] of hexChecks) {
  assert.equal(oracleValid(name), expected, 'the oracle verdict for ' + name);
  assert.equal(run({ mode: 'check', name }).valid, expected, 'the page verdict for ' + name);
}
const unusual = run({ mode: 'check', name: 'naa.52004567BA64' });
assert.equal(unusual.valid, true, 'a 12-digit naa. identifier is still hexadecimal');
assert.deepEqual(unusual.warnings, [C.WARNINGS.naaUnusual.replace('{n}', '12')], 'the unusual length is noted');

// ---- Domain rules: accepted forms and the exact refusal for each broken one.
const goodDomains = [
  ['example.com', 'com.example'],
  ['storage.example.co.uk', 'uk.co.example.storage'],
  ['a-b.example', 'example.a-b'],
  ['x1.y2.z3', 'z3.y2.x1'],
  ['EXAMPLE.COM', 'com.example'],
  ['example.com.', 'com.example']
];
for (const [domain, authority] of goodDomains) {
  const result = run({ mode: 'build', date: '2026-11', domain, suffix: '' });
  assert.equal(result.authority, authority, 'reversed ' + domain);
  assert.equal(result.name, 'iqn.2026-11.' + authority, 'built from ' + domain);
}
assert.equal(run({ mode: 'build', date: '2026-11', domain: 'EXAMPLE.COM', suffix: '' }).normalized, true, 'case is normalised');
assert.equal(run({ mode: 'build', date: '2026-11', domain: 'example.com', suffix: '' }).normalized, false, 'a clean domain is not normalised');

const badDomains = [
  ['localhost', C.MESSAGES.singleLabel],
  ['example..com', C.MESSAGES.labelEdge],
  ['-example.com', C.MESSAGES.labelEdge],
  ['example-.com', C.MESSAGES.labelEdge],
  ['exa_mple.com', C.MESSAGES.badLabelChar],
  ['exa mple.com', C.MESSAGES.scheme],
  ['https://example.com', C.MESSAGES.scheme],
  ['user@example.com', C.MESSAGES.scheme],
  ['a'.repeat(64) + '.com', C.MESSAGES.labelLong],
  ['', C.MESSAGES.emptyDomain]
];
for (const [domain, message] of badDomains) {
  assert.equal(failure({ mode: 'build', date: '2026-11', domain, suffix: '' }), message, 'refusal for ' + JSON.stringify(domain));
  assert.equal(oracleValid('iqn.2026-11.' + reverse(domain.toLowerCase())), false, 'the oracle rejects ' + JSON.stringify(domain));
}

// ---- Date and suffix refusals, pinned by exact message.
const refusals = [
  [{ mode: 'build', date: '', domain: 'example.com', suffix: '' }, C.MESSAGES.dateFormat],
  [{ mode: 'build', date: '26-11', domain: 'example.com', suffix: '' }, C.MESSAGES.dateFormat],
  [{ mode: 'build', date: '2026-1', domain: 'example.com', suffix: '' }, C.MESSAGES.dateFormat],
  [{ mode: 'build', date: '2026/11', domain: 'example.com', suffix: '' }, C.MESSAGES.dateFormat],
  [{ mode: 'build', date: '2026-13', domain: 'example.com', suffix: '' }, C.MESSAGES.monthRange],
  [{ mode: 'build', date: '2026-00', domain: 'example.com', suffix: '' }, C.MESSAGES.monthRange],
  [{ mode: 'build', date: '2026-11', domain: 'example.com', suffix: 'disk one' }, C.MESSAGES.suffixChar],
  [{ mode: 'build', date: '2026-11', domain: 'example.com', suffix: 'disk_one' }, C.MESSAGES.suffixChar],
  [{ mode: 'build', date: '2026-11', domain: 'example.com', suffix: 'storage::disk' }, C.MESSAGES.suffixSegment],
  [{ mode: 'build', date: '2026-11', domain: 'example.com', suffix: 'storage:' }, C.MESSAGES.suffixSegment],
  [{ mode: 'nonsense' }, C.MESSAGES.badMode],
  [{ mode: 'build', date: '2026-11', domain: 'example.com', suffix: 'x'.repeat(300) }, C.MESSAGES.tooLong.replace('{n}', '324')]
];
for (const [input, message] of refusals) {
  assert.equal(failure(input), message, JSON.stringify(input));
}

// The check tab reports every structural problem it finds, in reading order.
const broken = run({ mode: 'check', name: 'iqn.01-04.com.example' });
assert.equal(broken.valid, false);
assert.deepEqual(broken.errors, [C.MESSAGES.iqnDate], 'a two-digit year is refused');
const brokenDot = run({ mode: 'check', name: 'iqn.2001-04' });
assert.deepEqual(brokenDot.errors, [C.MESSAGES.iqnDot], 'the missing dot is named');
const brokenChar = run({ mode: 'check', name: 'iqn.2001-04.com.example:storage_disk' });
assert.deepEqual(brokenChar.errors, [C.MESSAGES.suffixChar], 'the suffix character set is reported');
const empty = run({ mode: 'check', name: '' });
assert.deepEqual(empty.errors, [C.MESSAGES.emptyName], 'an empty name is refused');
const prefix = run({ mode: 'check', name: 'fc.2001-04.com.example' });
assert.deepEqual(prefix.errors, [C.MESSAGES.badPrefix], 'an unknown type designator is named');

// ---- Catalog replay: every case in the shipped record.
function loadCatalog() {
  return JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
}
const catalog = loadCatalog();
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(entry.category, 'IT & Networking', 'category');
assert.equal(entry.risk, 'low', 'risk');
assert.equal(entry.listed, true, 'listed');
assert.ok(entry.method && entry.method.length > 700, 'the method explains the naming rules');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 2, 'two sources');
assert.ok(entry.sources.every((source) => /^https:\/\/www\.rfc-editor\.org\//.test(source.url)), 'sources point at the RFC editor');
assert.ok(entry.testCases.length >= 20, 'enough catalog cases');
const kinds = (kind) => entry.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(kinds('golden'), 8);
assert.equal(kinds('boundary'), 6);
assert.equal(kinds('validation'), 17);
for (const testCase of entry.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], value, testCase.name + ' ' + key);
  }
}

// ---- Uniqueness: no other record claims this slug, name or alias.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [entry.slug, entry.name].concat(entry.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'aliases are internally unique');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'tags are internally unique');
for (const tag of ['it-&-networking', 'storage', 'iscsi', 'iqn', 'naming']) {
  assert.ok(entry.tags.includes(tag), 'new tag present: ' + tag);
}
// No other tool already offers an iSCSI name.
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  const haystack = [tool.slug, tool.name, tool.description, (tool.aliases || []).join(' '), (tool.tags || []).join(' ')]
    .join(' ').toLowerCase();
  assert.ok(!/iscsi|iqn\.|qualified name/.test(haystack), 'no duplicate: ' + tool.slug);
}

// ---- The page stays self-contained, offline and keyboard accessible.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="build-form"'), 'build form missing');
assert.ok(html.includes('<form id="check-form"'), 'check form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('<div id="site-header"></div>'), 'shared header hook missing');
const controls = ['iqn-date', 'iqn-domain', 'iqn-suffix', 'name-input'];
for (const id of controls) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id + ' missing');
}
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
assert.ok(!/type="hidden"/i.test(html), 'no hidden inputs');
assert.ok((html.match(/<button /g) || []).length === 6, 'two tabs and four actions');
assert.ok(!/autocomplete="on"/.test(html), 'inputs are not autocompleted');

console.log('iscsi name builder: ' + entry.testCases.length + ' catalog cases, '
  + built.length + ' built names read back, ' + agreements + ' mutated verdicts agreed, '
  + anchors.length + ' RFC anchors and ' + refusals.length + ' refusals pass');
