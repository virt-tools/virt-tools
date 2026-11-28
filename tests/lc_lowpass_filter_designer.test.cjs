/* LC low-pass ladder designer: the prototype g-values, the ladder response checked
   against the closed-form Butterworth and Chebyshev magnitude, the order inversion,
   the refusal messages, the page markup and every catalog case. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'lc-lowpass-filter-designer';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* lc-lowpass-core:start */';
const endMarker = '/* lc-lowpass-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, Error, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = LcFilterCore;', sandbox);
const C = sandbox.module.exports;

const failure = (payload) => {
  try { C.compute(payload); } catch (error) { return error.message; }
  return null;
};
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-9);
const DEFAULT = { response: 'chebyshev', rippleDb: '0.5', order: '5', cutoffMhz: '100',
  impedance: '50', stopRatio: '2', targetDb: '40' };

// ---- Prototype tables from the published recursions.
const butter5 = C.gValues('butterworth', 5, 0.5);
[0.618034, 1.618034, 2, 1.618034, 0.618034].forEach((want, index) => {
  assert.ok(near(butter5[index], want, 2e-6), 'Butterworth g' + (index + 1));
});
const cheb3 = C.gValues('chebyshev', 3, 0.5);
[1.5963, 1.0967, 1.5963].forEach((want, index) => {
  assert.ok(near(cheb3[index], want, 5e-5), 'Chebyshev 0.5 dB g' + (index + 1));
});
const cheb5 = C.gValues('chebyshev', 5, 0.1);
[1.1468, 1.3712, 1.975, 1.3712, 1.1468].forEach((want, index) => {
  assert.ok(near(cheb5[index], want, 5e-5), 'Chebyshev 0.1 dB g' + (index + 1));
});
assert.equal(C.gValues('butterworth', 3, 0.5).length, 3, 'one g per element');
assert.equal(C.gValues('chebyshev', 7, 1).length, 7, 'one g per element');

// ---- The ladder response equals the closed-form magnitude it is supposed to realise.
const closedForm = (response, order, ripple, ratio) => {
  if (response === 'butterworth') return 1 / Math.sqrt(1 + Math.pow(ratio, 2 * order));
  const eps = Math.sqrt(Math.pow(10, ripple / 10) - 1);
  const t = ratio <= 1 ? Math.cos(order * Math.acos(ratio)) : Math.cosh(order * Math.acosh(ratio));
  return 1 / Math.sqrt(1 + eps * eps * t * t);
};
let worst = 0;
for (const order of [1, 2, 3, 4, 5, 6, 7, 8]) {
  for (const ratio of [0.05, 0.3, 0.7, 0.99, 1, 1.4, 2, 5, 10]) {
    worst = Math.max(worst, Math.abs(C.s21(C.gValues('butterworth', order, 0.5), ratio) -
      closedForm('butterworth', order, 0, ratio)));
  }
}
assert.ok(worst < 1e-12, 'Butterworth ladder reproduces its response, worst ' + worst);
let worstCheb = 0;
for (const order of [1, 3, 5, 7]) {
  for (const ripple of [0.1, 0.5, 1, 3]) {
    for (const ratio of [0.05, 0.3, 0.7, 1, 1.4, 2, 5]) {
      worstCheb = Math.max(worstCheb, Math.abs(C.s21(C.gValues('chebyshev', order, ripple), ratio) -
        closedForm('chebyshev', order, ripple, ratio)));
    }
  }
}
assert.ok(worstCheb < 2e-4, 'Chebyshev ladder reproduces its response, worst ' + worstCheb);

// ---- Cutoff attenuation: 3.01 dB for Butterworth, the ripple for Chebyshev.
const butter5d = C.compute(Object.assign({}, DEFAULT, { response: 'butterworth' }));
assert.ok(near(butter5d.attenuationCutoff, 3.01, 1e-9), 'Butterworth is 3.01 dB at the cutoff');
for (const ripple of ['0.1', '0.5', '1', '3']) {
  const row = C.compute(Object.assign({}, DEFAULT, { rippleDb: ripple, order: '3', targetDb: '40' }));
  assert.ok(near(row.attenuationCutoff, Number(ripple), 0.01), 'Chebyshev cutoff loss equals the ripple');
}
assert.ok(near(C.compute(DEFAULT).threeDb, 105.926, 1e-3), '0.5 dB 5th-order 3 dB point');
const threeDbCheck = C.compute(DEFAULT);
assert.ok(near(-20 * Math.log10(C.s21(C.gValues('chebyshev', 5, 0.5), threeDbCheck.threeDb / 100)), 3.0103, 0.002),
  'the reported 3 dB frequency really is 3 dB down');
assert.ok(near(butter5d.threeDb, 100, 1e-9), 'Butterworth 3 dB point is the cutoff');

// ---- Order inversion: the order it reports meets the target, one less does not.
for (const setup of [
  { response: 'butterworth', stopRatio: '2', targetDb: '40', rippleDb: '0.5' },
  { response: 'butterworth', stopRatio: '1.5', targetDb: '20', rippleDb: '0.5' },
  { response: 'chebyshev', stopRatio: '1.6', targetDb: '30', rippleDb: '0.5' },
  { response: 'chebyshev', stopRatio: '2', targetDb: '25', rippleDb: '1' },
]) {
  const probe = C.compute(Object.assign({}, DEFAULT, setup, { order: '1' }));
  const need = probe.requiredOrder;
  assert.ok(need <= 8, 'reported order fits the tool');
  const meets = C.compute(Object.assign({}, DEFAULT, setup, { order: String(need) }));
  assert.ok(meets.attenuationStop >= Number(setup.targetDb) - 1e-9, 'reported order meets the target');
  const below = need - (setup.response === 'chebyshev' ? 2 : 1);
  if (below >= 1) {
    const short = C.compute(Object.assign({}, DEFAULT, setup, { order: String(below) }));
    assert.ok(short.attenuationStop < Number(setup.targetDb) + 1e-9, 'one order lower misses the target');
  }
}

// ---- Directions: a steeper skirt with a higher order or a Chebyshev ripple.
const b3 = C.compute(Object.assign({}, DEFAULT, { response: 'butterworth', order: '3' }));
const b5 = C.compute(Object.assign({}, DEFAULT, { response: 'butterworth', order: '5' }));
assert.ok(b5.attenuationStop > b3.attenuationStop, 'a higher order attenuates more');
const c3 = C.compute(Object.assign({}, DEFAULT, { order: '3' }));
assert.ok(c3.attenuationStop > b3.attenuationStop, 'Chebyshev rolls off faster than Butterworth of the same order');

// ---- Elements: alternating L and C, scaled by impedance and frequency.
const five = C.compute(DEFAULT);
assert.equal(five.elements.length, 5);
assert.deepEqual(Array.from(five.elements, (part) => part.type).join(''), 'LCLCL');
assert.ok(near(five.elements[0].value, 135.74, 0.005), 'first inductor in nH');
assert.ok(near(five.elements[1].value, 39.14, 0.005), 'second element is a shunt capacitor in pF');
const doubled = C.compute(Object.assign({}, DEFAULT, { impedance: '100' }));
assert.ok(near(doubled.elements[0].value, 2 * five.elements[0].value, 0.02), 'L scales with impedance');
assert.ok(near(doubled.elements[1].value, five.elements[1].value / 2, 0.02), 'C scales inversely');
const faster = C.compute(Object.assign({}, DEFAULT, { cutoffMhz: '200' }));
assert.ok(near(faster.elements[0].value, five.elements[0].value / 2, 0.02), 'L scales inversely with frequency');

// ---- Refusals, spelled out here and again in the catalog.
assert.equal(failure(Object.assign({}, DEFAULT, { order: '4' })),
  'An even-order Chebyshev ladder needs unequal terminations, so this tool offers odd orders only; choose 1, 3, 5 or 7, or switch to Butterworth.');
assert.equal(failure(Object.assign({}, DEFAULT, { response: 'bessel' })),
  'Pick a response from the list, Butterworth or Chebyshev; got "bessel".');
assert.equal(failure(Object.assign({}, DEFAULT, { order: '9' })), 'Order must be between 1 and 8; got 9.');
assert.equal(failure(Object.assign({}, DEFAULT, { order: '' })), 'Order must be a whole number from 1 to 8; got "".');
assert.equal(failure(Object.assign({}, DEFAULT, { cutoffMhz: '' })),
  'Cutoff frequency must be a number in MHz; got "".');
assert.equal(failure(Object.assign({}, DEFAULT, { cutoffMhz: 'abc' })),
  'Cutoff frequency must be a number in MHz; got "abc".');
assert.equal(failure(Object.assign({}, DEFAULT, { impedance: '0' })),
  'System impedance must be between 1 and 1000 ohms; got 0.');
assert.equal(failure(Object.assign({}, DEFAULT, { stopRatio: '1' })),
  'Stopband edge must be between 1.01 and 100 times the cutoff; got 1.');
assert.equal(failure(Object.assign({}, DEFAULT, { targetDb: '0' })),
  'Target attenuation must be between 0.1 and 120 dB; got 0.');
assert.equal(failure(Object.assign({}, DEFAULT, { rippleDb: '3', targetDb: '2' })),
  'A 3 dB Chebyshev ripple already loses that much at the cutoff, so a 2 dB stopband target cannot be met; raise the target above the ripple or lower the ripple.');

// ---- Determinism and input immutability.
const probe = Object.assign({}, DEFAULT, { cutoffMhz: '433.92' });
const snapshot = JSON.stringify(probe);
assert.equal(C.compute(probe).attenuationStop, C.compute(probe).attenuationStop, 'deterministic');
assert.equal(JSON.stringify(probe), snapshot, 'input is not mutated');

// ---- The catalog record and every case in it.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'LC Low-Pass Filter Designer');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.legacyCategory, null);
assert.ok(record.description.length >= 80 && record.description.length <= 300, 'description length');
assert.equal(record.testCases.length, 21, 'catalog case count');
assert.equal(record.sources.length, 2, 'two references');
assert.ok(/^https:\/\//.test(record.sources[0].url), 'source URL');
assert.ok(record.sources[0].title.length > 20 && record.sources[0].title.includes('prototype'), 'source title names the part used');
assert.ok(record.method.length > 800, 'method explains the formulas');
assert.ok(record.tags.includes('low-pass') && record.tags.includes('chebyshev'), 'tags');
assert.ok(record.guidance.length > 40, 'guidance');

const others = catalog.tools.filter((tool) => tool.slug !== slug);
const takenSlugs = new Set(others.map((tool) => tool.slug));
const takenNames = new Set(others.map((tool) => tool.name.toLowerCase()));
const takenAliases = new Set();
for (const tool of others) for (const alias of tool.aliases || []) takenAliases.add(alias.toLowerCase());
assert.ok(!takenSlugs.has(slug), 'slug collides with another tool');
assert.ok(!takenNames.has(record.name.toLowerCase()), 'name collides with another tool');
for (const alias of record.aliases) {
  const key = alias.toLowerCase();
  assert.ok(!takenAliases.has(key), 'alias collides with another alias: ' + alias);
  assert.ok(!takenNames.has(key), 'alias repeats another tool name: ' + alias);
}
assert.ok(record.aliases.includes(record.name), 'the page title is listed as an alias');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'alias duplicates');

let goldens = 0;
let refusals = 0;
for (const testCase of record.testCases) {
  assert.ok(testCase.name && testCase.input, 'malformed case');
  if (testCase.kind === 'golden') {
    const result = C.compute(testCase.input);
    for (const [key, want] of Object.entries(testCase.expected)) {
      assert.equal(typeof result[key], 'number', testCase.name + ': ' + key + ' is a number');
      assert.ok(near(result[key], want), testCase.name + ': ' + key + ' (' + result[key] + ' vs ' + want + ')');
    }
    assert.equal(result.elements.length, result.order, testCase.name + ': one element per order');
    testCase.expectedElements.forEach((want, index) => {
      assert.ok(near(result.elements[index].value, want), testCase.name + ': element ' + (index + 1) +
        ' (' + result.elements[index].value + ' vs ' + want + ')');
    });
    assert.ok(near(result.attenuationCutoff,
      testCase.input.response === 'butterworth' ? 3.01 : Number(testCase.input.rippleDb), 0.01),
      testCase.name + ': cutoff loss');
    goldens += 1;
  } else {
    assert.equal(testCase.kind, 'validation');
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    refusals += 1;
  }
}
assert.equal(goldens, 11, 'golden cases');
assert.equal(refusals, 10, 'refusal cases');

// ---- Catalog totals pinned site-wide.
assert.equal(catalog.tools.length, 2530, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2269, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Communications Engineering').length, 58,
  'Communications Engineering count');

// ---- Page contract.
assert.match(html, /<title>LC Low-Pass Filter Designer/);
assert.match(html, /<meta name="description" content="Design a passive LC low-pass ladder/);
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.ok(html.includes('/assets/app.js'));
for (const id of ['in-response', 'in-ripple', 'in-order', 'in-cutoff', 'in-impedance', 'in-stop', 'in-target']) {
  assert.ok(html.includes('id="' + id + '"'), 'input ' + id);
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id);
}
assert.ok(html.includes('role="status" aria-live="polite"'), 'live status');
assert.ok(html.includes('role="alert"'), 'error alert');
assert.ok((html.match(/<button\b[^>]*>/g) || []).every((tag) => /type="(button|submit)"/.test(tag)), 'button types');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline handlers');
assert.ok(!/eval\(|new Function\(/.test(html), 'no eval');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/https?:\/\//.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, '')), 'no off-site references in markup');
assert.equal((html.match(/<script(?![^>]*\bsrc=)/g) || []).length, 1, 'one inline script');
assert.ok(html.includes('<h1>LC Low-Pass Filter Designer</h1>'));
assert.ok(html.includes('<h3>How this is worked out</h3>'));
assert.ok(html.includes('<h3>What this does not do</h3>'));
assert.ok(html.includes('Nothing is saved'), 'storage disclosure');
assert.ok(html.includes('id="ripple-field"'), 'ripple field');
assert.equal(new Set((html.match(/id="[^"]+"/g) || [])).size, (html.match(/id="[^"]+"/g) || []).length,
  'no duplicate ids');

console.log('lc low-pass filter designer: ' + goldens + ' goldens, ' + refusals +
  ' refusals, response identities, page and catalog contract ok');
