/* Branch-line coupler designer: the quarter-wave design identities, the
   scattering response of the ideal ring (unitarity, mirror symmetry, the
   20 dB bandwidth), the warnings, the refusals, the catalog cases and the
   page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'branch-line-coupler-designer';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* branch-line-core:start */';
const endMarker = '/* branch-line-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = BranchLineCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');

const base = { z0: '50', frequency: '2450', velocityFactor: '0.66', analysis: '' };
const run = (overrides) => C.calculate(Object.assign({}, base, overrides || {}));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};

// ---- The quarter-wave design identities.
for (const z0 of [5, 12.5, 25, 50, 75, 93, 300, 1000]) {
  const result = run({ z0: String(z0) });
  assert.equal(result.zShunt, Math.round(z0 * 1000) / 1000, 'the shunt arms are Z0');
  assert.equal(result.zSeries, Math.round(z0 / Math.SQRT2 * 1000) / 1000, 'the series arms are Z0 / sqrt(2)');
}
for (const [frequency, velocityFactor] of [[100, 0.66], [915, 0.78], [2450, 0.66], [5800, 0.5], [24000, 1]]) {
  const result = run({ frequency: String(frequency), velocityFactor: String(velocityFactor) });
  const guided = 299792.458 * velocityFactor / frequency;
  assert.ok(Math.abs(result.guidedWavelength - guided) < 0.0015, 'lambda_g = c vf / f');
  assert.ok(Math.abs(result.armLength - guided / 4) < 0.0006, 'the arm is a quarter of lambda_g');
}

// ---- At the design point the ideal hybrid is matched, splits equally and is
//      in quadrature with port 4 isolated.
const design = run();
assert.equal(design.zSeries, 35.355);
assert.equal(design.guidedWavelength, 80.76);
assert.equal(design.armLength, 20.19);
assert.equal(design.through, -3.01);
assert.equal(design.coupled, -3.01);
assert.equal(design.returnLoss, 60);
assert.equal(design.isolation, 60);
assert.equal(design.phase, 90);
assert.equal(design.headline, '20.19 mm');
assert.equal(design.summary, '35.355 \u03A9 series, 50 \u03A9 shunt at 2450 MHz, 0.66 velocity factor.');
assert.equal(design.warnings.length, 0);

const perfect = C.response(50, 50 / Math.SQRT2, 50, 90);
assert.ok(Math.abs(perfect.through + 3.010299956639812) < 1e-9, 'through is -3.0103 dB');
assert.ok(Math.abs(perfect.coupled + 3.010299956639812) < 1e-9, 'coupled is -3.0103 dB');
assert.ok(perfect.returnLoss > 200, 'the input is matched');
assert.ok(perfect.isolation > 200, 'port 4 is isolated');
assert.ok(Math.abs(perfect.phase - 90) < 1e-9, 'the coupled port is 90 degrees behind');

// ---- The ring is lossless and mirror-symmetric about the design frequency.
let swept = 0;
for (const z0 of [10, 50, 75, 300]) {
  const zSeries = z0 / Math.SQRT2;
  for (let theta = 15; theta <= 165; theta += 0.5) {
    const here = C.response(z0, zSeries, z0, theta);
    assert.ok(Math.abs(here.power - 1) < 1e-9, 'unitary at theta ' + theta);
    assert.ok(here.phase >= 0 && here.phase <= 180, 'the phase difference is reported as an angle');
    const mirror = C.response(z0, zSeries, z0, 180 - theta);
    assert.ok(Math.abs(here.through - mirror.through) < 1e-9, 'through mirrors about the design point');
    assert.ok(Math.abs(here.coupled - mirror.coupled) < 1e-9, 'coupled mirrors about the design point');
    assert.ok(Math.abs(here.returnLoss - mirror.returnLoss) < 1e-9, 'return loss mirrors');
    assert.ok(Math.abs(here.isolation - mirror.isolation) < 1e-9, 'isolation mirrors');
    swept += 1;
  }
}

// ---- The reported 20 dB band really is where both criteria hold.
for (const z0 of [25, 50, 100]) {
  const result = run({ z0: String(z0) });
  const inside = result.bandPercent / 100 * 90 * 0.45;
  const outside = result.bandPercent / 100 * 90 * 0.55;
  assert.ok(C.response(z0, z0 / Math.SQRT2, z0, 90 - inside).returnLoss >= 20, 'inside the low edge');
  assert.ok(C.response(z0, z0 / Math.SQRT2, z0, 90 + inside).returnLoss >= 20, 'inside the high edge');
  assert.ok(C.response(z0, z0 / Math.SQRT2, z0, 90 - outside).returnLoss < 20, 'just outside the low edge');
  assert.ok(C.response(z0, z0 / Math.SQRT2, z0, 90 + outside).returnLoss < 20, 'just outside the high edge');
  assert.ok(Math.abs(result.bandMHz / Number(base.frequency) * 100 - result.bandPercent) < 0.005,
    'the bandwidth in MHz follows the percentage');
}
assert.equal(run().bandPercent, 10.496, 'the 20 dB bandwidth of a single-section hybrid is about ten percent');

// ---- A frequency offset always costs match and isolation.
assert.ok(run({ analysis: '2400' }).returnLoss < run().returnLoss);
assert.ok(run({ analysis: '2500' }).returnLoss < run().returnLoss);
assert.ok(run({ analysis: '2000' }).isolation < run().isolation);
assert.ok(Math.abs(run({ analysis: '2200' }).through - run({ analysis: '2700' }).through) < 1e-9,
  'the response is symmetric about the design frequency');
assert.ok(run({ analysis: '2000' }).phase < 90 && run({ analysis: '3000' }).phase > 90,
  'the quadrature angle leans either side of ninety degrees away from the design point');
assert.ok(Math.abs((90 - run({ analysis: '2200' }).phase) - (run({ analysis: '2700' }).phase - 90)) < 1e-6,
  'the phase deviation mirrors about the design frequency');

// ---- Warning thresholds sit where the page says they do.
const only = (text) => text.indexOf('return loss') > -1;
assert.equal(run().warnings.length, 0);
assert.equal(run({ analysis: '2000' }).warnings.filter(only).length, 1);
assert.equal(run({ analysis: '2400' }).warnings.length, 0);
assert.equal(run({ z0: '1000' }).warnings.filter((text) => text.indexOf('shunt arm') > -1).length, 1);
assert.equal(run({ z0: '120' }).warnings.filter((text) => text.indexOf('shunt arm') > -1).length, 0);
assert.equal(run({ z0: '25' }).warnings.filter((text) => text.indexOf('series arm') > -1).length, 1);
assert.equal(run({ z0: '30' }).warnings.filter((text) => text.indexOf('series arm') > -1).length, 0);
assert.equal(run({ frequency: '40000', velocityFactor: '0.3' }).warnings
  .filter((text) => text.indexOf('mm long') > -1).length, 1);
assert.equal(run({ frequency: '1000', velocityFactor: '0.3' }).warnings
  .filter((text) => text.indexOf('mm long') > -1).length, 0);

// ---- Numeric strings behave like numbers, and the analysis field is optional.
const strings = C.calculate({ z0: '50', frequency: '2450', velocityFactor: '0.66', analysis: '2450' });
assert.equal(strings.through, design.through);
assert.equal(strings.returnLoss, design.returnLoss);
assert.equal(C.calculate({ z0: 50, frequency: 2450, velocityFactor: 0.66 }).phase, 90);

// ---- Refusals.
assert.equal(failure({ z0: '' }), 'The system impedance must be a number in ohms.');
assert.equal(failure({ z0: '50 ohms' }), 'The system impedance must be a number in ohms.');
assert.equal(failure({ z0: '4' }), 'The system impedance must be between 5 and 1000 ohms.');
assert.equal(failure({ z0: '1001' }), 'The system impedance must be between 5 and 1000 ohms.');
assert.equal(failure({ frequency: '0' }), 'The design frequency must be between 0.1 and 40000 MHz.');
assert.equal(failure({ frequency: '40001' }), 'The design frequency must be between 0.1 and 40000 MHz.');
assert.equal(failure({ frequency: '' }), 'The design frequency must be a number in MHz.');
assert.equal(failure({ velocityFactor: '0.2' }), 'The velocity factor must be between 0.3 and 1.');
assert.equal(failure({ velocityFactor: 'fast' }), 'The velocity factor must be a number.');
assert.equal(failure({ analysis: 'abc' }), 'The analysis frequency must be a number in MHz.');
assert.equal(failure({ analysis: '5000' }),
  'The analysis frequency must be between 0.2 and 1.8 times the design frequency.');
assert.equal(failure({ analysis: '400' }),
  'The analysis frequency must be between 0.2 and 1.8 times the design frequency.');
const nothing = (value) => {
  try {
    C.calculate(value);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};
assert.equal(nothing(null), 'Nothing to design.');
assert.equal(nothing('50 ohms'), 'Nothing to design.');
assert.equal(C.MIN_Z0, 5);
assert.equal(C.MAX_Z0, 1000);
assert.equal(C.MIN_RATIO, 0.2);
assert.equal(C.MAX_RATIO, 1.8);

// ---- Catalog record: counts, cases and metadata.
assert.equal(catalog.tools.length, 2444, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2183, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Communications Engineering').length, 54,
  'Communications Engineering count');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.length > 600);
assert.equal(record.sources.length, 3);
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'every source has a fetched https url');
  assert.ok(source.title.length > 40, 'the citation keeps its wording');
}
assert.ok(record.tags.includes('communications-engineering'));
assert.equal(record.tags.length, new Set(record.tags).size, 'tags are internally unique');

const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 6, validation: 7 });

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
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug &&
  /branch.?line|quadrature.?hybrid/.test(tool.slug)), 'no other branch-line tool exists');

// ---- Page contract.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Branch-Line Coupler Designer<\/h1>/);
assert.match(html, /<form id="coupler-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label for="/g) || []).length, 4, 'every control is labelled');
assert.equal((html.match(/<input/g) || []).length, 4);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.equal((html.match(/data-example="/g) || []).length, 2);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function|localStorage|sessionStorage/.test(html),
  'no network calls, no eval, no storage');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored and nothing is sent/i, 'the privacy note stays on the page');
assert.match(html, /min-height:46px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* branch-line-core:start \*\//g) || []).length, 1);
assert.equal((html.match(/\/\* branch-line-core:end \*\//g) || []).length, 1);

// Every id the script reaches for exists in the markup.
const ids = ['coupler-form', 'z0', 'frequency', 'velocityFactor', 'analysis', 'err', 'out'];
for (const id of ids) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}

console.log('branch-line coupler designer OK: ' + swept + ' unitarity sweeps, the quarter-wave identities, ' +
  'the 20 dB bandwidth, mirror symmetry, ' + record.testCases.length +
  ' catalog cases, warnings, refusals, uniqueness and page contract OK');
