/* HTTP Accept parser: replay catalog fixtures, published RFC 9110 examples,
   and independently enumerate precedence over generated media ranges. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'http-accept-header-tester';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* accept-core:start */');
const end = html.indexOf('/* accept-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = AcceptCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'HTTP Accept Header Tester');
assert.equal(entry.category, 'Networking');
assert.equal(entry.subcategory, 'HTTP');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 700, 'method must document precedence and limits');
assert.equal(entry.sources.length, 2);
for (const source of entry.sources) assert.match(source.url, /^https:\/\//);
assert.equal(entry.testCases.length, 20, 'catalog case count');
assert.equal(entry.testCases.filter((t) => t.kind === 'golden').length, 8);
assert.equal(entry.testCases.filter((t) => t.kind === 'boundary').length, 3);
assert.equal(entry.testCases.filter((t) => t.kind === 'validation').length, 9);

function failure(input) {
  try { C.run(input); } catch (error) { return error.message; }
  return null;
}
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.run(testCase.input);
  for (const [field, expected] of Object.entries(testCase.expected)) {
    const actual = field === 'qualities' ? Array.from(result.offers, (offer) => offer.q) : result[field];
    if (Array.isArray(expected)) assert.deepEqual(Array.from(actual, (x) => typeof x === 'object' ? { ...x } : x), expected, testCase.name + ' ' + field);
    else assert.equal(actual, expected, testCase.name + ' ' + field);
  }
  assert.equal(result.acceptableCount + result.rejectedCount, result.offers.length, testCase.name + ' disposition count');
  for (const offer of result.offers) {
    assert.equal(offer.acceptable, offer.q > 0, testCase.name + ' q=0 contract');
    if (offer.matchedRange) assert.ok(result.ranges.some((range) => range.range === offer.matchedRange), testCase.name + ' matched range exists');
  }
  const positive = result.offers.filter((offer) => offer.q > 0);
  if (result.best) {
    assert.ok(positive.length, testCase.name + ' best is acceptable');
    assert.equal(result.best, positive.reduce((best, offer) => offer.q > best.q ? offer : best).offer, testCase.name + ' first highest-quality offer');
  } else assert.equal(positive.length, 0, testCase.name + ' no acceptable offer');
}

// The markup samples and the core defaults must not drift apart.
function textareaValue(id) {
  const at = html.indexOf('<textarea id="' + id + '"');
  return html.slice(html.indexOf('>', at) + 1, html.indexOf('</textarea>', at));
}
assert.equal(C.run({}).normalized, C.run({ header: textareaValue('header'), offers: textareaValue('offers') }).normalized, 'default header differs');
assert.deepEqual(Array.from(C.run({}).offers, (x) => x.q), Array.from(C.run({ header: textareaValue('header'), offers: textareaValue('offers') }).offers, (x) => x.q), 'default offers differ');

// RFC 9110 section 12.5.1 plus verified erratum 7138: text/html;level=3
// inherits text/* q=0.3, not the obsolete example's erroneous 0.7.
const rfc = C.run({
  header: 'text/*;q=0.3, text/plain;q=0.7, text/plain;format=flowed, text/plain;format=fixed;q=0.4, */*;q=0.5',
  offers: 'text/plain;format=flowed\ntext/plain\ntext/html\nimage/jpeg\ntext/plain;format=fixed\ntext/html;level=3'
});
assert.deepEqual(Array.from(rfc.offers, (offer) => offer.q), [1, 0.7, 0.3, 0.5, 0.4, 0.3]);
assert.equal(rfc.best, 'text/plain;format=flowed');
assert.equal(C.run({ header: 'audio/*; q=0.2, audio/basic', offers: 'audio/basic\naudio/ogg' }).best, 'audio/basic');
assert.deepEqual(Array.from(C.run({ header: 'audio/*; q=0.2, audio/basic', offers: 'audio/basic\naudio/ogg' }).offers, (offer) => offer.q), [1, 0.2]);
assert.equal(C.run({ header: 'text/plain; q=0.5, text/html, text/x-dvi; q=0.8, text/x-c', offers: 'text/plain\ntext/html\ntext/x-dvi\ntext/x-c' }).best, 'text/html');

// Independent oracle: enumerate every range and choose by the RFC precedence
// tuple (exact type/subtype, matching parameter count, declaration order).
function referenceQuality(header, offer) {
  const parsed = offer.match(/^([^/;]+)\/([^;]+)(.*)$/).slice(1);
  const offerType = parsed[0].toLowerCase();
  const offerSubtype = parsed[1].toLowerCase();
  const offerParams = parsed[2] ? parsed[2].split(';').filter(Boolean).map((part) => part.split('=')).map(([key, value]) => [key.toLowerCase(), value]) : [];
  let winner = null;
  header.split(',').forEach((source, index) => {
    const pieces = source.split(';').map((part) => part.trim());
    const [type, subtype] = pieces.shift().toLowerCase().split('/');
    let q = 1;
    const params = [];
    for (const piece of pieces) {
      const [rawKey, value] = piece.split('=');
      const key = rawKey.toLowerCase();
      if (key === 'q') q = Number(value);
      else params.push([key, value]);
    }
    if (type !== '*' && type !== offerType) return;
    if (subtype !== '*' && subtype !== offerSubtype) return;
    if (!params.every(([key, value]) => offerParams.some(([otherKey, otherValue]) => key === otherKey && value === otherValue))) return;
    const candidate = { q, level: type === '*' ? 0 : subtype === '*' ? 1 : 2, count: params.length, index };
    if (!winner || candidate.level > winner.level || (candidate.level === winner.level && candidate.count > winner.count)) winner = candidate;
  });
  return winner ? winner.q : 0;
}
const types = ['text', 'image', 'application'];
const subtypes = ['plain', 'html', 'json', 'png'];
for (let index = 0; index < 2000; index += 1) {
  const type = types[index % types.length];
  const subtype = subtypes[(index * 7) % subtypes.length];
  const header = '*/*;q=0.1, ' + type + '/*;q=0.2, ' + type + '/' + subtype + ';q=0.8, ' + type + '/' + subtype + ';format=flowed;q=0.4';
  const plain = type + '/' + subtype;
  const detailed = plain + ';format=flowed';
  assert.equal(C.run({ header, offers: plain }).offers[0].q, referenceQuality(header, plain), 'independent plain vector ' + index);
  assert.equal(C.run({ header, offers: detailed }).offers[0].q, referenceQuality(header, detailed), 'independent detailed vector ' + index);
  const other = type + '/' + subtypes[(index + 1) % subtypes.length];
  assert.equal(C.run({ header, offers: other }).offers[0].q, referenceQuality(header, other), 'independent wildcard vector ' + index);
}

// Page contract: shared shell, accessible controls and no runtime foreign APIs.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html), 'network or storage API found');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'remote script');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'remote stylesheet');
assert.ok(!/on(?:click|input|change|submit)=/i.test(html), 'inline handler');
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html), 'unsafe script evaluation');
assert.ok(html.includes('for="header"') && html.includes('for="offers"'), 'input labels missing');
assert.ok(html.includes('aria-describedby="header-help"'), 'help reference missing');
for (const match of html.matchAll(/\$\("([a-z0-9-]+)"\)/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'script references missing id ' + match[1]);
}
assert.ok(html.includes('<form id="accept-form" novalidate>'), 'form missing');
assert.ok(html.includes('type="submit"'), 'submit missing');
assert.ok(html.includes('id="reset"'), 'reset missing');
assert.ok(html.includes('id="normalized" readonly'), 'read-only output missing');
assert.ok(html.includes('role="alert"'), 'error announcement missing');
assert.ok(html.includes('role="status" aria-live="polite"'), 'result announcement missing');
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'), 'shared shell assets missing');

console.log('http-accept-header-tester: 20 catalog cases, RFC 9110 examples/erratum, and 6000 independent precedence checks passed');
