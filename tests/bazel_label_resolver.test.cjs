/* Bazel label resolver: the label grammar, the target-pattern table from the
   Bazel documentation, the independent Python fixtures, the refusals, the
   catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'bazel-label-resolver';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* bazel-core:start */';
const endMarker = '/* bazel-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BazelCore;', sandbox);
const C = sandbox.module.exports;

const resolve = (target, cwd) => JSON.parse(JSON.stringify(C.resolve({ target: target, cwd: cwd || '' })));
const refused = (target, cwd) => {
  try { C.resolve({ target: target, cwd: cwd || '' }); } catch (error) { return error.message; }
  return null;
};

// ---- The documentation's own examples, table row by table row.
const docRows = [
  ['//my/app', '', '//my/app:app'],
  ['//my/app/lib', '', '//my/app/lib:lib'],
  ['//foo/bar:wiz', '', '//foo/bar:wiz'],
  ['//foo/bar', '', '//foo/bar:bar'],
  ['//foo/bar/wiz', '', '//foo/bar/wiz:wiz'],
  ['//:all', '', '//:all'],
  ['//...', '', '//...'],
];
for (const [target, cwd, canonical] of docRows) {
  assert.equal(resolve(target, cwd).canonical, canonical, 'documentation row: ' + target);
}

// ---- With a working directory, the relative rows map exactly as documented.
assert.equal(resolve(':foo', 'foo').canonical, '//foo:foo');
assert.equal(resolve('bar:wiz', 'foo').canonical, '//foo/bar:wiz');
assert.equal(resolve('bar:all', 'foo').canonical, '//foo/bar:all');
assert.equal(resolve('bar/...:all', 'foo').canonical, '//foo/bar/...');
assert.equal(resolve('...', 'foo').canonical, '//foo/...');
assert.equal(resolve('...:all', 'foo').canonical, '//foo/...');
assert.equal(resolve('bar/...:all', 'foo').expanded, '//foo/bar/...:all');

// ---- The ambiguous relative path lists the documentation's three readings.
const ambiguous = resolve('bar/wiz', 'foo');
assert.equal(ambiguous.kind, 'ambiguous');
assert.equal(ambiguous.canonical, null);
assert.deepEqual(Array.from(ambiguous.candidates, (candidate) => candidate.canonical),
  ['//foo/bar/wiz:wiz', '//foo/bar:wiz', '//foo:bar/wiz']);
assert.match(ambiguous.candidates[0].when, /if foo\/bar\/wiz is a package/);
assert.match(ambiguous.candidates[1].when, /else if foo\/bar is a package/);
assert.match(ambiguous.candidates[2].when, /otherwise/);

// ---- The three wildcard kinds: an explicit target, :all rules, :* every target.
const label = resolve('//foo/bar:wiz');
assert.equal(label.kind, 'label');
assert.equal(label.recursive, false);
assert.equal(label.inferred, false);
assert.equal(label.packageName, 'foo/bar');
assert.equal(label.targetName, 'wiz');
assert.equal(label.manual, null);
assert.equal(label.expanded, '//foo/bar:wiz');

const inferred = resolve('//foo/bar');
assert.equal(inferred.inferred, true, 'the last path segment supplies the target');
assert.equal(inferred.targetName, 'bar');
const rules = resolve('//foo/bar:all');
assert.equal(rules.kind, 'rules');
assert.equal(rules.manual, 'skipped');
assert.match(rules.matches, /every rule target in \/\/foo\/bar/);
assert.equal(resolve('//foo/bar:*').kind, 'targets');
assert.equal(resolve('//foo/bar:all-targets').kind, 'targets');
assert.equal(resolve('//foo/bar:all-targets').canonical, '//foo/bar:all-targets');

// ---- A recursive pattern always keeps the ... and expands to :all.
const recursive = resolve('//foo/...');
assert.equal(recursive.kind, 'rules');
assert.equal(recursive.recursive, true);
assert.equal(recursive.packageName, 'foo');
assert.equal(recursive.targetName, null);
assert.equal(recursive.canonical, '//foo/...');
assert.equal(recursive.expanded, '//foo/...:all');
assert.equal(resolve('//foo/...:*').canonical, '//foo/...:*');
assert.equal(resolve('//foo/...:all-targets').kind, 'targets');
assert.equal(resolve('//...').canonical, '//...', 'the root wildcard keeps two slashes plus the dots');
assert.equal(resolve('//...').packageName, '');
assert.equal(resolve('//...').expanded, '//...:all');

// ---- Repositories: apparent, canonical, and @@// for the main repository.
const apparent = resolve('@rules_go//go:def.bzl');
assert.equal(apparent.repository, '@rules_go');
assert.equal(apparent.canonical, '@rules_go//go:def.bzl');
const canonicalRepo = resolve('@@bazel_tools//tools:defs.bzl');
assert.equal(canonicalRepo.repository, '@@bazel_tools');
assert.equal(canonicalRepo.canonical, '@@bazel_tools//tools:defs.bzl');
const mainRepo = resolve('@@//a/b/c');
assert.equal(mainRepo.repository, '@@');
assert.equal(mainRepo.canonical, '@@//a/b/c:c');
assert.equal(mainRepo.packageName, 'a/b/c');

// ---- Negative patterns keep the flag and the canonical spelling without it.
const negative = resolve('-//foo/...');
assert.equal(negative.negative, true);
assert.equal(negative.canonical, '//foo/...');
assert.equal(negative.expanded, '//foo/...:all');
assert.equal(resolve('//foo/...').negative, false);

// ---- A target may carry a file path, but only in normal form.
assert.equal(resolve('//my/app/main:testdata/input.txt').targetName, 'testdata/input.txt');
assert.equal(resolve('//my/app/main:testdata/input.txt').canonical, '//my/app/main:testdata/input.txt');
assert.equal(refused('//my/app/main:testdata//input.txt'),
  "A file target's path cannot contain a double slash.");
assert.equal(refused('//my/app/main:testdata/../input.txt'),
  "A file target's path cannot contain . or .. segments; file targets stay inside their package.");

// ---- The parser refuses rather than guessing.
assert.equal(refused(''), 'Enter a label or target pattern, such as //foo/bar:wiz.');
assert.equal(refused('   '), 'Enter a label or target pattern, such as //foo/bar:wiz.');
assert.equal(refused('//foo/bar:'),
  'Name a target after the colon, or leave the colon off to use the last path segment.');
assert.equal(refused('//'), 'Name a target after //, such as //:app, or name a package such as //my/app.');
assert.equal(refused('//foo//bar'),
  'Package paths cannot contain a double slash; write one slash between directories.');
assert.equal(refused('//foo/bar/'), 'Package paths cannot start or end with a slash.');
assert.equal(refused('//foo/./bar'),
  'Labels cannot contain . or .. path segments; name the package or file directly.');
assert.equal(refused('//foo/../bar'),
  'Labels cannot contain . or .. path segments; name the package or file directly.');
assert.equal(refused('//foo/.../bar'), 'The ... wildcard must be the last segment of the package path.');
assert.equal(refused('//foo/...:wiz'),
  'A ... pattern covers whole packages; name :all, :* or :all-targets, or leave the target off.');
assert.equal(refused('//foo:bar:baz'), 'Target names cannot contain a colon.');
assert.equal(refused('//foo:ba\\r'), 'Target names cannot contain a backslash.');
assert.equal(refused('@//pkg'), 'Name the repository after @, or write @@// to mean the main repository.');
assert.equal(refused('@my repo//pkg'), 'Repository names cannot contain spaces, slashes, colons or @.');
assert.equal(refused('@repo/pkg'), 'A repository-qualified pattern needs // before the package, such as @rules_go//go:def.bzl.');
assert.equal(refused('/foo/bar'), 'Write // before an absolute package, or drop the slash for a target in the working directory.');
assert.equal(refused('-'), 'A negative pattern needs a pattern after the minus sign.');
assert.equal(refused('//foo/bar', 'my/app:main'),
  'Enter the working directory as a package path, such as my/app, with no target after a colon.');
assert.equal(refused(':foo', 'my/...'),
  'Enter the working directory as a package path, without a ... wildcard.');

// ---- Surrounding space is trimmed, and a target name may contain a space.
assert.equal(resolve('  //my/app  ').canonical, '//my/app:app');
assert.equal(resolve('//my/app:my file.txt').targetName, 'my file.txt');

// ---- A non-ASCII character is a target character, never a package one.
assert.equal(resolve('//my/app:caf\u00e9').targetName, 'caf\u00e9');
assert.equal(refused('//caf\u00e9/app'),
  'Package names are ASCII; non-ASCII characters belong in target names.');
assert.equal(refused('//foo~bar/app'),
  'Package names use letters, digits and the punctuation Bazel allows; non-ASCII characters belong in target names.');

// ---- Idempotence: resolving a canonical spelling returns it unchanged.
for (const item of ['//my/app:app', '//foo/bar:wiz', '//foo/...', '//foo/...:*', '//:all', '//...',
  '@rules_go//go:def.bzl', '@@//a/b/c:c', '//my/app/main:testdata/input.txt']) {
  assert.equal(resolve(resolve(item).canonical).canonical, item, 'idempotent: ' + item);
}

// ---- The omitted colon and the explicit one name the same target.
for (const pkg of ['my/app', 'a/b/c', 'tools/build/parser', 'x']) {
  const omitted = resolve('//' + pkg);
  const last = pkg.split('/').pop();
  assert.equal(omitted.canonical, '//' + pkg + ':' + last);
  assert.equal(omitted.canonical, resolve('//' + pkg + ':' + last).canonical);
}

// ---- The fixtures, written independently in Python from the same documentation.
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/bazel_label_cases.json'), 'utf8'));
assert.ok(fixtures.cases.length >= 18, 'the fixture set covers labels, patterns, repositories and relatives');
for (const item of fixtures.cases) {
  const actual = resolve(item.input.target, item.input.cwd);
  for (const [key, value] of Object.entries(item.expected)) {
    if (key === 'candidates') continue;
    assert.deepEqual(actual[key], value, item.name + ': ' + key);
  }
  if (item.expected.candidates) {
    assert.deepEqual(Array.from(actual.candidates, (candidate) => candidate.canonical),
      item.expected.candidates, item.name + ': candidates');
  }
}

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug appears once');
assert.equal(record.name, 'Bazel Label Resolver');
assert.equal(record.category, 'Developer');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(typeof record.method, 'string', 'method is a plain string');
assert.equal(typeof record.guidance, 'string', 'guidance is a plain string');
assert.ok(record.sources.length >= 2);
for (const source of record.sources) assert.match(source.url, /^https:\/\//);
const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 4, validation: 8 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(refused(testCase.input.target, testCase.input.cwd), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = resolve(testCase.input.target, testCase.input.cwd);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (key === 'candidates') {
      assert.deepEqual(Array.from(actual.candidates, (candidate) => candidate.canonical), value,
        testCase.name + ': candidates');
      continue;
    }
    assert.deepEqual(actual[key], value, testCase.name + ': ' + key);
  }
}

// ---- Uniqueness across the catalog: name and aliases stay distinct.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
for (const alias of record.aliases) {
  const owners = catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase()));
  assert.deepEqual(owners.map((tool) => tool.slug), [slug], 'alias is unique: ' + alias);
}
for (const tag of record.tags) assert.ok(tag.length > 1);
for (const tag of ['bazel', 'target-pattern', 'build-system']) {
  const owners = catalog.tools.filter((tool) => tool.slug !== slug && (tool.tags || []).includes(tag));
  assert.deepEqual(owners.map((tool) => tool.slug), [], 'tag is new: ' + tag);
}

// ---- Page contract: one self-contained page on the shared shell.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Bazel Label Resolver<\/h1>/);
assert.match(html, /<form id="bazel-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
for (const id of ['target', 'cwd']) {
  assert.match(html, new RegExp('<label for="' + id + '">'), 'label for ' + id);
}
assert.match(html, /<input id="target"[^>]*value="\/\/my\/app"/);
assert.match(html, /<input id="cwd"[^>]*value="my\/app\/main"/);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(/.test(html), 'no network calls');
assert.ok(!/<iframe|<img|<canvas|<svg/.test(html), 'no embedded media');
assert.match(html, /aria-live="polite"/, 'the result is announced');
assert.match(html, /nothing is sent anywhere else/i, 'the privacy note stays on the page');
assert.equal((html.match(/\/\* bazel-core:start \*\//g) || []).length, 1);

console.log('bazel-label-resolver: ' + docRows.length + ' documentation rows, the three wildcard kinds, '
  + 'repositories, negative patterns, idempotence, ' + fixtures.cases.length + ' fixtures, '
  + record.testCases.length + ' catalog cases, uniqueness and page contract OK');
