/* Regression checks for the bandsaw blade length core, its catalog cases and
   the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'bandsaw-blade-length-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* bandsaw-blade-core:start */');
const end = html.indexOf('/* bandsaw-blade-core:end */');
assert.ok(start > -1 && end > start, 'bandsaw core markers missing');
const core = html.slice(start, end + '/* bandsaw-blade-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BandsawBladeCore;', sandbox);
const C = sandbox.module.exports;

const IN = 25.4;
const PI = Math.PI;
const M = C.MESSAGES;

function run(input) {
  return C.calculate(input);
}

function failure(input) {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
}

// Independent geometry: the blade path is the boundary of the convex hull of
// the two wheels, so its perimeter can be measured from sampled points without
// using the closed form at all.
function hullPerimeter(d1, d2, spacing, samples) {
  const n = samples || 2000;
  const points = [];
  for (const [centre, diameter] of [[0, d1], [spacing, d2]]) {
    const radius = diameter / 2;
    for (let index = 0; index < n; index += 1) {
      const angle = (2 * PI * index) / n;
      points.push([radius * Math.cos(angle), centre + radius * Math.sin(angle)]);
    }
  }
  points.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const point of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let total = 0;
  for (let index = 0; index < hull.length; index += 1) {
    const a = hull[index];
    const b = hull[(index + 1) % hull.length];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

function oracleBlade(d1, d2, spacing) {
  const large = Math.max(d1, d2) / 2;
  const small = Math.min(d1, d2) / 2;
  const t = Math.asin((large - small) / spacing);
  const straight = Math.sqrt(spacing * spacing - (large - small) * (large - small));
  return 2 * straight + (PI + 2 * t) * large + (PI - 2 * t) * small;
}

const base = { mode: 'length', units: 'in', upper: '14', lower: '14', centre: '24.75', blade: '93.5' };

// Documented surface.
assert.equal(C.DEFAULTS.units, 'in');
assert.equal(C.DEFAULTS.mode, 'length');
assert.equal(C.DEFAULTS.upper, '14');
assert.equal(C.MIN_WHEEL_IN, 4);
assert.equal(C.MAX_WHEEL_IN, 40);
assert.equal(C.MAX_CENTRE_IN, 120);
assert.equal(C.MIN_BLADE_IN, 15);
assert.equal(C.MAX_BLADE_IN, 450);
assert.equal(C.MM_PER_IN, 25.4);

// Golden: two 14 in wheels 24.75 in apart need 93.482 in.
const standard = run(base);
assert.equal(standard.bladeIn, 93.482);
assert.equal(standard.bladeMm, 2374.5);
assert.equal(standard.nearestEighthIn, 93.5);
assert.equal(standard.straightRunIn, 24.75);
assert.equal(standard.wrapUpperDeg, 180);
assert.equal(standard.wrapLowerDeg, 180);
assert.equal(standard.travelFactor, 2);
assert.ok(Math.abs(standard.bladeIn - (2 * 24.75 + PI * 14)) < 0.001, 'equal wheels are 2C + pi D');

// The closed form agrees with the convex hull perimeter, which knows nothing
// about wraps or tangents.
for (const [d1, d2, spacing] of [[14, 14, 24.75], [18, 14, 30], [40, 10, 60], [4, 4, 9], [12, 10, 22.5]]) {
  const exact = oracleBlade(d1, d2, spacing);
  const hull = hullPerimeter(d1, d2, spacing);
  assert.ok(Math.abs(exact - hull) / exact < 1e-5, 'hull perimeter ' + d1 + '/' + d2 + '/' + spacing + ': ' + hull + ' vs ' + exact);
}

// Unequal wheels: the shop rule 2C + pi (D1 + D2)/2 + (D1 - D2)^2 / 4C is very
// close for near sizes, and the core's exact wrap must match it there.
const shop = (d1, d2, spacing) => 2 * spacing + PI * (d1 + d2) / 2 + ((d1 - d2) ** 2) / (4 * spacing);
for (const [d1, d2, spacing] of [[18, 14, 30], [20, 18, 36], [14, 12, 24.75]]) {
  const exact = run({ mode: 'length', units: 'in', upper: String(d1), lower: String(d2), centre: String(spacing) });
  assert.ok(Math.abs(exact.bladeIn - shop(d1, d2, spacing)) < 0.002,
    'shop rule disagrees by ' + (exact.bladeIn - shop(d1, d2, spacing)) + ' for ' + d1 + '/' + d2);
}

// Wrap angles always close the loop and follow the wheel sizes.
const unequal = run({ mode: 'length', units: 'in', upper: '18', lower: '14', centre: '30' });
assert.ok(Math.abs(unequal.wrapUpperDeg + unequal.wrapLowerDeg - 360) < 0.01, 'wraps add to 360');
assert.ok(unequal.wrapUpperDeg > 180 && unequal.wrapLowerDeg < 180, 'the larger wheel wraps more');
assert.ok(unequal.bladeIn > shop(18, 14, 30) - 0.002, 'the exact wrap is never shorter than the shop rule');
assert.ok(unequal.travelFactor > 1.9 && unequal.travelFactor < 2.01, 'travel factor near 2');

// Inverse: the spacing reported for a blade reproduces that blade.
for (const [d1, d2, spacing] of [[14, 14, 24.75], [18, 14, 30], [12, 8, 21.3], [40, 36, 100], [4, 30, 40]]) {
  const length = oracleBlade(d1, d2, spacing);
  const solved = run({
    mode: 'spacing', units: 'in', upper: String(d1), lower: String(d2), blade: length.toFixed(6)
  });
  assert.ok(Math.abs(solved.centreIn - spacing) < 2e-3, 'inverse ' + d1 + '/' + d2 + ' got ' + solved.centreIn);
  assert.ok(Math.abs(solved.bladeIn - length) < 2e-3, 'blade echoed back');
}

// Monotonic: a longer blade always needs a wider spacing.
let previous = 0;
for (let blade = 80; blade <= 140; blade += 5) {
  const solved = run({ mode: 'spacing', units: 'in', upper: '14', lower: '14', blade: String(blade) });
  assert.ok(solved.centreIn > previous, 'spacing grows with the blade at ' + blade);
  previous = solved.centreIn;
  assert.ok(Math.abs(solved.centreIn - (blade - PI * 14) / 2) < 0.001, 'equal wheels invert to (L - pi D) / 2');
}

// Millimetres and inches describe the same saw.
const metric = run({ mode: 'length', units: 'mm', upper: '355,6', lower: '355,6', centre: '628,65' });
assert.ok(Math.abs(metric.bladeIn - standard.bladeIn) < 0.002, 'metric and imperial agree');
assert.ok(Math.abs(metric.bladeMm * 1 - metric.bladeIn * IN) < 0.2, 'mm matches inches');
assert.ok(Math.abs(metric.centreMm - 628.7) < 0.06, 'metric spacing echoed');

// Ranges are enforced, and the touching-wheel spacing is the physical floor.
assert.equal(failure({ ...base, upper: '3.99' }), M.upperFormat);
assert.equal(failure({ ...base, lower: '40.01' }), M.lowerFormat);
assert.equal(failure({ ...base, centre: '14' }), M.centreOverlap, 'touching wheels are refused');
assert.ok(failure({ ...base, centre: '14.001' }) === null, 'spacing just beyond the radii is accepted');
assert.equal(failure({ mode: 'spacing', units: 'in', upper: '14', lower: '14', blade: '71.9' }), M.bladeShort);
assert.equal(failure({ mode: 'spacing', units: 'in', upper: '14', lower: '14', blade: '72.01' }), null, 'a blade just over the floor fits');

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((item) => item.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs, 'every listed record has a page');
assert.equal(entry.category, 'Crafts & Hobbies');
assert.equal(entry.subcategory, 'Planning');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.ok(entry.testCases.length >= 20, 'expected at least twenty catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = run(testCase.input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      if (typeof value === 'number') {
        assert.ok(Math.abs(result[key] - value) < 1e-9, testCase.name + ' ' + key + ' got ' + result[key]);
      } else {
        assert.equal(result[key], value, testCase.name + ' ' + key);
      }
    }
  }
}

// Uniqueness: no other record claims this slug, name or alias.
const aliases = catalog.tools
  .filter((tool) => tool.slug !== slug)
  .flatMap((tool) => [tool.slug, tool.name, ...(tool.aliases || [])].map((value) => value.toLowerCase()));
for (const value of [entry.name, ...entry.aliases]) {
  assert.ok(!aliases.includes(value.toLowerCase()), 'duplicate name or alias: ' + value);
}

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="blade-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
for (const id of ['in-mode', 'in-units', 'in-upper', 'in-lower', 'in-centre', 'in-blade']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
}
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');

console.log('bandsaw blade length calculator: ' + entry.testCases.length + ' catalog cases, '
  + 'hull and inverse invariants passed');
