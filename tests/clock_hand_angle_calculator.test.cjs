/* Clock hand angle calculator: catalog replay, hand positions and the angle
   between them, the times a target angle recurs, formatting, refusals,
   name/alias uniqueness and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'clock-hand-angle-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* clock-core:start */';
const endMarker = '/* clock-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ClockCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.solve(input));
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};
const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ': ' + actual + ' vs ' + expected);
};
const CYCLE = 43200;

// ---- Exported contract.
assert.equal(C.CYCLE, 43200);
assert.deepEqual(plain(Object.keys(C)).sort(),
  ['CYCLE', 'MESSAGES', 'anglesAt', 'cycleTimes', 'formatDegrees', 'formatFace', 'formatWait',
    'occurrences', 'parseAngle', 'parseTime', 'round', 'solve', 'trim']);

// ---- Formatting.
assert.equal(C.formatDegrees(7.5), '7.5\u00b0');
assert.equal(C.formatDegrees(90), '90\u00b0');
assert.equal(C.formatDegrees(0.0916666), '0.09\u00b0');
assert.equal(C.formatDegrees(360), '360\u00b0');
assert.equal(C.formatFace(11700, true), '3:15');
assert.equal(C.formatFace(0, true), '12:00');
assert.equal(C.formatFace(43200 - 1, true), '11:59:59');
assert.equal(C.formatFace(11730, false), '3:15:30');
assert.equal(C.formatWait(3927.272727), '1:05:27.27');
assert.equal(C.formatWait(328.272727), '0:05:28.27');
assert.equal(C.formatWait(0.5), '0:00:00.50');
assert.equal(C.trim(2.5, 2), '2.5');
assert.equal(C.round(359.99166666, 6), 359.991667);

// ---- Reading a time on the face.
assert.equal(C.parseTime('03:15:00'), 11700);
assert.equal(C.parseTime('3:15'), 11700);
assert.equal(C.parseTime('15:15:00'), 11700, 'hours wrap onto the 12-hour face');
assert.equal(C.parseTime('12:00'), 0);
assert.equal(C.parseTime('00:00:00'), 0);
assert.equal(C.parseTime('23:59:59'), 43199);
assert.equal(failure({ time: '', angle: '90' }), 'Enter a time on the clock face.');
assert.equal(failure({ time: 'quarter past', angle: '90' }),
  'Write the time as hours:minutes, with optional seconds.');
assert.equal(failure({ time: '24:00:00', angle: '90' }), 'Hours must be between 0 and 23.');
assert.equal(failure({ time: '12:60:00', angle: '90' }),
  'Minutes and seconds must be between 0 and 59.');
assert.equal(C.parseAngle('90'), 90);
assert.equal(C.parseAngle('179.5'), 179.5);
assert.equal(C.parseAngle('.5'), 0.5);
assert.equal(failure({ time: '03:15:00', angle: '' }), 'Enter the target angle in degrees.');
assert.equal(failure({ time: '03:15:00', angle: '181' }),
  'The target angle must be between 0 and 180 degrees.');

// ---- Hand positions, checked against the published examples.
const at = (text) => plain(C.anglesAt(C.parseTime(text)));
assert.deepEqual(at('02:20:00'), { seconds: 8400, hourAngle: 70, minuteAngle: 120, angle: 50 });
assert.equal(at('10:16:00').hourAngle, 308);
assert.equal(at('10:16:00').minuteAngle, 96);
assert.equal(at('10:16:00').angle, 148, 'the obtuse difference is folded to 148');
assert.equal(at('06:00:00').angle, 180);
assert.equal(at('03:15:00').hourAngle, 97.5);
assert.equal(at('03:15:00').angle, 7.5);
assert.equal(at('11:59:59').angle, 0.091667);
assert.equal(at('12:00:00').hourAngle, 0, 'no 360-degree reading at twelve');

// ---- 400 seeded times against a component-based hand model.
const positions = (seconds) => {
  const t = ((seconds % CYCLE) + CYCLE) % CYCLE;
  const hours = Math.floor(t / 3600) % 12;
  const minutes = Math.floor((t % 3600) / 60);
  const secs = t % 60;
  const hour = 30 * hours + 0.5 * minutes + secs / 120;
  const minute = 6 * minutes + 0.1 * secs;
  const raw = ((minute - hour) % 360 + 360) % 360;
  return { hour, minute, angle: raw > 180 ? 360 - raw : raw };
};
let seed = 20261118;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
for (let trial = 0; trial < 400; trial += 1) {
  const seconds = Math.floor(random() * CYCLE);
  const result = plain(C.anglesAt(seconds));
  const expect = positions(seconds);
  const label = trial + ' at ' + seconds + 's';
  near(result.hourAngle, expect.hour, 1e-6, 'hour hand ' + label);
  near(result.minuteAngle, expect.minute, 1e-6, 'minute hand ' + label);
  near(result.angle, expect.angle, 0.0000011, 'angle between ' + label);
  assert.ok(result.angle >= 0 && result.angle <= 180, 'the angle is folded ' + label);
  assert.ok(result.hourAngle >= 0 && result.hourAngle < 360, 'hour hand in range ' + label);
  assert.ok(result.minuteAngle >= 0 && result.minuteAngle < 360, 'minute hand in range ' + label);
}

// ---- The 12-hour cycle of a target angle, counted from the published rates.
const cycleFromRates = (target) => {
  const times = [];
  const step = CYCLE / 11;                 // 3927.2727 s between repeats of one family
  const families = target === 0 || target === 180 ? 1 : 2;
  for (let family = 0; family < families; family += 1) {
    const offset = family === 0 ? (target * 120) / 11 : CYCLE - (target * 120) / 11;
    for (let k = 0; k < 11; k += 1) {
      const t = offset + k * step;
      const value = ((t % CYCLE) + CYCLE) % CYCLE;
      if (value < CYCLE - 1e-9 && !times.some((other) => Math.abs(other - value) < 1e-6)) {
        times.push(value);
      }
    }
  }
  return times.sort((left, right) => left - right);
};
assert.equal(cycleFromRates(0).length, 11);
assert.equal(cycleFromRates(180).length, 11);
assert.equal(cycleFromRates(90).length, 22);

let checked = 0;
for (let trial = 0; trial < 120; trial += 1) {
  const seconds = Math.floor(random() * CYCLE);
  const target = Math.round(random() * 1800) / 10;
  const from = C.parseTime(
    Math.floor(seconds / 3600) + ':' +
    String(Math.floor((seconds % 3600) / 60)).padStart(2, '0') + ':' +
    String(seconds % 60).padStart(2, '0'));
  const result = run({ time: C.formatFace(from, false), angle: String(target) });
  const cycle = cycleFromRates(target);
  assert.equal(result.cycleCount, cycle.length, 'cycle count for ' + target);
  assert.equal(result.nextWaits.length, 6, 'six upcoming times for ' + target);
  let previous = 0;
  for (const wait of result.nextWaits) {
    assert.ok(wait > 0, 'each wait is in the future');
    assert.ok(wait <= CYCLE + 1e-6, 'each wait is inside one cycle');
    assert.ok(wait > previous, 'waits are strictly increasing');
    previous = wait;
    near(positions(from + wait).angle, target, 0.0000011, 'the wait lands on the target');
  }
  // The first wait must agree with the nearest cycle time after this moment.
  const upcoming = cycle.filter((time) => time > from + 1e-9);
  const expectFirst = upcoming.length ? upcoming[0] - from : cycle[0] + CYCLE - from;
  near(result.nextWaits[0], expectFirst, 1e-4, 'the first wait is the nearest moment');
  checked += 1;
}
assert.equal(checked, 120);

// ---- A whole cycle: 11 coincidences and 22 right angles, evenly spread.
const overlaps = plain(C.cycleTimes(0));
assert.equal(overlaps.length, 11);
for (let index = 1; index < overlaps.length; index += 1) {
  near(overlaps[index] - overlaps[index - 1], 43200 / 11, 1e-6, 'overlaps every 65 5/11 minutes');
}
near(overlaps[0], 0, 1e-9, 'the cycle starts at twelve');
assert.equal(C.cycleTimes(180).length, 11);
assert.equal(C.cycleTimes(0.1).length, 22);
assert.equal(C.cycleTimes(179.9).length, 22);

// ---- Solve keeps the published pieces together.
const solved = run({ time: '03:15:00', angle: '90' });
assert.equal(solved.timeText, '3:15');
assert.equal(solved.hourAngle, 97.5);
assert.equal(solved.minuteAngle, 90);
assert.equal(solved.angle, 7.5);
assert.equal(solved.target, 90);
assert.equal(solved.cycleCount, 22);
near(solved.firstWait, 1063.636364, 1e-4, 'first right angle after 3:15');
assert.equal(C.formatFace(solved.seconds + solved.firstWait, false), '3:32:44');

// ---- Catalog replay of the published cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug appears once');
assert.equal(record.name, 'Clock Hand Angle Calculator');
assert.equal(record.category, 'Time');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.sources.length, 1, 'the hand-angle model carries one citation');
assert.equal(record.sources[0].url, 'https://en.wikipedia.org/wiki/Clock_angle_problem');
assert.equal(record.testCases.length, 24, '24 catalog cases');
assert.equal(record.testCases.filter((entry) => entry.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((entry) => entry.kind === 'boundary').length, 4);
assert.equal(record.testCases.filter((entry) => entry.kind === 'validation').length, 10);

for (const testCase of record.testCases) {
  const input = { time: testCase.input.time, angle: testCase.input.angle };
  if (testCase.expectedError) {
    assert.equal(failure(input), testCase.expectedError, 'refusal: ' + testCase.name);
    continue;
  }
  const result = run(input);
  const expected = testCase.expected;
  for (const key of ['hourAngle', 'minuteAngle', 'angle']) {
    near(result[key], expected[key], 1e-6, testCase.name + ' ' + key);
  }
  assert.equal(result.cycleCount, expected.cycleCount, testCase.name + ' cycle count');
  near(result.firstWait, expected.firstWait, 1e-4, testCase.name + ' first wait');
}

// ---- The catalog is the single place a slug, name or alias may live.
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

// ---- Refusals stay specific.
assert.equal(failure({ time: '', angle: '90' }), 'Enter a time on the clock face.');
assert.equal(failure({ time: '3:15:00:00', angle: '90' }),
  'Write the time as hours:minutes, with optional seconds.');
assert.equal(failure({ time: '12:30:60', angle: '90' }),
  'Minutes and seconds must be between 0 and 59.');
assert.equal(failure({ time: '03:15:00', angle: '' }), 'Enter the target angle in degrees.');
assert.equal(failure({ time: '03:15:00', angle: 'ninety' }),
  'Use digits only for the target angle.');
assert.equal(failure({ time: '03:15:00', angle: '-5' }),
  'Use digits only for the target angle.');
assert.equal(failure({ time: '03:15:00', angle: '180.5' }),
  'The target angle must be between 0 and 180 degrees.');

// ---- Page contract.
assert.ok(/<h1>Clock Hand Angle Calculator<\/h1>/.test(html), 'heading');
assert.ok(/<form id="clock-form" novalidate>/.test(html), 'form');
for (const id of ['in-time', 'in-angle', 'err', 'run', 'copy', 'status', 'out', 'headline', 'sub',
  'fact-hour', 'fact-minute', 'fact-angle', 'table-caption', 'rows', 'ticks', 'face-title',
  'hour-hand', 'minute-hand']) {
  assert.ok(html.includes('id="' + id + '"'), 'element id: ' + id);
}
for (const label of ['Time on the clock', 'Target angle']) {
  assert.ok(html.includes('>' + label + '</label>'), 'label: ' + label);
}
assert.ok(/<button type="submit" id="run">Calculate angle<\/button>/.test(html), 'submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/aria-labelledby="face-title"/.test(html), 'the clock face is labelled');
assert.ok(/<th scope="col" class="num">From now<\/th>/.test(html), 'table header');
assert.ok(/nothing is sent or stored/.test(html), 'the note states local only');
assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(html),
  'no off-site links or requests beyond the SVG namespace');
assert.ok(!/<script[^>]+src="(?!\/assets\/)/.test(html), 'only local scripts');
assert.ok(!/\son(click|input|change|submit|keydown)=/.test(html), 'no inline event handlers');
assert.equal(html.match(/<script/g).length, 3, 'theme init, shared app and the tool script');
assert.ok(/min-height:44px/.test(html), '44px touch targets');
const ids = html.match(/\bid="[^"]+"/g).map((value) => value.slice(4, -1));
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');

console.log('clock hand angle calculator: all assertions passed');
