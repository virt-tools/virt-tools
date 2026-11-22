/* Time-clock rounding: the published rounding rule against an independent
   grid model, worked overnight and tie cases, refusals, catalog replay and the
   page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'time-clock-rounding-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* time-clock-rounding-core:start */';
const endMarker = '/* time-clock-rounding-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|localStorage|fetch\s*\(/.test(core), 'the core stays free of DOM and storage');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TimeClockRoundingCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
function failure(input) {
  try { C.analyze(input); } catch (error) { return error.message; }
  return null;
}

// ---- Independent model. The grid rule is written from the regulation's own
// description (nearest 5 minutes, one-tenth or quarter of an hour) with an
// integer remainder test for the half-up tie, not with the page's division.
function modelRound(value, increment, direction) {
  const quotient = Math.floor(value / increment);
  const remainder = value - quotient * increment;
  if (direction === 'down') return quotient * increment;
  if (direction === 'up') return remainder === 0 ? value : (quotient + 1) * increment;
  return remainder * 2 >= increment ? (quotient + 1) * increment : quotient * increment;
}
function parseClock(text) {
  const parts = text.split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}
function model(input) {
  const increment = Number(input.increment);
  let actualTotal = 0;
  let payableTotal = 0;
  let changed = 0;
  const rows = input.shifts.map((shift, index) => {
    let from = parseClock(shift.clockIn);
    let to = parseClock(shift.clockOut);
    const overnight = to < from;
    if (overnight) to += 1440;
    const actual = to - from;
    let roundedIn = from;
    let roundedOut = to;
    let payable;
    if (input.mode === 'punches') {
      roundedIn = modelRound(from, increment, input.direction);
      roundedOut = modelRound(to, increment, input.direction);
      payable = roundedOut - roundedIn;
    } else {
      payable = modelRound(actual, increment, input.direction);
    }
    actualTotal += actual;
    payableTotal += payable;
    if (payable !== actual) changed += 1;
    return {
      index: index + 1, label: shift.label || '', clockIn: from, clockOut: to, overnight,
      actualMinutes: actual, roundedIn, roundedOut, payableMinutes: payable, deltaMinutes: payable - actual
    };
  });
  return {
    rows,
    totals: {
      shifts: rows.length, actualMinutes: actualTotal, payableMinutes: payableTotal,
      deltaMinutes: payableTotal - actualTotal, changedShifts: changed,
      decimalHours: Math.round(payableTotal / 60 * 100) / 100
    }
  };
}
const shift = (label, clockIn, clockOut) => ({ label, clockIn, clockOut });
const run = (increment, direction, mode, shifts) => C.analyze({ increment, direction, mode, shifts });

// ---- Worked reference shifts, computed by hand from the grid rule.
const reference = [
  // [label, in, out, actual minutes]
  ['Mon', '08:58', '17:03', 485],
  ['Tue', '09:04', '17:31', 507],
  ['Wed', '08:56', '17:22', 506]
];
let actual = 0;
for (const [, from, to, minutes] of reference) {
  assert.equal(parseClock(to) - parseClock(from), minutes, 'reference shift length ' + from + '-' + to);
  actual += minutes;
}
assert.equal(actual, 1498, 'reference week records 24 h 58 min');

const week = run(5, 'nearest', 'punches', reference.map(([label, from, to]) => shift(label, from, to)));
assert.deepEqual(plain(week.totals), {
  shifts: 3, actualMinutes: 1498, payableMinutes: 1495, deltaMinutes: -3,
  changedShifts: 2, decimalHours: 24.92
}, 'nearest 5 minutes over the reference week');
assert.deepEqual(plain(week.rows.map((row) => row.payableMinutes)), [485, 505, 505], 'per-shift payable time');
assert.deepEqual(plain(week.rows.map((row) => row.roundedIn)), [540, 545, 535], 'clock-ins round to the grid');
assert.deepEqual(plain(week.rows.map((row) => row.roundedOut)), [1025, 1050, 1040], 'clock-outs round to the grid');

// An overnight shift crosses midnight in one row.
const night = run(15, 'nearest', 'punches', [shift('Night', '22:07', '06:02')]);
assert.equal(night.rows[0].overnight, true);
assert.equal(night.rows[0].clockOut, 1802, 'clock-out is carried past midnight');
assert.equal(night.rows[0].actualMinutes, 475);
assert.equal(night.rows[0].payableMinutes, 480);
assert.equal(night.totals.deltaMinutes, 5);

// Direction moves each punch to its own side of the grid.
const down = run(15, 'down', 'punches', [shift('Mon', '09:52', '17:38')]);
assert.equal(down.rows[0].roundedIn, 585, 'down floors the clock-in');
assert.equal(down.rows[0].roundedOut, 1050, 'down floors the clock-out');
assert.equal(down.totals.payableMinutes, 465);
const up = run(15, 'up', 'punches', [shift('Mon', '09:52', '17:38')]);
assert.equal(up.rows[0].roundedIn, 600, 'up raises the clock-in');
assert.equal(up.rows[0].roundedOut, 1065, 'up raises the clock-out');
assert.equal(up.totals.payableMinutes, 465);

// Duration mode rounds the shift length, not the two punches.
const duration = run(6, 'nearest', 'duration', [shift('Mon', '09:07', '17:41')]);
assert.equal(duration.rows[0].actualMinutes, 514);
assert.equal(duration.rows[0].roundedIn, 547, 'duration mode leaves the punches alone');
assert.equal(duration.totals.payableMinutes, 516);

// Ties go up: half an increment is rounded away from zero.
assert.equal(C.roundMinutes(543, 6, 'nearest'), 546, 'a 6-minute half tie rounds up');
assert.equal(C.roundMinutes(545, 10, 'nearest'), 550, 'a 10-minute half tie rounds up');
assert.equal(C.roundMinutes(1438, 5, 'nearest'), 1440, 'a punch just before midnight rounds to it');
assert.equal(C.roundMinutes(540, 15, 'up'), 540, 'a punch on the grid does not move when rounded up');
assert.equal(C.roundMinutes(1, 15, 'down'), 0, 'the first minute of the day floors to midnight');
assert.equal(C.roundMinutes(485, 1, 'nearest'), 485, 'one minute is no rounding');

// A short shift can round away to nothing under a downward policy.
const collapsed = run(15, 'down', 'punches', [shift('Mon', '09:02', '09:07')]);
assert.equal(collapsed.totals.payableMinutes, 0);
assert.equal(collapsed.totals.deltaMinutes, -5);

// ---- Sweep against the independent model.
const SEEDS = [
  ['08:58', '17:03'], ['09:04', '17:31'], ['00:00', '08:00'], ['23:58', '00:04'],
  ['22:07', '06:02'], ['09:03', '17:00'], ['12:00', '12:01'], ['07:45', '16:15'],
  ['13:31', '22:59'], ['06:06', '18:18'], ['19:44', '03:16'], ['10:10', '10:11']
];
const INCREMENTS = [1, 5, 6, 10, 15];
const DIRECTIONS = ['nearest', 'down', 'up'];
const MODES = ['punches', 'duration'];
let sweep = 0;
let state = 20261120;
for (const increment of INCREMENTS) {
  for (const direction of DIRECTIONS) {
    for (const mode of MODES) {
      for (let round = 0; round < 20; round += 1) {
        const shifts = [];
        for (let index = 0; index < 4; index += 1) {
          state = (state * 1103515245 + 12345) % 2147483648;
          const from = state % 1440;
          state = (state * 1103515245 + 12345) % 2147483648;
          const length = 1 + (state % 600);
          const pad = (value) => String(value).padStart(2, '0');
          const fmt = (minutes) => pad(Math.floor((minutes % 1440) / 60)) + ':' + pad(minutes % 60);
          shifts.push(shift('S' + (index + 1), fmt(from), fmt((from + length) % 1440)));
        }
        const input = { increment, direction, mode, shifts };
        const got = plain(C.analyze(input)).totals;
        const want = model(input).totals;
        assert.deepEqual(got, want,
          'sweep mismatch at ' + increment + '/' + direction + '/' + mode + '/' + round);
        assert.ok(got.payableMinutes >= 0, 'payable time is never negative');
        assert.ok(Math.abs(got.deltaMinutes) <= 2 * increment * got.shifts,
          'rounding moves each punch by less than one step');
        assert.ok(Math.abs(got.decimalHours - got.payableMinutes / 60) <= 0.005 + 1e-9,
          'decimal hours describe the payable minutes');
        if (mode === 'duration') {
          plain(C.analyze(input)).rows.forEach(function (row) {
            assert.equal(row.payableMinutes, modelRound(row.actualMinutes, increment, direction),
              'duration mode rounds each shift length');
          });
        }
        if (mode === 'punches' && increment === 1) {
          assert.equal(got.payableMinutes, got.actualMinutes, 'one minute leaves the punches unchanged');
        }
        sweep += 1;
      }
    }
  }
}
for (const [from, to] of SEEDS) {
  assert.deepEqual(plain(run(5, 'nearest', 'punches', [shift('Seed', from, to)]).totals),
    model({ increment: 5, direction: 'nearest', mode: 'punches', shifts: [shift('Seed', from, to)] }).totals,
    'seed shift ' + from + '-' + to);
}

// ---- Refusals: every message is the page's own wording.
const ok = [shift('Mon', '09:00', '17:00')];
assert.equal(failure({ increment: 5, direction: 'nearest', mode: 'punches', shifts: [] }),
  'Add at least one shift.');
assert.equal(failure({ increment: 5, direction: 'nearest', mode: 'punches',
  shifts: [shift('Mon', '', '17:00')] }), 'Enter a clock-in time on shift 1.');
assert.equal(failure({ increment: 5, direction: 'nearest', mode: 'punches',
  shifts: [ok[0], shift('Tue', '09:00', '')] }), 'Enter a clock-out time on shift 2.');
assert.equal(failure({ increment: 5, direction: 'nearest', mode: 'punches',
  shifts: [shift('Mon', '8:5', '17:00')] }), "Enter shift 1's clock times as HH:MM, such as 08:58.");
assert.equal(failure({ increment: 5, direction: 'nearest', mode: 'punches',
  shifts: [shift('Mon', '24:10', '17:00')] }), "Enter shift 1's clock times as HH:MM, such as 08:58.");
assert.equal(failure({ increment: 5, direction: 'nearest', mode: 'punches',
  shifts: [shift('Mon', '09:00', '09:00')] }), 'Shift 1 needs different clock-in and clock-out times.');
assert.equal(failure({ increment: 7, direction: 'nearest', mode: 'punches', shifts: ok }),
  'Choose a rounding increment of 1, 5, 6, 10 or 15 minutes.');
assert.equal(failure({ increment: 5, direction: 'sideways', mode: 'punches', shifts: ok }),
  'Choose nearest, down or up as the rounding direction.');
assert.equal(failure({ increment: 5, direction: 'nearest', mode: 'both', shifts: ok }),
  'Choose whether to round each punch or the shift duration.');
assert.equal(failure({ increment: 5, direction: 'nearest', mode: 'punches',
  shifts: new Array(31).fill(ok[0]) }), 'Round at most 30 shifts at a time.');
assert.equal(C.analyze({ increment: '5', direction: ' nearest ', mode: 'punches', shifts: ok }).increment, 5,
  'select values arrive as strings');
assert.equal(run(5, 'nearest', 'punches', [shift('', ' 09:00 ', '17:00')]).rows[0].label, '',
  'an unlabelled shift keeps an empty label');

// ---- Catalog record and its cases must agree with the page core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.length, 2451, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2190, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Time').length, 54, 'Time count');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Time Clock Rounding Calculator');
assert.equal(record.category, 'Time');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.method.includes('one-tenth of an hour'), 'method names the regulation increments');
assert.ok(record.method.includes('does not compute pay'), 'method states the scope');
assert.equal(record.sources.length, 1, 'one published source');
assert.match(record.sources[0].url, /^https:\/\/www\.ecfr\.gov\//, 'the source is the regulation');
assert.match(record.sources[0].title, /785\.48/, 'the source names the section');

function subset(actualValue, expectedValue, label) {
  if (Array.isArray(expectedValue)) {
    assert.ok(Array.isArray(actualValue), label + ' should be an array');
    assert.equal(actualValue.length, expectedValue.length, label + ' length');
    expectedValue.forEach((item, index) => subset(actualValue[index], item, label + '[' + index + ']'));
    return;
  }
  if (expectedValue !== null && typeof expectedValue === 'object') {
    assert.ok(actualValue !== null && typeof actualValue === 'object', label + ' should be an object');
    for (const [key, value] of Object.entries(expectedValue)) {
      assert.ok(Object.prototype.hasOwnProperty.call(actualValue, key), label + ' missing ' + key);
      subset(actualValue[key], value, label + '.' + key);
    }
    return;
  }
  assert.equal(actualValue, expectedValue, label);
}
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 19, 'catalog case count');
assert.equal(kinds('golden'), 7, 'seven golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 8, 'eight validation cases');
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  subset(plain(C.analyze(testCase.input)), testCase.expected, testCase.name);
  assert.deepEqual(plain(C.analyze(testCase.input)).totals, model(testCase.input).totals,
    testCase.name + ' agrees with the independent model');
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
for (const tag of ['time', 'clock', 'rounding', 'timesheet', 'payroll', 'punch']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(markupIds).size, markupIds.length, 'no duplicate element ids');
const requestedIds = [
  ...[...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]),
  ...[...html.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1])
];
assert.ok(requestedIds.length >= 8, 'the page looks up its controls');
for (const id of new Set(requestedIds)) assert.ok(markupIds.includes(id), 'script looks up a missing element id: ' + id);
for (const id of ['increment', 'direction', 'mode']) {
  assert.ok(new RegExp('<label\\b[^>]*\\bfor="' + id + '"').test(html), 'visible label for ' + id);
  assert.ok(new RegExp('<select id="' + id + '"').test(html), 'select for ' + id);
}
assert.equal((html.match(/<select /g) || []).length, 3, 'three policy pickers');
assert.ok(/type = "time"|type="time"/.test(html), 'the punch fields are time pickers');
assert.ok(/aria-label", "Shift " \+ number \+ " clock-in"/.test(html), 'each punch field is labelled for screen readers');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status"/.test(html), 'the confirmation is announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/:focus\{/.test(html) || /focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/novalidate/.test(html), 'the page owns its validation');
assert.ok(/data-label/.test(html), 'the table stacks with per-cell labels');
assert.ok(/does not compute pay/.test(html), 'the page states its scope');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('time clock rounding calculator: 3 worked shifts, ' + sweep
  + ' model sweeps, 19 catalog cases and the page contract pass');
