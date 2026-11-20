/* Referrer-Policy resolution: the specification's 8x3 truth table, URL stripping,
   the page parser's refusals, the catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'referrer-policy-simulator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* rps-core:start */';
const endMarker = '/* rps-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RpsCore;', sandbox);
const C = sandbox.module.exports;

const PAGE = 'https://example.com/app/page.html?tab=1#top';
const CROSS = 'https://shop.example.net/checkout?step=2';
const SAME = 'https://example.com/other?q=2';
const DOWN = 'http://example.com/app/page.html?tab=1';
const run = (policy, page, target) => C.analyse({ page, target, policy });

// ---- Exported surface and constants.
assert.deepEqual(JSON.parse(JSON.stringify(Object.keys(C))).sort(),
  ['analyse', 'defaultPolicy', 'fallbackPolicy', 'parseUrl', 'policies']);
assert.deepEqual(JSON.parse(JSON.stringify(C.policies)), [
  'no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin',
  'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url'
]);
assert.equal(C.fallbackPolicy, 'no-referrer-when-downgrade');
assert.equal(C.defaultPolicy, 'strict-origin-when-cross-origin');

// ---- The specification's truth table, written out by hand from section 3:
// three relationships (same-origin, cross-origin, cross-origin downgrade) and eight
// policies. The downgrade column only exists for https page -> http target.
const ORIGIN = 'https://example.com/';
const FULL = 'https://example.com/app/page.html?tab=1';
const table = {
  'no-referrer':                        [null, null, null],
  'no-referrer-when-downgrade':         [FULL, FULL, null],
  'origin':                             [ORIGIN, ORIGIN, ORIGIN],
  'origin-when-cross-origin':           [FULL, ORIGIN, ORIGIN],
  'same-origin':                        [FULL, null, null],
  'strict-origin':                      [ORIGIN, ORIGIN, null],
  'strict-origin-when-cross-origin':    [FULL, ORIGIN, null],
  'unsafe-url':                         [FULL, FULL, FULL]
};
const relationships = {
  same: [PAGE, SAME],
  cross: [PAGE, CROSS],
  downgrade: [PAGE, DOWN]
};
for (const [policy, row] of Object.entries(table)) {
  for (const [index, name] of Object.keys(relationships).entries()) {
    const [page, target] = relationships[name];
    const result = run(policy, page, target);
    assert.equal(result.referrer, row[index], policy + ' / ' + name);
    assert.equal(result.mode, row[index] === null ? 'none' : (row[index] === ORIGIN ? 'origin' : 'full'),
      policy + ' / ' + name + ' mode');
  }
}

// ---- Same-origin, cross-origin and downgrade flags.
assert.equal(run('origin', PAGE, SAME).sameOrigin, true);
assert.equal(run('origin', PAGE, CROSS).sameOrigin, false);
assert.equal(run('origin', PAGE, DOWN).sameOrigin, false, 'a scheme change is not same-origin');
assert.equal(run('origin', PAGE, DOWN).downgrade, true);
assert.equal(run('origin', 'http://example.com/', 'https://example.com/').downgrade, false, 'http to https is an upgrade');
assert.equal(run('origin', PAGE, CROSS).relationship, 'cross-origin');
assert.equal(run('origin', PAGE, SAME).relationship, 'same-origin');
assert.equal(run('origin', PAGE, DOWN).relationship, 'cross-origin-downgrade');
assert.equal(run('origin', 'https://example.com:443/x', 'https://example.com/y').sameOrigin, true,
  'a default port does not split the origin');
assert.equal(run('origin', 'https://example.com:8443/x', 'https://example.com/y').sameOrigin, false);

// ---- The reference forms: fragment, userinfo and default ports are stripped; the
// origin form ends in a slash and the full form keeps path and query.
const stripped = C.parseUrl('https://user:secret@Example.COM:443/a/b?x=1&y=2#frag', 'Page URL');
assert.equal(stripped.url, 'https://example.com/a/b?x=1&y=2');
assert.equal(stripped.origin, 'https://example.com');
assert.equal(stripped.path, '/a/b');
assert.equal(stripped.query, '?x=1&y=2');
assert.equal(C.parseUrl('https://example.com', 'Page URL').path, '/');
assert.equal(C.parseUrl('http://example.com:80/x', 'Page URL').origin, 'http://example.com');
assert.equal(C.parseUrl('https://[2001:db8::1]:8443/x', 'Page URL').origin, 'https://[2001:db8::1]:8443');
assert.equal(C.parseUrl('https://[2001:db8::1]:443/x', 'Page URL').origin, 'https://[2001:db8::1]');
assert.equal(C.parseUrl('HTTPS://EXAMPLE.COM/A', 'Page URL').url, 'https://example.com/A',
  'only the scheme and host are case-folded');
for (const policy of C.policies) {
  const result = run(policy, PAGE, CROSS);
  if (result.referrer !== null) {
    assert.ok(result.referrer === FULL || result.referrer === ORIGIN, policy + ' sends one of the two reference forms');
    assert.equal(result.chars, result.referrer.length);
    assert.ok(!result.referrer.includes('#'), policy + ' never sends a fragment');
  } else {
    assert.equal(result.chars, 0);
  }
}

// ---- An empty policy is the fallback, and the default is the strict cross-origin form.
const fallback = run('', PAGE, CROSS);
assert.equal(fallback.policy, 'no-referrer-when-downgrade');
assert.equal(fallback.fallback, true);
assert.equal(fallback.referrer, FULL);
assert.equal(run('', PAGE, DOWN).referrer, null);
const asDefault = C.analyse({ page: PAGE, target: CROSS });
assert.equal(asDefault.policy, 'strict-origin-when-cross-origin');
assert.equal(asDefault.fallback, false);
assert.equal(asDefault.referrer, ORIGIN);

// ---- The page parser refuses rather than guesses.
const refused = (input) => {
  try { C.analyse(input); } catch (error) { return error.message; }
  return null;
};
const base = { page: PAGE, target: CROSS, policy: 'origin' };
assert.equal(refused({ ...base, page: '' }), 'Page URL is required.');
assert.equal(refused({ ...base, target: '  ' }), 'Link target URL is required.');
assert.equal(refused({ ...base, page: 'example.com/a' }), 'Page URL must start with http:// or https://.');
assert.equal(refused({ ...base, page: 'ftp://example.com/a' }), 'Page URL must start with http:// or https://.');
assert.equal(refused({ ...base, target: 'https:///a' }), 'Link target URL must include a host name.');
assert.equal(refused({ ...base, page: 'https://example.com/a b' }),
  'Page URL must use ASCII characters without spaces; percent-encode the rest.');
assert.equal(refused({ ...base, page: 'https://example.com/caf\u00e9' }),
  'Page URL must use ASCII characters without spaces; percent-encode the rest.');
assert.equal(refused({ ...base, page: 'https://example.com:0/a' }), 'Page URL has a port that is not a number up to 65535.');
assert.equal(refused({ ...base, page: 'https://example.com:65536/a' }), 'Page URL has a port that is not a number up to 65535.');
assert.equal(refused({ ...base, page: 'https://example.com:abc/a' }), 'Page URL has a port that is not a number up to 65535.');
assert.equal(refused({ ...base, page: 'https://exa mple.com/a' }),
  'Page URL must use ASCII characters without spaces; percent-encode the rest.');
assert.equal(refused({ ...base, policy: 'strict-origin-when-cross-origins' }), 'Choose a referrer policy from the list.');
assert.equal(refused({ ...base, policy: 'Strict-Origin' }), 'Choose a referrer policy from the list.');

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug appears once');
assert.equal(typeof record.method, 'string', 'method is a plain string');
assert.equal(record.category, 'Security');
assert.equal(record.risk, 'low');
assert.equal(record.listed, true);
assert.ok(Array.isArray(record.sources) && record.sources.length === 2);
for (const source of record.sources) assert.match(source.url, /^https:\/\//);

const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 8, validation: 7 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(refused(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = JSON.parse(JSON.stringify(C.analyse(testCase.input)));
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(actual[key], value, testCase.name + ': ' + key);
  }
}

// ---- Uniqueness across the catalog: slug, name, aliases and tags stay distinct.
const names = new Set();
const aliases = new Set();
for (const tool of catalog.tools) {
  names.add(tool.name.toLowerCase());
  for (const alias of tool.aliases || []) aliases.add(alias.toLowerCase());
}
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
for (const alias of record.aliases) {
  const owners = catalog.tools.filter((tool) => (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase()));
  assert.deepEqual(owners.map((tool) => tool.slug), [slug], 'alias is unique: ' + alias);
}
for (const tag of record.tags) assert.ok(tag.length > 1);

// ---- Page contract: one self-contained page on the shared shell.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Referrer-Policy Resolution Simulator<\/h1>/);
assert.match(html, /<form id="rp-form" novalidate>/);
assert.equal((html.match(/<select /g) || []).length, 1);
assert.equal((html.match(/<option /g) || []).length, 9, 'eight policies plus the not-set entry');
assert.equal((html.match(/<label class="f" for="in-/g) || []).length, 3, 'every control is labelled');
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(/.test(html), 'no network calls');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.match(html, /nothing is uploaded, stored or fetched/i, 'the privacy note stays on the page');
assert.equal((html.match(/\/\* rps-core:start \*\//g) || []).length, 1);

console.log('referrer-policy-simulator: truth table, parser, ' + record.testCases.length +
  ' catalog cases, uniqueness and page contract OK');
