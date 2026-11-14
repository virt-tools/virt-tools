/* Time scale converter: the leap-second table against IANA's, published time
   scale anchors, GPS week arithmetic and rollover, leap-second labels, range
   and validation behaviour, catalog replay, and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'time-scale-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* time-scale-core:start */';
const endMarker = '/* time-scale-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TimeScaleCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (date, time) => plain(C.convert(date, time));
const failure = (date, time) => {
  try { run(date, time); } catch (error) { return error.message; }
  return null;
};
const rows = (result) => new Map(result.rows.map((row) => [row.k, row.v]));
const ROW_LABELS = [
  'GPS time', 'GPS \u2212 UTC', 'GPS week', 'GPS week day (Sunday = 0)',
  'GPS seconds of week', 'TT (terrestrial time)',
];

// ---- Exported contract.
assert.equal(C.GPS_EPOCH_UNIX, 315964800, 'the GPS epoch is 1980-01-06T00:00:00Z');
assert.equal(C.GPS_EPOCH_TAI_MINUS_UTC, 19);
assert.equal(C.TT_MINUS_TAI_SECONDS, 32.184);
assert.equal(C.WEEK_SECONDS, 604800);
assert.equal(C.MIN_DATE, '1972-01-01');
assert.equal(C.MAX_DATE, '2100-12-31');
assert.equal(C.DEFAULT_DATE, '2026-11-13');
assert.equal(C.DEFAULT_TIME, '05:06:44');
assert.equal(C.WEEKDAYS.length, 7);
assert.equal(C.WEEKDAYS[0], 'Sunday');

// ---- The leap table is IANA's, offset 10 at 1972-01-01 stepping to 37 at
// 2017-01-01, one second at a time, at whole-day boundaries.
const table = plain(C.LEAP_TABLE);
assert.equal(table.length, 28, 'twenty-eight rows');
assert.equal(table[0].unix, 63072000);
assert.equal(table[0].offset, 10);
assert.equal(table[table.length - 1].unix, 1483228800);
assert.equal(table[table.length - 1].offset, 37);
for (let index = 0; index < table.length; index += 1) {
  assert.equal(table[index].unix % 86400, 0, 'row ' + index + ' starts at midnight');
  if (index > 0) assert.equal(table[index].offset, table[index - 1].offset + 1, 'row ' + index + ' adds one second');
}
assert.equal(C.offsetAt(63072000), 10);
assert.equal(C.offsetAt(63071999), 10, 'the offset before the table start is the 1972 value');
assert.equal(C.offsetAt(1483228799), 36);
assert.equal(C.offsetAt(1483228800), 37);
assert.equal(C.offsetAt(1893456000), 37, 'no leap second after 2017');
const leapDays = C.leapDays();
assert.equal(leapDays.length, 27, 'twenty-seven leap days');
assert.equal(leapDays[0], '1972-06-30');
assert.equal(leapDays[leapDays.length - 1], '2016-12-31');
assert.ok(leapDays.includes('2015-06-30'));
assert.equal(C.lastLeapSecond().text, '2016-12-31T23:59:60Z');
assert.equal(C.lastLeapSecond().offset, 37);

// ---- Calendar arithmetic: 1970-01-01 is day 0, the GPS epoch is day 3657,
// and the conversion round-trips across the whole supported range.
assert.equal(C.daysFromCivil(1970, 1, 1), 0);
assert.equal(C.daysFromCivil(1980, 1, 6), 3657);
assert.equal(C.daysFromCivil(2000, 3, 1), 11017);
assert.deepEqual(plain(C.civilFromDays(0)), { y: 1970, m: 1, d: 1 });
assert.deepEqual(plain(C.civilFromDays(3657)), { y: 1980, m: 1, d: 6 });
assert.deepEqual(plain(C.civilFromDays(11017)), { y: 2000, m: 3, d: 1 });
for (let day = -1000; day <= 50000; day += 37) {
  const civil = C.civilFromDays(day);
  assert.equal(C.daysFromCivil(civil.y, civil.m, civil.d), day, 'day round trip ' + day);
}
assert.equal(C.isLeapYear(2000), true);
assert.equal(C.isLeapYear(1900), false);
assert.equal(C.isLeapYear(2024), true);
assert.equal(C.daysInMonth(2026, 2), 28);
assert.equal(C.daysInMonth(2024, 2), 29);

// ---- Published anchors.
let result = run('1972-01-01', '00:00:00');
assert.equal(result.tai, '1972-01-01 00:00:10', 'TAI-UTC was 10 s when the leap-second system began');
assert.equal(result.offset, 10);
assert.equal(result.gps, null, 'GPS time does not exist in 1972');
for (const label of ROW_LABELS.slice(0, 5)) {
  assert.equal(rows(result).get(label), '\u2014', 'pre-1980 GPS row is blank: ' + label);
}
assert.ok(result.subText.includes('GPS time starts 1980-01-06'));

result = run('1972-06-30', '23:59:60');
assert.equal(result.tai, '1972-07-01 00:00:10', 'the first inserted leap second');
assert.equal(result.leapSecond, true);
assert.equal(result.offset, 10, 'the leap second uses the offset in force before the step');
assert.equal(run('1972-07-01', '00:00:00').tai, '1972-07-01 00:00:11', 'midnight is one TAI second later');

result = run('1980-01-06', '00:00:00');
assert.equal(result.tai, '1980-01-06 00:00:19');
assert.equal(result.gps, '1980-01-06 00:00:00', 'GPS seconds start at the epoch');
assert.equal(result.gpsWeek, 0);
assert.equal(result.gpsWeekSeconds, 0);
assert.equal(rows(result).get('GPS \u2212 UTC'), '0 s');
assert.equal(run('1980-01-05', '23:59:59').gps, null, 'one second earlier there is no GPS time');

result = run('2017-01-01', '00:00:00');
assert.equal(result.tai, '2017-01-01 00:00:37');
assert.equal(result.offset, 37);
assert.equal(result.gps, '2017-01-01 00:00:18');
assert.equal(result.tt, '2017-01-01 00:01:09.184', 'TT is TAI plus 32.184 s');
assert.equal(rows(result).get('GPS \u2212 UTC'), '18 s');

result = run('2016-12-31', '23:59:60');
assert.equal(result.utc, '2016-12-31 23:59:60', 'the leap-second label is echoed');
assert.equal(result.tai, '2017-01-01 00:00:36', 'the inserted second sits one second before midnight');
assert.equal(result.offset, 36);
assert.equal(result.gps, '2017-01-01 00:00:17');
assert.equal(rows(result).get('GPS \u2212 UTC'), '17 s', 'GPS is continuous through the leap second');
assert.equal(result.tt, '2017-01-01 00:01:08.184');
assert.equal(result.leapSecond, true);

// ---- GPS week and the 1,024-week rollover at 2019-04-06T23:59:42Z.
result = run('2019-04-06', '23:59:41');
assert.equal(result.gpsWeek, 2047);
assert.equal(result.gpsWeekSeconds, 604799);
assert.equal(result.gpsDay, 6);
result = run('2019-04-06', '23:59:42');
assert.equal(result.gpsWeek, 2048, 'week 2048 starts at the rollover');
assert.equal(result.gpsWeekSeconds, 0);
assert.equal(result.gpsDay, 0);
assert.equal(result.gps, '2019-04-07 00:00:00');
assert.equal(rows(result).get('GPS week'), '2,048');

// ---- Invariants over a wide sweep of instants across every leap era.
const unformat = (text) => Number(String(text).replace(/[^0-9.-]/g, ''));
let previousWeek = -1;
for (let seconds = 63072000; seconds <= 4133894400; seconds += 86400 * 11 + 3607) {
  const days = Math.floor(seconds / 86400);
  const civil = C.civilFromDays(days);
  const sod = seconds - days * 86400;
  const pad = (value) => String(value).padStart(2, '0');
  const label = civil.y + '-' + pad(civil.m) + '-' + pad(civil.d) + ' ' +
    pad(Math.floor(sod / 3600)) + ':' + pad(Math.floor((sod % 3600) / 60)) + ':' + pad(sod % 60);
  const item = run(civil.y + '-' + pad(civil.m) + '-' + pad(civil.d),
    pad(Math.floor(sod / 3600)) + ':' + pad(Math.floor((sod % 3600) / 60)) + ':' + pad(sod % 60));
  assert.equal(item.offset, C.offsetAt(seconds), label + ' offset');
  assert.equal(item.tai, C.stamp(seconds + item.offset), label + ' TAI label');
  assert.ok(item.tt.endsWith('.184'), label + ' TT keeps the .184 fraction');
  const taiMs = Date.parse(item.tai.replace(' ', 'T') + 'Z');
  const ttMs = Date.parse(item.tt.slice(0, 19).replace(' ', 'T') + 'Z');
  assert.equal(ttMs - taiMs, 32000, label + ' TT is TAI plus 32 s and .184 s');
  assert.equal(item.tt.slice(19), '.184', label + ' TT millisecond fraction');
  if (item.gps === null) {
    assert.ok(seconds < 315964819, label + ' GPS only before the epoch is blank');
    continue;
  }
  const gpsSeconds = Number(item.gpsWeek) * 604800 + Number(item.gpsWeekSeconds);
  assert.equal(item.gps, C.stamp(315964800 + gpsSeconds), label + ' GPS label');
  assert.equal(item.offset - 19, unformat(rows(item).get('GPS \u2212 UTC')), label + ' GPS minus UTC');
  assert.ok(Number(item.gpsWeekSeconds) >= 0 && Number(item.gpsWeekSeconds) < 604800, label + ' seconds of week in range');
  assert.ok(Number(item.gpsDay) >= 0 && Number(item.gpsDay) <= 6, label + ' week day in range');
  assert.equal(Number(item.gpsDay), Math.floor(Number(item.gpsWeekSeconds) / 86400), label + ' week day from seconds of week');
  assert.ok(Number(item.gpsWeek) >= previousWeek, label + ' GPS week never goes backwards');
  previousWeek = Number(item.gpsWeek);
}
assert.ok(previousWeek > 2400, 'the sweep reached the 2020s');

// ---- Leap-second labels are accepted only on the 27 leap days.
for (const date of leapDays) {
  assert.equal(run(date, '23:59:60').leapSecond, true, date + ' accepts the inserted second');
}
assert.equal(failure('2026-11-13', '12:00:60'),
  'Second must be 0-59, or 60 at an inserted leap second.');
assert.equal(failure('2016-12-31', '12:00:60'),
  'Second must be 0-59, or 60 at an inserted leap second.');
assert.equal(failure('2016-12-30', '23:59:60'),
  'Second must be 0-59, or 60 at an inserted leap second.');
assert.equal(failure('2016-12-31', '23:59:61'),
  'Second must be 0-59, or 60 at an inserted leap second.');

// ---- Validation messages.
assert.equal(failure('13/11/2026', '05:06:44'), 'Enter the date as YYYY-MM-DD.');
assert.equal(failure('', '05:06:44'), 'Enter the date as YYYY-MM-DD.');
assert.equal(failure('2026-13-01', '05:06:44'), 'Month must be 1-12.');
assert.equal(failure('2026-02-30', '05:06:44'), 'Day is out of range for 2026-02.');
assert.equal(failure('2024-02-30', '05:06:44'), 'Day is out of range for 2024-02.');
assert.equal(failure('2026-11-13', '24:00:00'), 'Hour must be 0-23.');
assert.equal(failure('2026-11-13', '05:60:00'), 'Minute must be 0-59.');
assert.equal(failure('2026-11-13', '5.06.44'), 'Enter the time as HH:MM:SS in 24-hour UTC.');
assert.equal(failure('2026-11-13', ''), 'Enter the time as HH:MM:SS in 24-hour UTC.');
assert.equal(failure('1971-12-31', '23:59:59'),
  'This converter covers UTC from 1972-01-01 through 2100-12-31.');
assert.equal(failure('2101-01-01', '00:00:00'),
  'This converter covers UTC from 1972-01-01 through 2100-12-31.');
assert.equal(run('2026-11-13', '05:06').utc, '2026-11-13 05:06:00', 'a missing seconds field means :00');
assert.equal(run('2026-11-13', '5:06:44').utc, '2026-11-13 05:06:44', 'a single-digit hour is accepted');
assert.equal(run('2100-12-31', '23:59:59').offset, 37, 'the last supported second');
assert.equal(run('1972-01-01', '00:00:00').offset, 10, 'the first supported second');

// ---- Determinism and immutability of the shared table.
assert.deepEqual(run('2026-11-13', '05:06:44'), run('2026-11-13', '05:06:44'));
assert.equal(plain(C.LEAP_TABLE).length, 28, 'the table is not mutated by use');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2264, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Time Scale Converter');
assert.equal(record.category, 'Time');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1f6f0}');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('32.184'), 'method states the TT offset');
assert.ok(record.method.includes('604,800'), 'method states the GPS week length');
assert.ok(record.method.includes('37 s'), 'method states the current offset');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 4, 'sources are cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 19, 'catalog case count');
assert.equal(kinds('golden'), 9, 'nine golden cases');
assert.equal(kinds('validation'), 10, 'ten validation cases');
for (const testCase of record.testCases) {
  const { date, time } = testCase.input;
  if (testCase.expected.error) {
    assert.equal(failure(date, time), testCase.expected.error, testCase.name);
    continue;
  }
  const actual = run(date, time);
  const expected = testCase.expected;
  assert.equal(actual.utc, expected.utc, testCase.name + ' utc');
  assert.equal(actual.tai, expected.tai, testCase.name + ' tai');
  assert.equal(actual.offset, expected.offset, testCase.name + ' offset');
  assert.equal(actual.tt, expected.tt, testCase.name + ' tt');
  assert.equal(actual.gps, expected.gps, testCase.name + ' gps');
  assert.equal(actual.gpsAvailable ? actual.rows[1].v : null, expected.gpsOffset, testCase.name + ' gpsOffset');
  assert.equal(actual.gpsWeek, expected.gpsWeek, testCase.name + ' gpsWeek');
  assert.equal(actual.gpsWeekSeconds, expected.gpsWeekSeconds, testCase.name + ' gpsWeekSeconds');
  assert.equal(actual.gpsDay, expected.gpsDay, testCase.name + ' gpsDay');
  assert.equal(actual.subText, expected.subText, testCase.name + ' subText');
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
for (const tag of ['atomic-time', 'tai', 'gps-time', 'gps-week', 'leap-second']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 6, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const id of ['date', 'time']) {
  assert.ok(html.includes('<label for="' + id + '">'), 'control has a visible label: ' + id);
}
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status"/.test(html), 'copy feedback is announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="numeric"/.test(html), 'numeric keyboards on touch');
assert.equal((html.match(/<input /g) || []).length, 2, 'two text inputs');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('time scale converter: IANA table, 9 anchors, a sweep, leap-second labels, 19 catalog cases and the page contract pass');
