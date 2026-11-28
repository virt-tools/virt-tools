/* Permissions-Policy Builder: the serialization rules, the catalog cases, an
   independent header-shape check, and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'permissions-policy-builder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* pp-core:start */';
const endMarker = '/* pp-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PpCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const refusal = (input) => {
  try { C.build(input); } catch (error) { return error.message; }
  return null;
};

// ---- The exported surface, the built-in feature list and the defaults.
assert.deepEqual(plain(Object.keys(C)).sort(), ['build', 'defaults', 'features', 'knownFeature']);
assert.ok(C.features.length >= 30, 'the feature list covers the common names');
assert.equal(new Set(C.features).size, C.features.length, 'feature names are unique');
for (const name of C.features) assert.match(name, /^[a-z][a-z0-9-]*$/, `feature name ${name}`);
for (const name of ['camera', 'microphone', 'geolocation', 'fullscreen', 'payment', 'usb', 'screen-wake-lock']) {
  assert.ok(C.features.includes(name), `${name} is offered`);
}
assert.ok(C.knownFeature('geolocation') && !C.knownFeature('vibrate'), 'knownFeature agrees with the list');
assert.equal(C.defaults.length, 4);

// ---- Every emitted header is a well-formed structured-field dictionary: one
// member per feature, and inside a list only bare keywords and quoted origins.
const parseHeader = (header) => {
  const members = [];
  let depth = 0;
  let current = '';
  for (const letter of header) {
    if (letter === '(') depth += 1;
    if (letter === ')') depth -= 1;
    if (letter === ',' && depth === 0) { members.push(current.trim()); current = ''; continue; }
    current += letter;
  }
  if (current.trim()) members.push(current.trim());
  assert.equal(depth, 0, 'balanced parentheses');
  return members.map((member) => {
    const split = member.indexOf('=');
    assert.ok(split > 0, `member ${member} has a name`);
    const name = member.slice(0, split);
    const value = member.slice(split + 1);
    assert.match(name, /^[a-z][a-z0-9-]*$/, `member name ${name}`);
    if (value === '*' || value === 'self' || value === 'src' || value === '()') return { name, value, items: [] };
    assert.ok(value.startsWith('(') && value.endsWith(')'), `value ${value} is a list or a token`);
    const items = value.slice(1, -1).split(' ').filter(Boolean);
    for (const item of items) {
      if (item === 'self' || item === 'src') continue;
      assert.match(item, /^"[^"\s]+"$/, `origin ${item} is quoted`);
    }
    return { name, value, items };
  });
};

const sample = C.build({ directives: [
  { feature: 'camera', allowlist: 'self' },
  { feature: 'geolocation', allowlist: 'self https://maps.example.com https://*.example.com' },
  { feature: 'fullscreen', allowlist: '*' },
  { feature: 'payment', allowlist: '' }
] });
assert.equal(sample.header, 'camera=self, geolocation=(self "https://maps.example.com" "https://*.example.com"), fullscreen=*, payment=()');
const members = parseHeader(sample.header);
assert.equal(members.length, 4);
assert.equal(members[0].value, 'self');
assert.deepEqual(members[1].items, ['self', '"https://maps.example.com"', '"https://*.example.com"']);
assert.equal(members[2].value, '*');
assert.equal(members[3].value, '()');

// ---- Normalization is a second, independent rule: lowercase the scheme and
// host, drop 443 for https and 80 for http, and keep any other port.
const reference = (scheme, host, port) => {
  const lowered = scheme.toLowerCase() + '://' + host.toLowerCase();
  if ((scheme.toLowerCase() === 'https' && port === '443') || (scheme.toLowerCase() === 'http' && port === '80')) return lowered;
  return port ? lowered + ':' + port : lowered;
};
for (const [scheme, host, port] of [
  ['HTTPS', 'Example.COM', ''],
  ['https', 'app.example.com', '443'],
  ['http', 'example.com', '80'],
  ['https', 'example.com', '8443'],
  ['https', '*.example.com', ''],
  ['https', 'example.com', '*']
]) {
  const typed = scheme + '://' + host + (port ? ':' + port : '');
  const built = C.build({ directives: [{ feature: 'camera', allowlist: typed }] });
  assert.equal(built.header, 'camera=("' + reference(scheme, host, port) + '")', `normalizes ${typed}`);
}

// ---- Order is the order of the directives, and each member appears once.
const ordered = C.build({ directives: [
  { feature: 'usb', allowlist: '' },
  { feature: 'camera', allowlist: 'self' }
] });
assert.equal(ordered.header, 'usb=(), camera=self');
assert.equal(ordered.count, 2);

// ---- A keyword with quotes, a legacy none, a combined wildcard and a path are
// all refused rather than silently dropped by the browser.
assert.equal(refusal({ directives: [{ feature: 'camera', allowlist: '"self"' }] }),
  '"self" is a keyword and takes no quotes in a header; write self on its own.');
assert.equal(refusal({ directives: [{ feature: 'camera', allowlist: "'self'" }] }),
  '"self" is a keyword and takes no quotes in a header; write self on its own.');
assert.equal(refusal({ directives: [{ feature: 'camera', allowlist: "'none'" }] }),
  'Use () for an empty allowlist instead of none.');
assert.equal(refusal({ directives: [{ feature: 'camera', allowlist: '* self' }] }),
  '"*" cannot be combined with other allowlist values.');
assert.equal(refusal({ directives: [{ feature: 'camera', allowlist: 'https://example.com/app' }] }),
  '"https://example.com/app" includes a path; a source is an origin (scheme, host and port).');
assert.equal(refusal({ directives: [{}] }), 'A feature name is required.');

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(catalog.tools.length, 2525, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2264, 'public tools');
assert.ok(entry.testCases.length >= 30, `expected at least 30 cases, found ${entry.testCases.length}`);

for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(
      () => C.build(testCase.input),
      (error) => {
        assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
        return true;
      },
      `${label}: expected a refusal`
    );
    continue;
  }
  const result = C.build(testCase.input);
  assert.equal(result.header, testCase.expected.header, `${label}: header`);
  assert.equal(result.count, testCase.expected.count, `${label}: directive count`);
  assert.deepEqual(plain(result.warnings), testCase.expected.warnings, `${label}: warnings`);
  parseHeader(result.header);
  const names = result.directives.map((item) => item.feature);
  assert.equal(new Set(names).size, names.length, `${label}: no repeated member`);
}

// ---- Identity, naming and metadata.
const others = catalog.tools.filter((tool) => tool.slug !== entry.slug);
const folded = new Set();
for (const tool of others) {
  folded.add(tool.slug);
  folded.add(tool.name.toLowerCase());
  for (const alias of tool.aliases || []) folded.add(alias.toLowerCase());
}
assert.ok(!folded.has(entry.slug), 'slug collides');
assert.ok(!folded.has(entry.name.toLowerCase()), 'name collides');
for (const alias of entry.aliases) assert.ok(!folded.has(alias.toLowerCase()), `alias collides: ${alias}`);
assert.ok(entry.tags.includes('permissions-policy') && entry.tags.includes('header'));
assert.equal(entry.category, 'Security');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Security').length, 58, 'Security count');
assert.equal(entry.listed, true);
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.ok(entry.sources.length >= 2);
assert.ok(entry.sources.every((source) => source.url && source.url.startsWith('https://')), 'https sources');
assert.ok(entry.sources.some((source) => source.url.includes('developer.mozilla.org')), 'MDN cited');
assert.ok(entry.sources.some((source) => source.url.includes('w3c')), 'spec cited');
assert.ok(!/https?:\/\//.test(entry.description), 'no links in the description');
assert.match(entry.method, /report-to/, 'the unmodelled parameter is disclosed');

// ---- Page contract: the shared shell, labelled controls, no dynamic code or network.
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.match(html, /href="\/assets\/style\.css"/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.equal((html.match(/<h1>/g) || []).length, 1);
assert.ok(!/\beval\s*\(/.test(html), 'eval is not allowed');
assert.ok(!/new\s+Function\s*\(/.test(html), 'new Function is not allowed');
assert.ok(!/\.innerHTML\s*=/.test(html), 'innerHTML is not allowed');
assert.ok(!/XMLHttpRequest|fetch\(|sendBeacon|WebSocket/.test(html), 'no network calls');
const pageUrls = (html.match(/https?:\/\/[^\s"'<>]+/g) || [])
  .filter((url) => !url.includes('www.w3.org'))
  .filter((url) => !/(^|[./])example\.(com|net|org)([:/]|$)/.test(url));
assert.deepEqual(pageUrls, [], 'page markup is offline');
for (const id of ['in-feature', 'in-allowlist']) {
  assert.ok(html.includes(`for="${id}"`) && html.includes(`id="${id}"`), `control ${id}`);
}
for (const id of ['pp-form', 'err', 'policy', 'count', 'header-out', 'summary', 'warnings', 'feature-names', 'add', 'reset', 'copy', 'method']) {
  assert.ok(html.includes(`id="${id}"`), `container ${id}`);
}
assert.ok(!/<button(?![^>]*\btype=)/.test(html), 'every button declares a type');
assert.match(html, /role="alert"/);
assert.match(html, /aria-live="polite"/);
assert.ok(!/\bsrc="\/(?!assets\/)/.test(html), 'only shared assets are loaded');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
assert.match(html, /\[hidden\]\{display:none!important\}/, 'hidden nodes stay hidden');
assert.match(html, /<datalist id="feature-names"><\/datalist>/);

console.log(`permissions policy builder: ${entry.testCases.length} catalog cases replayed`);
