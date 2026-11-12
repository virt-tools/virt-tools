/* Regression checks for the jet lag planner core, its catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'jet-lag-adjustment-planner';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* jet-lag-core:start */');
const end = html.indexOf('/* jet-lag-core:end */');
assert.ok(start > -1 && end > start, 'jet-lag core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + '/* jet-lag-core:end */'.length) + '\nmodule.exports = JetLag;', sandbox);
const J = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Health');
assert.equal(entry.subcategory, 'Planning');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);

const failure = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.message;
  }
  return null;
};
const close = (actual, expected, tolerance, label) => {
  assert.ok(Number.isFinite(actual), `not a finite number: ${actual} ${label || ''}`);
  const limit = Math.max(Math.abs(expected) * (tolerance || 1e-9), 1e-12);
  assert.ok(Math.abs(actual - expected) <= limit, `${label || 'value'}: ${actual} != ${expected} (limit ${limit})`);
};

// --- Published arithmetic anchors. ---
const tokyo = J.compute({ originOffset: '-5', destOffset: '9', bedtime: '23:00', wake: '07:00', days: '6', maxShift: '2', direction: 'auto' });
assert.equal(tokyo.clockChange, 840);
assert.equal(tokyo.wrapped, -600);
assert.equal(tokyo.signed, -600);
assert.equal(tokyo.direction, 'delay');
assert.equal(tokyo.magnitude, 600);
assert.equal(tokyo.dailyShift, 100);
assert.equal(tokyo.daysToAdjust, 6);
assert.equal(tokyo.arrivalBedtime, 780);
assert.equal(tokyo.arrivalWake, 1260);
assert.equal(tokyo.sleepMinutes, 480);
assert.equal(tokyo.schedule.length, 7);
assert.equal(tokyo.schedule[0].bedtime, 780);
assert.equal(tokyo.schedule[6].bedtime, 1380);
assert.equal(tokyo.schedule[6].remaining, 0);

const london = J.compute({ originOffset: '0', destOffset: '-5', bedtime: '23:00', wake: '07:00', days: '4', maxShift: '1.5', direction: 'auto' });
assert.equal(london.clockChange, -300);
assert.equal(london.dailyShift, 75);
assert.equal(london.arrivalBedtime, 1080);
assert.equal(london.arrivalWake, 120);

const forced = J.compute({ originOffset: '-5', destOffset: '9', bedtime: '22:30', wake: '06:30', days: '7', maxShift: '2', direction: 'advance' });
assert.equal(forced.wrapped, -600);
assert.equal(forced.signed, 840);
assert.equal(forced.direction, 'advance');
assert.equal(forced.arrivalBedtime, 750);
assert.equal(forced.daysToAdjust, 7);

const infeasible = J.compute({ originOffset: '-5', destOffset: '9', bedtime: '23:00', wake: '07:00', days: '2', maxShift: '1.5', direction: 'auto' });
assert.equal(infeasible.feasible, false);
assert.equal(infeasible.dailyShift, 90);
assert.equal(infeasible.daysToAdjust, 7);

// --- Twelve hours is treated as an advance, and wrapping keeps (-720, 720]. ---
assert.equal(J.wrap(720), 720);
assert.equal(J.wrap(-720), 720);
assert.equal(J.wrap(840), -600);
assert.equal(J.wrap(-840), 600);
const twelve = J.compute({ originOffset: '0', destOffset: '12', bedtime: '23:00', wake: '07:00', days: '8', maxShift: '1.5', direction: 'auto' });
assert.equal(twelve.direction, 'advance');
assert.equal(twelve.magnitude, 720);
assert.equal(twelve.arrivalBedtime, 660);

// --- Quarter-hour offsets and overnight sleep windows survive the round trip. ---
const nepal = J.compute({ originOffset: '-3.5', destOffset: '5.75', bedtime: '23:00', wake: '07:00', days: '4', maxShift: '4', direction: 'auto' });
assert.equal(nepal.clockChange, 555);
assert.equal(nepal.dailyShift, 138.75);
assert.equal(nepal.arrivalBedtime, 495);
const overnight = J.compute({ originOffset: '0', destOffset: '5', bedtime: '01:30', wake: '09:00', days: '5', maxShift: '1.5', direction: 'auto' });
assert.equal(overnight.sleepMinutes, 450);
assert.equal(overnight.arrivalBedtime, 390);
assert.equal(overnight.arrivalWake, 840);

// --- A same-offset trip needs no adjustment. ---
const same = J.compute({ originOffset: '2', destOffset: '2', bedtime: '23:00', wake: '07:00', days: '3', maxShift: '1.5', direction: 'auto' });
assert.equal(same.magnitude, 0);
assert.equal(same.daysToAdjust, 0);
assert.equal(same.schedule.length, 1);

// --- Every catalog case must agree with the core. ---
let goldenCount = 0;
let boundaryCount = 0;
let validationCount = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    validationCount += 1;
    const message = failure(() => J.compute(testCase.input));
    assert.equal(message, testCase.expectedError, `${testCase.name}: validation message`);
    continue;
  }
  if (testCase.kind === 'golden') goldenCount += 1;
  else if (testCase.kind === 'boundary') boundaryCount += 1;
  else assert.fail(`unexpected test kind ${testCase.kind}`);
  const result = J.compute(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (key === 'direction') assert.equal(result.direction, expected, `${testCase.name}: direction`);
    else if (key === 'feasible') assert.equal(result.feasible, expected, `${testCase.name}: feasible`);
    else if (key === 'scheduleRows') assert.equal(result.schedule.length, expected, `${testCase.name}: scheduleRows`);
    else close(result[key], expected, 1e-12, `${testCase.name}: ${key}`);
  }
}
assert.ok(goldenCount >= 5, 'expected golden cases');
assert.ok(boundaryCount >= 3, 'expected boundary cases');
assert.ok(validationCount >= 10, 'expected validation cases');

// --- Every quarter-hour offset pair yields a finite plan and a falling schedule. ---
let plans = 0;
for (let origin = -12; origin <= 14; origin += 0.25) {
  for (const dest of [-12, -5, 0, 5.75, 9, 14]) {
    const result = J.compute({ originOffset: String(origin), destOffset: String(dest), bedtime: '23:00', wake: '07:00', days: '6', maxShift: '2', direction: 'auto' });
    if (result.magnitude === 0) assert.equal(result.dailyShift, 0, `zero daily shift at ${origin}->${dest}`);
    else assert.ok(Number.isFinite(result.dailyShift) && result.dailyShift > 0, `daily shift at ${origin}->${dest}`);
    assert.ok(result.daysToAdjust >= 0 && result.daysToAdjust <= 48, `days to adjust at ${origin}->${dest}`);
    assert.ok(result.arrivalBedtime >= 0 && result.arrivalBedtime < 1440, `arrival bedtime at ${origin}->${dest}`);
    assert.equal(result.schedule[0].bedtime, result.arrivalBedtime, `arrival row at ${origin}->${dest}`);
    if (result.daysToAdjust <= 15) {
      assert.equal(result.schedule[result.schedule.length - 1].bedtime, 1380, `home bedtime at ${origin}->${dest}`);
    }
    plans += 1;
  }
}

// --- Page contract. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('class="table-wrap"'), 'table overflow wrapper');
for (const id of ['origin-offset-input', 'dest-offset-input', 'bedtime-input', 'wake-input',
  'days-input', 'max-shift-input', 'direction-select', 'calculate', 'jetlag-status']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or status ${id}`);
}
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(!/https?:\/\//.test(html.replace(/<meta name="description"[^>]*>/, '')), 'no external requests in the page');

console.log(`jet-lag-adjustment-planner: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed; ${plans} offset-pair plans checked`);
