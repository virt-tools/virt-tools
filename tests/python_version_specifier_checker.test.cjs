/* Regression checks for the Python Version Specifier Checker: catalog cases, the
   shipped packaging 25.0 oracle fixture, normalization and ordering invariants, the
   page contract and catalog integrity. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'python-version-specifier-checker';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* pvsc-core:start */';
const endMarker = '/* pvsc-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = Pep440;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Python Version Specifier Checker');
assert.equal(record.category, 'Developer');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.tags.includes('pep-440') && record.tags.includes('python'));
assert.ok(record.aliases.some((alias) => alias.includes('Requires-Python')), 'search alias names requires-python');
assert.ok(record.method.length > 900, 'method records the arithmetic');
assert.ok(record.guidance.length < 500, 'guidance stays a banner');
assert.ok(Array.isArray(record.sources) && record.sources.length === 2, 'two sources are recorded');
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'source has an https URL');
  assert.ok(source.title.length > 60, 'source title is specific');
}
assert.ok(record.sources.some((source) => source.url === 'https://peps.python.org/pep-0440/'), 'PEP 440 source');
assert.ok(record.sources.some((source) => source.url.includes('version-specifiers')), 'packaging source');

const run = (input) => C.check(input);
const failure = (input) => {
  try {
    C.check(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

const kinds = { golden: 0, boundary: 0, validation: 0 };
for (const testCase of record.testCases) {
  kinds[testCase.kind] = (kinds[testCase.kind] || 0) + 1;
  if (testCase.kind === 'validation') {
    const message = failure(testCase.input);
    assert.ok(message, `${testCase.name}: expected a refusal`);
    assert.ok(message.includes(testCase.expectedError),
      `${testCase.name}: "${message}" does not mention "${testCase.expectedError}"`);
    continue;
  }
  const result = run(testCase.input);
  assert.equal(result.satisfied, testCase.expected.satisfied, `${testCase.name}: satisfied`);
  assert.equal(result.normalized, testCase.expected.normalized, `${testCase.name}: normalized`);
  assert.equal(JSON.stringify(Array.from(result.matches)), JSON.stringify(testCase.expected.matches),
    `${testCase.name}: clause verdicts`);
}
assert.equal(kinds.golden, 9, 'nine golden cases');
assert.equal(kinds.boundary, 5, 'five boundary cases');
assert.equal(kinds.validation, 7, 'seven validation cases');
assert.equal(record.testCases.length, 21, 'twenty-one catalog cases');

// ---- Oracle fixture generated from Python packaging 25.0, independent of the page. ----
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/pep440_specifier_cases.json'), 'utf8'));
assert.equal(fixture.cases.length, 218, 'two hundred and eighteen oracle fixtures');
assert.equal(new Set(fixture.cases.map((testCase) => testCase.specifier)).size, 38, 'all 38 specifier sets');
let fixtureMatches = 0;
for (const testCase of fixture.cases) {
  const result = run({ version: testCase.version, specifier: testCase.specifier });
  assert.equal(result.normalized, testCase.normalized,
    `fixture ${testCase.version}: normalized ${result.normalized}`);
  assert.equal(result.satisfied, testCase.satisfied,
    `fixture ${testCase.version} in ${testCase.specifier}: verdict`);
  assert.equal(JSON.stringify(Array.from(result.matches)), JSON.stringify(testCase.matches),
    `fixture ${testCase.version} in ${testCase.specifier}: clauses`);
  if (testCase.satisfied) fixtureMatches++;
}
assert.ok(fixtureMatches > 20 && fixtureMatches < 180, 'the fixture covers both verdicts');

// ---- Normalization: canonical forms from the PEP 440 grammar. ----
const normalized = (text) => C.check({ version: text, specifier: '>=0' }).normalized;
const forms = [
  ['1.0a', '1.0a0'], ['1.0-1', '1.0.post1'], ['1.0+ABC.01', '1.0+abc.1'],
  ['01!2.0', '1!2.0'], ['1.0.post', '1.0.post0'], ['1.0dev', '1.0.dev0'],
  ['1.0c1', '1.0rc1'], ['1.0.RC2', '1.0rc2'], ['v3.11.4', '3.11.4'],
  ['3.11.4-1', '3.11.4.post1'], ['1.0.alpha3', '1.0a3'],
];
for (const [input, expected] of forms) assert.equal(normalized(input), expected, `normalize ${input}`);

// ---- Ordering: PEP 440's own chain, then padded releases and local labels. ----
const ordered = ['1.0.dev0', '1.0a0', '1.0b0', '1.0rc1', '1.0', '1.0+abc', '1.0.post0.dev1', '1.0.post0', '1.1'];
for (let i = 1; i < ordered.length; i++) {
  const left = C.parseVersion(ordered[i - 1]);
  const right = C.parseVersion(ordered[i]);
  assert.equal(C.compare(left, right), -1, `${ordered[i - 1]} < ${ordered[i]}`);
  assert.equal(C.compare(right, left), 1, `${ordered[i]} > ${ordered[i - 1]}`);
}
assert.equal(C.compare(C.parseVersion('1.0'), C.parseVersion('1.0.0')), 0, 'release zero padding');
assert.equal(C.compare(C.parseVersion('1.0+abc'), C.parseVersion('1.0+ABC')), 0, 'local case folding');
assert.equal(C.compare(C.parseVersion('1.0+2'), C.parseVersion('1.0+abc')), 1, 'numeric local above text');
assert.equal(C.compare(C.parseVersion('1.0+abc'), C.parseVersion('1.0+abc.1')), -1, 'local prefix below its extension');

// ---- The pre-release rule and the clause forms that carry extra semantics. ----
assert.equal(run({ version: '2.0rc1', specifier: '>=2.0' }).satisfied, false, 'pre-release gate');
assert.equal(run({ version: '2.0rc1', specifier: '>=2.0rc1' }).satisfied, true, 'named pre-release opens the gate');
assert.equal(run({ version: '3.0', specifier: '!=1.0' }).satisfied, true, '!= does not exclude a different release');
assert.equal(run({ version: '1.0.5', specifier: '==1.0.*' }).satisfied, true, 'wildcard prefix');
assert.equal(run({ version: '1.1', specifier: '==1.0.*' }).satisfied, false, 'wildcard prefix boundary');
assert.equal(run({ version: '1.0+abc', specifier: '==1.0' }).satisfied, true, '== ignores a local label');
assert.equal(run({ version: '1.0+abc', specifier: '==1.0+abc' }).satisfied, true, '== can name a local label');
assert.equal(run({ version: '1.0+def', specifier: '==1.0+abc' }).satisfied, false, '== compares a named local label');
assert.equal(run({ version: '1.0+abc', specifier: '<=1.0' }).satisfied, true, '<= ignores a local label');
assert.equal(run({ version: '1.4.9', specifier: '~=1.4.2' }).satisfied, true, 'compatible release inside');
assert.equal(run({ version: '1.5', specifier: '~=1.4.2' }).satisfied, false, 'compatible release outside');
assert.equal(run({ version: '1!2.5', specifier: '~=1!2.0' }).satisfied, true, 'compatible release keeps the epoch');
assert.equal(run({ version: '2!2.5', specifier: '~=1!2.0' }).satisfied, false, 'compatible release pins the epoch');
assert.equal(run({ version: '1.0', specifier: '<=1.0,>=1.0' }).satisfied, true, 'inclusive both ends');
const gated = run({ version: '1.4.2rc1', specifier: '>=1.4,<2.0' });
assert.equal(gated.gated, true, 'the gate is reported');
assert.ok(gated.notes[0].includes('pre-release'), 'the gate is explained');
assert.ok(gated.clauses.every((clause) => clause.gated && !clause.matches), 'every clause is marked excluded');

// ---- Page contract: labels, ids, controls and offline behaviour. ----
const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
assert.match(html, /<label[^>]*\bfor="version"/, 'version has a label');
assert.match(html, /<label[^>]*\bfor="specifier"/, 'specifier has a label');
assert.match(html, /<button type="submit">Check version<\/button>/, 'submit button');
assert.match(html, /id="method"/, 'the method note has its own id');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'page markup is offline');
assert.ok(!/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), 'no network or storage calls');
assert.equal((html.match(/<script/g) || []).length, 3, 'theme init, app shell and one inline script');
assert.equal((html.match(/\/assets\/app\.js/g) || []).length, 1, 'shared shell is loaded once');

// ---- Catalog integrity and the totals every suite pins. ----
assert.equal(catalog.tools.length, 2497, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2236, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Developer').length, 56, 'Developer count');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'one record');
const pageDirs = fs.readdirSync(path.join(root, 'frontend/tools')).filter((entry) =>
  fs.statSync(path.join(root, 'frontend/tools', entry)).isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const toolsJs = fs.readFileSync(path.join(root, 'frontend/assets/tools.js'), 'utf8');
assert.ok(toolsJs.includes(slug), 'tools.js lists the slug');

console.log('python-version-specifier-checker: all checks passed');
