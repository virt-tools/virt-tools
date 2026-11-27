/* Sealed box alignment: an independent Python model (50-digit Decimal closed forms,
   with the -3 dB point bisected and the peak found by a grid search on the raw
   second-order response) as the oracle, the published worked examples, the
   identities that follow from Vas/Vb, the catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'sealed-box-alignment-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* sba-core:start */');
const end = html.indexOf('/* sba-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + '/* sba-core:end */'.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = SealedCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-12) => {
  assert.ok(Number.isFinite(actual), label + ': ' + actual + ' is not a finite number');
  assert.ok(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    label + ': ' + actual + ' is not within ' + eps + ' of ' + expected);
};
const failure = (input) => {
  try { C.analyze(input); } catch (error) { return error.message; }
  return null;
};
const db = (value) => 20 * Math.log10(value);

// ---- Constants and messages.
assert.equal(JSON.stringify(C.LIMITS.fs), JSON.stringify([5, 500]));
assert.equal(JSON.stringify(C.LIMITS.qts), JSON.stringify([0.05, 2]));
assert.equal(JSON.stringify(C.LIMITS.vas), JSON.stringify([0.5, 5000]));
assert.equal(JSON.stringify(C.LIMITS.qtc), JSON.stringify([0.1, 3]));
assert.equal(JSON.stringify(C.LIMITS.volume), JSON.stringify([0.5, 5000]));
assert.equal(C.MAX_VOLUME, 5000);
assert.equal(C.PEAK_FLOOR, Math.SQRT1_2);
assert.equal(C.PEAK_MIN_DB, 0.1);
assert.deepEqual(Object.keys(C.MESSAGES).sort(), ['fs', 'mode', 'qtc', 'qts', 'vas', 'volume']);

// ---- Published anchors: two worked examples from the cited reference and one from
//      a driver sheet, all reproduced to the digits the source prints.
const small = C.analyze({ mode: 'qtc', fs: '35', qts: '0.65', vas: '45', volume: '30' });
near(small.qtc, 1.03, '30 L on a 0.65 driver gives the published Qtc 1.03', 5e-3);
near(small.fc, 55.4, 'published Fc 55.4 Hz', 5e-3);
near(small.f3, 43, 'published F3 about 43 Hz', 5e-3);
assert.ok(small.hasPeak, 'Qtc 1.03 peaks');
assert.ok(small.peak > 1 && small.peak < 2, 'a Qtc of 1.03 peaks by about 1.4 dB');
const big = C.analyze({ mode: 'volume', fs: '35', qts: '0.65', vas: '45', qtc: '0.707' });
near(big.volume, 246, 'the published butterworth volume is about 246 L', 5e-3);
const sheet = C.analyze({ mode: 'qtc', fs: '35.8', qts: '0.39', vas: '51.8', volume: '37.5' });
near(sheet.qtc, 0.60, 'the 51.8 L driver in 37.5 L lands on the published Qtc 0.60', 5e-3);
near(sheet.fc, 55.2, 'published Fc 55.2 Hz', 5e-3);

// ---- Identities: the same stiffening factor drives Q and resonance.
for (const fs of [15, 22.5, 33, 48, 75, 120, 220]) {
  for (const qts of [0.2, 0.31, 0.39, 0.47, 0.62, 0.9]) {
    for (const volume of [2, 7.5, 22.5, 60, 180, 900]) {
      const vas = 40;
      const r = C.analyze({ mode: 'qtc', fs: String(fs), qts: String(qts), vas: String(vas), volume: String(volume) });
      near(r.qtc / qts, r.fc / fs, 'fc scales exactly as qtc', 1e-12);
      near(r.scale, r.qtc / qts, 'scale is the stiffening factor', 1e-12);
      near(r.ratio, (r.qtc / qts) ** 2 - 1, 'ratio identity', 1e-12);
      near(r.boxInVas * r.ratio, 1, 'box volume in Vas units is the inverse ratio', 1e-12);
      near(r.levelAtFc, db(r.qtc), 'the level at Fc is 20 log10 Qtc', 1e-12);
      // The -3 dB point sits above Fc below the Butterworth Q and below it above.
      if (r.qtc < Math.SQRT1_2) assert.ok(r.f3 > r.fc, 'F3 above Fc when Q < 0.707');
      if (r.qtc > Math.SQRT1_2 + 1e-6) assert.ok(r.f3 < r.fc, 'F3 below Fc when Q > 0.707');
      // Round trip: the volume solved for a target Q reproduces that Q.
      if (r.qtc > 3) continue;
      const back = C.analyze({ mode: 'volume', fs: String(fs), qts: String(qts), vas: String(vas), qtc: String(Number(r.qtc.toFixed(6))) });
      const again = C.analyze({ mode: 'qtc', fs: String(fs), qts: String(qts), vas: String(vas), volume: String(back.volume) });
      near(again.qtc, Number(r.qtc.toFixed(6)), 'volume and Q are inverses', 1e-9);
    }
  }
}

// ---- A larger target Q always needs a smaller box, and a smaller box always
//      raises the system Q.
let previousVolume = Infinity;
for (const target of ['0.45', '0.5', '0.577', '0.65', '0.707', '0.8', '0.9', '1', '1.2', '1.5', '2', '2.5']) {
  const r = C.analyze({ mode: 'volume', fs: '30', qts: '0.4', vas: '80', qtc: target });
  assert.ok(r.volume < previousVolume, 'volume must fall as the target Q rises');
  assert.ok(r.volume > 0, 'volume stays positive');
  previousVolume = r.volume;
}
let previousQ = 0;
for (const volume of ['900', '400', '150', '60', '25', '10', '4', '1', '0.5']) {
  const r = C.analyze({ mode: 'qtc', fs: '30', qts: '0.4', vas: '80', volume });
  assert.ok(r.qtc > previousQ, 'smaller boxes always raise the system Q');
  previousQ = r.qtc;
}

// ---- The peak flag: it appears from 0.1 dB, sits above Fc and never on a flat
//      alignment. The closed-form peak and frequency are checked against the
//      response evaluated on a grid.
const response = (fc, qtc, f) => {
  const x = f / fc;
  return (x ** 4) / ((x * x - 1) ** 2 + (x / qtc) ** 2);
};
for (const qtc of [0.5, 0.7071, 0.76, 0.78, 0.9, 1, 1.2, 1.6, 2.2]) {
  const r = C.analyze({ mode: 'volume', fs: '40', qts: '0.45', vas: '70', qtc: String(qtc) });
  assert.equal(r.hasPeak, r.peak >= C.PEAK_MIN_DB && qtc > Math.SQRT1_2,
    'the peak flag follows the 0.1 dB rule at ' + qtc);
  if (!r.hasPeak) {
    assert.equal(r.peak, 0);
    assert.equal(r.peakHz, 0);
    continue;
  }
  assert.ok(r.peakHz > r.fc, 'a peak sits above Fc');
  let best = 0;
  let bestAt = 0;
  for (let i = 0; i <= 40000; i++) {
    const f = r.fc * (0.5 + i * (3 / 40000));
    const mag = response(r.fc, r.qtc, f);
    if (mag > best) { best = mag; bestAt = f; }
  }
  near(db(Math.sqrt(best)), r.peak, 'peak level matches the response grid', 2e-3);
  near(bestAt, r.peakHz, 'peak frequency matches the response grid', 2e-3);
}

// ---- Butterworth: F3 equals Fc when the system Q is exactly 1/sqrt(2).
const butter = C.analyze({ mode: 'volume', fs: '40', qts: '0.45', vas: '70', qtc: String(Math.SQRT1_2) });
near(butter.f3, butter.fc, 'Butterworth puts F3 on Fc', 1e-9);
near(butter.levelAtFc, db(Math.SQRT1_2), 'Butterworth sits at the half-power level', 1e-12);
assert.ok(butter.levelAtFc > -3.02 && butter.levelAtFc < -3, 'half power is -3.01 dB, not a rounded -3');
assert.equal(butter.hasPeak, false);

// ---- The independent Python fixture: 240 vectors over both directions.
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/sealed_box_vectors.json'), 'utf8'));
assert.equal(fixture.slug, slug);
assert.equal(fixture.vectors.length, 240, 'vector count');
for (const vector of fixture.vectors) {
  const got = C.analyze(vector.input);
  for (const [key, want] of Object.entries(vector.expected)) {
    if (typeof want === 'number') near(got[key], want, vector.name + ' ' + key, 1e-9);
    else assert.equal(got[key], want, vector.name + ' ' + key);
  }
}

// ---- Input handling: strings from the page, numbers from a harness, commas.
assert.equal(C.analyze({ mode: 'qtc', fs: 35.8, qts: 0.39, vas: 51.8, volume: 37.5 }).qtc > 0.6, true);
near(C.analyze({ mode: 'qtc', fs: '35,8', qts: '0,39', vas: '51,8', volume: '37,5' }).fc, 55.245018, 'decimal commas', 1e-6);
near(C.analyze({ mode: 'qtc', fs: ' 35.8 ', qts: ' 0.39 ', vas: ' 51.8 ', volume: ' 37.5 ' }).volume, 37.5, 'surrounding spaces', 1e-12);
near(C.analyze({ mode: 'volume', fs: '+35.8', qts: '+0.39', vas: '+51.8', qtc: '+0.707' }).volume, 22.656514, 'a leading plus', 1e-6);
assert.equal(failure({ mode: 'volume', fs: '', qts: '0.39', vas: '51.8', qtc: '0.707' }), 'Enter the driver resonance Fs.');
assert.equal(failure({ mode: 'volume', fs: '35.8', qts: '', vas: '51.8', qtc: '0.707' }), 'Enter the driver Qts.');
assert.equal(failure({ mode: 'volume', fs: '35.8', qts: '0.39', vas: '', qtc: '0.707' }), 'Enter the Vas.');
assert.equal(failure({ mode: 'volume', fs: '35.8', qts: '0.39', vas: '51.8', qtc: '' }), 'Enter the target system Q.');
assert.equal(failure({ mode: 'qtc', fs: '35.8', qts: '0.39', vas: '51.8', volume: '' }), 'Enter the net box volume.');
assert.equal(failure({ mode: 'volume', fs: '35.8', qts: '0.39', vas: '51.8', qtc: '4' }),
  'The target Qtc must be a number from 0.1 to 3.');
assert.equal(failure({ mode: 'qtc', fs: '35.8', qts: '0.39', vas: '51.8', volume: '6000' }),
  'The net box volume must be a number from 0.5 to 5,000 litres.');
assert.equal(failure({ mode: 'volume', fs: '35.8', qts: '0.39', vas: '51.8', qtc: '0.39' }),
  "A sealed box can only raise the total Q above the driver's own Qts (0.39). Enter a target above that, "
  + 'or the box would have to be infinitely large.');
assert.equal(failure({ mode: 'volume', fs: '35.8', qts: '0.39', vas: '51.8', qtc: '0.3' }),
  "A sealed box can only raise the total Q above the driver's own Qts (0.39). Enter a target above that, "
  + 'or the box would have to be infinitely large.');

// ---- Warnings: each one is reachable and says what it means.
const peaky = C.analyze({ mode: 'volume', fs: '32', qts: '0.5', vas: '90', qtc: '1.4' });
assert.ok(peaky.warnings.some((line) => line.startsWith('A system Q of 1.40 peaks by')), 'peaky warning');
const damped = C.analyze({ mode: 'qtc', fs: '45', qts: '0.3', vas: '200', volume: '400' });
assert.ok(damped.warnings.some((line) => line.startsWith('A system Q below 0.5')), 'overdamped warning');
const huge = C.analyze({ mode: 'qtc', fs: '25', qts: '0.3', vas: '10', volume: '300' });
assert.ok(huge.warnings.some((line) => line.startsWith('This box is more than 20 times Vas')), 'huge box warning');
const smallVas = C.analyze({ mode: 'qtc', fs: '60', qts: '0.4', vas: '4', volume: '80' });
assert.ok(smallVas.warnings.some((line) => line.startsWith('Vas is more than ten times the box volume')), 'tolerance warning');
assert.equal(C.analyze({ mode: 'volume', fs: '35.8', qts: '0.39', vas: '51.8', qtc: '0.707' }).warnings.length, 0,
  'an ordinary alignment raises no warning');

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Sealed Box Alignment Calculator');
assert.equal(entry.category, 'Audio');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(entry.icon, '\u{1F39B}');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 1500, 'method must document the model, the limits and what it leaves out');
assert.ok(entry.guidance.length > 200, 'guidance must state the input tolerances');
assert.equal(entry.sources.length, 3);
assert.equal(entry.sources[0].url, 'https://en.wikipedia.org/wiki/Thiele/Small_parameters');
assert.equal(entry.sources[1].url, 'https://en.wikipedia.org/wiki/Loudspeaker_enclosure');
assert.equal(entry.sources[2].url, 'https://ohmicaudio.com/reference/math-measurement/sealed-box-system-parameters/');
assert.equal(entry.testCases.length, 19, 'catalog case count');
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'golden').length, 8);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'boundary').length, 5);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'validation').length, 6);
assert.equal(JSON.stringify(entry.testCases), JSON.stringify(fixture.cases), 'the catalog cases are the fixture cases');

const compare = (label, actual, expected) => {
  if (typeof expected === 'number') {
    assert.ok(Math.abs(actual - expected) <= 5.5e-7 + 1e-12 * Math.abs(expected),
      label + ': ' + actual + ' != ' + expected);
    return;
  }
  if (typeof expected === 'boolean' || typeof expected === 'string') {
    assert.equal(actual, expected, label);
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
assert.ok(html.includes('<form id="sba-form" novalidate>'), 'form missing');
assert.ok(html.includes('type="submit"') && html.includes('type="button"'), 'buttons missing');
assert.ok(html.includes('role="alert"'), 'error announcement missing');
assert.ok(html.includes('aria-live="polite" aria-atomic="true"'), 'result region missing');
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'), 'shared shell assets missing');
for (const id of ['mode', 'fs', 'qts', 'vas', 'qtc', 'volume']) {
  assert.ok(html.includes('for="' + id + '"'), 'missing label for ' + id);
  assert.ok(html.includes('id="' + id + '"'), 'missing control ' + id);
}
for (const id of ['sba-form', 'sba-err', 'sba-out', 'note', 'reset', 'submit', 'target-field', 'volume-field']) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}
assert.ok(html.includes('min-height:44px'), 'controls must stay at a 44 px touch target');
assert.ok(/@media \(max-width:360px\)/.test(html), 'small-screen rule missing');
assert.ok(!/style="[^"]*width:\s*\d{3,}px/.test(html), 'fixed wide inline styles');
assert.ok(html.includes('aria-describedby="qtc-help"') && html.includes('aria-describedby="volume-help"'),
  'the conditional fields keep their help text');

const publicCount = catalog.tools.filter((tool) => tool.listed).length;
assert.equal(publicCount, 2223, 'public total');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Audio').length, 56, 'Audio count');

console.log('sealed-box-alignment-calculator: 19 catalog cases, ' + fixture.vectors.length +
  ' reference vectors, identities and page contracts passed');
