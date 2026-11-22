/* POSIX ACL effective rights: the mask arithmetic, the refusals, the page
   markup and the catalog record's cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'posix-acl-rights';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* acl-core:start */';
const endMarker = '/* acl-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, Array, Map, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = AclCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const failure = (entries, directory) => {
  try { C.analyze({ entries, directory: Boolean(directory) }); } catch (error) { return error.message; }
  return null;
};
const run = (entries, directory) => plain(C.analyze({ entries, directory: Boolean(directory) }));

// ---- Documented constants.
assert.deepEqual(Array.from(C.LIMITS.entries), [1, 32]);
assert.equal(C.MAX_RAW, 48);
assert.equal(C.DEFAULTS.directory, false);
assert.equal(C.DEFAULTS.entries,
  'user::rw-\nuser:alice:rwx\ngroup::r--\ngroup:devs:rwx\nmask::r-x\nother::---');

// ---- Permission bit helpers.
assert.equal(C.permsText(0), '---');
assert.equal(C.permsText(1), '--x');
assert.equal(C.permsText(2), '-w-');
assert.equal(C.permsText(4), 'r--');
assert.equal(C.permsText(5), 'r-x');
assert.equal(C.permsText(6), 'rw-');
assert.equal(C.permsText(7), 'rwx');
for (let bits = 0; bits < 8; bits += 1) {
  const text = C.permsText(bits);
  assert.equal(text.length, 3);
  assert.equal(C.parsePerms(text, 'u::' + text, 1, 'user'), bits, 'round trip ' + bits);
}
assert.equal(C.octalText(0), '0');
assert.equal(C.octalText(7), '7');
assert.equal(C.joinWords(['a']), 'a');
assert.equal(C.joinWords(['a', 'b']), 'a and b');
assert.equal(C.joinWords(['a', 'b', 'c']), 'a, b and c');
assert.equal(C.elide('short'), '"short"');
assert.ok(C.elide('x'.repeat(60)).endsWith('..."'));
assert.ok(C.elide('x'.repeat(60)).length < 60);

// ---- Tokenizing: comments and blank lines drop, line numbers stay.
assert.deepEqual(plain(C.tokenize('u::rw-\n\n  # note\ng::r--   # tail\no::---')),
  [{ text: 'u::rw-', line: 1 }, { text: 'g::r--', line: 4 }, { text: 'o::---', line: 5 }]);
assert.deepEqual(plain(C.tokenize('')), []);
assert.deepEqual(plain(C.tokenize('# only a comment')), []);
assert.deepEqual(plain(C.tokenize('\r\nu::rwx\r\n')), [{ text: 'u::rwx', line: 2 }]);

// ---- Entry parsing: spellings, orders, numbers, prefixes.
assert.deepEqual(plain(C.parseEntry({ text: 'u::rw-', line: 1 }, false)),
  { raw: 'u::rw-', line: 1, scope: 'access', tag: 'user', qualifier: '', bits: 6 });
assert.equal(C.parseEntry({ text: 'user:alice:rwx', line: 2 }, false).bits, 7);
assert.equal(C.parseEntry({ text: 'u:alice:wr', line: 2 }, false).bits, 6);
assert.equal(C.parseEntry({ text: 'u::x', line: 2 }, false).bits, 1);
assert.equal(C.parseEntry({ text: 'u::7', line: 2 }, false).bits, 7);
assert.equal(C.parseEntry({ text: 'u::0', line: 2 }, false).bits, 0);
assert.equal(C.parseEntry({ text: 'u::---', line: 2 }, false).bits, 0);
assert.equal(C.parseEntry({ text: 'mask::r-x', line: 3 }, false).tag, 'mask');
assert.equal(C.parseEntry({ text: 'm::r-x', line: 3 }, false).tag, 'mask');
assert.equal(C.parseEntry({ text: 'other::---', line: 3 }, false).tag, 'other');
assert.equal(C.parseEntry({ text: 'o::---', line: 3 }, false).tag, 'other');
assert.equal(C.parseEntry({ text: 'default:u::rwx', line: 4 }, true).scope, 'default');
assert.equal(C.parseEntry({ text: 'd:g::r-x', line: 4 }, true).scope, 'default');
assert.equal(C.parseEntry({ text: 'u:1001:r-x', line: 1 }, false).qualifier, '1001');
assert.equal(C.parseEntry({ text: '  u : alice : rw-  ', line: 1 }, false).bits, 6, 'spaces around fields');

// ---- Building: the mask is the union when it is missing, and validity rules hold.
const build = (lines, scope = 'access') =>
  C.buildAcl(lines.map((text, index) => C.parseEntry({ text, line: index + 1 }, scope === 'default')),
    scope);
const minimal = build(['u::rw-', 'g::r--', 'o::---']);
assert.equal(minimal.maskBits, null);
assert.equal(minimal.maskSource, null);
assert.equal(minimal.named, 0);
const implied = build(['u::rw-', 'u:alice:rwx', 'g::r--', 'g:devs:r--', 'o::---']);
assert.equal(implied.maskBits, 7, 'g:: r-- OR alice rwx OR devs r-- is rwx');
assert.equal(implied.maskSource, 'added');
const given = build(['u::rw-', 'g::r--', 'm::r--', 'o::---']);
assert.equal(given.maskBits, 4);
assert.equal(given.maskSource, 'given');
assert.equal(given.named, 0);

// ---- Effective rights: the mask reaches g:: and every named entry only.
const acl = build(['u::rwx', 'u:alice:rwx', 'g::rwx', 'm::r-x', 'o::rwx']);
assert.equal(C.effectiveBits(acl, acl.owner), 7, 'the owner is never masked');
assert.equal(C.effectiveBits(acl, acl.other), 7, 'others are never masked');
assert.equal(C.effectiveBits(acl, acl.group), 5);
assert.equal(C.effectiveBits(acl, acl.namedUsers[0]), 5);
assert.equal(C.effectiveBits(acl, acl.mask), 5);
assert.equal(C.effectiveBits(minimal, minimal.group), 4, 'no mask leaves the entry alone');

assert.equal(C.entryLabel(acl, acl.owner), 'u::');
assert.equal(C.entryLabel(acl, acl.group), 'g::');
assert.equal(C.entryLabel(acl, acl.mask), 'm::');
assert.equal(C.entryLabel(acl, acl.namedUsers[0]), 'u:alice');
assert.equal(C.noteFor(acl, acl.owner), 'the owner is never masked');
assert.equal(C.noteFor(acl, acl.other), 'others are never masked');
assert.equal(C.noteFor(acl, acl.mask), 'the ceiling itself');
assert.equal(C.noteFor(acl, acl.namedUsers[0]), 'the mask removes w');
assert.equal(C.noteFor(minimal, minimal.group), 'no mask: granted in full');
const blocked = build(['u::rw-', 'u:alice:rwx', 'g::---', 'm::---', 'o::---']);
assert.equal(C.noteFor(blocked, blocked.namedUsers[0]), 'the mask leaves nothing');
assert.equal(C.shortOf(implied), 'u::rw-,u:alice:rwx,g::r--,g:devs:r--,m::rwx,o::---');
assert.equal(C.shortOf(minimal), 'u::rw-,g::r--,o::---');

// ---- The page's own default: two grants cut down by the mask.
const base = run(C.DEFAULTS.entries, false);
assert.equal(base.mode, '0650');
assert.equal(base.modeText, '-rw-r-x---');
assert.equal(base.extended, true);
assert.equal(base.maskText, 'r-x');
assert.equal(base.maskSource, 'given');
assert.equal(base.defaultMaskText, null);
assert.equal(base.hasDefault, false);
assert.equal(base.namedUsers, 1);
assert.equal(base.namedGroups, 1);
assert.deepEqual(base.limited, ['alice', 'devs']);
assert.equal(base.entryCount, 6);
assert.equal(base.accessCount, 6);
assert.equal(base.defaultCount, 0);
assert.equal(base.statusKind, 'warning');
assert.equal(base.statusText, 'mode 0650: the mask r-x cuts down alice and devs');
assert.equal(base.summary,
  'ls -l shows 0650 (-rw-r-x---+): the group field comes from the mask r-x, not g:: r--, so alice gets r-x where rwx was granted, devs gets r-x where rwx was granted.');
assert.deepEqual(base.canonical,
  ['setfacl -m u::rw-,u:alice:rwx,g::r--,g:devs:rwx,m::r-x,o::--- <file>']);
assert.deepEqual(base.rows.map((row) => [row.entry, row.granted, row.effective]), [
  ['u::', 'rw-', 'rw-'], ['u:alice', 'rwx', 'r-x'], ['g::', 'r--', 'r--'],
  ['g:devs', 'rwx', 'r-x'], ['m::', 'r-x', 'r-x'], ['o::', '---', '---'],
]);
assert.deepEqual(base.rows.filter((row) => row.masked).map((row) => row.entry), ['u:alice', 'g:devs']);
assert.equal(base.rows[0].note, 'the owner is never masked');
assert.equal(base.rows[1].note, 'the mask removes w');
assert.ok(base.warnings.some((line) => line.startsWith('2 entries are cut down by the mask: alice keeps r-x of rwx')));
assert.ok(base.explanation.some((line) => line.includes('alice was granted rwx (7) and 7 AND 5 = 5 = r-x, so w is dropped')));
assert.ok(base.explanation.some((line) => line.includes('ls -l prints the group field from the mask')));

// ---- A minimal ACL: no mask, no +, the group bits are g:: itself.
const small = run('u::rw-\ng::r--\no::---', false);
assert.equal(small.mode, '0640');
assert.equal(small.modeText, '-rw-r-----');
assert.equal(small.maskText, null);
assert.equal(small.maskSource, null);
assert.equal(small.extended, false);
assert.deepEqual(small.limited, []);
assert.equal(small.statusKind, 'ok');
assert.equal(small.statusText, 'minimal ACL, mode 0640, no mask');
assert.ok(!small.summary.includes('+'), 'no + for a minimal ACL');
assert.deepEqual(small.canonical, ['setfacl -m u::rw-,g::r--,o::--- <file>']);

// ---- A missing mask: setfacl would add the union, and the mode follows it.
const added = run('u::rw-\nu:alice:rwx\ng::r--\no::---', false);
assert.equal(added.maskText, 'rwx');
assert.equal(added.maskSource, 'added');
assert.equal(added.mode, '0670');
assert.equal(added.modeText, '-rw-rwx---');
assert.deepEqual(added.limited, []);
assert.equal(added.canonical[0], 'setfacl -m u::rw-,u:alice:rwx,g::r--,m::rwx,o::--- <file>');
assert.ok(added.warnings.some((line) => line.includes('setfacl would add m::rwx')));
assert.ok(added.explanation.some((line) => line.includes('setfacl derives the mask from these same entries')));

// ---- A mask of nothing removes every group-class grant.
const nothing = run('u::rwx\nu:alice:rwx\ng::rwx\ng:devs:rwx\nm::---\no::rwx', false);
assert.deepEqual(nothing.limited, ['g::', 'alice', 'devs']);
assert.equal(nothing.mode, '0707');
assert.deepEqual(nothing.zero, ['g::', 'alice', 'devs']);
assert.equal(nothing.rows[1].effective, '---');
assert.equal(nothing.rows[1].note, 'the mask leaves nothing');
assert.equal(nothing.statusKind, 'warning');

// ---- A directory with a default ACL: both masks, both canonical lines.
const tree = run('user::rwx\nuser:alice:rwx\ngroup::r-x\ngroup:devs:rwx\nmask::rwx\nother::---\n'
  + 'default:user::rwx\ndefault:user:alice:r-x\ndefault:group::r-x\ndefault:group:devs:r-x\n'
  + 'default:mask::r-x\ndefault:other::---', true);
assert.equal(tree.mode, '0770');
assert.equal(tree.hasDefault, true);
assert.equal(tree.defaultMaskText, 'r-x');
assert.equal(tree.defaultMaskSource, 'given');
assert.equal(tree.accessCount, 6);
assert.equal(tree.defaultCount, 6);
assert.equal(tree.canonical.length, 2);
assert.ok(tree.canonical[1].startsWith('setfacl -d -m u::rwx,u:alice:r-x,g::r-x,g:devs:r-x,m::r-x,o::--- <dir>'));
assert.ok(tree.warnings.some((line) => line.startsWith('The 6 default: entries are the template')));
assert.equal(tree.rows.filter((row) => row.scope === 'default').length, 6);
assert.equal(tree.rows[6].entry, 'default:u::');

// ---- getfacl output pastes straight in, comments and all.
const pasted = run('# file: /srv/app\n# owner: root\n# group: www-data\nuser::rw-\n'
  + 'user:lisa:rw-\t\t#effective:r--\ngroup::r--\ngroup:toolies:rw-\t\t#effective:r--\n'
  + 'mask::r--\nother::r--', false);
assert.equal(pasted.entryCount, 6);
assert.equal(pasted.mode, '0644');
assert.deepEqual(pasted.limited, ['lisa', 'toolies']);
assert.equal(pasted.rows[1].granted, 'rw-');
assert.equal(pasted.rows[1].effective, 'r--');

// ---- Every refusal, with its message.
assert.equal(failure('', false), 'Enter at least one ACL entry, such as u::rw- or u:alice:r-x.');
assert.equal(failure('# nothing\n   \n', false), 'Enter at least one ACL entry, such as u::rw- or u:alice:r-x.');
assert.equal(failure(Array(33).fill('u::rwx').join('\n'), false),
  'Enter at most 32 ACL entries; 33 were given.');
assert.equal(failure('u::rw-\no::---', false),
  'The access ACL is missing g::; every ACL carries exactly one u::, g:: and o::.');
assert.equal(failure('u::rw-\ng::---', false),
  'The access ACL is missing o::; every ACL carries exactly one u::, g:: and o::.');
assert.equal(failure('g::---\no::---', false),
  'The access ACL is missing u::; every ACL carries exactly one u::, g:: and o::.');
assert.equal(failure('u::rw-\nu::r--\ng::---\no::---', false),
  'The access ACL has two u:: entries (lines 1 and 2); it needs exactly one.');
assert.equal(failure('u::rw-\ng::---\ng::r--\no::---', false),
  'The access ACL has two g:: entries (lines 2 and 3); it needs exactly one.');
assert.equal(failure('u::rw-\ng::---\no::---\no::r--', false),
  'The access ACL has two o:: entries (lines 3 and 4); it needs exactly one.');
assert.equal(failure('u::rw-\ng::---\nm::r--\nm::---\no::---', false),
  'The access ACL has two m:: entries (lines 3 and 4); a mask may appear only once.');
assert.equal(failure('u::rw-\nu:alice:r--\nu:alice:rwx\ng::---\no::---', false),
  'The access ACL names the user "alice" twice (lines 2 and 3).');
assert.equal(failure('u::rw-\ng::---\ng:devs:r--\ng:devs:rwx\no::---', false),
  'The access ACL names the group "devs" twice (lines 3 and 4).');
assert.equal(failure('u::rw-\ng::---\nm:alice:r--\no::---', false),
  'The mask entry "m:alice:r--" on line 3 has a qualifier; mask entries name nothing, so write m::r-x.');
assert.equal(failure('u::rw-\ng::---\no:x:r--', false),
  'The other entry "o:x:r--" on line 3 has a qualifier; other entries name nothing, so write o::---.');
assert.equal(failure('u::rw-\ng::---\no::---\ndefault:u::rwx', false),
  'Entry "default:u::rwx" on line 4 is a default: entry, but a default ACL exists only on a directory; '
  + 'tick "This object is a directory" to allow it.');
assert.equal(failure('u::rw-\ng::---\no::---\ndefault:u::rwx\ndefault:o::---', true),
  'The default ACL is missing g::; every ACL carries exactly one u::, g:: and o::.');
assert.equal(failure('u::rw-\nx::r--\ng::---\no::---', false),
  'Entry "x::r--" on line 2 starts with "x"; an ACL tag is user (u), group (g), mask (m) or other (o).');
assert.equal(failure('u::rw-:x\ng::---\no::---', false),
  'Entry "u::rw-:x" on line 1 has 4 fields instead of three; write it as u:alice:rwx or m::r-x.');
assert.equal(failure('u', false),
  'Entry "u" on line 1 has 1 field instead of three; write it as u:alice:rwx or m::r-x.');
assert.equal(failure('u::\ng::---\no::---', false),
  'The user entry "u::" on line 1 has no permissions; write them as rwx, r-x or ---.');
assert.equal(failure('u::rwxr\ng::---\no::---', false),
  'Entry "u::rwxr" on line 1 has more than three permission characters; r, w and x appear at most once '
  + 'each, so rwx is the widest.');
assert.equal(failure('u::rwq\ng::---\no::---', false),
  'Entry "u::rwq" on line 1 contains "q" in its permissions; use only r, w, x and -.');
assert.equal(failure('u::rr\ng::---\no::---', false),
  'Entry "u::rr" on line 1 repeats the permission "r".');
assert.equal(failure('u:ali ce:r--\ng::---\no::---', false),
  'Entry "u:ali ce:r--" on line 1 has the user name "ali ce"; use an account name of up to 32 letters, '
  + 'digits, dots, dashes or underscores, or a decimal ID.');
assert.equal(failure('u::rw-\ng::---\no::---\nd::rwx', true),
  'Entry "d::rwx" on line 4 has 2 fields instead of three; write it as u:alice:rwx or m::r-x.');
assert.ok(failure(' ' + 'x'.repeat(80) + ':rw-', false).includes('...'), 'long entries are elided');

// ---- A seeded sweep against an independent model written here.
function sweepModel(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const fields = line.split(':');
    const tag = fields[0];
    const qualifier = fields[1];
    const rights = new Set(fields[2].split('').filter((character) => character !== '-'));
    entries.push({ tag, qualifier, rights });
  }
  const find = (tag, qualifier) => entries.find((entry) => entry.tag === tag && entry.qualifier === qualifier);
  const owner = find('u', '');
  const group = find('g', '');
  const other = find('o', '');
  const mask = find('m', '');
  const named = entries.filter((entry) => (entry.tag === 'u' || entry.tag === 'g') && entry.qualifier !== '');
  const affected = [group].concat(named);
  let maskRights = null;
  if (mask) maskRights = mask.rights;
  else if (named.length) {
    maskRights = new Set(group.rights);
    for (const entry of named) for (const right of entry.rights) maskRights.add(right);
  }
  const effective = (entry) => {
    if (maskRights === null || entry === owner || entry === other) return entry.rights;
    return new Set(Array.from(entry.rights).filter((right) => maskRights.has(right)));
  };
  const digit = (rights) => (rights.has('r') ? 4 : 0) + (rights.has('w') ? 2 : 0) + (rights.has('x') ? 1 : 0);
  const text3 = (rights) => ['r', 'w', 'x'].map((right) => (rights.has(right) ? right : '-')).join('');
  const groupBits = maskRights === null ? group.rights : maskRights;
  return {
    mode: '0' + digit(owner.rights) + digit(groupBits) + digit(other.rights),
    maskText: maskRights === null ? null : text3(maskRights),
    limited: affected.filter((entry) => text3(effective(entry)) !== text3(entry.rights))
      .map((entry) => entry.qualifier || 'g::'),
    effective: entries.map((entry) => text3(effective(entry))),
  };
}
const perms = (bits) => ['r', 'w', 'x']
  .map((right, index) => (bits & (4 >> index) ? right : '-')).join('');
let seed = 424242;
const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
const pick = (list) => list[next() % list.length];
let swept = 0;
for (let round = 0; round < 500; round += 1) {
  const owner = next() % 8;
  const group = next() % 8;
  const other = next() % 8;
  const lines = ['u::' + perms(owner), 'g::' + perms(group)];
  const namedCount = next() % 4;
  const namedBits = [];
  for (let index = 0; index < namedCount; index += 1) {
    const bits = next() % 8;
    namedBits.push(bits);
    lines.push((index % 2 ? 'g' : 'u') + ':user' + index + ':' + perms(bits));
  }
  if (namedCount > 0 || next() % 3 === 0) {
    if (namedCount > 0 && next() % 4 === 0) {
      let union = group;
      for (const bits of namedBits) union |= bits;
      lines.push('m::' + perms(union));
    } else {
      lines.push('m::' + perms(next() % 8));
    }
  }
  lines.push('o::' + perms(other));
  const text = lines.join('\n');
  const want = sweepModel(text);
  const got = run(text, false);
  assert.equal(got.mode, want.mode, 'mode for ' + text);
  assert.equal(got.maskText, want.maskText, 'mask for ' + text);
  assert.deepEqual(got.limited, want.limited, 'limited for ' + text);
  assert.deepEqual(got.rows.map((row) => row.effective), want.effective, 'effective for ' + text);
  swept += 1;
}
assert.equal(swept, 500);

// ---- Page contract.
assert.ok(html.includes('<html lang="en">'));
assert.ok(html.includes('name="viewport"'));
assert.ok(html.includes('<meta name="description" content="Paste POSIX ACL entries'));
assert.ok(html.includes('src="/assets/theme-init.js"'));
assert.ok(html.includes('href="/assets/style.css"'));
assert.ok(html.includes('src="/assets/tools.js"'));
assert.ok(html.includes('src="/assets/app.js"'));
assert.ok(html.includes('<div id="site-header"></div>'));
assert.ok(html.includes('<main class="tool-container">'));
assert.ok(html.includes('<h1>POSIX ACL Effective Rights</h1>'));
for (const id of ['acl-form', 'in-entries', 'in-directory', 'calculate', 'example', 'reset', 'status', 'error',
  'summary', 'out-entries', 'out-named', 'out-mask', 'default-block', 'out-default-mask', 'out-mode',
  'out-limited', 'canonical', 'entry-body', 'warnings', 'explanation']) {
  assert.ok(html.includes('id="' + id + '"'), 'missing #' + id);
}
assert.ok(/<label for="in-entries">/.test(html));
assert.ok(/<label for="in-directory">/.test(html));
const buttons = html.match(/<button\b[^>]*>/g) || [];
assert.equal(buttons.length, 3);
for (const button of buttons) assert.ok(/\btype="(?:submit|button)"/.test(button), 'button lacks a type: ' + button);
assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'));
assert.ok(html.includes('role="alert"'));
assert.ok(html.includes('overflow-x'));
assert.ok(!/http:\/\/|https:\/\/[^"]*\.(?:js|css)/.test(html), 'no off-origin scripts or styles');

// ---- Catalog record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.category === 'System').length, 55, 'System count');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'record missing');
assert.equal(record.name, 'POSIX ACL Effective Rights');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.description.length > 60);
assert.ok(record.method.includes('acl(5)') && record.method.includes('setfacl'));
assert.equal(record.sources.length, 2);
assert.ok(record.sources[0].url.startsWith('https://man7.org/linux/man-pages/man5/acl.5.html'));
assert.ok(record.sources[1].url.startsWith('https://man7.org/linux/man-pages/man1/setfacl.1.html'));
assert.equal(record.testCases.length, 30);
assert.equal(record.testCases.filter((test) => test.kind === 'golden').length, 12);
assert.equal(record.testCases.filter((test) => test.kind === 'validation').length, 18);

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'duplicate tool name');
for (const alias of record.aliases) {
  for (const tool of catalog.tools) {
    if (tool.slug === slug) continue;
    for (const other of tool.aliases || []) {
      assert.notEqual(other.toLowerCase(), alias.toLowerCase(), 'alias clash with ' + tool.slug);
    }
    for (const tag of tool.tags || []) {
      assert.notEqual(tag.toLowerCase(), alias.toLowerCase(), 'alias clashes with a tag on ' + tool.slug);
    }
  }
}
assert.ok(!slugs.has('acl-calculator'));

// ---- Every catalog case replays against the page.
const GOLDEN_FIELDS = ['mode', 'modeText', 'extended', 'maskText', 'maskSource', 'defaultMaskText',
  'defaultMaskSource', 'namedUsers', 'namedGroups', 'limited', 'hasDefault', 'canonical'];
let golden = 0;
for (const test of record.testCases) {
  if (test.kind === 'golden') {
    const got = run(test.input.entries, test.input.directory);
    for (const field of GOLDEN_FIELDS) {
      assert.deepEqual(got[field], test.expected[field], field + ' for ' + test.name);
    }
    assert.deepEqual(got.rows.map((row) => [row.entry, row.scope, row.granted, row.effective]),
      test.expected.rows.map((row) => [row.entry, row.scope, row.granted, row.effective]), 'rows for ' + test.name);
    golden += 1;
  } else {
    assert.equal(failure(test.input.entries, test.input.directory), test.expected.error, test.name);
  }
}
assert.equal(golden, 12);
console.log('posix ACL effective rights: ' + golden + ' catalog cases replayed, ' + swept + ' swept sets');
