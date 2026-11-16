/* Regression checks for the Bearing L10 Rating Life Calculator core and its catalog record.
 *
 * The life figures are recomputed here without reusing the page's expression: revolutions are
 * evaluated as exp(p * ln(C/P)) rather than pow(), then the hour conversion is applied
 * separately, so an error in either step shows up on a dense input grid.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'bearing-l10-life-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* bearing-core:start */');
const end = html.indexOf('/* bearing-core:end */');
assert.ok(start > -1 && end > start, 'bearing core markers missing');
const core = html.slice(start, end + '/* bearing-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BearingCore;', sandbox);
const raw = sandbox.module.exports;
const calc = (options) => JSON.parse(JSON.stringify(raw.calculate(options)));
const close = (actual, expected, where, rel = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= Math.max(1e-6, Math.abs(expected) * rel),
    where + ': ' + actual + ' != ' + expected
  );

// ---- Independent recomputation over a dense grid --------------------------
let combos = 0;
const ratings = [1, 2.5, 5, 10, 21.6, 47, 100, 250, 480];
const loads = [0.1, 0.5, 2, 7.5, 20, 60];
const speeds = [10, 60, 300, 1500, 7200, 10000];
const exponents = { ball: 3, roller: 10 / 3 };

for (const type of ['ball', 'roller']) {
  const p = exponents[type];
  for (const rating of ratings) {
    for (const load of loads) {
      const ratio = rating / load;
      const revolutions = Math.exp(p * Math.log(ratio));
      for (const speed of speeds) {
        const hours = (revolutions * 1e6) / (60 * speed);
        const result = calc({ rating, load, speed, type });
        assert.equal(result.type, type, 'type echoed');
        close(result.ratio, ratio, `ratio ${rating}/${load}`);
        close(result.revolutions, revolutions, `${type} L10 ${rating}/${load}`);
        close(result.hours, hours, `${type} L10h ${rating}/${load}/${speed}`);
        close(result.exponent, p, 'exponent');
        assert.equal(result.belowValidatedRange, ratio < 2, 'validated-range flag');
        // The two output units must describe the same life (rounded revolutions only carry
        // six decimals, so compare once the rounding error is relatively small).
        if (result.revolutions >= 1) {
          close(result.hours, (result.revolutions * 1e6) / (60 * speed), 'unit conversion', 1e-6);
        }
        // Doubling the rating multiplies the life by 2^p; doubling the load divides it.
        close(calc({ rating: rating * 2, load, speed, type }).revolutions, revolutions * 2 ** p, 'doubled rating', 1e-9);
        close(calc({ rating, load: load * 2, speed, type }).revolutions, revolutions / 2 ** p, 'doubled load', 1e-9);
        // Deterministic replay.
        assert.deepEqual(calc({ rating, load, speed, type }), result, 'deterministic');
        combos += 1;
      }
    }
  }
}

// A roller bearing outlives a ball bearing of the same rating once the load is the larger factor.
for (const [rating, load] of [[100, 10], [21.6, 2], [50, 1]]) {
  const ball = calc({ rating, load, speed: 1000, type: 'ball' });
  const roller = calc({ rating, load, speed: 1000, type: 'roller' });
  assert.ok(roller.revolutions > ball.revolutions, 'roller exponent outlives ball at C > P');
}

// The caution starts strictly above half the rating.
assert.equal(calc({ rating: 40, load: 20, speed: 600, type: 'ball' }).belowValidatedRange, false, 'ratio 2 is inside the range');
assert.equal(calc({ rating: 39.999, load: 20, speed: 600, type: 'ball' }).belowValidatedRange, true, 'ratio below 2 raises the caution');

// ---- Refusals --------------------------------------------------------------
const refusals = [
  [{ rating: NaN, load: 2, speed: 2000, type: 'ball' }, raw.MESSAGES.rating],
  [{ rating: 'x', load: 2, speed: 2000, type: 'ball' }, raw.MESSAGES.rating],
  [{ rating: 0, load: 2, speed: 2000, type: 'ball' }, raw.MESSAGES.rating],
  [{ rating: -1, load: 2, speed: 2000, type: 'ball' }, raw.MESSAGES.rating],
  [{ rating: 1000001, load: 2, speed: 2000, type: 'ball' }, raw.MESSAGES.rating],
  [{ rating: Infinity, load: 2, speed: 2000, type: 'ball' }, raw.MESSAGES.rating],
  [{ rating: 21.6, load: NaN, speed: 2000, type: 'ball' }, raw.MESSAGES.load],
  [{ rating: 21.6, load: 0, speed: 2000, type: 'ball' }, raw.MESSAGES.load],
  [{ rating: 21.6, load: 1000001, speed: 2000, type: 'ball' }, raw.MESSAGES.load],
  [{ rating: 21.6, load: 2, speed: 0, type: 'ball' }, raw.MESSAGES.speed],
  [{ rating: 21.6, load: 2, speed: -5, type: 'ball' }, raw.MESSAGES.speed],
  [{ rating: 21.6, load: 2, speed: NaN, type: 'ball' }, raw.MESSAGES.speed],
  [{ rating: 21.6, load: 2, speed: 2000, type: 'needle' }, raw.MESSAGES.type],
  [{ rating: 21.6, load: 2, speed: 2000, type: '' }, raw.MESSAGES.type],
  [{ rating: 21.6, load: 2, speed: 2000, type: null }, raw.MESSAGES.type],
];
for (const [input, message] of refusals) {
  assert.throws(() => calc(input), (error) => error.message === message, 'refusal ' + JSON.stringify(input));
}

// ---- Catalog record --------------------------------------------------------
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record');
assert.equal(record.name, 'Bearing L10 Rating Life Calculator');
assert.equal(record.category, 'Mechanical & Structural Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{2B55}');
assert.ok(record.description.length > 150, 'description');
assert.ok(record.method.length > 800, 'method');
assert.equal(record.sources.length, 2, 'two sources');
assert.ok(record.sources[0].url.startsWith('https://bearingwizard.com/bearing-selection-calculation-principles/lifetime-calculation'), 'NTN source URL');
assert.ok(record.sources[0].title.length > 40, 'NTN source title');
assert.ok(record.sources[1].url.startsWith('https://medias.schaeffler.us/en/knowledge-center/rolling-bearings/load-carrying-capacity-and-life'), 'Schaeffler source URL');
assert.ok(record.sources[1].title.length > 40, 'Schaeffler source title');
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
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2076, 'public tools');
assert.equal(
  catalog.tools.filter((tool) => tool.category === 'Mechanical & Structural Engineering').length,
  48,
  'Mechanical & Structural Engineering count'
);

// ---- Recorded cases replay through the page's parsing rules ----------------
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function parseNumber(value) {
  if (value === undefined || value === null) return NaN;
  const text = String(value).trim();
  if (!text || !DECIMAL.test(text)) return NaN;
  return Number(text);
}
assert.equal(record.testCases.length, 20, 'recorded cases');
for (const testCase of record.testCases) {
  const input = testCase.input;
  const options = {
    rating: parseNumber(input.rating),
    load: parseNumber(input.load),
    speed: parseNumber(input.speed),
    type: input.type === undefined ? '' : String(input.type),
  };
  if (testCase.expected.error) {
    assert.throws(() => calc(options), (error) => error.message === testCase.expected.error, testCase.name);
  } else {
    const result = calc(options);
    for (const key of ['revolutions', 'hours', 'ratio', 'exponent']) {
      close(result[key], testCase.expected[key], testCase.name + ': ' + key);
    }
    assert.equal(result.belowValidatedRange, testCase.expected.belowValidatedRange, testCase.name + ': caution');
  }
}

// ---- Page contract ---------------------------------------------------------
assert.ok(html.includes('<html lang="en"'));
assert.ok(html.includes('name="viewport"'));
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.ok(html.includes('<main'));
assert.ok(html.includes('<h1>Bearing L10 Rating Life Calculator</h1>'));
for (const id of ['in-rating', 'in-load', 'in-speed', 'in-type', 'out']) {
  assert.ok(html.includes(`id="${id}"`), 'input ' + id);
  if (id !== 'out') assert.ok(html.includes(`for="${id}"`), 'label for ' + id);
}
assert.ok(html.includes('<select id="in-type"'), 'bearing type select');
assert.ok(html.includes('role="alert"'));
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('aria-atomic="true"'));
assert.ok(html.includes('setAttribute("role","status")'), 'live status region');
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
  'bearing-l10-life-calculator: ' + combos + ' measurements, ' + refusals.length + ' refusals, '
  + record.testCases.length + ' catalog cases'
);
