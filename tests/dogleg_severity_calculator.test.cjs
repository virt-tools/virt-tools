/* Dogleg severity calculator: the minimum curvature identities against an
   independent arc integration on the unit sphere, the published two-station
   example, the unit handling, the closure, the warnings, the refusals, the
   catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'dogleg-severity-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* dogleg-core:start */';
const endMarker = '/* dogleg-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = DoglegCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');

const RAD = Math.PI / 180;
const base = { unit: 'm', md1: '2000', inc1: '30', az1: '120', md2: '2100', inc2: '33', az2: '125' };
const run = (overrides) => C.calculate(Object.assign({}, base, overrides || {}));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};

// ---- An independent model: interpolate the tangent vector along the arc on
// the unit sphere (slerp) and add up the direction over small steps. This is a
// numerical integration of the same circular arc, not the closed-form ratio
// factor the page uses, so it catches a wrong ratio factor or a swapped term.
function numericArc(input, steps) {
  const i1 = Number(input.inc1) * RAD, i2 = Number(input.inc2) * RAD;
  const a1 = (Number(input.az1) === 360 ? 0 : Number(input.az1)) * RAD;
  const a2 = (Number(input.az2) === 360 ? 0 : Number(input.az2)) * RAD;
  const v1 = [Math.sin(i1) * Math.cos(a1), Math.sin(i1) * Math.sin(a1), Math.cos(i1)];
  const v2 = [Math.sin(i2) * Math.cos(a2), Math.sin(i2) * Math.sin(a2), Math.cos(i2)];
  const dot = Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]));
  const beta = Math.acos(dot);
  const length = Number(input.md2) - Number(input.md1);
  let n = 0, e = 0, t = 0;
  if (beta < 1e-12) {
    n = v1[0] * length; e = v1[1] * length; t = v1[2] * length;
  } else {
    const step = 1 / steps;
    for (let k = 0; k < steps; k += 1) {
      const u = (k + 0.5) * step;
      const w1 = Math.sin((1 - u) * beta) / Math.sin(beta);
      const w2 = Math.sin(u * beta) / Math.sin(beta);
      n += (w1 * v1[0] + w2 * v2[0]) * length * step;
      e += (w1 * v1[1] + w2 * v2[1]) * length * step;
      t += (w1 * v1[2] + w2 * v2[2]) * length * step;
    }
  }
  return { beta: beta / RAD, north: n, east: e, tvd: t };
}

const integrationCases = [
  { unit: 'ft', md1: '3500', inc1: '15', az1: '20', md2: '3600', inc2: '25', az2: '45' },
  { unit: 'm', md1: '2000', inc1: '30', az1: '120', md2: '2100', inc2: '33', az2: '125' },
  { unit: 'm', md1: '1500', inc1: '60', az1: '10', md2: '1530', inc2: '60', az2: '40' },
  { unit: 'ft', md1: '1200', inc1: '0', az1: '0', md2: '1700', inc2: '2', az2: '90' },
  { unit: 'm', md1: '800', inc1: '40', az1: '350', md2: '830', inc2: '42', az2: '10' },
  { unit: 'ft', md1: '5000', inc1: '5', az1: '0', md2: '5100', inc2: '70', az2: '180' }
];
for (const input of integrationCases) {
  const got = C.calculate(input);
  const want = numericArc(input, 20000);
  assert.ok(Math.abs(got.doglegAngle - want.beta) <= 0.002,
    'dogleg angle matches the arc integration: ' + got.doglegAngle + ' vs ' + want.beta);
  assert.ok(Math.abs(got.deltaTvd - want.tvd) <= 0.02, 'TVD increment matches the integration');
  assert.ok(Math.abs(got.deltaNorth - want.north) <= 0.02, 'north increment matches the integration');
  assert.ok(Math.abs(got.deltaEast - want.east) <= 0.02, 'east increment matches the integration');
}

// ---- The published worked example: 3,500 ft 15 degrees / 20 degrees azimuth to
// 3,600 ft 25 degrees / 45 degrees gives 27.22 ft north, 19.45 ft east and
// 94.01 ft TVD with a dogleg of about 12.95 degrees.
const published = run({ unit: 'ft', md1: '3500', inc1: '15', az1: '20', md2: '3600', inc2: '25', az2: '45' });
assert.equal(published.doglegAngle, 12.952);
assert.equal(published.deltaNorth, 27.22);
assert.equal(published.deltaEast, 19.45);
assert.equal(published.deltaTvd, 94.01);
assert.equal(published.dlsPer100ft, 12.952, 'a 100 ft interval makes the severity equal to the dogleg angle');
assert.ok(Math.abs(published.ratioFactor - 1.0041) <= 0.0003, 'the ratio factor is close to the published 1.00408');

// ---- The two severity units share one reference length ratio, not a scale.
for (const input of [integrationCases[0], integrationCases[1], integrationCases[4]]) {
  const got = C.calculate(input);
  const intervalM = got.intervalM;
  const intervalFt = intervalM / C.FT_PER_M;
  assert.ok(Math.abs(got.dlsPer30m - got.doglegAngle * 30 / intervalM) < 0.002, 'degrees per 30 m');
  assert.ok(Math.abs(got.dlsPer100ft - got.doglegAngle * 100 / intervalFt) < 0.002, 'degrees per 100 ft');
  assert.ok(Math.abs(got.dlsPer100ft / got.dlsPer30m - 30.48 / 30) < 0.002, 'the units differ by 30.48 over 30');
  assert.ok(Math.abs(got.intervalFt - intervalM / 0.3048) < 0.02, 'the course length converts to feet');
}

// ---- A zero dogleg is the limit of the ratio factor, not a divide by zero.
const straight = run({ md1: '600', inc1: '12', az1: '200', md2: '630', inc2: '12', az2: '200' });
assert.equal(straight.ratioFactor, 1);
assert.equal(straight.doglegAngle, 0);
assert.equal(straight.deltaTvd, Math.round(30 * Math.cos(12 * RAD) * 100) / 100, 'a straight hole drops cos I per unit length');
assert.ok(Math.abs(straight.deltaNorth - 30 * Math.sin(12 * RAD) * Math.cos(200 * RAD)) < 0.02);
assert.ok(Math.abs(straight.deltaEast - 30 * Math.sin(12 * RAD) * Math.sin(200 * RAD)) < 0.02);
assert.equal(run({ md1: '500', inc1: '25', az1: '360', md2: '530', inc2: '25', az2: '0' }).doglegAngle, 0,
  '360 and 0 degrees azimuth are the same direction');

// ---- Azimuths wrap: 350 to 10 is a 20 degree turn, and turning the other way
// gives the same dogleg and the same magnitudes.
const wrap = run({ md1: '800', inc1: '40', az1: '350', md2: '830', inc2: '42', az2: '10' });
const back = run({ md1: '800', inc1: '42', az1: '10', md2: '830', inc2: '40', az2: '350' });
assert.equal(wrap.azimuthChange, 20);
assert.equal(back.azimuthChange, -20);
assert.equal(wrap.doglegAngle, back.doglegAngle);
assert.equal(Math.abs(wrap.deltaNorth), Math.abs(back.deltaNorth));
assert.equal(Math.abs(wrap.deltaEast), Math.abs(back.deltaEast));

// ---- Closure is the horizontal departure and its bearing.
for (const input of integrationCases) {
  const got = C.calculate(input);
  const closure = Math.sqrt(got.deltaNorth ** 2 + got.deltaEast ** 2);
  assert.ok(Math.abs(got.closureDistance - closure) <= 0.02, 'closure is the horizontal departure');
  assert.ok(got.closureAzimuth >= 0 && got.closureAzimuth < 360, 'closure azimuth stays in range');
  if (closure > 0.5) {
    const bearing = ((Math.atan2(got.deltaEast, got.deltaNorth) / RAD) + 360) % 360;
    assert.ok(Math.abs(got.closureAzimuth - bearing) <= 0.6, 'closure azimuth follows atan2(east, north)');
  }
}

// ---- Warnings.
const hot = run({ md1: '1000', inc1: '10', az1: '75', md2: '1030', inc2: '20', az2: '75' });
assert.equal(hot.dlsPer30m, 10);
assert.ok(hot.warnings.some((text) => /above 3 degrees per 30 m/.test(text)), 'a 10 degree build is called out');
assert.ok(run({ md1: '100', inc1: '0', az1: '0', md2: '400', inc2: '30', az2: '45' }).warnings
  .some((text) => /longer than the reference length/.test(text)), 'a long interval is called out');
assert.ok(run({ unit: 'ft', md1: '9000', inc1: '88', az1: '180', md2: '9006', inc2: '89', az2: '182' }).warnings
  .some((text) => /A short interval/.test(text)), 'a short interval is called out');
assert.ok(run({ md1: '0', inc1: '0', az1: '0', md2: '200', inc2: '0', az2: '180' }).warnings
  .some((text) => /within 1 degree of vertical/.test(text)), 'vertical stations are called out');
assert.equal(run({ md1: '2000', inc1: '30', az1: '120', md2: '2030', inc2: '31', az2: '121' }).warnings.length, 0,
  'a routine 30 m interval is quiet');

// ---- Refusals.
assert.equal(failure({ md1: '' }), 'Enter the upper measured depth.');
assert.equal(failure({ md2: 'deep' }), 'Enter the lower measured depth.');
assert.equal(failure({ md2: '1999' }), 'The lower station must be deeper than the upper station by at least 0.1.');
assert.equal(failure({ md2: '2000.05' }), 'The lower station must be deeper than the upper station by at least 0.1.');
assert.equal(failure({ inc1: '181' }), 'The upper inclination must be between 0 and 180 degrees.');
assert.equal(failure({ inc2: '-1' }), 'The lower inclination must be between 0 and 180 degrees.');
assert.equal(failure({ az1: '-0.1' }), 'The upper azimuth must be between 0 and 360 degrees.');
assert.equal(failure({ az2: '360.1' }), 'The lower azimuth must be between 0 and 360 degrees.');
assert.equal(failure({ md2: '100001' }), 'The lower measured depth must be between 0 and 100000.');
assert.equal(failure({ unit: 'furlong' }), 'Choose metres or feet for the measured depths.');
const opposite = (value) => {
  try {
    C.calculate(value);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};
assert.equal(opposite({ unit: 'm', md1: '0', inc1: '0', az1: '0', md2: '100', inc2: '180', az2: '0' }),
  'The two stations point in opposite directions, so the arc between them is undefined.');
assert.equal(opposite(null), 'Nothing to calculate.');
assert.equal(opposite('3500 ft'), 'Nothing to calculate.');
assert.equal(C.FT_PER_M, 0.3048);
assert.equal(C.MIN_INTERVAL, 0.1);

// ---- Catalog record: counts, cases and metadata.
assert.equal(catalog.tools.length, 2509, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2248, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Oil, Gas & Marine Engineering').length, 57,
  'Oil, Gas & Marine Engineering count');
assert.equal(record.category, 'Oil, Gas & Marine Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.method.length > 900, 'the method note carries the formulas and the exclusions');
assert.ok(/minimum curvature/i.test(record.method));
assert.equal(record.sources.length, 2);
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'every source has a fetched https url');
  assert.ok(source.title.length > 60, 'the citation keeps its wording');
}

const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 5, boundary: 5, validation: 5 + 1 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(JSON.stringify(actual[key]), JSON.stringify(expected), testCase.name + ': ' + key);
  }
}

// ---- Uniqueness across the catalog.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
for (const alias of record.aliases) {
  assert.equal(catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase())).length,
  1, 'alias is unique: ' + alias);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && /dogleg|minimum-curvature/.test(tool.slug)),
  'no other dogleg or minimum curvature tool exists');
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && (tool.tags || []).some((tag) => /dogleg/.test(tag))),
  'no other tool carries the dogleg tag');
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug &&
  /minimum curvature/i.test((tool.description || '') + ' ' + (tool.method || ''))),
  'no other page computes minimum curvature');

// ---- Page contract.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Dogleg Severity Calculator<\/h1>/);
assert.match(html, /<form id="dls-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label for="/g) || []).length, 7, 'every control is labelled');
assert.equal((html.match(/<input/g) || []).length, 6);
assert.equal((html.match(/<select/g) || []).length, 1);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.equal((html.match(/data-example="/g) || []).length, 3);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function|localStorage|sessionStorage/.test(html),
  'no network calls, no eval, no storage');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored and nothing is sent/i, 'the privacy note stays on the page');
assert.match(html, /min-height:46px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* dogleg-core:start \*\//g) || []).length, 1);
assert.equal((html.match(/\/\* dogleg-core:end \*\//g) || []).length, 1);

const ids = ['dls-form', 'unit', 'md1', 'inc1', 'az1', 'md2', 'inc2', 'az2', 'err', 'out'];
for (const id of ids) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}

console.log('dogleg severity calculator OK: ' + record.testCases.length +
  ' catalog cases, the minimum curvature integration, the published example, unit handling, ' +
  'closure, warnings, refusals, uniqueness and page contract OK');
