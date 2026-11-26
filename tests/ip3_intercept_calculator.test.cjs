/* Regression checks for the Third-Order Intercept Calculator core and its catalog record.
 *
 * The intercept, suppression and dynamic-range figures are recomputed here without reusing the
 * page's expression: the output intercept is derived from the dB slope argument directly
 * (OIP3 = (2P1 + P2 - PIM) / 2), then compared over a dense input grid.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ip3-intercept-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* ip3-core:start */');
const end = html.indexOf('/* ip3-core:end */');
assert.ok(start > -1 && end > start, 'ip3 core markers missing');
const core = html.slice(start, end + '/* ip3-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = Ip3Core;', sandbox);
const raw = sandbox.module.exports;
const calc = (options) => JSON.parse(JSON.stringify(raw.calculate(options)));
const close = (actual, expected, where) =>
  assert.ok(Math.abs(actual - expected) <= 1e-6, where + ': ' + actual + ' != ' + expected);

// ---- Independent recomputation over a dense grid --------------------------
let combos = 0;
for (let t1 = -150; t1 <= 50; t1 += 10) {
  for (let t2 = -150; t2 <= 50; t2 += 10) {
    const top = Math.min(t1, t2);
    for (const drop of [1, 5, 17, 30, 60, 120]) {
      const im3 = top - drop;
      for (let gain = -20; gain <= 30; gain += 5) {
        for (const noise of [null, im3 - 3, im3 - 25, im3 - 80].filter((value) => value === null || value >= -300)) {
          const result = calc({ tone1: t1, tone2: t2, im3, gain, noise });
          const oip3 = (2 * t1 + t2 - im3) / 2;
          close(result.oip3, oip3, `OIP3 ${t1}/${t2}/${im3}`);
          close(result.iip3, oip3 - gain, `IIP3 ${t1}/${t2}/${im3}/${gain}`);
          close(result.suppression1, t1 - im3, 'suppression 1');
          close(result.suppression2, t2 - im3, 'suppression 2');
          assert.ok(result.suppression1 > 0 && result.suppression2 > 0, 'positive suppression');
          if (noise === null) {
            assert.equal(result.sfdr, null, 'no noise floor means no SFDR');
          } else {
            close(result.sfdr, (2 * (oip3 - noise)) / 3, 'SFDR');
            assert.ok(result.sfdr > 0, 'positive SFDR');
          }
          // Swapping the tones moves the intercept by half their difference.
          const swapped = calc({ tone1: t2, tone2: t1, im3, gain, noise });
          close(swapped.oip3, oip3 + (t2 - t1) / 2, 'swapped tones');
          // Deterministic replay.
          assert.deepEqual(calc({ tone1: t1, tone2: t2, im3, gain, noise }), result, 'deterministic');
          combos += 1;
        }
      }
    }
  }
}

// ---- Refusals --------------------------------------------------------------
const refusals = [
  [{ tone1: NaN, tone2: -10, im3: -70, gain: 0, noise: null }, raw.MESSAGES.tone1],
  [{ tone1: -10, tone2: NaN, im3: -70, gain: 0, noise: null }, raw.MESSAGES.tone2],
  [{ tone1: -10, tone2: -10, im3: NaN, gain: 0, noise: null }, raw.MESSAGES.im3],
  [{ tone1: -10, tone2: -10, im3: -70, gain: NaN, noise: null }, raw.MESSAGES.gain],
  [{ tone1: 'x', tone2: -10, im3: -70, gain: 0, noise: null }, raw.MESSAGES.tone1],
  [{ tone1: -201, tone2: -10, im3: -70, gain: 0, noise: null }, raw.MESSAGES.tone1],
  [{ tone1: -10, tone2: 101, im3: -70, gain: 0, noise: null }, raw.MESSAGES.tone2],
  [{ tone1: -10, tone2: -10, im3: -301, gain: 0, noise: null }, raw.MESSAGES.im3],
  [{ tone1: -10, tone2: -10, im3: 101, gain: 0, noise: null }, raw.MESSAGES.im3],
  [{ tone1: -10, tone2: -10, im3: -70, gain: 101, noise: null }, raw.MESSAGES.gain],
  [{ tone1: -10, tone2: -10, im3: -10, gain: 0, noise: null }, raw.MESSAGES.order],
  [{ tone1: -10, tone2: -10, im3: -9, gain: 0, noise: null }, raw.MESSAGES.order],
  [{ tone1: -30, tone2: -10, im3: -20, gain: 0, noise: null }, raw.MESSAGES.order],
  [{ tone1: -10, tone2: -10, im3: -70, gain: 0, noise: -70 }, raw.MESSAGES.floor],
  [{ tone1: -10, tone2: -10, im3: -70, gain: 0, noise: -60 }, raw.MESSAGES.floor],
  [{ tone1: -10, tone2: -10, im3: -70, gain: 0, noise: NaN }, raw.MESSAGES.noise],
  [{ tone1: -10, tone2: -10, im3: -70, gain: 0, noise: -301 }, raw.MESSAGES.noise],
];
for (const [input, message] of refusals) {
  assert.throws(() => calc(input), (error) => error.message === message, 'refusal ' + JSON.stringify(input));
}

// ---- Catalog record --------------------------------------------------------
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record');
assert.equal(record.name, 'Third-Order Intercept (IP3) Calculator');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1F53A}');
assert.ok(record.description.length > 150, 'description');
assert.ok(record.method.length > 800, 'method');
assert.equal(record.sources.length, 1, 'one source');
assert.ok(record.sources[0].url.startsWith('https://en.wikipedia.org/wiki/Third-order_intercept_point'), 'source URL');
assert.ok(record.sources[0].title.length > 40, 'source title');
for (const tag of record.tags) assert.equal(tag, tag.toLowerCase(), 'lowercase tags');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'unique aliases');
assert.ok(record.aliases.length >= 10, 'search aliases');

const ownValues = new Set([record.slug, record.name.toLowerCase(), ...record.aliases.map((a) => a.toLowerCase())]);
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  for (const value of [tool.slug, tool.name.toLowerCase(), ...tool.aliases.map((a) => a.toLowerCase())]) {
    assert.equal(ownValues.has(value), false, 'name, alias or slug already used: ' + value);
  }
}

const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2216, 'public tools');
assert.equal(
  catalog.tools.filter((tool) => tool.category === 'Communications Engineering').length,
  55,
  'Communications Engineering count'
);

// ---- Recorded cases replay through the page's parsing rules ----------------
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function parseLevel(value) {
  if (value === undefined || value === null) return NaN;
  const text = String(value).trim();
  if (!text || !DECIMAL.test(text)) return NaN;
  return Number(text);
}
assert.equal(record.testCases.length, 20, 'recorded cases');
for (const testCase of record.testCases) {
  const input = testCase.input;
  const options = {
    tone1: parseLevel(input.tone1),
    tone2: parseLevel(input.tone2),
    im3: parseLevel(input.im3),
    gain: parseLevel(input.gain),
    noise: input.noise === undefined || String(input.noise).trim() === '' ? null : parseLevel(input.noise),
  };
  if (testCase.expected.error) {
    assert.throws(() => calc(options), (error) => error.message === testCase.expected.error, testCase.name);
  } else {
    const result = calc(options);
    for (const key of ['oip3', 'iip3', 'suppression1', 'suppression2', 'sfdr']) {
      const want = testCase.expected[key];
      if (want === null) assert.equal(result[key], null, testCase.name + ': ' + key);
      else close(result[key], want, testCase.name + ': ' + key);
    }
  }
}

// ---- Page contract ---------------------------------------------------------
assert.ok(html.includes('<html lang="en"'));
assert.ok(html.includes('name="viewport"'));
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.ok(html.includes('<main'));
assert.ok(html.includes('<h1>Third-Order Intercept (IP3) Calculator</h1>'));
for (const id of ['in-tone1', 'in-tone2', 'in-im3', 'in-gain', 'in-noise', 'out']) {
  assert.ok(html.includes(`id="${id}"`), 'input ' + id);
  if (id !== 'out') assert.ok(html.includes(`for="${id}"`), 'label for ' + id);
}
assert.ok(html.includes('role="alert"'));
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('role="status"') || html.includes('setAttribute("role","status")'), 'live status region');
const markup = html.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, '');
assert.equal(/\son[a-z]+\s*=/i.test(markup), false, 'no inline event handlers');
for (const banned of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'eval(', 'new Function']) {
  assert.equal(html.includes(banned), false, 'page must not use ' + banned);
}
assert.ok(html.includes('min-height:44px'), '44 px action targets');
assert.ok(html.includes('@media(max-width'), 'mobile layout');
assert.ok(html.includes('navigator.clipboard'), 'copy button');
assert.ok(html.includes('var(--on-accent'), 'accent text colour token');

console.log(
  'ip3-intercept-calculator: ' + combos + ' measurements, ' + refusals.length + ' refusals, '
  + record.testCases.length + ' catalog cases'
);
