/* HTTP precondition evaluator: RFC 9110 precedence, the validator comparison
   rules, the page markup and the catalog record's thirty cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'http-precondition-evaluator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* http-precondition-core:start */';
const endMarker = '/* http-precondition-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, Error, Date, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = HttpPreconditionCore;', sandbox);
const C = sandbox.module.exports;

const failure = (payload) => {
  try { C.evaluate(payload); } catch (error) { return error.message; }
  return null;
};
const LM = 'Fri, 27 Nov 2026 09:15:00 GMT';
const base = {
  method: 'GET', etag: '"8f4d1c"', modified: LM, exists: 'true',
  ifMatch: '', ifNoneMatch: '', ifModifiedSince: '', ifUnmodifiedSince: '',
};
const withPatch = (patch) => Object.assign({}, base, patch);

// ---- Constants and parsing.
assert.equal(JSON.stringify(C.METHODS), JSON.stringify(['GET', 'HEAD', 'PUT', 'POST', 'PATCH', 'DELETE']));
assert.equal(C.parseHttpDate(LM, 'x'), Date.UTC(2026, 10, 27, 9, 15, 0) / 1000);
assert.equal(C.parseHttpDate('Sun Nov  6 08:49:37 1994', 'x'), Date.UTC(1994, 10, 6, 8, 49, 37) / 1000);
assert.equal(C.dateText(C.parseHttpDate('Sun Nov  6 08:49:37 1994', 'x')), 'Sun, 06 Nov 1994 08:49:37 GMT');
assert.equal(C.parseHttpDate('Thu, 29 Feb 2024 00:00:00 GMT', 'x'), Date.UTC(2024, 1, 29) / 1000);
assert.equal(C.parseHttpDate('', 'x'), null);
assert.equal(failure(withPatch({ ifNoneMatch: '', ifModifiedSince: 'Thu, 29 Feb 2026 00:00:00 GMT' })),
  'If-Modified-Since must be an IMF-fixdate such as "Sun, 06 Nov 1994 08:49:37 GMT"; got "Thu, 29 Feb 2026 00:00:00 GMT".');
assert.equal(failure(withPatch({ ifNoneMatch: '', ifModifiedSince: 'Fri, 27 Nov 26 09:15:00 GMT' })),
  'If-Modified-Since must be an IMF-fixdate such as "Sun, 06 Nov 1994 08:49:37 GMT"; got "Fri, 27 Nov 26 09:15:00 GMT".');

const tags = C.parseTagList('W/"a", "b"', 'x');
assert.equal(tags.tags.length, 2);
assert.equal(C.describe(tags.tags[0]), 'W/"a"');
assert.equal(C.strongMatch({ weak: false, opaque: 'a' }, { weak: false, opaque: 'a' }), true);
assert.equal(C.strongMatch({ weak: true, opaque: 'a' }, { weak: false, opaque: 'a' }), false);
assert.equal(C.weakMatch({ weak: true, opaque: 'a' }, { weak: false, opaque: 'a' }), true);
assert.equal(C.weakMatch({ weak: false, opaque: 'a' }, { weak: false, opaque: 'b' }), false);
assert.equal(C.parseTagList('*', 'x').star, true);
assert.equal(failure(withPatch({ ifMatch: '"a" b' })).startsWith('If-Match must be'), true);

// ---- Refusals, spelled out once here and again in the catalog.
assert.equal(failure(withPatch({ ifNoneMatch: '' })),
  'Enter at least one conditional header: If-Match, If-None-Match, If-Modified-Since or If-Unmodified-Since.');
assert.equal(failure(withPatch({ ifMatch: '*, "8f4d1c"' })),
  'If-Match cannot mix "*" with entity tags; use either "*" or a list of quoted tags.');
assert.equal(failure(withPatch({ etag: '"a", "b"', ifNoneMatch: '*' })),
  'The current ETag must be one entity tag; got 2 tags instead.');
assert.equal(failure(withPatch({ exists: 'maybe' })),
  'Say whether the resource has a current representation.');

// ---- The default request is a cache revalidation.
const dflt = C.evaluate(C.DEFAULTS);
assert.equal(dflt.status, '304');
assert.equal(dflt.deciding, 'If-None-Match');
assert.equal(dflt.steps.length, 4);
assert.equal(dflt.steps[0].result, 'not sent');
assert.equal(dflt.steps[2].header, 'If-None-Match');
assert.match(dflt.summary, /^The request is answered with 304 Not Modified/);
assert.ok(dflt.explanation.length >= 3);

// ---- A state-changing request that loses the race.
const lost = C.evaluate(withPatch({ method: 'PUT', ifMatch: '"77ac02"', ifUnmodifiedSince: LM, ifNoneMatch: '"x"' }));
assert.equal(lost.status, '412');
assert.equal(lost.deciding, 'If-Match');
assert.equal(lost.steps[1].applied, false);
assert.equal(lost.steps[1].result, 'ignored');
assert.equal(lost.steps[2].result, 'not reached');
assert.equal(lost.code, '412');
assert.equal(lost.reason, 'Precondition Failed');

// ---- Proceed, and the star form of each header.
const create = C.evaluate(withPatch({ method: 'PUT', exists: 'false', ifNoneMatch: '*' }));
assert.equal(create.status, 'proceed');
assert.equal(create.deciding, null);
assert.equal(create.summary.startsWith('Every conditional header that applies passes'), true);
const star = C.evaluate(withPatch({ method: 'DELETE', ifMatch: '*' }));
assert.equal(star.status, 'proceed');
assert.equal(star.steps[0].result, 'true');

// ---- Determinism and input immutability.
const pristine = Object.assign({}, base, { ifMatch: '"8f4d1c"' });
const snapshot = JSON.stringify(pristine);
C.evaluate(pristine);
assert.equal(JSON.stringify(pristine), snapshot, 'input is not mutated');
assert.equal(C.evaluate(pristine).status, C.evaluate(pristine).status, 'deterministic');

// ---- Every step table is internally consistent.
for (const testCase of [
  withPatch({ ifNoneMatch: 'W/"8f4d1c"' }),
  withPatch({ method: 'PUT', ifMatch: '"8f4d1c"', ifUnmodifiedSince: LM }),
  withPatch({ method: 'POST', ifModifiedSince: LM }),
  withPatch({ ifMatch: '"x"', ifNoneMatch: '"8f4d1c"' }),
  withPatch({ modified: '', ifModifiedSince: LM }),
  withPatch({ method: 'HEAD', ifNoneMatch: '*' }),
]) {
  const result = C.evaluate(testCase);
  const failed = result.steps.filter((step) => step.applied && step.result === 'false');
  assert.equal(failed.length, result.deciding ? 1 : 0, 'exactly one failing precondition');
  if (result.deciding) assert.equal(failed[0].header, result.deciding, 'the failing header decides');
  assert.equal(new Set(result.steps.map((step) => step.header)).size, 4, 'four rows');
}

// ---- The catalog record and every case in it.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'HTTP Precondition Evaluator');
assert.equal(record.category, 'Developer');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.legacyCategory, null);
assert.ok(record.description.length >= 80 && record.description.length <= 300, 'description length');
assert.equal(record.testCases.length, 30, 'catalog case count');
assert.equal(record.sources.length, 2, 'two primary references');
assert.ok(record.sources.every((source) => /^https:\/\//.test(source.url) && source.title.length > 20), 'source shape');
assert.ok(record.method.length > 400, 'method explains the rules');
assert.ok(record.tags.includes('conditional-request') && record.tags.includes('etag'), 'tags');
assert.ok(record.guidance.length > 40, 'guidance');

const others = catalog.tools.filter((tool) => tool.slug !== slug);
const takenSlugs = new Set(others.map((tool) => tool.slug));
const takenNames = new Set(others.map((tool) => tool.name.toLowerCase()));
const takenAliases = new Set();
for (const tool of others) for (const alias of tool.aliases || []) takenAliases.add(alias.toLowerCase());
assert.ok(!takenSlugs.has(slug), 'slug collides with another tool');
assert.ok(!takenNames.has(record.name.toLowerCase()), 'name collides with another tool');
for (const alias of record.aliases) {
  const key = alias.toLowerCase();
  assert.ok(!takenAliases.has(key), 'alias collides with another alias: ' + alias);
  assert.ok(!takenNames.has(key), 'alias repeats another tool name: ' + alias);
}
assert.ok(record.aliases.includes(record.name), 'the page title is listed as an alias');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'alias duplicates');

let goldens = 0;
let refusals = 0;
for (const testCase of record.testCases) {
  assert.ok(testCase.name && testCase.input && testCase.expected, 'malformed case');
  if (testCase.kind === 'golden') {
    const result = C.evaluate(testCase.input);
    assert.equal(result.status, testCase.expected.status, testCase.name + ': status');
    assert.equal(result.deciding, testCase.expected.deciding, testCase.name + ': deciding header');
    goldens += 1;
  } else {
    assert.equal(testCase.kind, 'validation');
    assert.equal(failure(testCase.input), testCase.expected.error, testCase.name);
    refusals += 1;
  }
}
assert.equal(goldens, 20, 'golden cases');
assert.equal(refusals, 10, 'refusal cases');

// ---- Page contract.
assert.match(html, /<title>HTTP Precondition Evaluator/);
assert.match(html, /<meta name="description" content="Work out whether a conditional HTTP request/);
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.ok(html.includes('/assets/tools.js'));
assert.ok(html.includes('/assets/app.js'));
for (const id of ['in-method', 'in-etag', 'in-modified', 'in-exists',
  'in-if-match', 'in-if-none-match', 'in-if-modified-since', 'in-if-unmodified-since']) {
  assert.ok(html.includes('id="' + id + '"'), 'input ' + id);
}
for (const id of ['in-method', 'in-etag', 'in-modified', 'in-if-match', 'in-if-none-match',
  'in-if-modified-since', 'in-if-unmodified-since']) {
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id);
}
assert.ok(html.includes('role="status" aria-live="polite"'), 'live status');
assert.ok(html.includes('role="alert"'), 'error alert');
assert.ok((html.match(/<button\b[^>]*>/g) || []).every((tag) => /type="(button|submit)"/.test(tag)), 'button types');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline handlers');
assert.ok(!/eval\(|new Function\(/.test(html), 'no eval');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/https?:\/\//.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, '')), 'no off-site references in markup');
assert.equal((html.match(/<script(?![^>]*\bsrc=)/g) || []).length, 1, 'one inline script');
assert.ok(html.includes('<h1>HTTP Precondition Evaluator</h1>'));
assert.ok(html.includes('<h3>How this is evaluated</h3>'));
assert.ok(html.includes('Nothing is saved'), 'storage disclosure');
assert.ok(html.includes('does not send a request'), 'network disclosure');

console.log('http precondition evaluator: ' + goldens + ' goldens, ' + refusals +
  ' refusals, page and catalog contract ok');
