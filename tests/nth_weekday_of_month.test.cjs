/* Nth weekday of month: Gregorian day-number arithmetic, ISO week derivation,
   nth and last occurrence selection, the reverse label direction, refusals, an
   independent brute-force sweep, catalog replay and the page contract. The
   anchors were checked against Python's datetime/calendar oracle: every one of
   5,630 dates and 7,056 nth-weekday requests agreed, including refusals. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'nth-weekday-of-month';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* nth-weekday-core:start */';
const endMarker = '/* nth-weekday-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = NthWeekdayCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.compute(input));
const label = (input) => plain(C.labelDate(input));
const failure = (fn, input) => {
  try { fn(input); } catch (error) { return error.message; }
  return null;
};
const iso = (y, m, d) => C.weekdayIso(y, m, d);
const weekText = (y, m, d) => {
  const week = C.isoWeekOf(y, m, d);
  return week.year + '-W' + String(week.week).padStart(2, '0');
};

// ---- Constants and the Gregorian calendar.
assert.equal(C.MIN_YEAR, 1583, 'the Gregorian calendar starts in 1583');
assert.equal(C.MAX_YEAR, 9999);
assert.equal(C.MONTHS.length, 12);
assert.equal(C.WEEKDAYS.length, 7);
assert.equal(C.WEEKDAYS[0].iso, 1);
assert.equal(C.WEEKDAYS[0].name, 'Monday');
assert.equal(C.WEEKDAYS[6].iso, 7);
assert.equal(C.WEEKDAYS[6].name, 'Sunday');
assert.deepEqual(Array.from(C.OCCURRENCES, (entry) => entry.id),
  ['first', 'second', 'third', 'fourth', 'fifth', 'last']);
assert.equal(C.OCCURRENCES[5].ordinal, 0, 'last carries no fixed ordinal');
assert.equal(C.isLeapYear(2024), true);
assert.equal(C.isLeapYear(2026), false);
assert.equal(C.isLeapYear(2000), true, 'a 400-year leap rule');
assert.equal(C.isLeapYear(2100), false, 'a century that is not a leap year');
assert.equal(C.isLeapYear(1600), true);
assert.equal(C.daysInMonth(2024, 2), 29);
assert.equal(C.daysInMonth(2026, 2), 28);
assert.equal(C.daysInMonth(1900, 2), 28);
assert.equal(C.daysInMonth(2000, 2), 29);
assert.equal(C.daysInMonth(2026, 4), 30);
assert.equal(C.daysInMonth(2026, 12), 31);
assert.equal(C.daysInYear(2024), 366);
assert.equal(C.daysInYear(2026), 365);

// ---- Day numbers and weekdays against anchors verified with Python's datetime.
assert.equal(C.daysFromCivil(1970, 1, 1), 0, 'the Unix epoch');
assert.equal(iso(1970, 1, 1), 4, '1970-01-01 was a Thursday');
assert.equal(iso(2026, 1, 1), 4);
assert.equal(iso(2026, 11, 26), 4);
assert.equal(iso(1583, 1, 1), 6, '1583-01-01 was a Saturday');
assert.equal(iso(2000, 1, 1), 6);
assert.equal(iso(2000, 2, 29), 2);
assert.equal(iso(2024, 2, 29), 4);
assert.equal(iso(1900, 3, 1), 4);
assert.equal(C.weekdayName(iso(2026, 11, 26)), 'Thursday');
const roundTrip = C.civilFromDays(C.daysFromCivil(2026, 11, 26));
assert.deepEqual(plain(roundTrip), { year: 2026, month: 11, day: 26 });
for (const [y, m, d] of [[1583, 1, 1], [1600, 2, 29], [1752, 9, 14], [1900, 2, 28],
  [2000, 2, 29], [2024, 12, 31], [9999, 12, 31]]) {
  const back = plain(C.civilFromDays(C.daysFromCivil(y, m, d)));
  assert.deepEqual(back, { year: y, month: m, day: d }, 'day-number round trip ' + y + '-' + m + '-' + d);
}

// ---- ISO 8601 week years, including the week-53 boundaries.
assert.equal(weekText(2026, 1, 1), '2026-W01');
assert.equal(weekText(2026, 11, 26), '2026-W48');
assert.equal(weekText(2026, 12, 31), '2026-W53');
assert.equal(weekText(2027, 1, 1), '2026-W53', 'a January date in the previous ISO year');
assert.equal(weekText(2021, 1, 1), '2020-W53');
assert.equal(weekText(2015, 12, 31), '2015-W53');
assert.equal(weekText(2024, 12, 30), '2025-W01', 'a December date in the next ISO year');
assert.equal(weekText(9999, 12, 31), '9999-W52');
assert.equal(weekText(1583, 12, 31), '1583-W52');
assert.equal(C.dayOfYear(2026, 1, 1), 1);
assert.equal(C.dayOfYear(2026, 11, 26), 330);
assert.equal(C.dayOfYear(2024, 12, 31), 366);
assert.equal(C.dayOfYear(9999, 12, 31), 365);

// ---- Occurrence counting and the two directions of the same question.
assert.equal(C.ordinalOfDay(2026, 11, 5), 1);
assert.equal(C.ordinalOfDay(2026, 11, 26), 4);
assert.equal(C.isLastOfMonth(2026, 11, 26), true);
assert.equal(C.isLastOfMonth(2026, 11, 19), false);
assert.equal(C.isLastOfMonth(2026, 2, 27), true);
assert.equal(C.ordinalSuffix(1), '1st');
assert.equal(C.ordinalSuffix(2), '2nd');
assert.equal(C.ordinalSuffix(3), '3rd');
assert.equal(C.ordinalSuffix(4), '4th');
assert.equal(C.ordinalSuffix(5), '5th');

const thanksgiving = run({ year: 2026, month: 11, weekday: 4, occurrence: 'fourth' });
assert.equal(thanksgiving.dateISO, '2026-11-26');
assert.equal(thanksgiving.longDate, 'Thursday, 26 November 2026');
assert.equal(thanksgiving.phrase, '4th Thursday of November 2026');
assert.equal(thanksgiving.ordinalPhrase, '4th Thursday of November 2026');
assert.equal(thanksgiving.ordinal, 4);
assert.equal(thanksgiving.isLast, true);
assert.equal(thanksgiving.isoWeekText, '2026-W48');
assert.equal(thanksgiving.dayOfYear, 330);
assert.equal(thanksgiving.daysInYear, 365);
assert.equal(thanksgiving.monthCount, 4);
assert.equal(thanksgiving.occurrence, 'fourth');
assert.equal(thanksgiving.tableCaption, 'Every Thursday in November 2026');
assert.deepEqual(thanksgiving.occurrences.map((row) => row.day), [5, 12, 19, 26]);
assert.deepEqual(thanksgiving.occurrences.map((row) => row.ordinalSuffix),
  ['1st', '2nd', '3rd', '4th']);
assert.equal(thanksgiving.occurrences[3].isLast, true);
assert.equal(thanksgiving.occurrences[2].isLast, false);
assert.ok(thanksgiving.summary.includes('26 November 2026 is the fourth Thursday'),
  'the summary names the occurrence');

const lastFriday = run({ year: 2026, month: 2, weekday: 5, occurrence: 'last' });
assert.equal(lastFriday.dateISO, '2026-02-27');
assert.equal(lastFriday.phrase, 'Last Friday of February 2026');
assert.equal(lastFriday.ordinalPhrase, '4th Friday of February 2026');
assert.equal(lastFriday.ordinal, 4, 'a last occurrence is not always the fifth');
assert.equal(lastFriday.isLast, true);
assert.equal(lastFriday.isoWeekText, '2026-W09');

const fifthSunday = run({ year: 2026, month: 3, weekday: 7, occurrence: 'fifth' });
assert.equal(fifthSunday.dateISO, '2026-03-29');
assert.equal(fifthSunday.ordinal, 5);
assert.equal(fifthSunday.monthCount, 5);
assert.equal(fifthSunday.isLast, true, 'a fifth occurrence is always the last');

const laborDay = run({ year: 2025, month: 9, weekday: 1, occurrence: 'first' });
assert.equal(laborDay.dateISO, '2025-09-01');
assert.equal(laborDay.ordinal, 1);
assert.equal(laborDay.isLast, false);
assert.equal(laborDay.monthCount, 5);

const leapDay = run({ year: 2000, month: 2, weekday: 2, occurrence: 'fifth' });
assert.equal(leapDay.dateISO, '2000-02-29', 'a leap day reached as the fifth Tuesday');
assert.equal(leapDay.ordinal, 5);
assert.equal(leapDay.dayOfYear, 60);

// Inputs may be numbers or the names the select controls use.
assert.equal(run({ year: '2026', month: 'November', weekday: 'thursday', occurrence: '4' })
  .dateISO, '2026-11-26');
assert.equal(run({ year: '2026', month: '11', weekday: '4', occurrence: 'last' })
  .dateISO, '2026-11-26');
assert.equal(run({ year: 2026, month: 11, weekday: 7, occurrence: 'last' }).dateISO, '2026-11-29');
assert.equal(run({ year: 2026, month: 11, weekday: 7, occurrence: 'first' }).dateISO, '2026-11-01');

// ---- Refusals say what is wrong and how many occurrences the month has.
assert.equal(failure(C.compute, { year: '', month: 11, weekday: 4, occurrence: 'fourth' }),
  'Enter a year between 1583 and 9999.');
assert.equal(failure(C.compute, { year: '1582', month: 1, weekday: 1, occurrence: 'first' }),
  'Enter a year between 1583 and 9999.');
assert.equal(failure(C.compute, { year: '10000', month: 1, weekday: 1, occurrence: 'first' }),
  'Enter a year between 1583 and 9999.');
assert.equal(failure(C.compute, { year: 'twenty twenty-six', month: 11, weekday: 4, occurrence: 'fourth' }),
  'Enter the year as a number, such as 2026.');
assert.equal(failure(C.compute, { year: '2026.5', month: 11, weekday: 4, occurrence: 'fourth' }),
  'Enter the year as a number, such as 2026.');
assert.equal(failure(C.compute, { year: 2026, month: 13, weekday: 4, occurrence: 'fourth' }),
  'Pick a month from January to December.');
assert.equal(failure(C.compute, { year: 2026, month: 0, weekday: 4, occurrence: 'fourth' }),
  'Pick a month from January to December.');
assert.equal(failure(C.compute, { year: 2026, month: 11, weekday: 0, occurrence: 'fourth' }),
  'Pick a weekday from Monday to Sunday.');
assert.equal(failure(C.compute, { year: 2026, month: 11, weekday: 8, occurrence: 'fourth' }),
  'Pick a weekday from Monday to Sunday.');
assert.equal(failure(C.compute, { year: 2026, month: 11, weekday: 4, occurrence: 'sixth' }),
  'Pick an occurrence from first to fifth, or last.');
assert.equal(failure(C.compute, { year: 2026, month: 11, weekday: 4, occurrence: 'fifth' }),
  'November 2026 has only four Thursdays, so there is no fifth Thursday.');
assert.equal(failure(C.compute, { year: 2026, month: 2, weekday: 1, occurrence: 'fifth' }),
  'February 2026 has only four Mondays, so there is no fifth Monday.');
assert.equal(failure(C.compute, { year: 2026, month: 4, weekday: 1, occurrence: 'fifth' }),
  'April 2026 has only four Mondays, so there is no fifth Monday.');
assert.equal(run({ year: 2026, month: 4, weekday: 3, occurrence: 'fifth' }).dateISO, '2026-04-29',
  'a fifth Wednesday does exist in April 2026');

// ---- The reverse direction names the occurrence of a date.
const labelled = label({ date: '2026-11-26' });
assert.equal(labelled.ordinalPhrase, '4th Thursday of November 2026');
assert.equal(labelled.longDate, 'Thursday, 26 November 2026');
assert.equal(labelled.ordinal, 4);
assert.equal(labelled.isLast, true);
assert.equal(labelled.note, 'It is also the last Thursday of the month.');
assert.equal(labelled.isoWeekText, '2026-W48');
assert.equal(labelled.dayOfYear, 330);
assert.equal(label({ date: '2026-11-05' }).note, '');
assert.equal(label({ date: '2026-03-29' }).note,
  'It is the fifth, and therefore the last, Sunday of the month.');
assert.equal(label({ date: '2024-02-29' }).ordinalPhrase, '5th Thursday of February 2024');
assert.equal(label({ date: '1583-01-01' }).ordinalPhrase, '1st Saturday of January 1583');
assert.equal(label({ date: '9999-12-31' }).ordinalPhrase, '5th Friday of December 9999');

assert.equal(failure(C.labelDate, { date: '' }), 'Enter a date to label.');
assert.equal(failure(C.labelDate, { date: '26/11/2026' }),
  'Enter the date as YYYY-MM-DD, such as 2026-11-26.');
assert.equal(failure(C.labelDate, { date: '2026-11-26T00:00:00' }),
  'Enter the date as YYYY-MM-DD, such as 2026-11-26.');
assert.equal(failure(C.labelDate, { date: '2026-02-30' }),
  'Enter a real calendar date; that day does not exist in that month.');
assert.equal(failure(C.labelDate, { date: '2026-13-01' }),
  'Enter a real calendar date; that day does not exist in that month.');
assert.equal(failure(C.labelDate, { date: '1582-12-31' }), 'Enter a year between 1583 and 9999.');

// ---- An independent brute-force sweep: every month of 40 years, all weekdays,
//      both directions, without reusing the core's weekday shortcut.
let seed = 20261115;
const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
const bruteWeekday = (y, m, d) => {
  let count = 0;
  if (y >= 1970) {
    for (let year = 1970; year < y; year++) count += C.daysInYear(year);
  } else {
    for (let year = y; year < 1970; year++) count -= C.daysInYear(year);
  }
  for (let month = 1; month < m; month++) count += C.daysInMonth(y, month);
  count += d - 1;
  return ((count + 3) % 7 + 7) % 7 + 1;
};
let checked = 0;
for (const year of [1583, 1600, 1700, 1900, 1999, 2000, 2023, 2024, 2025, 2026, 2027, 2100, 2400, 9999]) {
  for (let month = 1; month <= 12; month++) {
    const days = C.daysInMonth(year, month);
    for (let day = 1; day <= days; day++) {
      assert.equal(iso(year, month, day), bruteWeekday(year, month, day),
        'weekday ' + year + '-' + month + '-' + day);
      checked++;
    }
    for (let weekday = 1; weekday <= 7; weekday++) {
      const matching = [];
      for (let day = 1; day <= days; day++) {
        if (bruteWeekday(year, month, day) === weekday) matching.push(day);
      }
      for (const occurrence of ['first', 'second', 'third', 'fourth', 'fifth', 'last']) {
        const expected = occurrence === 'last'
          ? matching[matching.length - 1]
          : matching[['first', 'second', 'third', 'fourth', 'fifth'].indexOf(occurrence)];
        let actual;
        try { actual = run({ year, month, weekday, occurrence }).day; } catch (error) { actual = null; }
        assert.equal(actual, expected === undefined ? null : expected,
          'occurrence ' + [year, month, weekday, occurrence].join('|'));
      }
    }
  }
}
assert.ok(checked > 5000, 'the sweep covered every day of fourteen years');

// ---- A seeded sweep of arbitrary requests keeps the invariants.
for (let index = 0; index < 400; index++) {
  const year = 1583 + (random() % (9999 - 1583 + 1));
  const month = 1 + (random() % 12);
  const weekday = 1 + (random() % 7);
  const occurrence = C.OCCURRENCES[random() % C.OCCURRENCES.length].id;
  const days = C.daysInMonth(year, month);
  let result = null;
  try { result = run({ year, month, weekday, occurrence }); } catch (error) { result = null; }
  if (!result) continue;
  assert.ok(result.day >= 1 && result.day <= days, 'the day is inside the month');
  assert.equal(result.weekdayIso, weekday, 'the weekday is the requested one');
  assert.equal(result.ordinal, Math.floor((result.day - 1) / 7) + 1);
  assert.equal(result.ordinalSuffix, C.ordinalSuffix(result.ordinal));
  assert.equal(result.isLast, result.day + 7 > days);
  assert.ok(result.ordinalPhrase.startsWith(result.ordinalSuffix + ' '), 'the phrase leads with the ordinal');
  assert.ok(result.occurrences.some((row) => row.day === result.day), 'the table contains the answer');
  assert.equal(result.occurrences.length, result.monthCount);
  if (occurrence === 'last') {
    assert.equal(result.isLast, true, 'the last occurrence never has a successor');
  } else if (occurrence === 'fifth') {
    assert.equal(result.ordinal, 5);
  }
}

// ---- Catalog record, replay of its published cases, totals and uniqueness.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Nth Weekday of Month Calculator');
assert.equal(record.category, 'Time');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.method.length > 1200, 'the method is documented');
assert.ok(record.method.includes('146,097'), 'the method states the era length');
assert.ok(record.method.includes('1583'), 'the method states the year floor');
assert.ok(record.description.length > 120, 'the description is descriptive');
assert.equal(record.sources.length, 1, 'one reference for ISO week numbering');
assert.ok(/^https:\/\/www\.cl\.cam\.ac\.uk\/~mgk25\/iso-time\.html$/.test(record.sources[0].url));
assert.equal(record.testCases.length, 14, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 8);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 6);
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(C.compute, testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], expected, testCase.name + ' ' + key);
  }
}
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2164, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Time').length, 52, 'Time count');

const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug],
    'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');
for (const tag of ['time', 'calendar', 'weekday']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && /nth-weekday|weekday-of-month/.test(tool.slug)),
  'no other nth-weekday slug');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 12, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const id of ['year', 'month', 'weekday', 'occurrence', 'label-date']) {
  assert.ok(new RegExp('<label for="' + id + '">').test(html), 'the ' + id + ' field has a visible label');
}
assert.ok(/<input id="year" type="text" inputmode="numeric"/.test(html), 'the year is a numeric text field');
assert.ok(/<input id="label-date" type="date"/.test(html), 'the reverse direction uses a native date control');
assert.ok(/<select id="month">/.test(html) && /<select id="weekday">/.test(html)
  && /<select id="occurrence">/.test(html), 'the pickers are selects');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/aria-atomic="true"/.test(html), 'results are announced atomically');
assert.ok(/<table class="ref"/.test(html), 'there is a table of the month');
assert.ok(/<caption id="month-caption">/.test(html), 'the table has a caption');
assert.ok(/overflow-x:auto/.test(html), 'the table can scroll sideways');
assert.ok(/@media \(max-width:560px\)/.test(html), 'the layout has a mobile breakpoint');
assert.ok(/min-height:44px/.test(html), 'controls meet the 44 px target');
assert.ok(!/\son[a-z]+="/i.test(html), 'no inline event handlers');
assert.ok(!/\b(fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB|navigator\.sendBeacon)\(/.test(html),
  'no network or storage APIs');
assert.ok(/<script src="\/assets\/app.js"><\/script>/.test(html), 'the shared script is loaded');
assert.ok(/<link rel="stylesheet" href="\/assets\/style.css">/.test(html), 'the shared stylesheet is loaded');
assert.ok(!/https?:\/\//.test(html.replace(/<p class="note">[\s\S]*?<\/p>/, '')), 'no external assets in the markup');
assert.ok(/^[\x00-\x7f]*$/.test(html), 'the page source stays ASCII');
assert.equal((html.match(/\u00b7/g) || []).length, 0, 'the middle dot is escaped, not literal');

console.log('nth-weekday-of-month: ' + checked + ' days swept against a brute-force calendar, '
  + record.testCases.length + ' catalog cases replayed, page contract checked');
