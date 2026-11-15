/* IPv4 route summarizer: the aggregation contract, the page markup and the
   catalog record's cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ipv4-route-summarizer';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* route-summarizer-core:start */';
const endMarker = '/* route-summarizer-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, Date, Map, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RouteSummarizerCore;', sandbox);
const C = sandbox.module.exports;

const failure = (text) => {
  try { C.summarize({ prefixes: text }); } catch (error) { return error.message; }
  return null;
};
const summary = (text) => C.summarize({ prefixes: text });
const FULL = 4294967296;

// ---- Documented constants.
assert.deepEqual(Array.from(C.LIMITS.prefixes), [1, 64]);
assert.equal(C.MAX_LISTED, 64);
assert.equal(C.MAX_TOKEN, 64);
assert.equal(C.DEFAULTS.prefixes, '10.0.0.0/25\n10.0.0.128/25\n10.0.1.0/24\n10.0.4.0/24');

// ---- Address arithmetic.
assert.equal(C.ipToInt([0, 0, 0, 0]), 0);
assert.equal(C.ipToInt([255, 255, 255, 255]), FULL - 1);
assert.equal(C.ipToInt([10, 0, 0, 1]), 167772161);
assert.equal(C.intToIp(0), '0.0.0.0');
assert.equal(C.intToIp(FULL - 1), '255.255.255.255');
assert.equal(C.intToIp(167772161), '10.0.0.1');
assert.equal(C.intToIp(3232235520), '192.168.0.0');
for (const value of [0, 1, 255, 256, 65535, 167772160, 2147483648, 4294967295]) {
  assert.equal(C.ipToInt(C.intToIp(value).split('.').map(Number)), value, 'round trip ' + value);
}
assert.equal(C.sizeFor(0), FULL);
assert.equal(C.sizeFor(8), 16777216);
assert.equal(C.sizeFor(24), 256);
assert.equal(C.sizeFor(32), 1);
assert.equal(C.textOf(167772160, 24), '10.0.0.0/24');
assert.equal(C.textOf(0, 0), '0.0.0.0/0');

// ---- Field parsing and every refusal.
assert.deepEqual(
  JSON.parse(JSON.stringify(C.parsePrefix('10.0.0.0/24', 1))),
  { token: '10.0.0.0/24', line: 1, network: 167772160, len: 24, size: 256, broadcast: 167772415 }
);
assert.equal(C.parsePrefix('0.0.0.0/0', 1).size, FULL);
assert.equal(C.parsePrefix('255.255.255.255/32', 1).broadcast, FULL - 1);
assert.equal(C.parsePrefix('10.0.0.128/25', 7).line, 7);
assert.equal(failure(''), 'Enter at least one IPv4 prefix, such as 10.0.0.0/24.');
assert.equal(failure(' \n\t \n'), 'Enter at least one IPv4 prefix, such as 10.0.0.0/24.');
assert.equal(failure('\n'.repeat(3) + '10.0.0.0/24'), null, 'blank lines are ignored');
assert.equal(failure(Array(66).fill('10.0.0.0/32').join('\n')),
  'Enter at most 64 prefixes; 66 were given.');
assert.equal(failure('10.0.0.0'),
  'Prefix "10.0.0.0" on line 1 has no /length; write it as 10.0.0.0/24.');
assert.equal(failure('10.0.0.1/24'),
  'Prefix "10.0.0.1/24" on line 1 has host bits set; the network for that length is 10.0.0.0/24.');
assert.equal(failure('10.0.255.255/16'),
  'Prefix "10.0.255.255/16" on line 1 has host bits set; the network for that length is 10.0.0.0/16.');
assert.equal(failure('10.0.0.0/33'),
  'Prefix "10.0.0.0/33" on line 1 has a prefix length of 33; it must be 0 to 32.');
assert.equal(failure('10.0.0.0/x'),
  'Prefix "10.0.0.0/x" on line 1 has a prefix length that is not a whole number from 0 to 32.');
assert.equal(failure('10.0.0.0/024'),
  'Prefix "10.0.0.0/024" on line 1 has a prefix length that is not a whole number from 0 to 32.');
assert.equal(failure('10.0.0/24'),
  'Prefix "10.0.0/24" on line 1 does not have four octets; write it as 10.0.0.0/24.');
assert.equal(failure('10.0.0.0.0/24'),
  'Prefix "10.0.0.0.0/24" on line 1 does not have four octets; write it as 10.0.0.0/24.');
assert.equal(failure('10.0.0.a/24'),
  'Prefix "10.0.0.a/24" on line 1 has an octet that is not a number.');
assert.equal(failure('10.0.0.256/24'),
  'Prefix "10.0.0.256/24" on line 1 has an octet above 255.');
assert.equal(failure('10.00.0.0/24'),
  'Prefix "10.00.0.0/24" on line 1 has an octet with a leading zero.');
assert.equal(failure('2001:db8::/32'),
  'Prefix "2001:db8::/32" on line 1 is an IPv6 prefix; this tool summarizes IPv4 only.');
assert.equal(failure('10.0.0.0/24\n10.0.1.0/24\n10.0.2.1/24'),
  'Prefix "10.0.2.1/24" on line 3 has host bits set; the network for that length is 10.0.2.0/24.');
assert.ok(failure('1'.repeat(70) + '/24').includes('"111111111111111111111111..."'), 'long tokens are elided');
assert.equal(failure('10.0.0.0/24 10.0.0.128/25, 10.0.1.0/26; 10.0.1.64/26'), null,
  'spaces, commas and semicolons separate prefixes');

// ---- Tokenizing keeps the line number of every entry.
const tokens = JSON.parse(JSON.stringify(C.tokenize('10.0.0.0/24 10.0.1.0/24\n\n10.0.2.0/24,10.0.3.0/24')));
assert.deepEqual(tokens, [
  { text: '10.0.0.0/24', line: 1 }, { text: '10.0.1.0/24', line: 1 },
  { text: '10.0.2.0/24', line: 3 }, { text: '10.0.3.0/24', line: 3 },
]);
assert.deepEqual(JSON.parse(JSON.stringify(C.tokenize(''))), []);

// ---- Number formatting and the common-prefix primitive.
assert.equal(C.fmtCount(0), '0');
assert.equal(C.fmtCount(768), '768');
assert.equal(C.fmtCount(16384), '16,384');
assert.equal(C.fmtCount(FULL), '4,294,967,296');
assert.equal(C.commonPrefixLength(167772160, 167772415), 24);
assert.equal(C.commonPrefixLength(167772160, 167773183), 22);
assert.equal(C.commonPrefixLength(0, FULL - 1), 0);
assert.equal(C.commonPrefixLength(167772160, 167772160), 32);
assert.equal(C.commonPrefixLength(167772160, 167772161), 31);

// ---- Collapsing: siblings merge, chains merge, unrelated blocks do not.
const block = (text) => C.parsePrefix(text, 1);
const names = (items) => Array.from(items, (item) => C.textOf(item.network, item.len));
const collapsed = C.collapse([block('10.0.0.0/25'), block('10.0.0.128/25')]);
assert.deepEqual(names(collapsed), ['10.0.0.0/24']);
const chain = C.collapse([block('10.0.0.0/24'), block('10.0.1.0/24'), block('10.0.2.0/24'), block('10.0.3.0/24')]);
assert.deepEqual(names(chain), ['10.0.0.0/22']);
const apart = C.collapse([block('10.0.0.0/24'), block('10.0.2.0/24')]);
assert.deepEqual(names(apart), ['10.0.0.0/24', '10.0.2.0/24']);
const hostPair = C.collapse([block('10.0.0.0/32'), block('10.0.0.1/32')]);
assert.deepEqual(names(hostPair), ['10.0.0.0/31']);

// ---- The default summary.
const d = summary(C.DEFAULTS.prefixes);
assert.equal(d.entered, 4);
assert.equal(d.unique, 4);
assert.equal(d.duplicates, 0);
assert.equal(d.coveredEntries, 0);
assert.deepEqual(Array.from(d.aggregates), ['10.0.0.0/23', '10.0.4.0/24']);
assert.equal(d.aggregateCount, 2);
assert.equal(d.covered, 768);
assert.equal(d.coveredText, '768');
assert.equal(d.first, '10.0.0.0');
assert.equal(d.last, '10.0.4.255');
assert.equal(d.supernet, '10.0.0.0/21');
assert.equal(d.supernetSize, 2048);
assert.equal(d.supernetText, '2,048');
assert.equal(d.extra, 1280);
assert.equal(d.extraText, '1,280');
assert.equal(d.runs, 2);
assert.equal(d.contiguous, false);
assert.equal(d.firstGap, '10.0.2.0 to 10.0.3.255');
assert.equal(d.statusKind, 'warning');
assert.ok(d.statusText.startsWith('2 aggregate prefixes cover 768 addresses from 4 entries, in 2 separate ranges'), d.statusText);
assert.ok(d.summary.startsWith('The 4 entries summarize to 2 routes: 10.0.0.0/23, 10.0.4.0/24.'), d.summary);
assert.ok(d.summary.includes('768 of the 2,048 addresses in 10.0.0.0/21'), d.summary);
assert.equal(d.warnings.length, 1, 'only the gap is warned about');
assert.ok(d.warnings[0].includes('they form 2 separate ranges'), d.warnings[0]);
assert.equal(d.explanation.length, 6);
assert.ok(d.explanation[1].includes('4 entries, 4 distinct, 0 duplicate and 0 already inside'), d.explanation[1]);
assert.ok(d.explanation[2].includes('which leaves 2 prefixes'), d.explanation[2]);
assert.ok(d.explanation[3].includes('768 addresses, from 10.0.0.0 to 10.0.4.255'), d.explanation[3]);
assert.ok(d.explanation[4].includes('10.0.0.0/21, which is 2,048 addresses'), d.explanation[4]);
assert.ok(d.explanation[5].includes('first gap runs from 10.0.2.0 to 10.0.3.255'), d.explanation[5]);
assert.equal(d.rows.length, 2);
assert.deepEqual({ ...d.rows[0] }, { prefix: '10.0.0.0/23', first: '10.0.0.0', last: '10.0.1.255', addresses: 512, addressesText: '512' });
assert.deepEqual({ ...d.rows[1] }, { prefix: '10.0.4.0/24', first: '10.0.4.0', last: '10.0.4.255', addresses: 256, addressesText: '256' });
assert.equal(d.hiddenRows, 0);
assert.deepEqual(Array.from(d.inputRows, (row) => row.note), ['kept', 'kept', 'kept', 'kept']);

// ---- Duplicates and covered entries are reported, not silently merged.
const dropped = summary('10.0.0.0/16\n10.0.1.0/24\n10.0.1.0/24\n10.0.2.0/24');
assert.equal(dropped.entered, 4);
assert.equal(dropped.unique, 3);
assert.equal(dropped.duplicates, 1);
assert.equal(dropped.coveredEntries, 2);
assert.deepEqual(Array.from(dropped.aggregates), ['10.0.0.0/16']);
assert.equal(dropped.covered, 65536);
assert.equal(dropped.inputRows[1].note, 'inside 10.0.0.0/16, which is broader');
assert.equal(dropped.inputRows[2].note, 'duplicate of 10.0.1.0/24');
assert.equal(dropped.inputRows[3].note, 'inside 10.0.0.0/16, which is broader');
assert.ok(dropped.warnings.some((line) => line.includes('1 duplicate and 2 prefixes already inside broader ones')), dropped.warnings.join(' | '));
assert.ok(dropped.warnings.some((line) => line.includes('Every entry collapses into the single prefix 10.0.0.0/16')), dropped.warnings.join(' | '));

// ---- Extremes: the whole space, one prefix, and the 64-entry cap.
const everywhere = summary('0.0.0.0/1\n128.0.0.0/1');
assert.deepEqual(Array.from(everywhere.aggregates), ['0.0.0.0/0']);
assert.equal(everywhere.covered, FULL);
assert.equal(everywhere.contiguous, true);
assert.equal(everywhere.supernet, '0.0.0.0/0');
assert.equal(everywhere.extra, 0);
assert.ok(everywhere.warnings.some((line) => line.includes('cover the whole IPv4 address space')), everywhere.warnings.join(' | '));
assert.ok(everywhere.explanation[2].includes('which leaves 1 prefix'), everywhere.explanation[2]);
const single = summary('192.168.1.0/24');
assert.equal(single.aggregateCount, 1);
assert.equal(single.covered, 256);
assert.equal(single.first, '192.168.1.0');
assert.equal(single.statusKind, 'ok');
assert.ok(single.statusText.includes('in one contiguous range'), single.statusText);
assert.ok(single.explanation[5].includes('one contiguous range from 192.168.1.0 to 192.168.1.255'), single.explanation[5]);
const many = summary(Array.from({ length: 64 }, (_, index) => '10.0.' + index + '.0/24').join('\n'));
assert.equal(many.entered, 64);
assert.deepEqual(Array.from(many.aggregates), ['10.0.0.0/18']);
assert.equal(many.covered, 16384);
assert.equal(many.contiguous, true);

// ---- Every aggregate must be aligned, disjoint and unmergeable, and the set
//      must cover exactly the input ranges: checked against a greedy
//      range-to-prefix decomposition built here, independently of the page.
const blockOf = (text) => {
  const [address, length] = text.split('/');
  const size = Math.pow(2, 32 - Number(length));
  const value = address.split('.').map(Number).reduce((total, octet) => total * 256 + octet, 0);
  return { start: value, end: value + size - 1, size: size, length: Number(length) };
};
function greedy(text) {
  const ranges = text.split(/[\s,;]+/).filter(Boolean).map(blockOf)
    .sort((left, right) => left.start - right.start);
  const runs = [];
  for (const range of ranges) {
    const open = runs[runs.length - 1];
    if (open && range.start <= open.end + 1) open.end = Math.max(open.end, range.end);
    else runs.push({ start: range.start, end: range.end });
  }
  const out = [];
  for (const run of runs) {
    let cursor = run.start;
    while (cursor <= run.end) {
      let size = FULL;
      while (size > run.end - cursor + 1 || cursor % size !== 0) size /= 2;
      out.push(C.textOf(cursor, 32 - Math.log2(size)));
      cursor += size;
    }
  }
  return out;
}
function checkAggregates(text, result) {
  const blocks = result.aggregates.map(blockOf);
  let total = 0;
  for (const item of blocks) {
    assert.equal(item.start % item.size, 0, 'aligned: ' + text);
    total += item.size;
  }
  assert.equal(total, result.covered, 'covered is the block total: ' + text);
  assert.equal(total, blocks.reduce((sum, item) => sum + item.size, 0), 'no double counting: ' + text);
  for (let i = 0; i < blocks.length; i += 1) {
    for (let j = i + 1; j < blocks.length; j += 1) {
      const left = blocks[i];
      const right = blocks[j];
      assert.ok(left.end < right.start || right.end < left.start, 'disjoint: ' + text);
      assert.ok(!(left.length === right.length && Math.abs(left.start - right.start) === left.size
        && Math.min(left.start, right.start) % (2 * left.size) === 0), 'unmergeable: ' + text);
    }
  }
  assert.deepEqual(Array.from(result.aggregates), greedy(text), 'greedy decomposition agrees: ' + text);
}
checkAggregates(C.DEFAULTS.prefixes, d);
checkAggregates('0.0.0.0/1\n128.0.0.0/1', everywhere);
checkAggregates('192.168.1.0/24', single);

const pool = [];
for (let length = 23; length <= 28; length += 1) {
  const size = Math.pow(2, 32 - length);
  for (let offset = 167772160; offset < 167772160 + 512; offset += size) pool.push(C.textOf(offset, length));
}
assert.equal(pool.length, 63);
function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
const random = mulberry32(20261115);
let sweep = 0;
for (let round = 0; round < 400; round += 1) {
  const count = 1 + Math.floor(random() * 8);
  const chosen = [];
  for (let index = 0; index < count; index += 1) chosen.push(pool[Math.floor(random() * pool.length)]);
  const text = chosen.join('\n');
  const result = summary(text);
  checkAggregates(text, result);
  assert.equal(result.contiguous, result.runs === 1, 'contiguity matches the run count: ' + text);
  assert.equal(result.extra, result.supernetSize - result.covered, 'extra addresses: ' + text);
  assert.equal(result.covered, result.rows.reduce((sum, row) => sum + row.addresses, 0), 'rows add up: ' + text);
  sweep += result.aggregateCount;
}

// ---- Page contract.
assert.ok(/<html lang="en">/.test(html), 'the page declares its language');
assert.ok(/<meta name="viewport"/.test(html), 'the page is mobile ready');
assert.ok(/<link rel="stylesheet" href="\/assets\/style.css">/.test(html), 'the shared stylesheet is used');
assert.ok(/<div id="site-header"><\/div>/.test(html), 'the shared header mount is present');
assert.equal((html.match(/<h1/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('<title>IPv4 Route Summarizer &mdash; virt.tools</title>'));
assert.ok(/<meta name="description" content="[^"]{80,}"/.test(html), 'a description is supplied');
assert.ok(/<form id="route-form" novalidate>/.test(html), 'the form owns submission');
assert.ok(html.includes('<label for="in-prefixes">'), 'the textarea is labelled');
assert.ok(/<textarea id="in-prefixes" name="prefixes" rows="7"/.test(html), 'the prefix field is a textarea');
assert.ok(html.includes('10.0.0.0/25\n10.0.0.128/25\n10.0.1.0/24\n10.0.4.0/24'), 'the default list is shown');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html));
assert.ok(/<button id="example" type="button">/.test(html));
assert.ok(/<button id="reset" type="button">/.test(html));
assert.ok(/role="status" aria-live="polite"/.test(html), 'the status is announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(!/\son(click|change|input|submit|load)=/.test(html), 'no inline event handlers');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|navigator\.sendBeacon/.test(html),
  'the page makes no network or storage calls');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no third-party scripts');
assert.ok(html.includes('@media(max-width:720px)'), 'the layout reflows for phones');
assert.ok(html.includes('min-height:44px'), 'controls keep a 44 px target');
assert.ok(html.includes('scope="col"'), 'table headers are scoped');
assert.ok(!/[\u0080-\uFFFF]/.test(html), 'the source stays ASCII');
for (const id of ['out-entered', 'out-entered-note', 'out-unique', 'out-unique-note', 'out-aggregates',
  'out-covered', 'out-supernet', 'out-supernet-note', 'out-extra', 'out-layout', 'out-layout-note',
  'aggregates', 'input-body', 'warnings', 'explanation', 'summary', 'status', 'error', 'table-caption']) {
  assert.ok(html.includes(`id="${id}"`), 'missing output ' + id);
}
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'the shared scripts load last');
assert.ok(html.includes('tabindex="0"') || html.includes("tabindex='0'"), 'the aggregate block can be reached by keyboard');

// ---- Catalog record and every case in it must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2310, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'IPv4 Route Summarizer');
assert.equal(record.category, 'Networking');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.icon, '\u{1f5c2}');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.description.length < 260, 'description stays short');
assert.ok(record.method.includes('2^(32-length)'), 'the method states the block size');
assert.ok(record.method.includes('aligned siblings into their parent'), 'the method states the merge rule');
assert.ok(record.method.includes('up to 64 prefixes'), 'the method states the input bounds');
assert.ok(record.method.includes('no uploads'), 'the method states the privacy position');
assert.ok(record.guidance.includes('CIDR aggregation only'), 'the guidance states the scope');
assert.equal(record.sources.length, 2, 'both RFCs are cited');
assert.equal(record.sources[0].url, 'https://www.rfc-editor.org/rfc/rfc1519');
assert.equal(record.sources[1].url, 'https://www.rfc-editor.org/rfc/rfc4632.html');
for (const source of record.sources) assert.ok(source.title.length > 30, 'each source is described');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.tags.includes('supernet'));
assert.ok(record.aliases.includes('Route Summarization Calculator'));
assert.equal(catalog.tools.filter((tool) => tool.category === 'Networking').length, 46, 'Networking count');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'no rival record');
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  assert.notEqual(tool.name.toLowerCase(), record.name.toLowerCase(), 'duplicate name: ' + tool.slug);
  const aliases = new Set((tool.aliases || []).map((alias) => alias.trim().toLowerCase()));
  for (const alias of record.aliases) {
    assert.ok(!aliases.has(alias.trim().toLowerCase()), `alias ${alias} clashes with ${tool.slug}`);
  }
}

assert.equal(record.testCases.length, 22, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 12);
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input.prefixes), testCase.expected.error, testCase.name);
    continue;
  }
  const result = summary(testCase.input.prefixes);
  const expected = testCase.expected;
  assert.deepEqual(Array.from(result.aggregates), expected.aggregates, testCase.name + ' aggregates');
  assert.equal(result.aggregateCount, expected.aggregateCount, testCase.name + ' count');
  assert.equal(result.covered, expected.covered, testCase.name + ' covered');
  assert.equal(result.supernet, expected.supernet, testCase.name + ' supernet');
  assert.equal(result.supernetSize, expected.supernetSize, testCase.name + ' supernet size');
  assert.equal(result.extra, expected.extra, testCase.name + ' extra');
  assert.equal(result.runs, expected.runs, testCase.name + ' runs');
  assert.equal(result.contiguous, expected.contiguous, testCase.name + ' contiguous');
  assert.equal(result.firstGap, expected.firstGap, testCase.name + ' first gap');
  assert.equal(result.entered, expected.entered, testCase.name + ' entered');
  assert.equal(result.unique, expected.unique, testCase.name + ' unique');
  assert.equal(result.duplicates, expected.duplicates, testCase.name + ' duplicates');
  assert.equal(result.coveredEntries, expected.coveredEntries, testCase.name + ' covered entries');
  assert.ok(result.summary.length > 40, testCase.name + ' summary is written');
  assert.equal(result.explanation.length, 6, testCase.name + ' explanation is complete');
  assert.ok(result.statusText.length > 10, testCase.name + ' status is written');
  assert.ok(['ok', 'warning'].includes(result.statusKind), testCase.name + ' status kind');
  checkAggregates(testCase.input.prefixes, result);
}

console.log('ipv4 route summarizer: all checks passed (' + sweep + ' aggregate blocks in the sweep)');
