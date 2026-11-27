/* Audio samples per frame: an independent Python model (exact Fractions plus a
   remainder accumulator) as the oracle, the published whole-sample ratios, the
   identities that follow from sample rate / frame rate, the catalog cases and
   the page contract. No expected number comes from the page. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'audio-samples-per-frame-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* asf-core:start */';
const endMarker = '/* asf-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = AudioFrameCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, relative) => {
  const rel = relative === undefined ? 1e-9 : relative;
  assert.ok(Number.isFinite(actual), label + ': ' + actual + ' is not a finite number');
  assert.ok(Math.abs(actual - expected) <= rel * Math.max(1, Math.abs(expected)),
    label + ': ' + actual + ' is not within ' + rel + ' of ' + expected);
};
const failure = (input) => {
  try { C.analyze(input); } catch (error) { return error.message; }
  return null;
};
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const base = { fps: '29.97', rate: '48000', frame: '1000' };

// ---- Constants: the ten time bases and the four sample rates the page offers.
assert.equal(C.RATES.length, 10);
assert.deepEqual(Array.from(C.RATES, (rate) => rate.key),
  ['23.976', '24', '25', '29.97', '30', '47.952', '48', '50', '59.94', '60']);
assert.deepEqual(Array.from(C.RATES, (rate) => rate.num + '/' + rate.den),
  ['24000/1001', '24/1', '25/1', '30000/1001', '30/1', '48000/1001', '48/1', '50/1', '60000/1001', '60/1']);
assert.deepEqual(Array.from(C.SAMPLE_RATES), [44100, 48000, 88200, 96000]);
assert.equal(C.MAX_FRAME, 10000000);
assert.equal(C.CADENCE_ROWS, 12);
assert.deepEqual(Object.keys(C.MESSAGES).sort(), ['fps', 'frame', 'frameMax', 'rate']);

// ---- Published whole-sample ratios: every one divides evenly.
assert.equal(C.analyze({ fps: '25', rate: '48000', frame: 0 }).exactPerFrame, 1920);
assert.equal(C.analyze({ fps: '24', rate: '48000', frame: 0 }).exactPerFrame, 2000);
assert.equal(C.analyze({ fps: '25', rate: '44100', frame: 0 }).exactPerFrame, 1764);
assert.equal(C.analyze({ fps: '30', rate: '48000', frame: 0 }).exactPerFrame, 1600);
assert.equal(C.analyze({ fps: '60', rate: '96000', frame: 0 }).exactPerFrame, 1600);
assert.equal(C.analyze({ fps: '23.976', rate: '48000', frame: 0 }).fraction, '2002/1');
assert.equal(C.analyze({ fps: '29.97', rate: '48000', frame: 0 }).fraction, '8008/5');
assert.equal(C.analyze({ fps: '29.97', rate: '48000', frame: 0 }).exactPerFrame, 1601.6);

// ---- Exactness and cycle identities across every combination.
for (const spec of C.RATES) {
  for (const rate of C.SAMPLE_RATES) {
    const result = C.analyze({ fps: spec.key, rate: String(rate), frame: 0 });
    const p = result.samples;
    const q = result.frames;
    assert.ok(Number.isInteger(p) && Number.isInteger(q) && q > 0, spec.key + ' ' + rate + ': cycle is not whole');
    assert.equal(gcd(p, q), 1, spec.key + ' ' + rate + ': the fraction is not reduced');
    near(result.exactPerFrame, p / q, spec.key + ' ' + rate + ' per frame');
    near(result.exactPerFrame, rate * spec.den / spec.num, spec.key + ' ' + rate + ' definition');
    // A whole cycle closes exactly on a sample boundary.
    assert.equal(C.boundary(q, p, q), p, spec.key + ' ' + rate + ': cycle does not close');
    // Frame boundaries are monotonic, spaced by the floor or the ceiling only.
    let previous = C.boundary(0, p, q);
    for (let i = 1; i <= q; i++) {
      const point = C.boundary(i, p, q);
      const step = point - previous;
      assert.ok(step === result.low || step === result.high, spec.key + ' ' + rate + ': step ' + step);
      assert.ok(Math.abs(point - i * p / q) < 1, spec.key + ' ' + rate + ': boundary ' + i + ' drifts');
      previous = point;
    }
    // The counts a cycle is made of add up, and only two sizes occur.
    assert.equal(result.lowCount + result.highCount, q, spec.key + ' ' + rate + ': count split');
    if (result.whole) {
      assert.equal(result.low, result.high);
      assert.equal(result.highCount, 0);
      assert.equal(result.driftSamples, 0);
    } else {
      assert.equal(result.high, result.low + 1);
      assert.equal(result.lowCount * result.low + result.highCount * result.high, p,
        spec.key + ' ' + rate + ': counts do not sum to the cycle');
      assert.equal(result.driftPerCycle, q * result.low - p);
    }
  }
}

// ---- The independent Python fixture: 520 vectors over every rate pair.
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/audio_samples_per_frame_vectors.json'), 'utf8'));
assert.equal(fixture.vectors.length, 520, 'vector count');
const FLOAT_KEYS = new Set(['exactPerFrame', 'frameSeconds', 'driftMs']);
for (const vector of fixture.vectors) {
  const got = C.analyze(vector.input);
  for (const [key, want] of Object.entries(vector.expected)) {
    const label = vector.name + ' ' + key;
    if (typeof want === 'number' && FLOAT_KEYS.has(key)) {
      near(got[key], want, label, 1e-6);
    } else if (Array.isArray(want)) {
      assert.equal(got[key].length, want.length, label + ' length');
      want.forEach((value, index) => assert.equal(got[key][index], value, label + '[' + index + ']'));
    } else if (typeof want === 'boolean') {
      assert.equal(got[key], want, label);
    } else {
      assert.equal(got[key], want, label);
    }
  }
  assert.equal(got.driftSamples, got.frame * got.fixedSamples - got.startSample, vector.name + ' drift');
}

// ---- Input handling: strings from the page, numbers from a harness.
assert.equal(C.analyze({ fps: 29.97, rate: 48000, frame: 1000 }).startSample, 1601600);
assert.equal(C.analyze({ fps: '29.97', rate: '48000', frame: '1,000' }).startSample, 1601600);
assert.equal(C.analyze({ fps: ' 25 ', rate: ' 48000 ', frame: ' 7 ' }).startSample, 13440);
assert.equal(failure({ fps: '23.98', rate: '48000', frame: '0' }), 'Choose a frame rate from the list.');
assert.equal(failure({ fps: '29.97', rate: '32000', frame: '0' }), 'Choose a sample rate from the list.');
assert.equal(failure({ fps: '29.97', rate: '48000', frame: '' }), 'Enter a whole frame number of 0 or more.');
assert.equal(failure({ fps: '29.97', rate: '48000', frame: '1.5' }), 'Enter a whole frame number of 0 or more.');
assert.equal(failure({ fps: '29.97', rate: '48000', frame: '-1' }), 'Enter a whole frame number of 0 or more.');
assert.equal(failure({ fps: '29.97', rate: '48000', frame: '10000001' }),
  'The frame number must be 10,000,000 or less.');

// ---- The catalog cases, replayed through the documented input shape.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Audio Samples per Frame Calculator');
assert.equal(entry.category, 'Video');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(entry.icon, '\u{1F3AC}');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 800, 'method must document the model, the limits and what it leaves out');
assert.equal(entry.sources.length, 1);
assert.equal(entry.sources[0].url, 'https://en.wikipedia.org/wiki/NTSC');
assert.equal(entry.testCases.length, 18, 'catalog case count');
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'golden').length, 8);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'boundary').length, 4);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'validation').length, 6);

const compare = (label, actual, expected) => {
  if (expected === null || typeof expected === 'string' || typeof expected === 'boolean') {
    assert.equal(actual, expected, label);
    return;
  }
  if (typeof expected === 'number') {
    near(actual, expected, label, 1e-9);
    return;
  }
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, label + ' length');
    expected.forEach((value, index) => compare(label + '[' + index + ']', actual[index], value));
    return;
  }
  for (const [key, value] of Object.entries(expected)) compare(label + ' ' + key, actual[key], value);
};

for (const testCase of entry.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  compare(testCase.name, C.analyze(testCase.input), testCase.expected);
}

// ---- Page contract: shared shell, accessible controls, no runtime foreign APIs.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html),
  'network or storage API found');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'remote script');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'remote stylesheet');
assert.ok(!/on(?:click|input|change|submit)=/i.test(html), 'inline handler');
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html), 'unsafe script evaluation');
const inlineScripts = Array.from(html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
  (match) => match[1]);
assert.equal(inlineScripts.length, 1, 'one inline script');
for (const script of inlineScripts) {
  assert.ok(!/[^\x00-\x7F]/.test(script), 'the inline script stays ASCII so the CSP hash is stable');
}
assert.ok(html.includes('<form id="asf-form" novalidate>'), 'form missing');
assert.ok(html.includes('type="submit"') && html.includes('type="button"'), 'buttons missing');
assert.ok(html.includes('role="alert"'), 'error announcement missing');
assert.ok(html.includes('aria-live="polite" aria-atomic="true"'), 'result region missing');
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'), 'shared shell assets missing');
for (const id of ['fps', 'rate', 'frame']) {
  assert.ok(html.includes('for="' + id + '"'), 'missing label for ' + id);
  assert.ok(html.includes('id="' + id + '"'), 'missing control ' + id);
}
for (const id of ['asf-form', 'asf-err', 'asf-out', 'submit', 'reset', 'cadence-body', 'cadence-caption',
  'cadence-table', 'method', 'frame-help']) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}
assert.ok(html.includes('min-height:44px'), 'controls must stay at a 44 px touch target');
assert.ok(html.includes('focus-visible'), 'keyboard focus ring missing');
assert.ok(/table\{width:100%;display:table/.test(html), 'the results table must span its panel');
assert.ok(/@media \(max-width:520px\)/.test(html), 'narrow-screen rule missing');
assert.ok(/thead\{display:none\}/.test(html), 'the stacked table must hide its header row');
assert.ok(/caption\{display:block;width:100%/.test(html), 'the caption needs a full width when stacked');
assert.ok(/content:attr\(data-label\) ":"/.test(html), 'stacked cells need their data labels');
assert.ok(html.includes('setAttribute("data-label"'), 'the table body must write data labels');
assert.ok(!/style="[^"]*width:\s*\d{3,}px/.test(html), 'fixed wide inline styles');
const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate element ids: ' +
  ids.filter((id, index) => ids.indexOf(id) !== index).join(','));

assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2242, 'public total');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Video').length, 56, 'Video count');

console.log(slug + ': 18 catalog cases, ' + fixture.vectors.length + ' reference vectors, published ratios, ' +
  'cycle identities and page contracts passed');
