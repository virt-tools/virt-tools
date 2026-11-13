/* Regression checks for the strength volume load core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'strength-volume-load-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* volume-core:start */');
const end = html.indexOf('/* volume-core:end */');
assert.ok(start > -1 && end > start, 'volume core markers missing');
const core = html.slice(start, end + '/* volume-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = StrengthVolumeCore;', sandbox);
const C = sandbox.module.exports;

const DEFAULTS = { load: '100', reps: '5', sets: '5', sessions: '3', bodyweight: '80', unit: 'kg' };
const run = (overrides) => C.compute(Object.assign({}, DEFAULTS, overrides || {}));
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ': ' + actual + ' differs from ' + expected + ' by more than ' + tolerance);
};

assert.equal(C.UNITS.join(','), 'kg,lb');
assert.equal(C.LIMITS.loadMin, 0.5);
assert.equal(C.LIMITS.loadMax, 1000);
assert.equal(C.LIMITS.repsMax, 100);
assert.equal(C.LIMITS.setsMax, 20);
assert.equal(C.LIMITS.sessionsMax, 14);
assert.equal(C.LIMITS.bodyweightMin, 20);
assert.equal(C.LIMITS.bodyweightMax, 400);
assert.equal(C.DEFAULTS.unit, 'kg');
assert.equal(C.DEFAULTS.load, '100');

// Five by five at 100 kg: 500 per set, 2,500 a session, 7,500 a week, 93.75x bodyweight at 80 kg.
const base = run();
close(base.perSetVolume, 500, 1e-9, 'default per set');
close(base.sessionVolume, 2500, 1e-9, 'default per session');
close(base.weeklyVolume, 7500, 1e-9, 'default per week');
close(base.sessionReps, 25, 1e-9, 'default reps per session');
close(base.weeklyReps, 75, 1e-9, 'default reps per week');
close(base.relativeVolume, 93.75, 1e-9, 'default relative volume');
assert.equal(base.unit, 'kg');

// A single session makes the session and weekly totals identical.
const oneSession = run({ sessions: '1' });
close(oneSession.weeklyVolume, oneSession.sessionVolume, 1e-9, 'one session weekly');
close(oneSession.weeklyReps, oneSession.sessionReps, 1e-9, 'one session reps');

// Without a bodyweight there is no relative figure; it must not silently default.
const noBw = run({ bodyweight: '' });
assert.equal(noBw.bodyweight, null);
assert.equal(noBw.relativeVolume, null);

// Units are echoed in lower case and do not change the arithmetic.
const pounds = run({ load: '225', reps: '5', sets: '5', sessions: '4', bodyweight: '180', unit: 'LB' });
assert.equal(pounds.unit, 'lb');
close(pounds.weeklyVolume, 22500, 1e-9, 'pounds weekly');

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(catalog.tools.length, 2250, 'catalog total');
assert.equal(record.name, 'Strength Volume Load Calculator');
assert.equal(record.category, 'Health');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.added, '2026-11-12T17:25:00Z');
assert.ok(record.testCases.length >= 34, 'catalog has the full test case set');
assert.ok(record.method.length > 800, 'method documents the model');
assert.ok(record.sources.length >= 4, 'sources are listed');
for (const name of record.aliases) {
  const clash = catalog.tools.filter((tool) => tool.slug !== slug)
    .some((tool) => tool.name === name || (tool.aliases || []).includes(name));
  assert.equal(clash, false, 'alias is unique: ' + name);
}
for (const tag of record.tags) {
  assert.equal(typeof tag, 'string');
  assert.ok(tag.length > 0);
}

let golden = 0;
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    try {
      C.compute(testCase.input);
      assert.fail(testCase.name + ': expected a refusal');
    } catch (error) {
      assert.equal(error.message, testCase.expected.error, testCase.name);
    }
    continue;
  }
  golden += 1;
  const result = C.compute(testCase.input);
  const expected = testCase.expected;
  for (const key of ['perSetVolume', 'sessionVolume', 'weeklyVolume', 'sessionReps', 'weeklyReps']) {
    close(result[key], expected[key], 5e-4, testCase.name + ' ' + key);
  }
  assert.equal(result.relativeVolume === null, expected.relativeVolume === null,
    testCase.name + ' relative volume presence');
  if (expected.relativeVolume !== null) {
    close(result.relativeVolume, expected.relativeVolume, 5e-4, testCase.name + ' relative volume');
  }
  // Structural invariants: load x reps, sets, sessions and the bodyweight ratio
  // must hold for every case, independently of the recorded expectations.
  const load = Number(testCase.input.load);
  const reps = Number(testCase.input.reps);
  const sets = Number(testCase.input.sets);
  const sessions = Number(testCase.input.sessions);
  close(result.perSetVolume, load * reps, 1e-9, testCase.name + ' per set identity');
  close(result.sessionVolume, result.perSetVolume * sets, 1e-9, testCase.name + ' per session identity');
  close(result.weeklyVolume, result.sessionVolume * sessions, 1e-9, testCase.name + ' weekly identity');
  close(result.sessionReps, reps * sets, 1e-9, testCase.name + ' session rep identity');
  close(result.weeklyReps, result.sessionReps * sessions, 1e-9, testCase.name + ' weekly rep identity');
  if (result.relativeVolume !== null) {
    close(result.relativeVolume, result.weeklyVolume / Number(testCase.input.bodyweight), 1e-6,
      testCase.name + ' relative identity');
  }
  assert.ok(result.weeklyVolume > 0, testCase.name + ' positive volume');
  assert.ok(result.weeklyVolume >= result.sessionVolume, testCase.name + ' weekly at least session');
}
assert.equal(golden, 15, 'golden case count');

// Refusals carry the page's user-facing wording.
const refuse = (overrides, message) => {
  try {
    run(overrides);
    assert.fail('expected a refusal for ' + JSON.stringify(overrides));
  } catch (error) {
    assert.equal(error.message, message);
  }
};
refuse({ load: '' }, 'Load is required.');
refuse({ load: '0' }, 'Load must be a number from 0.5 to 1000.');
refuse({ load: '2.5.0' }, 'Load must be a number from 0.5 to 1000.');
refuse({ unit: '' }, 'Unit is required.');
refuse({ unit: 'stone' }, 'Unit must be kg or lb.');
refuse({ reps: '' }, 'Reps per set is required.');
refuse({ reps: '101' }, 'Reps per set must be a whole number from 1 to 100.');
refuse({ sets: '' }, 'Sets per session is required.');
refuse({ sets: '0' }, 'Sets per session must be a whole number from 1 to 20.');
refuse({ sessions: '' }, 'Sessions per week is required.');
refuse({ sessions: '15' }, 'Sessions per week must be a whole number from 1 to 14.');
refuse({ bodyweight: '19' },
  'Bodyweight must be a number from 20 to 400, or left blank.');
refuse({ bodyweight: '80 kg' },
  'Bodyweight must be a number from 20 to 400, or left blank.');

// Page contract: shared chrome, one form, defaults pinned, no storage, no network, no HTML sinks.
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style\.css">/);
assert.equal((html.match(/id="volume-form"/g) || []).length, 1);
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('role="alert"'));
for (const id of ['in-unit', 'in-load', 'in-reps', 'in-sets', 'in-sessions', 'in-bodyweight']) {
  assert.ok(html.includes('id="' + id + '"'), 'control present: ' + id);
  assert.match(html, new RegExp('<label[^>]*for="' + id + '"'), 'label present: ' + id);
}
assert.match(html, /id="in-load"[^>]*value="100"/);
assert.match(html, /id="in-reps"[^>]*value="5"/);
assert.match(html, /id="in-sets"[^>]*value="5"/);
assert.match(html, /id="in-sessions"[^>]*value="3"/);
assert.match(html, /id="in-bodyweight"[^>]*value="80"/);
assert.match(html, /<option value="kg" selected>kg<\/option>/);
assert.match(html, /<option value="lb">lb<\/option>/);
assert.match(html, /\.actions button\{[^}]*min-height:44px/);
assert.match(html, /\.field input\{[^}]*min-height:44px/);
assert.match(html, /\.field select\{[^}]*min-height:44px/);
assert.match(html, /<button type="submit">/);
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), 'page stores nothing');
assert.ok(!/https?:\/\//.test(html), 'page references no external URL');
assert.ok(!/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/.test(html), 'page makes no requests');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page uses no HTML sinks');

console.log(slug + ' core: all checks passed (' + record.testCases.length + ' catalog cases, '
  + golden + ' golden, set/session/week and relative-volume invariants)');
