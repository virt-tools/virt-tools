/* ISO 8601 duration calculator: exact-rational reference cases, calendar
   month-end clamping, parser rules, random invariants, catalog replay and the
   page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'iso-8601-duration-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* iso-8601-duration-core:start */';
const endMarker = '/* iso-8601-duration-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = IsoDurationCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (duration, date, time) => plain(C.calculate(duration, date, time));
const failure = (duration, date, time) => {
  try { run(duration, date, time); } catch (error) { return error.message; }
  return null;
};

// ---- Constants and calendar helpers.
assert.equal(C.SECONDS_PER_MINUTE, 60);
assert.equal(C.SECONDS_PER_HOUR, 3600);
assert.equal(C.SECONDS_PER_DAY, 86400);
assert.equal(C.NOMINAL_DAYS_PER_MONTH, 30);
assert.equal(C.MAX_MONTHS, 120000);
assert.equal(C.MIN_START_YEAR, 1000);
assert.equal(C.MAX_END_YEAR, 9999);
assert.equal(C.DEFAULT_DURATION, 'P1M2DT3H');
assert.equal(C.DEFAULT_DATE, '2026-01-31');
assert.equal(C.DEFAULT_TIME, '09:00');
assert.deepEqual(plain(C.COMPONENTS.map((item) => [item.name, item.letter])),
  [['years', 'Y'], ['months', 'M'], ['weeks', 'W'], ['days', 'D'],
    ['hours', 'H'], ['minutes', 'M'], ['seconds', 'S']]);
assert.equal(C.isLeap(2024), true);
assert.equal(C.isLeap(2026), false);
assert.equal(C.isLeap(2000), true);
assert.equal(C.isLeap(1900), false);
assert.equal(C.daysInMonth(2024, 2), 29);
assert.equal(C.daysInMonth(2026, 2), 28);
assert.equal(C.daysInMonth(2026, 4), 30);
assert.equal(C.daysInMonth(2026, 12), 31);

// ---- Number formatting: three places, half up, trailing zeros trimmed, grouped.
assert.equal(C.formatNumber(0), '0');
assert.equal(C.formatNumber(1), '1');
assert.equal(C.formatNumber(1.5), '1.5');
assert.equal(C.formatNumber(32.125), '32.125');
assert.equal(C.formatNumber(0.0625), '0.063', 'halves round up');
assert.equal(C.formatNumber(1440), '1,440');
assert.equal(C.formatNumber(3239640), '3,239,640');
assert.equal(C.formatNumber(10156.085), '10,156.085');

// ---- Parser contract.
assert.equal(run('P1Y2M3DT4H5M6S', '', '').iso, 'P1Y2M3DT4H5M6S');
assert.equal(run('P1Y2M3DT4H5M6S', '', '').human,
  '1 year, 2 months, 3 days, 4 hours, 5 minutes, 6 seconds');
assert.equal(run('PT90M', '', '').iso, 'PT90M', 'values are not silently rewritten');
assert.equal(run('P1Y2M', '', '').iso, 'P1Y2M');
assert.equal(run('P0D', '', '').iso, 'PT0S', 'a zero duration is canonicalised');
assert.equal(run('PT0S', '', '').human, 'zero duration');
assert.equal(run('PT0S', '', '').totalDaysText, '0 days');
assert.equal(run('PT0S', '', '').exactSecondsText, '0 s');
assert.equal(run('P1.5D', '', '').secondsTotal, 129600, 'a fractional day is 12 hours');
assert.equal(run('PT1.5H', '', '').secondsTotal, 5400);
assert.equal(run('PT0.5S', '', '').secondsTotal, 0.5);
assert.equal(run('P3W', '', '').secondsTotal, 21 * 86400);
assert.equal(run('P1Y', '', '').monthsTotal, 12);
assert.equal(run('P1Y2M', '', '').monthsTotal, 14);
assert.equal(run('P1Y2M', '', '').nominal, true);
assert.equal(run('P3W', '', '').nominal, false, 'weeks are fixed and exact');

// ---- Totals: exact without calendar months, nominal with them.
const full = run('P1Y2M3DT4H5M6S', '', '');
assert.equal(full.totalDaysText, '423.17 days', '14 nominal months of 30 days plus 3 days 4h5m6s');
assert.equal(full.totalHoursText, '10,156.085 h');
assert.equal(full.totalMinutesText, '609,365.1 min');
assert.equal(full.exactSecondsText, null, 'months make the total nominal, not exact');
assert.equal(run('P3W', '', '').totalDaysText, '21 days');
assert.equal(run('P3W', '', '').totalHoursText, '504 h');
assert.equal(run('P3W', '', '').exactSecondsText, '1,814,400 s');
assert.equal(run('P1D', '', '').totalDaysText, '1 day', 'one day is singular');
assert.equal(run('P1D', '', '').totalHoursText, '24 h');
assert.equal(run('P2D', '', '').totalDaysText, '2 days');
assert.equal(run('PT90M', '', '').totalHoursText, '1.5 h');
assert.equal(run('PT90M', '', '').totalMinutesText, '90 min');

// ---- Calendar arithmetic: month-end clamping, leap years, year boundaries.
const JAN31 = '2026-01-31';
assert.equal(run('P1M', JAN31, '09:00').endText, '2026-02-28 09:00:00 UTC');
assert.equal(run('P1M', JAN31, '09:00').end.weekday, 'Saturday');
assert.equal(run('P1M', JAN31, '09:00').clamped, true);
assert.equal(run('P1M', '2024-01-31', '00:00').endText, '2024-02-29 00:00:00 UTC');
assert.equal(run('P1M', '2026-03-31', '09:00').endText, '2026-04-30 09:00:00 UTC');
assert.equal(run('P1M', '2026-05-31', '09:00').endText, '2026-06-30 09:00:00 UTC');
assert.equal(run('P1M', '2026-08-31', '09:00').endText, '2026-09-30 09:00:00 UTC');
assert.equal(run('P1M', '2026-12-31', '23:59').endText, '2027-01-31 23:59:00 UTC');
assert.equal(run('P1M', '2026-12-31', '23:59').clamped, false);
assert.equal(run('P1Y', '2024-02-29', '12:00').endText, '2025-02-28 12:00:00 UTC');
assert.equal(run('P1Y', '2024-02-29', '12:00').clamped, true);
assert.equal(run('P4Y', '2024-02-29', '00:00').endText, '2028-02-29 00:00:00 UTC');
assert.equal(run('P4Y', '2024-02-29', '00:00').clamped, false);
assert.equal(run('P1Y', '1900-02-28', '00:00').endText, '1901-02-28 00:00:00 UTC');
assert.equal(run('P0D', JAN31, '09:00').endText, '2026-01-31 09:00:00 UTC');
assert.equal(run('P1M2DT3H', JAN31, '09:00').endText, '2026-03-02 12:00:00 UTC');
assert.equal(run('P1M2DT3H', '2026-12-31', '22:30').endText, '2027-02-03 01:30:00 UTC');
assert.equal(run('P1D', '1000-01-01', '00:00').endText, '1000-01-02 00:00:00 UTC');
assert.equal(run('P1D', '1000-01-01', '00:00').end.weekday, 'Thursday');
assert.equal(run('P10000D', JAN31, '09:00').endText, '2053-06-18 09:00:00 UTC');
assert.equal(run('PT15H30M', '2026-12-31', '18:45').endText, '2027-01-01 10:15:00 UTC');
assert.equal(run('P2Y3M4DT5H6M7S', '', '').endText, null, 'no start date means no end');

// End times round to the nearest second, halves up.
assert.equal(run('PT0.5S', JAN31, '09:00').endText, '2026-01-31 09:00:01 UTC');
assert.equal(run('PT0.25S', JAN31, '09:00').endText, '2026-01-31 09:00:00 UTC');
assert.equal(run('PT1.5M', JAN31, '09:00').endText, '2026-01-31 09:01:30 UTC');

// ---- Random durations: canonical form, totals identities, calendar agreement.
let seed = 20261111;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const dayIn = (year, month) => {
  const table = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month !== 2) return table[month - 1];
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
};
for (let iteration = 0; iteration < 250; iteration += 1) {
  const years = Math.floor(random() * 6);
  const months = Math.floor(random() * 14);
  const days = Math.floor(random() * 45);
  const hours = Math.floor(random() * 40);
  const minutes = Math.floor(random() * 90);
  const seconds = Math.floor(random() * 90);
  const parts = [];
  if (years) parts.push(years + 'Y');
  if (months) parts.push(months + 'M');
  if (days) parts.push(days + 'D');
  let iso = 'P' + parts.join('');
  if (hours || minutes || seconds) {
    iso += 'T' + (hours ? hours + 'H' : '') + (minutes ? minutes + 'M' : '') + (seconds ? seconds + 'S' : '');
  }
  if (iso === 'P') iso = 'PT0S';
  const year = 1500 + Math.floor(random() * 900);
  const month = 1 + Math.floor(random() * 12);
  const startDay = 1 + Math.floor(random() * dayIn(year, month));
  const startDate = String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' +
    String(startDay).padStart(2, '0');
  const startTime = String(Math.floor(random() * 24)).padStart(2, '0') + ':' +
    String(Math.floor(random() * 60)).padStart(2, '0');
  const result = run(iso, startDate, startTime);
  const label = 'random ' + iso + ' from ' + startDate + ' ' + startTime;

  assert.equal(result.iso, iso, label + ' canonical form is stable');
  assert.match(result.iso, /^P(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/,
    label + ' ISO shape');
  assert.equal(result.nominal, years + months > 0, label + ' nominal flag');
  assert.equal(result.monthsTotal, years * 12 + months, label + ' month total');
  assert.equal(result.secondsTotal, ((days * 86400) + (hours * 3600) + (minutes * 60) + seconds),
    label + ' second total is exact');
  assert.equal(result.totalHours, result.totalDays * 24, label + ' hours follow days');
  assert.equal(result.totalMinutes, result.totalDays * 1440, label + ' minutes follow days');
  if (result.nominal) {
    assert.equal(result.exactSecondsText, null, label + ' no exact seconds with months');
  } else {
    assert.equal(result.exactSecondsText, C.formatNumber(result.secondsTotal) + ' s', label + ' exact seconds text');
  }

  // The end date must be the clamped month shift, then the fixed seconds.
  const targetIndex = year * 12 + (month - 1) + years * 12 + months;
  const targetYear = Math.floor(targetIndex / 12);
  const targetMonth = (targetIndex % 12) + 1;
  const clampedDay = Math.min(startDay, dayIn(targetYear, targetMonth));
  const startMs = Date.UTC(targetYear, targetMonth - 1, clampedDay,
    Number(startTime.slice(0, 2)), Number(startTime.slice(3, 5)), 0);
  const expectedEnd = new Date(startMs + result.secondsTotal * 1000);
  assert.equal(result.end.date, expectedEnd.toISOString().slice(0, 10), label + ' end date');
  assert.equal(result.end.time, expectedEnd.toISOString().slice(11, 19), label + ' end time');
  assert.equal(result.end.weekday, ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][expectedEnd.getUTCDay()],
    label + ' weekday');
  assert.equal(result.clamped, clampedDay !== startDay, label + ' clamp flag');
  assert.ok(expectedEnd.getTime() >= startMs, label + ' time moves forward');
  assert.deepEqual(run(iso, startDate, startTime), result, label + ' deterministic');
}

// ---- Validation messages.
assert.equal(failure('', '2026-01-31', '09:00'), 'Enter a duration such as P1Y2M3DT4H5M6S.');
assert.equal(failure('   ', '2026-01-31', '09:00'), 'Enter a duration such as P1Y2M3DT4H5M6S.');
assert.equal(failure(null, '2026-01-31', '09:00'), 'Enter a duration such as P1Y2M3DT4H5M6S.');
for (const text of ['1Y', 'P1D2H', 'p1y', 'P-1D', 'PY', 'PT1H2', 'P1D!']) {
  assert.equal(failure(text, '2026-01-31', '09:00'),
    'Use an ISO 8601 duration such as P1Y2M3DT4H5M6S: P first, then years, months, weeks or days, then T before hours, minutes and seconds.',
    'format message for ' + text);
}
for (const text of ['P', 'PT']) {
  assert.equal(failure(text, '2026-01-31', '09:00'), 'Add at least one number, such as P1D or PT30M.');
}
for (const text of ['P1DT', 'PT']) {
  if (text === 'PT') continue;
  assert.equal(failure(text, '2026-01-31', '09:00'), 'Put at least one of hours, minutes or seconds after T.');
}
for (const text of ['P3W2D', 'P1Y3W', 'P3WT1H']) {
  assert.equal(failure(text, '2026-01-31', '09:00'),
    'A week duration such as P3W cannot be mixed with other units.', 'week rule for ' + text);
}
for (const text of ['P1.5M', 'P2.5Y', 'P1.5Y']) {
  assert.equal(failure(text, '2026-01-31', '09:00'),
    'Years and months must be whole numbers, because a fraction of a month has no fixed length.',
    'month fraction for ' + text);
}
for (const text of ['PT1.5H30M', 'P1.5DT2H', 'PT1.5M30S']) {
  assert.equal(failure(text, '2026-01-31', '09:00'),
    'Only the smallest unit can carry a decimal fraction, as in PT1.5H.', 'fraction order for ' + text);
}
assert.equal(failure('P1000000Y', '2026-01-31', '09:00'), 'Keep the duration under 120,000 months.');
assert.equal(failure('P1D', '2026-02-30', '09:00'), 'Enter a real calendar date to start from.');
assert.equal(failure('P1D', '2026-13-01', '09:00'), 'Enter a real calendar date to start from.');
assert.equal(failure('P1D', '999-01-01', '09:00'), 'Enter the start date as YYYY-MM-DD.');
assert.equal(failure('P1D', '2026-1-1', '09:00'), 'Enter the start date as YYYY-MM-DD.');
assert.equal(failure('P1D', '2026-01-31', '24:00'), 'Enter the start time as HH:MM in UTC.');
assert.equal(failure('P1D', '2026-01-31', '9:5'), 'Enter the start time as HH:MM in UTC.');
assert.equal(failure('P1D', '2026-01-31', '09:60'), 'Enter the start time as HH:MM in UTC.');
assert.equal(failure('P9000Y', '1000-01-01', '00:00'), 'That duration lands past the year 9999; use a shorter one.');
assert.equal(failure('P1D', '9999-12-31', '00:00'), 'That duration lands past the year 9999; use a shorter one.');
assert.equal(failure('P120000M', '2026-01-31', '09:00'), 'That duration lands past the year 9999; use a shorter one.');
assert.equal(failure('P120000M', '', ''), null, 'the largest month count is allowed without a start date');
assert.equal(failure(' P1D ', '2026-01-31', '09:00'), null, 'surrounding whitespace is trimmed');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2266, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'ISO 8601 Duration Calculator');
assert.equal(record.category, 'Time');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u23f1');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('30 days'), 'method states the nominal month');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 4, 'sources are cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 23, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 5, 'five boundary cases');
assert.equal(kinds('validation'), 10, 'ten validation cases');
for (const testCase of record.testCases) {
  const input = testCase.input;
  if (testCase.expectedError) {
    assert.equal(failure(input.duration, input.date, input.time), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(input.duration, input.date, input.time);
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
for (const tag of ['iso-8601', 'duration', 'duration-parser', 'timespan']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 8, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const id of ['duration', 'start-date', 'start-time']) {
  assert.ok(new RegExp('<label for="' + id + '">').test(html), 'visible label for ' + id);
}
assert.equal((html.match(/<input\b/g) || []).length, 3, 'three inputs');
assert.equal((html.match(/<button\b/g) || []).length, 3, 'three buttons');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status"/.test(html), 'copy feedback is announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:4[46]px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/@media \(max-width:700px\)/.test(html), 'a narrow layout is provided');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('iso 8601 duration calculator: 250 random durations, calendar clamps, 23 catalog cases and the page contract pass');
