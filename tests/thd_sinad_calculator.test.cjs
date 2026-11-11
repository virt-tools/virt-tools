/* Regression checks for the THD & SINAD core and its catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'thd-sinad-calculator';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* thd-sinad-core:start */');
const end = html.indexOf('/* thd-sinad-core:end */');
assert.ok(start > -1 && end > start, 'thd sinad core markers missing');
const core = html.slice(start, end + '/* thd-sinad-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ThdSinadCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];

const run = (input) => C.build({ ...C.DEFAULTS, ...input });
const failure = (input) => {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const blank = { h2: '', h3: '', h4: '', h5: '', h6: '', h7: '' };

// --- Independent reference: all arithmetic done on dB differences (energy sums). ---
const reference = (input) => {
  const state = { ...C.DEFAULTS, ...input };
  const fundamental = Number(String(state.fundamental).trim());
  const harmonics = [];
  for (const order of [2, 3, 4, 5, 6, 7]) {
    const raw = String(state['h' + order] === undefined || state['h' + order] === null ? '' : state['h' + order]).trim();
    if (raw !== '') harmonics.push({ order, dB: Number(raw) });
  }
  const noiseRaw = String(state.noise === undefined || state.noise === null ? '' : state.noise).trim();
  const noise = noiseRaw === '' ? null : Number(noiseRaw);
  const harmonicEnergy = harmonics.reduce((sum, row) => sum + Math.pow(10, (row.dB - fundamental) / 10), 0);
  const totalEnergy = harmonicEnergy + (noise === null ? 0 : Math.pow(10, (noise - fundamental) / 10));
  const sinad = -10 * Math.log10(totalEnergy);
  return {
    thdPercent: Math.sqrt(harmonicEnergy) * 100,
    thdPlusNoisePercent: Math.sqrt(totalEnergy) * 100,
    sinadDb: sinad,
    enobBits: (sinad - 1.76) / 6.02,
    residualDbfs: fundamental + 10 * Math.log10(totalEnergy),
    distortionShare: harmonics.map((row) => [row.order, harmonicEnergy === 0 ? 0 : Math.pow(10, (row.dB - fundamental) / 10) / harmonicEnergy * 100]),
  };
};

// --- Anchors a reviewer can check by hand. ---
const oneHarmonic = run({ fundamental: '0', noise: '', ...blank, h2: '-60' });
near(oneHarmonic.thdPercent, 0.1, 'one harmonic 60 dB down is 0.1% THD');
near(oneHarmonic.thdDb, -60, 'THD in dB is the harmonic offset');
near(oneHarmonic.sinadDb, 60, 'SINAD equals the harmonic offset');
near(oneHarmonic.enobBits, 9.674419, '60 dB SINAD is 9.67 effective bits', 1e-6);
assert.equal(oneHarmonic.thdText, '0.1%');
assert.equal(oneHarmonic.thdDbText, '-60 dB');
assert.equal(oneHarmonic.sinadText, '60 dB');
assert.equal(oneHarmonic.enobText, '9.67 bits');
assert.equal(oneHarmonic.residualText, '-60 dB');
assert.equal(oneHarmonic.dominantOrder, 2);
assert.equal(oneHarmonic.breakdown.length, 1);
assert.equal(oneHarmonic.breakdown[0].sharePercent, 100);

const twoHarmonics = run({ fundamental: '0', noise: '', ...blank, h2: '-60', h3: '-60' });
near(twoHarmonics.thdPercent, Math.SQRT2 * 0.1, 'equal harmonics add in quadrature');
near(twoHarmonics.thdDb, -56.9897, 'two equal harmonics sit 3 dB above one');
assert.equal(twoHarmonics.thdText, '0.1414%');
near(twoHarmonics.breakdown[0].sharePercent, 50, 'equal harmonics share the distortion');
near(twoHarmonics.breakdown[1].sharePercent, 50, 'equal harmonics share the distortion');

// A noise floor alone leaves THD at zero but still gives THD+N and SINAD.
const noiseOnly = run({ fundamental: '-3', noise: '-90', ...blank });
assert.equal(noiseOnly.thdPercent, 0);
assert.equal(noiseOnly.thdDb, null);
assert.equal(noiseOnly.thdText, '0%');
assert.equal(noiseOnly.thdDbText, 'none');
assert.equal(noiseOnly.dominantOrder, null);
assert.equal(noiseOnly.dominantText, 'none');
assert.equal(noiseOnly.breakdown.length, 0);
near(noiseOnly.thdPlusNoisePercent, Math.pow(10, -87 / 20) * 100, 'noise 87 dB down is the THD+N ratio');
near(noiseOnly.sinadDb, 87, 'SINAD is the noise offset when THD is zero');
assert.equal(noiseOnly.thdnText, '4.47e-3%');
assert.equal(noiseOnly.sinadText, '87 dB');
assert.equal(noiseOnly.residualText, '-90 dB');
assert.equal(noiseOnly.warningCount, 0);

// THD+N is never below THD, and equals it without a noise floor.
const mixed = run({ fundamental: '-6', noise: '-86', ...blank, h2: '-66' });
near(mixed.thdPercent, 0.1, 'mixed case THD');
near(mixed.sinadDb, -10 * Math.log10(1e-6 + 1e-8), 'mixed case SINAD');
assert.ok(mixed.thdPlusNoisePercent > mixed.thdPercent, 'THD+N must exceed THD when noise is entered');
assert.equal(mixed.thdnText, '0.1005%');
assert.equal(mixed.sinadText, '59.96 dB');

const defaults = run({});
near(defaults.thdPercent, reference({}).thdPercent, 'default THD');
near(defaults.sinadDb, reference({}).sinadDb, 'default SINAD');
assert.equal(defaults.warningCount, 0);
assert.match(defaults.summary, /THD and .* THD\+N give .* SINAD/);
assert.equal(defaults.explanation.length, 6);

// Formatting helpers must not leak a signed zero or a bare unit.
assert.equal(C.fmtDb(0), '0 dB');
assert.equal(C.fmtDb(-0.0001), '0 dB');
assert.equal(C.fmtDb(null), 'none');
assert.equal(C.fmtPercent(0), '0%');
assert.equal(C.fmtPercent(0.1), '0.1%');
assert.equal(C.fmtPercent(100), '100%');
assert.equal(C.fmtPercent(0.0044668), '4.47e-3%');
assert.equal(C.fmtBits(12), '12 bits');
const zeroSinad = run({ fundamental: '0', noise: '', ...blank, h2: '0' });
assert.equal(zeroSinad.sinadText, '0 dB');
assert.equal(zeroSinad.thdText, '100%');
assert.equal(zeroSinad.enobText, '-0.29 bits');
const zeroSinadRoundTrip = JSON.stringify(zeroSinad);
assert.ok(!zeroSinadRoundTrip.includes('"-0 '), 'no negative zero may reach a label');

// Blank harmonics are absent, whitespace is trimmed, and -0.00 is accepted as zero.
const trimmed = run({ fundamental: ' -6 ', noise: ' -90 ', ...blank, h3: ' -60 ' });
assert.equal(trimmed.harmonics.length, 1);
assert.equal(trimmed.harmonics[0], 3);
near(trimmed.thdPercent, Math.pow(10, (-60 - -6) / 20) * 100, 'trimmed level parses');
const negativeZero = run({ fundamental: '-0.00', noise: '', ...blank, h2: '-60' });
near(negativeZero.thdPercent, 0.1, 'a negative zero fundamental is still full scale');

// --- Sweep against the independent reference over a lattice of levels. ---
let compared = 0;
for (const fundamental of ['-120', '-60', '-20', '-3', '0']) {
  for (const h2 of ['', '-160', '-100', '-60', '-20', '0']) {
    for (const h3 of ['', '-100', '-60']) {
      for (const noise of ['', '-160', '-96', '-20']) {
        if (h2 === '' && h3 === '' && noise === '') continue;
        const input = { fundamental, noise, ...blank, h2, h3 };
        const got = run(input);
        const want = reference(input);
        const label = JSON.stringify(input);
        near(got.thdPercent, want.thdPercent, `sweep THD ${label}`);
        near(got.thdPlusNoisePercent, want.thdPlusNoisePercent, `sweep THD+N ${label}`);
        near(got.sinadDb, want.sinadDb, `sweep SINAD ${label}`);
        near(got.enobBits, want.enobBits, `sweep ENOB ${label}`);
        near(got.residualDbfs, want.residualDbfs, `sweep residual ${label}`);
        // Inversion: the dB form of THD+N and SINAD must agree to the last digit.
        near(got.sinadDb, -20 * Math.log10(got.thdPlusNoisePercent / 100), `sweep inversion ${label}`);
        assert.equal(got.breakdown.length, want.distortionShare.length, `sweep harmonic count ${label}`);
        for (const [order, share] of want.distortionShare) {
          const row = got.breakdown.find((item) => item.order === order);
          near(row.sharePercent, share, `sweep share ${order} ${label}`);
        }
        compared += 1;
      }
    }
  }
}
assert.ok(compared >= 300, `sweep too small: ${compared}`);

// The dominant harmonic is the loudest one, and it is marked once in the breakdown.
const ladder = run({ fundamental: '-1', noise: '-101', h2: '-100', h3: '-104', h4: '-118', h5: '-112', h6: '-125', h7: '-130' });
assert.deepEqual(Array.from(ladder.breakdown, (row) => row.order), [2, 3, 4, 5, 6, 7]);
assert.equal(ladder.dominantOrder, 2);
assert.equal(ladder.breakdown.filter((row) => row.order === ladder.dominantOrder).length, 1);
near(ladder.breakdown.reduce((sum, row) => sum + row.sharePercent, 0), 100, 'shares must total 100%');
assert.equal(ladder.dominantText, '2nd harmonic at -100 dB');

// --- Catalog case replay. ---
const NUMERIC_KEYS = new Set(['thdPercent', 'thdDb', 'thdPlusNoisePercent', 'sinadDb', 'enobBits', 'residualDbfs', 'warningCount']);
assert.ok(Array.isArray(entry.testCases) && entry.testCases.length > 0, 'catalog cases missing');
let golden = 0;
let boundary = 0;
let validation = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    validation += 1;
    const message = failure(testCase.input);
    assert.ok(message !== null, `${testCase.name}: expected a refusal`);
    assert.equal(message, testCase.expectedError, `${testCase.name}: wrong message`);
    continue;
  }
  if (testCase.kind === 'golden') golden += 1;
  else if (testCase.kind === 'boundary') boundary += 1;
  else assert.fail(`${testCase.name}: unknown kind ${testCase.kind}`);
  const result = run(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (expected === null) {
      assert.equal(result[key], null, `${testCase.name} ${key}`);
    } else if (NUMERIC_KEYS.has(key)) {
      near(result[key], expected, `${testCase.name} ${key}`);
    } else {
      assert.equal(result[key], expected, `${testCase.name} ${key}`);
    }
  }
}
assert.equal(golden, 8);
assert.equal(boundary, 5);
assert.equal(validation, 10);
assert.equal(entry.testCases.length, 23);

// --- Static offline, accessibility and DOM-wiring contract. ---
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|navigator\.clipboard/.test(html), 'no network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'no remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote styles');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(!/\beval\(|new Function/.test(html), 'no dynamic code evaluation');
assert.ok(html.includes('<form id="thd-form"'), 'form missing');
assert.ok(html.includes('aria-live="polite"'), 'live result missing');
assert.ok(html.includes('role="status"'), 'status role missing');
assert.ok(html.includes('@media(max-width:640px)'), 'mobile breakpoint missing');
assert.ok(html.includes('min-height:44px'), '44 px controls required');
assert.ok(html.includes('max-width:none'), 'text inputs must escape the shared 720 px cap');
for (const id of ['in-fundamental', 'in-noise', 'in-h2', 'in-h3', 'in-h4', 'in-h5', 'in-h6', 'in-h7']) {
  assert.ok(html.includes(`id="${id}"`), `control ${id} missing`);
  assert.ok(html.includes(`for="${id}"`), `label ${id} missing`);
}
for (const id of ['preset-clean', 'preset-tube', 'preset-clipped', 'calculate', 'reset',
  'out-thd', 'out-thdn', 'out-sinad', 'out-enob', 'out-residual', 'out-dominant', 'out-harmonics', 'warnings', 'explanation']) {
  assert.ok(html.includes(`id="${id}"`), `element ${id} missing`);
}
const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate HTML id');
for (const match of html.matchAll(/getElementById\('([^']+)'\)/g)) {
  assert.ok(ids.includes(match[1]), `script references missing id ${match[1]}`);
}
assert.ok(html.includes('src="/assets/theme-init.js"'), 'theme bootstrap missing');
assert.ok(html.includes('href="/assets/style.css"'), 'shared stylesheet missing');
assert.ok(html.includes('src="/assets/tools.js"') && html.includes('src="/assets/app.js"'), 'shared scripts missing');
// The markup must open on the core defaults, not in a validation-error state.
for (const key of ['fundamental', 'noise', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7']) {
  const id = key === 'fundamental' ? 'in-fundamental' : key === 'noise' ? 'in-noise' : `in-${key}`;
  assert.ok(
    html.includes(`id="${id}" type="number" min="-160" max="0" step="0.01" value="${C.DEFAULTS[key]}"`),
    `control ${id} must default to ${C.DEFAULTS[key] || 'blank'}`
  );
}

// --- Catalog record contract. ---
assert.equal(entry.name, 'THD & SINAD Calculator');
assert.equal(entry.category, 'Audio');
assert.equal(entry.subcategory, 'Analysis & validation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.ok(entry.sources.length >= 3, 'at least three sources');
assert.ok(entry.method.includes('dBFS') && entry.method.includes('6.02') && entry.method.includes('browser'),
  'method must state the units, the per-bit factor and local execution');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.equal(catalog.tools.length, 2214);
const allAliases = new Map();
for (const tool of catalog.tools) {
  for (const alias of tool.aliases || []) {
    const key = alias.toLowerCase();
    if (!allAliases.has(key)) allAliases.set(key, new Set());
    allAliases.get(key).add(tool.slug);
  }
}
for (const alias of entry.aliases) {
  const owners = allAliases.get(alias.toLowerCase());
  assert.deepEqual([...owners], [slug], `alias ${alias} must belong only to ${slug}`);
}
for (const value of [entry.slug, entry.name]) {
  const key = value.toLowerCase();
  const clash = catalog.tools.filter((tool) => tool.slug !== slug
    && (tool.slug.toLowerCase() === key || tool.name.toLowerCase() === key));
  assert.equal(clash.length, 0, `${value} clashes with ${clash.map((tool) => tool.slug).join(', ')}`);
}

console.log(`thd sinad: ${compared} sweep cases, ${golden} golden, ${boundary} boundary, ${validation} validation checks passed`);
