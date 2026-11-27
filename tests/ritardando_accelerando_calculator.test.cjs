/* Regression checks for the ritardando/accelerando core, its catalog cases,
   an independent numeric model of both tempo curves, and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ritardando-accelerando-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* ritardando-accelerando-core:start */';
const endMarker = '/* ritardando-accelerando-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RampTimingCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.solve(input));
const failure = (input) => {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// ---- Library surface.
assert.deepEqual(Array.from(C.CURVES), ['time', 'beat']);
assert.deepEqual(plain(C.LIMITS.start), [10, 400, 'Start tempo']);
assert.deepEqual(plain(C.LIMITS.end), [10, 400, 'End tempo']);
assert.deepEqual(plain(C.LIMITS.beats), [0.25, 256, 'Beats']);

// ---- An independent model: tempo is integrated numerically, never from the
// page's closed forms. Simpson over a smooth integrand is accurate far past
// the three decimals the page publishes.
function simpson(f, a, b, steps) {
  let n = steps || 400;
  if (n % 2) n += 1;
  const h = (b - a) / n;
  let total = f(a) + f(b);
  for (let i = 1; i < n; i += 1) total += (i % 2 ? 4 : 2) * f(a + i * h);
  return total * h / 3;
}
function beatsBy(secondsSinceStart, total, startTempo, endTempo) {
  if (Math.abs(endTempo - startTempo) < 1e-12) return startTempo * secondsSinceStart / 60;
  return simpson((t) => (startTempo + (endTempo - startTempo) * t / total) / 60, 0, secondsSinceStart);
}
function oracleTotal(startTempo, endTempo, beats, curve) {
  if (Math.abs(endTempo - startTempo) < 1e-12) return beats * 60 / startTempo;
  if (curve === 'beat') return simpson((n) => 60 / (startTempo + (endTempo - startTempo) * n / beats), 0, beats);
  const totalAt = (seconds) => beatsBy(seconds, seconds, startTempo, endTempo);
  let low = 1e-6;
  let high = 1;
  while (totalAt(high) < beats) high *= 2;
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    if (totalAt(mid) < beats) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
function oraclePoint(startTempo, endTempo, beats, curve, fraction) {
  if (fraction <= 0) return { bpm: startTempo, seconds: 0 };
  const total = oracleTotal(startTempo, endTempo, beats, curve);
  if (Math.abs(endTempo - startTempo) < 1e-12) {
    return { bpm: startTempo, seconds: fraction * beats * 60 / startTempo };
  }
  if (curve === 'beat') {
    const seconds = simpson((n) => 60 / (startTempo + (endTempo - startTempo) * n / beats), 0, fraction * beats);
    return { bpm: startTempo + (endTempo - startTempo) * fraction, seconds };
  }
  let low = 0;
  let high = total;
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    if (beatsBy(mid, total, startTempo, endTempo) < fraction * beats) low = mid;
    else high = mid;
  }
  const seconds = (low + high) / 2;
  return { bpm: startTempo + (endTempo - startTempo) * seconds / total, seconds };
}

const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ': ' + actual + ' vs ' + expected);
};

// ---- The canonical ramp, checked by hand.
const canonical = run({ start: 120, end: 60, beats: 8, curve: 'time' });
assert.equal(canonical.seconds, 5.333);
assert.equal(canonical.averageBpm, 90);
assert.equal(canonical.firstBeatMs, 500);
assert.equal(canonical.lastBeatMs, 1000);
assert.equal(canonical.changePercent, -50);
assert.equal(canonical.direction, 'ritardando');
assert.equal(canonical.curve, 'time');
assert.equal(canonical.otherCurve, 'beat');
assert.equal(canonical.otherSeconds, 5.545);
assert.equal(canonical.deltaSeconds, -0.212);
assert.equal(canonical.timeline.length, 5);
assert.deepEqual(canonical.timeline[0], { beat: 0, bpm: 120, seconds: 0 });
assert.deepEqual(canonical.timeline[4], { beat: 8, bpm: 60, seconds: 5.333 });
assert.equal(canonical.timeline[2].bpm, 94.868);

const beatsCurve = run({ start: 120, end: 60, beats: 8, curve: 'beat' });
assert.equal(beatsCurve.seconds, 5.545);
assert.equal(beatsCurve.averageBpm, 86.562);
assert.equal(beatsCurve.deltaSeconds, 0.212);
assert.equal(beatsCurve.timeline[1].bpm, 105);
assert.equal(beatsCurve.timeline[1].beat, 2);

// ---- 140 randomised ramps against the numeric model.
let seed = 20261118;
const next = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let index = 0; index < 140; index += 1) {
  const a = Math.round((10 + next() * 390) * 10) / 10;
  const b = Math.round((10 + next() * 390) * 10) / 10;
  const beats = Math.round((0.25 + next() * 255.75) * 100) / 100;
  const curve = index % 2 ? 'beat' : 'time';
  const got = run({ start: a, end: b, beats, curve });
  const total = oracleTotal(a, b, beats, curve);
  const other = oracleTotal(a, b, beats, curve === 'time' ? 'beat' : 'time');
  close(got.seconds, total, 1.5e-3, 'seconds at ' + index);
  close(got.averageBpm, 60 * beats / total, 3e-3, 'average at ' + index);
  close(got.otherSeconds, other, 1.5e-3, 'other seconds at ' + index);
  close(got.deltaSeconds, total - other, 2e-3, 'delta at ' + index);
  assert.equal(got.direction, b < a ? 'ritardando' : b > a ? 'accelerando' : 'steady');
  close(got.firstBeatMs, 60000 / a, 1e-3, 'first beat at ' + index);
  close(got.lastBeatMs, 60000 / b, 1e-3, 'last beat at ' + index);
  close(got.changePercent, (b / a - 1) * 100, 1e-3, 'change at ' + index);
  for (let step = 0; step < 5; step += 1) {
    const fraction = step / 4;
    const point = oraclePoint(a, b, beats, curve, fraction);
    const row = got.timeline[step];
    close(row.bpm, point.bpm, 2e-3, 'row bpm ' + index + '/' + step);
    close(row.seconds, point.seconds, 2e-3, 'row seconds ' + index + '/' + step);
    close(row.beat, fraction * beats, 5.5e-4, 'row beat ' + index + '/' + step);
  }
  // The ramp on the beat axis can never be faster than the ramp on the clock.
  assert.ok(got.deltaSeconds >= -1e-9 || got.curve === 'time', 'delta sign at ' + index);
  // The average sits between the two tempos, and time only moves forward.
  assert.ok(got.averageBpm >= Math.min(a, b) - 1e-9 && got.averageBpm <= Math.max(a, b) + 1e-9,
    'average inside the tempos at ' + index);
  for (let step = 1; step < 5; step += 1) {
    assert.ok(got.timeline[step].seconds >= got.timeline[step - 1].seconds,
      'elapsed grows at ' + index + '/' + step);
  }
}

// ---- Equal tempos are a constant tempo on either curve.
for (const curve of ['time', 'beat']) {
  const steady = run({ start: 96, end: 96, beats: 5, curve });
  assert.equal(steady.direction, 'steady');
  assert.equal(steady.seconds, 3.125);
  assert.equal(steady.averageBpm, 96);
  assert.equal(steady.otherSeconds, 3.125);
  assert.equal(steady.deltaSeconds, 0);
  assert.equal(steady.changePercent, 0);
  assert.deepEqual(steady.timeline.map((row) => row.bpm), [96, 96, 96, 96, 96]);
}

// ---- Numeric strings are accepted, as the form sends them; numbers too.
assert.equal(run({ start: '88.5', end: '177', beats: '2.5', curve: 'beat' }).direction, 'accelerando');
assert.equal(run({ start: 120, end: 60, beats: 8, curve: 'time' }).seconds, 5.333);
assert.equal(run({ start: ' 120 ', end: ' 60 ', beats: ' 8 ', curve: ' time ' }).seconds, 5.333);
assert.equal(failure({ start: '120', end: '60', beats: '8' }), null, 'the curve defaults to linear in time');
assert.equal(run({ start: '120', end: '60', beats: '8' }).curve, 'time');

// ---- Refusals name the field and never guess.
assert.equal(failure({}), 'Start tempo is required.');
assert.equal(failure(null), 'Start tempo is required.');
assert.equal(failure({ start: '   ', end: '60', beats: '8', curve: 'time' }), 'Start tempo is required.');
assert.equal(failure({ start: '9.9', end: '60', beats: '8', curve: 'time' }),
  'Start tempo must be from 10 to 400.');
assert.equal(failure({ start: '401', end: '60', beats: '8', curve: 'time' }),
  'Start tempo must be from 10 to 400.');
assert.equal(failure({ start: '120', end: '0', beats: '8', curve: 'time' }),
  'End tempo must be from 10 to 400.');
assert.equal(failure({ start: '120', end: '60', beats: '0', curve: 'time' }),
  'Beats must be from 0.25 to 256.');
assert.equal(failure({ start: '120', end: '60', beats: '256.5', curve: 'time' }),
  'Beats must be from 0.25 to 256.');
assert.equal(failure({ start: '120', end: '60', beats: 'eight', curve: 'time' }),
  'Beats must be a number.');
assert.equal(failure({ start: '120', end: '60', beats: '8.', curve: 'time' }),
  'Beats must be a number.');
assert.equal(failure({ start: '120', end: '60', beats: '8', curve: 'linear' }),
  'Choose a curve: linear in time or linear in beats.');
assert.equal(failure({ start: '1,200', end: '60', beats: '8', curve: 'time' }),
  'Start tempo must use a dot for decimals; a comma is read as a thousands separator.');
assert.equal(failure({ start: '1e2', end: '60', beats: '8', curve: 'time' }),
  'Start tempo must be a number.');
assert.equal(failure({ start: NaN, end: '60', beats: '8', curve: 'time' }),
  'Start tempo must be a number.');

// ---- Catalog record and every stored case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Ritardando & Accelerando Calculator');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('rounded'), 'method documents rounding');
assert.ok(Array.isArray(record.sources), 'sources is an array');
assert.equal(record.testCases.length, 23, 'catalog case count');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(kinds('golden'), 7, 'seven golden cases');
assert.equal(kinds('boundary'), 6, 'six boundary cases');
assert.equal(kinds('edge'), 2, 'two edge cases');
assert.equal(kinds('validation'), 8, 'eight validation cases');
const occurrences = catalog.tools.filter((tool) => tool.slug === slug).length;
assert.equal(occurrences, 1, 'slug is unique');
assert.equal(catalog.tools.length, 2510, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2249, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Music').length, 57, 'Music count');
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.ok(!(other.aliases || []).some((alias) => alias.toLowerCase() === record.name.toLowerCase()),
    'name collides with an alias of ' + other.slug);
}
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], value, testCase.name + ' ' + key);
  }
}

// ---- The page contract: local, labelled, keyboard reachable, mobile safe.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="ramp-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<h1>Ritardando &amp; Accelerando Calculator<\/h1>/.test(html), 'page heading');
assert.ok(/name="viewport"/.test(html), 'viewport');
assert.ok(/<meta name="description" content="[^"]{80,}"/.test(html), 'meta description');
assert.ok(/<option value="time" selected>/.test(html), 'the default curve is marked selected');
for (const id of ['in-start', 'in-end', 'in-beats', 'in-curve']) {
  assert.ok(new RegExp('id="' + id + '"').test(html), 'input #' + id);
  assert.ok(new RegExp('<label[^>]*\\bfor="' + id + '"').test(html), 'label for ' + id);
}
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'ids are unique');
const markupIds = new Set(ids);
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 7, 'the page looks up its controls');
for (const id of requestedIds) {
  assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
}
for (const id of ['err', 'out', 'curve-hint', 'method']) {
  assert.ok(markupIds.has(id), 'page has #' + id);
}
assert.ok(/value="120"/.test(html) && /value="60"/.test(html) && /value="8"/.test(html),
  'the page opens on the documented defaults');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/min-height:44px/.test(html), 'touch targets');
assert.ok(/@media \(max-width:560px\)/.test(html), 'mobile layout');

console.log('ritardando/accelerando: all checks passed');
