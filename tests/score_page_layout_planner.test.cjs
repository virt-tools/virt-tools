/* Score page layout planner: the staff-size conversion is checked against the
   published point and millimetre table, the layout arithmetic against an exact
   rational reimplementation, catalog cases are replayed and the page's offline
   contract is asserted. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'score-page-layout-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* score-page-layout-core:start */';
const endMarker = '/* score-page-layout-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ScorePageLayoutCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.compute(input));
const base = (overrides) => Object.assign({
  page: 'a4', orientation: 'portrait', topMargin: '15', bottomMargin: '15',
  staffSize: '20', staves: '2', staffGap: '6', systemGap: '12', totalSystems: '24'
}, overrides);
const failure = (input) => {
  try { C.compute(base(input)); } catch (error) { return error.message; }
  return null;
};
const near = (actual, expected, tolerance, label) => {
  assert.ok(Number.isFinite(actual), label + ': not a number (' + actual + ')');
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ': ' + actual + ' != ' + expected + ' (tolerance ' + tolerance + ')');
};

// ---- Constants and the published point definition.
assert.equal(C.MM_PER_PT, 2540 / 7227, 'one point is 2540/7227 mm');
assert.equal(C.MIN_STAFF_PT, 8);
assert.equal(C.MAX_STAFF_PT, 32);
assert.equal(C.MAX_STAVES, 24);
assert.equal(C.MAX_MARGIN, 100);
assert.equal(C.MAX_SYSTEMS, 999);
assert.deepEqual(Object.keys(C.PAGES).sort(), ['a4', 'a5', 'b4', 'letter']);
assert.equal(C.PAGES.a4.width, 210);
assert.equal(C.PAGES.a4.height, 297);
assert.equal(C.PAGES.a5.width, 148);
assert.equal(C.PAGES.b4.height, 353);
assert.equal(C.PAGES.letter.width, 215.9);
assert.equal(C.PAGES.letter.height, 279.4);

const staffHeight = (pt) => pt * 2540 / 7227;
// LilyPond 4.2.2 prints the feta staff heights to one decimal of a millimetre;
// the point values are the em sizes that carry those heights.
const feta = [
  [11.22, 3.9, 'pocket score'],
  [12.60, 4.4, ''],
  [14.14, 5.0, ''],
  [15.87, 5.6, ''],
  [17.82, 6.3, 'song book'],
  [20, 7.0, 'standard part'],
  [22.45, 7.9, ''],
  [25.2, 8.9, '']
];
for (const [pt, mm, use] of feta) {
  near(Math.round(staffHeight(pt) * 10) / 10, mm, 1e-9, 'published staff height for ' + pt + ' pt ' + use);
}
near(staffHeight(20), 7.03, 0.005, 'the default 20 pt staff is 7.03 mm high to the manual\'s two decimals');
near(staffHeight(14), 4.92, 0.005, '14 pt is 4.92 mm, as the manual states in prose');
near(staffHeight(20) / 4, 1.7573, 5e-5, 'one staff space at 20 pt');
near(C.compute(base({})).staffHeightMm, 20 * 2540 / 7227, 1e-12, 'the page reports the exact conversion');

// ---- An exact rational model, written from the definitions, as the oracle.
function gcd(a, b) { return b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b); }
function frac(n, d) {
  n = BigInt(n); d = BigInt(d);
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
const add = (a, b) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => frac(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a, b) => frac(a.n * b.n, a.d * b.d);
const div = (a, b) => frac(a.n * b.d, a.d * b.n);
const cmp = (a, b) => {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left === right ? 0 : (left < right ? -1 : 1);
};
const floorOf = (a) => Number(a.n / a.d);
const valueOf = (a) => Number(a.n) / Number(a.d);

function decimal(text) {
  const match = /^([+-]?)(\d*)(?:\.(\d+))?$/.exec(String(text));
  assert.ok(match, 'decimal parse: ' + text);
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2] || '0');
  const fraction = match[3] || '';
  const denominator = 10n ** BigInt(fraction.length);
  return frac(sign * (whole * denominator + BigInt(fraction || '0')), denominator);
}

const PAPER = {
  a4: [frac(2100, 10), frac(2970, 10)],
  letter: [frac(2159, 10), frac(2794, 10)],
  b4: [frac(2500, 10), frac(3530, 10)],
  a5: [frac(1480, 10), frac(2100, 10)]
};

function oracle(input) {
  const dims = PAPER[input.page];
  const width = input.orientation === 'portrait' ? dims[0] : dims[1];
  const height = input.orientation === 'portrait' ? dims[1] : dims[0];
  const usable = sub(sub(height, decimal(input.topMargin)), decimal(input.bottomMargin));
  const staff = mul(decimal(input.staffSize), frac(2540, 7227));
  const space = div(staff, frac(4, 1));
  const staves = BigInt(input.staves);
  const interGap = mul(decimal(input.staffGap), space);
  const blockExact = add(mul(frac(staves, 1n), staff), mul(frac(staves - 1n, 1n), interGap));
  const gap = mul(decimal(input.systemGap), space);
  const pitch = add(blockExact, gap);
  assert.equal(cmp(blockExact, usable), -1, 'oracle case must fit: ' + JSON.stringify(input));
  const per = 1 + floorOf(div(sub(usable, blockExact), pitch));
  const total = BigInt(input.totalSystems);
  const pages = Number((total + BigInt(per) - 1n) / BigInt(per));
  const last = Number(total - BigInt(pages - 1) * BigInt(per));
  const used = add(mul(frac(per, 1n), blockExact), mul(frac(per - 1, 1n), gap));
  return {
    width: valueOf(width), height: valueOf(height), usable: valueOf(usable),
    staff: valueOf(staff), space: valueOf(space), block: valueOf(blockExact),
    gap: valueOf(gap), pitch: valueOf(pitch), per, pages, last,
    used: valueOf(used), leftover: valueOf(sub(usable, used)),
    fill: valueOf(used) / valueOf(usable) * 100
  };
}

const sweep = [
  { page: 'a4', orientation: 'portrait', topMargin: '15', bottomMargin: '15', staffSize: '20', staves: '2', staffGap: '6', systemGap: '12', totalSystems: '24' },
  { page: 'a4', orientation: 'portrait', topMargin: '15', bottomMargin: '15', staffSize: '20', staves: '4', staffGap: '6', systemGap: '12', totalSystems: '32' },
  { page: 'letter', orientation: 'portrait', topMargin: '15', bottomMargin: '15', staffSize: '20', staves: '2', staffGap: '6', systemGap: '12', totalSystems: '30' },
  { page: 'a4', orientation: 'landscape', topMargin: '15', bottomMargin: '15', staffSize: '20', staves: '2', staffGap: '6', systemGap: '12', totalSystems: '30' },
  { page: 'a5', orientation: 'portrait', topMargin: '12', bottomMargin: '12', staffSize: '11.22', staves: '2', staffGap: '6', systemGap: '12', totalSystems: '16' },
  { page: 'b4', orientation: 'portrait', topMargin: '18', bottomMargin: '18', staffSize: '20', staves: '3', staffGap: '8', systemGap: '16', totalSystems: '26' },
  { page: 'a4', orientation: 'portrait', topMargin: '20', bottomMargin: '20', staffSize: '25.2', staves: '1', staffGap: '6', systemGap: '12', totalSystems: '10' },
  { page: 'a4', orientation: 'portrait', topMargin: '15', bottomMargin: '15', staffSize: '20', staves: '2', staffGap: '6', systemGap: '0', totalSystems: '24' },
  { page: 'a4', orientation: 'portrait', topMargin: '15', bottomMargin: '15', staffSize: '8', staves: '1', staffGap: '0', systemGap: '0', totalSystems: '40' },
  { page: 'b4', orientation: 'portrait', topMargin: '15', bottomMargin: '15', staffSize: '32', staves: '1', staffGap: '0', systemGap: '0', totalSystems: '8' },
  { page: 'b4', orientation: 'portrait', topMargin: '15', bottomMargin: '15', staffSize: '8', staves: '24', staffGap: '6', systemGap: '12', totalSystems: '60' },
  { page: 'a4', orientation: 'portrait', topMargin: '0', bottomMargin: '0', staffSize: '20', staves: '2', staffGap: '6', systemGap: '12', totalSystems: '24' },
  { page: 'a4', orientation: 'portrait', topMargin: '15', bottomMargin: '15', staffSize: '20', staves: '2', staffGap: '6', systemGap: '12', totalSystems: '1' },
  { page: 'a4', orientation: 'portrait', topMargin: '15', bottomMargin: '15', staffSize: '20', staves: '2', staffGap: '40', systemGap: '60', totalSystems: '12' },
  { page: 'a5', orientation: 'landscape', topMargin: '10', bottomMargin: '10', staffSize: '14.14', staves: '2', staffGap: '5', systemGap: '10', totalSystems: '20' },
  { page: 'letter', orientation: 'landscape', topMargin: '12', bottomMargin: '20', staffSize: '17.82', staves: '3', staffGap: '7', systemGap: '14', totalSystems: '40' },
  { page: 'a4', orientation: 'portrait', topMargin: '33.5', bottomMargin: '7.5', staffSize: '19.5', staves: '3', staffGap: '5.5', systemGap: '13.5', totalSystems: '37' }
];
for (const input of sweep) {
  const expected = oracle(input);
  const actual = run(input);
  const label = input.page + ' ' + input.orientation + ' ' + input.staffSize + ' pt ' + input.staves + ' staves';
  assert.equal(actual.systemsPerPage, expected.per, 'systems per page: ' + label);
  assert.equal(actual.pages, expected.pages, 'pages: ' + label);
  assert.equal(actual.lastPageSystems, expected.last, 'last page: ' + label);
  near(actual.usableHeightMm, expected.usable, 1e-9, 'usable height: ' + label);
  near(actual.staffHeightMm, expected.staff, 1e-9, 'staff height: ' + label);
  near(actual.staffSpaceMm, expected.space, 1e-9, 'staff space: ' + label);
  near(actual.systemHeightMm, expected.block, 1e-9, 'system block: ' + label);
  near(actual.systemGapMm, expected.gap, 1e-9, 'system gap: ' + label);
  near(actual.systemPitchMm, expected.pitch, 1e-9, 'system pitch: ' + label);
  near(actual.usedHeightMm, expected.used, 1e-9, 'used height: ' + label);
  near(actual.leftoverMm, expected.leftover, 1e-9, 'leftover: ' + label);
  near(actual.fillPercent, expected.fill, 1e-9, 'fill: ' + label);
  assert.equal(actual.pageWidthMm, expected.width, 'page width: ' + label);
  assert.equal(actual.pageHeightMm, expected.height, 'page height: ' + label);
}

// ---- Invariants: the reported count is the largest that fits, and the page
// count is the smallest that holds every system.
for (const staffSize of ['8', '11.22', '14', '17.82', '20', '25.2', '32']) {
  for (const staves of ['1', '2', '3', '4', '8', '16', '24']) {
    for (const page of ['a4', 'a5', 'b4', 'letter']) {
      for (const orientation of ['portrait', 'landscape']) {
        const input = {
          page, orientation, topMargin: '12', bottomMargin: '18', staffSize, staves,
          staffGap: '6', systemGap: '12', totalSystems: '1'
        };
        let result;
        try { result = run(input); } catch (error) {
          assert.match(error.message, /taller than the/, 'only the too-tall refusal is expected here');
          continue;
        }
        const label = page + ' ' + orientation + ' ' + staffSize + ' pt ' + staves + ' staves';
        assert.ok(result.systemsPerPage >= 1, 'at least one system fits: ' + label);
        assert.ok(result.leftoverMm >= -1e-9, 'systems do not overrun the page: ' + label);
        assert.ok(result.leftoverMm < result.systemPitchMm + 1e-9,
          'no further system would fit: ' + label);
        assert.ok(result.usedHeightMm + result.leftoverMm - result.usableHeightMm < 1e-9,
          'used and leftover fill the printable height: ' + label);
        const capacity = result.systemsPerPage;
        assert.ok(capacity * result.systemHeightMm + (capacity - 1) * result.systemGapMm
          - result.usedHeightMm < 1e-9, 'used height is built from the block and gap: ' + label);
        // A taller page never holds fewer systems, and a taller staff never holds more.
        let taller;
        try { taller = run(Object.assign({}, input, { page: page === 'a5' ? 'a4' : 'b4' })); }
        catch (error) { taller = null; assert.match(error.message, /taller than the/, 'only the too-tall refusal is expected here'); }
        if (taller) {
          assert.ok(taller.systemsPerPage >= capacity || taller.usableHeightMm < result.usableHeightMm,
            'a taller page holds at least as many systems: ' + label);
        }
        let bigger;
        const biggerPt = Math.min(C.MAX_STAFF_PT, Number(staffSize) + 4);
        if (biggerPt > Number(staffSize)) {
          try { bigger = run(Object.assign({}, input, { staffSize: String(biggerPt) })); }
          catch (error) {
            assert.match(error.message, /taller than the/, 'only the too-tall refusal is expected here');
            bigger = null;
          }
          if (bigger) {
            assert.ok(bigger.systemsPerPage <= capacity,
              'a taller staff holds no more systems: ' + label + ' -> ' + bigger.systemsPerPage);
          }
        }
      }
    }
  }
}
for (const total of ['1', '2', '5', '6', '7', '13', '24', '999']) {
  const result = run(base({ totalSystems: total }));
  assert.equal(result.pages, Math.ceil(Number(total) / result.systemsPerPage), 'pages round up: ' + total);
  assert.ok(result.pages * result.systemsPerPage >= Number(total), 'pages hold every system: ' + total);
  assert.ok((result.pages - 1) * result.systemsPerPage < Number(total), 'no page beyond the last: ' + total);
  assert.equal(result.lastPageSystems, Number(total) - (result.pages - 1) * result.systemsPerPage,
    'last page count: ' + total);
  assert.ok(result.lastPageSystems >= 1 && result.lastPageSystems <= result.systemsPerPage,
    'last page is between one and a full page: ' + total);
}

// ---- Refusals, by exact message.
assert.equal(failure({ page: 'a3' }), 'Choose a paper size from the list.');
assert.equal(failure({ page: '' }), 'Choose a paper size from the list.');
assert.equal(failure({ orientation: 'sideways' }), 'Choose portrait or landscape.');
assert.equal(failure({ topMargin: '' }), 'Enter the top margin as a number of millimetres.');
assert.equal(failure({ topMargin: 'wide' }), 'Enter the top margin as a number of millimetres.');
assert.equal(failure({ topMargin: '-1' }), 'Enter a top margin from 0 to 100 mm.');
assert.equal(failure({ topMargin: '101' }), 'Enter a top margin from 0 to 100 mm.');
assert.equal(failure({ bottomMargin: '' }), 'Enter the bottom margin as a number of millimetres.');
assert.equal(failure({ bottomMargin: '150' }), 'Enter a bottom margin from 0 to 100 mm.');
assert.equal(failure({ page: 'a5', orientation: 'landscape', topMargin: '100', bottomMargin: '100' }),
  'The A5 page is 148 mm high, so these margins leave no printable height.');
assert.equal(failure({ staffSize: '' }), 'Enter the staff height in points as a number.');
assert.equal(failure({ staffSize: '7.9' }), 'Enter a staff height from 8 to 32 points.');
assert.equal(failure({ staffSize: '33' }), 'Enter a staff height from 8 to 32 points.');
assert.equal(failure({ staves: '' }), 'Enter the number of staves per system as a whole number.');
assert.equal(failure({ staves: '2.5' }), 'Enter the number of staves per system as a whole number.');
assert.equal(failure({ staves: '0' }), 'Enter 1 to 24 staves per system.');
assert.equal(failure({ staves: '25' }), 'Enter 1 to 24 staves per system.');
assert.equal(failure({ staffGap: '' }), 'Enter the gap between staves as a number of staff spaces.');
assert.equal(failure({ staffGap: '-1' }), 'Enter a gap from 0 to 40 staff spaces between staves.');
assert.equal(failure({ staffGap: '41' }), 'Enter a gap from 0 to 40 staff spaces between staves.');
assert.equal(failure({ systemGap: '' }), 'Enter the gap between systems as a number of staff spaces.');
assert.equal(failure({ systemGap: '61' }), 'Enter a gap from 0 to 60 staff spaces between systems.');
assert.equal(failure({ totalSystems: '' }), 'Enter the number of systems in the score as a whole number.');
assert.equal(failure({ totalSystems: '12.5' }), 'Enter the number of systems in the score as a whole number.');
assert.equal(failure({ totalSystems: '0' }), 'Enter 1 to 999 systems in the score.');
assert.equal(failure({ totalSystems: '1000' }), 'Enter 1 to 999 systems in the score.');
const tooTall = failure({ page: 'a5', staffSize: '32', staves: '24' });
assert.match(tooTall, /^One system with 24 staves at 32 pt is [\d.]+ mm tall, taller than the [\d.]+ mm printable height: reduce the staff height, the staves per system or the margins\.$/);

// ---- Catalog replay, at the precision each expectation is published to.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(entry.name, 'Score Page Layout Planner');
assert.equal(entry.category, 'Music');
assert.equal(entry.subcategory, 'Notation & Engraving');
assert.equal(entry.listed, true);
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.sources.length, 3, 'the staff size, the paper block and the paper sizes are cited');
assert.equal(entry.sources[0].url, 'https://lilypond.org/doc/v2.24/Documentation/notation/setting-the-staff-size');
assert.equal(entry.sources[1].url, 'https://lilypond.org/doc/v2.24/Documentation/notation/fixed-vertical-spacing-paper-variables');
assert.equal(entry.sources[2].url, 'https://en.wikipedia.org/wiki/ISO_216');
for (const source of entry.sources) {
  assert.ok(source.title && source.title.length > 40, 'source titles are specific');
  assert.ok(/^https:\/\//.test(source.url), 'sources are fetched over https');
}
assert.ok(entry.method && entry.method.length > 1200, 'the method explains the arithmetic and its limits');
assert.ok(entry.guidance && entry.guidance.length > 120 && entry.guidance.length < 500, 'the guidance fits the banner');
assert.ok(entry.testCases.length >= 30, 'enough catalog cases');
const kinds = (kind) => entry.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(kinds('golden'), 10);
assert.equal(kinds('boundary'), 6);
assert.equal(kinds('validation'), 27);

const closeEnough = (actual, expected, label) => {
  if (typeof expected !== 'number') {
    assert.deepEqual(actual, expected, label);
    return;
  }
  const decimals = (String(expected).split('.')[1] || '').length;
  const tolerance = 0.5 * Math.pow(10, -decimals) + 1e-9 * Math.max(1, Math.abs(expected));
  near(actual, expected, tolerance, label);
};
for (const testCase of entry.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(Object.assign({}, base({}), testCase.input));
  for (const [key, value] of Object.entries(testCase.expected)) {
    closeEnough(result[key], value, testCase.name + ' ' + key);
  }
}

// ---- Uniqueness: no other record claims this slug, name, alias or capability.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [entry.slug, entry.name].concat(entry.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'aliases are internally unique');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'tags are internally unique');
for (const tag of ['music', 'notation', 'engraving', 'page-layout', 'staff-size']) {
  assert.ok(entry.tags.includes(tag), 'tag present: ' + tag);
}
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  const haystack = [tool.slug, tool.name, tool.description, (tool.aliases || []).join(' '), (tool.tags || []).join(' ')]
    .join(' ').toLowerCase();
  assert.ok(!/systems per page|casting off|rastral|staff size|score page layout|sheet music page/.test(haystack),
    'no duplicate engraving record: ' + tool.slug);
}

// ---- The page stays self-contained, offline and keyboard accessible.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'no remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote styles');
assert.ok(html.includes('<form id="layout-form"'), 'form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('<div id="site-header"></div>'), 'shared header hook missing');
assert.ok(html.includes('<meta name="viewport"'), 'viewport meta missing');
const controls = [
  ['page', 'value="a4" selected'],
  ['orientation', 'value="portrait" selected'],
  ['top-margin', 'value="15"'],
  ['bottom-margin', 'value="15"'],
  ['staff-size', 'value="20"'],
  ['staves', 'value="2"'],
  ['staff-gap', 'value="6"'],
  ['system-gap', 'value="12"'],
  ['total-systems', 'value="24"']
];
for (const [id, needle] of controls) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id + ' missing');
  assert.ok(html.includes(needle), 'default for ' + id + ' missing: ' + needle);
}
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(!/type="hidden"/i.test(html), 'no hidden inputs');
assert.ok((html.match(/<button /g) || []).length === 2, 'two buttons');
assert.ok(!/autocomplete="on"/.test(html), 'inputs are not autocompleted');
assert.ok(html.includes('LilyPond'), 'the note names the reference');
assert.ok(html.includes('2540/7227'), 'the note gives the point definition');
assert.ok(html.includes('No network request is made'), 'the note states the offline contract');

console.log('score page layout planner: ' + entry.testCases.length + ' catalog cases, '
  + sweep.length + ' exact-oracle cases and the refusal table pass');
