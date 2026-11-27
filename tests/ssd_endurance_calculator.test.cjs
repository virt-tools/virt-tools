/* SSD endurance calculator: the published TBW/DWPD identity re-implemented
   independently, both vendor tables replayed, a conversion round trip, the
   exact-rating boundary, catalog replay and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ssd-endurance-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* ssd-endurance-core:start */';
const endMarker = '/* ssd-endurance-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SsdEnduranceCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.compute(input));
const failure = (input) => {
  try { C.compute(input); } catch (error) { return error.message; }
  return null;
};
const base = (overrides) => Object.assign({
  capacity: '3.84', capacityUnit: 'TB', ratingMode: 'dwpd', rating: '1', years: '5', dailyWritesGb: '700'
}, overrides);
const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected} (tolerance ${tolerance})`);
};

// ---- The identity, written out here rather than taken from the page:
// TBW = DWPD x capacity(TB) x 365 x years.
const DAYS = 365;
const identity = (dwpd, capacityTb, years) => dwpd * capacityTb * DAYS * years;

assert.equal(C.DAYS_PER_YEAR, 365);
assert.equal(C.MAX_CAPACITY_GB, 100000);
assert.equal(C.MAX_YEARS, 10);
assert.equal(C.MAX_TBW, 1000000);
assert.equal(C.MAX_DWPD, 1000);

// ---- Western Digital's published SN640 tables, replayed to their precision.
const wdRows = [
  // DW/D, years, capacity GB, total PBW as printed
  [0.8, 5, 960, 1.40], [0.8, 5, 1920, 2.80], [0.8, 5, 3840, 5.61], [0.8, 5, 7680, 11.21],
  [2, 5, 800, 2.92], [2, 5, 1600, 5.84], [2, 5, 3200, 11.68], [2, 5, 6400, 23.36],
  [1.3, 3, 960, 1.37], [1.3, 3, 1920, 2.73], [1.3, 3, 3840, 5.47], [1.3, 3, 7680, 10.93]
];
for (const [dwpd, years, capacityGb, publishedPbw] of wdRows) {
  const expected = identity(dwpd, capacityGb / 1000, years) / 1000;
  near(expected, publishedPbw, 0.005, `the published row ${capacityGb} GB ${dwpd} DW/D ${years} y`);
  const result = run(base({
    capacity: String(capacityGb), capacityUnit: 'GB', ratingMode: 'dwpd',
    rating: String(dwpd), years: String(years), dailyWritesGb: '1'
  }));
  near(result.ratedTbw, expected * 1000, 1e-9 * expected * 1000, `the page on ${capacityGb} GB ${dwpd} DW/D ${years} y`);
  near(result.ratedDwpd, dwpd, 1e-12, 'the rating is reported unchanged in DWPD mode');
}

// ---- Samsung's published ratings: 800 GB at 10 DWPD for five years is 14,600 TBW,
// and the 845DC EVO line holds one DWPD figure across capacities (960 GB = 600 TBW).
const pro = run(base({ capacity: '800', capacityUnit: 'GB', ratingMode: 'dwpd', rating: '10', years: '5', dailyWritesGb: '2000' }));
near(pro.ratedTbw, 14600, 1e-9, 'Samsung 845DC PRO 800 GB at 10 DWPD for five years');
const evo = run(base({ capacity: '960', capacityUnit: 'GB', ratingMode: 'tbw', rating: '600', years: '5', dailyWritesGb: '1' }));
near(evo.ratedDwpd, 600 / (0.96 * DAYS * 5), 1e-12, 'Samsung 845DC EVO 960 GB at 600 TBW');
const evoSmall = run(base({ capacity: '240', capacityUnit: 'GB', ratingMode: 'tbw', rating: '150', years: '5', dailyWritesGb: '1' }));
near(evoSmall.ratedDwpd, evo.ratedDwpd, 1e-12, 'the EVO 240 GB row carries the same DWPD figure');

// ---- Converting either way and back returns the same rating.
const capacitiesTb = [0.001, 0.096, 0.24, 0.48, 0.96, 1.92, 3.84, 7.68, 15.36, 100];
const ratings = [0.01, 0.1, 0.3, 0.8, 1, 3, 10, 1000];
for (const capacityTb of capacitiesTb) {
  for (const dwpd of ratings) {
    for (const years of [1, 3, 5, 10]) {
      const tbw = identity(dwpd, capacityTb, years);
      if (tbw < C.MIN_TBW || tbw > C.MAX_TBW) continue;
      const fromDwpd = run(base({
        capacity: String(capacityTb * 1000), capacityUnit: 'GB', ratingMode: 'dwpd',
        rating: String(dwpd), years: String(years), dailyWritesGb: '1'
      }));
      near(fromDwpd.ratedTbw, tbw, 1e-9 * Math.max(1, tbw), 'TBW from DWPD');
      const fromTbw = run(base({
        capacity: String(capacityTb * 1000), capacityUnit: 'GB', ratingMode: 'tbw',
        rating: String(tbw), years: String(years), dailyWritesGb: '1'
      }));
      near(fromTbw.ratedDwpd, dwpd, 1e-9 * Math.max(1, dwpd), 'DWPD from TBW');
      near(fromTbw.ratedTbw, fromDwpd.ratedTbw, 1e-9 * Math.max(1, tbw), 'round trip');
    }
  }
}

// ---- The write budget, the annual writes and the projection follow from the rating.
for (const daily of [0.1, 1, 50, 700, 3650, 100000]) {
  const result = run(base({ dailyWritesGb: String(daily) }));
  near(result.dailyBudgetGb, result.ratedTbw * 1000 / (DAYS * result.years), 1e-9 * result.dailyBudgetGb, 'daily budget');
  near(result.annualWritesTb, daily * DAYS / 1000, 1e-12 * Math.max(1, daily), 'annual writes');
  near(result.projectedYears, result.ratedTbw / result.annualWritesTb, 1e-12 * result.projectedYears, 'projected life');
  near(result.sharePerYearPct, 100 / result.projectedYears, 1e-12 * result.sharePerYearPct, 'share per year');
  near(result.actualDwpd, daily / result.capacityGb, 1e-12, 'actual DWPD');
  near(result.warrantySharePct, 100 / result.projectedYears * result.years, 1e-12 * result.warrantySharePct, 'share used by the rated period');
}

// ---- The boundary between covered and past the rating is the rated day itself.
const exact = run(base({ capacity: '1', capacityUnit: 'TB', ratingMode: 'dwpd', rating: '1', years: '1', dailyWritesGb: '1000' }));
near(exact.projectedYears, 1, 1e-12, 'writes exactly at the rating last exactly the rated period');
assert.equal(exact.withinRating, true, 'exactly at the rating is covered');
assert.equal(exact.sharePerYearPct, 100);
const above = run(base({ capacity: '1', capacityUnit: 'TB', ratingMode: 'dwpd', rating: '1', years: '1', dailyWritesGb: '1001' }));
assert.ok(above.projectedYears < 1, 'one GB a day more falls short of the rated period');
assert.equal(above.withinRating, false, 'above the rating is not covered');
assert.ok(above.warrantySharePct > 100, 'the rated period would use more than the rating');

// ---- Documented ranges: the extremes are accepted and one step outside is refused.
const lowest = run(base({ capacity: '1', capacityUnit: 'GB', ratingMode: 'dwpd', rating: '0.01', years: '1', dailyWritesGb: '0.1' }));
near(lowest.ratedTbw, identity(0.01, 0.001, 1), 1e-12, 'lowest supported capacity and rating');
const highest = run(base({ capacity: '100', capacityUnit: 'TB', ratingMode: 'dwpd', rating: '1000', years: '10', dailyWritesGb: '1000000' }));
near(highest.ratedTbw, identity(1000, 100, 10), 1e-9, 'highest supported capacity and rating');
assert.equal(highest.withinRating, true);

// ---- Refusals, pinned by exact message.
const problems = [
  [base({ capacity: '' }), 'Enter the drive capacity.'],
  [base({ capacity: '   ' }), 'Enter the drive capacity.'],
  [base({ capacity: '3.84 TB' }), 'Enter the capacity in GB or TB as a number.'],
  [base({ capacity: '-3.84' }), 'Enter the capacity in GB or TB as a number.'],
  [base({ capacity: '0.5', capacityUnit: 'GB' }), 'Enter a capacity from 1 GB to 100,000 GB (100 TB).'],
  [base({ capacity: '1000', capacityUnit: 'TB' }), 'Enter a capacity from 1 GB to 100,000 GB (100 TB).'],
  [base({ capacityUnit: 'MB' }), 'Choose GB or TB for the capacity.'],
  [base({ ratingMode: 'pbw' }), 'Choose TBW or DWPD as the rating.'],
  [base({ rating: '' }), 'Enter the endurance rating.'],
  [base({ rating: 'one' }), 'Enter the endurance rating as a number.'],
  [base({ ratingMode: 'tbw', rating: '0' }), 'Enter a TBW rating from 1 to 1,000,000 TB.'],
  [base({ ratingMode: 'tbw', rating: '1000001' }), 'Enter a TBW rating from 1 to 1,000,000 TB.'],
  [base({ ratingMode: 'dwpd', rating: '0.001' }), 'Enter a DWPD rating from 0.01 to 1,000.'],
  [base({ ratingMode: 'dwpd', rating: '1001' }), 'Enter a DWPD rating from 0.01 to 1,000.'],
  [base({ years: '' }), 'Enter the rated period in years.'],
  [base({ years: '2.5' }), 'Enter the rated period as a whole number of years.'],
  [base({ years: '0' }), 'Enter a rated period from 1 to 10 years.'],
  [base({ years: '11' }), 'Enter a rated period from 1 to 10 years.'],
  [base({ dailyWritesGb: '' }), 'Enter the daily host writes.'],
  [base({ dailyWritesGb: 'lots' }), 'Enter the daily host writes in GB per day as a number.'],
  [base({ dailyWritesGb: '0.05' }), 'Enter daily host writes from 0.1 to 1,000,000 GB per day.'],
  [base({ dailyWritesGb: '2000000' }), 'Enter daily host writes from 0.1 to 1,000,000 GB per day.']
];
for (const [input, message] of problems) {
  assert.equal(failure(input), message, JSON.stringify(input));
}

// A comma-grouped entry is accepted, and GB/TBW spellings are case-insensitive.
assert.equal(run(base({ capacity: '3,840', capacityUnit: 'gb', ratingMode: 'TBW', rating: '7,008' })).ratedTbw, 7008);
assert.equal(run(base({ capacityUnit: 'tb' })).capacityGb, 3840);

// ---- Catalog replay, at the precision each expectation is published to.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(entry.name, 'SSD Endurance & Write Budget Calculator');
assert.equal(entry.category, 'IT & Networking');
assert.equal(entry.subcategory, 'Storage');
assert.equal(entry.listed, true);
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.sources.length, 3, 'the identity and the workload are cited');
assert.equal(entry.sources[0].url, 'https://documents.sandisk.com/content/dam/asset-library/en_us/assets/public/western-digital/collateral/tech-brief/tech-brief-ssd-endurance-explained.pdf');
assert.equal(entry.sources[1].url, 'https://semiconductor.samsung.com/resources/others/Samsung_SSD_845DC_02_Endurance_of_the_SSD_for_data_centers.pdf');
assert.equal(entry.sources[2].url, 'https://www.jedec.org/standards-documents/docs/jesd219a');
for (const source of entry.sources) {
  assert.ok(source.title && source.title.length > 40, 'source titles are specific');
  assert.ok(/^https:\/\//.test(source.url), 'sources are fetched over https');
}
assert.ok(entry.method && entry.method.length > 1500, 'the method explains the identity and its limits');
assert.ok(entry.guidance && entry.guidance.length > 200 && entry.guidance.length < 500, 'the guidance fits the banner');
assert.ok(entry.testCases.length >= 30, 'enough catalog cases');
const kinds = (kind) => entry.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(kinds('golden'), 8);
assert.equal(kinds('boundary'), 6);
assert.equal(kinds('validation'), 20);

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
  const result = run(testCase.input);
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
for (const tag of ['storage', 'ssd', 'endurance', 'tbw', 'dwpd', 'drive-writes-per-day']) {
  assert.ok(entry.tags.includes(tag), 'tag present: ' + tag);
}
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  const haystack = [tool.slug, tool.name, tool.description, (tool.aliases || []).join(' '), (tool.tags || []).join(' ')]
    .join(' ').toLowerCase();
  assert.ok(!/\btbw\b|\bdwpd\b|drive writes per day|terabytes written|write amplification|ssd endurance/.test(haystack),
    'no duplicate endurance record: ' + tool.slug);
}

// ---- The page stays self-contained, offline and keyboard accessible.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="endurance-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('<div id="site-header"></div>'), 'shared header hook missing');
const controls = [
  ['capacity', 'value="3.84"'],
  ['capacity-unit', '<option value="TB" selected>'],
  ['rating-mode', '<option value="dwpd" selected>'],
  ['rating', 'value="1"'],
  ['years', 'value="5"'],
  ['daily-writes', 'value="700"']
];
for (const [id, needle] of controls) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id + ' missing');
  assert.ok(html.includes(needle), 'default for ' + id + ' missing: ' + needle);
}
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
assert.ok(!/type="hidden"/i.test(html), 'no hidden inputs');
assert.ok((html.match(/<button /g) || []).length === 2, 'two buttons');
assert.ok(!/autocomplete="on"/.test(html), 'inputs are not autocompleted');
assert.ok(html.includes('TBW = DWPD x capacity x 365 x years'), 'the note states the identity');
assert.ok(html.includes('S.M.A.R.T.'), 'the note points at the drive counter');

console.log('ssd endurance calculator: ' + entry.testCases.length + ' catalog cases, '
  + wdRows.length + ' published Western Digital rows, 3 Samsung rows, '
  + (capacitiesTb.length * ratings.length * 4) + ' round-trip combinations and '
  + problems.length + ' refusals pass');
