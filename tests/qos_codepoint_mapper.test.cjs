/* Regression checks for the QoS codepoint core, its catalog cases, the reference
   table in the page and the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'qos-codepoint-mapper';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* qos-core:start */');
const end = html.indexOf('/* qos-core:end */');
assert.ok(start > -1 && end > start, 'qos codepoint core markers missing');
const core = html.slice(start, end + '/* qos-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = QoSClassCore;', sandbox);
const C = sandbox.module.exports;

assert.equal(C.DEFAULT_CODEPOINT, 'AF41');
assert.equal(C.TABLE.length, 23, 'named codepoint count');
assert.deepEqual(JSON.parse(JSON.stringify(C.PRECEDENCE)),
  ['Routine', 'Priority', 'Immediate', 'Flash', 'Flash Override', 'CRITICAL/ECP',
    'Internetwork Control', 'Network Control']);
assert.equal(C.ECN.length, 4);
assert.deepEqual(JSON.parse(JSON.stringify(C.ECN.map((entry) => entry.bits))), ['00', '01', '10', '11']);

const lookup = (codepoint, ecn) => C.lookup({ codepoint: codepoint, ecn: ecn === undefined ? '0' : ecn });
const byDscp = new Map(C.TABLE.map((entry) => [entry.dscp, entry]));

// The standard name for a codepoint, derived here rather than read from the page:
// class selectors are multiples of eight, AF is 8x + 2y, and EF, VA and LE are
// the three fixed single values.
const standardName = (dscp) => {
  if (dscp % 8 === 0) return 'CS' + (dscp / 8);
  if (dscp >= 10 && dscp <= 38 && [2, 4, 6].includes(dscp % 8)) {
    return 'AF' + Math.floor(dscp / 8) + ((dscp % 8) / 2);
  }
  return { 1: 'LE', 44: 'VA', 46: 'EF' }[dscp] || null;
};

let named = 0;
for (let dscp = 0; dscp <= 63; dscp += 1) {
  for (const ecn of ['0', '1', '2', '3']) {
    const r = lookup(String(dscp), ecn);
    const expectedName = standardName(dscp);
    assert.equal(r.dscp, dscp);
    assert.equal(r.name, expectedName, 'name for ' + dscp);
    assert.equal(r.known, expectedName !== null, 'known flag for ' + dscp);
    assert.equal(r.dscpBits, dscp.toString(2).padStart(6, '0'), 'bits for ' + dscp);
    assert.equal(r.dscpBits.length, 6);
    // DS field: six DSCP bits then two ECN bits.
    assert.equal(r.tos, dscp * 4 + Number(ecn), 'DS field for ' + dscp + '/' + ecn);
    assert.equal(r.tosHex, '0x' + r.tos.toString(16).toUpperCase().padStart(2, '0'));
    assert.equal(r.tosBits, r.dscpBits + ' ' + r.ecnBits);
    assert.equal(r.ecnBits, Number(ecn).toString(2).padStart(2, '0'));
    // IP precedence is the top three bits, which is also the class selector number.
    assert.equal(r.precedence, dscp >> 3, 'precedence for ' + dscp);
    assert.equal(r.precedenceName, C.PRECEDENCE[dscp >> 3]);
    if (expectedName !== null) {
      named += 1;
      const entry = byDscp.get(dscp);
      assert.ok(entry, 'table entry for named codepoint ' + dscp);
      assert.equal(entry.name, expectedName);
      assert.equal(r.cos, entry.cos, 'recommended priority for ' + expectedName);
      assert.ok(r.cos >= 0 && r.cos <= 7, 'priority inside 0-7');
    } else {
      assert.equal(r.cos, null, 'unassigned codepoint has no default priority');
      assert.equal(r.phb, 'Unassigned codepoint');
    }
  }
}
assert.equal(named, 23 * 4, 'all 23 named codepoints across four ECN values');

// The AF family must be exactly the 12 codepoints AF11 to AF43, with the class
// in the high bits and the drop precedence in the low bits.
const af = C.TABLE.filter((entry) => entry.name.startsWith('AF'));
assert.equal(af.length, 12);
for (const entry of af) {
  const cls = Number(entry.name[2]);
  const drop = Number(entry.name[3]);
  assert.ok(cls >= 1 && cls <= 4);
  assert.ok(drop >= 1 && drop <= 3);
  assert.equal(entry.dscp, 8 * cls + 2 * drop, entry.name + ' codepoint');
  assert.equal(lookup(entry.name).cos, cls, entry.name + ' rides in its class priority');
}

// Reverse lookup must invert the same table.
for (let priority = 0; priority <= 7; priority += 1) {
  const names = C.byPriority(String(priority));
  const expected = C.TABLE.filter((entry) => entry.cos === priority)
    .sort((a, b) => a.dscp - b.dscp).map((entry) => entry.name);
  assert.deepEqual(JSON.parse(JSON.stringify(names)), JSON.parse(JSON.stringify(expected)),
    'priority ' + priority);
}
assert.deepEqual(JSON.parse(JSON.stringify(C.byPriority('5'))), ['CS5', 'VA', 'EF']);
assert.deepEqual(JSON.parse(JSON.stringify(C.byPriority('4'))), ['CS4', 'AF41', 'AF42', 'AF43']);

// Headline values.
const ef = lookup('EF');
assert.equal(ef.dscp, 46);
assert.equal(ef.tos, 184);
assert.equal(ef.tosHex, '0xB8');
assert.equal(ef.precedence, 5);
assert.equal(ef.cos, 5);
assert.equal(ef.phb, 'Expedited Forwarding (EF)');
const af41 = lookup('af41');
assert.equal(af41.name, 'AF41');
assert.equal(af41.tosHex, '0x88');

// Refusals carry the page's user-facing wording.
const refuse = (codepoint, message, ecn) => {
  try {
    lookup(codepoint, ecn);
    assert.fail('expected a refusal for ' + JSON.stringify(codepoint));
  } catch (error) {
    assert.equal(error.message, message);
  }
};
const REQUIRED = 'A codepoint name or DSCP value is required.';
const RANGE = 'DSCP must be a whole number from 0 to 63.';
const UNKNOWN = 'Unknown codepoint. Use CS0-CS7, AF11-AF43, EF, VA, LE or a DSCP value from 0 to 63.';
const AF = 'AF codepoints run from AF11 to AF43.';
const CS = 'Class selectors run from CS0 to CS7.';
refuse('', REQUIRED);
refuse('   ', REQUIRED);
refuse('-1', RANGE);
refuse('64', RANGE);
refuse('1e1', UNKNOWN);
refuse('0x2E', UNKNOWN);
refuse('AF45', AF);
refuse('AF10', AF);
refuse('CS8', CS);
refuse('traffic', UNKNOWN);
refuse('EF', RANGE, '9');

// Boundaries are inclusive and zero padding is accepted.
assert.equal(lookup('0').dscp, 0);
assert.equal(lookup('63').dscp, 63);
assert.equal(lookup('00').dscp, 0);
assert.equal(lookup('DF').name, 'CS0');
assert.equal(lookup('63').cos, null);

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2256, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(record.name, 'QoS Codepoint Mapper');
assert.equal(record.category, 'IT & Networking');
assert.equal(record.subcategory, 'Reference');
assert.equal(record.listed, true);
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.length > 500, 'method explains the model');
assert.ok(record.sources.length >= 3, 'sources cite the standards');
assert.ok(record.testCases.length >= 20, 'catalog cases are exhaustive');
const nameClash = catalog.tools.filter((tool) => tool.slug !== slug)
  .some((tool) => tool.name === record.name);
assert.equal(nameClash, false, 'name is unique');
for (const alias of record.aliases) {
  const clash = catalog.tools.filter((tool) => tool.slug !== slug)
    .some((tool) => tool.name === alias || (tool.aliases || []).includes(alias));
  assert.equal(clash, false, 'alias is unique: ' + alias);
}
for (const tag of record.tags) {
  assert.equal(typeof tag, 'string');
  assert.ok(tag.length > 0);
}

const keys = ['name', 'dscp', 'dscpBits', 'tos', 'tosHex', 'precedence', 'precedenceName', 'cos'];
let golden = 0;
let refusals = 0;
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    refusals += 1;
    try {
      C.lookup(testCase.input);
      assert.fail(testCase.name + ': expected a refusal');
    } catch (error) {
      assert.equal(error.message, testCase.expected.error, testCase.name);
    }
    continue;
  }
  golden += 1;
  const result = C.lookup(testCase.input);
  for (const key of keys) {
    assert.deepEqual(result[key], testCase.expected[key], testCase.name + ' ' + key);
  }
}
assert.equal(golden, 16, 'golden case count');
assert.equal(refusals, 13, 'refusal case count');

// The static reference table must agree with the core row for row.
const rows = [...html.matchAll(/<tr data-dscp="(\d+)">(.*?)<\/tr>/g)];
assert.equal(rows.length, 23, 'reference table rows');
const seen = new Set();
for (const [, dscpText, cells] of rows) {
  const dscp = Number(dscpText);
  assert.ok(!seen.has(dscp), 'duplicate reference row for ' + dscp);
  seen.add(dscp);
  const tds = [...cells.matchAll(/<td>(.*?)<\/td>/g)].map((match) => match[1]);
  assert.equal(tds.length, 5, 'reference row has five columns');
  const result = lookup(String(dscp));
  assert.ok(result.known, 'reference row is a named codepoint: ' + dscp);
  assert.ok(tds[0].startsWith(result.name), 'reference name cell for ' + dscp);
  assert.equal(Number(tds[1]), result.dscp, 'reference DSCP cell for ' + dscp);
  assert.equal(tds[2], result.tosHex, 'reference DS field cell for ' + dscp);
  assert.equal(tds[2], '0x' + (dscp * 4).toString(16).toUpperCase().padStart(2, '0'));
  assert.equal(Number(tds[4]), result.cos, 'reference priority cell for ' + dscp);
  assert.equal(tds[4], String(result.cos));
}
assert.equal(seen.size, C.TABLE.length, 'table covers every named codepoint');

// Page contract: shared chrome, one form, pinned defaults, no storage, no
// network, no HTML sinks.
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style\.css">/);
assert.equal((html.match(/id="qos-form"/g) || []).length, 1);
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('role="alert"'));
assert.match(html, /id="in-codepoint"[^>]*value="AF41"/);
assert.match(html, /id="in-ecn"/);
assert.match(html, /id="in-priority"/);
for (const value of ['0', '1', '2', '3']) {
  assert.match(html, new RegExp('<option value="' + value + '"'));
}
assert.match(html, /\.actions button\{[^}]*min-height:44px/);
assert.match(html, /\.field input[^{]*\{[^}]*min-height:44px/);
assert.match(html, /<button type="submit">/);
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), 'page stores nothing');
assert.ok(!/https?:\/\//.test(html), 'page references no external URL');
assert.ok(!/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/.test(html), 'page makes no requests');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page uses no HTML sinks');

console.log(slug + ' core: all checks passed (' + record.testCases.length + ' catalog cases, '
  + golden + ' golden, ' + refusals + ' refusals, 64 codepoints x 4 ECN, reverse map, reference table, page contract)');
