/* radar PRF and ambiguity: catalog fixtures, pulse timing arithmetic and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'radar-prf-ambiguity-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* radar-prf-core:start */';
const endMarker = '/* radar-prf-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = RadarPrfCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one radar PRF calculator');
const record = records[0];
assert.equal(record.name, 'Radar PRF & Ambiguity Calculator');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.equal(new Set(record.tags).size, record.tags.length);
assert.equal(new Set(record.aliases).size, record.aliases.length);
assert.ok(record.method.length > 1200, 'method documents the timing arithmetic and the ambiguity trade-off');
assert.match(record.method, /149\.896/);
assert.match(record.method, /c\^2 \/ \(8 f_c\)/);
assert.equal(record.sources.length, 5);
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\/www\.radartutorial\.eu\//, 'every source is a fetched radartutorial page');
  assert.ok(source.title.length > 60, 'source titles say what the page supplies');
}
assert.equal(record.testCases.length, 30);
assert.equal(record.testCases.filter((t) => t.kind === 'golden').length, 9);
assert.equal(record.testCases.filter((t) => t.kind === 'boundary').length, 5);
assert.equal(record.testCases.filter((t) => t.kind === 'validation').length, 16);
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2188, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Communications Engineering').length, 54,
  'Communications Engineering count');
// No other record claims this slug, name, alias or tag.
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name.toLowerCase(), record.name.toLowerCase(), 'name is unique: ' + other.slug);
  for (const alias of record.aliases) {
    assert.ok(!other.aliases.map((a) => a.toLowerCase()).includes(alias.toLowerCase()),
      'alias is unique: ' + alias + ' in ' + other.slug);
  }
}

function failure(input) {
  try { C.analyse(input); } catch (error) { return error.message; }
  return null;
}
function near(actual, expected, label) {
  const tol = Math.max(1e-6, Math.abs(expected) * 1e-8);
  assert.ok(Math.abs(actual - expected) <= tol,
    label + ': expected ' + expected + ', got ' + actual);
}

// Every catalog case replays against the page core.
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.analyse(testCase.input);
  for (const key of Object.keys(testCase.expected)) {
    const expected = testCase.expected[key];
    if (typeof expected === 'boolean') {
      assert.equal(result[key], expected, testCase.name + ': ' + key);
    } else {
      near(result[key], expected, testCase.name + ': ' + key);
    }
  }
}

const LIGHT = 299792458;
const base = C.analyse({});
// Timing identities, derived here rather than read back from the page.
near(base.wavelengthM, LIGHT / 3e9, 'wavelength is c over carrier');
near(base.prtUs, 1000, 'a 1 kHz PRF repeats every millisecond');
near(base.unambiguousRangeM, LIGHT * 1e-3 / 2, 'unambiguous range is c times the interval over two');
near(base.rangeResolutionM, LIGHT * 1e-6 / 2, 'one microsecond resolves 149.9 m');
near(base.blindRangeM, base.rangeResolutionM, 'the blind range equals the resolution for a simple pulse');
near(base.completeEchoRangeM, LIGHT * (1e-3 - 1e-6) / 2, 'the full-echo range drops one pulse length');
near(base.unambiguousVelocityMs, LIGHT * 1000 / (4 * 3e9), 'velocity from the Doppler fold at half the PRF');
near(base.unambiguousVelocityMs, base.wavelengthM * 1000 / 4, 'velocity is lambda times PRF over four');
near(base.firstBlindSpeedMs, 2 * base.unambiguousVelocityMs, 'the first blind speed is twice the unambiguous velocity');
near(base.durationBins * base.duty, 1, 'range bins times duty cycle is one');
near(base.averagePowerW, base.peakPowerKw * 1000 * base.duty, 'average power is peak power times duty cycle');

// The range-velocity product is fixed by the carrier alone.
const closedForm = LIGHT * LIGHT / (8 * 3e9);
near(base.rangeVelocityLimit, closedForm, 'range times velocity is c squared over 8 f');
near(base.rangeVelocityLimit, base.unambiguousRangeM * base.unambiguousVelocityMs, 'product of the two outputs');
const otherCarrier = C.analyse({frequencyGHz: '10', prfHz: '5000', pulseWidthUs: '2'});
near(otherCarrier.rangeVelocityLimit, LIGHT * LIGHT / (8 * 1e10), 'the limit follows the carrier');
assert.ok(otherCarrier.rangeVelocityLimit < base.rangeVelocityLimit, 'a higher carrier lowers the limit');

// Published worked examples from the cited pages: 1 kHz and a 1 microsecond pulse give about 150 km and 150 m.
assert.ok(Math.abs(base.unambiguousRangeM / 1000 - 150) < 0.5, '1 kHz gives the documented ~150 km unambiguous range');
assert.ok(Math.abs(base.blindRangeM - 150) < 0.5, 'a 1 microsecond pulse gives the documented ~150 m blind range');

// Scaling laws hold exactly.
const doubled = C.analyse({prfHz: '2000'});
near(doubled.unambiguousRangeM * 2, base.unambiguousRangeM, 'doubling PRF halves the unambiguous range');
near(doubled.unambiguousVelocityMs, base.unambiguousVelocityMs * 2, 'doubling PRF doubles the velocity');
const coarse = C.analyse({pulseWidthUs: '10'});
near(coarse.rangeResolutionM, base.rangeResolutionM * 10, 'ten times the pulse width coarsens resolution tenfold');
near(coarse.unambiguousRangeM, base.unambiguousRangeM, 'pulse width does not change the unambiguous range');
near(coarse.averagePowerW, base.averagePowerW * 10, 'ten times the pulse width raises average power tenfold');

// Numeric input is accepted beside text, as a Node sweep passes numbers.
near(C.analyse({frequencyGHz: 3, prfHz: 1000, pulseWidthUs: 1, peakPowerKw: 100}).unambiguousRangeM,
  base.unambiguousRangeM, 'numeric input');
// The pulse must fit inside its own interval, and exactly filling it is not allowed.
assert.equal(failure({pulseWidthUs: '1000'}), 'The pulse width must be shorter than the pulse repetition interval.');
assert.equal(failure({prfHz: '2000', pulseWidthUs: '600'}),
  'The pulse width must be shorter than the pulse repetition interval.');
const fills = C.analyse({prfHz: '2000', pulseWidthUs: '499.999'});
assert.ok(fills.durationBins > 1 && fills.durationBins < 1.00001, 'a nearly full interval leaves barely one range bin');

// Page contract: shared shell, keyboard-submittable form, accessible output and no foreign runtime.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html));
assert.ok(!/<script[^>]+src="https?:/i.test(html));
assert.ok(!/<link[^>]+href="https?:/i.test(html));
assert.ok(!/on(?:click|input|change|submit|keydown)=/i.test(html));
assert.ok(!/\beval\s*\(|new\s+Function\b|innerHTML/.test(html));
assert.ok(html.includes('<form id="prf-form" novalidate>'));
assert.ok(html.includes('type="submit"'));
assert.ok(html.includes('type="button" class="ghost" id="reset"'), 'the reset control is not a submit button');
assert.ok(html.includes('aria-live="polite"') && html.includes('role="alert"'));
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'));
assert.ok(html.includes('<div id="site-header"></div>'));
assert.ok(html.includes('<script src="/assets/theme-init.js"></script>'));
assert.equal((html.match(/<h1>/g) || []).length, 1, 'one h1');
for (const id of ['in-frequency', 'in-prf', 'in-pulse', 'in-power']) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
  assert.ok(html.includes('for="' + id + '"'), 'missing label ' + id);
}
for (const id of ['err', 'out', 'reset', 'prf-form']) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}
assert.ok(html.includes('id="in-frequency" inputmode="decimal" autocomplete="off" value="3"'));
assert.ok(html.includes('id="in-prf" inputmode="decimal" autocomplete="off" value="1000"'));
assert.ok(html.includes('id="in-pulse" inputmode="decimal" autocomplete="off" value="1"'));
assert.ok(html.includes('id="in-power" inputmode="decimal" autocomplete="off" value="100"'));
console.log('radar-prf-ambiguity-calculator: 30 catalog cases, timing identities, scaling laws and page contract passed');
