/* Sidereal time calculator: Julian-date anchors, the J2000.0 GMST value, the
   equation of the equinoxes, the local shift, hour angles, formatting, the
   independent IAU-1982 polynomial, a seeded sweep, catalog replay and the page
   contract. The catalog goldens were checked against the U.S. Naval Observatory
   sidereal-time service and agree with it to well under a tenth of a second. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'sidereal-time-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* sidereal-core:start */';
const endMarker = '/* sidereal-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = SiderealCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.compute(input));
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};
const base = { date: '2026-03-20', time: '12:00:00', longitude: 0, ra: null };
const withInput = (patch) => Object.assign({}, base, patch);

// ---- Constants and calendar helpers.
assert.equal(C.J2000, 2451545.0);
assert.equal(C.SIDEREAL_RATIO, 1.00273790935);
assert.equal(C.SIDEREAL_DAY_SECONDS, 86164.0905);
assert.equal(C.DEGREES_PER_HOUR, 15);
assert.equal(C.MIN_YEAR, 1800);
assert.equal(C.MAX_YEAR, 2100);
assert.equal(C.DEFAULT_TIME, '12:00');
assert.equal(C.DEFAULT_LONGITUDE, '0');
assert.ok(Math.abs(86400 / C.SIDEREAL_RATIO - C.SIDEREAL_DAY_SECONDS) < 0.001, 'sidereal day from the ratio');
assert.equal(C.isLeapYear(2024), true);
assert.equal(C.isLeapYear(2100), false, 'a century that is not a leap year');
assert.equal(C.isLeapYear(2000), true, 'a 400-year leap rule');
assert.equal(C.daysInMonth(2024, 2), 29);
assert.equal(C.daysInMonth(2026, 2), 28);
assert.equal(C.daysInMonth(2026, 12), 31);
assert.equal(C.mod24(24), 0);
assert.equal(C.mod24(-1), 23);
assert.equal(C.mod24(-0.25), 23.75);

// ---- Julian dates: integer day numbers, so midnight is exact.
const jd = (date, hours) => C.julianDate(C.parseDate(date), hours);
assert.equal(jd('2000-01-01', 12), 2451545.0, 'J2000.0 epoch');
assert.equal(jd('2000-01-01', 0), 2451544.5);
assert.equal(jd('1970-01-01', 0), 2440587.5, 'Unix epoch');
assert.equal(jd('2026-03-20', 12), 2461120.0);
assert.equal(jd('1800-01-01', 0), 2378496.5);
assert.equal(jd('2024-02-29', 0) - jd('2024-02-28', 0), 1, 'leap day follows the 28th');

// ---- The published J2000.0 anchor: GMST 18h 41m 50.54841s at 2000-01-01 12:00 UT1.
const epoch = run({ date: '2000-01-01', time: '12:00:00', longitude: 0, ra: null });
const anchorHours = 18 + 41 / 60 + 50.54841 / 3600;
assert.ok(Math.abs(epoch.gmst - anchorHours) * 3600 < 0.01, 'J2000.0 GMST within 0.01 s');
assert.equal(epoch.gmstText, '18:41:50.55');
assert.equal(epoch.lmst, epoch.gmst, 'Greenwich is the local meridian at longitude 0');
assert.equal(epoch.gastText, '18:41:49.72');

// ---- The mean sidereal clock gains 1.0027379 hours per UT hour.
const wrap24 = (value) => ((value % 24) + 24) % 24;
const oneHour = run(withInput({ time: '13:00:00' }));
assert.ok(Math.abs(wrap24(oneHour.gmst - run(base).gmst) - 1.0027379) < 1e-6, 'GMST hour rate');
const oneDay = run(withInput({ date: '2026-03-21' }));
const dayGain = wrap24(oneDay.gmst - run(base).gmst);
assert.ok(Math.abs(dayGain - 0.065709824) < 1e-4, 'GMST gains 24 h 3 m 57 s per civil day');

// ---- Apparent values differ by the equation of the equinoxes, which stays under 1.2 s.
for (const payload of [base, withInput({ date: '1800-01-01', time: '00:00:00' }),
  withInput({ date: '2100-12-31', time: '23:59:59' }), withInput({ time: '23:00:00' })]) {
  const result = run(payload);
  const eqeq = result.gast - result.gmst;
  assert.ok(Math.abs(eqeq) < 1.2 / 3600 + 1e-12, 'equation of the equinoxes stays under 1.2 s');
  assert.equal(result.eqeq, C.equationOfEquinoxes(result.jd - C.J2000), 'eqeq is one quantity');
  assert.ok(Math.abs(C.mod24(result.gmst + result.eqeq) - result.gast) < 1e-12, 'gast = gmst + eqeq');
}

// ---- East longitude shifts both scales by degrees / 15, wrapping through zero.
for (const longitude of [-180, -73.98, -0.1278, 0, 2.3522, 41.9, 151.2, 180]) {
  const result = run(withInput({ longitude }));
  const shift = longitude / 15;
  assert.ok(Math.abs((((result.lmst - result.gmst - shift) % 24) + 24) % 24) < 1e-12,
    'local shift at ' + longitude);
  assert.ok(Math.abs((((result.last - result.gast - shift) % 24) + 24) % 24) < 1e-12,
    'local apparent shift at ' + longitude);
  assert.ok(result.lmst >= 0 && result.lmst < 24, 'hours stay on the clock');
  assert.ok(result.last >= 0 && result.last < 24, 'apparent hours stay on the clock');
}
const antimeridian = run(withInput({ longitude: 180 }));
assert.ok(Math.abs(antimeridian.lmst - C.mod24(antimeridian.gmst + 12)) < 1e-12, '+180 wraps by half a day');

// ---- Hour angle: zero on the meridian, negative east of it, positive west.
const meridian = run(withInput({ ra: C.mod24(run(base).last) }));
assert.equal(meridian.hourAngleText, '+00:00:00.00');
assert.equal(meridian.transitText, 'On the meridian now.');
const ahead = run(withInput({ ra: C.mod24(run(base).last + 1) }));
assert.ok(Math.abs(ahead.hourAngle + 1) < 1e-12, 'a target one hour ahead of the meridian');
assert.equal(ahead.hourAngleText, '-01:00:00.00');
assert.equal(ahead.transitText, 'East of the meridian: transits in 01:00:00.00 of sidereal time.');
const behind = run(withInput({ ra: C.mod24(run(base).last - 1) }));
assert.ok(Math.abs(behind.hourAngle - 1) < 1e-12, 'a target one hour behind the meridian');
assert.equal(behind.hourAngleText, '+01:00:00.00');
assert.equal(behind.transitText, 'West of the meridian: crossed it 01:00:00.00 of sidereal time ago.');
assert.equal(run(base).hourAngle, null, 'no target, no hour angle');
assert.equal(run(base).hourAngleText, null);
for (let index = 0; index < 48; index += 1) {
  const ra = index / 2;
  const result = run(withInput({ ra }));
  assert.ok(result.hourAngle > -12 && result.hourAngle <= 12, 'folded into -12 to +12 hours');
  assert.ok(Math.abs(C.mod24(result.last - ra - result.hourAngle)) < 1e-12, 'hour angle follows LAST');
}

// ---- Formatting: hundredths of a second, carries, wraps and signed text.
assert.equal(C.clockText(0), '00:00:00.00');
assert.equal(C.clockText(12.5), '12:30:00.00');
assert.equal(C.clockText(1 / 3600), '00:00:01.00');
assert.equal(C.clockText(59.999 / 3600), '00:01:00.00', 'the seconds carry into the minute');
assert.equal(C.clockText(23.9999999), '00:00:00.00', 'the last instant of the day wraps to midnight');
assert.equal(C.clockText(24.5), '00:30:00.00');
assert.equal(C.clockText(-1), '23:00:00.00');
assert.equal(C.clockText(6.3867404824188725), '06:23:12.27');
assert.equal(run(base).lmstDegreesText, '358.0342\u00b0');
assert.equal(run(base).eqeqText, '+0.400 s');
assert.equal(run({ date: '2000-01-01', time: '12:00:00', longitude: 0, ra: null }).eqeqText, '-0.834 s',
  'a negative equation of the equinoxes keeps its sign without a plus');

// ---- Input parsing: strings and numbers both work, and every refusal names the field.
assert.equal(C.parseDate('2026-03-20').day, 20);
assert.deepEqual(plain(C.parseDate({ year: 2026, month: 3, day: 20 })), { year: 2026, month: 3, day: 20 });
assert.equal(C.parseTime('12:00'), 12);
assert.equal(C.parseTime('12:00:30'), 12 + 30 / 3600);
assert.equal(C.parseTime(6.25), 6.25);
assert.equal(C.parseLongitude('-0.1278'), -0.1278);
assert.equal(C.parseLongitude('+180'), 180);
assert.equal(C.parseLongitude(-180), -180);
assert.equal(C.parseLongitude('.5'), 0.5);
assert.equal(C.parseRightAscension(''), null);
assert.equal(C.parseRightAscension(null), null);
assert.equal(C.parseRightAscension(6.7525), 6.7525);
assert.equal(run(withInput({ time: ' 12:00 ' })).gmstText, run(base).gmstText, 'whitespace is trimmed');
assert.equal(run(withInput({ time: '12:00:00' })).gmstText, run(withInput({ time: '12:00' })).gmstText);

assert.equal(failure(withInput({ date: '' })), 'Enter a UTC date.');
assert.equal(failure(withInput({ date: '2026-3-20' })), 'Enter the date as YYYY-MM-DD.');
assert.equal(failure(withInput({ date: '2026-13-05' })), 'Enter a UTC date with a month from 01 to 12.');
assert.equal(failure(withInput({ date: '2026-02-30' })), 'Enter a real calendar day for that month.');
assert.equal(failure(withInput({ date: '1799-12-31' })), 'Enter a year from 1800 to 2100.');
assert.equal(failure(withInput({ date: '2101-01-01' })), 'Enter a year from 1800 to 2100.');
assert.equal(failure(withInput({ time: '' })), 'Enter a UTC time.');
assert.equal(failure(withInput({ time: 'twelve' })), 'Enter the time as HH:MM or HH:MM:SS.');
assert.equal(failure(withInput({ time: '24:00' })), 'Enter an hour from 00 to 23.');
assert.equal(failure(withInput({ time: '12:60' })), 'Enter minutes from 00 to 59.');
assert.equal(failure(withInput({ time: '12:00:60' })), 'Enter seconds from 00 to 59.');
assert.equal(failure(withInput({ time: 24 })), 'Enter an hour from 00 to 23.');
assert.equal(failure(withInput({ longitude: '' })), 'Enter a longitude, or 0 for the Greenwich meridian.');
assert.equal(failure(withInput({ longitude: 'west' })), 'Enter the longitude as decimal degrees, such as -0.1278.');
assert.equal(failure(withInput({ longitude: 200 })), 'Enter a longitude from -180 to 180 degrees.');
assert.equal(failure(withInput({ longitude: '-180.5' })), 'Enter a longitude from -180 to 180 degrees.');
assert.equal(failure(withInput({ ra: 24.5 })), 'Enter a right ascension from 0 up to 24 hours.');
assert.equal(failure(withInput({ ra: '6h45m' })), 'Enter the right ascension as decimal hours, such as 6.7525.');
assert.equal(failure(withInput({ ra: -1 })), 'Enter a right ascension from 0 up to 24 hours.');

// ---- Independent numeric check: the IAU-1982 degree polynomial for GMST.
const polynomial = (days) => {
  const t = days / 36525;
  const degrees = 280.46061837 + 360.98564736629 * days + 0.000387933 * t * t - Math.pow(t, 3) / 38710000;
  return ((degrees % 360) + 360) % 360 / 15;
};

// ---- Seeded sweep: invariants, the polynomial, determinism and text shapes.
let seed = 20261115;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const clockShape = /^\d\d:\d\d:\d\d\.\d\d$/;
let worstPolynomial = 0;
for (let iteration = 0; iteration < 240; iteration += 1) {
  const year = 1800 + Math.floor(random() * 301);
  const month = 1 + Math.floor(random() * 12);
  const day = 1 + Math.floor(random() * C.daysInMonth(year, month));
  const hours = Math.floor(random() * 24);
  const minutes = Math.floor(random() * 60);
  const seconds = Math.floor(random() * 60);
  const longitude = Number((random() * 360 - 180).toFixed(3));
  const ra = iteration % 3 === 0 ? null : Number((random() * 24).toFixed(4));
  const pad = (value) => String(value).padStart(2, '0');
  const payload = {
    date: year + '-' + pad(month) + '-' + pad(day),
    time: pad(hours) + ':' + pad(minutes) + ':' + pad(seconds),
    longitude,
    ra
  };
  const label = 'sweep ' + payload.date + ' ' + payload.time;
  const result = run(payload);

  assert.ok(result.gmst >= 0 && result.gmst < 24, label + ' gmst on the clock');
  assert.ok(Math.abs(((result.gast - result.gmst + 24) % 24) - ((result.eqeq + 24) % 24)) < 1e-12,
    label + ' gast = gmst + eqeq');
  assert.ok(Math.abs((((result.lmst - result.gmst - longitude / 15) % 24) + 24) % 24) < 1e-12,
    label + ' local mean shift');
  for (const key of ['gmstText', 'gastText', 'lmstText', 'lastText']) {
    assert.match(result[key], clockShape, label + ' ' + key + ' shape');
  }
  assert.match(result.eqeqText, /^[+-]\d+\.\d\d\d s$/, label + ' eqeq text');
  assert.match(result.lmstDegreesText, /^\d+\.\d{4}\u00b0$/, label + ' degrees text');
  assert.deepEqual(run(payload), result, label + ' deterministic');
  if (ra !== null) {
    assert.ok(Math.abs(result.hourAngle) <= 12, label + ' hour angle bound');
    assert.match(result.hourAngleText, /^[+-]\d\d:\d\d:\d\d\.\d\d$/, label + ' hour angle text');
    assert.ok(/meridian/.test(result.transitText), label + ' transit text');
  }
  worstPolynomial = Math.max(worstPolynomial, Math.abs(result.gmst - polynomial(result.jd - C.J2000)) * 3600);
}
assert.ok(worstPolynomial < 0.1, 'the core agrees with the IAU-1982 polynomial within 0.1 s: ' + worstPolynomial);

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2320, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Sidereal Time Calculator');
assert.equal(record.category, 'Time');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.icon, '\u2727');
assert.ok(record.method.includes('6.697375'), 'method states the GMST constant');
assert.ok(record.method.includes('1.0027379'), 'method states the sidereal rate');
assert.ok(record.method.includes('0.000319'), 'method states the nutation term');
assert.ok(record.method.length > 1200, 'method documented');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.equal(record.sources.length, 3, 'three references');
assert.ok(record.sources.every((source) => /^https:\/\//.test(source.url)), 'sources carry https URLs');
assert.ok(record.sources.some((source) => /usno\.navy\.mil\/faq\/GAST/.test(source.url)), 'USNO algorithm cited');
assert.equal(record.testCases.length, 22, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 11, 'eleven golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 11,
  'eleven validation cases');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') {
      assert.ok(Math.abs(result[key] - expected) <= Math.abs(expected) * 1e-12 + 1e-300,
        testCase.name + ' ' + key);
    } else {
      assert.deepEqual(result[key], expected, testCase.name + ' ' + key);
    }
  }
}

// ---- The new record's slug, name and aliases must not collide with any other record.
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
for (const tag of ['astronomy', 'sidereal', 'time']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && /sidereal/.test(tool.slug)), 'no other sidereal slug');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Time').length, 46, 'Time count');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 8, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const id of ['date', 'time', 'longitude', 'ra']) {
  assert.ok(new RegExp('<label for="' + id + '">').test(html), 'the ' + id + ' field has a visible label');
}
assert.ok(/<input id="date" type="date"/.test(html), 'the date is a native date control');
assert.ok(/<input id="time" type="time"/.test(html), 'the time is a native time control');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/var\(--on-accent/.test(html), 'accent text colour comes from the theme');
assert.ok(/inputmode="decimal"/.test(html), 'a numeric keyboard is offered on touch');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('sidereal time calculator: Julian anchors, J2000.0 GMST, equation of the equinoxes, local shifts, '
  + 'hour angles, 240 sweep cases against the IAU-1982 polynomial, 22 catalog cases and the page contract pass');
