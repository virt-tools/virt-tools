/* Hebrew calendar converter: arithmetic rules, known Hebrew dates, round trips,
   validation messages, catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'hebrew-calendar-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* hebrew-calendar-core:start */';
const endMarker = '/* hebrew-calendar-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = HebrewCalendarCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const iso = (year, month, day) =>
  String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
const failure = (options) => {
  try { plain(C.compute(options)); } catch (error) { return error.message; }
  return null;
};
const g2h = (date) => plain(C.fromGregorian(date));
const h2g = (year, month, day) => plain(C.fromHebrew(year, month, day));

// ---- Constants and the epoch basis.
assert.equal(C.HEBREW_EPOCH, -1373428);
assert.equal(C.MIN_GREGORIAN_YEAR, 1600);
assert.equal(C.MAX_GREGORIAN_YEAR, 2200);
assert.equal(C.MIN_HEBREW_YEAR, 5360);
assert.equal(C.MAX_HEBREW_YEAR, 5961);
assert.deepEqual(plain(C.MONTH_NAMES), {
  1: 'Nisan', 2: 'Iyar', 3: 'Sivan', 4: 'Tammuz', 5: 'Av', 6: 'Elul',
  7: 'Tishrei', 8: 'Cheshvan', 9: 'Kislev', 10: 'Tevet', 11: 'Shevat', 12: 'Adar', 13: 'Adar II'
});
assert.deepEqual(plain(C.monthSequence(5787)),
  [7, 8, 9, 10, 11, 12, 13, 1, 2, 3, 4, 5, 6], 'a leap year carries Adar II after Adar I');
assert.deepEqual(plain(C.monthSequence(5786)), [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6],
  'a common year has no Adar II');

// ---- The 19-year cycle: seven leap years out of every nineteen.
let leapCount = 0;
for (let year = 5700; year < 5719; year += 1) if (C.isLeapHebrewYear(year)) leapCount += 1;
assert.equal(leapCount, 7, 'seven leap years per cycle');
const leapYears = [];
for (let year = 5780; year < 5799; year += 1) if (C.isLeapHebrewYear(year)) leapYears.push(year);
assert.deepEqual(leapYears, [5782, 5784, 5787, 5790, 5793, 5795, 5798], 'leap years of the cycle');

// ---- Invariants over every supported Hebrew year.
const lengths = new Set();
for (let year = C.MIN_HEBREW_YEAR; year <= C.MAX_HEBREW_YEAR; year += 1) {
  const length = C.yearLength(year);
  lengths.add(length);
  const start = C.hebrewToFixed(year, 7, 1);
  assert.ok(![0, 3, 5].includes(C.mod(start, 7)), 'Rosh Hashanah never on Sunday, Wednesday or Friday: ' + year);
  const order = C.monthSequence(year);
  const total = order.reduce((sum, month) => sum + C.monthLength(month, year), 0);
  assert.equal(total, length, 'months sum to the year length: ' + year);
  assert.equal(C.monthLength(7, year), 30, 'Tishrei is always 30 days');
  assert.equal(C.monthLength(2, year), 29, 'Iyar is always 29 days');
  assert.equal(C.monthLength(6, year), 29, 'Elul is always 29 days');
  assert.equal(C.monthLength(8, year), C.mod(length, 10) === 5 ? 30 : 29, 'Cheshvan is 30 only in a complete year');
  assert.equal(C.monthLength(9, year), C.mod(length, 10) === 3 ? 29 : 30, 'Kislev is 29 only in a deficient year');
  if (C.isLeapHebrewYear(year)) {
    assert.equal(C.monthLength(12, year), 30, 'Adar I has 30 days');
    assert.equal(C.monthLength(13, year), 29, 'Adar II has 29 days');
  } else {
    assert.equal(C.monthLength(12, year), 29, 'Adar has 29 days in a common year');
  }
  // First and last day of every month round-trips.
  for (const month of order) {
    for (const day of [1, C.monthLength(month, year)]) {
      const fixed = C.hebrewToFixed(year, month, day);
      assert.deepEqual(plain(C.fixedToHebrew(fixed)), { year, month, day }, 'round trip ' + year + '/' + month + '/' + day);
    }
  }
}
assert.deepEqual([...lengths].sort(), [353, 354, 355, 383, 384, 385], 'six year lengths only');

// ---- Known Hebrew dates (Rosh Hashanah and festivals of 5784-5787).
const anchors = [
  ['2023-09-16', 1, 7, 5784, 'Saturday'],
  ['2024-10-03', 1, 7, 5785, 'Thursday'],
  ['2025-09-23', 1, 7, 5786, 'Tuesday'],
  ['2026-09-12', 1, 7, 5787, 'Saturday'],
  ['2026-04-02', 15, 1, 5786, 'Thursday'],
  ['2024-03-11', 1, 13, 5784, 'Monday'],
  ['2026-11-16', 6, 9, 5787, 'Monday']
];
for (const [date, day, month, year, weekday] of anchors) {
  const result = g2h(date);
  assert.equal(result.hebrewText, day + ' ' + C.monthName(month, year) + ' ' + year, 'anchor ' + date);
  assert.equal(result.weekday, weekday, 'weekday ' + date);
  assert.equal(result.hebrewDay, day);
  assert.equal(result.hebrewMonthNumber, month);
  assert.equal(result.hebrewYear, year);
  assert.equal(g2h(date).gregorianIso, date);
}

// ---- Year types and year starts.
const rosh = g2h('2026-09-12');
assert.equal(rosh.hebrewText, '1 Tishrei 5787');
assert.equal(rosh.yearLength, 385);
assert.equal(rosh.yearKind, 'complete');
assert.equal(rosh.yearLeap, true);
assert.equal(rosh.yearText, '5787 (leap year, 385 days, complete)');
assert.equal(rosh.dayOfYear, 1);
assert.equal(rosh.monthLength, 30);
assert.equal(rosh.yearStartIso, '2026-09-12');
assert.equal(rosh.yearStartLong, '12 September 2026');

const deficient = g2h('2023-09-16');
assert.equal(deficient.yearLength, 383);
assert.equal(deficient.yearKind, 'deficient');
assert.equal(deficient.yearText, '5784 (leap year, 383 days, deficient)');
assert.equal(C.monthLength(9, 5784), 29, 'Kislev is short in 5784');

const common = g2h('2025-09-23');
assert.equal(common.yearLength, 354);
assert.equal(common.yearKind, 'regular');
assert.equal(common.yearLeap, false);
assert.equal(common.yearText, '5786 (common year, 354 days, regular)');

// ---- Both directions agree, including Adar I and Adar II.
const adarOne = h2g(5787, 12, 1);
assert.equal(adarOne.gregorianIso, '2027-02-08');
assert.equal(adarOne.hebrewText, '1 Adar I 5787');
assert.equal(adarOne.dayOfYear, 150);
assert.equal(adarOne.monthLength, 30);
const adarTwo = h2g(5787, 13, 1);
assert.equal(adarTwo.gregorianIso, '2027-03-10');
assert.equal(adarTwo.hebrewText, '1 Adar II 5787');
assert.equal(adarTwo.dayOfYear, 180);
assert.equal(adarTwo.monthLength, 29);
assert.equal(h2g(5787, 'Adar I', 1).gregorianIso, '2027-02-08', 'month names parse');
assert.equal(h2g(5787, 'adar ii', 1).gregorianIso, '2027-03-10', 'month names are case-insensitive');
assert.equal(h2g(5786, 'Nisan', 15).gregorianIso, '2026-04-02');
assert.equal(h2g(5787, 8, 30).gregorianIso, '2026-11-10', 'Cheshvan 30 in a complete year');
assert.equal(h2g(5786, 1, 15).weekday, 'Thursday');

// ---- Round trips across the supported window and the whole civil range.
for (const year of [1600, 1700, 1800, 2026, 2027, 2200]) {
  const days = C.isLeapYear(year) ? 366 : 365;
  for (let index = 0; index < days; index += 1) {
    const fixed = C.gregorianToFixed(year, 1, 1) + index;
    const gregorian = C.fixedToGregorian(fixed);
    const text = iso(gregorian.year, gregorian.month, gregorian.day);
    const result = g2h(text);
    const back = h2g(result.hebrewYear, result.hebrewMonthNumber, result.hebrewDay);
    assert.equal(back.gregorianIso, text, 'round trip ' + text);
  }
}
let seed = 20261116;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let index = 0; index < 400; index += 1) {
  const year = 1600 + Math.floor(random() * 601);
  const month = 1 + Math.floor(random() * 12);
  const day = 1 + Math.floor(random() * C.daysInMonth(year, month));
  const text = iso(year, month, day);
  const result = g2h(text);
  assert.equal(result.gregorianIso, text, 'echo ' + text);
  const back = h2g(result.hebrewYear, result.hebrewMonthNumber, result.hebrewDay);
  assert.equal(back.gregorianIso, text, 'random round trip ' + text);
  assert.equal(result.weekday, C.weekdayName(C.gregorianToFixed(year, month, day)));
}

// ---- Validation messages.
assert.equal(failure({ direction: 'g2h', date: '' }), 'Enter a Gregorian date.');
assert.equal(failure({ direction: 'g2h', date: '2026-3-20' }), 'Enter the date as YYYY-MM-DD.');
assert.equal(failure({ direction: 'g2h', date: '2026-13-01' }), 'Enter a month from 01 to 12.');
assert.equal(failure({ direction: 'g2h', date: '2026-02-30' }), 'Enter a real calendar day for that month.');
assert.equal(failure({ direction: 'g2h', date: '1599-12-31' }), 'Enter a year from 1600 to 2200.');
assert.equal(failure({ direction: 'g2h', date: '2201-01-01' }), 'Enter a year from 1600 to 2200.');
assert.equal(failure({ direction: 'h2g', year: '', month: 7, day: 1 }), 'Enter a Hebrew year, such as 5787.');
assert.equal(failure({ direction: 'h2g', year: '578', month: 7, day: 1 }),
  'Enter the Hebrew year as a four-digit number, such as 5787.');
assert.equal(failure({ direction: 'h2g', year: 6000, month: 7, day: 1 }),
  'Enter a Hebrew year from 5360 to 5961.');
assert.equal(failure({ direction: 'h2g', year: 5786, month: 13, day: 1 }),
  'Adar II exists only in leap years.');
assert.equal(failure({ direction: 'h2g', year: 5786, month: 10, day: 30 }),
  'Enter a day from 1 to 29 for Tevet 5786.');
assert.equal(failure({ direction: 'h2g', year: 5787, month: 10, day: 0 }),
  'Enter a day from 1 to 29 for Tevet 5787.');
assert.equal(failure({ direction: 'h2g', year: 5360, month: 7, day: 1 }),
  'That Hebrew date falls outside the years 1600 to 2200.');
assert.equal(failure({ direction: 'h2g', year: 5787, month: 'Adar II', day: 30 }),
  'Enter a day from 1 to 29 for Adar II 5787.');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2194, 'public tools');
assert.ok(catalog.tools.some((tool) => tool.slug === slug), 'the new record is present');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.equal(record.name, 'Hebrew Calendar Converter');
assert.equal(record.category, 'Time');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('19-year cycle'), 'method states the calendar rule');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 2, 'sources are cited');
for (const source of record.sources) {
  assert.ok(source.title.length > 20, 'a source names the document and the part used');
  if (source.url) assert.match(source.url, /^https:\/\//, 'every URL is absolute https');
}
assert.ok(record.sources.some((source) => source.url.includes('wikipedia.org/wiki/Hebrew_calendar')), 'the calendar rules are cited');
assert.ok(record.sources.some((source) => source.url.includes('hebcal.com')), 'the cross-check reference is cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 19, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 7, 'seven validation cases');
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = plain(C.compute(testCase.input));
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], expected, testCase.name + ' ' + key);
  }
}

// The new record's slug, name and aliases must not collide with any other record.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');
for (const tag of ['time', 'calendar', 'hebrew', 'conversion']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 6, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="greg-date">/.test(html), 'the civil date field has a visible label');
assert.ok(/<label for="heb-year">/.test(html) && /<label for="heb-month">/.test(html) && /<label for="heb-day">/.test(html),
  'the Hebrew fields have visible labels');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="numeric"/.test(html), 'a numeric keyboard is offered on touch');
assert.ok(/<form id="hebrew-form" novalidate>/.test(html), 'the form is a real form and does not native-validate');
assert.ok(/type="radio" name="direction" value="g2h"/.test(html) && /value="h2g"/.test(html), 'both directions are offered');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/[^\x00-\x7f]/.test(fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8')),
  'the page source stays ASCII');

console.log('hebrew calendar converter: arithmetic rules, known dates, 400 random round trips, 19 catalog cases and the page contract pass');
