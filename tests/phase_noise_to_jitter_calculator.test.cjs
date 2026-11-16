/* Phase noise to RMS jitter: catalog fixtures, the published anchors, an independent numerical
   integration, and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'phase-noise-to-jitter-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* phase-noise-core:start */';
const endMarker = '/* phase-noise-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = PhaseNoiseCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one phase-noise jitter record');
const record = records[0];
assert.equal(record.name, 'Phase Noise to RMS Jitter Calculator');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.method.length > 900, 'method documents the model, the band rules and the exclusions');
assert.equal(record.sources.length, 3);
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'source uses https');
  assert.ok(source.title.length > 60, 'source title names the document and the part used');
}
assert.equal(record.testCases.length, 18);
assert.equal(record.testCases.filter((test) => test.kind === 'golden').length, 8);
assert.equal(record.testCases.filter((test) => test.kind === 'boundary').length, 4);
assert.equal(record.testCases.filter((test) => test.kind === 'validation').length, 6);
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name, record.name, 'name collides with ' + other.slug);
  for (const alias of record.aliases) {
    assert.ok(!(other.aliases || []).includes(alias), 'alias collides with ' + other.slug + ': ' + alias);
  }
}

const closeTo = (actual, expected, relative, label) => {
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * relative + 1e-12,
    label + ': got ' + actual + ', expected ' + expected);
};

// Replay every published case.
function failure(input) {
  try { C.analyze(input); } catch (error) { return error.message; }
  return null;
}
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.analyze(testCase.input);
  const expected = testCase.expected;
  closeTo(result.rmsJitterSeconds * 1e12, expected.jitterPs, 2e-3, testCase.name + ': jitter');
  closeTo(result.rmsPhaseDeg, expected.phaseDeg, 2e-3, testCase.name + ': phase error');
  closeTo(result.integratedDbc, expected.integratedDbc, 2e-4, testCase.name + ': integrated phase noise');
  assert.equal(result.segments.length, expected.segments, testCase.name + ': segment count');
  closeTo(result.segments[result.dominantIndex].share * 100, expected.dominantShare, 2e-3, testCase.name + ': dominant share');
  const shareSum = result.segments.reduce((total, segment) => total + segment.share, 0);
  closeTo(shareSum, 1, 1e-9, testCase.name + ': the shares add up');
  assert.ok(result.rmsJitterSeconds > 0 && Number.isFinite(result.rmsJitterSeconds), testCase.name + ': finite jitter');
}

// Published anchor 1: the flat -150 dBc/Hz floor worked through the Analog Devices MT-008 tutorial
// integrates to -67 dBc over 10 kHz-200 MHz and lands at about 1 ps on a 100 MHz carrier.
const mt008 = C.analyze({carrierMHz: 100, points: '10000, -150\n200000000, -150', bandFrom: 10000, bandTo: 200000000});
closeTo(mt008.integratedDbc, -67.0, 2e-3, 'MT-008: integrated phase noise is -67 dBc');
closeTo(mt008.rmsJitterSeconds * 1e12, 1.0, 1.5e-2, 'MT-008: about 1 ps RMS');
// The same step from the published numbers: sqrt(2 x 1e-15 x 2e8) / (2 pi 1e8).
closeTo(mt008.rmsJitterSeconds,
  Math.sqrt(2 * 1e-15 * (2e8 - 1e4)) / (2 * Math.PI * 1e8), 1e-9, 'MT-008: closed form agrees');

// Published anchor 2: Skyworks AN279 reports -54.46 dBc of integrated phase noise as 2.663 ps on a
// 160 MHz carrier. A flat curve tuned to that power must reproduce the published jitter.
const an279Level = 10 * Math.log10(Math.pow(10, -54.46 / 10) / (160e6 - 10));
const an279 = C.analyze({carrierMHz: 160, points: '10, ' + an279Level + '\n160000000, ' + an279Level, bandFrom: 10, bandTo: 160e6});
closeTo(an279.integratedDbc, -54.46, 1e-4, 'AN279: integrated phase noise matches');
closeTo(an279.rmsJitterSeconds * 1e12, 2.663, 3e-3, 'AN279: 2.663 ps RMS');
closeTo(an279.rmsPhaseRad, 0.00268, 3e-3, 'AN279: 0.00268 rad');

// An independent numerical integration: midpoint rule in log-frequency on the same piecewise
// model. It shares no closed form with the page.
const CURVES = [
  ['10, -75\n100, -105\n1000, -133\n10000, -145\n100000, -150\n1000000, -153\n20000000, -155', 12000, 20000000],
  ['1000, -140\n1000000, -120', 1000, 1e6],
  ['100, -70\n1000000, -170', 100, 1e6],
  ['1000, -100\n1000000, -130', 1000, 1e6],
  ['10, -60\n100000000, -170', 10, 1e8]
];
function midpointArea(levels, from, to, steps) {
  const lower = Math.log(from);
  const upper = Math.log(to);
  const step = (upper - lower) / steps;
  let total = 0;
  for (let index = 0; index < steps; index += 1) {
    const middle = lower + (index + 0.5) * step;
    const frequency = Math.exp(middle);
    // Interpolate the same log-log line the page claims, straight from the two nearest points.
    let left = levels[0];
    let right = levels[levels.length - 1];
    for (let i = 1; i < levels.length; i += 1) {
      if (frequency <= levels[i][0]) { left = levels[i - 1]; right = levels[i]; break; }
    }
    const t = (middle - Math.log(left[0])) / (Math.log(right[0]) - Math.log(left[0]));
    const level = left[1] + t * (right[1] - left[1]);
    const width = Math.exp(middle + step / 2) - Math.exp(middle - step / 2);
    total += Math.pow(10, level / 10) * width;
  }
  return total;
}
let comparisons = 0;
for (const [text, from, to] of CURVES) {
  const levels = C.parsePoints(text).map((point) => [point.offset, point.level]);
  const report = C.analyze({carrierMHz: 100, points: text, bandFrom: from, bandTo: to});
  const exact = Math.pow(10, report.integratedDbc / 10);
  const numeric = midpointArea(levels, from, to, 40000);
  closeTo(numeric, exact, 1e-6, 'midpoint rule agrees for ' + levels.length + ' points over ' + from + '-' + to);
  comparisons += 1;
}
assert.ok(comparisons >= 5);

// Segment areas must add up to the whole band, and a perfectly flat curve must equal L + 10 log10(bw).
const flat = C.analyze({carrierMHz: 100, points: '1000, -120\n1000000, -120', bandFrom: 2000, bandTo: 8000});
closeTo(flat.integratedDbc, -120 + 10 * Math.log10(6000), 1e-9, 'flat curve: L + 10 log10(bandwidth)');
const partSum = flat.segments.reduce((total, segment) => total + segment.area, 0);
closeTo(partSum, Math.pow(10, flat.integratedDbc / 10), 1e-12, 'segment areas add up');

// Doubling the carrier halves the jitter, because the same phase error spans less time.
const slow = C.analyze({carrierMHz: 100, points: '1000, -120\n1000000, -140', bandFrom: 1000, bandTo: 1e6});
const fast = C.analyze({carrierMHz: 200, points: '1000, -120\n1000000, -140', bandFrom: 1000, bandTo: 1e6});
closeTo(slow.rmsJitterSeconds / fast.rmsJitterSeconds, 2, 1e-12, 'jitter is inversely proportional to the carrier');
closeTo(slow.rmsPhaseRad, fast.rmsPhaseRad, 1e-12, 'phase error does not depend on the carrier');

// Refusals that are not catalog cases.
assert.throws(() => C.analyze({carrierMHz: 100, points: 'x\n1000, -120', bandFrom: 1, bandTo: 2}), /Line 1/);
assert.throws(() => C.analyze({carrierMHz: 100, points: '-1000, -120\n10000, -130', bandFrom: 1, bandTo: 2}), /positive frequency/);
assert.throws(() => C.analyze({carrierMHz: 100, points: '1000, -400\n10000, -130', bandFrom: 1000, bandTo: 10000}), /-250 and 30/);
assert.throws(() => C.analyze({carrierMHz: 100, points: '1000, -120\n10000, -130', bandFrom: 2000, bandTo: 20000}), /inside the entered offsets/);
assert.throws(() => C.analyze({carrierMHz: '', points: '1000, -120\n10000, -130', bandFrom: 1000, bandTo: 10000}), /carrier frequency/);
assert.throws(() => C.analyze({carrierMHz: 100, points: '1000, -120\n10000, -130', bandFrom: '', bandTo: 1000}), /band limits/);

// Page contract: shared shell, keyboard-submittable form, accessible output, no foreign runtime.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html));
assert.ok(!/<script[^>]+src="https?:/i.test(html));
assert.ok(!/<link[^>]+href="https?:/i.test(html));
assert.ok(!/on(?:click|input|change|submit)=/i.test(html));
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html));
assert.ok(html.includes('<form id="pn-form" novalidate>'));
assert.ok(html.includes('type="submit"'));
assert.ok(html.includes('role="alert"'));
assert.ok(html.includes('role="status" aria-live="polite"'));
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.equal((html.match(/<h1>/g) || []).length, 1);
for (const id of html.matchAll(/\bid="([a-z0-9-]+)"/g)) {
  assert.equal((html.match(new RegExp('id="' + id[1] + '"', 'g')) || []).length, 1, 'duplicate id ' + id[1]);
}
for (const match of html.matchAll(/\$\('([a-z0-9-]+)'\)/g)) assert.ok(html.includes('id="' + match[1] + '"'), 'missing id ' + match[1]);
for (const id of ['pn-carrier', 'pn-from', 'pn-to', 'pn-points']) assert.ok(html.includes('for="' + id + '"'), 'missing label ' + id);
assert.ok(html.includes('data-label'), 'stacked cells keep their header label');
assert.ok(html.includes('id="pn-carrier" type="text" inputmode="decimal" value="100"'), 'the carrier is prefilled');
assert.ok(html.includes('id="pn-points"'), 'the points field exists');
assert.ok(!/back\b[^>]*href/i.test(html), 'the shared shell owns navigation');
console.log('phase-noise-to-jitter-calculator: 18 catalog cases, 2 published anchors, ' + comparisons +
  ' numerical integrations and the page contract passed');
