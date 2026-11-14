/* JSON Patch applier: replay the catalog fixtures, cross-check the core against
   an independent RFC 6902 implementation, sweep generated patches, and guard
   the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'json-patch-applier';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* json-patch-core:start */');
const end = html.indexOf('/* json-patch-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, end + '/* json-patch-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = JsonPatchCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2277, 'catalog total');
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'JSON Patch Applier (RFC 6902)');
assert.equal(entry.category, 'Developer');
assert.equal(entry.subcategory, 'Analysis & validation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 600, 'method must document the model and its limits');
assert.equal(entry.sources.length, 3);
for (const source of entry.sources) assert.match(source.url, /^https:\/\//);
assert.equal(entry.testCases.length, 20, 'catalog case count');
assert.equal(entry.testCases.filter((test) => test.kind === 'golden').length, 6);
assert.equal(entry.testCases.filter((test) => test.kind === 'boundary').length, 6);
assert.equal(entry.testCases.filter((test) => test.kind === 'validation').length, 8);
const lowerName = entry.name.toLowerCase();
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && tool.name.toLowerCase() === lowerName), 'name collision');
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug
  && tool.aliases.some((alias) => alias.toLowerCase() === lowerName)), 'alias collision');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Developer').length, 44, 'Developer count');

function failure(documentText, patchText) {
  try {
    C.apply(documentText, patchText);
  } catch (error) {
    return error.message;
  }
  return null;
}
// Values created inside the sandbox carry that realm's prototypes, so compare
// a host-realm round trip instead of object identity.
function host(value) {
  return JSON.parse(JSON.stringify(value));
}
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input.document, testCase.input.patch), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.apply(testCase.input.document, testCase.input.patch);
  for (const [field, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[field], expected, testCase.name + ' ' + field);
  }
  assert.equal(result.log.length, result.applied, testCase.name + ' log length');
  assert.equal(result.log.filter((item) => item.op === 'test').length, result.tests, testCase.name + ' tests');
  assert.deepEqual(host(JSON.parse(result.result)), host(result.document), testCase.name + ' result text');
}

// ---------------------------------------------------------------------------
// Independent implementation written from the method text: a container/key
// walker for mutation, a canonical serializer for value equality, and direct
// string messages. Deliberately structured differently from the page core.
// ---------------------------------------------------------------------------
const OPS = ['add', 'remove', 'replace', 'move', 'copy', 'test'];

function short(value) {
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}
function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function copy(value) {
  return JSON.parse(JSON.stringify(value));
}
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function tokensFor(pointerText, field, index, op) {
  if (typeof pointerText !== 'string') throw new Error(`Operation ${index} (${op}): ${field} must be a JSON Pointer string.`);
  if (pointerText !== '' && pointerText[0] !== '/') throw new Error(`Operation ${index} (${op}): ${field} "${pointerText}" is not a JSON Pointer.`);
  return pointerText === '' ? [] : pointerText.slice(1).split('/').map((piece) => piece.split('~1').join('/').split('~0').join('~'));
}
function position(array, token, op, index, pathText, append) {
  if (token === '-') {
    if (append) return array.length;
    throw new Error(`Operation ${index} (${op}): ${pathText} cannot be resolved because "-" only appends at the end of an add path.`);
  }
  if (!/^(?:0|[1-9][0-9]*)$/.test(token)) throw new Error(`Operation ${index} (${op}): ${pathText} is not an array index.`);
  const value = Number(token);
  if (value > (append ? array.length : array.length - 1)) {
    throw new Error(`Operation ${index} (${op}): ${pathText} is out of range for an array of ${array.length} elements.`);
  }
  return value;
}
function child(node, token, op, index, pathText, append) {
  if (Array.isArray(node)) return node[position(node, token, op, index, pathText, append)];
  if (plain(node) && Object.prototype.hasOwnProperty.call(node, token)) return node[token];
  throw new Error(`Operation ${index} (${op}): ${pathText} does not exist.`);
}
function resolve(node, tokens, op, index, pathText) {
  return tokens.reduce((cursor, token) => child(cursor, token, op, index, pathText, false), node);
}
function seat(node, tokens, op, index, pathText) {
  return {
    holder: tokens.slice(0, -1).reduce((cursor, token) => child(cursor, token, op, index, pathText, false), node),
    last: tokens[tokens.length - 1],
  };
}
function writeAdd(node, tokens, value, index, pathText) {
  if (!tokens.length) return { node: value, note: 'document replaced' };
  const { holder, last } = seat(node, tokens, 'add', index, pathText);
  if (Array.isArray(holder)) {
    holder.splice(position(holder, last, 'add', index, pathText, true), 0, value);
    return { node, note: last === '-' ? 'appended' : 'inserted' };
  }
  if (plain(holder)) {
    holder[last] = value;
    return { node, note: 'added' };
  }
  throw new Error(`Operation ${index} (add): ${pathText} does not exist.`);
}
function writeRemove(node, tokens, index, pathText) {
  if (!tokens.length) throw new Error(`Operation ${index} (remove): the whole document cannot be removed.`);
  const { holder, last } = seat(node, tokens, 'remove', index, pathText);
  if (Array.isArray(holder)) {
    holder.splice(position(holder, last, 'remove', index, pathText, false), 1);
    return { node, note: 'removed' };
  }
  if (plain(holder) && Object.prototype.hasOwnProperty.call(holder, last)) {
    delete holder[last];
    return { node, note: 'removed' };
  }
  throw new Error(`Operation ${index} (remove): ${pathText} does not exist.`);
}
function writeReplace(node, tokens, value, index, pathText) {
  if (!tokens.length) return { node: value, note: 'document replaced' };
  const { holder, last } = seat(node, tokens, 'replace', index, pathText);
  if (Array.isArray(holder)) {
    holder[position(holder, last, 'replace', index, pathText, false)] = value;
    return { node, note: 'replaced' };
  }
  if (plain(holder) && Object.prototype.hasOwnProperty.call(holder, last)) {
    holder[last] = value;
    return { node, note: 'replaced' };
  }
  throw new Error(`Operation ${index} (replace): ${pathText} does not exist.`);
}

function oracle(documentText, patchText) {
  if (typeof documentText !== 'string' || !documentText.trim()) throw new Error('Document is required.');
  if (documentText.length > 200000) throw new Error(`Document is ${documentText.length} characters; the limit is 200000.`);
  let parsed;
  try {
    parsed = JSON.parse(documentText);
  } catch (error) {
    throw new Error('Document is not valid JSON.');
  }
  if (typeof patchText !== 'string' || !patchText.trim()) throw new Error('Patch is required.');
  if (patchText.length > 200000) throw new Error(`Patch is ${patchText.length} characters; the limit is 200000.`);
  let patch;
  try {
    patch = JSON.parse(patchText);
  } catch (error) {
    throw new Error('Patch is not valid JSON.');
  }
  if (!Array.isArray(patch)) throw new Error('Patch must be a JSON array of operations.');
  if (patch.length > 200) throw new Error(`Patch has ${patch.length} operations; the limit is 200.`);

  let node = copy(parsed);
  const log = [];
  let tests = 0;
  patch.forEach((item, offset) => {
    const index = offset + 1;
    if (!plain(item)) throw new Error(`Operation ${index}: each operation must be a JSON object.`);
    if (typeof item.op !== 'string') throw new Error(`Operation ${index}: op must be add, remove, replace, move, copy or test.`);
    if (!OPS.includes(item.op)) throw new Error(`Operation ${index}: "${item.op}" is not a supported operation.`);
    const op = item.op;
    const pathText = item.path;
    const tokens = tokensFor(pathText, 'path', index, op);
    if ((op === 'add' || op === 'replace' || op === 'test') && !Object.prototype.hasOwnProperty.call(item, 'value')) {
      throw new Error(`Operation ${index} (${op}): ${op} requires a value.`);
    }
    let note;
    if (op === 'add') {
      const done = writeAdd(node, tokens, copy(item.value), index, pathText);
      node = done.node;
      note = done.note;
    } else if (op === 'remove') {
      node = writeRemove(node, tokens, index, pathText).node;
      note = 'removed';
    } else if (op === 'replace') {
      const done = writeReplace(node, tokens, copy(item.value), index, pathText);
      node = done.node;
      note = done.note;
    } else if (op === 'test') {
      const found = resolve(node, tokens, 'test', index, pathText);
      if (canonical(found) !== canonical(item.value)) {
        const where = pathText === '' ? 'the document' : pathText;
        throw new Error(`Operation ${index} (test): ${where} is ${short(found)}, not ${short(item.value)}.`);
      }
      tests += 1;
      note = 'passed';
    } else {
      const fromTokens = tokensFor(item.from, 'from', index, op);
      if (op === 'move') {
        const samePlace = fromTokens.length === tokens.length && fromTokens.every((token, at) => token === tokens[at]);
        if (samePlace) {
          note = 'unchanged';
        } else {
          const isPrefix = fromTokens.length < tokens.length && fromTokens.every((token, at) => token === tokens[at]);
          if (isPrefix) {
            const fromText = item.from === '' ? 'the document' : item.from;
            const pathLabel = pathText === '' ? 'the document' : pathText;
            throw new Error(`Operation ${index} (move): ${fromText} must not be a proper prefix of ${pathLabel}.`);
          }
          const moved = resolve(node, fromTokens, 'move', index, item.from);
          node = writeRemove(node, fromTokens, index, item.from).node;
          node = writeAdd(node, tokens, moved, index, pathText).node;
          note = 'moved';
        }
      } else {
        const copied = copy(resolve(node, fromTokens, 'copy', index, item.from));
        node = writeAdd(node, tokens, copied, index, pathText).node;
        note = 'copied';
      }
    }
    log.push({ op, path: pathText, from: op === 'move' || op === 'copy' ? item.from : null, note });
  });
  const result = JSON.stringify(node, null, 2);
  return {
    document: node,
    result,
    log,
    applied: log.length,
    tests,
    bytes: Buffer.byteLength(result, 'utf8'),
    rootType: node === null ? 'null' : Array.isArray(node) ? 'array' : typeof node,
  };
}

function compare(documentText, patchText, label) {
  let observed;
  let expected;
  try {
    observed = C.apply(documentText, patchText);
  } catch (error) {
    observed = { error: error.message };
  }
  try {
    expected = oracle(documentText, patchText);
  } catch (error) {
    expected = { error: error.message };
  }
  assert.deepEqual(host(observed), host(expected), label);
  return expected;
}

for (const testCase of entry.testCases) {
  compare(testCase.input.document, testCase.input.patch, testCase.name + ' oracle');
}

// Documented limits, refusal messages beyond the catalog fixtures.
const baseDocument = '{"a": 1, "list": [1, 2]}';
assert.equal(C.MAX_OPERATIONS, 200);
assert.equal(C.MAX_DOCUMENT, 200000);
assert.equal(C.MAX_PATCH, 200000);
assert.equal(failure('{"a": 1}', JSON.stringify(Array.from({ length: 201 }, () => ({ op: 'test', path: '/a', value: 1 })))),
  'Patch has 201 operations; the limit is 200.');
assert.equal(failure(baseDocument, '[{"op": "remove", "path": ""}]'),
  'Operation 1 (remove): the whole document cannot be removed.');
assert.equal(failure(baseDocument, '[{"op": "test", "path": "/a", "value": 2}]'),
  'Operation 1 (test): /a is 1, not 2.');
assert.equal(failure('{"a": {"b": 1}}', '[{"op": "move", "from": "/a", "path": "/a/c"}]'),
  'Operation 1 (move): /a must not be a proper prefix of /a/c.');
assert.equal(failure('{"a": 1}', '[{"op": "add", "path": "/b"}]'),
  'Operation 1 (add): add requires a value.');
assert.equal(failure('{"a": 1}', '[{"op": "test", "path": "/a"}]'),
  'Operation 1 (test): test requires a value.');
assert.equal(failure('{"a": 1, "list": [1, 2]}', '[{"op": "add", "path": "/list/01", "value": 1}]'),
  'Operation 1 (add): /list/01 is not an array index.');
assert.equal(failure('{"a": [1]}', '[{"op": "add", "path": "/a/-/x", "value": 1}]'),
  'Operation 1 (add): /a/-/x cannot be resolved because "-" only appends at the end of an add path.');
assert.equal(failure('{"a": 1}', '[{"op": "move", "path": "/b", "from": "b"}]'),
  'Operation 1 (move): from "b" is not a JSON Pointer.');
assert.equal(failure('{"a": 1}', '[{"op": "copy", "path": "/b"}]'),
  'Operation 1 (copy): from must be a JSON Pointer string.');
assert.equal(failure('{"a": 1}', '[{"op": "add", "path": 7, "value": 1}]'),
  'Operation 1 (add): path must be a JSON Pointer string.');
assert.equal(failure('{"a": 1}', '[7]'), 'Operation 1: each operation must be a JSON object.');
assert.equal(failure('{"a": 1}', '[{"path": "/a"}]'),
  'Operation 1: op must be add, remove, replace, move, copy or test.');
assert.equal(failure('   ', '[]'), 'Document is required.');
assert.equal(failure('{"a": }', '[]'), 'Document is not valid JSON.');
assert.equal(failure('{}', '  '), 'Patch is required.');
assert.equal(failure('{}', 'nope'), 'Patch is not valid JSON.');

// A failing operation discards every earlier step: the reported index is exact.
assert.equal(failure('{"a": {"b": 1}}', '[{"op": "replace", "path": "/a/b", "value": 2}, {"op": "test", "path": "/a/b", "value": 1}]'),
  'Operation 2 (test): /a/b is 2, not 1.');
assert.equal(C.apply('{"a": {"b": 1}}', '[{"op": "replace", "path": "/a/b", "value": 2}]').document.a.b, 2, 'earlier steps run in order');
assert.equal(C.apply('{"a": 1}', '[]').applied, 0, 'an empty patch is a no-op');

// ---------------------------------------------------------------------------
// Deterministic sweep: build documents from a small grammar, derive pointer
// paths from the live state, and require the core and the oracle to agree on
// success results, operation logs and every refusal message.
// ---------------------------------------------------------------------------
let seed = 20261114;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function between(low, high) {
  return low + Math.floor(rand() * (high - low + 1));
}
function pick(list) {
  return list[between(0, list.length - 1)];
}
function sampleValue(depth) {
  const roll = rand();
  if (depth <= 0 || roll < 0.4) return pick([0, 1, -2.5, '', 'x', true, false, null, 'a/b', 'c~d']);
  if (roll < 0.7) {
    const items = [];
    const count = between(0, 3);
    for (let at = 0; at < count; at += 1) items.push(sampleValue(depth - 1));
    return items;
  }
  const object = {};
  const count = between(0, 3);
  for (let at = 0; at < count; at += 1) object[pick(['a', 'b', 'c', 'd/e', 'f~g', '0'])] = sampleValue(depth - 1);
  return object;
}
function escapeToken(text) {
  return text.split('~').join('~0').split('/').join('~1');
}
function collect(node, prefix, out) {
  out.push({ path: prefix, value: node });
  if (Array.isArray(node)) node.forEach((item, at) => collect(item, `${prefix}/${at}`, out));
  else if (plain(node)) Object.keys(node).forEach((key) => collect(node[key], `${prefix}/${escapeToken(key)}`, out));
  return out;
}
for (let trial = 0; trial < 400; trial += 1) {
  const initial = sampleValue(3);
  const documentText = JSON.stringify(initial);
  let state = copy(initial);
  const patch = [];
  const steps = between(1, 4);
  for (let step = 0; step < steps; step += 1) {
    const entries = collect(state, '', []);
    const op = pick(['add', 'remove', 'replace', 'move', 'copy', 'test']);
    if (op === 'add') {
      const parents = entries.filter((item) => Array.isArray(item.value) || plain(item.value));
      if (!parents.length) {
        patch.push({ op: 'replace', path: '', value: sampleValue(1) });
      } else {
        const parent = pick(parents);
        const token = Array.isArray(parent.value)
          ? String(between(0, parent.value.length)) 
          : escapeToken(pick(['a', 'b', 'z', 'd/e']));
        const target = parent.path === '' ? `/${token}` : `${parent.path}/${token}`;
        patch.push({ op: 'add', path: target, value: sampleValue(1) });
      }
    } else if (op === 'remove') {
      const live = entries.filter((item) => item.path !== '');
      if (!live.length) {
        patch.push({ op: 'add', path: pick(['/new', '/other']), value: sampleValue(1) });
      } else {
        patch.push({ op: 'remove', path: pick(live).path });
      }
    } else if (op === 'replace') {
      patch.push({ op: 'replace', path: pick(entries).path, value: sampleValue(1) });
    } else if (op === 'test') {
      const target = pick(entries);
      const value = rand() < 0.75 ? copy(target.value) : sampleValue(1);
      patch.push({ op: 'test', path: target.path, value });
    } else if (op === 'copy') {
      const from = pick(entries);
      const parents = entries.filter((item) => Array.isArray(item.value) || plain(item.value));
      if (!parents.length) {
        patch.push({ op: 'replace', path: '', value: sampleValue(1) });
      } else {
        const parent = pick(parents);
        const token = Array.isArray(parent.value)
          ? (rand() < 0.5 ? '-' : String(between(0, parent.value.length)))
          : escapeToken(pick(['a', 'b', 'z']));
        patch.push({ op: 'copy', from: from.path, path: parent.path === '' ? `/${token}` : `${parent.path}/${token}` });
      }
    } else {
      const from = pick(entries);
      const parents = entries.filter((item) => Array.isArray(item.value) || plain(item.value));
      if (!parents.length) {
        patch.push({ op: 'replace', path: '', value: sampleValue(1) });
      } else {
        const parent = pick(parents);
        const token = Array.isArray(parent.value)
          ? String(between(0, parent.value.length))
          : escapeToken(pick(['a', 'b', 'z']));
        patch.push({ op: 'move', from: from.path, path: parent.path === '' ? `/${token}` : `${parent.path}/${token}` });
      }
    }
    const outcome = compare(documentText, JSON.stringify(patch), `sweep step ${step} ${JSON.stringify(patch)}`);
    if (outcome.error) break;
    state = outcome.document;
  }
}

// Properties of a successful patch on a fixed document.
const probe = C.apply('{"items": [1, 2, 3], "meta": {"n": 1}}', '[' + [
  '{"op": "test", "path": "/items/0", "value": 1}',
  '{"op": "move", "from": "/items/0", "path": "/items/2"}',
  '{"op": "copy", "from": "/meta", "path": "/snapshot"}',
  '{"op": "remove", "path": "/meta/n"}',
].join(',') + ']');
assert.deepEqual(host(probe.document), { items: [2, 3, 1], meta: {}, snapshot: { n: 1 } });
assert.equal(probe.applied, 4);
assert.equal(probe.tests, 1);
assert.deepEqual(host(probe.log.map((item) => item.note)), ['passed', 'moved', 'copied', 'removed']);
assert.deepEqual(host(probe.log.map((item) => item.op)), ['test', 'move', 'copy', 'remove']);
assert.equal(probe.log[1].from, '/items/0', 'move keeps its source');
assert.equal(probe.bytes, Buffer.byteLength(probe.result, 'utf8'), 'byte count matches the serialized result');
assert.equal(C.apply('{"a": 1}', '[{"op": "move", "from": "/a", "path": "/a"}]').log[0].note, 'unchanged');
assert.equal(C.apply('{"a": 1}', '[{"op": "add", "path": "/b", "value": {"x": [1]}}]').document.b.x.length, 1);

// ---------------------------------------------------------------------------
// Page contract: the textarea samples must match the core defaults, and the
// page must stay self-contained, offline and touch-friendly.
// ---------------------------------------------------------------------------
assert.ok(!/\bfetch\s*\(/.test(html), 'no fetch');
assert.ok(!/XMLHttpRequest|WebSocket|navigator\.sendBeacon/.test(html), 'no network APIs');
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), 'no storage');
assert.ok(!/\beval\s*\(|new Function/.test(html), 'no dynamic evaluation');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote stylesheets');
assert.ok(!/autofocus/i.test(html), 'no autofocus');

function textarea(id) {
  const match = html.match(new RegExp('<textarea id="' + id + '"[^>]*>([\\s\\S]*?)</textarea>'));
  assert.ok(match, 'missing textarea ' + id);
  assert.ok(html.includes('<label for="' + id + '">'), 'missing label for ' + id);
  return match[1];
}
assert.deepEqual(JSON.parse(textarea('document')), JSON.parse(C.DEFAULTS.document), 'document sample matches the core default');
assert.deepEqual(JSON.parse(textarea('patch')), JSON.parse(C.DEFAULTS.patch), 'patch sample matches the core default');
const sample = C.apply(C.DEFAULTS.document, C.DEFAULTS.patch);
assert.equal(sample.applied, 5, 'sample exercises every operation class');
assert.equal(sample.tests, 1, 'sample runs a test');
assert.deepEqual(host(sample.document), { user: { name: 'Ada Lovelace', roles: ['admin', 'editor'] }, schema: 1, lastEditor: 'Ada Lovelace' });

assert.ok(/min-height:44px/.test(html), '44 px controls');
assert.ok(/@media\(max-width:640px\)/.test(html), 'mobile layout');
assert.ok(/aria-live="polite"/.test(html), 'live result region');
assert.ok(/role="alert"/.test(html), 'error region');
assert.ok(/<html lang="en">/.test(html) && /name="viewport"/.test(html), 'document basics');
assert.ok(/RFC 6902/.test(html) && /RFC 6901/.test(html), 'page names the standards');
assert.ok(/tabindex="0"/.test(html), 'result is keyboard scrollable');

console.log('json patch applier: all checks passed');
