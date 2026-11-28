/* Regression checks for the wind profile core and its catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/wind-profile-calculator/index.html'), 'utf8');
const start = html.indexOf('/* wind-profile-core:start */');
const end = html.indexOf('/* wind-profile-core:end */');
assert.ok(start > -1 && end > start, 'wind profile core markers missing');
const core = html.slice(start, end + '/* wind-profile-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = WindProfileCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'wind-profile-calculator');
assert.ok(entry, 'catalog entry missing');
assert.equal(catalog.tools.length, 2528, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2267, 'public tools');
assert.ok(entry.testCases.length >= 20, `expected at least 20 cases, found ${entry.testCases.length}`);

const close = (actual, expected, message) => {
  assert.ok(Number.isFinite(actual), `${message}: not a finite number`);
  assert.ok(Math.abs(actual - expected) < 1e-5, `${message}: ${actual} vs ${expected}`);
};

for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(
      () => C.calculate(testCase.input),
      (error) => {
        assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
        return true;
      },
      `${label}: expected a refusal`
    );
    continue;
  }
  const result = C.calculate(testCase.input);
  const want = testCase.expected;
  close(result.targetSpeed, want.speed, `${label}: target speed`);
  close(result.ratio, want.ratio, `${label}: speed ratio`);
  close(result.powerRatio, want.powerRatio, `${label}: wind power ratio`);
  close(result.powerRatio, Math.pow(result.ratio, 3), `${label}: power ratio is the cube`);
  close(result.targetSpeed, result.speed * result.ratio, `${label}: target is the reference scaled`);
  assert.ok(result.profile.length >= 1, `${label}: a profile is always reported`);
  for (const point of result.profile) {
    assert.ok(point.height >= Math.min(result.refHeight, result.height) - 1e-9, `${label}: profile starts at the nearer height`);
    assert.ok(point.height <= Math.max(result.refHeight, result.height) + 1e-9, `${label}: profile stops at the farther height`);
  }
  const heights = result.profile.map((point) => point.height);
  assert.equal(new Set(heights).size, heights.length, `${label}: no duplicated profile heights`);
  for (let i = 1; i < result.profile.length; i += 1) {
    assert.ok(result.profile[i].height > result.profile[i - 1].height, `${label}: profile is sorted by height`);
  }
}

// The published exponent: a factor of nine in height at one seventh is about 1.369.
const openLand = C.calculate({ model: 'power', speed: '6.5', refHeight: '10', height: '90', exponent: '0.143' });
close(openLand.ratio, Math.pow(9, 0.143), 'nine times the height with a 0.143 exponent');
assert.ok(openLand.targetSpeed > 8.89 && openLand.targetSpeed < 8.91, '6.5 m/s at 10 m reads about 8.9 m/s at 90 m');
close(openLand.powerRatio, Math.pow(9, 0.143 * 3), 'the cube of the speed ratio');

// The same height is the same speed, in both models.
for (const model of ['power', 'log']) {
  const still = C.calculate({ model, speed: '7', refHeight: '60', height: '60', exponent: '0.143', roughness: '0.03' });
  assert.equal(still.ratio, 1, `${model}: the same height is a ratio of one`);
  assert.equal(still.targetSpeed, 7, `${model}: the same height reads the same speed`);
  assert.equal(still.powerRatio, 1, `${model}: the same height keeps the power ratio at one`);
}

// The log law is exactly the ratio of the two logarithms: 10 m to 100 m over suburb (z0 = 1 m) is a factor of two.
const suburb = C.calculate({ model: 'log', speed: '4', refHeight: '10', height: '100', roughness: '1' });
close(suburb.ratio, Math.log(100) / Math.log(10), 'the log law is the ratio of the two logarithms');
close(suburb.targetSpeed, 8, 'ten metres to a hundred over suburb doubles the speed');
close(suburb.ratio, 2, 'the factor of two at the ten-times guard');

// A metre of roughness needs ten metres of height before the model means anything.
assert.throws(
  () => C.calculate({ model: 'log', speed: '5', refHeight: '10', height: '90', roughness: '1.1' }),
  /ten times the roughness length/,
  'a height below ten roughness lengths is refused'
);
assert.doesNotThrow(() => C.calculate({ model: 'log', speed: '5', refHeight: '11', height: '90', roughness: '1.1' }));

// The two laws are close for open terrain, which is why one seventh is the default.
const logGrass = C.calculate({ model: 'log', speed: '6.5', refHeight: '10', height: '90', roughness: '0.03' });
assert.ok(Math.abs(openLand.ratio - logGrass.ratio) / logGrass.ratio < 0.01, 'the two laws agree within one percent over grass');

// Downward extrapolation is allowed and returns a lower speed; the profile still covers the two heights.
const down = C.calculate({ model: 'power', speed: '9', refHeight: '80', height: '10', exponent: '0.2' });
assert.ok(down.ratio < 1, 'coming down in height lowers the speed');
assert.equal(down.profile[0].height, 10, 'the lowest profile row is the target');
assert.equal(down.profile[down.profile.length - 1].height, 80, 'the highest profile row is the measurement');

// Numeric arguments are accepted as well as strings and do not drift.
close(
  C.calculate({ model: 'log', speed: 6.5, refHeight: 10, height: 80, roughness: 0.03 }).targetSpeed,
  C.calculate({ model: 'log', speed: '6.5', refHeight: '10', height: '80', roughness: '0.03' }).targetSpeed,
  'numeric inputs match string inputs'
);

// The slug, name, aliases and tags stay unique against the rest of the catalog.
const others = catalog.tools.filter((tool) => tool.slug !== entry.slug);
const folded = new Set();
for (const tool of others) {
  folded.add(tool.slug);
  folded.add(tool.name.toLowerCase());
  for (const alias of tool.aliases || []) folded.add(alias.toLowerCase());
}
assert.ok(!folded.has(entry.slug), 'slug collides');
assert.ok(!folded.has(entry.name.toLowerCase()), 'name collides');
for (const alias of entry.aliases) assert.ok(!folded.has(alias.toLowerCase()), `alias collides: ${alias}`);
assert.ok(entry.tags.includes('wind') && entry.tags.includes('hub-height'));
assert.equal(entry.category, 'Environment');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Environment').length, 58, 'Environment count');
assert.equal(entry.listed, true);
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.ok(entry.sources.length >= 2);
assert.ok(entry.sources.every((source) => source.url && source.url.startsWith('https://')), 'https sources');
assert.ok(entry.sources.some((source) => source.url.includes('Wind_profile_power_law')), 'power law cited');
assert.ok(entry.sources.some((source) => source.url.includes('Roughness_length')), 'roughness table cited');
assert.ok(!/https?:\/\//.test(entry.description), 'no links in the description');

// Page contract: the shared shell, labelled controls, and no network or dynamic-code sinks.
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.match(html, /href="\/assets\/style\.css"/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.equal((html.match(/<h1>/g) || []).length, 1);
assert.ok(!/\beval\s*\(/.test(html), 'eval is not allowed');
assert.ok(!/new\s+Function\s*\(/.test(html), 'new Function is not allowed');
assert.ok(!/\.innerHTML\s*=/.test(html), 'innerHTML is not allowed');
assert.ok(!/XMLHttpRequest|fetch\(|sendBeacon|WebSocket/.test(html), 'no network calls');
const pageUrls = (html.match(/https?:\/\/[^\s"'<>]+/g) || []).filter((url) => !url.includes('www.w3.org'));
assert.deepEqual(pageUrls, [], 'page markup is offline');
for (const id of ['speed', 'ref-height', 'height', 'model', 'exponent', 'roughness']) {
  assert.ok(html.includes(`for="${id}"`) && html.includes(`id="${id}"`), `control ${id}`);
}
for (const id of ['error', 'results', 'out-speed', 'out-ratio', 'out-power', 'out-kmh', 'rows', 'profile', 'method']) {
  assert.ok(html.includes(`id="${id}"`), `container ${id}`);
}
assert.ok(!/<button(?![^>]*\btype=)/.test(html), 'every button declares a type');
assert.match(html, /role="alert"/);
assert.match(html, /aria-live="polite"/);
assert.ok(!/\bsrc="\/(?!assets\/)/.test(html), 'only shared assets are loaded');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
assert.equal((html.match(/<option value="/g) || []).length, 10, 'two model options and eight roughness classes');
assert.ok(html.includes('value="power"') && html.includes('value="log"'), 'both models are offered');
assert.match(html, /\[hidden\]\{display:none!important\}/, 'hidden fields stay hidden');

console.log(`wind profile calculator: ${entry.testCases.length} catalog cases replayed`);
