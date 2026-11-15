/* Regression checks for the Okumura-Hata path loss core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'hata-path-loss-calculator';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* hata-path-loss-core:start */');
const end = html.indexOf('/* hata-path-loss-core:end */');
assert.ok(start > -1 && end > start, 'hata path loss core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '\nmodule.exports = HataPathLoss;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Okumura-Hata Path Loss Calculator');
assert.equal(entry.category, 'Communications Engineering');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.reviewedAt, null);
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 10, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 3, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 800, 'method documented');
assert.ok(entry.testCases.length >= 10, 'catalog cases present');
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Communications Engineering').length, 47,
  'Communications Engineering count');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');
const aliases = catalog.tools.flatMap((tool) => (tool.slug === slug ? [] : tool.aliases || []))
  .map((alias) => alias.toLowerCase());
for (const alias of entry.aliases) {
  assert.ok(!aliases.includes(alias.toLowerCase()), `alias ${alias} is already used`);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug &&
  /hata|okumura|cost-231/i.test([tool.name, ...(tool.aliases || []), ...(tool.tags || [])].join(' '))),
'no other Hata tool');

const failure = (input) => {
  try {
    C.compute(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// --- Catalog cases through the shipped core. ---
const base = { model: 'hata', environment: 'large', frequency: 900, baseHeight: 50, mobileHeight: 3, distance: 5 };
for (const testCase of entry.testCases) {
  const input = Object.assign({}, base, testCase.input);
  if (testCase.kind === 'validation') {
    assert.equal(failure(input), testCase.expected.error, testCase.name);
    continue;
  }
  const result = C.compute(input);
  for (const key of ['loss', 'fspl', 'excess', 'correction', 'slope']) {
    assert.equal(result[key], testCase.expected[key], `${testCase.name}: ${key}`);
  }
  const termSum = result.terms.reduce((total, term) => total + Number(term.value), 0);
  assert.ok(Math.abs(termSum - result.loss) <= 0.06, `${testCase.name}: terms must add up to the loss`);
}

// --- Input validation. ---
assert.equal(failure({ model: 'hata', environment: 'large', frequency: '', baseHeight: 50, mobileHeight: 3, distance: 5 }),
  'Enter the frequency in MHz.');
assert.equal(failure({ model: 'hata', environment: 'large', frequency: 'abc', baseHeight: 50, mobileHeight: 3, distance: 5 }),
  'Enter the frequency in MHz.');
assert.equal(failure({ model: 'hata', environment: 'large', frequency: 149.9, baseHeight: 50, mobileHeight: 3, distance: 5 }),
  'Okumura-Hata covers 150–1500 MHz, so 149.9 MHz is outside its validity range.');
assert.equal(failure({ model: 'cost231', environment: 'medium', frequency: 1400, baseHeight: 50, mobileHeight: 3, distance: 5 }),
  'COST-231 Hata covers 1500–2000 MHz, so 1400 MHz is outside its validity range.');
assert.equal(failure({ model: 'hata', environment: 'large', frequency: 900, baseHeight: 25, mobileHeight: 3, distance: 5 }),
  'The base antenna height must be between 30 and 200 m for these models.');
assert.equal(failure({ model: 'hata', environment: 'large', frequency: 900, baseHeight: 50, mobileHeight: 0.5, distance: 5 }),
  'The mobile antenna height must be between 1 and 10 m for these models.');
assert.equal(failure({ model: 'hata', environment: 'large', frequency: 900, baseHeight: 50, mobileHeight: 3, distance: 25 }),
  'The distance must be between 1 and 20 km for these models.');
assert.equal(failure({ model: 'hata', environment: 'large', frequency: 900, baseHeight: 50, mobileHeight: 3, distance: '' }),
  'Enter the distance in kilometres.');
assert.equal(failure({ model: 'nope', environment: 'large', frequency: 900, baseHeight: 50, mobileHeight: 3, distance: 5 }),
  'Choose one of the two path loss models.');
assert.equal(failure({ model: 'hata', environment: 'nowhere', frequency: 900, baseHeight: 50, mobileHeight: 3, distance: 5 }),
  'Choose the environment the path runs through.');
assert.equal(failure({ model: 'cost231', environment: 'open', frequency: 1800, baseHeight: 30, mobileHeight: 2, distance: 3 }),
  'COST-231 Hata defines no open/rural correction; use Okumura-Hata below 1500 MHz or an open-area model.');

// --- Boundaries are accepted. ---
assert.equal(C.compute({ model: 'hata', environment: 'open', frequency: 150, baseHeight: 30, mobileHeight: 1, distance: 1 }).frequency, 150);
assert.equal(C.compute({ model: 'hata', environment: 'suburban', frequency: 1500, baseHeight: 200, mobileHeight: 10, distance: 20 }).frequency, 1500);
assert.equal(C.compute({ model: 'cost231', environment: 'large', frequency: 1500, baseHeight: 30, mobileHeight: 1, distance: 1 }).frequency, 1500);
assert.equal(C.compute({ model: 'cost231', environment: 'suburban', frequency: 2000, baseHeight: 200, mobileHeight: 10, distance: 20 }).frequency, 2000);

// --- Mobile correction branches. ---
const close = (a, b) => Math.abs(a - b) < 0.005;
assert.ok(close(C.mobileCorrection('hata', 'large', 150, 10), 8.29 * Math.log10(1.54 * 10) ** 2 - 1.1), 'large city <=200 MHz form');
assert.ok(close(C.mobileCorrection('hata', 'large', 900, 3), 3.2 * Math.log10(11.75 * 3) ** 2 - 4.97), 'large city >=400 MHz form');
assert.ok(close(C.mobileCorrection('hata', 'large', 300, 3), 3.2 * Math.log10(11.75 * 3) ** 2 - 4.97), 'large city 200-400 MHz uses the 400 MHz form');
assert.ok(close(C.mobileCorrection('hata', 'medium', 900, 3), (1.1 * Math.log10(900) - 0.7) * 3 - (1.56 * Math.log10(900) - 0.8)), 'medium city form');
assert.ok(close(C.mobileCorrection('hata', 'suburban', 900, 3), C.mobileCorrection('hata', 'medium', 900, 3)), 'suburban uses the medium-city correction');
assert.ok(close(C.mobileCorrection('cost231', 'large', 1800, 3), (1.1 * Math.log10(1800) - 0.7) * 3 - (1.56 * Math.log10(1800) - 0.8)), 'COST-231 uses the medium-city correction even in a dense city');

// --- Second independent model over a generated grid. ---
const log10 = (value) => Math.log(value) / Math.LN10;
const reference = (input) => {
  const f = Number(input.frequency);
  const hb = Number(input.baseHeight);
  const hm = Number(input.mobileHeight);
  const d = Number(input.distance);
  const logF = log10(f);
  const bigCity = 8.29 * log10(1.54 * hm) ** 2 - 1.1;
  const bigCityUhf = 3.2 * log10(11.75 * hm) ** 2 - 4.97;
  const smallCity = (1.1 * logF - 0.7) * hm - (1.56 * logF - 0.8);
  let a;
  if (input.model === 'cost231') a = smallCity;
  else if (input.environment !== 'large') a = smallCity;
  else a = f <= 200 ? bigCity : bigCityUhf;
  const common = -13.82 * log10(hb) + (44.9 - 6.55 * log10(hb)) * log10(d);
  let loss;
  if (input.model === 'cost231') {
    loss = 46.3 + 33.9 * logF + common - a + (input.environment === 'large' ? 3 : 0);
  } else {
    loss = 69.55 + 26.16 * logF + common - a;
    if (input.environment === 'suburban') loss = loss - (2 * log10(f / 28) ** 2 + 5.4);
    if (input.environment === 'open') loss = loss - (4.78 * logF * logF - 18.33 * logF + 40.94);
  }
  const fspl = 32.45 + 20 * logF + 20 * log10(d);
  const r2 = (value) => {
    const rounded = Math.round(value * 100) / 100;
    return rounded === 0 ? 0 : rounded;
  };
  return { loss: r2(loss), fspl: r2(fspl), correction: r2(a), rawLoss: loss, rawFspl: fspl };
};
const frequencies = [150, 200, 380, 450, 700, 900, 1200, 1500, 1800, 2000];
const heights = [30, 45, 60, 120, 200];
const mobiles = [1, 1.5, 3, 10];
const distances = [1, 2.5, 8, 20];
const models = ['hata', 'cost231'];
const environments = ['large', 'medium', 'suburban', 'open'];
let generated = 0;
for (const model of models) {
  for (const environment of environments) {
    if (model === 'cost231' && environment === 'open') continue;
    for (const frequency of frequencies) {
      if (model === 'hata' && frequency > 1500) continue;
      if (model === 'cost231' && frequency < 1500) continue;
      for (const baseHeight of heights) {
        for (const mobileHeight of mobiles) {
          for (const distance of distances) {
            const input = { model, environment, frequency, baseHeight, mobileHeight, distance };
            const got = C.compute(input);
            const want = reference(input);
            assert.equal(got.loss, want.loss, `generated loss ${JSON.stringify(input)}`);
            assert.equal(got.fspl, want.fspl, `generated fspl ${JSON.stringify(input)}`);
            assert.equal(got.correction, want.correction, `generated correction ${JSON.stringify(input)}`);
            assert.equal(got.excess, Math.round((want.rawLoss - want.rawFspl) * 100) / 100,
              `generated excess ${JSON.stringify(input)}`);
            generated += 1;
          }
        }
      }
    }
  }
}
assert.ok(generated > 500, 'generated grid must be wide');

// --- Result contract. ---
const sample = C.compute(Object.assign({}, base));
assert.match(sample.lossText, /^\d+\.\d{2} dB$/);
assert.match(sample.excessText, /^[+\-]\d+\.\d{2} dB$/);
assert.match(sample.summary, /^Okumura-Hata, large city: 900 MHz, 50 m base, 3 m mobile, 5 km → 144\.27 dB median path loss/);
assert.ok(sample.loss > sample.fspl, 'urban loss must exceed free space at 900 MHz');
assert.ok(sample.notes.length >= 4, 'notes explain the model');
assert.equal(sample.terms.length, 5, 'five additive terms in the urban case');
assert.equal(C.compute({ model: 'hata', environment: 'suburban', frequency: 900, baseHeight: 50, mobileHeight: 3, distance: 5 }).terms.length, 6,
  'suburban case adds the correction row');
assert.ok(C.compute({ model: 'hata', environment: 'open', frequency: 900, baseHeight: 50, mobileHeight: 3, distance: 5 }).loss <
  C.compute({ model: 'hata', environment: 'suburban', frequency: 900, baseHeight: 50, mobileHeight: 3, distance: 5 }).loss,
  'open country is kinder than suburbs');
assert.equal(C.DEFAULTS.frequency, '900');
assert.equal(Object.keys(C.EXAMPLES).length, 4);

// --- Page contract. ---
assert.match(html, /<title>Okumura-Hata Path Loss Calculator — virt\.tools<\/title>/);
assert.match(html, /name="description" content="[^"]*Runs locally in your browser/);
assert.match(html, /<h1>Okumura-Hata Path Loss Calculator<\/h1>/);
for (const id of ['model', 'environment', 'frequency', 'base-height', 'mobile-height', 'distance']) {
  assert.ok(html.includes(`<label for="${id}">`), `label for ${id}`);
  assert.ok(html.includes(`id="${id}"`), `control ${id}`);
}
assert.match(html, /role="status" aria-live="polite"/);
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no third-party scripts');
assert.ok(!/<link[^>]+href="https?:/.test(html), 'no third-party styles');
assert.ok(!/\son(click|change|input|submit)=/i.test(html), 'no inline event handlers');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), 'no network or storage');

console.log(`hata path loss: ${entry.testCases.length} catalog cases, ${generated} generated links ok`);
