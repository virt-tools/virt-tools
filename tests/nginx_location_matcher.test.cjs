/* Regression checks for the nginx location matcher core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'nginx-location-matcher';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* nginx-location-core:start */');
const end = html.indexOf('/* nginx-location-core:end */');
assert.ok(start > -1 && end > start, 'nginx location core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '\nmodule.exports = NginxLocation;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Developer');
assert.equal(entry.subcategory, 'Analysis & validation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.reviewedAt, null);
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 10, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 3, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 800, 'method documented');
assert.ok(entry.testCases.length >= 8, 'catalog cases present');
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Developer').length, 52, 'Developer count');

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
  /nginx|location block|location precedence/i.test([tool.name, ...(tool.aliases || []), ...(tool.tags || [])].join(' '))),
'no other nginx tool');

const failure = (input) => {
  try {
    C.analyze(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// --- Parser. ---
const parsed = C.parseLocations('location = /a { }\n\nlocation ^~ /b/ {\n  root /srv;\n}\nlocation ~ \\.php$ { }');
assert.equal(parsed.length, 3);
assert.deepEqual(Array.from(parsed, (block) => [block.modifier, block.pattern]),
  [['=', '/a'], ['^~', '/b/'], ['~', '\\.php$']]);
assert.deepEqual(Array.from(parsed, (block) => block.line), [1, 3, 6]);
assert.equal(failure({ config: 'server { listen 80; }', uri: '/' }),
  'No location blocks found: each one needs the form location [modifier] pattern {.');
assert.equal(failure({ config: 'location / { }\nlocation / { }', uri: '/' }),
  'Line 2 repeats  /, which nginx refuses as a duplicate location.');
assert.match(failure({ config: 'location ~ [a- { }', uri: '/' }), /has a regex that does not compile/);
assert.equal(failure({ config: 'location api/ { }', uri: '/' }), 'Line 1 has the prefix api/, which must start with /.');
assert.equal(failure({ config: 'location = @named { }', uri: '/' }),
  'Line 1 puts a modifier on the named location @named; named locations take none.');
assert.equal(failure({ config: '', uri: '/' }), 'Paste at least one location block.');

// --- URI validation. ---
assert.equal(failure({ config: C.DEFAULT_CONFIG, uri: 'logo.png' }),
  'A request URI starts with /, so logo.png cannot be matched.');
assert.equal(failure({ config: C.DEFAULT_CONFIG, uri: '   ' }), 'Enter the request URI to match.');
assert.equal(failure({ config: C.DEFAULT_CONFIG, uri: '/' + 'a'.repeat(1600) }),
  'The URI is longer than 1500 characters.');

// --- Catalog cases. ---
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expected.error, `${testCase.name} error`);
    continue;
  }
  const result = C.analyze(testCase.input);
  assert.equal(result.kind, testCase.expected.kind, `${testCase.name} kind`);
  assert.equal(result.winnerText, testCase.expected.winner, `${testCase.name} winner`);
  assert.deepEqual(Array.from(result.rows, (row) => row.status), testCase.expected.rows, `${testCase.name} rows`);
  assert.equal(result.rows.filter((row) => row.winner).length, testCase.expected.kind === 'none' ? 0 : 1, `${testCase.name} single winner`);
}

// --- Path handling. ---
const query = C.analyze({ config: 'location /a/ { }', uri: '/a/b?x=1&y=2#frag' });
assert.equal(query.path, '/a/b');
assert.match(query.notes.join(' '), /query string \?x=1&y=2 is not part of the location match/);
assert.equal(query.winnerText, 'location /a/');

const none = C.analyze({ config: 'location = /x { }', uri: '/y' });
assert.equal(none.winnerText, 'no location');
assert.match(none.verdict.title, /Nothing matched/);

const named = C.analyze({ config: 'location @fallback { }\nlocation / { }', uri: '/x' });
assert.equal(named.rows[0].status, 'named');
assert.match(named.notes.join(' '), /named location cannot be reached by a URI: @fallback/);

const catchAll = C.analyze({ config: 'location / { }', uri: '/anything' });
assert.match(catchAll.notes.join(' '), /catch-all location \/ is answering/);

// --- Independent model over generated configurations. ---
let seed = 20261114;
const next = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pickFrom = (list) => list[Math.floor(next() * list.length)];
const prefixPool = ['/', '/api/', '/api/v1/', '/img/', '/docs/', '/a/'];
const regexPool = ['^/a', '/a', '\\.php$', '^/api/', '\\.(png|jpg)$', '^/img/.*\\.js$'];
const pathPool = ['/', '/api', '/api/v1/users', '/apiary', '/a/b', '/img/x.png', '/docs/i.php', '/other'];
const statusOf = (block, winner, kind, longest, hits, target) => {
  if (winner !== null && block.position === winner.position) return 'winner';
  if (block.pattern.startsWith('@')) return 'named';
  if (block.modifier === '=') return 'exact-other';
  if (block.modifier === '' || block.modifier === '^~') {
    if (!(block.pattern.startsWith('/') && target.startsWith(block.pattern))) return 'prefix-other';
    return longest !== null && block.position === longest.position ? 'prefix-outranked' : 'prefix-shorter';
  }
  if (!hits.some((hit) => hit.position === block.position)) return 'regex-other';
  if (kind === 'exact') return 'regex-exact-skipped';
  if (kind === 'prefix-no-regex') return 'regex-skipped';
  return 'regex-later';
};

for (let index = 0; index < 300; index += 1) {
  const blocks = [];
  const used = new Set();
  const size = 1 + Math.floor(next() * 6);
  for (let i = 0; i < size; i += 1) {
    const roll = next();
    const modifier = roll < 0.2 ? '=' : roll < 0.4 ? '^~' : roll < 0.6 ? '~' : roll < 0.75 ? '~*' : '';
    const pattern = modifier === '~' || modifier === '~*' ? pickFrom(regexPool)
      : modifier === '=' ? pickFrom(prefixPool) : pickFrom(prefixPool);
    const key = modifier + ' ' + pattern;
    if (used.has(key)) continue;
    used.add(key);
    blocks.push({ modifier, pattern, position: blocks.length });
  }
  const config = blocks.map((block) => `location ${block.modifier} ${block.pattern} { }`.replace('location  ', 'location ')).join('\n');
  const uri = pickFrom(pathPool);
  const target = uri.split('?')[0];

  const exact = blocks.find((block) => block.modifier === '=' && block.pattern === target) || null;
  const prefixes = blocks.filter((block) => (block.modifier === '' || block.modifier === '^~') &&
    block.pattern.startsWith('/') && target.startsWith(block.pattern));
  let longest = null;
  for (const block of prefixes) if (longest === null || block.pattern.length > longest.pattern.length) longest = block;
  const hits = blocks.filter((block) => block.modifier === '~' || block.modifier === '~*')
    .filter((block) => new RegExp(block.pattern, block.modifier === '~*' ? 'i' : '').test(target));
  let winner = null;
  let kind = 'none';
  if (exact) { winner = exact; kind = 'exact'; }
  else if (longest && longest.modifier === '^~') { winner = longest; kind = 'prefix-no-regex'; }
  else if (hits.length > 0) { winner = hits[0]; kind = 'regex'; }
  else if (longest) { winner = longest; kind = 'prefix'; }
  const expectedRows = blocks.map((block) => statusOf(block, winner, kind, longest, hits, target));

  const result = C.analyze({ config, uri });
  assert.equal(result.kind, kind, `generated ${index}: kind for ${JSON.stringify(config)} ${target}`);
  assert.deepEqual(Array.from(result.rows, (row) => row.status), expectedRows,
    `generated ${index}: rows for ${JSON.stringify(config)} ${target}`);
  assert.equal(result.blocks.length, blocks.length, `generated ${index}: block count`);
  assert.ok(result.notes.length >= 1, `generated ${index}: notes`);
}

// --- Page contract. ---
assert.match(html, /<h1>Nginx Location Matcher<\/h1>/);
assert.match(html, /id="winner-out"/);
assert.match(html, /role="status" aria-live="polite"/);
assert.match(html, /type="submit"/);
assert.match(html, /<label for="config">/);
assert.match(html, /<label for="uri">/);
assert.ok(!/onclick=|oninput=|onchange=/.test(html), 'no inline event handlers');
assert.ok(!/src="https?:/.test(html), 'no remote scripts');

console.log(`nginx-location-matcher: ${entry.testCases.length} catalog cases and 300 generated configurations passed`);
