/* Persian calendar converter: an independent 33-year-cycle oracle, ICU's
   ca-persian calendar as a second reference, a full sweep of the supported
   civil window, catalog replay and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'persian-calendar-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* persian-calendar-core:start */';
const endMarker = '/* persian-calendar-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PersianCalendarCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.compute(input));
const failure = (input) => {
  try { C.compute(input); } catch (error) { return error.message; }
  return null;
};

// ---- An independent oracle: leap positions by residue, a cycle prefix and a
// binary search for the year, anchored at a Nowruz that is written out here.
const LEAP_RESIDUES = new Set([1, 5, 9, 13, 17, 22, 26, 30]);
const CYCLE_PREFIX = [0];
for (let position = 1; position <= 33; position += 1) {
  CYCLE_PREFIX.push(CYCLE_PREFIX[position - 1] + (LEAP_RESIDUES.has(position) ? 366 : 365));
}
assert.equal(CYCLE_PREFIX[33], 12053);
const ANCHOR_YEAR = 1400;
const ANCHOR_DAY = Date.UTC(2021, 2, 21) / 86400000 + 719163;

function oracleLeap(year) {
  return LEAP_RESIDUES.has(((year % 33) + 33) % 33);
}

// Leap years among 1..year, from whole cycles plus a prefix of the residue set.
const CYCLE_LEAP_PREFIX = [0];
for (let position = 1; position <= 33; position += 1) {
  CYCLE_LEAP_PREFIX.push(CYCLE_LEAP_PREFIX[position - 1] + (LEAP_RESIDUES.has(position) ? 1 : 0));
}
assert.equal(CYCLE_LEAP_PREFIX[33], 8);

function oracleLeapCount(year) {
  if (year < 1) return 0;
  return Math.floor(year / 33) * 8 + CYCLE_LEAP_PREFIX[year % 33];
}

function oracleNowruz(year) {
  return ANCHOR_DAY + 365 * (year - ANCHOR_YEAR)
    + (oracleLeapCount(year - 1) - oracleLeapCount(ANCHOR_YEAR - 1));
}

function oracleToFixed(year, month, day) {
  const offset = month <= 7 ? 31 * (month - 1) : 186 + 30 * (month - 7);
  return oracleNowruz(year) + offset + day - 1;
}

function oracleFromFixed(fixed) {
  let low = 1000;
  let high = 1700;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (oracleNowruz(middle) <= fixed) low = middle;
    else high = middle - 1;
  }
  let offset = fixed - oracleNowruz(low);
  for (let month = 1; month <= 12; month += 1) {
    const length = month <= 6 ? 31 : month <= 11 ? 30 : (oracleLeap(low) ? 30 : 29);
    if (offset < length) return { year: low, month: month, day: offset + 1 };
    offset -= length;
  }
  throw new Error('oracle month did not resolve');
}

// The oracle's own cycle arithmetic must be self-consistent before it is used.
assert.equal(oracleNowruz(1400), C.gregorianToFixed(2021, 3, 21));
assert.equal(oracleNowruz(1401) - oracleNowruz(1400), 365);
assert.equal(oracleNowruz(1403) - oracleNowruz(1402), 365);
assert.equal(oracleNowruz(1404) - oracleNowruz(1403), 366);
for (const year of [1178, 1300, 1348, 1378, 1430, 1479]) {
  assert.equal(C.nowruz(year), oracleNowruz(year), 'Nowruz ' + year);
  assert.equal(C.yearLength(year), oracleLeap(year) ? 366 : 365, 'year length ' + year);
  for (let month = 1; month <= 12; month += 1) {
    assert.equal(C.persianToFixed(year, month, 1), oracleToFixed(year, month, 1), 'month start ' + year + '-' + month);
  }
}

// ---- Window edges are the documented ones.
assert.equal(C.MIN_GREGORIAN_YEAR, 1800);
assert.equal(C.MAX_GREGORIAN_YEAR, 2100);
assert.equal(C.MIN_PERSIAN_YEAR, 1178);
assert.equal(C.MAX_PERSIAN_YEAR, 1479);
assert.equal(C.MONTH_NAMES.length, 12);
assert.equal(C.CYCLE_YEARS, 33);
assert.equal(C.CYCLE_LEAPS, 8);
assert.equal(C.leapYearsThrough(33), 8);
assert.equal(C.leapYearsThrough(0), 0);

// ---- Every day of the supported window round-trips through the oracle.
const first = C.gregorianToFixed(1800, 1, 1);
const last = C.gregorianToFixed(2100, 12, 31);
let days = 0;
for (let fixed = first; fixed <= last; fixed += 1) {
  const persian = plain(C.fixedToPersian(fixed));
  assert.deepEqual(persian, oracleFromFixed(fixed), 'persian for day ' + fixed);
  assert.equal(C.persianToFixed(persian.year, persian.month, persian.day), fixed, 'round trip at ' + fixed);
  const civil = plain(C.fixedToGregorian(fixed));
  assert.equal(C.gregorianToFixed(civil.year, civil.month, civil.day), fixed);
  assert.equal(C.weekdayName(fixed), ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date((fixed - 719163) * 86400000).getUTCDay()]);
  days += 1;
}
assert.equal(days, last - first + 1);
assert.equal(days, 109938);

// ---- Every month of every named year is internally consistent.
let months = 0;
let leapYears = 0;
for (let year = C.MIN_PERSIAN_YEAR; year <= C.MAX_PERSIAN_YEAR; year += 1) {
  let total = 0;
  for (let month = 1; month <= 12; month += 1) {
    const length = C.monthLength(month, year);
    assert.equal(length, month <= 6 ? 31 : month <= 11 ? 30 : (oracleLeap(year) ? 30 : 29), 'month length ' + year + '-' + month);
    assert.equal(C.persianToFixed(year, month, length) - C.persianToFixed(year, month, 1), length - 1);
    assert.equal(C.monthOffset(month, year), C.persianToFixed(year, month, 1) - C.nowruz(year));
    total += length;
    months += 1;
  }
  assert.equal(total, C.yearLength(year));
  assert.equal(C.persianToFixed(year + 1, 1, 1) - C.persianToFixed(year, 1, 1), total);
  if (C.isLeapPersianYear(year)) leapYears += 1;
}
assert.equal(months, 302 * 12);
assert.equal(leapYears, 73);

// ---- A second, independent reference: ICU's Persian calendar, when present.
const icu = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
let icuDays = 0;
if (icu.resolvedOptions().calendar === 'persian') {
  for (let fixed = first; fixed <= last; fixed += 1) {
    const parts = {};
    for (const part of icu.formatToParts(new Date((fixed - 719163) * 86400000))) parts[part.type] = part.value;
    const persian = plain(C.fixedToPersian(fixed));
    assert.equal(persian.year, Number(parts.year), 'ICU year at day ' + fixed);
    assert.equal(persian.month, Number(parts.month), 'ICU month at day ' + fixed);
    assert.equal(persian.day, Number(parts.day), 'ICU day at day ' + fixed);
    icuDays += 1;
  }
}

// ---- Anchors that a Persian calendar must reproduce, including Nowruz dates.
const anchors = [
  ['2026-11-22', '1 Azar 1405 AP', 'Sunday', 1405, 9, 1, '2026-03-21', 247],
  ['2021-03-21', '1 Farvardin 1400 AP', 'Sunday', 1400, 1, 1, '2021-03-21', 1],
  ['2024-03-20', '1 Farvardin 1403 AP', 'Wednesday', 1403, 1, 1, '2024-03-20', 1],
  ['2025-03-21', '1 Farvardin 1404 AP', 'Friday', 1404, 1, 1, '2025-03-21', 1],
  ['1979-02-11', '22 Bahman 1357 AP', 'Sunday', 1357, 11, 22, '1978-03-21', 328],
  ['2000-01-01', '11 Dey 1378 AP', 'Saturday', 1378, 10, 11, '1999-03-21', 287],
  ['1800-01-01', '11 Dey 1178 AP', 'Wednesday', 1178, 10, 11, '1799-03-21', 287],
  ['2100-12-31', '10 Dey 1479 AP', 'Friday', 1479, 10, 10, '2100-03-21', 286]
];
for (const [iso, text, weekday, year, month, day, yearStart, dayOfYear] of anchors) {
  const result = run({ direction: 'g2p', date: iso });
  assert.equal(result.persianText, text, iso);
  assert.equal(result.weekday, weekday, iso);
  assert.equal(result.persianYear, year, iso);
  assert.equal(result.persianMonthNumber, month, iso);
  assert.equal(result.persianDay, day, iso);
  assert.equal(result.yearStartIso, yearStart, iso);
  assert.equal(result.dayOfYear, dayOfYear, iso);
  assert.equal(result.gregorianIso, iso);
  assert.equal(result.direction, 'g2p');
  assert.equal(result.persianIso,
    String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0'));
}

// The window edges are inclusive in both directions, and Nowruz is the boundary.
assert.equal(run({ direction: 'p2g', year: '1178', month: '10', day: '11' }).gregorianIso, '1800-01-01');
assert.equal(run({ direction: 'p2g', year: '1479', month: '10', day: '10' }).gregorianIso, '2100-12-31');
assert.equal(run({ direction: 'p2g', year: '1403', month: '12', day: '30' }).gregorianIso, '2025-03-20');
assert.equal(run({ direction: 'p2g', year: '1403', month: '12', day: '30' }).monthLength, 30);
assert.equal(run({ direction: 'p2g', year: '1404', month: '12', day: '29' }).gregorianIso, '2026-03-20');
assert.equal(run({ direction: 'p2g', year: '1405', month: '1', day: '1' }).gregorianIso, '2026-03-21');
assert.equal(run({ direction: 'g2p', date: '2000-02-29' }).persianIso, '1378-12-10');

// Month names are accepted in the spellings the form offers, and in common variants.
const named = [
  ['Farvardin', 1], ['farvardin', 1], ['Ordibehesht', 2], ['Khordad', 3], ['Tir', 4],
  ['Mordad', 5], ['Shahrivar', 6], ['Mehr', 7], ['Aban', 8], ['Azar', 9],
  ['Dey', 10], ['Day', 10], ['Bahman', 11], ['Esfand', 12], ['Isfand', 12]
];
for (const [name, month] of named) {
  const result = run({ direction: 'p2g', year: '1405', month: name, day: '1' });
  assert.equal(result.persianMonthNumber, month, name);
}

// ---- Refusals, pinned by exact message.
const problems = [
  [{ direction: 'g2p', date: '' }, 'Enter a Gregorian date.'],
  [{ direction: 'g2p', date: '   ' }, 'Enter a Gregorian date.'],
  [{ direction: 'g2p', date: '22/11/2026' }, 'Enter the date as YYYY-MM-DD.'],
  [{ direction: 'g2p', date: '2026-2-3' }, 'Enter the date as YYYY-MM-DD.'],
  [{ direction: 'g2p', date: '2026-13-01' }, 'Enter a month from 01 to 12.'],
  [{ direction: 'g2p', date: '2026-02-29' }, 'Enter a real calendar day for that month.'],
  [{ direction: 'g2p', date: '2026-04-31' }, 'Enter a real calendar day for that month.'],
  [{ direction: 'g2p', date: '1799-12-31' }, 'Enter a year from 1800 to 2100.'],
  [{ direction: 'g2p', date: '2101-01-01' }, 'Enter a year from 1800 to 2100.'],
  [{ direction: 'p2g', year: '', month: '1', day: '1' }, 'Enter a Persian year, such as 1405.'],
  [{ direction: 'p2g', year: '14x5', month: '1', day: '1' }, 'Enter the Persian year as a whole number, such as 1405.'],
  [{ direction: 'p2g', year: '1405.5', month: '1', day: '1' }, 'Enter the Persian year as a whole number, such as 1405.'],
  [{ direction: 'p2g', year: '900', month: '1', day: '1' }, 'Enter a Persian year from 1178 to 1479.'],
  [{ direction: 'p2g', year: '1480', month: '1', day: '1' }, 'Enter a Persian year from 1178 to 1479.'],
  [{ direction: 'p2g', year: '1405', month: '', day: '1' }, 'Choose a Persian month.'],
  [{ direction: 'p2g', year: '1405', month: '0', day: '1' }, 'Choose a Persian month.'],
  [{ direction: 'p2g', year: '1405', month: '13', day: '1' }, 'Choose a Persian month.'],
  [{ direction: 'p2g', year: '1405', month: 'Farvardin', day: '' }, 'Enter the day of the month.'],
  [{ direction: 'p2g', year: '1405', month: '2', day: '1.5' }, 'Enter the day as a whole number.'],
  [{ direction: 'p2g', year: '1405', month: '2', day: '0' }, 'Enter a day from 1 to 31 for Ordibehesht 1405.'],
  [{ direction: 'p2g', year: '1405', month: '2', day: '32' }, 'Enter a day from 1 to 31 for Ordibehesht 1405.'],
  [{ direction: 'p2g', year: '1405', month: '12', day: '30' }, 'Enter a day from 1 to 29 for Esfand 1405.'],
  [{ direction: 'p2g', year: '1178', month: '1', day: '1' }, 'That Persian date falls outside the years 1800 to 2100.'],
  [{ direction: 'p2g', year: '1479', month: '12', day: '29' }, 'That Persian date falls outside the years 1800 to 2100.']
];
for (const [input, message] of problems) {
  assert.equal(failure(input), message, JSON.stringify(input));
}

// A blank month on a Gregorian conversion is never read.
assert.equal(run({ direction: 'g2p', date: '2026-11-22', year: '', month: '', day: '' }).persianYear, 1405);

// ---- Catalog replay.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(entry.name, 'Persian Calendar Converter');
assert.equal(entry.category, 'Time');
assert.equal(entry.subcategory, 'Conversion');
assert.equal(entry.listed, true);
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.sources.length, 4, 'the arithmetic rule is cited');
assert.equal(entry.sources[0].url, 'https://en.wikipedia.org/wiki/Solar_Hijri_calendar');
assert.equal(entry.sources[1].url, 'https://unicode-org.github.io/icu/userguide/datetime/calendar/');
for (const source of entry.sources) {
  assert.ok(source.title && source.title.length > 20, 'source titles are specific');
  if (source.url) assert.ok(/^https:\/\//.test(source.url), 'sources are fetched over https');
}
assert.ok(entry.method && entry.method.length > 800, 'the method explains the arithmetic');
assert.ok(entry.guidance && entry.guidance.length > 150, 'the guidance states the limits');
assert.ok(entry.testCases.length >= 20, 'enough catalog cases');
const kinds = (kind) => entry.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(kinds('golden'), 6);
assert.equal(kinds('boundary'), 6);
assert.equal(kinds('validation'), 13);
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
for (const tag of ['time', 'calendar', 'persian', 'solar-hijri', 'jalali', 'conversion']) {
  assert.ok(entry.tags.includes(tag), 'new tag present: ' + tag);
}
// No other tool already offers a Persian, Solar Hijri or Jalali conversion.
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  const haystack = [tool.slug, tool.name, tool.description, (tool.aliases || []).join(' '), (tool.tags || []).join(' ')]
    .join(' ').toLowerCase();
  assert.ok(!/persian calendar|solar hijri|jalali|shamsi|iranian calendar/.test(haystack), 'no duplicate: ' + tool.slug);
}

// ---- The page stays self-contained, offline and keyboard accessible.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="persian-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('<div id="site-header"></div>'), 'shared header hook missing');
const controls = ['greg-date', 'persian-year', 'persian-month', 'persian-day'];
for (const id of controls) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id + ' missing');
}
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
assert.ok(!/type="hidden"/i.test(html), 'no hidden inputs');
assert.ok((html.match(/<button /g) || []).length === 3, 'three buttons');
assert.ok(!/autocomplete="on"/.test(html), 'inputs are not autocompleted');
assert.ok(/name="direction" value="g2p" checked/.test(html), 'directions are labelled');

console.log('persian calendar converter: ' + entry.testCases.length + ' catalog cases, '
  + days + ' civil days swept, ' + months + ' Persian months checked, '
  + leapYears + ' leap years, ' + icuDays + ' ICU comparisons, '
  + anchors.length + ' anchors and ' + problems.length + ' refusals pass');
