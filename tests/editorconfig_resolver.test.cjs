/* Regression checks for the EditorConfig settings resolver core.
 * Expectations follow the EditorConfig specification 0.17.2 (spec.editorconfig.org).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const pagePath = path.join(root, 'frontend/tools/editorconfig-resolver/index.html');
const html = fs.readFileSync(pagePath, 'utf8');
const startMarker = '/* editorconfig-core:start */';
const endMarker = '/* editorconfig-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'editorconfig core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = EditorConfigCore;', sandbox);
const C = sandbox.module.exports;

function textarea(id) {
  const open = html.indexOf('<textarea id="' + id + '"');
  assert.ok(open > 0, 'textarea ' + id + ' missing');
  const body = html.indexOf('>', open) + 1;
  return html.slice(body, html.indexOf('</textarea>', body));
}

const SAMPLE = textarea('config');
const SAMPLE_PATHS = textarea('paths');

function run(config, paths) {
  return C.evaluate({ config, paths });
}

/* Objects from the vm sandbox carry another realm's prototypes, so copy them
 * into this realm before comparing structure. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function values(result) {
  const out = {};
  for (const row of result.values) out[row.key] = row.value;
  return out;
}

function find(report, file) {
  return report.results.find((item) => item.path === file);
}

function matchedList(report) {
  return plain(report.results.map((item) => item.matched));
}

function pathList(report) {
  return plain(report.results.map((item) => item.path));
}

// 1. The page defaults are the editorconfig.org example and resolve as documented.
assert.ok(SAMPLE.includes('root = true'), 'the default config declares root');
assert.ok(SAMPLE.includes('[{package.json,.travis.yml}]'), 'the default config uses brace alternatives');
let report = run(SAMPLE, SAMPLE_PATHS);
assert.deepEqual(plain(report.summary), { sections: 6, paths: 6, matched: 6, unmatched: 0 });
assert.deepEqual(plain(report.root), { value: 'true', line: 4 });
let py = find(report, 'src/app.py');
assert.equal(py.matched, 3);
assert.deepEqual(values(py), {
  indent_style: 'space', indent_size: '4', tab_width: '4',
  end_of_line: 'lf', charset: 'utf-8', insert_final_newline: 'true'
});
assert.deepEqual(plain(py.missing), ['spelling_language', 'trim_trailing_whitespace']);
assert.equal(py.indent, '4 spaces');
assert.deepEqual(plain(py.values.find((row) => row.key === 'tab_width')),
  { key: 'tab_width', value: '4', derived: true, from: 'indent_size', line: null, section: null });
let libJs = find(report, 'lib/util.js');
assert.equal(libJs.matched, 3);
assert.equal(values(libJs).indent_size, '2');
assert.equal(libJs.indent, '2 spaces');
let makefile = find(report, 'Makefile');
assert.equal(makefile.matched, 2);
assert.deepEqual(values(makefile), { indent_style: 'tab', end_of_line: 'lf', insert_final_newline: 'true' });
assert.equal(makefile.indent, '1 tab, with the width from the editor default');
let indexJs = find(report, 'src/index.js');
assert.equal(indexJs.indent, null, 'no indent property is set for src/index.js');
assert.deepEqual(values(indexJs), { end_of_line: 'lf', charset: 'utf-8', insert_final_newline: 'true' });

// 2. Sections apply in file order and the last value wins.
report = run('[*.js]\nindent_size = 2\nend_of_line = crlf\n[lib/*.js]\nindent_size = 4\n', 'lib/a.js\nx.md');
assert.equal(find(report, 'lib/a.js').matched, 2);
assert.equal(values(find(report, 'lib/a.js')).indent_size, '4');
assert.equal(values(find(report, 'lib/a.js')).end_of_line, 'crlf');
assert.equal(find(report, 'x.md').matched, 0);
assert.equal(find(report, 'x.md').indent, null);

// 3. unset removes the effect of an earlier pair.
report = run('[*]\nend_of_line = crlf\n[*.js]\nend_of_line = unset\n', 'a.js');
assert.deepEqual(values(find(report, 'a.js')), {});
assert.deepEqual(plain(find(report, 'a.js').unset), [{ key: 'end_of_line', line: 4, section: '*.js' }]);
assert.ok(!find(report, 'a.js').missing.includes('end_of_line'),
  'a cleared property is reported as unset, not as an editor default');

// 4. Anchoring: a slash pins the pattern to this directory.
report = run('[lib/*.js]\nindent_size = 2\n[src/lib/*.js]\nindent_size = 4\n', 'lib/a.js\nsrc/lib/a.js');
assert.equal(find(report, 'lib/a.js').matched, 1);
assert.equal(values(find(report, 'lib/a.js')).indent_size, '2');
assert.equal(find(report, 'src/lib/a.js').matched, 1);
assert.equal(values(find(report, 'src/lib/a.js')).indent_size, '4');

// 5. A leading slash changes nothing when the name already holds a slash.
report = run('[/top.c]\ncharset = utf-8\n[sub/top.c]\nend_of_line = cr\n', 'top.c\nsub/top.c\nx/sub/top.c');
assert.equal(values(find(report, 'top.c')).charset, 'utf-8');
assert.equal(find(report, 'x/sub/top.c').matched, 0, 'the section without a slash matches at any depth');
report = run('[top.c]\ncharset = utf-8\n', 'top.c\na/b/top.c');
assert.equal(find(report, 'a/b/top.c').matched, 1);

// 6. A section name without a slash matches at that level and below.
report = run('[*.py]\nindent_size = 8\n', 'a.py\ndeep/dir/b.py');
assert.equal(find(report, 'a.py').matched, 1);
assert.equal(find(report, 'deep/dir/b.py').matched, 1);
assert.equal(values(find(report, 'deep/dir/b.py')).tab_width, '8');

// 7. A section name ending with a slash matches no file.
report = run('[doc/]\nindent_style = tab\n', 'doc/x\ndoc/');
assert.equal(find(report, 'doc/x').matched, 0);
assert.equal(find(report, 'doc').matched, 0, 'trailing slash is removed from the path and still does not match');
assert.ok(report.warnings.some((warning) => warning.includes('matches no file')), 'trailing-slash warning');

// 8. Brace alternatives, nesting and integer ranges.
report = run('[{a,b}.txt]\ncharset = latin1\n[a{b,c}d{x,y}.md]\nindent_size = 3\n[f{1..3}.c]\nend_of_line = cr\n',
  'a.txt\nc.txt\nabdx.md\nacdy.md\nadx.md\nf1.c\nf3.c\nf4.c');
assert.deepEqual(matchedList(report), [1, 0, 1, 1, 0, 1, 1, 0]);
report = run('[x{-1..2}.c]\nend_of_line = cr\n', 'x-1.c\nx0.c\nx2.c\nx3.c');
assert.deepEqual(matchedList(report), [1, 1, 1, 0]);

// 9. A brace that is not an alternative or a range is literal.
report = run('[*.{js}]\ncharset = utf-8\n', 'a.{js}\nb.js');
assert.equal(find(report, 'a.{js}').matched, 1);
assert.equal(find(report, 'b.js').matched, 0);
assert.ok(report.warnings.some((warning) => warning.includes('no comma')), 'single-item brace warning');
report = run('[f{3..1}.txt]\nend_of_line = cr\n', 'f3.txt\nf{3..1}.txt');
assert.equal(find(report, 'f{3..1}.txt').matched, 1, 'a decreasing range is literal');
assert.ok(report.warnings.some((warning) => warning.includes('increasing')), 'decreasing range warning');

// 10. Character classes, negated classes and literal dashes.
report = run('[x[!ab].md]\ncharset = latin1\n', 'xc.md\nxa.md\nx!.md');
assert.deepEqual(matchedList(report), [1, 0, 1]);
report = run('[x[-a].md]\ncharset = latin1\n', 'x-.md\nxp.md');
assert.deepEqual(matchedList(report), [1, 0]);
assert.ok(report.warnings.some((warning) => warning.includes('literal character')), 'dash warning');

// 11. `?` and `*` never cross a slash; `**` does.
report = run('[?.c]\nindent_size = 2\n', 'a.c\nab.c\nsrc/a.c');
assert.deepEqual(matchedList(report), [1, 0, 1]);
report = run('[a/**/b]\nindent_size = 2\n', 'a/b\na/x/b\na/x/y/b');
assert.deepEqual(matchedList(report), [0, 1, 1],
  'the slashes around ** stay literal, so a directory level is required');
report = run('[lib/**.js]\nindent_size = 2\n', 'lib/a.js\nlib/deep/b.js\nother/lib/c.js');
assert.deepEqual(matchedList(report), [1, 1, 0]);

// 12. Escapes keep wildcards literal.
report = run('[\\*.txt]\ncharset = latin1\n[foo\\ bar.txt]\nend_of_line = cr\n', '*.txt\na.txt\nfoo bar.txt');
assert.deepEqual(matchedList(report), [1, 0, 1]);

// 13. Unclosed brackets and braces fall back to literal characters.
report = run('[a[b.c]\nend_of_line = cr\n', 'a[b.c\nab.c');
assert.deepEqual(matchedList(report), [1, 0]);
assert.ok(report.warnings.some((warning) => warning.includes('unclosed ““[”') || warning.includes('unclosed')), 'unclosed bracket warning');
report = run('[a{b.c]\nend_of_line = cr\n', 'a{b.c');
assert.equal(find(report, 'a{b.c').matched, 1);

// 14. Values are folded to lower case, keys too.
report = run('[*.py]\nINDENT_STYLE = TaB\nEND_OF_LINE = CRLF\n', 'a.py');
assert.deepEqual(values(find(report, 'a.py')), { indent_style: 'tab', end_of_line: 'crlf' });
assert.equal(find(report, 'a.py').indent, '1 tab, with the width from the editor default');

// 15. An unsupported value for a known key is ignored, so the earlier value stands.
report = run('[*.md]\nindent_size = 2\nindent_size = four\nend_of_line = windows\n', 'a.md');
assert.deepEqual(values(find(report, 'a.md')), { indent_size: '2', tab_width: '2' });
assert.ok(report.warnings.some((warning) => warning.includes('not a supported value')), 'unsupported value warning');
report = run('[*.md]\nindent_size = four\n', 'a.md');
assert.deepEqual(values(find(report, 'a.md')), {}, 'an unsupported value never becomes the setting');
report = run('[*.md]\nspelling_language = en_US\n', 'a.md');
assert.deepEqual(values(find(report, 'a.md')), {}, 'spelling_language needs ss or ss-TT');
report = run('[*.md]\nspelling_language = pt-BR\n', 'a.md');
assert.equal(values(find(report, 'a.md')).spelling_language, 'pt-br');

// 16. tab_width defaults to indent_size and indent_size = tab takes tab_width.
report = run('[*.py]\nindent_style = space\nindent_size = 2\n', 'a.py');
assert.deepEqual(values(find(report, 'a.py')), { indent_style: 'space', indent_size: '2', tab_width: '2' });
assert.equal(find(report, 'a.py').indent, '2 spaces');
report = run('[*.c]\nindent_style = tab\nindent_size = tab\ntab_width = 4\n', 'a.c');
assert.deepEqual(values(find(report, 'a.c')), { indent_style: 'tab', indent_size: 'tab', tab_width: '4' });
assert.equal(find(report, 'a.c').indent, '1 tab (4 columns)');
report = run('[*.c]\nindent_style = tab\nindent_size = tab\n', 'a.c');
assert.equal(find(report, 'a.c').indent, '1 tab, with the width from the editor default');
report = run('[*.c]\nindent_size = 4\n', 'a.c');
assert.equal(find(report, 'a.c').indent, 'width 4 columns, but indent_style is not set');
report = run('[*.c]\nindent_style = space\n', 'a.c');
assert.equal(find(report, 'a.c').indent, 'spaces, with the width from the editor default');

// 17. The three indentation examples from the specification.
assert.equal(C.indentText({ indent_style: { value: 'tab' }, indent_size: { value: '4' }, tab_width: { value: '3' } }),
  '1 tab + 1 space (4 columns)');
assert.equal(C.indentText({ indent_style: { value: 'tab' }, indent_size: { value: '8' }, tab_width: { value: '4' } }),
  '2 tabs (8 columns)');
assert.equal(C.indentText({ indent_style: { value: 'tab' }, indent_size: { value: '4' }, tab_width: { value: '8' } }),
  '4 spaces (a tab is 8 columns wide, so it cannot be used)');
assert.equal(C.indentText({ indent_style: { value: 'tab' }, indent_size: { value: '0' } }), 'no indentation (0 columns)');
assert.equal(C.indentText({ indent_style: { value: 'space' }, indent_size: { value: '1' } }), '1 space');
assert.equal(C.indentText({}), null);

// 18. Preamble handling.
report = run('root = true\nindent_size = 8\n[*]\nindent_size = 2\n', 'a.txt');
assert.deepEqual(plain(report.root), { value: 'true', line: 1 });
assert.deepEqual(values(find(report, 'a.txt')), { indent_size: '2', tab_width: '2' });
assert.ok(report.warnings.some((warning) => warning.includes('outside every section')), 'preamble pair warning');
report = run('root = maybe\n[*]\nindent_size = 2\n', 'a.txt');
assert.deepEqual(plain(report.root), { value: 'maybe', line: 1 });
assert.ok(report.warnings.some((warning) => warning.includes('not true or false')), 'root value warning');
report = run('[*]\nroot = true\nindent_size = 2\n', 'a.txt');
assert.equal(report.root, null);
assert.ok(report.warnings.some((warning) => warning.includes('only takes effect in the preamble')), 'root in section warning');
report = run('[broken\n[*]\nindent_size = 2\n', 'a.txt');
assert.ok(report.warnings.some((warning) => warning.includes('closing “]”')), 'unclosed header warning');
assert.equal(report.summary.sections, 1);
report = run('[]\nindent_size = 2\n', 'a.txt');
assert.equal(find(report, 'a.txt').matched, 0);
assert.ok(report.warnings.some((warning) => warning.includes('empty section name')), 'empty section warning');
report = run('[*]\nindent_size = 2\nnonsense line\n', 'a.txt');
assert.ok(report.warnings.some((warning) => warning.includes('not a comment')), 'invalid line warning');

// 19. Paths are relative to the config directory.
report = run('[*]\nindent_size = 2\n', '/a.txt\n./b.txt\nsub//c.txt\nsub/d.txt/\n');
assert.deepEqual(pathList(report), ['a.txt', 'b.txt', 'sub/c.txt', 'sub/d.txt']);
assert.deepEqual(matchedList(report), [1, 1, 1, 1]);
assert.ok(report.warnings.some((warning) => warning.includes('trailing “/”')), 'trailing slash path warning');
report = run('[*]\nindent_size = 2\n', 'a.txt\n a.txt \na.txt\n');
assert.equal(report.summary.paths, 1, 'duplicates are dropped');
assert.ok(report.warnings.some((warning) => warning.includes('more than once')), 'duplicate path warning');
assert.throws(() => run('[*]\n', '../x.txt\n'), /must not contain “\.\.”/);
assert.throws(() => run('[*]\n', '/\n'), /empty after removing the leading slash/);

// 20. Refusals.
assert.throws(() => run('# comment\n; another\n', 'a.txt\n'),
  /No sections were found/);
assert.throws(() => run('root = true\n', 'a.txt\n'), /No sections were found/);
assert.throws(() => run('[*]\nindent_size = 2\n', ''), /No file paths were found/);
assert.throws(() => run('[*]\nindent_size = 2\n', '\n  \n'), /No file paths were found/);
assert.throws(() => run(Array.from({ length: 401 }, () => '[*]').join('\n'), 'a.txt'),
  /exceeds 400 lines/);
assert.throws(() => run('[' + 'a'.repeat(1030) + ']\n', 'a.txt'), /exceeds 1,024 characters/);
assert.throws(() => run('[*]\n', Array.from({ length: 61 }, (_, index) => 'f' + index).join('\n')),
  /exceeds 60 lines/);
assert.throws(() => run('[*]\n', 'a'.repeat(1030) + '\n'), /exceeds 1,024 characters/);
assert.throws(() => run('[*]\n' + 'x'.repeat(1030) + ' = y\n', 'a.txt'), /exceeds 1,024 characters/);

// 21. Determinism and no mutation of the input.
const config = SAMPLE;
const before = config;
const first = run(config, 'src/app.py\nlib/util.js');
const second = run(config, 'src/app.py\nlib/util.js');
assert.deepEqual(first.results, second.results);
assert.equal(config, before);

// 22. The catalog record matches the page and the resolver.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2300, 'catalog total');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Developer').length, 46, 'Developer count');
const record = catalog.tools.find((tool) => tool.slug === 'editorconfig-resolver');
assert.ok(record, 'catalog record present');
assert.equal(record.name, 'EditorConfig Settings Resolver');
assert.equal(record.category, 'Developer');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.sources.length, 2, 'two documented sources');
assert.equal(record.sources[0].url, 'https://spec.editorconfig.org/');
assert.equal(record.sources[1].url, 'https://editorconfig.org/');
assert.ok(fs.existsSync(path.join(root, 'frontend/tools', record.slug, 'index.html')), 'page exists');
assert.ok(record.testCases.length >= 20, 'the record carries its test cases');

// 23. The slug, name, aliases and tags collide with nothing else in the catalog.
//     (Other records are not audited here: the catalog carries older duplicates.)
const names = new Map();
for (const tool of catalog.tools) {
  if (tool.slug === 'editorconfig-resolver') continue;
  for (const label of [tool.name, ...(tool.aliases || [])]) {
    names.set(label.toLowerCase(), tool.slug);
  }
}
for (const label of [record.name, ...record.aliases, record.slug]) {
  assert.ok(!names.has(label.toLowerCase()),
    'the new record reuses “' + label + '” from ' + names.get(label.toLowerCase()));
}
for (const label of ['editorconfig', 'editorconfig resolver', '.editorconfig settings']) {
  assert.ok(record.aliases.includes(label), label + ' is one of the new aliases');
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'unique aliases');
assert.equal(new Set(record.tags).size, record.tags.length, 'unique tags');

// 24. Every catalog case replays through the core.
function replay(testCase) {
  const expected = testCase.expected;
  let report;
  try {
    report = run(testCase.input.config, testCase.input.paths);
  } catch (error) {
    if (expected.error) {
      assert.equal(error.userMessage, expected.error, testCase.name);
      return;
    }
    throw error;
  }
  assert.ok(!expected.error, testCase.name + ' should have been refused');
  if (Object.prototype.hasOwnProperty.call(expected, 'root')) {
    assert.equal(report.root ? report.root.value : null, expected.root, testCase.name + ' root');
  }
  assert.deepEqual(pathList(report),
    expected.resolved.map((item) => item.path), testCase.name + ' paths');
  expected.resolved.forEach((want, index) => {
    const got = report.results[index];
    assert.equal(got.matched, want.matched, testCase.name + ' matched ' + want.path);
    assert.deepEqual(values(got), want.values, testCase.name + ' values ' + want.path);
    assert.equal(got.indent, want.indent, testCase.name + ' indent ' + want.path);
    if (want.cleared) assert.deepEqual(plain(got.unset.map((item) => item.key)), want.cleared, testCase.name + ' cleared');
  });
}
for (const testCase of record.testCases) replay(testCase);
assert.equal(record.testCases.filter((item) => item.kind === 'golden').length, 19, 'golden case count');
assert.equal(record.testCases.filter((item) => item.kind === 'validation').length, 3, 'validation case count');

// 25. A seeded sweep against a model written inside this test.
let seed = 20261115;
function random() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function pick(list) {
  return list[Math.floor(random() * list.length)];
}
const KEYS = [['indent_style', ['tab', 'space']], ['indent_size', ['1', '2', '4', '8', 'tab', 'bad']],
  ['tab_width', ['2', '3', '4', '8']], ['end_of_line', ['lf', 'cr', 'crlf', 'x']],
  ['charset', ['utf-8', 'latin1']], ['trim_trailing_whitespace', ['true', 'false']],
  ['insert_final_newline', ['true', 'false']]];
const SHAPES = ['*', '*.js', '*.{js,py,c}', 'lib/*.js', '**/a.c', '?.md', 'x[!ab].md',
  '{a,b}.txt', 'f{1..3}.c', '**', '*.{js}', 'a/**/b'];
const PATHS = ['a.js', 'lib/b.js', 'lib/deep/c.py', 'x.js', 'a.txt', 'b.txt', 'f2.c', 'f9.c',
  'y.md', 'xa.md', 'xc.md', 'a/b', 'src/lib/d.js', '{js.js'];
let swept = 0;
for (let round = 0; round < 250; round += 1) {
  const lines = [];
  const sections = [];
  const sectionCount = 1 + Math.floor(random() * 3);
  for (let index = 0; index < sectionCount; index += 1) {
    const shape = pick(SHAPES);
    lines.push('[' + shape + ']');
    const pairs = [];
    const pairCount = 1 + Math.floor(random() * 3);
    for (let pair = 0; pair < pairCount; pair += 1) {
      const [key, options] = pick(KEYS);
      const value = random() < 0.12 ? 'unset' : pick(options);
      lines.push(key + ' = ' + value);
      pairs.push([key, value]);
    }
    sections.push({ shape, pairs });
  }
  const config = lines.join('\n');
  const paths = PATHS.filter(() => random() < 0.6);
  if (!paths.length) continue;
  const report = run(config, paths.join('\n'));
  // Independent model: expand the glob with a hand-written matcher.
  const matches = (shape, file) => {
    const body = shape;
    const anchored = body.includes('/');
    const pattern = body.replace(/^\//, '');
    const parts = pattern.split(/(\*\*|\*|\?|\[[^\]]*\]|\{[^}]*\})/).filter((part) => part !== '');
    const source = parts.map((part) => {
      if (part === '**') return '.*';
      if (part === '*') return '[^/]*';
      if (part === '?') return '[^/]';
      if (part.startsWith('[')) {
        const negative = part[1] === '!';
        const chars = (negative ? part.slice(2, -1) : part.slice(1, -1))
          .split('').map((ch) => ch.replace(/[\\\][^-]/g, (found) => '\\' + found)).join('');
        return '[' + (negative ? '^' : '') + chars + ']';
      }
      if (part.startsWith('{')) {
        const inner = part.slice(1, -1);
        if (inner.includes(',')) return '(?:' + inner.split(',').map((alt) => alt.replace(/[.*+?()[\]{}|\\]/g, (found) => '\\' + found)).join('|') + ')';
        const range = /^(-?\d+)\.\.(-?\d+)$/.exec(inner);
        if (range && Number(range[1]) < Number(range[2])) {
          const numbers = [];
          for (let value = Number(range[1]); value <= Number(range[2]); value += 1) numbers.push(value);
          return '(?:' + numbers.join('|') + ')';
        }
        return '\\{' + inner.replace(/[.*+?()[\]{}|\\]/g, (found) => '\\' + found) + '\\}';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, (found) => '\\' + found);
    }).join('');
    const expression = new RegExp((anchored ? '^' : '(?:^|/)') + source + '$');
    return expression.test(file);
  };
  for (const result of report.results) {
    const matched = sections.filter((section) => matches(section.shape, result.path)).length;
    assert.equal(result.matched, matched, 'sweep matched ' + result.path + ' in ' + config);
    const expected = {};
    let cleared = false;
    for (const section of sections) {
      if (!matches(section.shape, result.path)) continue;
      for (const [key, value] of section.pairs) {
        if (value === 'unset') { delete expected[key]; cleared = true; continue; }
        const known = ['indent_style', 'indent_size', 'tab_width', 'end_of_line', 'charset',
          'spelling_language', 'trim_trailing_whitespace', 'insert_final_newline'].includes(key);
        const supported = {
          indent_style: ['tab', 'space'], indent_size: ['1', '2', '4', '8', 'tab'],
          tab_width: ['2', '3', '4', '8'], end_of_line: ['lf', 'cr', 'crlf'],
          charset: ['utf-8', 'latin1'], trim_trailing_whitespace: ['true', 'false'],
          insert_final_newline: ['true', 'false']
        };
        if (known && !supported[key].includes(value)) continue;
        expected[key] = value;
      }
    }
    if (expected.tab_width === undefined && expected.indent_size && /^\d+$/.test(expected.indent_size)) {
      expected.tab_width = expected.indent_size;
    }
    assert.deepEqual(values(result), expected, 'sweep values ' + result.path + ' in ' + config);
    swept += 1;
  }
}
assert.ok(swept > 500, 'the sweep resolved a useful number of paths, got ' + swept);

console.log('editorconfig resolver: all core checks passed, ' + swept + ' swept paths');
