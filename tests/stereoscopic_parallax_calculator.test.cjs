/* Regression checks for the stereoscopic parallax core, its catalog cases and
   the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'stereoscopic-parallax-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* spx-core:start */');
const end = html.indexOf('/* spx-core:end */');
assert.ok(start > -1 && end > start, 'stereoscopic parallax core markers missing');
const core = html.slice(start, end + '/* spx-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = StereoParallaxCore;', sandbox);
const C = sandbox.module.exports;

const DEFAULTS = { focal: '35', sensor: '36', width: '1920', interaxial: '64', convergence: '10', subject: '5', budget: '1' };
const run = (overrides) => C.compute(Object.assign({}, DEFAULTS, overrides || {}));
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ': ' + actual + ' differs from ' + expected + ' by more than ' + tolerance);
};

// Pinned bounds and defaults.
assert.deepEqual(JSON.parse(JSON.stringify(C.DEFAULTS)), DEFAULTS);
assert.equal(C.BOUNDS.focal.min, 4);
assert.equal(C.BOUNDS.focal.max, 300);
assert.equal(C.BOUNDS.sensor.min, 3);
assert.equal(C.BOUNDS.width, undefined);
assert.equal(C.WIDTH_MIN, 320);
assert.equal(C.WIDTH_MAX, 8192);
assert.equal(C.BOUNDS.interaxial.min, 0);
assert.equal(C.BOUNDS.interaxial.max, 500);
assert.equal(C.BOUNDS.convergence.min, 0.3);
assert.equal(C.BOUNDS.subject.max, 500);
assert.equal(C.BOUNDS.budget.min, 0.05);
assert.equal(C.BOUNDS.budget.max, 5);

// The headline case: 35 mm on a full-frame 1920 sensor at 5 m, 64 mm interaxial
// and 10 m convergence gives 11.95 px of crossed parallax, 0.62% of the width.
const base = run();
close(base.focalPx, 35 / 36 * 1920, 1e-9, 'pixel focal length');
close(base.parallaxPx, 11.9467, 5e-4, 'default parallax');
close(base.sharePercent, 0.6222, 5e-4, 'default share');
close(base.budgetPx, 19.2, 1e-12, 'default budget in pixels');
assert.equal(base.side, 'front');
close(base.nearM, 3.8356, 5e-4, 'default near limit');
assert.equal(base.farM, null, 'default far limit is unbounded');
close(base.maxInteraxialMm, 102.8571, 5e-4, 'default largest interaxial');
close(base.fovDegrees, 2 * Math.atan(36 / (2 * 35)) * 180 / Math.PI, 1e-9, 'field of view');
assert.equal(base.insideBudget, true);

// Structure: the parallax is the pixel focal length times the interaxial times
// the difference of the distance reciprocals, and it vanishes on the screen
// plane and changes sign across it.
const identity = (r) => r.focalPx * (r.interaxial / 1000) * (1 / r.subject - 1 / r.convergence);
for (const subject of ['0.4', '1', '3', '7.5', '10', '14', '25', '80']) {
  const r = run({ subject });
  close(r.parallaxPx, identity(r), 1e-9, 'parallax identity at ' + subject + ' m');
  close(r.sharePercent, Math.abs(r.parallaxPx) / r.width * 100, 1e-12, 'share identity at ' + subject);
  if (Number(subject) < 10) assert.equal(r.side, 'front');
  if (Number(subject) > 10) assert.equal(r.side, 'behind');
  assert.equal(r.insideBudget, Math.abs(r.parallaxPx) <= r.budgetPx + 1e-9,
    'budget flag at ' + subject);
}
assert.equal(run({ subject: '10' }).side, 'plane');
close(run({ subject: '10' }).parallaxPx, 0, 1e-12, 'zero parallax on the screen plane');

// The near and far limits really sit on the budget, and the largest interaxial
// puts this subject exactly on it.
const parallaxAt = (r, distance, interaxialMm) => r.focalPx
  * ((interaxialMm == null ? r.interaxial : interaxialMm) / 1000)
  * (1 / distance - 1 / r.convergence);
for (const opts of [
  { convergence: '10', subject: '4', budget: '1' },
  { convergence: '6', subject: '3', budget: '0.8' },
  { convergence: '12', subject: '20', budget: '0.4' },
  { convergence: '2.5', subject: '1.1', budget: '1.5' },
]) {
  const r = run(opts);
  close(parallaxAt(r, r.nearM), r.budgetPx, 1e-6, 'near limit on budget ' + JSON.stringify(opts));
  if (r.farM != null) {
    close(parallaxAt(r, r.farM), -r.budgetPx, 1e-6, 'far limit on budget ' + JSON.stringify(opts));
  }
  if (r.maxInteraxialMm != null) {
    close(Math.abs(parallaxAt(r, r.subject, r.maxInteraxialMm)), r.budgetPx, 1e-6,
      'largest interaxial on budget ' + JSON.stringify(opts));
  }
  assert.ok(r.nearM < Number(opts.convergence), 'near limit sits in front of the screen plane');
}

// A wider budget can only widen the range and can only raise the allowed
// interaxial; a longer lens at the same distance raises the parallax.
const tight = run({ budget: '0.5' });
const loose = run({ budget: '2' });
assert.ok(tight.nearM > loose.nearM, 'a wider budget reaches closer');
assert.ok(tight.maxInteraxialMm < loose.maxInteraxialMm, 'a wider budget allows more interaxial');
assert.ok(run({ focal: '70' }).parallaxPx > base.parallaxPx, 'a longer lens separates more');
assert.ok(run({ interaxial: '128' }).parallaxPx > base.parallaxPx, 'a wider baseline separates more');

// Zero interaxial is a monoscopic rig: no parallax, no limits.
const mono = run({ interaxial: '0' });
assert.equal(mono.stereo, false);
close(mono.parallaxPx, 0, 1e-12, 'mono parallax');
assert.equal(mono.nearM, null);
assert.equal(mono.farM, null);
assert.equal(mono.maxInteraxialMm, null);
assert.equal(mono.insideBudget, true);

// Catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2258, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(record.name, 'Stereoscopic Parallax Calculator');
assert.equal(record.category, 'Video');
assert.equal(record.listed, true);
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.length > 500, 'method explains the model');
assert.ok(record.sources.length >= 3, 'sources cite the geometry');
assert.ok(record.testCases.length >= 20, 'catalog cases are exhaustive');
const nameClash = catalog.tools.filter((tool) => tool.slug !== slug)
  .some((tool) => tool.name === record.name);
assert.equal(nameClash, false, 'name is unique');
for (const name of record.aliases) {
  const clash = catalog.tools.filter((tool) => tool.slug !== slug)
    .some((tool) => tool.name === name || (tool.aliases || []).includes(name));
  assert.equal(clash, false, 'alias is unique: ' + name);
}
for (const tag of record.tags) {
  assert.equal(typeof tag, 'string');
  assert.ok(tag.length > 0);
}

const keys = ['focalPx', 'parallaxPx', 'sharePercent', 'budgetPx', 'nearM', 'farM',
  'maxInteraxialMm', 'fovDegrees'];
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
  for (const key of keys) {
    if (expected[key] === null) {
      assert.equal(result[key], null, testCase.name + ' ' + key);
    } else {
      close(result[key], expected[key], 5e-4, testCase.name + ' ' + key);
    }
  }
  assert.equal(result.side, expected.side, testCase.name + ' side');
  assert.equal(result.stereo, expected.stereo, testCase.name + ' stereo');
  assert.equal(result.insideBudget, expected.insideBudget, testCase.name + ' budget flag');
  close(result.parallaxPx, identity(result), 1e-9, testCase.name + ' identity');
}
assert.equal(golden, 11, 'golden case count');

// Refusals carry the page's user-facing wording.
const refuse = (overrides, message) => {
  try {
    run(overrides);
    assert.fail('expected a refusal for ' + JSON.stringify(overrides));
  } catch (error) {
    assert.equal(error.message, message);
  }
};
refuse({ focal: '' }, 'Focal length is required.');
refuse({ focal: '   ' }, 'Focal length is required.');
refuse({ focal: 'wide' }, 'Focal length must be a plain number with at most three decimal places, for example 35.5.');
refuse({ focal: '35.1234' }, 'Focal length must be a plain number with at most three decimal places, for example 35.5.');
refuse({ focal: '-35' }, 'Focal length must be a plain number with at most three decimal places, for example 35.5.');
refuse({ focal: '2' }, 'Focal length must be between 4 and 300 mm.');
refuse({ focal: '301' }, 'Focal length must be between 4 and 300 mm.');
refuse({ sensor: '100' }, 'Sensor width must be between 3 and 70 mm.');
refuse({ width: '200' }, 'Horizontal resolution must be between 320 and 8192 pixels.');
refuse({ width: '1920.5' }, 'Horizontal resolution must be a whole number of pixels.');
refuse({ width: '' }, 'Horizontal resolution is required.');
refuse({ interaxial: '900' }, 'Interaxial must be between 0 and 500 mm.');
refuse({ convergence: '0.1' }, 'Convergence distance must be between 0.3 and 200 m.');
refuse({ subject: '900' }, 'Subject distance must be between 0.2 and 500 m.');
refuse({ subject: '0.1' }, 'Subject distance must be between 0.2 and 500 m.');
refuse({ budget: '0' }, 'Parallax budget must be between 0.05 and 5 percent.');
refuse({ budget: '10' }, 'Parallax budget must be between 0.05 and 5 percent.');

// Bounds are inclusive.
close(run({ focal: '4' }).focal, 4, 1e-12, 'focal floor accepted');
close(run({ focal: '300' }).focal, 300, 1e-12, 'focal ceiling accepted');
close(run({ width: '320' }).width, 320, 1e-12, 'resolution floor accepted');
close(run({ width: '8192' }).width, 8192, 1e-12, 'resolution ceiling accepted');
close(run({ budget: '0.05' }).budget, 0.05, 1e-12, 'budget floor accepted');
close(run({ interaxial: '0' }).interaxial, 0, 1e-12, 'zero interaxial accepted');

// Page contract: shared chrome, one form, defaults pinned, no storage, no
// network, no HTML sinks.
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style\.css">/);
assert.equal((html.match(/id="spx-form"/g) || []).length, 1);
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('role="alert"'));
for (const id of ['in-focal', 'in-sensor', 'in-width', 'in-interaxial', 'in-convergence',
  'in-subject', 'in-budget']) {
  assert.ok(html.includes('id="' + id + '"'), 'control present: ' + id);
}
assert.match(html, /id="in-focal"[^>]*value="35"/);
assert.match(html, /id="in-sensor"[^>]*value="36"/);
assert.match(html, /id="in-width"[^>]*value="1920"/);
assert.match(html, /id="in-interaxial"[^>]*value="64"/);
assert.match(html, /id="in-convergence"[^>]*value="10"/);
assert.match(html, /id="in-subject"[^>]*value="5"/);
assert.match(html, /id="in-budget"[^>]*value="1"/);
assert.match(html, /\.actions button\{[^}]*min-height:44px/);
assert.match(html, /\.field input\{[^}]*min-height:44px/);
assert.match(html, /<button type="submit">/);
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), 'page stores nothing');
assert.ok(!/https?:\/\//.test(html), 'page references no external URL');
assert.ok(!/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/.test(html), 'page makes no requests');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page uses no HTML sinks');

console.log(slug + ' core: all checks passed (' + record.testCases.length + ' catalog cases, '
  + golden + ' golden, parallax, budget-limit, interaxial and page-contract invariants)');
