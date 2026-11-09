/* Regression checks for the .gitignore pattern tester core.
 * Expectations were verified independently against `git check-ignore -v`.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/gitignore-pattern-tester/index.html'), 'utf8');
const startMarker = '/* gitignore-core:start */';
const endMarker = '/* gitignore-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'gitignore core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = GitignoreCore;', sandbox);
const C = sandbox.module.exports;

function run(patterns, paths) {
  return C.evaluate({ patterns, paths });
}

function verdicts(result) {
  const out = [];
  for (const item of result.results) out.push(item.ignored === true);
  return out;
}

function lines(result) {
  const out = [];
  for (const item of result.results) out.push(item.rule ? item.rule.line : null);
  return out;
}

// 1. Unanchored wildcard matches at any depth, never across a slash.
let r = run('*.log\n', 'a.log\nb/a.log\na.logger\n');
assert.deepEqual(verdicts(r), [true, true, false]);
assert.deepEqual(lines(r), [1, 1, null]);
assert.equal(r.summary.ignored, 2);
assert.equal(r.summary.notIgnored, 1);

// 2. A directory-only rule matches the directory and everything below it,
//    but not a same-named file.
r = run('build/\n', 'build/x.txt\nbuild\n');
assert.deepEqual(verdicts(r), [true, false]);
assert.equal(r.results[0].viaAncestor, 'build');
assert.equal(r.results[1].directoryNote.line, 1, 'file should be flagged as directory-only match');
r = run('build/\n', 'build/\n');
assert.deepEqual(verdicts(r), [true], 'trailing slash marks the path as a directory');

// 3. Negation re-includes a file, but not when a parent directory is excluded.
r = run('*.log\n!important.log\n', 'important.log\nsub/important.log\n');
assert.deepEqual(verdicts(r), [false, false]);
assert.deepEqual(lines(r), [2, 2]);
r = run('build/\n!build/keep.txt\n', 'build/keep.txt\n');
assert.deepEqual(verdicts(r), [true]);
assert.deepEqual(lines(r), [1]);
assert.equal(r.results[0].viaAncestor, 'build');

// 4. A star rule leaves the directory itself unexcluded, so re-inclusion works.
r = run('build/*\n!build/keep.txt\n', 'build/keep.txt\nbuild/other.txt\n');
assert.deepEqual(verdicts(r), [false, true]);
assert.deepEqual(lines(r), [2, 1]);

// 5. Leading slash anchors the pattern to the top level.
r = run('/build/\n', 'build/x\na/build/x\n');
assert.deepEqual(verdicts(r), [true, false]);
r = run('doc/frotz\n', 'doc/frotz\na/doc/frotz\n');
assert.deepEqual(verdicts(r), [true, false]);

// 6. Double-star forms.
r = run('a/**/b\n', 'a/b\na/x/b\na/x/y/b\na/b/c\n');
assert.deepEqual(verdicts(r), [true, true, true, true]);
assert.equal(r.results[3].viaAncestor, 'a/b');
r = run('abc/**\n', 'abc/x\nabc/x/y\nabc\nabcd/x\n');
assert.deepEqual(verdicts(r), [true, true, false, false]);
r = run('**/foo\n', 'foo\na/foo\na/b/foo\n');
assert.deepEqual(verdicts(r), [true, true, true]);

// 7. Character classes, negation inside classes, and question marks.
r = run('[Bb]uild/\n[!a]*.txt\n', 'Build/x\nbuild/x\nb.txt\na.txt\nzz.txt\n');
assert.deepEqual(verdicts(r), [true, true, true, false, true]);
r = run('?.md\n', 'a.md\nab.md\nd/a.md\n');
assert.deepEqual(verdicts(r), [true, false, true]);

// 8. Escaped markers and escaped spaces stay literal; trailing spaces are trimmed.
r = run('\\#notes.md\n\\!important.txt\n', '#notes.md\n!important.txt\nnotes.md\n');
assert.deepEqual(verdicts(r), [true, true, false]);
r = run('foo   \n', 'foo\nfoo   \n');
assert.deepEqual(verdicts(r), [true, false]);
r = run('foo\\ \n', 'foo \nfoo\n');
assert.deepEqual(verdicts(r), [true, false]);

// 9. Last matching rule wins, including a negated final rule.
r = run('*.log\n!*.log\nkeep.log\n', 'keep.log\ndrop.log\n');
assert.deepEqual(verdicts(r), [true, false]);
assert.deepEqual(lines(r), [3, 2]);

// 10. Comments and blank lines are skipped.
r = run('# comment\n\n*.tmp\n', 'x.tmp\ncomment\n');
assert.deepEqual(verdicts(r), [true, false]);
assert.deepEqual(lines(r), [3, null]);
assert.equal(r.summary.rules, 1);

// 11. A directory can be re-included before its contents are judged.
r = run('build/\n!build/\n', 'build/x.txt\n');
assert.deepEqual(verdicts(r), [false]);

// 12. Directory-only patterns report a directory hint for file paths.
r = run('node_modules/\n', 'node_modules\n');
assert.deepEqual(verdicts(r), [false]);
assert.equal(r.results[0].directoryNote.line, 1);

// 13. Warnings for unusual input.
r = run('a[b\n', 'ab\n');
assert.ok(r.warnings.some((w) => w.includes('unclosed')), 'unclosed bracket warning');
r = run('a**b\n', 'axxb\n');
assert.ok(r.warnings.some((w) => w.includes('behaves like a single')), 'double-star-inside-name warning');
r = run('*.log\n', '/a.log\n');
assert.ok(r.warnings.some((w) => w.includes('leading “/”')), 'leading slash warning');
r = run('*.log\n', 'a.log\na.log\n');
assert.ok(r.warnings.some((w) => w.includes('more than once')), 'duplicate path warning');
assert.equal(r.summary.paths, 1);
r = run('*.log\n', 'a\\b.log\n');
assert.ok(r.warnings.some((w) => w.includes('ordinary character')), 'backslash warning');
r = run('!\n*.log\n', 'a.log\n');
assert.ok(r.warnings.some((w) => w.includes('re-includes nothing')), 'bare negation warning');
assert.deepEqual(verdicts(r), [true]);

// 14. Refusals.
assert.throws(() => run('', 'a.txt\n'), /No usable patterns were found/);
assert.throws(() => run('# only\n', 'a.txt\n'), /No usable patterns were found/);
assert.throws(() => run('*.log\n', ''), /No usable paths were found/);
assert.throws(() => run('a\n', '../x.txt\n'), /must not contain/);
assert.throws(() => run('a\n', Array.from({ length: 501 }, () => 'x').join('\n') + '\n'), /exceeds 500 lines/);
assert.throws(() => run(Array.from({ length: 501 }, () => 'x').join('\n'), 'a\n'), /exceeds 500 lines/);
assert.throws(() => run('a'.repeat(1001) + '\n', 'a\n'), /exceeds 1,000 characters/);
assert.throws(() => run('a\n', 'a'.repeat(1001) + '\n'), /exceeds 1,000 characters/);

// 15. Input is not mutated and results are deterministic.
const frozenPatterns = 'build/\n!build/keep.txt\n*.log\n';
const first = verdicts(run(frozenPatterns, 'build/keep.txt\napp.log\nsrc/app.js\n'));
const second = verdicts(run(frozenPatterns, 'build/keep.txt\napp.log\nsrc/app.js\n'));
assert.deepEqual(first, second);
assert.deepEqual(first, [true, true, false]);
assert.equal(frozenPatterns, 'build/\n!build/keep.txt\n*.log\n');

console.log('gitignore pattern tester: all core checks passed');
