/* OAuth redirect URI checker: replays every catalog case, re-checks the matching rules
   against an independent construction, and pins the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'oauth-redirect-uri-checker';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* redirect-uri-core:start */';
const endMarker = '/* redirect-uri-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|navigator\.|fetch\(|localStorage|XMLHttpRequest/.test(core),
  'the core stays free of DOM, storage and network access');

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RedirectUriCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(catalog.tools.length, 2518, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2257, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Security').length, 58, 'Security count');
assert.equal(entry.category, 'Security', 'category');
assert.equal(entry.subcategory, 'Analysis & validation', 'subcategory');
assert.equal(entry.risk, 'moderate', 'risk');
assert.equal(entry.maturity, 'draft', 'maturity');
assert.equal(entry.listed, true, 'listed');
assert.equal(entry.testCases.length, 25, `expected 25 cases, found ${entry.testCases.length}`);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'golden').length, 14, 'goldens pinned');
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'validation').length, 11, 'refusals pinned');
assert.ok(entry.sources.some((source) => /rfc6749\.html(#|$)/.test(source.url || '')), 'RFC 6749 cited');
assert.ok(entry.sources.some((source) => /rfc8252\.html(#|$)/.test(source.url || '')), 'RFC 8252 cited');
assert.ok(entry.sources.some((source) => /rfc3986\.html(#|$)/.test(source.url || '')), 'RFC 3986 cited');
assert.ok(/redirect_uri/.test(entry.description), 'description names redirect_uri');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'aliases are internally unique');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'tags are internally unique');

// ---- Catalog cases: every golden and every refusal, replayed through the page core.
for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(() => C.run(testCase.input), (error) => error.message === testCase.expected.error, label);
    continue;
  }
  const result = C.run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.equal(result[key], value, `${label}: ${key}`);
  }
  assert.equal(result.rows.length, result.registeredCount, `${label}: one row per registration`);
  assert.equal(result.warnings.length, result.warningCount, `${label}: warning array`);
}

const base = () => ({ registered: 'https://app.example.com/cb', requested: 'https://app.example.com/cb',
  mode: 'full', platform: 'web' });
const run = (over) => C.run(Object.assign(base(), over));

// ---- Exact matching: a full registration matches its own string and nothing else.
assert.equal(run({}).rule, 'exact', 'an identical string matches exactly');
for (const variant of [
  'https://app.example.com/cb/', 'https://app.example.com/CB', 'https://app.example.com:443/cb',
  'https://app.example.com/cb?', 'https://app.example.com/cb?x=1', 'http://app.example.com/cb',
  'https://app.example.com./cb'
]) {
  const result = run({ requested: variant });
  assert.equal(result.allowed, false, `a different string must not match: ${variant}`);
  assert.equal(result.closestIndex, 1, `closest entry reported for ${variant}`);
}
assert.equal(run({ requested: 'https://app.example.com/cb?', mode: 'components' }).allowed, true,
  'components mode leaves the query free');

// ---- Loopback exception: only the port may vary, only on http, only for the IP literals.
for (const port of [1024, 8080, 65535]) {
  const result = run({ registered: 'http://127.0.0.1:8080/cb', requested: `http://127.0.0.1:${port}/cb` });
  assert.equal(result.allowed, true, `loopback port ${port} is allowed`);
  assert.equal(result.rule, port === 8080 ? 'exact' : 'loopback', `rule at port ${port}`);
}
assert.equal(run({ registered: 'http://[::1]:8080/cb', requested: 'http://[::1]:60000/cb' }).rule,
  'loopback', 'IPv6 loopback port may vary');
for (const requested of [
  'http://127.0.0.1:9000/cbx', 'http://127.0.0.1:9000/cb?state=1',
  'https://127.0.0.1:9000/cb', 'http://localhost:9000/cb', 'http://127.0.0.2:9000/cb'
]) {
  const result = run({ registered: 'http://127.0.0.1:8080/cb', requested });
  assert.equal(result.allowed, false, `the exception must not widen beyond the port: ${requested}`);
}
assert.equal(run({ registered: 'http://localhost:8080/cb', requested: 'http://localhost:9000/cb' }).allowed,
  false, 'localhost is compared literally, not as a loopback IP literal');
assert.equal(run({ registered: 'https://app.example.com:8443/cb', requested: 'https://app.example.com:443/cb' })
  .difference, 'port', 'a plain port mismatch is reported');

// ---- Components registration: scheme, authority and path as written, query optional.
const components = { registered: 'https://app.example.com/cb', mode: 'components' };
assert.equal(run(Object.assign({ requested: 'https://app.example.com/cb?code=1&state=2' }, components)).rule,
  'query', 'a query the registration does not pin is accepted');
assert.equal(run(Object.assign({ requested: 'https://app.example.com/CB?code=1' }, components)).allowed,
  false, 'the path is still compared as written');
assert.equal(run(Object.assign({ requested: 'https://app.example.com:443/cb?code=1' }, components)).allowed,
  false, 'the authority is still compared as written');
assert.equal(run(Object.assign({ requested: 'http://app.example.com/cb?code=1' }, components)).allowed,
  false, 'the scheme is still compared as written');
assert.equal(run({ registered: 'https://app.example.com/cb?tenant=a', requested: 'https://app.example.com/cb?tenant=b',
  mode: 'components' }).difference, 'query', 'a registered query stays pinned');

// ---- Refusals carry the page's own messages.
const refusal = (input) => {
  try { C.run(input); } catch (error) { return error.message; }
  return '';
};
assert.equal(refusal({ registered: 'https://a/cb', requested: '' }), 'Enter the redirect_uri the client would send.');
assert.match(refusal({ registered: 'https://a/cb', requested: 'https://a/cb#x' }), /must not include a fragment/);
assert.match(refusal({ registered: 'https://a/cb', requested: 'https://a/cb x' }), /must not contain a space/);
assert.match(refusal({ registered: '', requested: 'https://a/cb' }), /at least one registered redirect URI/);
assert.match(refusal({ registered: 'https://a/cb', requested: 'a/cb' }), /absolute URI with a scheme/);
assert.match(refusal({ registered: 'https://a/cb', requested: 'https://a:12x/cb' }), /port that is not a number/);
assert.match(refusal({ registered: 'https://a/cb', requested: 'https://a/cb', mode: 'none' }), /registration mode/);
assert.match(refusal({ registered: 'https://a/cb', requested: 'https://a/cb', platform: 'tv' }), /client platform/);

// ---- Bad registrations are skipped, not fatal, and counted.
const mixed = run({ registered: 'ftp:/x#frag\nhttps://app.example.com/cb\nhttps://app.example.com:abc/cb' });
assert.equal(mixed.allowed, true, 'one good entry still matches');
assert.equal(mixed.validCount, 1, 'one valid entry');
assert.equal(mixed.invalidCount, 2, 'fragment and non-numeric port are skipped');
assert.equal(mixed.rows[0].problem, 'contains a fragment', 'fragment reason');
assert.equal(mixed.rows[2].problem, 'has a port that is not a number', 'port reason');

// ---- Determinism: repeated calls agree, the input is untouched, strings and numbers are accepted.
const frozen = Object.freeze(base());
assert.deepEqual(C.run(frozen), C.run(frozen), 'repeated calls agree');
assert.equal(frozen.requested, 'https://app.example.com/cb', 'the input object is not modified');
assert.equal(C.run({ registered: 'https://a/cb', requested: 'https://a/cb' }).allowed, true,
  'mode and platform default when omitted');

// ---- Page contract: labelled fields, announced results, no outbound requests.
assert.ok(/<form id="redirect-form"/.test(html), 'form present');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
for (const id of ['in-registered', 'in-requested', 'in-mode', 'in-platform']) {
  assert.ok(new RegExp(`<label class="f" for="${id}"`).test(html), `label for ${id}`);
  assert.ok(new RegExp(`id="${id}"`).test(html), `control ${id}`);
}
assert.ok(html.includes('/assets/theme-init.js') && html.includes('/assets/app.js'), 'shared assets');
const offsite = html.match(/https?:\/\/[^\s"'<>]+/g) || [];
assert.deepEqual(
  offsite.filter((url) => !/^https?:\/\/(app\.)?example\.com\//.test(url)
    && !/^https?:\/\/www\.w3\.org\//.test(url)),
  [], 'no external reference beyond the RFC 2606 examples');
assert.ok(!/\son(click|change|input|submit|load|error|focus|blur|keydown|keyup)\s*=/.test(html), 'no inline event handlers');
assert.ok(!/\beval\s*\(|new Function\s*\(/.test(html), 'no dynamic code evaluation');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), 'no network or storage');
assert.ok(/<button class="primary" type="submit">/.test(html), 'a submit button');
assert.ok(/id="reset"/.test(html), 'a reset button');
assert.ok(/id="copy"/.test(html), 'a copy button');
assert.ok(!/class="back"|← All tools/.test(html), 'navigation stays in the shared shell');

console.log('oauth redirect URI checker suite ok');
