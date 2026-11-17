/* Working hours between dates: catalog replay, an independent minute-scan
   reference over 300 seeded ranges, invariant checks, formatting, refusals,
   name/alias uniqueness and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'working-hours-between-dates';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* working-hours-core:start */';
const endMarker = '/* working-hours-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|new Date/.test(core), 'the core stays free of DOM access and wall-clock time');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = WorkingHoursCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.solve(input));
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};

// ---- An independent reference: walk the interval minute by minute.
// Nothing here reuses the page's per-day clipping.
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MINUTE = 60000;
const DAY = 86400000;

function toEpoch(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  const stamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]));
  return stamp;
}

function reference(input) {
  const from = toEpoch(input.start);
  const to = toEpoch(input.end);
  const open = C.parseDateTime('2000-01-01T' + input.dayStart.slice(0, 5), 'bad').minutes;
  const close = C.parseDateTime('2000-01-01T' + input.dayEnd.slice(0, 5), 'bad').minutes;
  const picked = new Set(input.days.map((name) => WEEKDAYS.indexOf(name)));
  const holidays = new Set(input.holidays.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean));
  let total = 0;
  for (let stamp = from; stamp < to; stamp += MINUTE) {
    const date = new Date(stamp);
    const key = date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(date.getUTCDate()).padStart(2, '0');
    const weekday = (date.getUTCDay() + 6) % 7;
    const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
    if (picked.has(weekday) && !holidays.has(key) && minutes >= open && minutes < close) total += 1;
  }
  return total;
}

// ---- Exported contract.
assert.equal(C.MAX_DAYS, 3700);
assert.deepEqual(plain(Object.keys(C)).sort(),
  ['MAX_DAYS', 'MESSAGES', 'WEEKDAYS', 'daysInMonth', 'formatDay', 'formatDuration', 'formatHours',
    'formatMoment', 'fromDays', 'isLeap', 'parseDateTime', 'solve', 'toDays', 'toHours', 'weekdayIndex']);
assert.equal(C.isLeap(2028), true);
assert.equal(C.isLeap(2100), false);
assert.equal(C.isLeap(2000), true);
assert.equal(C.daysInMonth(2028, 2), 29);
assert.equal(C.daysInMonth(2026, 4), 30);
assert.equal(C.weekdayIndex(C.toDays(2026, 11, 17)), 1); // a Tuesday, Monday = 0
assert.deepEqual(plain(C.fromDays(C.toDays(2028, 2, 29))), { year: 2028, month: 2, day: 29 });

// ---- Formatting.
assert.equal(C.formatDuration(0), '0 min');
assert.equal(C.formatDuration(45), '45 min');
assert.equal(C.formatDuration(60), '1 h');
assert.equal(C.formatDuration(150), '2 h 30 min');
assert.equal(C.formatDuration(1440), '24 h');
assert.equal(C.formatHours(0), '0 h');
assert.equal(C.formatHours(30), '0.5 h');
assert.equal(C.formatHours(150), '2.5 h');
assert.equal(C.formatHours(2880), '48 h');
assert.equal(C.toHours(1), 0.02);
assert.equal(C.toHours(1439), 23.98);
assert.equal(C.formatDay('2026-11-17'), 'Tue 17 Nov 2026');
assert.equal(C.formatMoment('2026-11-17T13:30'), 'Tue 17 Nov 2026 13:30');

// ---- 300 seeded ranges against the minute-by-minute reference.
let seed = 20261117;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const stampOf = (epoch) => {
  const date = new Date(epoch);
  return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(date.getUTCDate()).padStart(2, '0') + 'T' +
    String(date.getUTCHours()).padStart(2, '0') + ':' + String(date.getUTCMinutes()).padStart(2, '0');
};
let checked = 0;
for (let trial = 0; trial < 300; trial += 1) {
  const base = Date.UTC(2026, 0, 1) + Math.floor(random() * 3000) * DAY;
  const from = base + Math.floor(random() * 1440) * MINUTE;
  const to = from + (1 + Math.floor(random() * 60 * 24 * 20)) * MINUTE;
  const open = Math.floor(random() * 1380);
  const close = open + 1 + Math.floor(random() * (1440 - open - 1));
  const days = WEEKDAYS.filter(() => random() < 0.6);
  if (days.length === 0) days.push('Mon');
  const holidayStamp = base + Math.floor(random() * 25) * DAY;
  const input = {
    start: stampOf(from),
    end: stampOf(to),
    dayStart: String(Math.floor(open / 60)).padStart(2, '0') + ':' + String(open % 60).padStart(2, '0'),
    dayEnd: String(Math.floor(close / 60)).padStart(2, '0') + ':' + String(close % 60).padStart(2, '0'),
    days: days,
    holidays: random() < 0.4 ? stampOf(holidayStamp).slice(0, 10) : ''
  };
  const result = run(input);
  const expected = reference({ ...input, dayStart: input.dayStart, dayEnd: input.dayEnd });
  assert.equal(result.totalMinutes, expected, 'seeded range ' + trial + ' ' + JSON.stringify(input));
  checked += 1;
}
assert.equal(checked, 300);

// ---- Invariants over the same kind of input.
for (let trial = 0; trial < 60; trial += 1) {
  const base = Date.UTC(2027, 0, 1) + Math.floor(random() * 900) * DAY;
  const from = base + Math.floor(random() * 1440) * MINUTE;
  const to = from + (1 + Math.floor(random() * 60 * 24 * 90)) * MINUTE;
  const input = {
    start: stampOf(from),
    end: stampOf(to),
    dayStart: '08:00',
    dayEnd: '18:30',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    holidays: ''
  };
  const result = run(input);
  assert.equal(result.totalMinutes + result.outsideMinutes, result.wallMinutes, 'the two parts fill the span');
  assert.equal(result.workingDays, result.breakdown.length, 'one row per counted day');
  assert.ok(result.workingDays <= result.scheduledDays, 'counted days are scheduled days');
  assert.ok(result.scheduledDays <= result.calendarDays, 'scheduled days are calendar days');
  assert.ok(result.totalMinutes <= result.scheduledDays * result.dailyMinutes, 'no day exceeds its window');
  assert.equal(result.dailyMinutes, 630);
  for (const entry of result.breakdown) {
    assert.ok(entry.minutes > 0 && entry.minutes <= result.dailyMinutes, 'each day stays inside the window');
    assert.equal(C.formatDay(entry.date).slice(0, 3), entry.weekday, 'the weekday matches the date');
  }
  const dates = result.breakdown.map((entry) => entry.date);
  assert.deepEqual(dates, [...dates].sort(), 'days are listed in order');
}

// ---- Catalog replay of the published cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug appears once');
assert.equal(record.name, 'Working Hours Between Dates Calculator');
assert.equal(record.category, 'Time');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.sources.length, 0, 'bespoke counting carries no citation');
assert.equal(record.testCases.length, 30, '30 catalog cases');
assert.equal(record.testCases.filter((entry) => entry.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((entry) => entry.kind === 'boundary').length, 8);
assert.equal(record.testCases.filter((entry) => entry.kind === 'validation').length, 12);

for (const testCase of record.testCases) {
  const input = {
    start: testCase.input.start,
    end: testCase.input.end,
    dayStart: testCase.input.dayStart,
    dayEnd: testCase.input.dayEnd,
    days: testCase.input.days,
    holidays: testCase.input.holidays
  };
  if (testCase.expected.error) {
    assert.equal(failure(input), testCase.expected.error, 'refusal: ' + testCase.name);
    continue;
  }
  const result = run(input);
  const expected = testCase.expected;
  for (const key of ['totalMinutes', 'totalHours', 'wallMinutes', 'outsideMinutes',
    'scheduledDays', 'workingDays', 'calendarDays', 'dailyMinutes']) {
    assert.equal(result[key], expected[key], testCase.name + ' ' + key);
  }
  assert.deepEqual(result.breakdown, expected.breakdown, testCase.name + ' breakdown');
}

// ---- A slug, name or alias lives in one place.
const names = new Map();
for (const tool of catalog.tools) {
  for (const value of [tool.name, ...(tool.aliases || [])]) {
    const key = value.toLowerCase();
    if (!names.has(key)) names.set(key, new Set());
    names.get(key).add(tool.slug);
  }
}
for (const value of [record.name, ...record.aliases]) {
  const owners = names.get(value.toLowerCase());
  assert.equal(owners.size, 1, 'name or alias belongs to one tool: ' + value);
  assert.ok(owners.has(slug), 'name or alias belongs to this tool: ' + value);
}
assert.ok(!catalog.tools.some((tool) => tool.slug === 'business-hours'), 'no separate business-hours tool');
assert.ok(!catalog.tools.some((tool) => tool.slug === 'working-hours'), 'no separate working-hours tool');

// ---- Refusals stay specific.
const base = { start: '2026-11-16T09:00', end: '2026-11-20T17:00', dayStart: '09:00',
  dayEnd: '17:00', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], holidays: '' };
assert.equal(failure({ ...base, start: '' }),
  'Enter a start date and time, for example 2026-11-17 09:00.');
assert.equal(failure({ ...base, end: '2026-11-32T17:00' }),
  'Enter an end date and time, for example 2026-11-18 17:00.');
assert.equal(failure({ ...base, end: '2026-02-30T17:00' }),
  'Enter an end date and time, for example 2026-11-18 17:00.');
assert.equal(failure({ ...base, end: '2026-11-16T09:00' }), 'The end has to come after the start.');
assert.equal(failure({ ...base, end: '2026-11-15T17:00' }), 'The end has to come after the start.');
assert.equal(failure({ ...base, days: [] }), 'Pick at least one working day.');
assert.equal(failure({ ...base, days: ['Mon', 'Funday'] }), 'Name the working days Monday through Sunday.');
assert.equal(failure({ ...base, dayStart: '9am' }),
  'Enter the working day as two times in 24-hour form, for example 09:00 and 17:00.');
assert.equal(failure({ ...base, dayEnd: '25:00' }),
  'Enter the working day as two times in 24-hour form, for example 09:00 and 17:00.');
assert.equal(failure({ ...base, dayEnd: '09:00' }),
  'The working day has to end after it starts; an overnight shift needs two ranges.');
assert.equal(failure({ ...base, dayStart: '17:00', dayEnd: '09:00' }),
  'The working day has to end after it starts; an overnight shift needs two ranges.');
assert.equal(failure({ ...base, holidays: '25 December' }),
  'Each holiday has to be a real date in YYYY-MM-DD form, one per line.');
assert.equal(failure({ ...base, holidays: '2026-02-29' }),
  'Each holiday has to be a real date in YYYY-MM-DD form, one per line.');
assert.equal(failure({ ...base, start: '2026-01-01T09:00', end: '2036-12-31T17:00' }),
  'That range is longer than 10 years; narrow it down.');
assert.equal(failure({ ...base, start: '2026-11-16T09:00:30' }),
  'Enter a start date and time, for example 2026-11-17 09:00.');

// ---- Page contract.
assert.ok(/<h1>Working Hours Between Dates Calculator<\/h1>/.test(html), 'heading');
assert.ok(/<form id="hours-form" novalidate>/.test(html), 'form');
for (const id of ['in-start', 'in-end', 'in-day-start', 'in-day-end', 'in-holidays', 'err', 'run',
  'copy', 'clear', 'status', 'out', 'headline', 'sub', 'rows', 'days', 'method']) {
  assert.ok(html.includes('id="' + id + '"'), 'element id: ' + id);
}
for (const label of ['Start', 'End', 'Working day starts', 'Working day ends', 'Holidays (optional)']) {
  assert.ok(html.includes('>' + label + '</label>'), 'label: ' + label);
}
for (let index = 0; index < 7; index += 1) {
  assert.ok(html.includes('id="wd-' + index + '"'), 'weekday checkbox ' + index);
  assert.ok(html.includes('<label for="wd-' + index + '">' + WEEKDAYS[index] + '</label>'),
    'weekday label ' + index);
}
assert.ok(/<button type="submit" id="run">Calculate working hours<\/button>/.test(html), 'submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<th scope="col" class="num">Value<\/th>/.test(html), 'table header');
assert.ok(/nothing is sent or stored/.test(html), 'the note states local only');
assert.ok(!/https?:\/\//.test(html), 'no off-site links or requests');
assert.ok(!/<script[^>]+src="(?!\/assets\/)/.test(html), 'only local scripts');
assert.ok(!/\son(click|input|change|submit|keydown)=/.test(html), 'no inline event handlers');
assert.equal(html.match(/<script/g).length, 3, 'theme init, shared app and the tool script');
const ids = html.match(/\bid="[^"]+"/g).map((value) => value.slice(4, -1));
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');

console.log('working hours between dates: all assertions passed');
