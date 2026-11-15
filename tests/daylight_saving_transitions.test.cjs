/* Daylight saving transition finder: offset maths, transition search against
   pinned tz-database instants, next-change lookup, validation messages, the
   catalog record and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'daylight-saving-transitions';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* dst-core:start */';
const endMarker = '/* dst-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = DstCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const rows = (zone, year) => plain(C.transitionYear(zone, year));
const failure = (fn) => {
  try { fn(); } catch (error) { return error.message; }
  return null;
};
const summary = (row) => [row.utc, row.dateText, row.clockText, row.offsetText, row.shiftMinutes];

// ---- Constants.
assert.equal(C.MIN_YEAR, 1900);
assert.equal(C.MAX_YEAR, 2100);
assert.equal(C.DEFAULT_ZONE, 'America/New_York');
assert.equal(C.MAX_SCAN_DAYS, 400);
assert.equal(C.MS_MINUTE, 60000);
assert.equal(C.MS_DAY, 86400000);
assert.equal(C.SCAN_STEP_MS, 6 * 3600000);
assert.deepEqual(plain(C.MONTHS), ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
assert.deepEqual(plain(C.WEEKDAYS), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

// ---- Offset and clock formatting.
assert.deepEqual(
  [-180, -300, -210, 0, 60, 345, 825, 840].map((minutes) => C.formatOffset(minutes)),
  ['UTC-03:00', 'UTC-05:00', 'UTC-03:30', 'UTC+00:00', 'UTC+01:00', 'UTC+05:45', 'UTC+13:45', 'UTC+14:00']
);
assert.equal(C.formatOffset(-30), 'UTC-00:30');
assert.deepEqual([1, 30, 60, 90, 120].map((minutes) => C.formatShift(minutes)), [
  '1 minute', '30 minutes', '1 hour', '1 hour 30 min', '2 hours'
]);
assert.equal(C.formatClock({ h: 2, mi: 5 }), '02:05');
assert.equal(C.formatDateTime({ y: 2026, mo: 3, d: 8, h: 2, mi: 0 }), 'Sun 8 Mar 2026, 02:00');

// ---- Zone validation.
assert.equal(C.validZone('America/New_York'), true);
assert.equal(C.validZone('UTC'), true);
assert.equal(C.validZone(' Europe/Paris '), true);
assert.equal(C.validZone('Mars/Base'), false);
assert.equal(C.validZone(''), false);
assert.equal(C.validZone(null), false);

// ---- Offset lookup: wall clock and UTC offset agree at a known instant.
const winter = Date.UTC(2026, 0, 15, 12, 0, 0);
assert.deepEqual(plain(C.wallFields(winter, 'Europe/Berlin')), { y: 2026, mo: 1, d: 15, h: 13, mi: 0, s: 0 });
assert.equal(C.offsetMinutes(winter, 'Europe/Berlin'), 60);
assert.equal(C.offsetMinutes(winter, 'America/New_York'), -300);
assert.equal(C.offsetMinutes(winter, 'Asia/Kolkata'), 330);
assert.equal(C.offsetMinutes(Date.UTC(2026, 6, 15, 12), 'America/New_York'), -240);

// ---- Transitions pinned against the tz database.
assert.deepEqual(rows('America/New_York', 2026).map(summary), [
  ['2026-03-08T07:00:00.000Z', 'Sun 8 Mar 2026', '02:00 \u2192 03:00', 'UTC-05:00 \u2192 UTC-04:00', 60],
  ['2026-11-01T06:00:00.000Z', 'Sun 1 Nov 2026', '02:00 \u2192 01:00', 'UTC-04:00 \u2192 UTC-05:00', -60]
]);
assert.deepEqual(rows('Europe/London', 2026).map(summary), [
  ['2026-03-29T01:00:00.000Z', 'Sun 29 Mar 2026', '01:00 \u2192 02:00', 'UTC+00:00 \u2192 UTC+01:00', 60],
  ['2026-10-25T01:00:00.000Z', 'Sun 25 Oct 2026', '02:00 \u2192 01:00', 'UTC+01:00 \u2192 UTC+00:00', -60]
]);
assert.deepEqual(rows('Australia/Sydney', 2026).map(summary), [
  ['2026-04-04T16:00:00.000Z', 'Sun 5 Apr 2026', '03:00 \u2192 02:00', 'UTC+11:00 \u2192 UTC+10:00', -60],
  ['2026-10-03T16:00:00.000Z', 'Sun 4 Oct 2026', '02:00 \u2192 03:00', 'UTC+10:00 \u2192 UTC+11:00', 60]
]);
// Half-hour daylight saving and a 45-minute base offset.
assert.deepEqual(rows('Australia/Lord_Howe', 2026).map(summary), [
  ['2026-04-04T15:00:00.000Z', 'Sun 5 Apr 2026', '02:00 \u2192 01:30', 'UTC+11:00 \u2192 UTC+10:30', -30],
  ['2026-10-03T15:30:00.000Z', 'Sun 4 Oct 2026', '02:00 \u2192 02:30', 'UTC+10:30 \u2192 UTC+11:00', 30]
]);
assert.deepEqual(rows('Pacific/Chatham', 2026).map(summary), [
  ['2026-04-04T14:00:00.000Z', 'Sun 5 Apr 2026', '03:45 \u2192 02:45', 'UTC+13:45 \u2192 UTC+12:45', -60],
  ['2026-09-26T14:00:00.000Z', 'Sun 27 Sep 2026', '02:45 \u2192 03:45', 'UTC+12:45 \u2192 UTC+13:45', 60]
]);
// A change at local midnight names the earlier date on the new side.
assert.deepEqual(rows('America/Santiago', 2026).map(summary), [
  ['2026-04-05T03:00:00.000Z', 'Sun 5 Apr 2026', '00:00 \u2192 23:00 (Sat 4 Apr 2026)', 'UTC-03:00 \u2192 UTC-04:00', -60],
  ['2026-09-06T04:00:00.000Z', 'Sun 6 Sep 2026', '00:00 \u2192 01:00', 'UTC-04:00 \u2192 UTC-03:00', 60]
]);
// Historical rules before 1970 resolve from the same database.
assert.deepEqual(rows('America/New_York', 1975).map(summary), [
  ['1975-02-23T07:00:00.000Z', 'Sun 23 Feb 1975', '02:00 \u2192 03:00', 'UTC-05:00 \u2192 UTC-04:00', 60],
  ['1975-10-26T06:00:00.000Z', 'Sun 26 Oct 1975', '02:00 \u2192 01:00', 'UTC-04:00 \u2192 UTC-05:00', -60]
]);
assert.deepEqual(rows('Europe/Berlin', 1980).map(summary), [
  ['1980-04-06T01:00:00.000Z', 'Sun 6 Apr 1980', '02:00 \u2192 03:00', 'UTC+01:00 \u2192 UTC+02:00', 60],
  ['1980-09-28T01:00:00.000Z', 'Sun 28 Sep 1980', '03:00 \u2192 02:00', 'UTC+02:00 \u2192 UTC+01:00', -60]
]);
// Zones and years without a transition.
for (const zone of ['Asia/Kolkata', 'UTC', 'Asia/Tokyo', 'Asia/Tehran']) {
  assert.deepEqual(rows(zone, 2026), [], zone + ' has no 2026 transition');
}
assert.deepEqual(rows('Europe/Moscow', 2026), []);

// ---- Every row is internally consistent and ordered.
const many = ['America/New_York', 'Europe/Berlin', 'Australia/Adelaide', 'Pacific/Auckland', 'America/St_Johns'];
for (const zone of many) {
  const list = rows(zone, 2026);
  assert.equal(list.length, 2, zone + ' changes twice');
  assert.ok(list[0].at < list[1].at, zone + ' rows ascend');
  for (const row of list) {
    assert.equal(row.shiftMinutes, row.offsetAfter - row.offsetBefore, zone + ' shift matches offsets');
    assert.equal(row.offsetAfterText, C.formatOffset(row.offsetAfter));
    assert.equal(row.offsetBeforeText, C.formatOffset(row.offsetBefore));
    assert.equal(row.direction, row.shiftMinutes > 0 ? 'forward' : 'back');
    assert.equal(row.changeText, (row.shiftMinutes > 0 ? 'Forward ' : 'Back ') + C.formatShift(row.shiftMinutes));
    // The offset one day either side of the change differs by exactly the shift.
    assert.equal(C.offsetMinutes(row.at + C.MS_DAY, zone) - C.offsetMinutes(row.at - C.MS_DAY, zone), row.shiftMinutes);
    // The change instant itself already carries the new offset.
    assert.equal(C.offsetMinutes(row.at, zone), row.offsetAfter);
    assert.equal(C.offsetMinutes(row.at - 1, zone), row.offsetBefore);
  }
}

// ---- Next transition and status.
const midJune = Date.UTC(2026, 5, 1, 0, 0, 0);
assert.deepEqual(summary(plain(C.nextTransition('America/New_York', midJune))), [
  '2026-11-01T06:00:00.000Z', 'Sun 1 Nov 2026', '02:00 \u2192 01:00', 'UTC-04:00 \u2192 UTC-05:00', -60
]);
const midNovember = Date.UTC(2026, 10, 15, 12, 0, 0);
assert.deepEqual(summary(plain(C.nextTransition('America/New_York', midNovember))), [
  '2027-03-14T07:00:00.000Z', 'Sun 14 Mar 2027', '02:00 \u2192 03:00', 'UTC-05:00 \u2192 UTC-04:00', 60
]);
assert.equal(C.nextTransition('Asia/Kolkata', midNovember), null);
assert.equal(C.nextTransition('UTC', midNovember), null);

const berlin = plain(C.status('Europe/Berlin', midNovember));
assert.equal(berlin.offsetText, 'UTC+01:00');
assert.equal(berlin.localText, 'Sun 15 Nov 2026, 13:00');
assert.equal(berlin.next.utc, '2027-03-28T01:00:00.000Z');
assert.equal(berlin.daysUntil, 133);
const kolkata = plain(C.status('Asia/Kolkata', midNovember));
assert.equal(kolkata.offsetText, 'UTC+05:30');
assert.equal(kolkata.localText, 'Sun 15 Nov 2026, 17:30');
assert.equal(kolkata.next, null);
assert.equal(kolkata.daysUntil, null);

// ---- Validation messages.
assert.equal(failure(() => C.transitionYear('Mars/Base', 2026)),
  'Unknown time zone: use an IANA name such as America/Chicago.');
assert.equal(failure(() => C.transitionYear('', 2026)),
  'Unknown time zone: use an IANA name such as America/Chicago.');
assert.equal(failure(() => C.transitionYear('America/New_York', 1899)), 'Enter a year between 1900 and 2100.');
assert.equal(failure(() => C.transitionYear('America/New_York', 2101)), 'Enter a year between 1900 and 2100.');
assert.equal(failure(() => C.transitionYear('America/New_York', 2026.5)), 'Enter a whole year, such as 2026.');
assert.equal(failure(() => C.transitionYear('America/New_York', 'spring')), 'Enter a whole year, such as 2026.');
assert.equal(failure(() => C.nextTransition('Mars/Base', midNovember)),
  'Unknown time zone: use an IANA name such as America/Chicago.');
assert.equal(failure(() => C.status('Mars/Base', midNovember)),
  'Unknown time zone: use an IANA name such as America/Chicago.');

// ---- Catalog record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2295, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(record.name, 'Daylight Saving Transition Finder');
assert.equal(record.category, 'Time');
assert.equal(record.subcategory, 'General');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.deepEqual(record.tags, ['time', 'date-time', 'time-zone', 'daylight-saving', 'dst', 'clock-change', 'calendar']);
assert.ok(record.aliases.includes('DST Finder'), 'alias present');
assert.equal(record.sources.length, 1);
assert.equal(record.sources[0].url, 'https://www.iana.org/time-zones');
assert.ok(record.sources[0].title.includes('IANA Time Zone Database'));
assert.ok(record.testCases.length >= 6, 'catalog carries test cases');
const replay = record.testCases.filter((item) => item.kind === 'transition');
assert.ok(replay.length >= 5, 'pinned transition cases');
for (const item of replay) {
  const got = rows(item.input.zone, item.input.year);
  assert.deepEqual(got.map(summary), item.expected.rows, 'replay ' + item.name);
}
for (const item of record.testCases.filter((entry) => entry.kind === 'validation')) {
  const got = failure(() => C.transitionYear(item.input.zone, item.input.year));
  assert.equal(got, item.expected.error, 'replay ' + item.name);
}
const duplicates = catalog.tools.filter((tool) => tool.slug === slug || tool.name === record.name);
assert.equal(duplicates.length, 1, 'the slug and name stay unique');
assert.equal(catalog.tools.filter((tool) => /daylight|dst-transition|clock-change/.test(tool.slug)).length, 1, 'no sibling DST tool');

// ---- Page contract.
assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'one h1');
assert.ok(html.includes('<meta name="description"'), 'description meta');
assert.ok(html.includes('href="/assets/style.css"'), 'shared stylesheet');
assert.ok(html.includes('src="/assets/app.js"'), 'shared header script');
assert.ok(html.includes('id="site-header"'), 'shared header slot');
assert.ok(html.includes('aria-live="polite"'), 'live region');
assert.ok(html.includes('role="alert"'), 'error alert role');
assert.ok(!/tool-sources|Sources<\/h2>/.test(html), 'sources come from the shared renderer, not the page');
assert.ok(/<label for="zone">/.test(html) && /<label for="year">/.test(html) && /<label for="custom">/.test(html), 'labelled controls');
assert.ok(/<button type="submit">/.test(html) && /<button type="button"/.test(html), 'explicit button types');
assert.ok(html.includes('<caption id="changes-caption">'), 'table caption');
assert.equal((html.match(/<th scope="col">/g) || []).length, 4, 'four table columns');
assert.ok(html.includes('.ref-wrap') && html.includes('overflow-x:auto'), 'scrolling table wrapper');
assert.ok(html.includes('role="region" aria-labelledby="changes-caption" tabindex="0"'), 'table region is labelled and focusable');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie/.test(html), 'no network or storage');
assert.ok(!/https?:\/\//.test(html), 'the page hardcodes no URLs');
assert.ok(!/[^\x00-\x7F]/.test(html), 'source stays ASCII');
assert.ok(html.includes('dst-core:start') && html.includes('dst-core:end'), 'core markers');
assert.ok(!/eval\(|new Function/.test(html), 'no dynamic evaluation');
assert.equal((html.match(/<html lang="en">/g) || []).length, 1, 'english document');
assert.ok(html.includes('name="viewport"'), 'viewport meta');

// ---- Two searches agree on the same year.
const first = rows('Europe/Berlin', 2026);
const second = rows('Europe/Berlin', 2026);
assert.deepEqual(first, second, 'repeated lookups are identical');
assert.deepEqual(rows('Europe/Berlin', 2025).map((row) => row.utc), [
  '2025-03-30T01:00:00.000Z', '2025-10-26T01:00:00.000Z'
]);

console.log('daylight saving transition finder: ' + 'all checks passed');
