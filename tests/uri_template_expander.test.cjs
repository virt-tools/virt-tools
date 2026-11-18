/* uri template expander: catalog fixtures, RFC 6570 vectors and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'uri-template-expander';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* uri-template-core:start */';
const endMarker = '/* uri-template-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = UriTemplate;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one URI template expander');
const record = records[0];
assert.equal(record.name, 'URI Template Expander');
assert.equal(record.category, 'Developer');
assert.equal(record.subcategory, 'Generation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.equal(new Set(record.tags).size, record.tags.length);
assert.equal(new Set(record.aliases).size, record.aliases.length);
assert.ok(record.method.length > 700, 'method documents operators, encoding and limits');
assert.equal(record.sources.length, 2);
for (const source of record.sources) assert.match(source.url, /^https:\/\/www\.rfc-editor\.org\/rfc\/rfc(6570|3986)$/);
assert.equal(record.testCases.length, 25);
assert.equal(record.testCases.filter((t) => t.kind === 'golden').length, 7);
assert.equal(record.testCases.filter((t) => t.kind === 'boundary').length, 3);
assert.equal(record.testCases.filter((t) => t.kind === 'validation').length, 15);
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2131, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Developer').length, 51, 'Developer count');

function failure(input) {
  try { C.expand(input); } catch (error) { return error.message; }
  return null;
}

// Every catalog case replays against the page core.
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.expand(testCase.input);
  const expected = testCase.expected;
  for (const key of ['expanded', 'expressionCount']) {
    if (expected[key] !== undefined) assert.deepEqual(result[key], expected[key], `${testCase.name}: ${key}`);
  }
  for (const key of ['undefinedNames', 'unusedNames']) {
    if (expected[key] !== undefined) assert.deepEqual(Array.from(result[key]), expected[key], `${testCase.name}: ${key}`);
  }
  if (expected.warningCount !== undefined) assert.equal(result.warnings.length, expected.warningCount, testCase.name + ': warnings');
}

// RFC 6570 section 3.2 publishes these expansions for the variables below.
const RFC_VALUES = {
  count: ['one', 'two', 'three'],
  dom: ['example', 'com'],
  dub: 'me/too',
  hello: 'Hello World!',
  half: '50%',
  var: 'value',
  who: 'fred',
  base: 'http://example.com/home/',
  path: '/foo/bar',
  list: ['red', 'green', 'blue'],
  keys: {semi: ';', dot: '.', comma: ','},
  v: '6',
  x: '1024',
  y: '768',
  empty: '',
  empty_keys: [],
  undef: null
};
const RFC_VECTORS = [
  ['{count}', 'one,two,three'],
  ['{count*}', 'one,two,three'],
  ['{/count*}', '/one/two/three'],
  ['{;count*}', ';count=one;count=two;count=three'],
  ['{?count*}', '?count=one&count=two&count=three'],
  ['{&count*}', '&count=one&count=two&count=three'],
  ['{hello}', 'Hello%20World%21'],
  ['{half}', '50%25'],
  ['O{empty}X', 'OX'],
  ['O{undef}X', 'OX'],
  ['?{x,empty}', '?1024,'],
  ['?{x,undef}', '?1024'],
  ['{var:3}', 'val'],
  ['{list}', 'red,green,blue'],
  ['{keys*}', 'semi=%3B,dot=.,comma=%2C'],
  ['{+hello}', 'Hello%20World!'],
  ['{+half}', '50%25'],
  ['{base}index', 'http%3A%2F%2Fexample.com%2Fhome%2Findex'],
  ['{+base}index', 'http://example.com/home/index'],
  ['{+path:6}/here', '/foo/b/here'],
  ['{+keys}', 'semi,;,dot,.,comma,,'],
  ['{#var}', '#value'],
  ['foo{#empty}', 'foo#'],
  ['foo{#undef}', 'foo'],
  ['{#path:6}/here', '#/foo/b/here'],
  ['{.who,who}', '.fred.fred'],
  ['www{.dom*}', 'www.example.com'],
  ['X{.empty}', 'X.'],
  ['X{.keys*}', 'X.semi=%3B.dot=..comma=%2C'],
  ['X{.empty_keys*}', 'X'],
  ['{/who,dub}', '/fred/me%2Ftoo'],
  ['{/var,empty}', '/value/'],
  ['{/var:1,var}', '/v/value'],
  ['{/list*,path:4}', '/red/green/blue/%2Ffoo'],
  ['{;v,empty,who}', ';v=6;empty;who=fred'],
  ['{;v,bar,who}', ';v=6;who=fred'],
  ['{;hello:5}', ';hello=Hello'],
  ['{;keys*}', ';semi=%3B;dot=.;comma=%2C'],
  ['{?x,y,empty}', '?x=1024&y=768&empty='],
  ['{?keys*}', '?semi=%3B&dot=.&comma=%2C'],
  ['?fixed=yes{&x}', '?fixed=yes&x=1024'],
  ['{&keys}', '&keys=semi,%3B,dot,.,comma,%2C']
];
for (const [template, expected] of RFC_VECTORS) {
  assert.equal(C.expand({template: template, variables: RFC_VALUES}).expanded, expected, 'RFC vector ' + template);
}

// Independent invariants: the encoder round-trips, prefix counts code points, explode counts separators.
for (const value of ['plain', 'a b', '50%', '\u00e9\u00e8', 'x/y?z=1&q=2', '\u4f60\u597d', "it's", '#frag', '{}']) {
  assert.equal(decodeURIComponent(C.encode(value, false)), value, 'simple encoding round trip: ' + value);
  assert.ok(!/[\u0080-\uffff ]/.test(C.encode(value, false)), 'no raw non-ASCII or space survives encoding: ' + value);
}
assert.equal(C.encode('a/b?c=d', false), 'a%2Fb%3Fc%3Dd', 'simple encoding escapes reserved characters');
assert.equal(C.encode('a/b?c=d', true), 'a/b?c=d', 'reserved encoding keeps them');
assert.equal(C.encode('50%', true), '50%25', 'a lone percent is still escaped');
assert.equal(C.encode('100%20and', true), '100%20and', 'a pct-encoded triplet is not encoded twice');
assert.equal(C.encode("it's(1)", true), "it's(1)", 'sub-delimiters survive reserved expansion');
assert.equal(C.encode("it's(1)", false), 'it%27s%281%29', 'sub-delimiters are escaped by simple expansion');
assert.equal(C.expand({template: '{v:3}', variables: {v: '\u00dcn\u00efc\u00f8d\u00e9'}}).expanded, '%C3%9Cn%C3%AF', 'prefix counts code points, not octets');
const exploded = C.expand({template: '{/seg*}', variables: {seg: ['a', 'b', 'c', 'd']}}).expanded;
assert.equal(exploded.split('/').length, 5, 'four exploded members make four separators');
assert.equal(C.expand({template: '{?list*}', variables: {list: ['x', 'y']}}).expanded, '?list=x&list=y');
assert.equal(C.expand({template: '{.p,q}', variables: {p: '1', q: null}}).expanded, '.1', 'undefined values are skipped');
const skipped = C.expand({template: '{?a,b}', variables: {b: '1'}});
assert.deepEqual(Array.from(skipped.undefinedNames), ['a']);
assert.match(skipped.warnings.join(' '), /undefined and was skipped: a\./);
const unused = C.expand({template: '{a}', variables: {a: '1', b: 2}});
assert.deepEqual(Array.from(unused.unusedNames), ['b']);
assert.match(unused.warnings.join(' '), /defined but never referenced: b\./);

// JSON input: numbers and booleans expand as text, bad documents are refused.
assert.equal(C.expand({template: '{?n,f}', variables: '{"n": 0, "f": true}'}).expanded, '?n=0&f=true');
assert.equal(failure({template: '{a}', variables: 'not json'}), 'The variables must be a JSON object such as {"owner": "acme"}.');
assert.equal(failure({template: '{a}', variables: '[1]'}), 'The variables must be a JSON object mapping names to values.');
assert.equal(failure({template: '{a}', variables: '{"a": [[1]]}'}), 'A list may hold strings, numbers or booleans only; nested arrays and objects are not supported.');
assert.equal(failure({template: '{a}', variables: '{"a": {"b": {"c": 1}}}'}), 'An object value may hold strings, numbers or booleans only; nested arrays and objects are not supported.');
assert.equal(C.expand({template: '{a}', variables: '{"a": ""}'}).expanded, '', 'an empty string is defined');

// Literals outside the grammar are escaped with a note instead of failing.
const spaced = C.expand({template: 'a b/{v}', variables: {v: 'x'}});
assert.equal(spaced.expanded, 'a%20b/x');
assert.match(spaced.warnings.join(' '), /outside the template grammar and was percent-encoded as %20\./);
assert.equal(C.expand({template: 'https://example.test/a%20b/{v}', variables: {v: '1'}}).expanded, 'https://example.test/a%20b/1');

// Page contract: shared shell, keyboard-submittable form, accessible output and no foreign runtime.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html));
assert.ok(!/<script[^>]+src="https?:/i.test(html));
assert.ok(!/<link[^>]+href="https?:/i.test(html));
assert.ok(!/on(?:click|input|change|submit|keydown)=/i.test(html));
assert.ok(!/\beval\s*\(|new\s+Function\b|innerHTML/.test(html));
assert.ok(html.includes('<form id="ut-form" novalidate>'));
assert.ok(html.includes('type="submit"'));
assert.ok(html.includes('role="status" aria-live="polite"'));
assert.ok(html.includes('id="result-out"'));
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'));
for (const match of html.matchAll(/\$\("([a-z0-9-]+)"\)/g)) assert.ok(html.includes('id="' + match[1] + '"'), 'missing id ' + match[1]);
for (const id of ['template', 'variables']) assert.ok(html.includes('for="' + id + '"'), 'missing label ' + id);

// The textareas and the replayable core defaults must agree.
function textareaValue(id) {
  const at = html.indexOf('<textarea id="' + id + '"');
  const open = html.indexOf('>', at) + 1;
  return html.slice(open, html.indexOf('</textarea>', open));
}
assert.equal(textareaValue('template'), C.DEFAULTS.template);
assert.equal(textareaValue('variables'), C.DEFAULTS.variables);
assert.equal(C.expand({template: C.DEFAULTS.template, variables: C.DEFAULTS.variables}).expanded,
  '/repos/acme/widget/issues?state=open&labels=bug&labels=ui&per_page=25');
console.log('uri-template-expander: 25 catalog cases, ' + RFC_VECTORS.length + ' RFC 6570 vectors, encoder round trips and page contract passed');
