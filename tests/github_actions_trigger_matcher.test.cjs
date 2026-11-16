/* GitHub Actions trigger matcher: catalog fixtures, the documented filter-pattern vectors, an
   independent segment matcher, and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'github-actions-trigger-matcher';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* actions-trigger-core:start */';
const endMarker = '/* actions-trigger-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = ActionsTriggerCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one trigger matcher');
const record = records[0];
assert.equal(record.name, 'GitHub Actions Trigger Matcher');
assert.equal(record.category, 'Developer');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.equal(new Set(record.tags).size, record.tags.length);
assert.equal(new Set(record.aliases).size, record.aliases.length);
assert.ok(record.method.length > 1200, 'method documents the filters, the pattern grammar and the exclusions');
assert.equal(record.sources.length, 3);
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\/docs\.github\.com\/en\/actions\/reference\/workflows-and-actions\/workflow-syntax#/, 'source is anchored on the workflow syntax reference');
  assert.ok(source.title.length > 60, 'source title names the document and the part used');
}
assert.equal(record.testCases.length, 18);
assert.equal(record.testCases.filter((t) => t.kind === 'golden').length, 8);
assert.equal(record.testCases.filter((t) => t.kind === 'boundary').length, 4);
assert.equal(record.testCases.filter((t) => t.kind === 'validation').length, 6);
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name, record.name, 'name collides with ' + other.slug);
  for (const alias of record.aliases) {
    assert.ok(!(other.aliases || []).includes(alias), 'alias collides with ' + other.slug + ': ' + alias);
  }
  assert.ok(!(other.tags || []).includes('github-actions'), 'no other record claims the github-actions tag');
}

// Replay every published case.
function failure(input) {
  try { C.evaluate(input); } catch (error) { return error.message; }
  return null;
}
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.evaluate(testCase.input);
  assert.equal(result.runs, testCase.expected.runs, testCase.name + ': runs');
  if (testCase.expected.filterNames) {
    assert.deepEqual(Array.from(result.filters, (row) => row.name), testCase.expected.filterNames, testCase.name + ': filter names');
  }
  if (testCase.expected.decisive !== undefined) {
    const first = result.filters[0];
    assert.equal(first.decisive ? first.decisive.pattern : null, testCase.expected.decisive, testCase.name + ': decisive pattern');
  }
  if (testCase.expected.includedPaths !== undefined) {
    assert.equal(result.summary.includedPaths, testCase.expected.includedPaths, testCase.name + ': included paths');
  }
  if (testCase.expected.lastDetail) {
    const last = result.filters[result.filters.length - 1];
    assert.equal(last.detail, testCase.expected.lastDetail, testCase.name + ': last filter detail');
  }
  assert.ok(result.reason.includes(testCase.expected.contains), testCase.name + ': reason reads ' + JSON.stringify(result.reason));
  assert.equal(result.runs, result.filters.every((row) => row.passed), testCase.name + ': verdict follows the filter rows');
}

// The documented filter-pattern table, row by row: patterns and the names each one matches or misses.
const DOCUMENTED = [
  ['*', ['README.md', 'server.rb'], ['docs/README.md']],
  ['*.jsx?', ['page.js', 'page.jsx'], ['page.jsxx']],
  ['**', ['all/the/files.md'], []],
  ['*.js', ['app.js', 'index.js'], ['src/app.js']],
  ['**.js', ['index.js', 'js/index.js', 'src/js/app.js'], []],
  ['docs/*', ['docs/README.md', 'docs/file.txt'], ['docs/mona/octocat.txt']],
  ['docs/**', ['docs/README.md', 'docs/mona/octocat.txt'], []],
  ['docs/**/*.md', ['docs/README.md', 'docs/mona/hello-world.md', 'docs/a/markdown/file.md'], []],
  ['**/docs/**', ['docs/hello.md', 'dir/docs/my-file.txt', 'space/docs/plan/space.doc'], []],
  ['**/README.md', ['README.md', 'js/README.md'], []],
  ['**/*src/**', ['a/src/app.js', 'my-src/code/js/app.js'], []],
  ['**/*-post.md', ['my-post.md', 'path/their-post.md'], []],
  ['**/migrate-*.sql', ['migrate-10909.sql', 'db/migrate-v1.0.sql', 'db/sept/migrate-v1.sql'], []],
  ['feature/*', ['feature/my-branch', 'feature/your-branch'], ['feature/beta-a/my-branch']],
  ['feature/**', ['feature/beta-a/my-branch', 'feature/your-branch', 'feature/mona/the/octocat'], []],
  ['*feature', ['mona-feature', 'feature', 'ver-10-feature'], []],
  ['v2*', ['v2', 'v2.0', 'v2.9'], []],
  ['v[12].[0-9]+.[0-9]+', ['v1.10.1', 'v2.0.0'], ['v3.0.0']]
];
for (const [pattern, hits, misses] of DOCUMENTED) {
  for (const value of hits) assert.equal(C.matches(pattern, value), true, pattern + ' should match ' + value);
  for (const value of misses) assert.equal(C.matches(pattern, value), false, pattern + ' should not match ' + value);
}

// An independent matcher for the segment forms: split on "/" and recurse, with "**" eating
// zero or more whole segments and "*" matching inside one segment. It shares no regex with the page.
function segmentMatch(pattern, value) {
  const parts = pattern.split('/');
  const target = value.split('/');
  const memo = new Map();
  function walk(pi, ti) {
    const key = pi + ':' + ti;
    if (memo.has(key)) return memo.get(key);
    let outcome;
    if (pi === parts.length) outcome = ti === target.length;
    else if (parts[pi] === '**') {
      // GitHub reads a trailing "/**" as the files inside, so it needs at least one segment.
      outcome = pi === parts.length - 1
        ? ti < target.length
        : walk(pi + 1, ti) || (ti < target.length && walk(pi, ti + 1));
    }
    else if (ti === target.length) outcome = false;
    else outcome = within(parts[pi], target[ti]) && walk(pi + 1, ti + 1);
    memo.set(key, outcome);
    return outcome;
  }
  function within(glob, text) {
    let g = 0;
    let t = 0;
    let star = -1;
    let mark = 0;
    while (t < text.length) {
      if (g < glob.length && glob[g] === '*') { star = g; mark = t; g += 1; }
      else if (g < glob.length && glob[g] === text[t]) { g += 1; t += 1; }
      else if (star >= 0) { g = star + 1; mark += 1; t = mark; }
      else return false;
    }
    while (g < glob.length && glob[g] === '*') g += 1;
    return g === glob.length;
  }
  return walk(0, 0);
}

const corpus = [];
const segments = ['a', 'b', 'src', 'docs', 'README.md', 'app.js', '**', '*', '*-post.md', 'docs/**', '**/src'];
for (const a of segments) {
  corpus.push(a);
  for (const b of segments) {
    if (a === '**' || b === '**') continue;
    corpus.push(a + '/' + b);
    for (const c of ['x', 'docs', 'README.md']) corpus.push(a + '/' + b + '/' + c);
  }
}
let compared = 0;
for (const pattern of ['*', '**', '*.js', 'docs/*', 'docs/**', '**/docs/**', '**/README.md', '**/*src/**', '**/*-post.md', 'src/*.js', 'a/**/b', '**/a/**']) {
  for (const value of corpus) {
    assert.equal(C.matches(pattern, value), segmentMatch(pattern, value), 'independent matcher disagrees on ' + pattern + ' vs ' + value);
    compared += 1;
  }
}
assert.ok(compared > 500, 'the cross-check covers a real corpus: ' + compared);

// Sequential negation: a later positive pattern re-includes what an earlier negative removed.
const sequential = C.evaluate({
  workflow: "on:\n  push:\n    paths:\n      - '*.md'\n      - '!README.md'\n      - 'README*'\n",
  event: 'push',
  refKind: 'branch',
  ref: 'main',
  paths: 'hello.md\nREADME.md\nREADME.doc\ndocs/hello.md'
});
assert.deepEqual(Array.from(sequential.paths, (row) => row.passed), [true, true, true, false], 'negation then re-inclusion');
assert.equal(sequential.paths[2].decisive.pattern, 'README*', 'the last matching pattern decides');
assert.equal(sequential.paths[2].decisive.line, 6, 'the decisive line is the list item, not its key');
assert.equal(sequential.runs, true, 'one matched path is enough');

// The two filter families are exclusive, so each kind of ref is judged by its own family.
const exclusive = C.evaluate({
  workflow: 'on:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [develop]\n',
  event: 'push',
  refKind: 'branch',
  ref: 'main',
  paths: ''
});
assert.equal(exclusive.runs, true);
assert.equal(exclusive.filters.length, 2);
assert.equal(exclusive.filters[1].skipped, true, 'no path filter is reported as not evaluated');

// Events the page does not model are listed but never silently evaluated.
const other = C.evaluate({ workflow: 'on:\n  workflow_dispatch:\n  push:\n    branches: [main]\n', event: 'push', ref: 'main', paths: '' });
assert.deepEqual(Array.from(other.events), ['workflow_dispatch', 'push']);
assert.equal(other.runs, true);
const unlisted = C.evaluate({ workflow: 'on:\n  workflow_dispatch:\n', event: 'push', ref: 'main', paths: '' });
assert.equal(unlisted.runs, false);
assert.ok(unlisted.reason.includes('does not subscribe to “push”'), 'an unrelated event is named in the reason');

// Ref prefixes are stripped, and a refs/tags/ prefix switches the kind with a note.
const prefixed = C.evaluate({ workflow: 'on:\n  push:\n    branches: [main]\n', event: 'push', refKind: 'branch', ref: 'refs/heads/main', paths: '' });
assert.equal(prefixed.refName, 'main');
const tagged = C.evaluate({ workflow: 'on:\n  push:\n    tags: ["v*"]\n', event: 'push', refKind: 'branch', ref: 'refs/tags/v1.0.0', paths: '' });
assert.equal(tagged.refKind, 'tag');
assert.equal(tagged.runs, true);
assert.ok(tagged.warnings.some((warning) => warning.includes('tested as a tag')));

// Refusals that are not catalog cases.
assert.throws(() => C.evaluate({ workflow: 'on: push\n', event: 'schedule', ref: 'main' }), /push or pull_request/);
assert.throws(() => C.evaluate({ workflow: 'on: push\n', event: 'push', ref: '' }), /Enter the branch or tag name/);
assert.throws(() => C.evaluate({ workflow: 'on:\n  push:\n    branches: [main]\n    tags: [v1]\n    tags-ignore: [v0]\n', event: 'push', ref: 'main', paths: '' }), /tags-ignore/);
assert.throws(() => C.evaluate({ workflow: 'on:\n  push:\n    branches: [main]\n    paths: [src]\n    paths-ignore: [docs]\n', event: 'push', ref: 'main', paths: 'src/a' }), /paths-ignore/);
assert.throws(() => C.matches('[abc', 'a'), /not closed/);

// Page contract: shared shell, keyboard-submittable form, accessible output, no foreign runtime.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html));
assert.ok(!/<script[^>]+src="https?:/i.test(html));
assert.ok(!/<link[^>]+href="https?:/i.test(html));
assert.ok(!/on(?:click|input|change|submit)=/i.test(html));
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html));
assert.ok(html.includes('<form id="trigger-form" novalidate>'));
assert.ok(html.includes('type="submit"'));
assert.ok(html.includes('role="alert"'));
assert.ok(html.includes('role="status" aria-live="polite"'));
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.equal((html.match(/<h1>/g) || []).length, 1);
for (const id of html.matchAll(/\bid="([a-z0-9-]+)"/g)) {
  assert.equal((html.match(new RegExp('id="' + id[1] + '"', 'g')) || []).length, 1, 'duplicate id ' + id[1]);
}
for (const match of html.matchAll(/\$\("([a-z0-9-]+)"\)/g)) assert.ok(html.includes('id="' + match[1] + '"'), 'missing id ' + match[1]);
for (const id of ['wf', 'event', 'refkind', 'ref', 'paths']) assert.ok(html.includes('for="' + id + '"'), 'missing label ' + id);
assert.ok(html.includes('data-label'), 'stacked cells keep their header label');
assert.ok(html.includes('<option value="push" selected>') && html.includes('<option value="pull_request">'), 'event options');
assert.ok(html.includes('<option value="branch" selected>') && html.includes('<option value="tag">'), 'ref kind options');
assert.ok(html.includes('id="ref" type="text" value="main"'), 'the ref is prefilled');
console.log('github-actions-trigger-matcher: 18 catalog cases, ' + DOCUMENTED.length + ' documented pattern rows, ' + compared + ' independent segment comparisons and the page contract passed');
