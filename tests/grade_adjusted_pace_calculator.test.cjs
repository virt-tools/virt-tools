/* Regression checks for the grade-adjusted pace core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'grade-adjusted-pace-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* gap-core:start */');
const end = html.indexOf('/* gap-core:end */');
assert.ok(start > -1 && end > start, 'grade-adjusted core markers missing');
const core = html.slice(start, end + '/* gap-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = GradeAdjustedPaceCore;', sandbox);
const C = sandbox.module.exports;

const DEFAULTS = { units: 'metric', direction: 'toFlat', pace: '5:00', grade: '5' };
const run = (overrides) => C.compute(Object.assign({}, DEFAULTS, overrides || {}));
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ': ' + actual + ' differs from ' + expected + ' by more than ' + tolerance);
};

assert.equal(C.FLAT_COST, 3.6, 'flat running cost');
assert.equal(C.GRADE_MIN, -25);
assert.equal(C.GRADE_MAX, 25);
assert.equal(C.BOUNDS.metric.min, 120);
assert.equal(C.BOUNDS.metric.max, 1800);
assert.equal(C.BOUNDS.imperial.max, 2880);
assert.equal(C.DEFAULTS.metric.pace, '5:00');
assert.equal(C.DEFAULTS.imperial.pace, '8:00');

// The published curve: level ground costs 3.6 J/kg/m, a climb costs more and a
// descent costs less.
close(C.cost(0), 3.6, 1e-12, 'flat cost at zero grade');
assert.ok(C.cost(0.05) > C.cost(0), 'a climb costs more than level ground');
assert.ok(C.cost(-0.05) < C.cost(0), 'a descent costs less than level ground');
assert.ok(C.cost(-0.45) > C.cost(0), 'the curve rises again at very steep descents');
assert.ok(C.cost(-0.2) < C.cost(-0.05), 'the cheapest running is well downhill');
assert.ok(C.cost(0.45) > C.cost(0.25), 'the curve keeps rising uphill');
// Evaluate one point of the published polynomial by hand: at i = 0.1 the five
// terms sum to 4.0323054375 J/kg/m.
close(C.cost(0.1),
  155.4 * 1e-5 - 30.4 * 1e-4 - 43.3 * 1e-3 + 46.3 * 1e-2 + 19.5 * 0.1 + 3.6, 1e-9,
  'curve matches the published coefficients');

// The headline case: 5:00/km on a 5% grade is worth about 3:50.5/km flat.
const base = run();
close(base.paceSeconds, 300, 1e-9, 'default pace seconds');
close(base.resultSeconds, 230.5133, 5e-4, 'default flat equivalent');
close(base.flatSeconds, 230.5133, 5e-4, 'default flat seconds');
close(base.gradeSeconds, 300, 1e-9, 'default grade seconds');
close(base.cost, 4.6852, 5e-4, 'default grade cost');
close(base.costPercent, 130.1443, 5e-4, 'default cost ratio');
close(base.speedKmh, 15.6173, 5e-4, 'default adjusted speed');
close(base.speedMph, 9.7042, 5e-4, 'default adjusted speed in miles');
close(base.gainMperKm, 50, 1e-9, 'default vertical gain');
assert.equal(base.paceLabel, '3:51');
assert.equal(base.flatLabel, '3:51');
assert.equal(base.gradeLabel, '5:00');

// Level ground is the identity in both directions.
const level = run({ grade: '0' });
close(level.flatSeconds, 300, 1e-9, 'level ground keeps the pace');
close(level.gradeSeconds, 300, 1e-9, 'level ground keeps the pace in reverse');
close(level.cost, 3.6, 1e-12, 'level ground cost');

// The two directions are exact inverses.
const uphill = run({ direction: 'toGrade', pace: '5:00', grade: '6' });
const back = run({ direction: 'toFlat', pace: uphill.gradeLabel, grade: '6' });
close(back.flatSeconds, 300, 3, 'round trip returns the flat pace');
const descent = run({ direction: 'toGrade', pace: '4:30', grade: '-4' });
assert.ok(descent.gradeSeconds < descent.paceSeconds, 'a descent needs a faster pace');

// Imperial basis converts the same model with a mile as the unit.
const mile = run({ units: 'imperial', pace: '8:00', grade: '5' });
close(mile.resultSeconds, 480 * 3.6 / 4.6851960625, 5e-4, 'mile equivalent');
close(mile.speedKmh, 1609.344 / mile.resultSeconds * 3.6, 1e-9, 'mile speed identity');
close(mile.gainFtPerMile, 264, 1e-9, 'mile vertical gain');

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(catalog.tools.length, 2274, 'catalog total');
assert.equal(record.name, 'Grade-Adjusted Pace Calculator');
assert.equal(record.category, 'Health');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.added, '2026-11-12T18:40:00Z');
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
  for (const key of ['paceSeconds', 'resultSeconds', 'flatSeconds', 'gradeSeconds', 'cost',
    'costPercent', 'speedKmh', 'speedMph', 'gainMperKm', 'gainFtPerMile']) {
    close(result[key], expected[key], 5e-4, testCase.name + ' ' + key);
  }
  // Structural invariants: the two paces and the cost ratio agree, the headline
  // is the direction's target, and the speed follows from the adjusted pace.
  const units = testCase.input.units;
  const distance = units === 'metric' ? 1000 : 1609.344;
  close(result.cost, C.cost(result.grade / 100), 1e-9, testCase.name + ' cost identity');
  close(result.costPercent, result.cost / C.FLAT_COST * 100, 1e-9, testCase.name + ' ratio identity');
  close(result.gradeSeconds * C.FLAT_COST / result.cost, result.flatSeconds, 1e-6,
    testCase.name + ' cost scaling');
  if (testCase.input.direction === 'toFlat') {
    close(result.flatSeconds, result.resultSeconds, 1e-9, testCase.name + ' flat headline');
    close(result.gradeSeconds, result.paceSeconds, 1e-9, testCase.name + ' grade input kept');
  } else {
    close(result.gradeSeconds, result.resultSeconds, 1e-9, testCase.name + ' grade headline');
    close(result.flatSeconds, result.paceSeconds, 1e-9, testCase.name + ' flat input kept');
  }
  close(distance / result.resultSeconds * 3.6, result.speedKmh, 1e-6, testCase.name + ' speed identity');
  close(result.gainMperKm, result.grade * 10, 1e-9, testCase.name + ' gain identity');
  close(result.gainFtPerMile, result.grade * 52.8, 1e-9, testCase.name + ' mile gain identity');
  assert.ok(result.resultSeconds >= C.RESULT_MIN && result.resultSeconds <= C.RESULT_MAX,
    testCase.name + ' result inside the range');
}
assert.equal(golden, 16, 'golden case count');

// Refusals carry the page's user-facing wording.
const refuse = (overrides, message) => {
  try {
    run(overrides);
    assert.fail('expected a refusal for ' + JSON.stringify(overrides));
  } catch (error) {
    assert.equal(error.message, message);
  }
};
refuse({ units: 'yards' }, 'Choose minutes per kilometre or minutes per mile.');
refuse({ direction: 'sideways' }, 'Choose a conversion direction.');
refuse({ pace: '' }, 'Pace is required.');
refuse({ pace: '  ' }, 'Pace is required.');
refuse({ pace: '5' }, 'Pace must be minutes:seconds, for example 5:30.');
refuse({ pace: '5:5' }, 'Pace must be minutes:seconds, for example 5:30.');
refuse({ pace: '5:60' }, 'Pace must be minutes:seconds, for example 5:30.');
refuse({ pace: '-5:00' }, 'Pace must be minutes:seconds, for example 5:30.');
refuse({ pace: '1:59' }, 'Pace must be between 2:00 and 30:00 per km.');
refuse({ pace: '30:01' }, 'Pace must be between 2:00 and 30:00 per km.');
refuse({ units: 'imperial', pace: '3:14' }, 'Pace must be between 3:15 and 48:00 per mile.');
refuse({ grade: '' }, 'Grade is required.');
refuse({ grade: 'steep' }, 'Grade must be a number with at most two decimal places.');
refuse({ grade: '5.125' }, 'Grade must be a number with at most two decimal places.');
refuse({ grade: '5e1' }, 'Grade must be a number with at most two decimal places.');
refuse({ grade: '26' }, 'Grade must be between -25% and 25%.');
refuse({ grade: '-30' }, 'Grade must be between -25% and 25%.');
refuse({ pace: '2:10', grade: '25' },
  'The equivalent pace falls outside 1:30 to 60:00 per unit; check the pace and grade.');

// A pace exactly on the bounds is accepted.
close(run({ pace: '2:00' }).paceSeconds, 120, 1e-9, 'metric floor accepted');
close(run({ pace: '30:00' }).paceSeconds, 1800, 1e-9, 'metric ceiling accepted');
close(run({ grade: '25' }).gainMperKm, 250, 1e-9, 'upper grade accepted');
close(run({ grade: '-25' }).gainMperKm, -250, 1e-9, 'lower grade accepted');
close(run({ grade: '0.00' }).cost, 3.6, 1e-12, 'zero with decimals');

// Page contract: shared chrome, one form, defaults pinned, no storage, no network, no HTML sinks.
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style\.css">/);
assert.equal((html.match(/id="gap-form"/g) || []).length, 1);
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('role="alert"'));
for (const id of ['in-units', 'in-direction', 'in-pace', 'in-grade']) {
  assert.ok(html.includes('id="' + id + '"'), 'control present: ' + id);
}
assert.ok(html.includes('id="pace-unit"'), 'pace unit hint present');
assert.match(html, /<option value="metric" selected>/);
assert.match(html, /id="in-pace"[^>]*value="5:00"/);
assert.match(html, /id="in-grade"[^>]*value="5"/);
assert.match(html, /\.actions button\{[^}]*min-height:44px/);
assert.match(html, /\.field input,\.field select\{[^}]*min-height:44px/);
assert.match(html, /<button type="submit">/);
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), 'page stores nothing');
assert.ok(!/https?:\/\//.test(html), 'page references no external URL');
assert.ok(!/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/.test(html), 'page makes no requests');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page uses no HTML sinks');

console.log(slug + ' core: all checks passed (' + record.testCases.length + ' catalog cases, '
  + golden + ' golden, cost, speed and direction invariants)');
