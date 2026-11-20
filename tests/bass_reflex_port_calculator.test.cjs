/* Bass reflex port tuning: the Helmholtz model against a Decimal reference, the
   catalog cases, the identities that follow from the resonance condition, and
   the page contract. No expected number comes from the page. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'bass-reflex-port-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* portcalc-core:start */';
const endMarker = '/* portcalc-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = PortCore;', sandbox);
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
const base = { mode: 'tuning', volume: '50', diameter: '7.5', ports: '1', length: '15', frequency: '' };
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/bass_reflex_vectors.json'), 'utf8'));

// ---- The constants the model turns on.
assert.equal(C.SPEED, 343);
assert.equal(C.END_FACTOR, 0.3);
assert.equal(JSON.stringify(C.LIMITS.volume), JSON.stringify([2, 500]));
assert.equal(JSON.stringify(C.LIMITS.diameter), JSON.stringify([2, 40]));
assert.equal(JSON.stringify(C.LIMITS.ports), JSON.stringify([1, 8]));
assert.equal(JSON.stringify(C.LIMITS.length), JSON.stringify([2, 120]));
assert.equal(JSON.stringify(C.LIMITS.frequency), JSON.stringify([10, 150]));

// ---- The independent reference, 133 vectors in both directions.
for (const vector of fixture.vectors) {
  const result = C.analyze(vector.input);
  for (const [key, expected] of Object.entries(vector.expected)) {
    if (typeof expected === 'number') near(result[key], expected, vector.name + ' ' + key);
    else assert.equal(JSON.stringify(result[key]), JSON.stringify(expected), vector.name + ' ' + key);
  }
}

// ---- The catalog record, and the cases it stores.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Bass Reflex Port Calculator');
assert.equal(entry.category, 'Audio');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(entry.icon, '\u{1F508}');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 1200, 'method must document the model, the limits and the allowances');
assert.equal(entry.sources.length, 2, 'two cited sources');
assert.ok(entry.sources[0].url.startsWith('https://en.wikipedia.org/wiki/Helmholtz_resonance'), 'Helmholtz source');
assert.ok(entry.sources[1].url.startsWith('https://en.wikipedia.org/wiki/Loudspeaker_enclosure'), 'enclosure source');
assert.equal(entry.testCases.length, 29, 'catalog case count');
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'golden').length, 9);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'boundary').length, 4);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'validation').length, 16);
assert.equal(JSON.stringify(entry.testCases), JSON.stringify(fixture.cases), 'the catalog cases are the fixture cases');

for (const testCase of entry.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.analyze(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') near(result[key], expected, testCase.name + ' ' + key);
    else assert.equal(JSON.stringify(result[key]), JSON.stringify(expected), testCase.name + ' ' + key);
  }
}

// ---- Identities that follow from the Helmholtz condition.
const r = C.analyze(base);
const areaM2 = r.areaTotal / 1e4;
const volumeM3 = r.volume / 1000;
const effectiveM = r.effectiveLength / 100;
near(r.frequency, C.SPEED / (2 * Math.PI) * Math.sqrt(areaM2 / (volumeM3 * effectiveM)),
  'the tuning is the Helmholtz resonance of the tube on the box', 1e-12);
near(r.effectiveLength, r.length + r.endCorrection, 'the effective length adds the end correction', 1e-12);
near(r.endCorrection, C.END_FACTOR * r.diameter, 'the end correction is 0.3 diameters', 1e-12);
near(r.areaTotal, r.areaPerPort * r.ports, 'the ports add their areas', 1e-12);
near(r.areaPerPort, Math.PI * Math.pow(r.diameter / 2, 2), 'a port is a circle in square centimetres', 1e-12);
near(r.areaPerLitre, r.areaTotal / r.volume, 'area per litre is the total area over the volume', 1e-12);
near(Math.pow(r.boxSide, 3), r.volume * 1000, 'the reported cube holds the box volume', 1e-12);
assert.equal(r.fits, r.length <= r.boxSide);
near(r.frequency, 39.0698, 'the default box tunes at 39.07 Hz', 1e-4);
near(r.length, 15, 'the default port is the length that was entered', 1e-12);
assert.equal(r.mode, 'tuning');
assert.equal(r.warnings.length, 0, 'the default box has nothing to warn about');

// The inverse direction returns the length that produces the tuning it was given.
for (const [volume, diameter, ports, frequency] of [
  ['50', '7.5', 1, '35'], ['120', '10', 2, '30'], ['20', '10', 1, '150'], ['300', '12', 1, '10'],
]) {
  const solved = C.analyze({ mode: 'length', volume, diameter, ports: String(ports), length: '', frequency });
  near(solved.frequency, Number(frequency), 'the asked-for tuning is reported back', 1e-12);
  const forward = C.analyze({ mode: 'tuning', volume, diameter, ports: String(ports),
    length: solved.length.toFixed(6), frequency: '' });
  near(forward.frequency, Number(frequency), 'the solved length tunes the box to the target', 1e-6);
}

// Doubling the tube length divides the tuning by the square root of the effective lengths.
const longer = C.analyze({ ...base, length: '30' });
near(longer.frequency, r.frequency * Math.sqrt(r.effectiveLength / longer.effectiveLength),
  'the tuning falls as the square root of the effective length', 1e-12);
// Halving the box at a fixed tuning needs a longer tube.
const smaller = C.analyze({ mode: 'length', volume: '25', diameter: '7.5', ports: '1', length: '', frequency: '35' });
const reference = C.analyze({ mode: 'length', volume: '50', diameter: '7.5', ports: '1', length: '', frequency: '35' });
assert.ok(smaller.length > reference.length, 'a smaller box needs a longer port for the same tuning');
// Two ports of the same size raise the tuning by root two at the same length.
const twin = C.analyze({ ...base, ports: '2' });
near(twin.frequency, r.frequency * Math.sqrt(2), 'two identical ports raise the tuning by root two at the same length', 1e-12);
near(twin.areaTotal, 2 * r.areaTotal, 'two ports double the area', 1e-12);
// A tube longer than the cube root of the volume is flagged and the verdict flips.
const tall = C.analyze({ ...base, length: '60' });
assert.equal(tall.fits, false);
assert.equal(tall.warnings.length, 1);
assert.ok(tall.warnings[0].startsWith('The port is longer than a cube of this box volume'));
const low = C.analyze({ mode: 'length', volume: '300', diameter: '12', ports: '1', length: '', frequency: '10' });
assert.ok(low.warnings.some((line) => line.startsWith('Tuning below 20 Hz')));
const high = C.analyze({ mode: 'length', volume: '20', diameter: '10', ports: '1', length: '', frequency: '150' });
assert.ok(high.warnings.some((line) => line.startsWith('Tuning above 100 Hz')));

// ---- Refusals.
assert.equal(failure({ ...base, volume: '' }), 'Enter the box volume.');
assert.equal(failure({ ...base, diameter: '' }), 'Enter the port diameter.');
assert.equal(failure({ ...base, ports: '' }), 'Enter the port count.');
assert.equal(failure({ ...base, length: '' }), 'Enter the port length.');
assert.equal(failure({ ...base, mode: 'length', frequency: '' }), 'Enter the tuning frequency.');
assert.equal(failure({ ...base, mode: 'sweep' }),
  'Choose what to work out: the tuning or the port length.');
assert.equal(failure({ ...base, mode: 'length', volume: '500', diameter: '2', frequency: '150' }),
  'That tuning needs no real port length: the end correction alone is longer than the tube has to be. '
  + 'Lower the target, use a bigger box or a smaller port.');
assert.equal(failure({ ...base, volume: '50,5', diameter: '7,5', length: '18,5' }), null, 'decimal commas are accepted');
near(C.analyze({ ...base, volume: '50,5', diameter: '7,5', length: '18,5' }).volume, 50.5, 'a comma decimal is read as a point');

// ---- Page contract: shared shell, accessible controls, no runtime foreign APIs.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html), 'network or storage API found');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'remote script');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'remote stylesheet');
assert.ok(!/on(?:click|input|change|submit)=/i.test(html), 'inline handler');
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html), 'unsafe script evaluation');
assert.ok(html.includes('<form id="br-form" novalidate>'), 'form missing');
assert.ok(html.includes('type="submit"'), 'submit missing');
assert.ok(html.includes('role="alert"'), 'error announcement missing');
assert.ok(html.includes('aria-live="polite" aria-atomic="true"'), 'result region missing');
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'), 'shared shell assets missing');
for (const id of ['mode', 'volume', 'diameter', 'ports', 'length', 'frequency']) {
  assert.ok(html.includes('for="' + id + '"'), 'missing label for ' + id);
  assert.ok(html.includes('id="' + id + '"'), 'missing control ' + id);
}
for (const id of ['br-form', 'br-err', 'br-out', 'note', 'reset', 'submit', 'length-field', 'frequency-field']) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}
assert.ok(html.includes('min-height:44px'), 'controls must stay at a 44 px touch target');
assert.ok(/@media \(max-width:360px\)/.test(html), 'small-screen rule missing');
assert.ok(!/style="[^"]*width:\s*\d{3,}px/.test(html), 'fixed wide inline styles');

const publicCount = catalog.tools.filter((tool) => tool.listed).length;
assert.equal(publicCount, 2160, 'the catalog keeps growing: ' + publicCount);
assert.equal(catalog.tools.filter((tool) => tool.category === 'Audio').length, 53, 'Audio count');

console.log('bass-reflex-port-calculator: 29 catalog cases, ' + fixture.vectors.length +
  ' reference vectors, identities and page contracts passed');
