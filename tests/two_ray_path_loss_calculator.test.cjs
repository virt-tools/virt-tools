/* Regression checks for the two-ray path loss core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'two-ray-path-loss-calculator';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* two-ray-core:start */');
const end = html.indexOf('/* two-ray-core:end */');
assert.ok(start > -1 && end > start, 'two-ray core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '/* two-ray-core:end */' + '\nmodule.exports = TwoRay;', sandbox);
const T = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Communications Engineering');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.icon, '\u{1F4E1}');
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 5, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 2, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 200, 'method documented');
assert.equal(catalog.tools.length, 2278, 'catalog total');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');

const failure = (input) => {
  try {
    T.compute(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// --- Constants and defaults. ---
assert.equal(T.SPEED_OF_LIGHT, 299792458);
assert.equal(T.METRES_PER_FOOT, 0.3048);
const defaults = T.compute({});
assert.equal(defaults.frequency, 900);
assert.equal(defaults.distance, 1000);
assert.equal(defaults.txHeight, 15);
assert.equal(defaults.rxHeight, 2);
assert.equal(defaults.power, 30);
assert.equal(defaults.wavelength, 0.3331);
assert.equal(defaults.breakpoint, 1131.76);
assert.equal(defaults.regime, 'free');
assert.equal(defaults.pathLoss, 91.53);
assert.equal(defaults.received, -57.53);
assert.equal(defaults.excess, 0);
assert.equal(defaults.warnings.length, 0);

// --- Every catalog case must agree with the core. ---
let goldenCount = 0;
let boundaryCount = 0;
let validationCount = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    validationCount += 1;
    assert.equal(failure(testCase.input), testCase.expectedError, `${testCase.name}: validation message`);
    continue;
  }
  if (testCase.kind === 'golden') goldenCount += 1;
  else if (testCase.kind === 'boundary') boundaryCount += 1;
  else assert.fail(`unexpected test kind ${testCase.kind}`);
  const result = T.compute(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
}
assert.equal(goldenCount, 6, 'expected six golden cases');
assert.equal(boundaryCount, 6, 'expected six boundary cases');
assert.equal(validationCount, 12, 'expected twelve validation cases');

// --- Independent recomputation in a different algebraic form. ---
const C = 299792458;
const FT = 0.3048;
const roundHalfAway = (value, places) => {
  const factor = Math.pow(10, places);
  return Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
};
// 10*log10 of the squared ratio is the same quantity as 20*log10 of the ratio.
const freeLoss = (d, lambda) => 10 * Math.log10(Math.pow(4 * Math.PI * d / lambda, 2));
const planeEarthLoss = (d, ht, hr) => 10 * Math.log10(Math.pow((d * d) / (ht * hr), 2));

let sweeps = 0;
for (const mhz of [27, 145, 446, 900, 2400, 5800, 10000]) {
  for (const ht of [0.5, 2, 15, 100]) {
    for (const hr of [0.5, 1.5, 3, 20]) {
      const lambda = C / (mhz * 1e6);
      const breakpoint = 4 * Math.PI * ht * hr / lambda;
      // The two branches meet exactly at the breakpoint.
      assert.ok(Math.abs(freeLoss(breakpoint, lambda) - planeEarthLoss(breakpoint, ht, hr)) < 1e-9,
        `${mhz}/${ht}/${hr}: branches meet at the breakpoint`);
      for (const d of [10, 100, 1000, 5000, 20000]) {
        const result = T.compute({
          freq: String(mhz), distance: String(d), txHeight: String(ht), rxHeight: String(hr),
          power: '30', txGain: '2', rxGain: '2'
        });
        const expectedLoss = d >= breakpoint ? planeEarthLoss(d, ht, hr) : freeLoss(d, lambda);
        assert.equal(result.regime, d >= breakpoint ? 'ground' : 'free', `${mhz}/${ht}/${hr}/${d}: regime`);
        assert.equal(result.pathLoss, roundHalfAway(expectedLoss, 2), `${mhz}/${ht}/${hr}/${d}: path loss`);
        assert.equal(result.freeSpaceLoss, roundHalfAway(freeLoss(d, lambda), 2), `${mhz}/${ht}/${hr}/${d}: free space`);
        assert.equal(result.breakpoint, roundHalfAway(breakpoint, 2), `${mhz}/${ht}/${hr}/${d}: breakpoint`);
        assert.equal(result.wavelength, roundHalfAway(lambda, 4), `${mhz}/${ht}/${hr}/${d}: wavelength`);
        assert.equal(result.excess, roundHalfAway(Math.max(0, expectedLoss - freeLoss(d, lambda)), 2),
          `${mhz}/${ht}/${hr}/${d}: excess`);
        assert.equal(result.received, roundHalfAway(34 - expectedLoss, 2), `${mhz}/${ht}/${hr}/${d}: received`);
        sweeps += 1;
      }
    }
  }
}

// --- Ten times the distance adds 40 dB past the breakpoint and 20 dB inside it. ---
for (const [mhz, ht, hr] of [[900, 15, 2], [446, 10, 1.5], [2400, 8, 2]]) {
  const near = T.compute({ freq: String(mhz), distance: '2000', txHeight: String(ht), rxHeight: String(hr) });
  const far = T.compute({ freq: String(mhz), distance: '20000', txHeight: String(ht), rxHeight: String(hr) });
  assert.equal(near.regime, 'ground');
  assert.equal(far.regime, 'ground');
  assert.ok(Math.abs(far.pathLoss - near.pathLoss - 40) < 0.01, `${mhz}: 40 dB per decade`);
  const close = T.compute({ freq: String(mhz), distance: '10', txHeight: String(ht), rxHeight: String(hr) });
  const closer = T.compute({ freq: String(mhz), distance: '100', txHeight: String(ht), rxHeight: String(hr) });
  assert.equal(close.regime, 'free');
  assert.equal(closer.regime, 'free');
  assert.ok(Math.abs(closer.pathLoss - close.pathLoss - 20) < 0.01, `${mhz}: 20 dB per decade inside`);
}

// --- Feet and metres describe the same link. ---
for (const [mhz, d, ht, hr] of [[900, 1500, 25, 4], [2400, 800, 9.144, 1.8288], [145, 30000, 30, 3]]) {
  const metric = T.compute({ freq: String(mhz), distance: String(d), txHeight: String(ht), rxHeight: String(hr) });
  const imperial = T.compute({
    unit: 'ft', freq: String(mhz), distance: String(roundHalfAway(d / FT, 4)),
    txHeight: String(roundHalfAway(ht / FT, 4)), rxHeight: String(roundHalfAway(hr / FT, 4))
  });
  assert.equal(imperial.regime, metric.regime, `${mhz}: same regime in feet`);
  assert.ok(Math.abs(imperial.pathLoss - metric.pathLoss) < 0.02, `${mhz}: same path loss in feet`);
  assert.ok(Math.abs(imperial.received - metric.received) < 0.02, `${mhz}: same received power in feet`);
  assert.ok(Math.abs(imperial.breakpoint * FT - metric.breakpoint) < 0.05, `${mhz}: same breakpoint in feet`);
}

// --- Heights help past the breakpoint; gains and power add decibel for decibel. ---
const low = T.compute({ freq: '900', distance: '3000', txHeight: '10', rxHeight: '2' });
const high = T.compute({ freq: '900', distance: '3000', txHeight: '20', rxHeight: '2' });
assert.ok(high.pathLoss < low.pathLoss, 'a taller antenna loses less past the breakpoint');
assert.ok(Math.abs((low.pathLoss - high.pathLoss) - 6.02) < 0.01, 'doubling the height gains 6 dB');
const louder = T.compute({ freq: '900', distance: '3000', txHeight: '10', rxHeight: '2', power: '31' });
assert.ok(Math.abs(louder.received - low.received - 1) < 0.01, 'one more dBm in is one more dBm out');
const gainy = T.compute({ freq: '900', distance: '3000', txHeight: '10', rxHeight: '2', txGain: '9' });
assert.ok(Math.abs(gainy.received - low.received - 7) < 0.01, 'antenna gain adds directly');

// --- Refusals and notes. ---
assert.equal(failure({ unit: 'yd' }), 'Choose metres or feet for the distances.');
assert.equal(failure({ freq: '' }), 'Frequency is required.');
assert.equal(failure({ freq: 'abc' }), 'Frequency must be a number from 1 to 10000 MHz.');
assert.equal(failure({ freq: '-900' }), 'Frequency must be a number from 1 to 10000 MHz.');
assert.equal(failure({ distance: '0' }), 'Distance must be a number from 1 to 50000 metres.');
assert.equal(failure({ unit: 'ft', distance: '1' }), 'Distance must be a number from 3.2808 to 164041.9948 feet.');
assert.equal(failure({ txHeight: '0.05' }), 'Transmit antenna height must be a number from 0.1 to 500 metres.');
assert.equal(failure({ rxHeight: '' }), 'Receive antenna height is required.');
assert.equal(failure({ power: '100.5' }), 'Transmit power must be a number from 0 to 100 dBm.');
assert.equal(failure({ rxGain: 'x' }), 'Receive gain must be a number from 0 to 60 dBi.');

const flat = T.compute({ freq: '900', distance: '1', txHeight: '1', rxHeight: '0.5' });
assert.ok(flat.warnings.some((line) => line.includes('shorter than the two heights')), 'short span note');
const belowWave = T.compute({ freq: '1', distance: '50', txHeight: '0.1', rxHeight: '2' });
assert.ok(belowWave.warnings.some((line) => line.includes('below one wavelength')), 'sub-wavelength note');
const costly = T.compute({ freq: '900', distance: '20000', txHeight: '2', rxHeight: '1' });
assert.ok(costly.excess >= 40, 'this link pays more than 40 dB for the ground');
assert.ok(costly.warnings.some((line) => line.includes('more than free space')), 'extra-loss note');

// --- Page contract. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'), 'live status region');
for (const id of ['unit', 'freq', 'distance', 'txHeight', 'rxHeight', 'power', 'txGain', 'rxGain',
  'calculate', 'reset', 'tr-status', 'headline-out', 'loss-out', 'break-out', 'wave-out', 'fspl-out',
  'extra-out', 'rx-out', 'copy', 'notes']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or output ${id}`);
}
assert.ok(/<form id="tr-form" novalidate>/.test(html), 'form contract');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(/<option value="m" selected>/.test(html), 'metres selected by default');
assert.ok(/id="freq" type="text" inputmode="decimal" autocomplete="off" value="900"/.test(html), 'default frequency');
assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(html), 'no raw HTML sinks');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'no browser storage');
assert.ok(!/https?:\/\//.test(html.replace(/<meta name="description"[^>]*>/, '')), 'no external requests in the page');
assert.ok(!/\bfetch\(|XMLHttpRequest/.test(html), 'no network calls');

console.log(`${slug}: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed; ` +
  `${sweeps} independent recomputations, breakpoint continuity, decade slopes, feet equivalence and the notes agreed`);
