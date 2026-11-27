/* Japanese era date converter: an independent era table, ICU's
   ja-JP-u-ca-japanese calendar as a second reference, a full sweep of the
   supported civil window, catalog replay and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'japanese-era-date-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* japanese-era-core:start */';
const endMarker = '/* japanese-era-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = JapaneseEraCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.compute(input));
const failure = (input) => {
  try { C.compute(input); } catch (error) { return error.message; }
  return null;
};

// ---- An independent oracle: the five eras as published date ranges, held in
// day numbers from 1970-01-01 rather than the page's own civil-day counter.
const PUBLISHED = [
  // key, name, kanji, short letter, first civil year, first day, last day
  ['meiji', 'Meiji', '\u660E\u6CBB', 'M', 1868, '1868-10-23', '1912-07-29'],
  ['taisho', 'Taish\u014D', '\u5927\u6B63', 'T', 1912, '1912-07-30', '1926-12-24'],
  ['showa', 'Sh\u014Dwa', '\u662D\u548C', 'S', 1926, '1926-12-25', '1989-01-07'],
  ['heisei', 'Heisei', '\u5E73\u6210', 'H', 1989, '1989-01-08', '2019-04-30'],
  ['reiwa', 'Reiwa', '\u4EE4\u548C', 'R', 2019, '2019-05-01', null]
];
const EPOCH = Date.UTC(1970, 0, 1);
const utcDay = (year, month, day) => Math.round((Date.UTC(year, month - 1, day) - EPOCH) / 86400000);
const isoDay = (iso) => {
  const [year, month, day] = iso.split('-').map(Number);
  return utcDay(year, month, day);
};
// The page counts from 1 January of year 1; 1970-01-01 is day 719163 there.
assert.equal(utcDay(1970, 1, 1), 0);
assert.equal(C.gregorianToFixed(1970, 1, 1), 719163);
const CIVIL_OFFSET = 719163;

const SPANS = PUBLISHED.map(([key, , , , firstYear, from, to]) => ({
  key,
  firstYear,
  start: isoDay(from),
  end: to ? isoDay(to) : Infinity
}));
function oracleEra(day) {
  for (let i = SPANS.length - 1; i >= 0; i -= 1) {
    if (day >= SPANS[i].start && day <= SPANS[i].end) return SPANS[i];
  }
  throw new Error('no era on day ' + day);
}

// ---- The page's table must be the published one, field for field.
assert.equal(C.ERAS.length, PUBLISHED.length);
for (let i = 0; i < PUBLISHED.length; i += 1) {
  const [key, name, kanji, letter, firstYear, from, to] = PUBLISHED[i];
  const era = C.ERAS[i];
  assert.equal(era.key, key);
  assert.equal(era.name, name);
  assert.equal(era.kanji, kanji);
  assert.equal(era.abbrev, letter);
  assert.equal(era.firstYear, firstYear);
  assert.equal(era.startIso, from);
  assert.equal(era.endIso, to);
}
assert.equal(C.MIN_YEAR, 1873);
assert.equal(C.MAX_YEAR, 2100);
// Meiji is only reachable from 1 January 1873 (Meiji 6), and Reiwa runs to 2100.
assert.equal(C.ERAS[0].minYear, 6);
assert.equal(C.ERAS[0].maxYear, 45);
assert.equal(C.ERAS[4].maxYear, 2100 - 2019 + 1);
assert.equal(C.ERAS[4].maxYear, 82);

// The page's era lookup agrees with the oracle table on every boundary day.
for (const span of SPANS) {
  const first = C.eraAt(span.start + CIVIL_OFFSET);
  assert.equal(C.ERAS[first].key, span.key, 'era opening day of ' + span.key);
  if (span.end !== Infinity) {
    assert.equal(C.ERAS[C.eraAt(span.end + CIVIL_OFFSET)].key, span.key, 'era closing day of ' + span.key);
    assert.notEqual(C.ERAS[C.eraAt(span.end + 1 + CIVIL_OFFSET)].key, span.key, 'day after ' + span.key);
  }
}

// ---- Every civil day of the window, checked against the oracle and ICU.
const firstDay = utcDay(1873, 1, 1);
const lastDay = utcDay(2100, 12, 31);
const icu = new Intl.DateTimeFormat('ja-JP-u-ca-japanese', {
  era: 'long', year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC'
});
const ICU_ERAS = { '\u660E\u6CBB': 'meiji', '\u5927\u6B63': 'taisho', '\u662D\u548C': 'showa', '\u5E73\u6210': 'heisei', '\u4EE4\u548C': 'reiwa' };
let days = 0;
let icuDays = 0;
for (let day = firstDay; day <= lastDay; day += 1) {
  const fixed = day + CIVIL_OFFSET;
  const civil = plain(C.fixedToGregorian(fixed));
  assert.equal(C.gregorianToFixed(civil.year, civil.month, civil.day), fixed);
  const expected = oracleEra(day);
  const eraYear = civil.year - expected.firstYear + 1;
  const eraDef = C.ERAS.find((era) => era.key === expected.key);
  const result = run({ direction: 'g2e', date: C.isoDate(civil) });
  assert.equal(result.eraKey, expected.key, 'era at ' + result.gregorianIso);
  assert.equal(result.eraYear, eraYear, 'era year at ' + result.gregorianIso);
  assert.equal(result.eraText, eraDef.name + ' ' + eraYear + ' (' + eraDef.kanji + ' ' + eraYear + ')');
  assert.equal(result.gannen, eraYear === 1, 'gannen at ' + result.gregorianIso);
  assert.equal(result.shortForm, eraDef.abbrev + eraYear, 'short form at ' + result.gregorianIso);
  assert.equal(result.weekday, ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(day * 86400000).getUTCDay()]);
  assert.equal(result.dayOfYear, day - utcDay(civil.year, 1, 1) + 1);
  assert.equal(result.yearLength, (civil.year % 4 === 0 && civil.year % 100 !== 0) || civil.year % 400 === 0 ? 366 : 365);
  const back = run({ direction: 'e2g', era: result.eraKey, year: String(eraYear), month: String(civil.month), day: String(civil.day) });
  assert.equal(back.gregorianIso, result.gregorianIso, 'round trip at ' + result.gregorianIso);
  assert.equal(back.eraYear, eraYear);
  // The split-year note names the other era year only when the civil year holds two.
  const twoEras = SPANS.filter((span) => span.firstYear === civil.year
    || (span.end !== Infinity && new Date(span.end * 86400000).getUTCFullYear() === civil.year));
  if (twoEras.length < 2) {
    assert.equal(result.splitNote, '', 'no split note in ' + civil.year);
  } else {
    assert.ok(result.splitNote.includes(String(civil.year) + ' also carries'), 'split note in ' + civil.year);
  }
  if (icu.resolvedOptions().calendar === 'japanese') {
    const date = new Date(day * 86400000);
    const parts = {};
    for (const part of icu.formatToParts(date)) parts[part.type] = part.value;
    assert.equal(ICU_ERAS[parts.era], expected.key, 'ICU era at ' + result.gregorianIso);
    assert.equal(Number(parts.year), eraYear, 'ICU era year at ' + result.gregorianIso);
    assert.equal(Number(parts.month), civil.month, 'ICU month at ' + result.gregorianIso);
    assert.equal(Number(parts.day), civil.day, 'ICU day at ' + result.gregorianIso);
    icuDays += 1;
  }
  days += 1;
}
assert.equal(days, lastDay - firstDay + 1);
assert.equal(days, 83275);

// ---- Published anchors, including every era change inside the window.
const anchors = [
  // iso, era text, short form, era year label, weekday, gannen, split note
  ['1873-01-01', 'Meiji 6 (\u660E\u6CBB 6)', 'M6', '6 of Meiji', 'Wednesday', false, ''],
  ['1912-07-29', 'Meiji 45 (\u660E\u6CBB 45)', 'M45', '45 of Meiji', 'Monday', false, '1912 also carries Taish\u014D 1.'],
  ['1912-07-30', 'Taish\u014D 1 (\u5927\u6B63 1)', 'T1', '1 of Taish\u014D (gannen, \u5143\u5E74)', 'Tuesday', true, '1912 also carries Meiji 45.'],
  ['1926-12-24', 'Taish\u014D 15 (\u5927\u6B63 15)', 'T15', '15 of Taish\u014D', 'Friday', false, '1926 also carries Sh\u014Dwa 1.'],
  ['1926-12-25', 'Sh\u014Dwa 1 (\u662D\u548C 1)', 'S1', '1 of Sh\u014Dwa (gannen, \u5143\u5E74)', 'Saturday', true, '1926 also carries Taish\u014D 15.'],
  ['1989-01-07', 'Sh\u014Dwa 64 (\u662D\u548C 64)', 'S64', '64 of Sh\u014Dwa', 'Saturday', false, '1989 also carries Heisei 1.'],
  ['1989-01-08', 'Heisei 1 (\u5E73\u6210 1)', 'H1', '1 of Heisei (gannen, \u5143\u5E74)', 'Sunday', true, '1989 also carries Sh\u014Dwa 64.'],
  ['2019-04-30', 'Heisei 31 (\u5E73\u6210 31)', 'H31', '31 of Heisei', 'Tuesday', false, '2019 also carries Reiwa 1.'],
  ['2019-05-01', 'Reiwa 1 (\u4EE4\u548C 1)', 'R1', '1 of Reiwa (gannen, \u5143\u5E74)', 'Wednesday', true, '2019 also carries Heisei 31.'],
  ['2026-11-27', 'Reiwa 8 (\u4EE4\u548C 8)', 'R8', '8 of Reiwa', 'Friday', false, ''],
  ['2100-12-31', 'Reiwa 82 (\u4EE4\u548C 82)', 'R82', '82 of Reiwa', 'Friday', false, '']
];
for (const [iso, text, shortForm, detail, weekday, gannen, splitNote] of anchors) {
  const result = run({ direction: 'g2e', date: iso });
  assert.equal(result.eraText, text, iso);
  assert.equal(result.shortForm, shortForm, iso);
  assert.equal(result.eraDetail, detail, iso);
  assert.equal(result.weekday, weekday, iso);
  assert.equal(result.gannen, gannen, iso);
  assert.equal(result.splitNote, splitNote, iso);
  assert.equal(result.gregorianIso, iso);
  assert.equal(result.eraStartIso, C.ERAS.find((era) => era.key === result.eraKey).startIso, iso);
  assert.equal(result.direction, 'g2e');
}

// ---- Era names are accepted in the spellings and letters the form offers.
const spellings = [
  ['meiji', 'meiji'], ['Meiji', 'meiji'], ['\u660E\u6CBB', 'meiji'], ['M', 'meiji'],
  ['taisho', 'taisho'], ['Taish\u014D', 'taisho'], ['taishou', 'taisho'], ['\u5927\u6B63', 'taisho'],
  ['showa', 'showa'], ['Sh\u014Dwa', 'showa'], ['SH\u014CWA', 'showa'], ['\u662D\u548C', 'showa'],
  ['heisei', 'heisei'], ['\u5E73\u6210', 'heisei'], ['reiwa', 'reiwa'], ['\u4EE4\u548C', 'reiwa'], ['R', 'reiwa']
];
for (const [name, key] of spellings) {
  const result = run({ direction: 'e2g', era: name, year: '10', month: '6', day: '1' });
  assert.equal(result.eraKey, key, name);
}
// Month names are accepted beside numbers in the era form.
assert.equal(run({ direction: 'e2g', era: 'reiwa', year: '8', month: 'November', day: '27' }).gregorianIso, '2026-11-27');
assert.equal(run({ direction: 'e2g', era: 'reiwa', year: '8', month: '11', day: '27' }).gregorianIso, '2026-11-27');

// ---- Refusals, pinned by exact message.
const problems = [
  [{ direction: 'g2e', date: '' }, 'Enter a Gregorian date.'],
  [{ direction: 'g2e', date: '   ' }, 'Enter a Gregorian date.'],
  [{ direction: 'g2e', date: '27/11/2026' }, 'Enter the date as YYYY-MM-DD.'],
  [{ direction: 'g2e', date: '2026-2-3' }, 'Enter the date as YYYY-MM-DD.'],
  [{ direction: 'g2e', date: '2026-13-01' }, 'Enter a month from 01 to 12.'],
  [{ direction: 'g2e', date: '2026-02-29' }, 'Enter a real calendar day for that month.'],
  [{ direction: 'g2e', date: '2026-04-31' }, 'Enter a real calendar day for that month.'],
  [{ direction: 'g2e', date: '1872-12-31' }, 'Japanese era dates start on 1 January 1873 (Meiji 6), when Japan adopted the Gregorian calendar.'],
  [{ direction: 'g2e', date: '2101-01-01' }, 'Enter a year from 1873 to 2100.'],
  [{ direction: 'e2g', era: '', year: '8', month: '1', day: '1' }, 'Choose a Japanese era.'],
  [{ direction: 'e2g', era: 'edo', year: '8', month: '1', day: '1' }, 'Choose a Japanese era.'],
  [{ direction: 'e2g', era: 'meiji', year: '5', month: '1', day: '1' }, 'Enter a year from 6 to 45 for the Meiji era.'],
  [{ direction: 'e2g', era: 'taisho', year: '16', month: '1', day: '1' }, 'Enter a year from 1 to 15 for the Taish\u014D era.'],
  [{ direction: 'e2g', era: 'showa', year: '65', month: '1', day: '1' }, 'Enter a year from 1 to 64 for the Sh\u014Dwa era.'],
  [{ direction: 'e2g', era: 'reiwa', year: '83', month: '1', day: '1' }, 'Enter a year from 1 to 82 for the Reiwa era.'],
  [{ direction: 'e2g', era: 'reiwa', year: '', month: '1', day: '1' }, 'Enter the era year, such as 8.'],
  [{ direction: 'e2g', era: 'reiwa', year: '8.5', month: '1', day: '1' }, 'Enter the era year as a whole number, such as 8.'],
  [{ direction: 'e2g', era: 'reiwa', year: 'eight', month: '1', day: '1' }, 'Enter the era year as a whole number, such as 8.'],
  [{ direction: 'e2g', era: 'reiwa', year: '8', month: '', day: '1' }, 'Enter the month.'],
  [{ direction: 'e2g', era: 'reiwa', year: '8', month: '13', day: '1' }, 'Enter a month from 01 to 12.'],
  [{ direction: 'e2g', era: 'reiwa', year: '8', month: '11', day: '' }, 'Enter the day of the month.'],
  [{ direction: 'e2g', era: 'reiwa', year: '8', month: '11', day: '31' }, 'Enter a day from 1 to 30 in November 2026.'],
  [{ direction: 'e2g', era: 'reiwa', year: '8', month: '2', day: '29' }, 'Enter a day from 1 to 28 in February 2026.'],
  [{ direction: 'e2g', era: 'taisho', year: '1', month: '7', day: '29' }, 'Taish\u014D 1 began on 30 July 1912.'],
  [{ direction: 'e2g', era: 'showa', year: '64', month: '1', day: '8' }, 'Sh\u014Dwa 64 ended on 7 January 1989.'],
  [{ direction: 'e2g', era: 'meiji', year: '45', month: '12', day: '1' }, 'Meiji 45 ended on 29 July 1912.'],
  [{ direction: 'e2g', era: 'heisei', year: '31', month: '5', day: '1' }, 'Heisei 31 ended on 30 April 2019.']
];
for (const [input, message] of problems) {
  assert.equal(failure(input), message, JSON.stringify(input));
}

// A leap day is accepted in a leap year and refused in a common one.
assert.equal(run({ direction: 'e2g', era: 'reiwa', year: '2', month: '2', day: '29' }).gregorianIso, '2020-02-29');
assert.equal(failure({ direction: 'e2g', era: 'reiwa', year: '3', month: '2', day: '29' }), 'Enter a day from 1 to 28 in February 2021.');

// ---- Catalog replay.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(entry.name, 'Japanese Era Date Converter');
assert.equal(entry.category, 'Time');
assert.equal(entry.subcategory, 'Conversion');
assert.equal(entry.listed, true);
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.sources.length, 3, 'every converted rule is cited');
assert.equal(entry.sources[0].url, 'https://en.wikipedia.org/wiki/Japanese_era_name');
assert.equal(entry.sources[1].url, 'https://en.wikipedia.org/wiki/Japanese_calendar');
assert.equal(entry.sources[2].url, 'https://unicode-org.github.io/icu/userguide/datetime/calendar/');
for (const source of entry.sources) {
  assert.ok(source.title && source.title.length > 20, 'source titles are specific');
  assert.ok(/^https:\/\//.test(source.url), 'sources are fetched over https');
}
assert.ok(entry.method && entry.method.length > 800, 'the method explains the rule');
assert.ok(entry.guidance && entry.guidance.length > 150, 'the guidance states the limits');
assert.ok(entry.testCases.length >= 20, 'enough catalog cases');
const kinds = (kind) => entry.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(kinds('golden'), 9);
assert.equal(kinds('boundary'), 6);
assert.equal(kinds('validation'), 14);
for (const testCase of entry.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], value, testCase.name + ' ' + key);
  }
}

// ---- Uniqueness: no other record claims this slug, name or alias.
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
for (const tag of ['time', 'calendar', 'japanese', 'era', 'gengo', 'nengo', 'reiwa', 'conversion']) {
  assert.ok(entry.tags.includes(tag), 'new tag present: ' + tag);
}
// No other tool already labels Gregorian dates with a Japanese era.
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  const haystack = [tool.slug, tool.name, tool.description, (tool.aliases || []).join(' '), (tool.tags || []).join(' ')]
    .join(' ').toLowerCase();
  assert.ok(!/japanese era|japanese calendar|japanese year|reiwa|heisei|showa|taisho|gengo|nengo|\u548C\u66A6/.test(haystack),
    'no duplicate: ' + tool.slug);
}

// ---- The page stays self-contained, offline and keyboard accessible.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="era-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('<div id="site-header"></div>'), 'shared header hook missing');
assert.ok(html.includes('type="date" min="1873-01-01" max="2100-12-31"'), 'the date input states the supported window');
const controls = ['greg-date', 'era-name', 'era-year', 'era-month', 'era-day'];
for (const id of controls) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id + ' missing');
}
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
assert.ok(!/type="hidden"/i.test(html), 'no hidden inputs');
assert.ok((html.match(/<button /g) || []).length === 3, 'three buttons');
assert.ok(!/autocomplete="on"/.test(html), 'inputs are not autocompleted');
assert.ok(/name="direction" value="g2e" checked/.test(html), 'directions are labelled');

console.log('japanese era date converter: ' + entry.testCases.length + ' catalog cases, '
  + days + ' civil days swept, ' + icuDays + ' ICU comparisons, '
  + anchors.length + ' anchors and ' + problems.length + ' refusals pass');
