/* Triathlon split planner: the split arithmetic, the three solve modes, the
   exact rejection messages, the page contract and every catalog case. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'triathlon-split-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* triathlon-core:start */';
const endMarker = '/* triathlon-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreText), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, parseInt, module: {} };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = TriathlonCore;', sandbox);
const C = sandbox.module.exports;

const failure = (input) => {
  try { C.solve(input); } catch (error) { return error.message; }
  return null;
};
const near = (actual, expected, label) => {
  assert.ok(Math.abs(actual - expected) <= 1e-6, label + ': ' + actual + ' != ' + expected);
};
const base = {
  swimM: '1500', bikeKm: '40', runKm: '10', goal: '2:45:00', t1: '0:03:00', t2: '0:02:00',
  solveFor: 'bike', swimPace: '1:50', runPace: '5:00',
};
const withInput = (overrides) => Object.assign({}, base, overrides);

// ---- Course presets and the clock parser.
assert.equal(C.PRESETS.map((preset) => preset.key).join(','), 'sprint,olympic,half,full');
const distances = C.PRESETS.map((preset) => [preset.swimM, preset.bikeKm, preset.runKm].join('/'));
assert.equal(distances.join('|'), '750/20/5|1500/40/10|1900/90/21.0975|3800/180/42.195');
assert.equal(C.parseClock('2:45:00'), 9900);
assert.equal(C.parseClock('45:30'), 2730);
assert.equal(C.parseClock('0:03:00'), 180);
assert.equal(C.parseClock('5400'), 5400);
assert.equal(C.parseClock('90.5'), 90.5);
assert.equal(C.parseClock('1:45.5'), 105.5);
assert.equal(C.parseClock('7:60'), null, 'sixty seconds is not a valid mm:ss');
assert.equal(C.parseClock('2h45'), null);
assert.equal(C.parseClock(''), null);

// ---- The split arithmetic, written out from the definition.
const def = C.solve(base);
assert.equal(def.preset, 'Olympic');
near(def.swimSeconds, 1500 / 100 * 110, 'swim time');
near(def.runSeconds, 10 * 300, 'run time');
near(def.bikeSeconds, 9900 - 180 - 120 - 1650 - 3000, 'bike time');
near(def.bikeSpeed, 40 * 3600 / 4950, 'bike speed');
near(def.goalSeconds, 9900, 'goal');
near(def.totalSeconds, 9900, 'total equals the target');
near(def.cumulative.swim, 1650, 'clock after the swim');
near(def.cumulative.t1, 1830, 'clock after T1');
near(def.cumulative.bike, 6780, 'clock after the bike');
near(def.cumulative.t2, 6900, 'clock after T2');
near(def.cumulative.run, 9900, 'clock at the finish');
assert.equal(def.solved.field, 'bike');
assert.equal(def.solved.text, '29.1 km/h');

// The other two solve modes hold the bike instead.
const runSolved = C.solve(withInput({ solveFor: 'run', bikeSpeed: '32', goal: '3:00:00' }));
near(runSolved.runSeconds, 10800 - 180 - 120 - 1650 - 4500, 'run time when solved');
near(runSolved.runPace, 435, 'run pace when solved');
assert.equal(runSolved.solved.field, 'run');
assert.equal(runSolved.solved.text, '7:15 per km');
const swimSolved = C.solve(withInput({ solveFor: 'swim', bikeSpeed: '32', goal: '3:00:00' }));
near(swimSolved.swimSeconds, 10800 - 180 - 120 - 4500 - 3000, 'swim time when solved');
near(swimSolved.swimPace, 200, 'swim pace when solved');
assert.equal(swimSolved.solved.field, 'swim');
assert.equal(swimSolved.solved.text, '3:20 per 100 m');

// A preset re-costs the same target on a longer course.
const sprinter = C.solve(withInput({ swimM: '750', bikeKm: '20', runKm: '5', goal: '1:30:00' }));
assert.equal(sprinter.preset, 'Sprint');
near(sprinter.bikeSpeed, 20 * 3600 / 2775, 'sprint bike speed');
const custom = C.solve(withInput({ swimM: '1234', bikeKm: '33', runKm: '7' }));
assert.equal(custom.preset, 'Custom');

// ---- Display formatting rounds to whole seconds and carries the minute.
assert.equal(C.fmtClock(9900), '2:45:00');
assert.equal(C.fmtClock(105), '1:45');
assert.equal(C.fmtClock(0), '0:00');
assert.equal(C.fmtClock(59.6), '1:00');
assert.equal(C.fmtClock(3599.5), '1:00:00');
assert.equal(C.fmtClock(3600), '1:00:00');

// ---- Rejections, with their exact messages.
assert.equal(failure(withInput({ swimM: '' })), 'Swim distance is required.');
assert.equal(failure(withInput({ swimM: '20' })), 'Swim distance must be a number from 50 to 10000 m.');
assert.equal(failure(withInput({ swimM: '1.5km' })), 'Swim distance must be a number from 50 to 10000 m.');
assert.equal(failure(withInput({ bikeKm: '600' })), 'Bike distance must be a number from 1 to 500 km.');
assert.equal(failure(withInput({ runKm: '0.5' })), 'Run distance must be a number from 1 to 100 km.');
assert.equal(failure(withInput({ goal: '' })), 'Target finish time is required.');
assert.equal(failure(withInput({ goal: '2h45' })), 'Target finish time must look like h:mm:ss, mm:ss or a number of seconds, for example 2:45:00, 45:30 or 2700.');
assert.equal(failure(withInput({ goal: '0:04:00' })), 'Target finish time must be between 0:05:00 and 36:00:00.');
assert.equal(failure(withInput({ goal: '37:00:00' })), 'Target finish time must be between 0:05:00 and 36:00:00.');
assert.equal(failure(withInput({ t1: '' })), 'T1 is required.');
assert.equal(failure(withInput({ t1: '0:03:60' })), 'T1 must look like h:mm:ss or mm:ss, for example 0:03:00.');
assert.equal(failure(withInput({ t2: '-1:00' })), 'T2 must look like h:mm:ss or mm:ss, for example 0:02:00.');
assert.equal(failure(withInput({ t2: '2:00:01' })), 'T2 must be between 0:00 and 2:00:00.');
assert.equal(failure(withInput({ solveFor: 'bike-run' })), 'Choose which leg to solve for: bike, run or swim.');
assert.equal(failure(withInput({ swimPace: '' })), 'Swim pace is required.');
assert.equal(failure(withInput({ swimPace: '0:20' })), 'Swim pace must be between 0:30 and 20:00 per 100 m.');
assert.equal(failure(withInput({ runPace: '35:00' })), 'Run pace must be between 2:00 and 30:00 per km.');
assert.equal(failure(withInput({ solveFor: 'run', bikeSpeed: 'fast' })), 'Bike speed must be a number from 5 to 100 km/h.');
assert.equal(failure(withInput({ solveFor: 'run', bikeSpeed: '4' })), 'Bike speed must be a number from 5 to 100 km/h.');
assert.equal(failure(withInput({ goal: '0:05:00', t1: '2:00:00' })), 'The transitions alone fill the target time; lower T1 or T2.');
assert.equal(failure(withInput({ goal: '1:00:00' })), 'That target time leaves no time for the bike leg. Raise the target or shorten the other two legs.');
assert.equal(failure(withInput({ goal: '0:40:00', solveFor: 'run', bikeSpeed: '100' })), 'That target time leaves no time for the run leg. Raise the target or shorten the other two legs.');
assert.equal(failure(withInput({ goal: '0:40:00', solveFor: 'swim', bikeSpeed: '100', runPace: '5:00' })), 'That target time leaves no time for the swim leg. Raise the target or shorten the other two legs.');
assert.equal(
  failure(withInput({ swimM: '50', bikeKm: '500', runKm: '1', goal: '5:00:00', t1: '0:00', t2: '0:00', swimPace: '0:30', runPace: '2:00' })),
  'That target time needs 100.8 km/h on the bike; this page accepts 5 to 100 km/h.'
);
assert.equal(
  failure(withInput({ swimM: '50', bikeKm: '1', runKm: '10', goal: '0:20:00', t1: '0:00', t2: '0:00', solveFor: 'run', swimPace: '0:30', bikeSpeed: '100' })),
  'That target time needs a 1:55 run pace; this page accepts 2:00 to 30:00 per km.'
);
assert.equal(
  failure(withInput({ swimM: '3000', bikeKm: '1', runKm: '1', goal: '0:10:00', t1: '0:00', t2: '0:00', solveFor: 'swim', bikeSpeed: '100', runPace: '2:00' })),
  'That target time needs a 0:15 swim pace; this page accepts 0:30 to 20:00 per 100 m.'
);
// The boundaries themselves are accepted.
assert.ok(C.solve(withInput({ goal: '0:05:00', swimM: '50', bikeKm: '1', runKm: '1', t1: '0:00', t2: '0:00', swimPace: '0:30', runPace: '2:00' })));
assert.ok(C.solve(withInput({ goal: '36:00:00', swimM: '3800', bikeKm: '180', runKm: '42.195', t1: '0:00', t2: '0:00', swimPace: '20:00', runPace: '30:00' })));

// ---- Page markup: the documented contract.
for (const id of ['tri-form', 'swim', 'bike', 'run', 'goal', 't1', 't2', 'solve-for', 'swim-pace',
  'bike-speed', 'run-pace', 'err', 'out', 'status', 'reset', 'formula']) {
  assert.ok(html.includes(`id="${id}"`), 'missing element #' + id);
}
for (const id of ['swim', 'bike', 'run', 'goal', 't1', 't2', 'solve-for', 'swim-pace', 'bike-speed', 'run-pace']) {
  assert.ok(new RegExp(`<label class="f" for="${id}">`).test(html), 'missing label for #' + id);
}
assert.ok(/id="out"[^>]*aria-live="polite"/.test(html), 'the result is announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status" aria-live="polite"/.test(html), 'the status line is announced');
assert.ok(/<button type="submit" class="primary">/.test(html), 'the plan button submits');
assert.ok(/<button type="button" id="reset"/.test(html), 'reset is a plain button');
assert.equal((html.match(/class="chip"/g) || []).length, 4, 'four course presets');
assert.ok(!/\son(click|change|input|submit|load)=/.test(html), 'no inline event handlers');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|navigator\.sendBeacon/.test(html),
  'the page makes no network or storage calls');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no third-party scripts');
assert.ok(html.includes('/assets/theme-init.js'), 'the theme is applied before paint');
assert.ok(html.includes('/assets/style.css'), 'the shared stylesheet is used');
assert.ok(html.includes('/assets/app.js'), 'the shared header is loaded');
assert.ok(html.includes('value="2:45:00"'), 'the example target is filled in');
assert.ok(html.includes('@media (max-width:560px)'), 'the layout reflows for phones');
assert.ok(html.includes('min-height:44px'), 'controls keep a 44 px target');
assert.ok(html.includes('setAttribute("scope", "col")'), 'table headers are scoped');
assert.ok(html.includes('overflow-x:auto'), 'the split table scrolls on narrow screens');
assert.ok(html.includes('<select id="solve-for">'), 'the solve target is a select');

// ---- Catalog record and every case in it must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2260, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Triathlon Split Planner');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.legacyCategory, null);
assert.equal(record.icon, '🏊');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.tags.includes('triathlon'));
assert.ok(record.tags.includes('splits'));
assert.ok(record.aliases.includes('Multisport Split Planner'));
assert.ok(record.method.length > 1000, 'the method documents the arithmetic and its limits');
for (const phrase of ['target', 'transitions', 'average speed', 'no network']) {
  assert.ok(record.method.includes(phrase), 'method states ' + phrase);
}
assert.equal(record.sources.length, 3, 'sources are cited');
assert.ok(record.sources.every((source) => typeof source.title === 'string' && source.title.length > 20));
assert.equal(catalog.tools.filter((tool) => tool.category === 'Sports & Outdoors').length, 43, 'Sports & Outdoors count');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'one record');
assert.equal(catalog.tools.filter((tool) => tool.name === record.name).length, 1, 'one name');
assert.equal(catalog.tools.filter((tool) => (tool.tags || []).includes('triathlon')).length, 1, 'one triathlon tool');

assert.equal(record.testCases.length, 37, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 5);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 22);
for (const testCase of record.testCases) {
  const expected = testCase.expected;
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), expected.error, testCase.name);
    continue;
  }
  const result = C.solve(testCase.input);
  for (const key of ['swimSeconds', 'bikeSeconds', 'runSeconds', 'swimPace', 'bikeSpeed', 'runPace',
    'goalSeconds', 't1Seconds', 't2Seconds', 'totalSeconds']) {
    near(result[key], expected[key], testCase.name + ' ' + key);
  }
  for (const key of ['swim', 't1', 'bike', 't2', 'run']) {
    near(result.cumulative[key], expected.cumulative[key], testCase.name + ' cumulative.' + key);
  }
  assert.equal(result.solveFor, expected.solved, testCase.name + ' solve target');
  near(result.totalSeconds, result.goalSeconds, testCase.name + ' total equals the target');
}

console.log(slug + ': ' + record.testCases.length + ' catalog cases, the split arithmetic and the page contract pass');
