/* Regression checks for the picture-in-picture layout planner core and catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'picture-in-picture-layout-planner';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* pip-layout-core:start */');
const end = html.indexOf('/* pip-layout-core:end */');
assert.ok(start > -1 && end > start, 'picture-in-picture core markers missing');
const core = html.slice(start, end + '/* pip-layout-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PipLayoutCore;', sandbox);
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

// --- Independent reference: exact integer arithmetic, no shared code paths. ---
const ratioParts = (text) => {
  const value = String(text).trim();
  if (value.includes(':') || value.includes('/')) {
    const [a, b] = value.replace('/', ':').split(':').map(Number);
    return [a, b];
  }
  return [Number(value), 1];
};
const reference = (input) => {
  const state = { ...C.DEFAULTS, ...input };
  const frameW = Number(String(state.frameWidth).trim());
  const frameH = Number(String(state.frameHeight).trim());
  const [a, b] = ratioParts(state.aspect);
  const size = Number(String(state.size).trim());
  const margin = Number(String(state.margin).trim());
  const even = state.align === 'even';
  // Width: floor to an even number by halving the exact numerator, or round half up.
  const width = even
    ? Math.max(2, 2 * Math.floor((frameW * size) / 200))
    : Math.max(2, Math.floor((frameW * size) / 100 + 0.5));
  const height = even
    ? Math.max(2, 2 * Math.floor((width * b) / (2 * a)))
    : Math.max(2, Math.floor((width * b) / a + 0.5));
  const marginPx = Math.floor((frameW * margin) / 100 + 0.5);
  const x = state.corner.includes('right') ? frameW - marginPx - width : marginPx;
  const y = state.corner.includes('bottom') ? frameH - marginPx - height : marginPx;
  const fits = x >= 0 && y >= 0 && width + 2 * marginPx <= frameW && height + 2 * marginPx <= frameH;
  // 5% safe edges compared by cross-multiplication: x >= W/20 is 20x >= W.
  const safe = fits
    && 20 * x >= frameW && 20 * y >= frameH
    && 20 * (x + width) <= 19 * frameW && 20 * (y + height) <= 19 * frameH;
  return { width, height, x, y, marginPx, fits, safe };
};

// Deterministic linear congruential generator keeps the sweep reproducible.
let seed = 20261110;
const nextRandom = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (list) => list[Math.floor(nextRandom() * list.length)];
const frames = [[1920, 1080], [3840, 2160], [1080, 1920], [1080, 1080], [640, 360], [16384, 9216], [64, 64], [1440, 1080]];
const aspects = ['16:9', '9:16', '4:3', '1:1', '2.39:1', '1.85:1', '21:9'];
const corners = C.CORNERS;
let compared = 0;
let fits = 0;
let safeCount = 0;
for (let i = 0; i < 4000; i += 1) {
  const [frameWidth, frameHeight] = pick(frames);
  const aspect = pick(aspects);
  const input = {
    frameWidth, frameHeight, aspect,
    size: 5 + Math.floor(nextRandom() * 91),
    margin: Math.floor(nextRandom() * 21),
    corner: pick(corners),
    align: pick(['even', 'none']),
  };
  const expected = reference(input);
  let result;
  try {
    result = run(input);
  } catch (error) {
    assert.equal(expected.fits, false, `${JSON.stringify(input)} rejected: ${error.message}`);
    assert.match(error.message, /does not fit inside/, 'overflow must be reported as a fit error');
    continue;
  }
  assert.equal(expected.fits, true, `${JSON.stringify(input)} accepted but reference says it overflows`);
  assert.equal(result.width, expected.width, `width ${JSON.stringify(input)}`);
  assert.equal(result.height, expected.height, `height ${JSON.stringify(input)}`);
  assert.equal(result.x, expected.x, `x ${JSON.stringify(input)}`);
  assert.equal(result.y, expected.y, `y ${JSON.stringify(input)}`);
  assert.equal(result.marginPx, expected.marginPx, `margin ${JSON.stringify(input)}`);
  assert.equal(result.safe, expected.safe, `safe ${JSON.stringify(input)}`);
  assert.equal(result.overlay, `[1:v]scale=${result.width}:${result.height}[inset];[0:v][inset]overlay=${result.x}:${result.y}`);
  // Every rectangle stays inside the frame and its aspect ratio matches the source.
  assert.ok(result.x >= 0 && result.y >= 0, 'negative corner');
  assert.ok(result.x + result.width <= frameWidth && result.y + result.height <= frameHeight, 'rectangle leaves the frame');
  const [a, b] = ratioParts(aspect);
  const drift = Math.abs(result.width / result.height - a / b) / (a / b);
  if (drift > 0.02) {
    assert.ok(result.warnings.some((line) => line.includes('cannot hold its')),
      `aspect drift of ${(drift * 100).toFixed(1)}% must be warned: ${JSON.stringify(input)}`);
  }
  if (result.align === 'even') {
    assert.equal(result.width % 2, 0, 'even width');
    assert.equal(result.height % 2, 0, 'even height');
  }
  compared += 1;
  if (result.safe) safeCount += 1;
  else fits += 1;
}
assert.ok(compared > 2000, `sweep compared only ${compared} layouts`);
assert.ok(safeCount > 200 && fits > 200, 'sweep must exercise both safe and unsafe layouts');

// --- Catalog cases: golden and boundary values, then validation messages. ---
const kinds = Object.fromEntries(['golden', 'boundary', 'validation'].map((kind) =>
  [kind, entry.testCases.filter((testCase) => testCase.kind === kind).length]));
assert.deepEqual(kinds, { golden: 8, boundary: 6, validation: 14 });
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  const expected = reference({ ...C.DEFAULTS, ...testCase.input });
  for (const [key, value] of Object.entries(testCase.expected)) {
    const actual = result[key];
    if (typeof value === 'number') near(actual, value, `${testCase.name} ${key}`);
    else assert.equal(actual, value, `${testCase.name} ${key}`);
  }
  assert.equal(result.width, expected.width, `${testCase.name} width`);
  assert.equal(result.height, expected.height, `${testCase.name} height`);
  assert.equal(result.safe, expected.safe, `${testCase.name} safe`);
}

// Documented anchors that a reviewer can check by hand.
const standard = run({});
assert.deepEqual(
  { width: standard.width, height: standard.height, x: standard.x, y: standard.y, marginPx: standard.marginPx },
  { width: 480, height: 270, x: 1363, y: 733, marginPx: 77 }
);
assert.equal(standard.safe, false, 'a 4% margin sits inside the 5% safe edge');
assert.match(standard.summary, /480 × 270 px inset at bottom right/);
const onSafeLine = run({ margin: 5 });
assert.equal(onSafeLine.safe, true, 'a 5% margin is exactly on the safe line');
assert.equal(onSafeLine.x + onSafeLine.width, 1824);
const tall = run({ frameWidth: 1080, frameHeight: 1920, aspect: '9:16', size: 40, margin: 5, corner: 'top-right' });
assert.equal(tall.safe, false, '5% of the width is less than the 5% height safe edge on a vertical frame');
assert.ok(tall.warnings.some((line) => line.includes('smallest edge clearance is 54 px')));
assert.equal(C.snap(480.9, 'even'), 480);
assert.equal(C.snap(481.2, 'none'), 481);
assert.equal(C.snap(1.2, 'even'), 2, 'even snapping never returns zero');
assert.equal(C.parseAspect('16/9').ratio.toFixed(4), '1.7778');
near(C.parseAspect('1.85').ratio, 1.85, 'numeric aspect');

// --- Static offline, accessibility and DOM-wiring contract. ---
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|navigator\.clipboard/.test(html), 'no network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'no remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote styles');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(!/\beval\(|new Function/.test(html), 'no dynamic code evaluation');
assert.ok(html.includes('<form id="pip-form"'), 'form missing');
assert.ok(html.includes('aria-live="polite"'), 'live result missing');
assert.ok(html.includes('role="status"'), 'status role missing');
assert.ok(html.includes('@media(max-width:640px)'), 'mobile breakpoint missing');
assert.ok(html.includes('min-height:44px'), '44 px controls required');
for (const id of ['in-frameWidth', 'in-frameHeight', 'in-aspect', 'in-size', 'in-margin', 'in-corner', 'in-align']) {
  assert.ok(html.includes(`id="${id}"`), `control ${id} missing`);
  assert.ok(html.includes(`for="${id}"`), `label ${id} missing`);
}
for (const id of ['preset-webcam', 'preset-vertical', 'preset-square', 'preset-4k', 'calculate', 'reset']) {
  assert.ok(html.includes(`id="${id}"`), `button ${id} missing`);
}
const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate HTML id');
for (const match of html.matchAll(/getElementById\('([^']+)'\)/g)) {
  assert.ok(ids.includes(match[1]), `script references missing id ${match[1]}`);
}
assert.ok(html.includes('src="/assets/theme-init.js"'), 'theme bootstrap missing');
assert.ok(html.includes('href="/assets/style.css"'), 'shared stylesheet missing');
assert.ok(html.includes('src="/assets/tools.js"') && html.includes('src="/assets/app.js"'), 'shared scripts missing');

// --- Catalog record contract. ---
assert.equal(entry.name, 'Picture-in-Picture Layout Planner');
assert.equal(entry.category, 'Video');
assert.equal(entry.subcategory, 'Planning');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.sources.length, 3);
assert.ok(entry.method.includes('90% title-safe box') && entry.method.includes('2 px'));
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.equal(catalog.tools.length, 2201);
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
    && [tool.slug, tool.name, ...(tool.aliases || [])].some((other) => String(other).toLowerCase() === key));
  assert.equal(clash.length, 0, `${value} collides with ${clash.map((tool) => tool.slug)}`);
}

console.log(`Picture-in-picture layout: ${entry.testCases.length} catalog cases and ${compared} independent sweep layouts matched`);
