/* Regression checks for the course-to-steer core, its catalog cases and the page's
   offline, no-storage contract. The figure is checked two independent ways: a
   quadratic on the ground-track unit vector (a different expression from the page's
   cross/along frame) and a brute-force sweep over headings at 0.02 degrees. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'course-to-steer-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* course-to-steer-core:start */');
const end = html.indexOf('/* course-to-steer-core:end */');
assert.ok(start > -1 && end > start, 'course-to-steer core markers missing');
const core = html.slice(start, end + '/* course-to-steer-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CourseToSteerCore;', sandbox);
const C = sandbox.module.exports;

const rad = (value) => (value * Math.PI) / 180;
const deg = (value) => (value * 180) / Math.PI;
const wrap360 = (value) => ((value % 360) + 360) % 360;
const wrap180 = (value) => wrap360(value + 180) - 180;
const closeTo = (actual, expected, label, epsilon) => assert.ok(
  Math.abs(actual - expected) < (epsilon === undefined ? 1e-9 : epsilon),
  label + ': ' + actual + ' vs ' + expected);

const DEFAULTS = { track: '45', speed: '6', set: '135', drift: '1.5' };
const run = (overrides) => C.calculate(Object.assign({}, DEFAULTS, overrides));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return null;
};

// Oracle one: close the vector triangle on the ground track with a quadratic in the
// speed made good, using unit vectors in the north/east frame rather than the page's
// cross/along decomposition.
function oracleQuadratic(track, speed, set, drift) {
  const u = { x: Math.sin(rad(track)), y: Math.cos(rad(track)) };
  const c = { x: drift * Math.sin(rad(set)), y: drift * Math.cos(rad(set)) };
  const dot = u.x * c.x + u.y * c.y;
  const disc = dot * dot - (drift * drift - speed * speed);
  if (disc < 0) return null;
  const s = dot + Math.sqrt(disc);
  if (!(s > 0)) return null;
  const water = { x: s * u.x - c.x, y: s * u.y - c.y };
  closeTo(Math.hypot(water.x, water.y), speed, 'water vector length', 1e-9);
  return { sog: s, heading: wrap360(deg(Math.atan2(water.x, water.y))) };
}

// Oracle two: no algebra at all. Sweep headings and keep the one whose ground track
// lands on the requested track, checking the speed over the ground as a by-product.
function oracleSweep(track, speed, set, drift) {
  let best = null;
  for (let step = 0; step <= 18000; step += 1) {
    const psi = step * 0.02;
    const x = speed * Math.sin(rad(psi)) + drift * Math.sin(rad(set));
    const y = speed * Math.cos(rad(psi)) + drift * Math.cos(rad(set));
    const cog = wrap360(deg(Math.atan2(x, y)));
    const err = Math.abs(wrap180(cog - track));
    if (!best || err < best.err) best = { err, heading: psi, sog: Math.hypot(x, y) };
  }
  return best;
}

// Documented surface.
assert.deepEqual({
  track: Array.from(C.LIMITS.track), speed: Array.from(C.LIMITS.speed),
  set: Array.from(C.LIMITS.set), drift: Array.from(C.LIMITS.drift),
}, { track: [0, 360], speed: [0.1, 60], set: [0, 360], drift: [0, 10] });
assert.deepEqual({ ...C.DEFAULTS }, { track: 45, speed: 6, set: 135, drift: 1.5 });
assert.equal(C.OFFSET_LIMIT, 30);
assert.equal(C.SLOW_SHARE, 0.5);
assert.equal(C.CROSS_SHARE, 0.8);
assert.match(C.MESSAGES.cross, /no heading can hold it/);
assert.match(C.MESSAGES.against, /no ground can be made/);

// The default set-up, step by step: a 1.5 kn beam current on a 6 kn boat making 045.
const base = run();
assert.equal(base.track, 45);
assert.equal(base.set, 135);
assert.equal(base.drift, 1.5);
assert.equal(base.crossTrack, 1.5);
assert.equal(base.alongTrack, 0);
assert.equal(base.offset, -14.5);
assert.equal(base.side, 'port');
assert.equal(base.heading, 30.5);
assert.equal(base.sog, 5.81);
assert.equal(base.warnings.length, 0);
// Steering into the current must hold the track once the two vectors are added back.
closeTo(wrap360(deg(Math.atan2(
  6 * Math.sin(rad(base.heading)) + 1.5 * Math.sin(rad(135)),
  6 * Math.cos(rad(base.heading)) + 1.5 * Math.cos(rad(135)),
))), 45, 'default track closes', 0.05);

// Slack water leaves the track alone, and the current behaves when it runs along it.
const slack = run({ drift: '0' });
assert.equal(slack.heading, 45);
assert.equal(slack.offset, 0);
assert.equal(slack.side, 'none');
assert.equal(slack.sog, 6);
assert.equal(run({ set: '45', drift: '2' }).sog, 8);
assert.equal(run({ set: '225', drift: '2' }).sog, 4);
assert.equal(run({ set: '225', drift: '2' }).heading, 45);

// Sweep the whole envelope against the quadratic oracle, then a subset against the
// brute-force sweep as well.
let compared = 0;
let swept = 0;
const random = (() => {
  let state = 20261115;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
})();
for (let index = 0; index < 400; index += 1) {
  const track = random() * 360;
  const speed = 0.1 + random() * 59.9;
  const set = random() * 360;
  const drift = random() * 10;
  const input = { track: track.toFixed(2), speed: speed.toFixed(2), set: set.toFixed(2), drift: drift.toFixed(2) };
  const numbers = { track: Number(input.track), speed: Number(input.speed), set: Number(input.set), drift: Number(input.drift) };
  const expected = oracleQuadratic(numbers.track, numbers.speed, numbers.set, numbers.drift);
  let result;
  try {
    result = C.calculate(input);
  } catch (error) {
    assert.ok(expected === null, 'unexpected refusal for ' + JSON.stringify(input) + ': ' + error.message);
    assert.ok([C.MESSAGES.cross, C.MESSAGES.against].includes(error.message), 'refusal wording: ' + error.message);
    continue;
  }
  assert.ok(expected, 'case should have been refused: ' + JSON.stringify(input));
  closeTo(wrap180(result.heading - expected.heading), 0, 'oracle heading', 0.06);
  closeTo(result.sog, expected.sog, 'oracle speed over ground', 0.006);
  // The offset and the heading side must agree, and the speed made good must be
  // consistent with the cross/along split that was reported.
  if (result.side === 'none') {
    assert.equal(result.offset, 0, 'zero offset');
  } else {
    assert.equal(result.side, result.offset > 0 ? 'starboard' : 'port', 'side matches sign');
  }
  closeTo(result.crossTrack, numbers.drift * Math.sin(rad(numbers.set - numbers.track)), 'cross-track current', 0.006);
  closeTo(result.alongTrack, numbers.drift * Math.cos(rad(wrap180(numbers.track - numbers.set))), 'along-track current', 0.006);
  assert.ok(result.sog > 0, 'positive speed made good');
  if (index % 10 === 0) {
    const sweep = oracleSweep(numbers.track, numbers.speed, numbers.set, numbers.drift);
    assert.ok(sweep.err < 0.02, 'sweep reaches the track: ' + sweep.err);
    closeTo(wrap180(sweep.heading - result.heading), 0, 'sweep heading', 0.08);
    closeTo(sweep.sog, result.sog, 'sweep speed', 0.02);
    swept += 1;
  }
  compared += 1;
}
assert.ok(compared > 300, 'sweep compared ' + compared + ' solutions');
assert.ok(swept >= 30, 'brute-force headings: ' + swept);

// Refusals, in page order, with the exact wording.
assert.equal(failure({ track: '' }), 'Enter the course you want to make good.');
assert.equal(failure({ track: '361' }), 'The track must be a bearing from 0 to 360 degrees true.');
assert.equal(failure({ track: '-5' }), 'The track must be a bearing from 0 to 360 degrees true.');
assert.equal(failure({ track: 'north' }), 'The track must be a bearing from 0 to 360 degrees true.');
assert.equal(failure({ speed: '' }), 'Enter the boat speed through the water.');
assert.equal(failure({ speed: '0' }), 'The boat speed must be a number from 0.1 to 60 knots.');
assert.equal(failure({ speed: '61' }), 'The boat speed must be a number from 0.1 to 60 knots.');
assert.equal(failure({ set: '' }), 'Enter the direction the current sets towards.');
assert.equal(failure({ set: '400' }), 'The current set must be a bearing from 0 to 360 degrees true.');
assert.equal(failure({ drift: '' }), 'Enter the current drift rate.');
assert.equal(failure({ drift: '11' }), 'The current drift must be a number from 0 to 10 knots.');
assert.equal(failure({ drift: 'calm' }), 'The current drift must be a number from 0 to 10 knots.');
assert.match(failure({ speed: '6', set: '135', drift: '8' }), /^The current sets too far across this track/);
assert.match(failure({ track: '45', speed: '4', set: '225', drift: '6' }), /^The current runs against this track/);
// Exactly at the limits is accepted: 360 reads as north, drift 10 on a 60 kn boat.
assert.equal(run({ track: '360' }).track, 0);
assert.equal(run({ speed: '60', drift: '10', set: '45' }).sog, 70);
assert.equal(run({ speed: '0.1', drift: '0' }).heading, 45);
// Decimal commas are accepted in every field.
assert.equal(run({ track: '123,5', speed: '4,8', set: '280,25', drift: '0,9' }).heading, 119.3);

// Warnings, threshold by threshold.
const hardOn = run({ speed: '6', set: '135', drift: '3' });
assert.equal(hardOn.offset, -30);
assert.ok(hardOn.warnings.includes(C.MESSAGES.offset), 'thirty degree offset warning');
const nearlyBeam = run({ speed: '6', set: '135', drift: '4.9' });
assert.ok(nearlyBeam.warnings.includes(C.MESSAGES.margin), 'cross-track margin warning');
const slow = run({ speed: '5', set: '225', drift: '4.5' });
assert.ok(slow.warnings.includes(C.MESSAGES.slow), 'slow track warning');
assert.equal(slow.warnings.length, 1);
assert.equal(run({ set: '225', drift: '2' }).warnings.length, 0);

// Catalog cases replay.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2310, 'catalog total');
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(entry.category, 'Geography');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.listed, true);
assert.equal(entry.sources.length, 2);
for (const source of entry.sources) assert.match(source.url, /^https:\/\//);
assert.match(entry.guidance, /leeway/, 'guidance names what the model leaves out');
assert.ok(entry.testCases.length >= 20, 'at least twenty catalog cases');
let goldenCases = 0;
let validationCases = 0;
for (const testCase of entry.testCases) {
  const input = Object.assign({}, DEFAULTS, testCase.input);
  if (testCase.kind === 'golden') {
    const result = C.calculate(input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      if (Array.isArray(value)) {
        assert.deepEqual(Array.from(result[key]), value, testCase.name + ' ' + key);
      } else {
        closeTo(result[key], value, testCase.name + ' ' + key);
      }
    }
    goldenCases += 1;
  } else {
    assert.equal(failure(testCase.input), testCase.expected.error, testCase.name);
    validationCases += 1;
  }
}
assert.ok(goldenCases >= 10, 'golden cases: ' + goldenCases);
assert.ok(validationCases >= 8, 'validation cases: ' + validationCases);

// Slug and name stay unique across the whole catalog.
for (const field of ['slug', 'name']) {
  const values = catalog.tools.map((tool) => String(tool[field]).toLowerCase());
  assert.equal(new Set(values).size, values.length, 'duplicate ' + field);
}
assert.ok(!catalog.tools.some((tool) => tool.slug === 'set-and-drift-calculator'),
  'no competing set and drift record');

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/https?:\/\/[a-z]/i.test(html.replace(/http:\/\/www\.w3\.org/g, '')),
  'page must not reference an external URL');
assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(html), 'page source must stay ASCII');
assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'page needs exactly one h1');
assert.ok(html.includes('<form id="cts-form"'), 'page form missing');
assert.ok(html.includes('type="submit"'), 'page needs an explicit submit button');
assert.ok(html.includes('type="button"'), 'reset needs an explicit type');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('min-height:44px'), 'controls must keep a 44 px target');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
for (const id of ['in-track', 'in-speed', 'in-set', 'in-drift', 'err', 'out', 'warn', 'reset']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
}
for (const value of ['value="45"', 'value="6"', 'value="135"', 'value="1.5"']) {
  assert.ok(html.includes(value), 'default ' + value + ' missing from the markup');
}
for (const match of html.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'getElementById(' + match[1] + ') has no element');
}
for (const match of html.matchAll(/<label class="f" for="([^"]+)"/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'label for ' + match[1] + ' has no control');
}

console.log('course to steer: ' + entry.testCases.length + ' catalog cases, '
  + compared + ' oracle solutions, ' + swept + ' heading sweeps and '
  + goldenCases + ' golden / ' + validationCases + ' validation replays passed');
