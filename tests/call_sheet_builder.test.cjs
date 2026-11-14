/* Regression checks for the call sheet builder core, page contract and catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/call-sheet-builder/index.html'), 'utf8');
const start = html.indexOf('/* call-sheet-core:start */');
const end = html.indexOf('/* call-sheet-core:end */');
assert.ok(start > -1 && end > start, 'call sheet core markers missing');
const core = html.slice(start, end + '/* call-sheet-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CallSheetCore;', sandbox);
const C = sandbox.module.exports;
const same = (actual, expected, label) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), label);

const scene = (name, minutes) => ({ name, minutes: String(minutes) });
const base = {
  production: 'Kitchen Table', date: '', location: '', firstShot: '08:30', setup: '45',
  mealAfter: '6', mealLength: '30', wrapDown: '15',
  scenes: [scene('Kitchen dialogue', 90), scene('Exterior walk-and-talk', 120),
           scene('Living room coverage', 90), scene('Pickups and inserts', 90)],
};
const plan = (overrides = {}) => C.build({ ...base, ...overrides });

// The default day: 07:45 crew call, a meal inside scene four, 15:45 wrap.
const standard = plan();
assert.equal(standard.crewCall, 465);
assert.equal(standard.firstShot, 510);
assert.equal(standard.mealTime, 825);
assert.equal(standard.mealPlaced, true);
assert.equal(standard.sceneCount, 4);
assert.equal(standard.shootMinutes, 390);
assert.equal(standard.wrap, 945);
assert.equal(standard.dayMinutes, 480);
same(standard.events.map((event) => [event.kind, event.start, event.end]), [
  ['setup', 465, 510],
  ['scene', 510, 600],
  ['scene', 600, 720],
  ['scene', 720, 810],
  ['scene', 810, 825],
  ['meal', 825, 855],
  ['scene', 855, 930],
]);
assert.equal(standard.events[4].part, 1);
assert.equal(standard.events[6].part, 2);
assert.equal(standard.events[6].minutes, 75);
assert.equal(standard.events[6].name, 'Pickups and inserts');
assert.match(C.sheet(standard), /07:45–08:30 {2}Crew call and setup \(45 min\)/);
assert.match(C.sheet(standard), /13:45–14:15 {2}Meal break \(30 min\)/);
assert.match(C.sheet(standard), /14:15–15:30 {2}Scene 4 — Pickups and inserts \(continued\) \(75 min\)/);
assert.match(C.sheet(standard), /15:45 {2}Wrap/);
assert.match(C.sheet(standard), /Scenes: 4 · shoot time 6 h 30 min · day 8 h/);

// Clock and duration formatting, including the next-day marker.
assert.equal(C.clock(0), '00:00');
assert.equal(C.clock(465), '07:45');
assert.equal(C.clock(1439), '23:59');
assert.equal(C.clock(1440), '00:00 +1');
assert.equal(C.clock(1590), '02:30 +1');
assert.equal(C.duration(0), '0 min');
assert.equal(C.duration(45), '45 min');
assert.equal(C.duration(480), '8 h');
assert.equal(C.duration(825), '13 h 45 min');

// A scene that ends exactly on the meal time keeps the meal ahead of the next scene.
const boundary = plan({
  firstShot: '08:00', setup: '30',
  scenes: [scene('Opening', 60), scene('Interview', 120), scene('Walkthrough', 150), scene('Close', 60)],
});
assert.equal(boundary.crewCall, 450);
assert.equal(boundary.mealPlaced, true);
same(boundary.events.slice(3).map((event) => [event.kind, event.start, event.end]), [
  ['scene', 660, 810], ['meal', 810, 840], ['scene', 840, 900],
]);
assert.equal(boundary.wrap, 915);

// No meal when the day wraps before the interval, and its warning.
const short = plan({ firstShot: '08:00', setup: '30', scenes: [scene('Opening', 60), scene('Interview', 90)] });
assert.equal(short.mealPlaced, false);
assert.equal(short.wrap, 645);
same(short.warnings, [
  'The day wraps before the meal interval, so no meal break was scheduled.',
]);

// Long-day and past-midnight warnings.
const long = plan({ firstShot: '06:00', setup: '60', scenes: [scene('Setup block', 240), scene('Dialogue', 240), scene('Night exterior', 240)] });
assert.equal(long.dayMinutes, 825);
assert.ok(long.warnings.some((warning) => warning === 'This is a long day: 13 h 45 min from crew call to wrap.'));
const midnight = plan({ firstShot: '20:00', setup: '30', scenes: [scene('Dusk wide', 120), scene('Interior', 120), scene('Night exterior', 120)] });
assert.equal(midnight.wrap, 1605);
assert.equal(C.clock(midnight.wrap), '02:45 +1');
assert.ok(midnight.warnings.some((warning) => warning.startsWith('The schedule runs past midnight')));

// A meal interval equal to the setup places the meal before the first scene.
const early = plan({ firstShot: '12:00', setup: '180', mealAfter: '3', wrapDown: '10', scenes: [scene('Single scene', 60)] });
assert.equal(early.mealTime, early.firstShot);
same(early.events.map((event) => [event.kind, event.start, event.end]), [
  ['setup', 540, 720], ['meal', 720, 750], ['scene', 750, 810],
]);
assert.equal(early.wrap, 820);

// Zero setup and zero wrap-down are both accepted.
const zero = plan({ firstShot: '09:00', setup: '0', mealAfter: '4', wrapDown: '0', scenes: [scene('Single scene', 30)] });
assert.equal(zero.crewCall, zero.firstShot);
assert.equal(zero.wrap, zero.events[zero.events.length - 1].end);

// Strict validation for every field.
assert.throws(() => plan({ production: '   ' }), /Production is required\./);
assert.throws(() => plan({ production: 'X'.repeat(81) }), /Production must be 80 characters or fewer\./);
assert.throws(() => plan({ location: 'X'.repeat(81) }), /Location must be 80 characters or fewer\./);
assert.throws(() => plan({ date: '2026-13-01' }), /Shoot date must be a real date in YYYY-MM-DD form\./);
assert.throws(() => plan({ date: '2025-02-29' }), /Shoot date must be a real date in YYYY-MM-DD form\./);
assert.throws(() => plan({ firstShot: '8:30' }), /First shot must be a 24-hour time in HH:MM form\./);
assert.throws(() => plan({ firstShot: '24:00' }), /First shot must be a 24-hour time in HH:MM form\./);
assert.throws(() => plan({ firstShot: '' }), /First shot must be a 24-hour time in HH:MM form\./);
assert.throws(() => plan({ setup: '241' }), /Setup must be between 0 and 240 minutes\./);
assert.throws(() => plan({ setup: '-1' }), /Setup must be a whole number between 0 and 240 minutes\./);
assert.throws(() => plan({ setup: '4.5' }), /Setup must be a whole number between 0 and 240 minutes\./);
assert.throws(() => plan({ mealAfter: '2' }), /Meal break must be between 3 and 8 hours after the crew call\./);
assert.throws(() => plan({ mealLength: '10' }), /Meal length must be between 15 and 90 minutes\./);
assert.throws(() => plan({ wrapDown: '121' }), /Wrap-down must be between 0 and 120 minutes\./);
assert.throws(() => plan({ scenes: [] }), /Add at least one scene\./);
assert.throws(() => plan({ scenes: [scene(' ', 30)] }), /Scene 1 is required\./);
assert.throws(() => plan({ scenes: [scene('Opening', 0)] }), /Scene 1 minutes must be between 1 and 600 minutes\./);
assert.throws(() => plan({ scenes: [scene('Opening', '4.5')] }), /Scene 1 minutes must be a whole number between 1 and 600 minutes\./);
assert.throws(() => plan({ scenes: [scene('Opening', 601)] }), /Scene 1 minutes must be between 1 and 600 minutes\./);
assert.throws(() => plan({ firstShot: '00:10', setup: '30' }), /Setup pushes the crew call before midnight\./);
assert.throws(() => plan({ firstShot: '12:00', setup: '240', mealAfter: '3' }), /The meal break falls before the first shot; raise the meal interval or shorten the setup\./);
assert.throws(() => plan({ firstShot: '22:00', setup: '30', scenes: [scene('A', 600), scene('B', 600), scene('C', 600)] }), /The schedule runs more than a day past midnight; shorten the scenes or start earlier\./);

// Scene-count limits: forty scenes pass, forty-one are refused even with tiny durations.
const many = (count) => Array.from({ length: count }, (_, index) => scene('Scene ' + (index + 1), 1));
assert.equal(plan({ scenes: many(40) }).sceneCount, 40);
assert.throws(() => plan({ scenes: many(41) }), /A call sheet can list at most 40 scenes\./);
same(C.limits, { scenes: 40, sceneMinutes: 600, name: 80 });

// Whole-character trimming collapses whitespace and control characters.
assert.equal(plan({ production: '  Kitchen \n Table  ' }).production, 'Kitchen Table');
assert.equal(plan({ date: '2024-02-29' }).date, '2024-02-29');
assert.equal(plan({ date: '' }).date, '');

// Independent minute-grid simulation used to cross-check the event model.
function simulate(input) {
  const [hours, minutes] = input.firstShot.split(':').map(Number);
  const first = hours * 60 + minutes;
  const setup = Number(input.setup);
  const mealLength = Number(input.mealLength);
  const wrapDown = Number(input.wrapDown);
  const crew = first - setup;
  const mealTime = crew + Number(input.mealAfter) * 60;
  const lengths = input.scenes.map((row) => Number(row.minutes));
  let clock = first;
  let mealDone = false;
  let blockStart = clock;
  let sceneIndex = 0;
  let remaining = lengths[0];
  const totals = lengths.map(() => 0);
  while (sceneIndex < lengths.length) {
    if (!mealDone && clock >= mealTime) {
      clock += mealLength;
      mealDone = true;
      blockStart = clock;
      continue;
    }
    const room = mealDone ? remaining : Math.min(remaining, mealTime - clock);
    totals[sceneIndex] += room;
    clock += room;
    remaining -= room;
    if (remaining === 0) {
      sceneIndex += 1;
      remaining = lengths[sceneIndex];
      blockStart = clock;
    }
  }
  return { crew, wrap: clock + wrapDown, mealDone, shoot: totals.reduce((a, b) => a + b, 0) };
}

let randomSeed = 20261114;
function nextRandom() {
  randomSeed = (randomSeed * 1103515245 + 12345) % 2147483648;
  return randomSeed / 2147483648;
}
const pick = (list) => list[Math.floor(nextRandom() * list.length)];
let simulated = 0;
for (let run = 0; run < 400; run += 1) {
  const mealAfter = 3 + Math.floor(nextRandom() * 6);
  const setup = Math.floor(nextRandom() * (Math.min(240, mealAfter * 60) + 1));
  const first = setup + Math.floor(nextRandom() * (1440 - setup));
  const input = {
    production: 'Random Day', date: '', location: '', firstShot: String(Math.floor(first / 60)).padStart(2, '0') + ':' + String(first % 60).padStart(2, '0'),
    setup: String(setup), mealAfter: String(mealAfter), mealLength: pick(['15', '30', '45', '60', '90']),
    wrapDown: String(Math.floor(nextRandom() * 121)),
    scenes: Array.from({ length: 1 + Math.floor(nextRandom() * 6) }, (_, index) => scene('Scene ' + (index + 1), 1 + Math.floor(nextRandom() * 240))),
  };
  let result;
  try {
    result = C.build(input);
  } catch (error) {
    continue;
  }
  const reference = simulate(input);
  assert.equal(result.crewCall, reference.crew, 'random crew call');
  assert.equal(result.wrap, reference.wrap, 'random wrap');
  assert.equal(result.mealPlaced, reference.mealDone, 'random meal placement');
  assert.equal(result.shootMinutes, reference.shoot, 'random shoot minutes');
  assert.equal(result.events[0].start, result.crewCall);
  for (let i = 1; i < result.events.length; i += 1) {
    assert.equal(result.events[i].start, result.events[i - 1].end, 'events are contiguous');
  }
  const lastSceneEnd = result.events[result.events.length - 1].end;
  assert.equal(result.wrap, lastSceneEnd + Number(input.wrapDown), 'wrap follows the last scene');
  const sceneMinutes = result.events.filter((event) => event.kind === 'scene').reduce((sum, event) => sum + event.minutes, 0);
  assert.equal(sceneMinutes, result.shootMinutes, 'scene parts add up');
  const mealMinutes = result.events.filter((event) => event.kind === 'meal').reduce((sum, event) => sum + event.minutes, 0);
  assert.equal(mealMinutes, result.mealPlaced ? result.mealLength : 0, 'meal minutes match placement');
  simulated += 1;
}
assert.ok(simulated > 300, 'enough random plans were compared');

// Replay every canonical catalog case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'call-sheet-builder');
assert.ok(record, 'catalog entry present');
assert.equal(catalog.tools.length, 2270, 'catalog total');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'moderate');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.testCases.length, 25);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`);
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.build(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  const result = C.build(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') near(result[key], value, `${testCase.name} ${key}`);
    else assert.equal(result[key], value, `${testCase.name} ${key}`);
  }
}

// Page contract: shared shell, accessible controls, no inline handlers or network calls.
assert.match(html, /<title>Call Sheet Builder — Virtual Tools<\/title>/);
assert.match(html, /<meta name="description" content="[^"]{40,}">/);
assert.match(html, /<script src="\/assets\/theme-init\.js"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style\.css">/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<form id="sheet-form" novalidate>/);
assert.match(html, /id="out" aria-live="polite"/);
assert.match(html, /role="alert" aria-live="polite"/);
assert.doesNotMatch(html, /\son[a-z]+=/i, 'no inline event handlers');
assert.doesNotMatch(html, /https?:\/\//i, 'no external requests');
assert.doesNotMatch(html, /<script src="(?!\/assets\/)/, 'only local scripts');
for (const id of ['in-production', 'in-date', 'in-location', 'in-first', 'in-setup', 'in-wrapr', 'in-mealafter', 'in-meallen', 'rows', 'add', 'reset', 'copy', 'sheet-text']) {
  assert.ok(html.includes(`id="${id}"`), `missing control ${id}`);
}
assert.match(html, /"scene-remove"/);
assert.match(html, /type="button" id="add"/);
assert.match(html, /class="scene-columns" aria-hidden="true"/);

console.log(`call-sheet-builder: all checks passed (${record.testCases.length} catalog cases, ${simulated} simulated plans)`);
