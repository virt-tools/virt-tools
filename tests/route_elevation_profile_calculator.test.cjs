/* Regression checks for the route elevation profile core: leg distances,
   threshold-filtered ascent and descent, steepest grades, the catalog cases
   and the page's local-only contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const page = path.join(root, 'frontend/tools/route-elevation-profile-calculator/index.html');
const html = fs.readFileSync(page, 'utf8');
const start = html.indexOf('/* route-elevation-core:start */');
const end = html.indexOf('/* route-elevation-core:end */');
assert.ok(start > -1 && end > start, 'profile core markers missing');
const core = html.slice(start, end + '/* route-elevation-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RouteElevationCore;', sandbox);
const C = sandbox.module.exports;
const run = (input) => C.calculate(input);
const close = (actual, expected, label, eps = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= eps,
    `${label}: expected ${expected}, got ${actual}`);
};
const err = (input) => {
  try {
    C.calculate(input);
  } catch (error) {
    return error.message;
  }
  throw new Error('expected an error for ' + JSON.stringify(input).slice(0, 120));
};

// The page defaults: a ridge route that rises four times and drops three.
const base = run({});
assert.equal(base.pointCount, 8);
assert.equal(base.thresholdM, 3);
assert.equal(base.distanceM, 3011.154112);
assert.equal(base.distanceKm, 3.011154);
assert.equal(base.distanceMi, 1.871044);
assert.equal(base.ascentM, 225);
assert.equal(base.descentM, 87);
assert.equal(base.netM, 138);
assert.equal(base.minM, 530);
assert.equal(base.maxM, 744);
assert.equal(base.rangeM, 214);
close(base.ascentPerKmM, 74.72218);
close(base.steepestClimbPercent, 13.527267);
assert.equal(base.steepestClimbGainM, 55);
close(base.steepestClimbLegM, 406.586194);
close(base.steepestDescentPercent, -15.04341);
assert.equal(base.steepestDescentDropM, 58);
close(base.steepestDescentLegM, 385.550891);
assert.equal(base.profile.length, 8);
assert.equal(base.profile[0].distanceM, 0);
assert.equal(base.profile[0].elevationM, 530);
close(base.profile[7].distanceM, base.distanceM, 'profile end distance');
assert.equal(base.profile[7].elevationM, 668);
// Ascent minus descent is the net change whenever every metre is counted.
close(base.ascentM - base.descentM, base.netM, 'ascent minus descent equals net');

// Independent distance: the spherical law of cosines, a different formula path
// from the haversine the page uses.
function refLeg(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const p1 = lat1 * rad, p2 = lat2 * rad;
  const dLon = (lon2 - lon1) * rad;
  const cosAngle = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dLon);
  return 6371000 * Math.acos(Math.min(1, Math.max(-1, cosAngle)));
}
function refRowsDistance(rows) {
  let total = 0;
  for (let i = 1; i < rows.length; i += 1) {
    total += refLeg(rows[i - 1][0], rows[i - 1][1], rows[i][0], rows[i][1]);
  }
  return total;
}
function textOf(rows) {
  return rows.map((row) => row.join(', ')).join('\n');
}

// Deterministic route shapes across hemispheres, scales and elevation bands.
const shapes = [];
for (let seed = 0; seed < 6; seed += 1) {
  const rows = [];
  const baseLat = [-33.9, 0, 21.3, 47.4, 64.1, 78.2][seed];
  const baseLon = [151.2, 179.5, -157.8, -121.4, -21.9, 15.6][seed];
  for (let step = 0; step < 9; step += 1) {
    const lat = baseLat + step * 0.0023 + Math.sin(step * 1.7 + seed) * 0.0009;
    const lon = baseLon + step * 0.0031 + Math.cos(step * 2.3 + seed) * 0.0011;
    const elev = 200 + seed * 90 + Math.sin(step * 1.1 + seed) * 45 + step * 6;
    rows.push([Number(lat.toFixed(6)), Number(lon.toFixed(6)), Number(elev.toFixed(1))]);
  }
  shapes.push(rows);
}
// A sawtooth with sub-threshold jitter, a single long climb and a flat run.
shapes.push([[10, 20, 100], [10.00002, 20, 100.4], [10.00004, 20, 99.8], [10.0045, 20, 140],
  [10.00452, 20, 139.9], [10.009, 20, 139.6], [10.0135, 20, 210]]);
shapes.push([[45, 7, 1500], [45.001, 7, 1500], [45.002, 7, 1500], [45.003, 7, 1500]]);
shapes.push([[0, 179.998, 5], [0, -179.998, 12], [0.001, -179.996, 3], [0.002, -179.994, 18]]);

let referenceCases = 0;
for (const rows of shapes) {
  const text = textOf(rows);
  const zero = run({ rows: text, threshold: '0' });
  const reference = refRowsDistance(rows);
  close(zero.distanceM, reference, 'law-of-cosines distance', Math.max(0.02, reference * 1e-6));
  referenceCases += 1;
  // With no filtering every metre counts: ascent and descent are the positive
  // and negative deltas, and their difference is the net change.
  let ascent = 0, descent = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const delta = rows[i][2] - rows[i - 1][2];
    if (delta > 0) ascent += delta;
    if (delta < 0) descent -= delta;
  }
  close(zero.ascentM, ascent, 'unfiltered ascent');
  close(zero.descentM, descent, 'unfiltered descent');
  close(zero.ascentM - zero.descentM, zero.netM, 'net change');
  close(zero.netM, rows[rows.length - 1][2] - rows[0][2], 'net change from ends');
  close(zero.rangeM, Math.max(...rows.map((r) => r[2])) - Math.min(...rows.map((r) => r[2])), 'range');
  assert.equal(zero.pointCount, rows.length);
  assert.equal(zero.profile.length, rows.length);
  assert.equal(zero.profile[0].distanceM, 0);
  close(zero.profile[zero.profile.length - 1].distanceM, zero.distanceM, 'profile spans the route');
  let previous = 0;
  for (const point of zero.profile) {
    assert.ok(point.distanceM >= previous - 1e-9, 'profile distance never decreases');
    previous = point.distanceM;
  }
  referenceCases += 1;

  // A larger threshold never adds climbing, and every counted change meets it.
  let lastAscent = zero.ascentM;
  for (const threshold of [0.5, 3, 7.5, 25, 100]) {
    const filtered = run({ rows: text, threshold: String(threshold) });
    assert.equal(filtered.thresholdM, threshold);
    assert.ok(filtered.ascentM <= lastAscent + 1e-9,
      `ascent at ${threshold} m threshold (${filtered.ascentM}) exceeds the looser filter (${lastAscent})`);
    assert.ok(filtered.descentM <= zero.descentM + 1e-9, 'descent never grows with a filter');
    lastAscent = filtered.ascentM;
    close(filtered.distanceM, zero.distanceM, 'threshold does not change distance');
    close(filtered.netM, zero.netM, 'threshold does not change the net change');
    referenceCases += 1;
  }

  // Reversing the route keeps the distance and swaps climbing for descending.
  const reversed = [...rows].reverse();
  const back = run({ rows: textOf(reversed), threshold: '0' });
  close(back.distanceM, zero.distanceM, 'reversed distance', 1e-6);
  close(back.ascentM, zero.descentM, 'reversed ascent');
  close(back.descentM, zero.ascentM, 'reversed descent');
  referenceCases += 1;

  // Grades are recomputed from the legs the page is allowed to use.
  const legs = [];
  for (let i = 1; i < rows.length; i += 1) {
    const leg = refLeg(rows[i - 1][0], rows[i - 1][1], rows[i][0], rows[i][1]);
    if (leg >= C.MIN_GRADE_LEG_M) legs.push((rows[i][2] - rows[i - 1][2]) / leg * 100);
  }
  const climbs = legs.filter((grade) => grade > 0);
  const drops = legs.filter((grade) => grade < 0);
  if (climbs.length) {
    close(zero.steepestClimbPercent, Math.max(...climbs), 'steepest climb', 1e-3);
  } else {
    assert.equal(zero.steepestClimbPercent, null, 'no climb grade without a long enough rise');
  }
  if (drops.length) {
    close(zero.steepestDescentPercent, Math.min(...drops), 'steepest descent', 1e-3);
  } else {
    assert.equal(zero.steepestDescentPercent, null, 'no descent grade without a long enough drop');
  }
  referenceCases += 1;
}

// Hand-worked hysteresis: a 4 m dip inside a climb is ignored at a 5 m
// threshold, while a 10 m rise and an 8 m drop from the peak are counted.
function seriesText(elevations) {
  return elevations.map((elev, index) => [10, 20 + index * 0.001, elev].join(',')).join('\n');
}
const dip = run({ rows: seriesText([0, 10, 6, 9, 2]), threshold: '5' });
assert.equal(dip.ascentM, 10);
assert.equal(dip.descentM, 8);
assert.equal(dip.netM, 2);
const dipRaw = run({ rows: seriesText([0, 10, 6, 9, 2]), threshold: '0' });
assert.equal(dipRaw.ascentM, 13);
assert.equal(dipRaw.descentM, 11);
// Below the threshold nothing accumulates at all.
const quiet = run({ rows: seriesText([0, 4, 0, 4, 0]), threshold: '5' });
assert.equal(quiet.ascentM, 0);
assert.equal(quiet.descentM, 0);
assert.equal(quiet.rangeM, 4);
const loud = run({ rows: seriesText([0, 4, 0, 4, 0]), threshold: '3' });
assert.equal(loud.ascentM, 8);
assert.equal(loud.descentM, 8);
assert.equal(loud.netM, 0);

// Inclusive bounds: the smallest accepted route and the largest point count.
const pair = run({ rows: '0,0,0\n0,0.0002,10', threshold: '0' });
assert.equal(pair.pointCount, 2);
close(pair.distanceM, refLeg(0, 0, 0, 0.0002), 'short leg', 0.001);
const many = [];
for (let i = 0; i < 2000; i += 1) many.push('10,' + (20 + i * 0.0001).toFixed(4) + ',' + (100 + (i % 7)));
assert.equal(run({ rows: many.join('\n'), threshold: '0' }).pointCount, 2000);
many.push('10,20.3,100');
assert.equal(err({ rows: many.join('\n'), threshold: '0' }), 'A route can hold at most 2000 points.');

// Bad input fails with an actionable message naming the line, never a default.
assert.equal(err({ rows: '' }), 'Enter at least two rows of latitude, longitude and elevation.');
assert.equal(err({ rows: '   \n\n  ' }), 'Enter at least two rows of latitude, longitude and elevation.');
assert.equal(err({ rows: '10,20,500' }), 'A route needs at least two points.');
assert.equal(err({ rows: '10,20,500\n10,20' }), 'Line 2: expected latitude, longitude and elevation.');
assert.equal(err({ rows: '10,20,500\n10,20,500,500' }), 'Line 2: expected latitude, longitude and elevation.');
assert.equal(err({ rows: '10,20,500\nnorth,20,500' }),
  'Line 2: latitude must be a decimal number from -90 to 90 degrees.');
assert.equal(err({ rows: '10,20,500\n-90.5,20,500' }),
  'Line 2: latitude must be a decimal number from -90 to 90 degrees.');
assert.equal(err({ rows: '10,20,500\n10,181,500' }),
  'Line 2: longitude must be a decimal number from -180 to 180 degrees.');
assert.equal(err({ rows: '10,20,500\n10,20,9001' }),
  'Line 2: elevation must be a number of metres from -500 to 9000.');
assert.equal(err({ rows: '10,20,500\n10,20,-501' }),
  'Line 2: elevation must be a number of metres from -500 to 9000.');
assert.equal(err({ rows: '10,20,500\n10,21,600', threshold: '-1' }),
  'Smoothing threshold must be a number from 0 to 100 metres.');
assert.equal(err({ rows: '10,20,500\n10,21,600', threshold: '101' }),
  'Smoothing threshold must be a number from 0 to 100 metres.');
assert.equal(err({ rows: '10,20,500\n10,21,600', threshold: 'noise' }),
  'Smoothing threshold must be a number from 0 to 100 metres.');
// Semicolons, tabs and mixed separators are accepted; blank lines are skipped.
const mixed = run({ rows: '10;20;500\n\n10\t20.001\t520\n10, 20.002, 515', threshold: '0' });
assert.equal(mixed.pointCount, 3);
assert.equal(mixed.ascentM, 20);
assert.equal(mixed.descentM, 5);
// Null options fall back to the documented defaults.
assert.equal(run({ rows: null, threshold: null }).ascentM, 225, 'nulls use the defaults');
assert.equal(run({ threshold: '' }).thresholdM, 0, 'a blank threshold counts every metre');

// The page must stay local: no network, storage, markup injection or inline handlers.
// The only absolute URL allowed is the SVG namespace identifier, which is a name
// rather than a fetchable resource.
const withoutNamespaces = html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
assert.ok(!/https?:\/\//.test(withoutNamespaces.replace(/https:\/\/virt\.tools[^"]*/g, '')),
  'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="re-form"/.test(html), 'page has a submittable form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/<label class="f" for="in-rows"/.test(html), 'page labels the route points field');
assert.ok(/<label class="f" for="in-threshold"/.test(html), 'page labels the threshold field');
assert.ok(/<textarea id="in-rows"/.test(html), 'page accepts a pasted route');
assert.ok(/\.profile \.area\{/.test(html) && /box\.className = "profile"/.test(html), 'page styles the profile chart');
assert.ok(/role: "img"/.test(html), 'profile chart exposes an accessible name');

// Catalog record and its pinned cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'route-elevation-profile-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Route Elevation Profile Calculator');
assert.equal(record.category, 'Geography');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10, 'ten golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 11, 'eleven validation cases');
for (const testCase of record.testCases) {
  const options = { ...C.DEFAULTS, ...testCase.input };
  if (testCase.expected && testCase.expected.error) {
    assert.equal(err(options), testCase.expected.error, testCase.name);
    continue;
  }
  const result = C.calculate(options);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') {
      close(result[key], value, testCase.name + ' ' + key);
    } else {
      assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

console.log('route-elevation-profile-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + referenceCases + ' reference cases)');
