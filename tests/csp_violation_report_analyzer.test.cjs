/* CSP violation report analysis: both report shapes, field aliases, origin
   reduction, grouping, refusals, the catalog record and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'csp-violation-report-analyzer';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* cspv-core:start */';
const endMarker = '/* cspv-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CspReportCore;', sandbox);
const C = sandbox.module.exports;

// ---- Exported surface.
assert.deepEqual(JSON.parse(JSON.stringify(Object.keys(C))).sort(), [
  'analyse', 'hintFor', 'hints', 'maxInput', 'maxReports', 'originOf', 'parse'
]);
assert.equal(C.maxInput, 512000);
assert.equal(C.maxReports, 1000);

// ---- Both wire shapes, field aliases and normalisation.
const legacy = {
  'csp-report': {
    'document-uri': 'https://app.example.com/checkout?step=2',
    referrer: 'https://app.example.com/cart',
    'violated-directive': "script-src 'self'",
    'effective-directive': 'script-src-elem',
    'original-policy': "script-src 'self'",
    'blocked-uri': 'https://cdn.example.com/vendor/a.js?x=1',
    disposition: 'enforce',
    'status-code': 200
  }
};
let parsed = C.parse(JSON.stringify(legacy));
assert.equal(parsed.reports.length, 1);
assert.equal(parsed.skipped, 0);
assert.equal(parsed.reports[0].document, 'https://app.example.com/checkout?step=2');
assert.equal(parsed.reports[0].blocked, 'https://cdn.example.com/vendor/a.js?x=1');
assert.equal(parsed.reports[0].directive, 'script-src-elem');
assert.equal(parsed.reports[0].origin, 'https://cdn.example.com');
assert.equal(parsed.reports[0].disposition, 'enforce');
assert.equal(parsed.reports[0].policy, "script-src 'self'");

const reporting = {
  type: 'csp-violation',
  age: 12,
  url: 'https://app.example.com/checkout',
  user_agent: 'Mozilla/5.0',
  body: {
    documentURL: 'https://app.example.com/checkout',
    blockedURL: 'inline',
    effectiveDirective: 'style-src-attr',
    originalPolicy: "style-src 'self'",
    sample: 'color:red',
    disposition: 'report',
    statusCode: 0,
    lineNumber: 2,
    columnNumber: 18
  }
};
parsed = C.parse(JSON.stringify(reporting));
assert.equal(parsed.reports[0].document, 'https://app.example.com/checkout');
assert.equal(parsed.reports[0].blocked, 'inline');
assert.equal(parsed.reports[0].origin, 'inline');
assert.equal(parsed.reports[0].directive, 'style-src-attr');
assert.equal(parsed.reports[0].sample, 'color:red');
assert.equal(parsed.reports[0].disposition, 'report');

// A bare report body and a bare legacy body are both accepted.
parsed = C.parse(JSON.stringify({
  'effective-directive': 'img-src',
  'blocked-uri': 'https://img.example.com/a.png'
}));
assert.equal(parsed.reports[0].directive, 'img-src');
assert.equal(parsed.reports[0].origin, 'https://img.example.com');

// A Reporting API payload may mix types; non-CSP entries are skipped.
parsed = C.parse(JSON.stringify([
  { type: 'deprecation', age: 1, url: 'https://app.example.com/', body: { id: 'x' } },
  reporting
]));
assert.equal(parsed.reports.length, 1);
assert.equal(parsed.skipped, 1);

// A violation without an effective directive falls back to the first token.
parsed = C.parse(JSON.stringify({
  'csp-report': { 'violated-directive': "default-src 'none'", 'blocked-uri': 'eval' }
}));
assert.equal(parsed.reports[0].directive, 'default-src');
assert.equal(parsed.reports[0].origin, 'eval');

// Control and bidi characters are removed, whitespace collapses, values stay text.
parsed = C.parse(JSON.stringify({
  'csp-report': {
    'effective-directive': 'script-src',
    'blocked-uri': 'https://evil.example/a\u0000b\nc',
    sample: 'x\u202Ey'
  }
}));
assert.equal(parsed.reports[0].blocked, 'https://evil.example/ab c');
assert.equal(parsed.reports[0].sample, 'xy');

// ---- Origin reduction.
assert.equal(C.originOf('inline'), 'inline');
assert.equal(C.originOf('eval'), 'eval');
assert.equal(C.originOf('data'), 'data:');
assert.equal(C.originOf('data:text/html,<b>x</b>'), 'data:');
assert.equal(C.originOf('blob:https://app.example.com/9f2c'), 'https://app.example.com');
assert.equal(C.originOf('filesystem:https://app.example.com/temporary/x'), 'https://app.example.com');
assert.equal(C.originOf('https://CDN.Example.com:8443/a/b.js'), 'https://cdn.example.com:8443');
assert.equal(C.originOf('https://user:pw@example.com/a'), 'https://example.com');
assert.equal(C.originOf('about:blank'), 'about:');
assert.equal(C.originOf(''), '(not stated)');

// ---- Grouping, counts and ordering.
const many = [
  ['script-src-elem', 'https://cdn.example.com/a.js'],
  ['script-src-elem', 'https://cdn.example.com/b.js'],
  ['script-src-elem', 'https://cdn.example.com/c.js'],
  ['img-src', 'https://img.example.com/a.png'],
  ['img-src', 'https://img.example.com/b.png'],
  ['style-src-attr', 'inline']
].map(function(pair){
  return { 'csp-report': {
    'document-uri': 'https://app.example.com/',
    'effective-directive': pair[0],
    'blocked-uri': pair[1],
    disposition: 'enforce'
  } };
});
const result = C.analyse(JSON.stringify(many));
assert.equal(result.total, 6);
assert.equal(result.enforced, 6);
assert.equal(result.reportOnly, 0);
assert.equal(result.otherDisposition, 0);
assert.equal(result.documents, 1);
assert.equal(result.directives, 3);
assert.equal(result.origins, 3);
assert.equal(result.inlineOrEval, 1);
assert.deepEqual(JSON.parse(JSON.stringify(result.groups.map(function(g){ return [g.count, g.directive, g.origin]; }))), [
  [3, 'script-src-elem', 'https://cdn.example.com'],
  [2, 'img-src', 'https://img.example.com'],
  [1, 'style-src-attr', 'inline']
]);
assert.equal(result.groups[0].sample, 'https://cdn.example.com/a.js');
assert.equal(result.groups[1].sample, 'https://img.example.com/a.png');

// Equal counts sort by directive, then origin.
const tied = C.analyse(JSON.stringify([
  { 'csp-report': { 'effective-directive': 'style-src', 'blocked-uri': 'inline' } },
  { 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'https://b.example/' } },
  { 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'https://a.example/' } }
]));
assert.deepEqual(JSON.parse(JSON.stringify(tied.groups.map(function(g){ return [g.directive, g.origin]; }))), [
  ['img-src', 'https://a.example'],
  ['img-src', 'https://b.example'],
  ['style-src', 'inline']
]);
assert.equal(tied.otherDisposition, 3, 'a missing disposition is not guessed');

// ---- Refusals, by exact message.
function refuses(input, message){
  assert.throws(function(){ C.analyse(input); }, function(error){
    assert.equal(error.message, message);
    return true;
  });
}
refuses('', 'Paste one or more CSP violation reports as JSON.');
refuses('   ', 'Paste one or more CSP violation reports as JSON.');
refuses('not json', 'That is not valid JSON.');
refuses('"hello"', 'The top level must be a report object or an array of reports.');
refuses('[]', 'The array contains no reports.');
refuses('[1]', 'Report 1 is not a JSON object.');
refuses('{"foo":1}', 'Report 1 has no CSP violation fields.');
refuses('{"body":"x"}', 'Report 1 has a body that is not a JSON object.');
refuses('{"csp-report":[]}', 'Report 1 has a csp-report value that is not a JSON object.');
refuses('[' + Array(1001).fill('{"csp-report":{"effective-directive":"img-src"}}').join(',') + ']',
  'Paste at most 1,000 reports at a time.');
refuses('x'.repeat(512001), 'Paste at most 512,000 characters at a time.');
refuses(JSON.stringify([{ type: 'deprecation', body: { id: 'x' } }]),
  'The payload contains no CSP violation reports; check that the report type is csp-violation.');

// ---- Hints exist for the common directives and stay stable.
['default-src', 'script-src-elem', 'style-src-attr', 'img-src', 'connect-src', 'frame-ancestors'].forEach(function(name){
  assert.equal(typeof C.hints[name], 'string');
  assert.ok(C.hints[name].length > 20, name + ' hint is substantive');
});
assert.match(C.hintFor('script-src-elem'), /nonce or hash/);
assert.match(C.hintFor('style-src-attr'), /stylesheet class/);
assert.match(C.hintFor('made-up-src'), /No built-in hint/);

// ---- Catalog contract.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2498, 'catalog records');
assert.equal(catalog.tools.filter(function(tool){ return tool.listed; }).length, 2237, 'public tools');
assert.equal(catalog.tools.filter(function(tool){ return tool.category === 'Security'; }).length, 57, 'Security count');
const record = catalog.tools.find(function(tool){ return tool.slug === slug; });
assert.ok(record, 'catalog record exists');
assert.equal(record.name, 'CSP Violation Report Analyzer');
assert.equal(record.category, 'Security');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.listed, true);
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 80);
assert.ok(Array.isArray(record.aliases) && record.aliases.length >= 4);
assert.ok(record.tags.includes('security'));
assert.ok(record.sources.length >= 2);
record.sources.forEach(function(source){
  assert.ok(/^https:\/\//.test(source.url), 'source URL is https');
  assert.ok(source.title.length > 20);
});
assert.ok(record.testCases.length >= 10, 'catalog carries the worked cases');
assert.ok(record.testCases.some(function(test){ return test.kind === 'golden'; }));
assert.ok(record.testCases.some(function(test){ return test.kind === 'validation'; }));

// ---- Page contract.
assert.ok(html.includes('id="csp-form"'));
assert.ok(html.includes('id="in-reports"'));
assert.ok(html.includes('id="out"'));
assert.ok(html.includes('id="groups"'));
assert.ok(html.includes('aria-live="polite"'));
assert.ok(!/\.innerHTML\s*=/.test(html), 'user data never reaches innerHTML');
assert.ok(!/fetch\(|new XMLHttpRequest|new WebSocket/.test(html), 'the page makes no network calls');

console.log('csp violation report analyzer: all cases passed');
