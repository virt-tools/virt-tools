/* Debian version comparison: dpkg's character order, the tilde and digit rules,
   epoch and revision handling, an independent corpus of version pairs whose
   order was read from dpkg itself, refusals, the catalog replay and the page
   contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'debian-version-compare';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* debver-core:start */';
const endMarker = '/* debver-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = DebVersion;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));

// ---- dpkg's character order: a tilde first, then letters by ASCII value, then
// every other character after them, and digits handled apart from this ladder.
assert.equal(C.orderChar('~'), -1);
assert.equal(C.orderChar(''), 0);
assert.equal(C.orderChar('0'), 0);
assert.equal(C.orderChar('9'), 0);
assert.equal(C.orderChar('A'), 65);
assert.equal(C.orderChar('Z'), 90);
assert.equal(C.orderChar('a'), 97);
assert.equal(C.orderChar('z'), 122);
assert.equal(C.orderChar('+'), 43 + 256);
assert.equal(C.orderChar('-'), 45 + 256);
assert.equal(C.orderChar('.'), 46 + 256);
assert.equal(C.orderChar(':'), 58 + 256);
assert.ok(C.orderChar('A') < C.orderChar('a'), 'upper case sorts before lower case');
assert.ok(C.orderChar('z') < C.orderChar('.'), 'letters sort before every non-letter');
assert.ok(C.orderChar('~') < C.orderChar(''), 'a tilde sorts before the end of the string');

// ---- The example order printed in deb-version(7): ~~ comes first, then ~~a,
// then ~, then the empty part, then a.
const ladder = ['~~', '~~a', '~', '', 'a'];
for (let index = 0; index + 1 < ladder.length; index += 1) {
  assert.equal(C.compareStrings(ladder[index], ladder[index + 1]).result, -1,
    JSON.stringify(ladder[index]) + ' sorts before ' + JSON.stringify(ladder[index + 1]));
  assert.equal(C.compareStrings(ladder[index + 1], ladder[index]).result, 1,
    'the order is antisymmetric at ' + index);
}
assert.equal(C.compareStrings('', '').result, 0);
assert.equal(C.compareStrings('1.0', '1.0').result, 0);

// ---- A digit run is compared as a number, so leading zeros carry no weight and
// a shorter run that runs out first is the smaller number.
assert.equal(C.compareStrings('01', '1').result, 0);
assert.equal(C.compareStrings('1.0a1', '1.0a01').result, 0);
assert.equal(C.compareStrings('9', '10').result, -1);
assert.equal(C.compareStrings('10', '9').result, 1);
assert.equal(C.compareStrings('1.0.10', '1.0.9').result, 1);
assert.equal(C.compareStrings('1.0-1.1', '1.0-1.10').result, -1);
assert.equal(C.compareStrings('1.0', '1.0.0').result, -1);
assert.equal(C.compareStrings('1.0', '').result, 1, 'anything beats the empty string');
const longer = C.compareStrings('10', '9');
assert.equal(longer.kind, 'digit');
assert.equal(longer.reason, 'length');
const bigger = C.compareStrings('3', '2');
assert.equal(bigger.kind, 'digit');
assert.equal(bigger.reason, 'digits');
assert.equal(bigger.leftRun, '3');
assert.equal(bigger.rightRun, '2');

// ---- An epoch is a whole number of unbounded size, so it is compared as a
// digit string rather than through floating point.
assert.equal(C.compareNumbers('0', '00').result, 0);
assert.equal(C.compareNumbers('2', '10').result, -1);
assert.equal(C.compareNumbers('10', '9').result, 1);
assert.equal(C.compareNumbers('999999999999999999', '1000000000000000000').result, -1,
  'a nineteen digit epoch is still compared exactly');
assert.equal(C.compareNumbers('9007199254740993', '9007199254740992').result, 1,
  'past the double precision limit');

// ---- The three parts, split the way dpkg splits them at the first colon and the
// last hyphen.
const parsed = C.parse('1:2.3-4', 'A');
assert.equal(parsed.epoch, '1');
assert.equal(parsed.epochGiven, true);
assert.equal(parsed.upstream, '2.3');
assert.equal(parsed.revision, '4');
assert.equal(parsed.hasRevision, true);
assert.equal(parsed.upstreamStartsWithDigit, true);
assert.equal(parsed.upstreamHasHyphen, false);
const bare = C.parse('1.0', 'A');
assert.equal(bare.epoch, '0');
assert.equal(bare.epochGiven, false);
assert.equal(bare.revision, null);
assert.equal(bare.hasRevision, false);
const zeroEpoch = C.parse('0:1.0', 'A');
assert.equal(zeroEpoch.epochGiven, true);
assert.equal(zeroEpoch.epoch, '0');
const hyphenated = C.parse('1:1.0-1-2', 'A');
assert.equal(hyphenated.epoch, '1');
assert.equal(hyphenated.upstream, '1.0-1');
assert.equal(hyphenated.revision, '2');
assert.equal(hyphenated.upstreamHasHyphen, true, 'a hyphen left in the upstream part is flagged');
const colon = C.parse('1:1.0:2', 'A');
assert.equal(colon.upstream, '1.0:2');
assert.equal(colon.hasColonInUpstream, true);
assert.equal(C.parse('  1.0  ', 'A').raw, '1.0', 'surrounding whitespace is trimmed');

// ---- The independent corpus: every order in it was read from dpkg on this host,
// never from the page. It holds curated pairs and random pairs.
const cases = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/debian_version_cases.json'), 'utf8'));
assert.ok(cases.curated.length >= 45, 'curated pairs');
assert.ok(cases.random.length >= 700, 'random pairs');
let checked = 0;
for (const testCase of cases.curated.concat(cases.random)) {
  const got = C.compare(testCase.a, testCase.b).relation;
  assert.equal(got, testCase.rel, JSON.stringify([testCase.a, testCase.b]) + ' against dpkg');
  assert.equal(C.compare(testCase.b, testCase.a).relation, testCase.rel === 0 ? 0 : -testCase.rel,
    'reversing ' + JSON.stringify([testCase.a, testCase.b]) + ' flips the order');
  checked += 2;
}
assert.ok(checked >= 1400, 'the corpus checks at least 1400 comparisons');

// ---- The named cases and the presentation around them.
const newer = C.compare('1:2.3-4', '1:2.2.9-1');
assert.equal(newer.relation, 1);
assert.equal(newer.headline, 'Version A is newer');
assert.equal(newer.decidedBy, 'upstream');
assert.deepEqual(plain(newer.rows.map((row) => row.label)),
  ['Epoch', 'Upstream version', 'Debian revision']);
assert.deepEqual(plain(newer.rows.map((row) => row.outcome)), ['equal', 'A is newer', 'not compared']);
assert.deepEqual(plain(newer.rows.map((row) => row.left)), ['1', '2.3', '4']);
assert.deepEqual(plain(newer.rows.map((row) => row.right)), ['1', '2.2.9', '1']);
assert.equal(newer.rows[1].decided, true);
assert.ok(newer.noteText.startsWith('The upstream version decided it:'), 'the deciding part is named');
assert.ok(newer.noteText.includes('"3"'), 'the digit runs are quoted');
assert.equal(newer.subline, '"1:2.3-4" sorts after "1:2.2.9-1", so version B is the older one.');
assert.ok(newer.noteText.includes('Both versions carry an epoch'));

const same = C.compare('1.0', '1.0-0');
assert.equal(same.relation, 0);
assert.equal(same.headline, 'Same version');
assert.equal(same.decidedBy, null);
assert.equal(same.subline, '"1.0" and "1.0-0" compare equal under dpkg\'s rules.');
assert.ok(same.noteText.includes('A missing Debian revision compares as an empty string'));
assert.ok(same.noteText.includes('The two spellings differ but compare equal'));

const tilde = C.compare('1.0~rc1', '1.0');
assert.equal(tilde.relation, -1);
assert.equal(tilde.headline, 'Version A is older');
assert.equal(tilde.decidedBy, 'upstream');
assert.ok(tilde.noteText.includes('A tilde sorts before everything'),
  'the tilde rule is spelled out when a version uses it');
assert.ok(tilde.noteText.includes('the end of version B'), 'an exhausted string is named as the end');
assert.equal(tilde.rows[1].outcome, 'A is older');

const revision = C.compare('1.2.3-1', '1.2.3-1~bpo1');
assert.equal(revision.decidedBy, 'revision');
assert.equal(revision.rows[2].outcome, 'A is newer');
assert.equal(revision.rows[2].left, '1');
assert.equal(revision.rows[2].right, '1~bpo1');
assert.ok(revision.noteText.includes('The Debian revision decided it:'));

const epoch = C.compare('2:1.0', '1:9.9');
assert.equal(epoch.decidedBy, 'epoch');
assert.equal(epoch.rows[0].outcome, 'A is newer');
assert.equal(epoch.rows[1].outcome, 'not compared');
assert.ok(epoch.noteText.includes('epoch 2 is a larger whole number than 1'));

const noDigit = C.compare('v1.0', 'v1.1');
assert.equal(noDigit.relation, -1);
assert.ok(noDigit.noteText.includes('does not start with a digit'),
  'a Policy deviation is reported without refusing the comparison');

const twoHyphens = C.compare('1.0-1-2', '1.0-1-1');
assert.equal(twoHyphens.decidedBy, 'revision');
assert.ok(twoHyphens.noteText.includes('a hyphen inside the upstream part'));

// ---- Refusals, each naming the field and the reason.
const failure = (left, right) => {
  try { C.compare(left, right); } catch (error) { return error.message; }
  return null;
};
assert.equal(failure('', '1.0'), 'Enter version A.');
assert.equal(failure('1.0', '  '), 'Enter version B.');
assert.equal(failure('1' + '0'.repeat(128), '1.0'), 'Keep version A to at most 128 characters.');
assert.equal(failure('1.0 1', '1.0'), 'Version A contains a space; a Debian version has none.');
assert.equal(failure('1.0!', '1.0'),
  'Version A may use only letters, digits and the characters . + - : ~; "!" is not one of them.');
assert.equal(failure('1,0', '1.0'),
  'Version A may use only letters, digits and the characters . + - : ~; "," is not one of them.');
assert.equal(failure('1.0-1:extra', '1.0'),
  'The part of version A before the first colon must be the epoch, an unsigned whole number; "1.0-1" is not.');
assert.equal(failure('1.0', ':1.0'),
  'The part of version B before the first colon must be the epoch, an unsigned whole number; "" is not.');
assert.equal(failure('1.0-', '1.0'),
  'Version A ends with a hyphen, so its Debian revision is empty; dpkg refuses that version.');
assert.equal(failure('-1', '1.0'), 'Version A has no upstream version before its hyphen.');
assert.equal(failure(null, '1.0'), 'Enter version A.');
assert.equal(C.MAX_LENGTH, 128);

// ---- The catalog record and every case in it.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(record.name, 'Debian Version Comparison');
assert.equal(record.category, 'Developer');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.listed, true);
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 80 && record.description.length < 260, 'description length');
assert.ok(record.tags.includes('debian') && record.tags.includes('dpkg'), 'tags');
assert.ok(record.tags.includes('developer'), 'the category tag is present');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.aliases.length >= 4, 'aliases cover the common searches');
assert.equal(record.sources.length, 2, 'two sources');
for (const source of record.sources) {
  assert.ok(/^https:\/\//.test(source.url), 'source urls are https');
  assert.ok(source.title.length > 30 && source.title.includes('Debian'), 'source titles name Debian');
}
assert.ok(typeof record.method === 'string' && record.method.length > 300, 'the method is recorded');
assert.equal(record.testCases.length, 24, '24 catalog cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 8);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 6);

for (const testCase of record.testCases) {
  const input = testCase.input;
  if (testCase.expectedError){
    assert.equal(failure(input.left, input.right), testCase.expectedError, testCase.name);
    continue;
  }
  const got = C.compare(input.left, input.right);
  assert.equal(got.relation, testCase.expected.relation, testCase.name + ' relation');
  assert.equal(got.decidedBy, testCase.expected.decidedBy, testCase.name + ' deciding part');
  assert.equal(got.headline, testCase.expected.headline, testCase.name + ' headline');
  const reversed = C.compare(input.right, input.left);
  assert.equal(reversed.relation, got.relation === 0 ? 0 : -got.relation, testCase.name + ' reversed');
}

// ---- The generated surfaces list the page and the catalog stays consistent.
const toolsJs = fs.readFileSync(path.join(root, 'frontend/assets/tools.js'), 'utf8');
assert.ok(toolsJs.includes(slug), 'tools.js lists the slug');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2167, 'public tools');
assert.equal(catalog.tools.length, 2428, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Developer').length, 53,
  'Developer count');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'one record');

// ---- The page contract.
assert.ok(html.includes('/assets/theme-init.js') && html.includes('/assets/style.css')
  && html.includes('/assets/app.js'), 'shared head and shell assets');
assert.ok(!/https?:\/\//.test(html), 'no outbound url in the page');
assert.ok(!/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|onclick=/.test(html),
  'nothing is sent or stored, and no inline handler is used');
assert.ok(html.includes('id="ver-form"') && html.includes('id="out"'), 'form and output hooks');
for (const id of ['left', 'right']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id);
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id);
}
assert.equal((html.match(/<button/g) || []).length, 1, 'one action button');
assert.ok(html.includes('type="submit"'), 'the button submits the form');
assert.ok(html.includes('aria-live="polite"'), 'the result is announced');
assert.ok(html.includes('role="alert"'), 'errors are announced');
assert.ok(html.includes('id="rows-title"') && html.includes('<th scope="col">Part</th>'),
  'the detail table names its columns');
assert.ok(/Debian Version Comparison/.test(html), 'heading and title');
console.log('debian version compare: all checks passed');
