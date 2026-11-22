/* Hijri calendar converter: an independent 30-year-cycle oracle, a full sweep of
   the supported civil window, catalog replay and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'hijri-calendar-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* hijri-calendar-core:start */';
const endMarker = '/* hijri-calendar-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = HijriCalendarCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.compute(input));
const failure = (input) => {
  try { C.compute(input); } catch (error) { return error.message; }
  return null;
};

// ---- An independent oracle: 30-year cycle days and a binary search for the year.
const LEAP_POSITIONS = new Set([2, 5, 7, 10, 13, 16, 18, 21, 24, 26, 29]);
const CYCLE_PREFIX = [0];
for (let position = 1; position <= 30; position += 1) {
  CYCLE_PREFIX.push(CYCLE_PREFIX[position - 1] + (LEAP_POSITIONS.has(position) ? 355 : 354));
}
assert.equal(CYCLE_PREFIX[30], 10631);
const MONTH_STARTS = [0, 30, 59, 89, 118, 148, 177, 207, 236, 266, 295, 325];
const EPOCH = 227015;

function oracleLeap(year) {
  // The 11 leap positions of the cycle, expressed as a position set.
  return LEAP_POSITIONS.has(((year - 1) % 30) + 1);
}

function oracleMonthLength(month, year) {
  if (month === 12 && oracleLeap(year)) return 30;
  return month % 2 === 1 ? 30 : 29;
}

function oracleToFixed(year, month, day) {
  const cycles = Math.floor((year - 1) / 30);
  const position = (year - 1) % 30;
  return EPOCH - 1 + cycles * 10631 + CYCLE_PREFIX[position] + MONTH_STARTS[month - 1] + day;
}

function oracleFromFixed(fixed) {
  let low = 1;
  let high = 3000;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (oracleToFixed(middle, 1, 1) <= fixed) low = middle;
    else high = middle - 1;
  }
  let offset = fixed - oracleToFixed(low, 1, 1);
  for (let month = 1; month <= 12; month += 1) {
    const length = oracleMonthLength(month, low);
    if (offset < length) return { year: low, month: month, day: offset + 1 };
    offset -= length;
  }
  throw new Error('oracle month did not resolve');
}

// The two leap rules must agree for every year the page can name.
for (let year = 990; year <= 1640; year += 1) {
  for (let month = 1; month <= 12; month += 1) {
    assert.equal(C.hijriToFixed(year, month, 1), oracleToFixed(year, month, 1),
      'month start for ' + year + '-' + month);
  }
}
assert.equal(C.ISLAMIC_EPOCH, EPOCH);
assert.equal(C.MIN_GREGORIAN_YEAR, 1600);
assert.equal(C.MAX_GREGORIAN_YEAR, 2200);
assert.equal(C.MIN_HIJRI_YEAR, 1008);
assert.equal(C.MAX_HIJRI_YEAR, 1627);
assert.equal(C.MONTH_NAMES.length, 12);

// ---- The epoch is 1 Muharram 1 AH, a Friday in July 622.
assert.equal(C.hijriToFixed(1, 1, 1), EPOCH);
assert.deepEqual(plain(C.fixedToGregorian(EPOCH)), { year: 622, month: 7, day: 19 });
assert.equal(C.weekdayName(EPOCH), 'Friday');
assert.equal(C.isLeapHijriYear(2), true);
assert.equal(C.isLeapHijriYear(1), false);
assert.equal(C.isLeapHijriYear(29), true);
assert.equal(C.isLeapHijriYear(30), false);

// ---- Every day of the supported window round-trips through the oracle.
const first = C.gregorianToFixed(1600, 1, 1);
const last = C.gregorianToFixed(2200, 12, 31);
let days = 0;
for (let fixed = first; fixed <= last; fixed += 1) {
  const hijri = plain(C.fixedToHijri(fixed));
  const expected = oracleFromFixed(fixed);
  assert.deepEqual(hijri, expected, 'hijri for day ' + fixed);
  assert.equal(C.hijriToFixed(hijri.year, hijri.month, hijri.day), fixed, 'round trip at ' + fixed);
  assert.ok(hijri.day >= 1 && hijri.day <= oracleMonthLength(hijri.month, hijri.year));
  const civil = plain(C.fixedToGregorian(fixed));
  assert.equal(C.gregorianToFixed(civil.year, civil.month, civil.day), fixed);
  days += 1;
}
assert.equal(days, last - first + 1);

// ---- Every month of every named Hijri year is internally consistent.
let months = 0;
for (let year = C.MIN_HIJRI_YEAR; year <= C.MAX_HIJRI_YEAR; year += 1) {
  let total = 0;
  for (let month = 1; month <= 12; month += 1) {
    const length = C.monthLength(month, year);
    assert.equal(length, oracleMonthLength(month, year), 'month length ' + year + '-' + month);
    assert.equal(C.hijriToFixed(year, month, length) - C.hijriToFixed(year, month, 1), length - 1);
    total += length;
    months += 1;
  }
  assert.equal(total, C.yearLength(year));
  assert.equal(total, C.isLeapHijriYear(year) ? 355 : 354);
  assert.equal(C.hijriToFixed(year + 1, 1, 1) - C.hijriToFixed(year, 1, 1), total);
}
assert.equal(months, 620 * 12);

// ---- Anchors that a tabular calendar must reproduce.
const anchors = [
  ['2026-11-22', '11 Jumada II 1448 AH', 'Sunday', 1448, 6, 11],
  ['2025-03-01', '1 Ramadan 1446 AH', 'Saturday', 1446, 9, 1],
  ['2024-04-10', '1 Shawwal 1445 AH', 'Wednesday', 1445, 10, 1],
  ['1970-01-01', '22 Shawwal 1389 AH', 'Thursday', 1389, 10, 22],
  ['2000-01-01', '24 Ramadan 1420 AH', 'Saturday', 1420, 9, 24],
  ['1600-01-01', '14 Jumada II 1008 AH', 'Saturday', 1008, 6, 14],
  ['2200-12-31', '24 Dhu al-Qa\'dah 1627 AH', 'Wednesday', 1627, 11, 24],
];
for (const [iso, text, weekday, year, month, day] of anchors) {
  const result = run({ direction: 'g2h', date: iso });
  assert.equal(result.hijriText, text, iso);
  assert.equal(result.weekday, weekday, iso);
  assert.equal(result.hijriYear, year, iso);
  assert.equal(result.hijriMonthNumber, month, iso);
  assert.equal(result.hijriDay, day, iso);
  assert.equal(result.gregorianIso, iso);
  assert.equal(result.direction, 'g2h');
  assert.equal(result.hijriIso,
    String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0'));
}

// The window edges are inclusive in both directions.
assert.equal(run({ direction: 'h2g', year: '1008', month: '6', day: '14' }).gregorianIso, '1600-01-01');
assert.equal(run({ direction: 'h2g', year: '1627', month: '11', day: '24' }).gregorianIso, '2200-12-31');
assert.equal(run({ direction: 'g2h', date: '2000-02-29' }).hijriText, '24 Dhu al-Qa\'dah 1420 AH');
assert.equal(run({ direction: 'h2g', year: '1445', month: '12', day: '30' }).gregorianIso, '2024-07-07');
assert.equal(run({ direction: 'h2g', year: '1445', month: '12', day: '30' }).monthLength, 30);

// Month names are accepted in the spellings the form offers, and in common variants.
const named = [
  ['Ramadan', 9], ['ramadan', 9], ['Shawwal', 10], ['SHA\'BAN', 8],
  ['Rabi I', 3], ['Rabi\' al-Awwal', 3], ['Rabi al-Thani', 4],
  ['Jumada al-Ula', 5], ['Jumada al-Akhirah', 6], ['Dhu al-Qi\'dah', 11],
  ['Dhul Hijjah', 12], ['Muharram', 1],
];
for (const [name, month] of named) {
  const result = run({ direction: 'h2g', year: '1448', month: name, day: '1' });
  assert.equal(result.hijriMonthNumber, month, name);
}

// ---- Refusals, pinned by exact message.
const problems = [
  [{ direction: 'g2h', date: '' }, 'Enter a Gregorian date.'],
  [{ direction: 'g2h', date: '   ' }, 'Enter a Gregorian date.'],
  [{ direction: 'g2h', date: '22/11/2026' }, 'Enter the date as YYYY-MM-DD.'],
  [{ direction: 'g2h', date: '2026-2-3' }, 'Enter the date as YYYY-MM-DD.'],
  [{ direction: 'g2h', date: '2026-13-01' }, 'Enter a month from 01 to 12.'],
  [{ direction: 'g2h', date: '2026-02-29' }, 'Enter a real calendar day for that month.'],
  [{ direction: 'g2h', date: '2026-04-31' }, 'Enter a real calendar day for that month.'],
  [{ direction: 'g2h', date: '1599-12-31' }, 'Enter a year from 1600 to 2200.'],
  [{ direction: 'g2h', date: '2201-01-01' }, 'Enter a year from 1600 to 2200.'],
  [{ direction: 'h2g', year: '', month: '5', day: '11' }, 'Enter a Hijri year, such as 1448.'],
  [{ direction: 'h2g', year: '14x8', month: '5', day: '11' }, 'Enter the Hijri year as a whole number, such as 1448.'],
  [{ direction: 'h2g', year: '1448.5', month: '5', day: '11' }, 'Enter the Hijri year as a whole number, such as 1448.'],
  [{ direction: 'h2g', year: '900', month: '1', day: '1' }, 'Enter a Hijri year from 1008 to 1627.'],
  [{ direction: 'h2g', year: '1628', month: '1', day: '1' }, 'Enter a Hijri year from 1008 to 1627.'],
  [{ direction: 'h2g', year: '1448', month: '', day: '1' }, 'Choose a Hijri month.'],
  [{ direction: 'h2g', year: '1448', month: '0', day: '1' }, 'Choose a Hijri month.'],
  [{ direction: 'h2g', year: '1448', month: '13', day: '1' }, 'Choose a Hijri month.'],
  [{ direction: 'h2g', year: '1448', month: 'Ramadhan', day: '1' }, 'Choose a Hijri month.'],
  [{ direction: 'h2g', year: '1448', month: '2', day: '' }, 'Enter the day of the month.'],
  [{ direction: 'h2g', year: '1448', month: '2', day: '1.5' }, 'Enter the day as a whole number.'],
  [{ direction: 'h2g', year: '1448', month: '2', day: '0' }, 'Enter a day from 1 to 29 for Safar 1448.'],
  [{ direction: 'h2g', year: '1448', month: '2', day: '30' }, 'Enter a day from 1 to 29 for Safar 1448.'],
  [{ direction: 'h2g', year: '1448', month: '12', day: '30' }, 'Enter a day from 1 to 29 for Dhu al-Hijjah 1448.'],
  [{ direction: 'h2g', year: '1008', month: '1', day: '1' }, 'That Hijri date falls outside the years 1600 to 2200.'],
  [{ direction: 'h2g', year: '1627', month: '12', day: '30' }, 'That Hijri date falls outside the years 1600 to 2200.'],
];
for (const [input, message] of problems) {
  assert.equal(failure(input), message, JSON.stringify(input));
}

// A blank month on a Gregorian conversion is never read.
assert.equal(run({ direction: 'g2h', date: '2026-11-22', year: '', month: '', day: '' }).hijriYear, 1448);

// ---- Catalog replay.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(entry.name, 'Hijri Calendar Converter');
assert.equal(entry.category, 'Time');
assert.equal(entry.subcategory, 'Conversion');
assert.equal(entry.listed, true);
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.icon, '\u{1F319}');
assert.equal(entry.sources.length, 2, 'the tabular rule is cited');
assert.equal(entry.sources[0].url, 'https://en.wikipedia.org/wiki/Tabular_Islamic_calendar');
assert.equal(entry.sources[1].url, 'https://www.fourmilab.ch/documents/calendar/');
for (const source of entry.sources) {
  assert.ok(source.title && source.title.length > 20, 'source titles are specific');
  assert.ok(/^https:\/\//.test(source.url), 'sources are fetched over https');
}
assert.ok(entry.method && entry.method.length > 800, 'the method explains the arithmetic');
assert.ok(entry.guidance && entry.guidance.length > 150, 'the guidance states the limits');
assert.ok(entry.testCases.length >= 20, 'enough catalog cases');
const kinds = (kind) => entry.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(kinds('golden'), 6);
assert.equal(kinds('boundary'), 6);
assert.equal(kinds('validation'), 12);
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
for (const tag of ['time', 'calendar', 'hijri', 'islamic', 'conversion']) {
  assert.ok(entry.tags.includes(tag), 'new tag present: ' + tag);
}
// No other tool already offers a lunar Hijri or Islamic calendar conversion.
// A Solar Hijri (Persian) tool is a different solar calendar, so that phrase is
// dropped here and audited by its own suite instead.
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  const haystack = [tool.slug, tool.name, tool.description, (tool.aliases || []).join(' '), (tool.tags || []).join(' ')]
    .join(' ').toLowerCase().replace(/solar[- ]hijri/g, 'solar calendar');
  assert.ok(!/hijri|islamic calendar|muslim calendar/.test(haystack), 'no duplicate: ' + tool.slug);
}

// ---- The page stays self-contained, offline and keyboard accessible.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="hijri-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('<div id="site-header"></div>'), 'shared header hook missing');
const controls = ['greg-date', 'hijri-year', 'hijri-month', 'hijri-day'];
for (const id of controls) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id + ' missing');
}
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
assert.ok(!/type="hidden"/i.test(html), 'no hidden inputs');
assert.ok((html.match(/<button /g) || []).length === 3, 'three buttons');
assert.ok(!/autocomplete="on"/.test(html), 'inputs are not autocompleted');
assert.ok(/name="direction" value="g2h" checked/.test(html), 'directions are labelled');

console.log('hijri calendar converter: ' + entry.testCases.length + ' catalog cases, '
  + days + ' civil days swept, ' + months + ' Hijri months checked, '
  + anchors.length + ' anchors and ' + problems.length + ' refusals pass');
