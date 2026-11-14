/* Regression checks for the rep-tempo core, its catalog cases and the page's
   offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'rep-tempo-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* tempo-core:start */');
const end = html.indexOf('/* tempo-core:end */');
assert.ok(start > -1 && end > start, 'tempo core markers missing');
const core = html.slice(start, end + '/* tempo-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RepTempoCore;', sandbox);
const C = sandbox.module.exports;

const DEFAULTS = { tempo: '3-1-2-0', reps: '8', sets: '3', rest: '90' };
const run = (overrides) => C.compute(Object.assign({}, DEFAULTS, overrides || {}));
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ': ' + actual + ' differs from ' + expected + ' by more than ' + tolerance);
};

assert.equal(C.LIMITS.phaseMax, 30);
assert.equal(C.LIMITS.repsMax, 100);
assert.equal(C.LIMITS.setsMax, 50);
assert.equal(C.LIMITS.restMax, 1800);
assert.equal(C.DEFAULTS.tempo, '3-1-2-0');
assert.equal(C.DEFAULTS.reps, '8');
assert.equal(C.DEFAULTS.sets, '3');
assert.equal(C.DEFAULTS.rest, '90');

// The headline case: 3-1-2-0 is six seconds a rep, so eight reps hold 48 s of
// tension and three sets hold 144 s, with two 90 s rests making 324 s on the clock.
const base = run();
assert.equal(base.phases.join('-'), '3-1-2-0');
close(base.perRepSeconds, 6, 1e-9, 'default seconds per rep');
close(base.setSeconds, 48, 1e-9, 'default set tension');
close(base.totalTutSeconds, 144, 1e-9, 'default block tension');
close(base.restTotalSeconds, 180, 1e-9, 'default rest total');
close(base.blockSeconds, 324, 1e-9, 'default clock time');
close(base.dutyPct, 144 / 324 * 100, 1e-9, 'default duty share');
close(base.workRestRatio, 48 / 90, 1e-9, 'default work to rest');
assert.equal(base.totalReps, 24);

// A single set has no rest, so the clock time is the tension time.
const single = run({ reps: '10', sets: '1', rest: '0' });
close(single.totalTutSeconds, 60, 1e-9, 'single set tension');
close(single.restTotalSeconds, 0, 1e-9, 'single set rest');
close(single.blockSeconds, 60, 1e-9, 'single set clock');
assert.equal(single.workRestRatio, null);

// Zero rest with several sets collapses the clock time onto the tension time.
const backToBack = run({ rest: '0' });
close(backToBack.blockSeconds, backToBack.totalTutSeconds, 1e-9, 'no rest clock');
close(backToBack.dutyPct, 100, 1e-9, 'no rest duty');
assert.equal(backToBack.workRestRatio, null);

// Pauses on both ends are part of the rep.
const paused = run({ tempo: '0-2-1-2', reps: '12', sets: '3', rest: '45' });
assert.equal(paused.phases.join('-'), '0-2-1-2');
close(paused.perRepSeconds, 5, 1e-9, 'paused rep');
close(paused.setSeconds, 60, 1e-9, 'paused set');

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(catalog.tools.length, 2264, 'catalog total');
assert.equal(record.name, 'Rep Tempo Calculator');
assert.equal(record.category, 'Health');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.added, '2026-11-12T15:52:00Z');
assert.ok(record.testCases.length >= 31, 'catalog has the full test case set');
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
  for (const key of ['perRepSeconds', 'setSeconds', 'totalTutSeconds', 'restTotalSeconds',
    'blockSeconds', 'totalReps', 'dutyPct']) {
    close(result[key], expected[key], 5e-4, testCase.name + ' ' + key);
  }
  assert.equal(result.workRestRatio === null, expected.workRestRatio === null,
    testCase.name + ' work to rest presence');
  if (expected.workRestRatio !== null) {
    close(result.workRestRatio, expected.workRestRatio, 5e-4, testCase.name + ' work to rest');
  }
  // Structural invariants: the rep sum, the rest count between sets and the
  // clock composition must hold for every case.
  const phases = testCase.input.tempo.split('-').map(Number);
  const reps = Number(testCase.input.reps);
  const sets = Number(testCase.input.sets);
  const rest = Number(testCase.input.rest);
  close(result.perRepSeconds, phases.reduce((a, b) => a + b, 0), 1e-9, testCase.name + ' phase sum');
  close(result.setSeconds, result.perRepSeconds * reps, 1e-9, testCase.name + ' set identity');
  close(result.totalTutSeconds, result.setSeconds * sets, 1e-9, testCase.name + ' block identity');
  close(result.restTotalSeconds, rest * (sets - 1), 1e-9, testCase.name + ' rest identity');
  close(result.blockSeconds, result.totalTutSeconds + result.restTotalSeconds, 1e-9,
    testCase.name + ' clock composition');
  close(result.dutyPct, result.totalTutSeconds / result.blockSeconds * 100, 1e-6,
    testCase.name + ' duty identity');
  close(result.totalReps, reps * sets, 1e-9, testCase.name + ' rep total');
  assert.ok(result.totalTutSeconds > 0, testCase.name + ' positive tension');
}
assert.equal(golden, 14, 'golden case count');

// Refusals carry the page's user-facing wording.
const refuse = (overrides, message) => {
  try {
    run(overrides);
    assert.fail('expected a refusal for ' + JSON.stringify(overrides));
  } catch (error) {
    assert.equal(error.message, message);
  }
};
refuse({ tempo: '' }, 'Tempo is required.');
refuse({ tempo: '   ' }, 'Tempo is required.');
refuse({ tempo: '3-1-2' }, 'Tempo must be four whole seconds separated by hyphens, like 3-1-2-0.');
refuse({ tempo: '3.1-2-0' }, 'Tempo must be four whole seconds separated by hyphens, like 3-1-2-0.');
refuse({ tempo: '31-1-2-0' }, 'Each tempo phase must be from 0 to 30 seconds.');
refuse({ tempo: '3-1-0-0' }, 'The lifting phase must be at least 1 second.');
refuse({ reps: '' }, 'Reps per set is required.');
refuse({ reps: '0' }, 'Reps per set must be a whole number from 1 to 100.');
refuse({ reps: '101' }, 'Reps per set must be a whole number from 1 to 100.');
refuse({ reps: '8.5' }, 'Reps per set must be a whole number from 1 to 100.');
refuse({ sets: '' }, 'Sets is required.');
refuse({ sets: '0' }, 'Sets must be a whole number from 1 to 50.');
refuse({ sets: '51' }, 'Sets must be a whole number from 1 to 50.');
refuse({ rest: '' }, 'Rest between sets is required.');
refuse({ rest: '-30' }, 'Rest between sets must be a whole number from 0 to 1800.');
refuse({ rest: '1801' }, 'Rest between sets must be a whole number from 0 to 1800.');
refuse({ rest: '1.5' }, 'Rest between sets must be a whole number from 0 to 1800.');

// Page contract: shared chrome, one form, defaults pinned, no storage, no network, no HTML sinks.
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style\.css">/);
assert.equal((html.match(/id="tempo-form"/g) || []).length, 1);
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('role="alert"'));
for (const id of ['in-tempo', 'in-reps', 'in-sets', 'in-rest']) {
  assert.ok(html.includes('id="' + id + '"'), 'control present: ' + id);
}
assert.match(html, /id="in-tempo"[^>]*value="3-1-2-0"/);
assert.match(html, /id="in-reps"[^>]*value="8"/);
assert.match(html, /id="in-sets"[^>]*value="3"/);
assert.match(html, /id="in-rest"[^>]*value="90"/);
assert.match(html, /\.actions button\{[^}]*min-height:44px/);
assert.match(html, /\.field input\{[^}]*min-height:44px/);
assert.match(html, /<button type="submit">/);
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), 'page stores nothing');
assert.ok(!/https?:\/\//.test(html), 'page references no external URL');
assert.ok(!/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/.test(html), 'page makes no requests');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page uses no HTML sinks');

console.log(slug + ' core: all checks passed (' + record.testCases.length + ' catalog cases, '
  + golden + ' golden, phase/set/clock invariants)');
