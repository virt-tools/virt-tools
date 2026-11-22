/* Git attributes resolver: the resolution model against the documented
   gitattributes states and precedence, the catalog replay, and the page
   contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'gitattributes-resolver';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* gitattributes-core:start */';
const endMarker = '/* gitattributes-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = GitattributesCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const states = (attributes, inputPath) => {
  const result = plain(C.resolve({ attributes, path: inputPath }));
  const map = {};
  for (const attribute of result.attributes) {
    map[attribute.name] = attribute.state === 'value' ? 'value:' + attribute.value : attribute.state;
  }
  return map;
};
const statesOf = (result) => {
  const map = {};
  for (const attribute of result.attributes) {
    map[attribute.name] = attribute.state === 'value' ? 'value:' + attribute.value : attribute.state;
  }
  return map;
};
const failure = (attributes, inputPath) => {
  try { C.resolve({ attributes, path: inputPath }); } catch (error) { return error.message; }
  return null;
};

// ---- Attribute states and per-attribute precedence.
const sample = '# Normalize line endings\n* text=auto\n*.js text eol=lf\n*.md text !eol\n\n'
  + '# Binary files\n[attr]binary -diff -merge -text\n*.png binary\n\n'
  + '# Generated documentation is not text for diffs\ndocs/** -text';
assert.deepEqual(states(sample, 'assets/logo.png'), {
  binary: 'set', diff: 'unset', eol: 'unspecified', merge: 'unset', text: 'unset'
});
const js = plain(C.resolve({ attributes: sample, path: 'src/app.js' }));
assert.equal(js.matched, 2);
assert.equal(js.counts.unspecified, 3);
assert.equal(js.rules, 5, 'blank lines and comments are not rules');
assert.equal(js.attributes.find((item) => item.name === 'eol').rule, '*.js text eol=lf');
assert.equal(js.attributes.find((item) => item.name === 'eol').line, 3);

// The last matching line wins per attribute, not per path.
assert.deepEqual(states('*.txt text\nsecret.txt -text\n*.txt eol=lf\n', 'secret.txt'),
  { eol: 'value:lf', text: 'unset' });
// !name returns an attribute to the unspecified state.
const reset = plain(C.resolve({ attributes: '*.md text eol=lf\n*.md !eol\n', path: 'notes.md' }));
assert.deepEqual(statesOf(reset), { eol: 'unspecified', text: 'set' });
assert.equal(reset.attributes.find((item) => item.name === 'eol').line, 2, 'the resetting line is reported');
// A later line can set a value and a bare name can set true.
assert.deepEqual(states('*.c diff=c\n*.c text\n', 'a.c'), { diff: 'value:c', text: 'set' });

// ---- Macros: definition, nesting, built-in binary and unset behavior.
assert.deepEqual(states('*.bin binary\n', 'a.bin'),
  { binary: 'set', diff: 'unset', merge: 'unset', text: 'unset' });
assert.deepEqual(states('[attr]web text eol=lf -diff\n[attr]outer web merge\n*.w outer\n', 'a.w'), {
  diff: 'unset', eol: 'value:lf', merge: 'set', outer: 'set', text: 'set', web: 'set'
});
assert.deepEqual(states('*.gif -binary\n', 'a.gif'), { binary: 'unset' }, 'unsetting a macro does not expand it');
const builtin = plain(C.resolve({ attributes: '*.bin binary\n', path: 'a.bin' }));
assert.ok(builtin.warnings.length === 0);

// ---- Pattern matching follows the gitignore form, with the two attribute differences.
assert.deepEqual(states('**/logs export-ignore\n', 'logs/app.log'), { 'export-ignore': 'unspecified' },
  'a directory match does not reach the files inside');
assert.deepEqual(states('**/logs export-ignore\n', 'logs'), { 'export-ignore': 'set' });
assert.deepEqual(states('config/*.yml eol=lf\n', 'app/config/app.yml'), { eol: 'unspecified' },
  'a pattern with a slash is anchored');
assert.deepEqual(states('*.PNG -text\n', 'logo.png'), { text: 'unspecified' }, 'matching is case sensitive');
assert.deepEqual(states('a/**/z mark\n', 'a/b/c/z'), { mark: 'set' }, '** crosses directories');
assert.deepEqual(states('"sp ace.txt" text\n', 'sp ace.txt'), { text: 'set' }, 'quoted patterns keep spaces');
assert.deepEqual(states('\\!important text\n', '!important'), { text: 'set' }, 'an escaped bang is literal');

// A directory path: basename patterns drop its trailing slash, a pattern that
// ends in a slash only matches the directory path itself.
assert.deepEqual(states('sub export-ignore\n', 'sub/'), { 'export-ignore': 'set' });
assert.deepEqual(states('sub/ export-ignore\n', 'sub/'), { 'export-ignore': 'set' });
assert.deepEqual(states('sub/ export-ignore\n', 'sub'), { 'export-ignore': 'unspecified' });
assert.equal(plain(C.resolve({ attributes: 'src/** eol=lf\n', path: './src//app.js' })).path, 'src/app.js');

// Forbidden negative patterns are reported and ignored, not applied.
const negative = plain(C.resolve({ attributes: '!never text\n* text=auto\n', path: 'never/x.txt' }));
assert.equal(negative.warnings.length, 1);
assert.ok(/negative patterns are forbidden/.test(negative.warnings[0]));
assert.deepEqual(statesOf(negative), { text: 'value:auto' });

// ---- Refusals.
assert.equal(failure('*.js text\n', ''), 'Enter a path to resolve.');
assert.equal(failure('*.js text\n', 'a/../b'), 'A path must not contain ".."; paths are relative to the .gitattributes file.');
assert.equal(failure('*.js text\n' + 'x'.repeat(1001) + ' text\n', 'a.txt'), 'Line 2 exceeds 1,000 characters.');
assert.equal(failure('*.js text\n', 'x'.repeat(1001)), 'The path exceeds 1,000 characters.');
assert.equal(failure(Array(501).fill('*.js text').join('\n'), 'a.js'), 'The attributes text exceeds 500 lines.');
assert.equal(failure(null, 'a.js'), 'The attributes must be text.');
assert.equal(failure('*.js text\n', 42), 'The path must be text.');
assert.equal(failure('*.js text\n', 'x'.repeat(1000)), null, 'a 1,000-character path is accepted');

// ---- The catalog record and its replay.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Git Attributes Resolver');
assert.equal(record.category, 'Developer');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(record.added), 'added is a UTC timestamp');
assert.ok(record.description.length > 100, 'description is descriptive');
assert.ok(record.method.includes('later line wins per attribute'), 'method states precedence');
assert.ok(record.method.includes('negative patterns are forbidden'), 'method states the negative-pattern rule');
assert.ok(record.method.includes('dir/**'), 'method explains the directory fix');
assert.ok(record.method.includes('built-in binary macro'), 'method documents the built-in macro');
assert.ok(record.method.includes('git check-attr'), 'method names the reference implementation');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.equal(record.sources.length, 3, 'three references are cited');
for (const source of record.sources) {
  assert.ok(typeof source.title === 'string' && source.title.length > 60, 'every reference is titled specifically');
  assert.ok(/^https:\/\/git-scm\.com\/docs\//.test(source.url), 'the references are Git manual pages');
}
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 24, 'catalog case count');
assert.equal(kinds('golden'), 10, 'ten golden cases');
assert.equal(kinds('boundary'), 7, 'seven boundary cases');
assert.equal(kinds('validation'), 7, 'seven validation cases');

let replayed = 0;
for (const testCase of record.testCases) {
  const attributes = testCase.input.attributes;
  const inputPath = testCase.input.path;
  if (testCase.kind === 'validation') {
    assert.equal(failure(attributes, inputPath), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = plain(C.resolve({ attributes, path: inputPath }));
  assert.equal(actual.matched, testCase.matched, testCase.name + ' matched');
  assert.deepEqual(statesOf(actual), testCase.states, testCase.name + ' states');
  replayed += 1;
}

// The new record's slug, name and aliases must not collide with any other record.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');
for (const tag of ['developer', 'git', 'gitattributes', 'attributes', 'pattern', 'analysis-validation']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}
assert.equal(catalog.tools.length, 2447, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2186, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Developer').length, 54,
  'Developer count');
assert.ok(!catalog.tools.some((tool) => /gitattributes/.test([tool.slug, tool.name].concat(tool.aliases || []).join(' ').toLowerCase())
  && tool.slug !== slug), 'no other gitattributes record');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 10, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.equal(markupIds.size, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])).size,
  'no duplicate ids');
assert.ok(/<label[^>]*for="attributes">/.test(html) && /<label[^>]*for="path">/.test(html), 'both fields are labelled');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html) && /min-height:46px/.test(html), 'controls keep touch-sized targets');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/@media \(max-width:620px\)/.test(html), 'the layout has a narrow breakpoint');
assert.ok(/data-label/.test(html), 'stacked cells carry their column labels');
assert.ok(/id="clear"/.test(html) && /id="sample"/.test(html), 'clear and sample controls exist');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('git attributes resolver: ' + replayed + ' catalog cases, the gitattributes model and the page contract pass');
