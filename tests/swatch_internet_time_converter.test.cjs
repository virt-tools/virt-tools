/* Swatch Internet Time converter: the beat of an instant, the inverse on a BMT
   date, the hour-mark table, refusals, an independent component-based model,
   round trips, the catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'swatch-internet-time-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* swatch-core:start */';
const endMarker = '/* swatch-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SwatchCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, label, tolerance) => {
  const limit = tolerance === undefined ? 1e-6 : tolerance;
  assert.ok(Math.abs(actual - expected) <= limit,
    label + ': ' + actual + ' is not within ' + limit + ' of ' + expected);
};
const failure = (input) => {
  try {
    if (Object.prototype.hasOwnProperty.call(input, 'utc')) C.solve(input);
    else C.solveReverse(input);
  } catch (error) { return error.message; }
  return null;
};
const run = (input) => plain(Object.prototype.hasOwnProperty.call(input, 'utc')
  ? C.solve(input) : C.solveReverse(input));
const DAY_MS = 86400000;

// ---- Constants and the exported surface.
assert.equal(C.BEAT_MS, 86400, 'one beat is 86.4 seconds in milliseconds');
assert.equal(C.DAY_MS, 86400000);
assert.equal(C.BMT_OFFSET_MS, 3600000, 'BMT is UTC+1 all year');
assert.deepEqual(plain(Object.keys(C)).sort(), [
  'BEAT_MS', 'BMT_OFFSET_MS', 'DAY_MS', 'MESSAGES', 'beatMarks', 'formatBeat', 'formatBmt',
  'formatClock', 'formatDate', 'formatUtc', 'fromBeat', 'pad', 'parseBeat', 'parseBmtDate',
  'parseUtc', 'round', 'solve', 'solveReverse', 'toBeat', 'trim'
]);

// ---- Formatting.
assert.equal(C.formatBeat(500), '@500');
assert.equal(C.formatBeat(0), '@000');
assert.equal(C.formatBeat(41.99), '@041');
assert.equal(C.pad(7, 3), '007');
assert.equal(C.formatDate(Date.UTC(2026, 10, 19, 12, 0, 0)), '2026-11-19');
assert.equal(C.formatClock(Date.UTC(2026, 10, 19, 11, 17, 16)), '11:17:16');
assert.equal(C.formatClock(Date.UTC(2026, 10, 19, 11, 17, 16, 800)), '11:17:16.8');
assert.equal(C.formatUtc(Date.UTC(2026, 10, 19, 11, 4, 28)), '2026-11-19 11:04:28 UTC');
assert.equal(C.formatBmt(Date.UTC(2026, 10, 19, 11, 4, 28)), '2026-11-19 12:04:28 BMT');
assert.equal(C.trim(41.6666666, 3), '41.667');
assert.equal(C.trim(500, 3), '500');

// ---- Reading the inputs.
assert.equal(C.parseUtc('2026-11-19T11:00:00'), Date.UTC(2026, 10, 19, 11, 0, 0));
assert.equal(C.parseUtc('2026-11-19 11:00'), Date.UTC(2026, 10, 19, 11, 0, 0));
assert.equal(C.parseBmtDate('2026-11-19'), Date.UTC(2026, 10, 19, 0, 0, 0));
assert.equal(C.parseBeat('@512'), 512);
assert.equal(C.parseBeat('512'), 512);
assert.equal(C.parseBeat('512.345'), 512.345);
assert.equal(C.parseBeat('999.999'), 999.999);
assert.equal(C.parseBeat('@0'), 0);

// ---- Beats against the published definition.
const at = (text) => plain(C.toBeat(C.parseUtc(text)));
assert.deepEqual(at('2026-11-18T23:00:00'), {
  utcMs: Date.UTC(2026, 10, 18, 23, 0, 0), bmtMs: Date.UTC(2026, 10, 19, 0, 0, 0),
  dayMs: 0, beat: 0, exact: 0, secondsToNext: 86.4
});
assert.equal(at('2026-11-19T11:00:00').beat, 500, 'BMT noon is beat 500');
near(at('2026-11-19T00:00:00').exact, 41.6666667, 'midnight UTC', 1e-6);
assert.equal(at('2026-11-19T22:59:59').beat, 999);
assert.equal(at('2026-11-19T23:00:00').beat, 0, 'BMT midnight rolls back to @000');
assert.equal(at('2026-11-19T04:57:00').beat, 247, 'five fifty-seven BMT is inside @247');
near(at('2026-11-19T04:57:00').secondsToNext, 7.2, 'until @248', 1e-6);
assert.equal(at('2026-11-19T11:07:12').exact, 505, 'a whole beat on a whole second');

// ---- The inverse, placed on a BMT date.
const rev = (date, beat) => plain(C.solveReverse({ date: date, beat: beat }));
assert.deepEqual(rev('2026-11-19', '@000'), {
  beat: 0, beatText: '@000', exact: 0, bmtDate: '2026-11-19', bmtTime: '00:00:00',
  utcDate: '2026-11-18', utcTime: '23:00:00', earlierUtcDate: true
});
assert.deepEqual(rev('2026-11-19', '@500'), {
  beat: 500, beatText: '@500', exact: 500, bmtDate: '2026-11-19', bmtTime: '12:00:00',
  utcDate: '2026-11-19', utcTime: '11:00:00', earlierUtcDate: false
});
assert.equal(rev('2026-11-19', '@512').bmtTime, '12:17:16.8');
assert.equal(rev('2026-11-19', '999.999').utcTime, '22:59:59.9');
assert.equal(rev('2026-11-19', '41.666').utcDate, '2026-11-18', 'the BMT day began the day before');
assert.equal(C.fromBeat('2026-11-19', '@500').utcMs, Date.UTC(2026, 10, 19, 11, 0, 0));

// ---- The hour marks used by the table.
assert.deepEqual(plain(C.beatMarks()), [
  { bmt: '00:00', beat: 0, utc: '23:00' },
  { bmt: '03:00', beat: 125, utc: '02:00' },
  { bmt: '06:00', beat: 250, utc: '05:00' },
  { bmt: '09:00', beat: 375, utc: '08:00' },
  { bmt: '12:00', beat: 500, utc: '11:00' },
  { bmt: '15:00', beat: 625, utc: '14:00' },
  { bmt: '18:00', beat: 750, utc: '17:00' },
  { bmt: '21:00', beat: 875, utc: '20:00' }
]);

// ---- An independent model reads the BMT clock components instead of the epoch.
const model = (ms) => {
  const date = new Date(ms + C.BMT_OFFSET_MS);
  const seconds = date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 +
    date.getUTCSeconds() + date.getUTCMilliseconds() / 1000;
  return { exact: seconds / 86.4, beat: Math.floor(seconds / 86.4) };
};
let seed = 20261119;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const pad2 = (value) => String(value).padStart(2, '0');
for (let trial = 0; trial < 400; trial += 1) {
  const ms = Date.UTC(1990, 0, 1) + Math.floor(random() * 60 * 365.25 * DAY_MS);
  const result = plain(C.toBeat(ms));
  const expect = model(ms);
  assert.equal(result.beat, expect.beat, 'beat ' + trial);
  near(result.exact, expect.exact, 'exact ' + trial, 1e-9);
  assert.ok(result.beat >= 0 && result.beat <= 999, 'beat in range ' + trial);
  assert.ok(result.secondsToNext > 0 && result.secondsToNext <= 86.4 + 1e-9,
    'countdown within one beat ' + trial);
  // The countdown lands exactly on the next beat.
  const landed = model(ms + Math.round(result.secondsToNext * 1000)).exact;
  const drift = Math.abs(landed - Math.round(landed));
  assert.ok(drift <= 1e-6, 'next boundary ' + trial + ': ' + landed);
}

// ---- A BMT date and a beat survive the round trip.
for (let trial = 0; trial < 200; trial += 1) {
  const dateText = C.formatDate(Date.UTC(2020 + Math.floor(random() * 10),
    Math.floor(random() * 12), 1 + Math.floor(random() * 28)));
  const beat = Math.round(random() * 999999) / 1000;
  const forward = plain(C.solveReverse({ date: dateText, beat: String(beat) }));
  const back = plain(C.toBeat(C.fromBeat(dateText, String(beat)).utcMs));
  assert.equal(back.beat, Math.floor(beat), 'round trip beat ' + dateText + ' ' + beat);
  near(back.exact, beat, 'round trip exact ' + dateText + ' ' + beat, 6e-4);
  assert.equal(C.formatDate(C.fromBeat(dateText, String(beat)).utcMs + C.BMT_OFFSET_MS),
    dateText, 'round trip BMT date ' + dateText);
  assert.equal(forward.bmtDate, dateText);
}

// ---- Refusals stay specific.
assert.equal(failure({ utc: '' }), 'Enter a UTC date and time.');
assert.equal(failure({ utc: '19/11/2026 11:00' }),
  'Write the UTC time as YYYY-MM-DD HH:MM, with optional seconds.');
assert.equal(failure({ utc: '2026-02-30T12:00' }),
  'Write the UTC time as YYYY-MM-DD HH:MM, with optional seconds.');
assert.equal(failure({ utc: '2026-11-19T24:00' }),
  'Write the UTC time as YYYY-MM-DD HH:MM, with optional seconds.');
assert.equal(failure({ utc: '2026-11-19T12:60' }),
  'Write the UTC time as YYYY-MM-DD HH:MM, with optional seconds.');
assert.equal(failure({ utc: '2026-11-19T12:00:60' }),
  'Write the UTC time as YYYY-MM-DD HH:MM, with optional seconds.');
assert.equal(failure({ utc: '0999-01-01T00:00' }), 'Use a year between 1000 and 9999.');
assert.equal(failure({ date: '', beat: '@512' }), 'Enter the BMT date.');
assert.equal(failure({ date: '19-11-2026', beat: '@512' }), 'Write the BMT date as YYYY-MM-DD.');
assert.equal(failure({ date: '2026-02-30', beat: '@512' }), 'Write the BMT date as YYYY-MM-DD.');
assert.equal(failure({ date: '2026-11-19', beat: '' }), 'Enter a .beat value.');
assert.equal(failure({ date: '2026-11-19', beat: 'half' }),
  'Write the .beat value as digits, with an optional @ and up to three decimals.');
assert.equal(failure({ date: '2026-11-19', beat: '-5' }),
  'Write the .beat value as digits, with an optional @ and up to three decimals.');
assert.equal(failure({ date: '2026-11-19', beat: '1000' }),
  'A .beat value must be at least 0 and below 1,000.');

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Swatch Internet Time Converter');
assert.equal(entry.category, 'Time');
assert.equal(entry.subcategory, 'Conversion');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(entry.icon, '\u{23F1}\u{FE0F}');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 900, 'method must document the scale and its limits');
assert.equal(entry.sources.length, 1);
assert.equal(entry.sources[0].url, 'https://en.wikipedia.org/wiki/Swatch_Internet_Time');
assert.equal(entry.testCases.length, 24, 'catalog case count');
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'golden').length, 6);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'boundary').length, 5);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'validation').length, 13);

for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  for (const [field, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') near(result[field], expected, testCase.name + ' ' + field, 2e-6);
    else assert.equal(result[field], expected, testCase.name + ' ' + field);
  }
}

// ---- A slug, name or alias belongs to one tool only.
const names = new Map();
for (const tool of catalog.tools) {
  for (const value of [tool.name, ...(tool.aliases || [])]) {
    const key = value.toLowerCase();
    if (!names.has(key)) names.set(key, new Set());
    names.get(key).add(tool.slug);
  }
}
for (const value of [entry.name, ...entry.aliases]) {
  const owners = names.get(value.toLowerCase());
  assert.equal(owners.size, 1, 'name or alias belongs to one tool: ' + value);
  assert.ok(owners.has(slug), 'name or alias belongs to this tool: ' + value);
}

// ---- Page contract.
assert.ok(/<h1>Swatch Internet Time Converter<\/h1>/.test(html), 'heading');
assert.ok(/<form id="beat-form" novalidate>/.test(html), 'forward form');
assert.ok(/<form id="reverse-form" novalidate>/.test(html), 'reverse form');
for (const id of ['in-utc', 'err', 'run', 'now', 'out', 'headline', 'sub', 'fact-date',
  'fact-clock', 'fact-exact', 'fact-next', 'rows', 'in-date', 'in-beat', 'err2', 'run2',
  'out2', 'headline2', 'sub2']) {
  assert.ok(html.includes('id="' + id + '"'), 'element id: ' + id);
}
for (const label of ['UTC date and time', 'BMT date', '.beat value']) {
  assert.ok(html.includes('>' + label + '</label>'), 'label: ' + label);
}
assert.ok(/<button type="submit" id="run">Convert to \.beat<\/button>/.test(html), 'submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/nothing is sent or stored/.test(html), 'the note states local only');
assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(html), 'no off-site links or requests');
assert.ok(!/<script[^>]+src="(?!\/assets\/)/.test(html), 'only local scripts');
assert.ok(!/\son(click|input|change|submit|keydown)=/.test(html), 'no inline event handlers');
assert.equal(html.match(/<script/g).length, 3, 'theme init, shared app and the tool script');
assert.ok(/min-height:44px/.test(html), '44px touch targets');
const ids = html.match(/\bid="[^"]+"/g).map((value) => value.slice(4, -1));
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');

console.log('swatch internet time converter: all assertions passed');
