/* Regression checks for the merge conflict resolver core, its catalog cases,
   randomised block assembly and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'merge-conflict-resolver';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* merge-conflict-core:start */');
const end = html.indexOf('/* merge-conflict-core:end */');
assert.ok(start > -1 && end > start, 'merge conflict core markers missing');
const core = html.slice(start, end + '/* merge-conflict-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MergeConflictCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (text, choice) => plain(C.resolve(text, choice));
const failure = (text, choice) => {
  try {
    run(text, choice);
  } catch (error) {
    return error.message;
  }
  return null;
};

// ---- Field contract.
assert.equal(C.MARKERS.ours, '<<<<<<<');
assert.equal(C.MARKERS.base, '|||||||');
assert.equal(C.MARKERS.separator, '=======');
assert.equal(C.MARKERS.theirs, '>>>>>>>');
assert.deepEqual(plain(C.MODES), ['ours', 'theirs', 'both', 'both-reverse', 'base', 'keep']);
assert.equal(C.MAX_LENGTH, 1000000);

// ---- A minimal conflict resolves every way.
const MIN = 'one\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature\nend';
assert.equal(run(MIN, 'ours').text, 'one\nours\nend');
assert.equal(run(MIN, 'theirs').text, 'one\ntheirs\nend');
assert.equal(run(MIN, 'both').text, 'one\nours\ntheirs\nend');
assert.equal(run(MIN, 'both-reverse').text, 'one\ntheirs\nours\nend');
assert.equal(run(MIN, 'keep').text, MIN);
assert.equal(run(MIN, 'keep').keptCount, 1);
assert.equal(run(MIN, 'keep').resolvedCount, 0);
assert.equal(run(MIN).text, 'one\nours\nend', 'omitting the choice defaults to ours');
assert.equal(run(MIN, '').text, 'one\nours\nend', 'an empty choice defaults to ours');
assert.equal(run(MIN, null).text, 'one\nours\nend', 'a null choice defaults to ours');

// ---- Labels and line ranges come from the marker lines.
const parsed = plain(C.parse(MIN));
assert.equal(parsed.conflicts.length, 1);
assert.equal(parsed.lineCount, 7);
assert.equal(parsed.conflicts[0].startLine, 2);
assert.equal(parsed.conflicts[0].endLine, 6);
assert.equal(parsed.conflicts[0].oursLabel, 'HEAD');
assert.equal(parsed.conflicts[0].theirsLabel, 'feature');
assert.equal(parsed.conflicts[0].hasBase, false);
assert.equal(parsed.conflicts[0].base, null);
assert.deepEqual(parsed.conflicts[0].oursLines, ['ours']);
assert.deepEqual(parsed.conflicts[0].theirsLines, ['theirs']);
assert.equal(run(MIN, 'ours').conflicts[0].chosen, 'ours');

// ---- diff3 base sections are parsed and selectable.
const DIFF3 = 'a\n<<<<<<< ours\nA1\nA2\n||||||| merged common ancestors\nO1\n=======\nB1\n>>>>>>> theirs\nz';
const diff3 = plain(C.parse(DIFF3));
assert.equal(diff3.conflicts[0].hasBase, true);
assert.equal(diff3.conflicts[0].baseLabel, 'merged common ancestors');
assert.deepEqual(diff3.conflicts[0].baseLines, ['O1']);
assert.deepEqual(diff3.conflicts[0].oursLines, ['A1', 'A2']);
assert.equal(run(DIFF3, 'base').text, 'a\nO1\nz');
assert.equal(run(DIFF3, 'ours').text, 'a\nA1\nA2\nz');
assert.equal(run(DIFF3, 'both').text, 'a\nA1\nA2\nB1\nz');
assert.equal(failure(MIN, 'base'), 'Conflict 1 has no base section.');

// ---- Non-conflict text is returned byte for byte, including odd marker-like lines.
assert.equal(failure('', 'ours'), 'Text is required.');
assert.equal(failure('\n\n\n', 'ours'), 'Text is required.');
for (const text of ['no newline at all', 'trailing\n', 'Title\n=======\n\nbody',
  '>>>>>>> not a conflict\n', '||||||| not a conflict\n', 'a  <<<<<<< indented\n']) {
  const result = run(text, 'ours');
  assert.equal(result.text, text, 'unchanged: ' + JSON.stringify(text));
  assert.equal(result.conflictCount, 0);
}

// ---- CRLF files keep their line endings, marker lines included.
const CRLF = 'one\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> b\r\ntwo';
assert.equal(run(CRLF, 'theirs').text, 'one\r\ntheirs\r\ntwo');
assert.equal(run(CRLF, 'keep').text, CRLF);

// ---- Empty sides and several blocks in one file.
assert.equal(run('p\n<<<<<<< HEAD\n=======\nt\n>>>>>>> b\nq', 'ours').text, 'p\nq');
assert.equal(run('p\n<<<<<<< HEAD\n=======\nt\n>>>>>>> b\nq', 'both').text, 'p\nt\nq');
const TWO = '1\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> t\n2\n<<<<<<< HEAD\nc\n||||||| base\no\n=======\nd\n>>>>>>> u\n3';
assert.equal(run(TWO, 'theirs').text, '1\nb\n2\nd\n3');
assert.equal(run(TWO, ['theirs', 'both']).text, '1\nb\n2\nc\nd\n3');
assert.equal(run(TWO, ['theirs']).conflicts[1].chosen, 'ours', 'missing picks default to ours');
assert.equal(run(TWO, 'both').conflictCount, 2);

// ---- Malformed structures are refused with the line number.
assert.equal(failure('a\n<<<<<<< HEAD\nours\n>>>>>>> b\n', 'ours'),
  'Line 4: the conflict has no ======= separator.');
assert.equal(failure('a\n<<<<<<< HEAD\nours\n=======\ntheirs\n', 'ours'),
  'Line 2: the conflict is not closed by a >>>>>>> marker.');
assert.equal(failure('a\n<<<<<<< HEAD\nx\n=======\ny\n=======\nz\n>>>>>>> b\n', 'ours'),
  'Line 6: a second ======= separator is not valid.');
assert.equal(failure('a\n<<<<<<< HEAD\nx\n=======\ny\n||||||| base\nz\n>>>>>>> b\n', 'ours'),
  'Line 6: a ||||||| base marker must come before =======.');
assert.equal(failure('a\n<<<<<<< HEAD\nx\n||||||| base\nz\n', 'ours'),
  'Line 2: the conflict has no ======= separator.');
assert.equal(failure('a\n<<<<<<< HEAD\nx\n||||||| base\nz\n||||||| again\nw\n=======\ny\n>>>>>>> b\n', 'ours'),
  'Line 6: a second ||||||| base marker is not valid.');
assert.equal(failure('a\n<<<<<<< HEAD\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b\n', 'ours'),
  'Line 3: nested conflict markers are not supported.');
assert.equal(failure('   \n\t\n', 'ours'), 'Text is required.');
assert.equal(failure(MIN, 'mine'),
  'Unknown choice "mine". Use ours, theirs, both, both-reverse, base or keep.');
assert.equal(failure(MIN, ' OURS '), null, 'mode names are trimmed and lowercased');
assert.equal(failure(MIN, { mode: 'ours' }), 'Choice must be a mode name or a list of mode names.');

// ---- Randomised assembly: independent expectations for every mode.
const pick = (state) => {
  state.seed = (state.seed * 1103515245 + 12345) % 2147483648;
  return state.seed;
};
const word = (state, prefix) => prefix + pick(state).toString(36);
const state = { seed: 20261109 };
let randomRuns = 0;
for (let round = 0; round < 60; round += 1) {
  const pieces = [];
  const count = 1 + (pick(state) % 4);
  for (let blockIndex = 0; blockIndex < count; blockIndex += 1) {
    const before = [];
    for (let i = 0, n = 1 + (pick(state) % 2); i < n; i += 1) before.push(word(state, 'ctx'));
    const ours = [];
    const theirs = [];
    const base = pick(state) % 3 === 0 ? [] : null;
    for (let i = 0, n = pick(state) % 4; i < n; i += 1) ours.push(word(state, 'ours'));
    for (let i = 0, n = pick(state) % 4; i < n; i += 1) theirs.push(word(state, 'theirs'));
    if (base) for (let i = 0, n = pick(state) % 3; i < n; i += 1) base.push(word(state, 'base'));
    pieces.push({ before, ours, theirs, base });
  }
  const tail = [word(state, 'tail'), word(state, 'tail')];
  const source = [];
  for (const piece of pieces) {
    source.push(...piece.before, '<<<<<<< HEAD', ...piece.ours);
    if (piece.base) source.push('||||||| base', ...piece.base);
    source.push('=======', ...piece.theirs, '>>>>>>> feature');
  }
  source.push(...tail);
  const text = source.join('\n');

  const expectedFor = (mode) => {
    const lines = [];
    for (const piece of pieces) {
      lines.push(...piece.before);
      if (mode === 'keep') {
        lines.push('<<<<<<< HEAD', ...piece.ours);
        if (piece.base) lines.push('||||||| base', ...piece.base);
        lines.push('=======', ...piece.theirs, '>>>>>>> feature');
      } else if (mode === 'both') {
        lines.push(...piece.ours, ...piece.theirs);
      } else if (mode === 'both-reverse') {
        lines.push(...piece.theirs, ...piece.ours);
      } else {
        lines.push(...piece[mode]);
      }
    }
    lines.push(...tail);
    return lines.join('\n');
  };

  const parsedRandom = plain(C.parse(text));
  assert.equal(parsedRandom.conflicts.length, count, 'block count at round ' + round);
  assert.equal(parsedRandom.conflicts[0].oursLabel, 'HEAD', 'label at round ' + round);
  for (const mode of ['ours', 'theirs', 'both', 'both-reverse', 'keep', 'base']) {
    if (mode === 'base' && pieces.some((piece) => piece.base === null)) continue;
    const result = run(text, mode);
    assert.equal(result.text, expectedFor(mode), 'text at round ' + round + ' mode ' + mode);
    assert.equal(result.conflictCount, count, 'conflict count ' + mode);
    assert.equal(result.keptCount, mode === 'keep' ? count : 0, 'kept count ' + mode);
    assert.equal(result.resolvedCount, mode === 'keep' ? 0 : count, 'resolved count ' + mode);
    if (mode !== 'keep') {
      assert.ok(result.text.indexOf('<<<<<<<') === -1, 'no opening markers remain for ' + mode);
      assert.ok(result.text.indexOf('>>>>>>>') === -1, 'no closing markers remain for ' + mode);
      assert.equal(plain(C.parse(result.text)).conflicts.length, 0, 'resolved text reparses clean');
    }
    randomRuns += 1;
  }
  assert.equal(run(text, 'keep').text, text, 'keeping every block is an identity at round ' + round);
}
assert.ok(randomRuns >= 200, 'randomised coverage');

// ---- The page must not reach the network, store data or inject markup.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="conflict-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<h1>Merge Conflict Resolver<\/h1>/.test(html), 'page heading');
assert.ok(/name="viewport"/.test(html), 'viewport');
assert.ok(/<textarea id="in-text"/.test(html), 'input textarea');
assert.ok(/<textarea id="out-text"[^>]*readonly/.test(html), 'read-only result');
for (const id of ['in-text', 'out-text']) {
  assert.ok(new RegExp('for="' + id + '"').test(html), 'label for ' + id);
}
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 9, 'the page looks up its controls');
for (const id of requestedIds) {
  assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
}
for (const id of ['copy', 'download', 'example', 'clear', 'summary', 'conflicts']) {
  assert.ok(new RegExp('id="' + id + '"').test(html), 'page has #' + id);
}
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Merge Conflict Resolver');
assert.equal(record.category, 'Developer');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('CRLF'), 'method states line-ending handling');
assert.equal(record.sources.length, 3, 'sources are recorded');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 16, 'catalog case count');
assert.equal(kinds('golden'), 6, 'six golden cases');
assert.equal(kinds('boundary'), 3, 'three boundary cases');
assert.equal(kinds('validation'), 7, 'seven validation cases');
for (const testCase of record.testCases) {
  const { input, expected } = testCase;
  if (expected.error) {
    assert.throws(
      () => C.resolve(input.text, input.choice),
      new RegExp(expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = run(input.text, input.choice);
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result[key], value, testCase.name + ' ' + key);
  }
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
for (const key of [record.slug, record.name].concat(record.aliases || [])) {
  const owners = keyOwners.get(String(key).toLowerCase());
  assert.deepEqual(Array.from(owners), [slug], 'catalog key is unique to this tool: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.ok(record.aliases.some((alias) => alias === alias.toLowerCase()), 'lowercase search aliases are present');

console.log('merge-conflict-resolver: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + randomRuns + ' randomised resolutions)');
