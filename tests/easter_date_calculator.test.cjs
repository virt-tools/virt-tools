/* Easter date calculator: Gregorian and Julian computus goldens, the Julian
   to Gregorian offset, calendar range properties across every supported year,
   moveable feasts, refusals, the catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'easter-date-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* easter-core:start */';
const endMarker = '/* easter-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = EasterCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (year) => plain(C.calculate(year));
const failure = (year) => {
  try { run(year); } catch (error) { return error.message; }
  return null;
};
const iso = (parts) => parts.year + '-' + String(parts.month).padStart(2, '0') + '-' + String(parts.day).padStart(2, '0');
const pad2 = (value) => (value < 10 ? '0' : '') + value;

// ---- Constants.
assert.equal(C.MIN_YEAR, 1583);
assert.equal(C.MAX_YEAR, 4099);
assert.equal(C.FEASTS.length, 9, 'nine moveable feasts');
assert.deepEqual(plain(C.FEASTS.map((feast) => feast.offset)), [-46, -7, -3, -2, 1, 39, 49, 56, 60]);
assert.deepEqual(plain(C.FEASTS.map((feast) => feast.name)),
  ['Ash Wednesday', 'Palm Sunday', 'Maundy Thursday', 'Good Friday', 'Easter Monday',
    'Ascension Day', 'Pentecost', 'Trinity Sunday', 'Corpus Christi']);
const nowYear = C.currentYear();
assert.equal(typeof nowYear, 'number');
assert.ok(Number.isInteger(nowYear) && nowYear >= C.MIN_YEAR && nowYear < C.MAX_YEAR, 'the default year is in range');

// ---- Gregorian computus: published Easter dates.
const gregorianGoldens = [
  [1598, '1598-03-22'], [1666, '1666-04-25'], [1818, '1818-03-22'], [2000, '2000-04-23'],
  [2010, '2010-04-04'], [2011, '2011-04-24'], [2012, '2012-04-08'], [2013, '2013-03-31'],
  [2014, '2014-04-20'], [2015, '2015-04-05'], [2016, '2016-03-27'], [2017, '2017-04-16'],
  [2018, '2018-04-01'], [2019, '2019-04-21'], [2020, '2020-04-12'], [2021, '2021-04-04'],
  [2022, '2022-04-17'], [2023, '2023-04-09'], [2024, '2024-03-31'], [2025, '2025-04-20'],
  [2026, '2026-04-05'], [2027, '2027-03-28'], [2028, '2028-04-16'], [2029, '2029-04-01'],
  [2030, '2030-04-21'], [2038, '2038-04-25'], [2285, '2285-03-22']
];
for (const [year, expected] of gregorianGoldens) {
  const parts = C.gregorianEaster(year);
  assert.equal(iso(parts), expected, 'Gregorian Easter ' + year);
  assert.equal(parts.year, year);
  assert.equal(C.weekdayIndex(parts), 0, 'Gregorian Easter is a Sunday in ' + year);
}

// ---- Julian computus: the Julian calendar date of Orthodox Easter.
const julianGoldens = [
  [2019, '2019-04-15'], [2020, '2020-04-06'], [2021, '2021-04-19'], [2022, '2022-04-11'],
  [2023, '2023-04-03'], [2024, '2024-04-22'], [2025, '2025-04-07'], [2026, '2026-03-30'],
  [2027, '2027-04-19'], [2028, '2028-04-03']
];
for (const [year, expected] of julianGoldens) {
  const parts = C.julianEaster(year);
  assert.equal(iso(parts), expected, 'Julian Easter ' + year);
  assert.equal(C.weekdayIndex(C.orthodoxEaster(year)), 0, 'the converted date is a Sunday in ' + year);
}

// ---- The offset between the calendars follows the century leap rule.
assert.equal(C.julianOffset(1583), 10);
assert.equal(C.julianOffset(1699), 10);
assert.equal(C.julianOffset(1700), 11);
assert.equal(C.julianOffset(1800), 12);
assert.equal(C.julianOffset(1900), 13);
assert.equal(C.julianOffset(2000), 13);
assert.equal(C.julianOffset(2099), 13);
assert.equal(C.julianOffset(2100), 14);
assert.equal(C.julianOffset(4099), 28);
for (let year = C.MIN_YEAR; year <= C.MAX_YEAR; year += 1) {
  const expected = Math.floor(year / 100) - Math.floor(year / 400) - 2;
  assert.equal(C.julianOffset(year), expected, 'offset formula ' + year);
  assert.ok(C.julianOffset(year) >= 10 && C.julianOffset(year) <= 28, 'offset stays in the observed band');
}

// ---- Orthodox Easter in the Gregorian calendar: published dates.
const orthodoxGoldens = [
  [2000, '2000-04-30'], [2016, '2016-05-01'], [2017, '2017-04-16'], [2018, '2018-04-08'],
  [2019, '2019-04-28'], [2020, '2020-04-19'], [2021, '2021-05-02'], [2022, '2022-04-24'],
  [2023, '2023-04-16'], [2024, '2024-05-05'], [2025, '2025-04-20'], [2026, '2026-04-12'],
  [2027, '2027-05-02'], [2028, '2028-04-16'], [2038, '2038-04-25'], [1818, '1818-04-26']
];
for (const [year, expected] of orthodoxGoldens) {
  assert.equal(iso(C.orthodoxEaster(year)), expected, 'Orthodox Easter ' + year);
  assert.equal(C.weekdayIndex(C.orthodoxEaster(year)), 0, 'Orthodox Easter is a Sunday in ' + year);
}

// ---- The default result, field by field.
const result = run('2026');
assert.equal(result.year, 2026);
assert.equal(result.westernIso, '2026-04-05');
assert.equal(result.westernLong, 'April 5, 2026');
assert.equal(result.westernWeekday, 'Sunday');
assert.deepEqual(result.orthodoxJulian, { year: 2026, month: 3, day: 30 });
assert.equal(result.orthodoxJulianIso, '2026-03-30');
assert.equal(result.orthodoxJulianLong, 'March 30, 2026');
assert.equal(result.orthodoxIso, '2026-04-12');
assert.equal(result.orthodoxLong, 'April 12, 2026');
assert.equal(result.orthodoxWeekday, 'Sunday');
assert.equal(result.offsetDays, 13);
assert.equal(result.gapDays, 7);
assert.equal(result.gapText, 'Orthodox Easter falls 7 days after Western Easter.');

// ---- Formatting and day arithmetic.
assert.equal(C.formatIso({ year: 2026, month: 3, day: 4 }), '2026-03-04');
assert.equal(C.formatLong({ year: 2026, month: 12, day: 31 }), 'December 31, 2026');
assert.equal(C.daysBetween({ year: 2026, month: 4, day: 5 }, { year: 2026, month: 4, day: 12 }), 7);
assert.equal(C.daysBetween({ year: 2024, month: 2, day: 28 }, { year: 2024, month: 3, day: 1 }), 2, 'leap February');
assert.equal(C.daysBetween({ year: 2023, month: 2, day: 28 }, { year: 2023, month: 3, day: 1 }), 1, 'common February');
assert.equal(C.daysBetween({ year: 2026, month: 4, day: 12 }, { year: 2026, month: 4, day: 5 }), -7);
assert.equal(C.weekdayName({ year: 2026, month: 4, day: 5 }), 'Sunday');
assert.equal(C.weekdayIndex({ year: 1583, month: 4, day: 10 }), 0);

// ---- Across every supported year: Sunday, bounded, and a whole number of weeks apart.
let earliest = null;
let latest = null;
let earliestOrthodox = null;
let latestOrthodox = null;
for (let year = C.MIN_YEAR; year <= C.MAX_YEAR; year += 1) {
  const western = C.gregorianEaster(year);
  const julian = C.julianEaster(year);
  const orthodox = C.orthodoxEaster(year);
  const westernKey = western.month * 100 + western.day;
  const orthodoxKey = orthodox.month * 100 + orthodox.day;
  const julianKey = julian.month * 100 + julian.day;

  assert.equal(C.weekdayIndex(western), 0, 'Western Easter is a Sunday in ' + year);
  assert.equal(C.weekdayIndex(orthodox), 0, 'Orthodox Easter is a Sunday in ' + year);
  assert.ok(westernKey >= 322 && westernKey <= 425, 'Gregorian Easter stays between 22 March and 25 April in ' + year);
  assert.ok(julianKey >= 322 && julianKey <= 425, 'Julian Easter stays between 22 March and 25 April in ' + year);
  assert.ok(orthodoxKey >= 401 && orthodoxKey <= 522, 'Orthodox Easter stays between 1 April and 22 May in ' + year);
  assert.equal(C.daysBetween(julian, orthodox), C.julianOffset(year), 'the offset converts the Julian date in ' + year);
  const gap = C.daysBetween(western, orthodox);
  assert.equal(gap % 7, 0, 'the two Easters are a whole number of weeks apart in ' + year);

  if (!earliest || westernKey < earliest.key) earliest = { key: westernKey, year, iso: iso(western) };
  if (!latest || westernKey > latest.key) latest = { key: westernKey, year, iso: iso(western) };
  if (!earliestOrthodox || orthodoxKey < earliestOrthodox.key) earliestOrthodox = { key: orthodoxKey, year, iso: iso(orthodox) };
  if (!latestOrthodox || orthodoxKey > latestOrthodox.key) latestOrthodox = { key: orthodoxKey, year, iso: iso(orthodox) };
}
assert.deepEqual(earliest, { key: 322, year: 1598, iso: '1598-03-22' }, 'earliest Gregorian Easter');
assert.deepEqual(latest, { key: 425, year: 1666, iso: '1666-04-25' }, 'latest Gregorian Easter');
assert.deepEqual(earliestOrthodox, { key: 401, year: 1668, iso: '1668-04-01' }, 'earliest Orthodox Easter');
assert.deepEqual(latestOrthodox, { key: 522, year: 3864, iso: '3864-05-22' }, 'latest Orthodox Easter');

// ---- Moveable feasts keep their weekday and sit at their fixed offsets.
const weekdayByFeast = {
  'Ash Wednesday': 'Wednesday', 'Palm Sunday': 'Sunday', 'Maundy Thursday': 'Thursday',
  'Good Friday': 'Friday', 'Easter Monday': 'Monday', 'Ascension Day': 'Thursday',
  'Pentecost': 'Sunday', 'Trinity Sunday': 'Sunday', 'Corpus Christi': 'Thursday'
};
const shortByFeast = {
  'Ash Wednesday': 'Wed', 'Palm Sunday': 'Sun', 'Maundy Thursday': 'Thu', 'Good Friday': 'Fri',
  'Easter Monday': 'Mon', 'Ascension Day': 'Thu', 'Pentecost': 'Sun', 'Trinity Sunday': 'Sun',
  'Corpus Christi': 'Thu'
};
const feasts2026 = result.feasts;
assert.equal(feasts2026.length, 9);
assert.deepEqual(feasts2026.map((feast) => feast.iso),
  ['2026-02-18', '2026-03-29', '2026-04-02', '2026-04-03', '2026-04-06',
    '2026-05-14', '2026-05-24', '2026-05-31', '2026-06-04']);
assert.deepEqual(feasts2026.map((feast) => feast.weekdayShort), ['Wed', 'Sun', 'Thu', 'Fri', 'Mon', 'Thu', 'Sun', 'Sun', 'Thu']);
assert.match(feasts2026[0].short, /^Feb 18$/, 'the short date omits the year');

let seed = 20261114;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let iteration = 0; iteration < 120; iteration += 1) {
  const year = C.MIN_YEAR + Math.floor(random() * (C.MAX_YEAR - C.MIN_YEAR + 1));
  const sample = run(String(year));
  const western = C.gregorianEaster(year);
  for (const feast of sample.feasts) {
    const shift = Date.UTC(western.year, western.month - 1, western.day) + feast.offset * 86400000;
    const shifted = new Date(shift);
    const expectedIso = shifted.getUTCFullYear() + '-' + pad2(shifted.getUTCMonth() + 1) + '-' + pad2(shifted.getUTCDate());
    assert.equal(feast.iso, expectedIso, 'feast offset ' + feast.name + ' in ' + year);
    assert.equal(feast.weekday, weekdayByFeast[feast.name], feast.name + ' weekday in ' + year);
    assert.equal(feast.weekdayShort, shortByFeast[feast.name], feast.name + ' short weekday in ' + year);
    assert.equal(C.weekdayName({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }),
      weekdayByFeast[feast.name], feast.name + ' weekday index in ' + year);
  }
  assert.equal(sample.gapDays, C.daysBetween(western, C.orthodoxEaster(year)), 'gap matches the calendar dates in ' + year);
  assert.equal(sample.gapText === 'Both calendars put Easter on the same day.', sample.gapDays === 0, 'the gap text matches in ' + year);
}

// ---- The nearby-years table stays inside the supported range.
assert.deepEqual(result.upcoming.map((row) => row.year), [2026, 2027, 2028, 2029, 2030]);
assert.deepEqual(result.upcoming.map((row) => row.westernIso),
  ['2026-04-05', '2027-03-28', '2028-04-16', '2029-04-01', '2030-04-21']);
assert.deepEqual(result.upcoming.map((row) => row.orthodoxIso),
  ['2026-04-12', '2027-05-02', '2028-04-16', '2029-04-08', '2030-04-28']);
assert.deepEqual(result.upcoming.map((row) => row.westernShort), ['Apr 5', 'Mar 28', 'Apr 16', 'Apr 1', 'Apr 21']);
for (const row of result.upcoming) {
  assert.equal(iso(C.gregorianEaster(row.year)), row.westernIso, 'upcoming Western date ' + row.year);
  assert.equal(iso(C.orthodoxEaster(row.year)), row.orthodoxIso, 'upcoming Orthodox date ' + row.year);
}
assert.equal(run('4099').upcoming.length, 1, 'no rows beyond the supported range');
assert.equal(run('4095').upcoming.length, 5, 'a full table still fits below the ceiling');
assert.equal(run(String(C.MIN_YEAR)).upcoming.length, 5);

// ---- Refusals carry the exact reason.
assert.equal(failure(''), 'Enter a year to calculate Easter, such as 2026.');
assert.equal(failure('   '), 'Enter a year to calculate Easter, such as 2026.');
assert.equal(failure(null), 'Enter a year to calculate Easter, such as 2026.');
assert.equal(failure(undefined), 'Enter a year to calculate Easter, such as 2026.');
assert.equal(failure('26'), 'Enter the year as a four-digit number, such as 2026.');
assert.equal(failure('2026.5'), 'Enter the year as a four-digit number, such as 2026.');
assert.equal(failure('20x6'), 'Enter the year as a four-digit number, such as 2026.');
assert.equal(failure('-2026'), 'Enter the year as a four-digit number, such as 2026.');
assert.equal(failure('+2026'), 'Enter the year as a four-digit number, such as 2026.');
assert.equal(failure('12026'), 'Enter the year as a four-digit number, such as 2026.');
assert.equal(failure('1582'), 'Year must be between 1583 and 4099.');
assert.equal(failure('4100'), 'Year must be between 1583 and 4099.');
assert.equal(failure('0000'), 'Year must be between 1583 and 4099.');
assert.equal(C.parseYear(' 2026 '), 2026, 'surrounding whitespace is trimmed');
assert.equal(C.parseYear('1583'), 1583, 'the floor is allowed');
assert.equal(C.parseYear('4099'), 4099, 'the ceiling is allowed');
assert.equal(failure('2026') === null, true);

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2273, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Easter Date Calculator');
assert.equal(record.category, 'Time');
assert.equal(record.subcategory, 'General');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1f423}');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('computus'), 'method names the computus rule');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 3, 'sources are cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 12, 'catalog case count');
assert.equal(kinds('golden'), 6, 'six golden cases');
assert.equal(kinds('boundary'), 2, 'two boundary cases');
assert.equal(kinds('validation'), 4, 'four validation cases');
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input.year), testCase.expectedError, testCase.name);
    continue;
  }
  const observed = run(testCase.input.year);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(observed[key], expected, testCase.name + ' ' + key);
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
for (const tag of ['time', 'date-time', 'calendar', 'easter', 'holidays', 'liturgical']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 8, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="year">/.test(html), 'the year field has a label');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok((html.match(/<caption>/g) || []).length === 3, 'all three tables are described');
assert.ok(/<th scope="col">/.test(html) && /<th scope="row">/.test(html), 'table headers are scoped');
assert.equal((html.match(/<th scope="col">/g) || []).length, 8, 'two detail, three feast and three year columns');
assert.equal((html.match(/<th scope="row">/g) || []).length, 5, 'five detail rows');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="numeric"/.test(html), 'a numeric keyboard is offered on touch');
assert.equal((html.match(/type="text"/g) || []).length, 1, 'one text input');
assert.ok(/value="2026"/.test(html), 'a default year is in the markup');
assert.ok(/id="easter-form"/.test(html), 'the form is named');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('easter date calculator: computus goldens, 2,517 supported years checked, feasts, 13 refusals, 12 catalog cases and the page contract pass');
