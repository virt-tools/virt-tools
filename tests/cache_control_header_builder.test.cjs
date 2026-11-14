/* Regression checks for the Cache-Control header core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'cache-control-header-builder';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* cache-control-core:start */');
const end = html.indexOf('/* cache-control-core:end */');
assert.ok(start > -1 && end > start, 'Cache-Control core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '\nmodule.exports = CacheControl;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Developer');
assert.equal(entry.subcategory, 'Generation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.reviewedAt, null);
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 10, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 3, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 800, 'method documented');
assert.ok(entry.testCases.length >= 8, 'catalog cases present');
assert.equal(catalog.tools.length, 2283, 'catalog total');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Developer').length, 45, 'Developer count');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');
const aliases = catalog.tools.flatMap((tool) => (tool.slug === slug ? [] : tool.aliases || []))
  .map((alias) => alias.toLowerCase());
for (const alias of entry.aliases) {
  assert.ok(!aliases.includes(alias.toLowerCase()), `alias ${alias} is already used`);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug &&
  /cache[- ]control|max-age|no-store|stale-while-revalidate/i.test(
    [tool.name, ...(tool.aliases || []), ...(tool.tags || [])].join(' '))),
'no other cache-control builder');

const failure = (input) => {
  try {
    C.compute(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// --- Documented directive order and defaults. ---
assert.deepEqual(Array.from(C.ORDER), ['public', 'private', 'no-store', 'no-cache', 'must-revalidate',
  'proxy-revalidate', 'no-transform', 'immutable', 'max-age', 's-maxage',
  'stale-while-revalidate', 'stale-if-error']);
assert.deepEqual(Object.keys(C.PRESETS).sort(), ['html', 'immutable', 'nostore', 'private', 'swr']);
assert.equal(C.CAP, 31536000);

// --- Catalog golden cases. ---
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expected.error, `${testCase.name} error`);
    continue;
  }
  const result = C.compute(testCase.input);
  assert.equal(result.header, testCase.expected.header, `${testCase.name} header`);
  assert.equal(result.verdict.key, testCase.expected.verdict, `${testCase.name} verdict`);
  assert.equal(result.warnings.length, testCase.expected.warnings, `${testCase.name} warnings`);
  assert.deepEqual(Array.from(result.rows, (row) => row.name), testCase.expected.rows, `${testCase.name} rows`);
}

// --- Each preset builds a sane header. ---
for (const [key, preset] of Object.entries(C.PRESETS)) {
  const result = C.compute(preset);
  assert.ok(result.header.length > 0, `${key} header non-empty`);
  assert.equal(result.header.split(', ').length, result.selected.length, `${key} join`);
  assert.equal(result.nginx, `add_header Cache-Control "${result.header}" always;`);
  assert.equal(result.express, `res.set('Cache-Control', '${result.header}');`);
  for (const part of result.selected) {
    assert.ok(result.header.includes(part), `${key} contains ${part}`);
  }
}

// --- Values are only emitted when a field has one. ---
const blank = { visibility: 'none', maxAge: '', sMaxAge: '', staleWhileRevalidate: '', staleIfError: '',
  noStore: false, noCache: false, mustRevalidate: false, proxyRevalidate: false, immutable: false, noTransform: false };
assert.equal(failure(blank), 'Choose at least one directive: an empty Cache-Control tells caches nothing.');
assert.equal(C.compute({ ...blank, noTransform: true }).header, 'no-transform');
assert.equal(C.compute({ ...blank, maxAge: '0' }).header, 'max-age=0');
assert.equal(C.compute({ ...blank, sMaxAge: '120', visibility: 'public' }).header, 'public, s-maxage=120');

// --- Freshness is reported per audience. ---
const shared = C.compute({ visibility: 'public', maxAge: '60', sMaxAge: '600', staleWhileRevalidate: '',
  staleIfError: '', noStore: false, noCache: false, mustRevalidate: false, proxyRevalidate: false,
  immutable: false, noTransform: false });
assert.equal(shared.stats.browser, '1 minute');
assert.equal(shared.stats.shared, '10 minutes');
assert.equal(shared.stats.stored, 'yes');
assert.equal(shared.stats.revalidate, 'not while fresh');

const privateOnly = C.compute({ ...blank, visibility: 'private', maxAge: '300' });
assert.equal(privateOnly.stats.browser, '5 minutes');
assert.equal(privateOnly.stats.shared, 'not stored');

const never = C.compute({ ...blank, visibility: 'private', noStore: true });
assert.equal(never.stats.browser, 'not stored');
assert.equal(never.stats.shared, 'not stored');
assert.equal(never.stats.revalidate, 'n/a');

const check = C.compute({ ...blank, visibility: 'public', noCache: true, mustRevalidate: true });
assert.equal(check.stats.browser, 'revalidated');
assert.equal(check.stats.revalidate, 'every reuse');

// --- Conflicts are named, not silently dropped. ---
const warningsFor = (input) => C.compute({ ...blank, ...input }).warnings;

assert.equal(warningsFor({ noStore: true, maxAge: '60' }).length, 1);
assert.match(warningsFor({ noStore: true, maxAge: '60' })[0], /no-store wins/);
assert.match(warningsFor({ immutable: true })[0], /immutable needs a positive max-age/);
assert.match(warningsFor({ immutable: true, maxAge: '0' })[0], /immutable needs a positive max-age/);
assert.match(warningsFor({ noCache: true, maxAge: '60' })[0], /no-cache requires validation/);
assert.match(warningsFor({ noCache: true, mustRevalidate: true })[0], /must-revalidate adds nothing/);
assert.match(warningsFor({ proxyRevalidate: true, sMaxAge: '60' })[0], /already implies proxy-revalidate/);
assert.match(warningsFor({ visibility: 'private', sMaxAge: '60' })[0], /private forbids them from storing/);
assert.match(warningsFor({ staleWhileRevalidate: '600' })[0], /need a stored response with a freshness window/);
assert.match(warningsFor({ maxAge: '31536001' })[0], /clamped by caches to 31536000/);
assert.equal(warningsFor({ maxAge: '31536000', immutable: true }).length, 0);
assert.equal(warningsFor({ visibility: 'public', maxAge: '86400' }).length, 0);

// Notes cover heuristic freshness, max-age=0 and the unstated visibility.
assert.match(C.compute({ ...blank, visibility: 'public' }).notes.join(' '), /heuristic period/);
assert.match(C.compute({ ...blank, maxAge: '0' }).notes.join(' '), /max-age=0 lets a cache store/);
assert.match(C.compute({ ...blank, visibility: 'none', maxAge: '60' }).notes.join(' '), /Neither public nor private is stated/);

// --- Input validation. ---
assert.equal(failure({ ...blank, maxAge: '-1' }), 'max-age must be a whole number of seconds, with no sign, unit or decimal point.');
assert.equal(failure({ ...blank, maxAge: '1.5' }), 'max-age must be a whole number of seconds, with no sign, unit or decimal point.');
assert.equal(failure({ ...blank, maxAge: '1e3' }), 'max-age must be a whole number of seconds, with no sign, unit or decimal point.');
assert.equal(failure({ ...blank, sMaxAge: '1000000000' }), 's-maxage cannot exceed 999999999 seconds.');
assert.equal(failure({ ...blank, visibility: 'sometimes', maxAge: '60' }),
  'Choose whether the response is public, private or unstated.');
assert.equal(failure({ ...blank, noStore: 'perhaps', maxAge: '60' }), 'Directive no-store must be on or off.');
assert.equal(failure({ ...blank, visibility: 'public', maxAge: '   ' }), null);
assert.equal(C.compute({ ...blank, visibility: 'public', maxAge: '   ' }).header, 'public');

// --- Human durations. ---
assert.equal(C.humanDuration(0), '0 s');
assert.equal(C.humanDuration(1), '1 second');
assert.equal(C.humanDuration(90), '1.5 minutes');
assert.equal(C.humanDuration(3600), '1 hour');
assert.equal(C.humanDuration(86400), '1 day');
assert.equal(C.humanDuration(604800), '7 days');
assert.equal(C.humanDuration(31536000), '1 year');

// --- Independent model over generated configurations. ---
const ORDER = ['public', 'private', 'no-store', 'no-cache', 'must-revalidate', 'proxy-revalidate',
  'no-transform', 'immutable', 'max-age', 's-maxage', 'stale-while-revalidate', 'stale-if-error'];
const numberPool = ['', '0', '1', '60', '300', '86400', '31536000'];
const flagKeys = ['noStore', 'noCache', 'mustRevalidate', 'proxyRevalidate', 'immutable', 'noTransform'];
const flagNames = { noStore: 'no-store', noCache: 'no-cache', mustRevalidate: 'must-revalidate',
  proxyRevalidate: 'proxy-revalidate', immutable: 'immutable', noTransform: 'no-transform' };
let seed = 20261114;
const next = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pickFrom = (list) => list[Math.floor(next() * list.length)];

for (let index = 0; index < 400; index += 1) {
  const input = {
    visibility: pickFrom(['public', 'private', 'none']),
    maxAge: pickFrom(numberPool),
    sMaxAge: pickFrom(numberPool),
    staleWhileRevalidate: pickFrom(numberPool),
    staleIfError: pickFrom(numberPool)
  };
  for (const key of flagKeys) input[key] = next() < 0.5;
  const parts = [];
  if (input.visibility === 'public') parts.push('public');
  if (input.visibility === 'private') parts.push('private');
  for (const key of flagKeys) if (input[key]) parts.push(flagNames[key]);
  if (input.maxAge !== '') parts.push('max-age=' + Number(input.maxAge));
  if (input.sMaxAge !== '') parts.push('s-maxage=' + Number(input.sMaxAge));
  if (input.staleWhileRevalidate !== '') parts.push('stale-while-revalidate=' + Number(input.staleWhileRevalidate));
  if (input.staleIfError !== '') parts.push('stale-if-error=' + Number(input.staleIfError));
  if (parts.length === 0) {
    parts.push('no-transform');
    input.noTransform = true;
  }
  const ordered = ORDER.filter((name) => parts.some((part) => part === name || part.startsWith(name + '=')))
    .map((name) => parts.find((part) => part === name || part.startsWith(name + '=')));

  const result = C.compute(input);
  assert.equal(result.header, ordered.join(', '), `generated ${index} header`);
  assert.deepEqual(Array.from(result.selected), ordered, `generated ${index} selected`);
  assert.deepEqual(Array.from(result.rows, (row) => row.name), ordered.map((part) => part.split('=')[0]),
    `generated ${index} rows`);
  const stored = !input.noStore;
  assert.equal(result.stats.stored, stored ? 'yes' : 'no', `generated ${index} stored`);
  const sharedValue = input.sMaxAge !== '' ? Number(input.sMaxAge) : (input.maxAge !== '' ? Number(input.maxAge) : null);
  const expectedShared = input.noStore || input.visibility === 'private' ? 'not stored'
    : input.noCache ? 'revalidated'
      : sharedValue !== null ? C.humanDuration(sharedValue) : 'heuristic';
  assert.equal(result.stats.shared, expectedShared, `generated ${index} shared freshness`);
  assert.ok(!result.header.includes('undefined'), `generated ${index} has no undefined`);
  assert.ok(!/\s{2}|,\s*,|,$/.test(result.header), `generated ${index} formatting`);
  assert.equal(result.nginx.split(result.header).length, 2, `generated ${index} nginx snippet`);
}

// --- Page contract. ---
assert.match(html, /<h1>Cache-Control Header Builder<\/h1>/);
assert.match(html, /id="header-out"/);
assert.match(html, /role="status" aria-live="polite"/);
assert.match(html, /type="submit"/);
for (const id of ['preset', 'visibility', 'max-age', 's-maxage', 'stale-while-revalidate', 'stale-if-error',
  'no-store', 'no-cache', 'must-revalidate', 'proxy-revalidate', 'immutable', 'no-transform']) {
  assert.ok(html.includes(`for="${id}"`), `label for ${id}`);
}
assert.ok(!/onclick=|oninput=|onchange=/.test(html), 'no inline event handlers');
assert.ok(!/https?:\/\//.test(html.replace(/https:\/\/www\.rfc-editor\.org[^"]*/g, '')), 'no remote assets');

console.log(`cache-control-header-builder: ${entry.testCases.length} catalog cases and 400 generated configurations passed`);
