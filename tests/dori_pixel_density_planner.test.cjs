/* DORI pixel density planner: the density model, its four IEC 62676-4 levels,
   the reach of each level, refusals, an independent vertical-axis model, the
   catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'dori-pixel-density-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* dori-core:start */';
const endMarker = '/* dori-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = DoriCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, label, tolerance) => {
  const limit = tolerance === undefined ? 1e-9 : tolerance;
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= limit * scale,
    label + ': ' + actual + ' is not within ' + limit + ' of ' + expected);
};
const solve = (input) => plain(C.solve(input));
const failure = (input) => {
  try { C.solve(input); } catch (error) { return error.message; }
  return null;
};
const input = (width, height, hfov, distance) => ({
  width: String(width), height: String(height), hfov: String(hfov), distance: String(distance)
});

// ---- Constants and the exported surface.
assert.equal(C.FACE_WIDTH_M, 0.16, 'a face is 0.16 m wide');
assert.deepEqual(plain(C.LEVELS).map((level) => [level.key, level.ppm]), [
  ['identify', 250], ['recognise', 125], ['observe', 62.5], ['detect', 25]
], 'the four IEC 62676-4 levels, most demanding first');
assert.equal(C.MIN_PIXELS, 16);
assert.equal(C.MAX_PIXELS, 32768);
assert.equal(C.MAX_DISTANCE, 10000);
assert.deepEqual(plain(Object.keys(C)).sort(), [
  'FACE_WIDTH_M', 'FT_PER_M', 'LEVELS', 'MAX_DISTANCE', 'MAX_PIXELS', 'MESSAGES', 'MIN_PIXELS',
  'describe', 'halfSpanPerMetre', 'isNumber', 'levelFor', 'parseDistance', 'parseFov',
  'parsePixels', 'round', 'solve'
]);

// ---- The field of view enters only through its half-angle tangent.
near(C.halfSpanPerMetre(90), 1, 'tan of 45 degrees', 1e-12);
near(C.halfSpanPerMetre(60), Math.tan(Math.PI / 6), 'tan of 30 degrees', 1e-12);
assert.ok(C.halfSpanPerMetre(179) > 100, 'a very wide lens spans a very wide scene');

// ---- Level classification uses the threshold as inclusive.
assert.equal(C.levelFor(250).key, 'identify', 'exactly 250 px/m identifies');
assert.equal(C.levelFor(249.999).key, 'recognise');
assert.equal(C.levelFor(125).key, 'recognise');
assert.equal(C.levelFor(62.5).key, 'observe');
assert.equal(C.levelFor(25).key, 'detect');
assert.equal(C.levelFor(24.99), null, 'below 25 px/m is below detection');

// ---- A worked case: 1920 px across a 60 degree view at 10 m.
const base = solve(input(1920, 1080, 60, 10));
near(base.sceneWidth, 2 * 10 * Math.tan(Math.PI / 6), 'scene width', 1e-12);
near(base.sceneHeight, 2 * 10 * Math.tan(Math.PI / 6) * 1080 / 1920, 'scene height', 1e-12);
near(base.ppm, 1920 / (2 * 10 * Math.tan(Math.PI / 6)), 'density', 1e-12);
near(base.facePixels, base.ppm * 0.16, 'face pixels', 1e-12);
near(base.vfov, 2 * Math.atan(Math.tan(Math.PI / 6) * 1080 / 1920) * 180 / Math.PI, 'vertical fov', 1e-12);
assert.equal(base.level, 'recognise');
assert.equal(base.levelLabel, 'Recognise');
assert.equal(base.requiredWidth, 2887, 'scene width x 250, rounded up');
assert.equal(base.levels.length, 4);
assert.deepEqual(base.levels.map((level) => level.key), ['identify', 'recognise', 'observe', 'detect']);
assert.deepEqual(base.levels.map((level) => level.met), [false, true, true, true]);

// ---- The reach of each level falls as the requirement tightens.
assert.ok(base.maxIdentify < base.maxRecognise && base.maxRecognise < base.maxObserve &&
  base.maxObserve < base.maxDetect, 'reaches stay ordered');
for (const level of base.levels) {
  near(C.solve(input(1920, 1080, 60, level.maxDistance)).ppm, level.ppm,
    'reach lands on the threshold for ' + level.key, 1e-9);
  assert.equal(C.solve(input(1920, 1080, 60, level.maxDistance)).level, level.key,
    'a distance exactly at the reach meets ' + level.key);
}

// ---- Square pixels: the vertical axis gives the same density, checked through a
// separate path that derives the vertical field of view from the sensor aspect.
const verticalPpm = (width, height, hfov, distance) => {
  const span = Math.tan(hfov * Math.PI / 360);
  const vfov = 2 * Math.atan(span * height / width);
  return height / (2 * distance * Math.tan(vfov / 2));
};
for (const [width, height, hfov, distance] of [
  [1920, 1080, 60, 10], [2560, 1440, 90, 25], [3840, 2160, 40, 30],
  [1280, 720, 30, 5], [1000, 1000, 90, 1], [2592, 1944, 75, 12.5]
]) {
  near(C.solve(input(width, height, hfov, distance)).ppm,
    verticalPpm(width, height, hfov, distance),
    'vertical density agrees for ' + width + 'x' + height, 1e-12);
}

// ---- A small-angle cross-check: at fine pixel pitches and a modest field of view
// the density approaches one over the distance times the angle each pixel subtends.
{
  const width = 4000, hfov = 10, distance = 15;
  const perPixel = (hfov * Math.PI / 180) / width;
  const approximation = 1 / (distance * perPixel);
  const exact = C.solve(input(width, 3000, hfov, distance)).ppm;
  assert.ok(Math.abs(exact - approximation) / exact < 0.005,
    'angle-per-pixel approximation within half a percent: ' + exact + ' vs ' + approximation);
}

// ---- Randomised sweep against the independent model and its invariants.
let seed = 20261119;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const rankOf = (result) => (result.level === null
  ? 0 : C.LEVELS.length - C.LEVELS.findIndex((level) => level.key === result.level));
for (let trial = 0; trial < 400; trial += 1) {
  const width = 16 + Math.floor(random() * 8000);
  const height = 16 + Math.floor(random() * 8000);
  const hfov = 1 + random() * 178;
  const distance = 0.1 + random() * 400;
  const result = C.solve(input(width, height, hfov, distance));
  near(result.ppm, verticalPpm(width, height, hfov, distance),
    'sweep density ' + trial, 1e-9);
  near(result.ppm * result.sceneWidth, width, 'width recovered ' + trial, 1e-12);
  near(result.ppm * result.sceneHeight, height, 'height recovered ' + trial, 1e-12);
  assert.ok(result.sceneWidth > 0 && result.sceneHeight > 0, 'positive scene ' + trial);
  assert.ok(result.facePixels > 0, 'positive face pixels ' + trial);
  assert.equal(result.requiredWidth, Math.ceil(result.sceneWidth * 250), 'required width ' + trial);
  // Doubling the distance halves the density.
  const doubled = C.solve(input(width, height, hfov, distance * 2));
  near(doubled.ppm, result.ppm / 2, 'inverse square-free falloff ' + trial, 1e-9);
  // Within one configuration the rank never rises as the subject walks away.
  assert.ok(rankOf(result) >= rankOf(doubled), 'level rank falls with distance ' + trial);
  for (let index = 1; index < result.levels.length; index += 1) {
    assert.ok(result.levels[index - 1].maxDistance < result.levels[index].maxDistance,
      'reach order ' + trial);
    assert.equal(result.levels[index].met, result.ppm >= result.levels[index].ppm,
      'met flag ' + trial);
  }
}

// ---- A required width reproduces its level at that distance.
let checkedWidths = 0;
for (let trial = 0; trial < 100; trial += 1) {
  const width = 200 + Math.floor(random() * 7000);
  const height = 200 + Math.floor(random() * 7000);
  const hfov = 5 + random() * 60;
  const distance = 0.5 + random() * 15;
  const result = C.solve(input(width, height, hfov, distance));
  const need = result.requiredWidth;
  if (need > C.MAX_PIXELS) continue;
  checkedWidths += 1;
  const exact = C.solve(input(need, height, hfov, distance)).ppm;
  assert.ok(exact >= 250 - 1e-9, 'required width identifies ' + trial + ': ' + exact);
  if (need > C.MIN_PIXELS) {
    const short = C.solve(input(need - 1, height, hfov, distance)).ppm;
    assert.ok(short < 250, 'one pixel fewer falls short ' + trial + ': ' + short);
  }
}
assert.ok(checkedWidths >= 40, 'required-width round trips exercised: ' + checkedWidths);

// ---- Refusals stay specific.
assert.equal(failure({ width: '', height: '1080', hfov: '60', distance: '10' }),
  'Enter the frame width in pixels.');
assert.equal(failure({ width: '1920.5', height: '1080', hfov: '60', distance: '10' }),
  'Write the frame width as a whole number of pixels.');
assert.equal(failure({ width: '8', height: '1080', hfov: '60', distance: '10' }),
  'The frame width must be between 16 and 32,768 pixels.');
assert.equal(failure({ width: '1920', height: '', hfov: '60', distance: '10' }),
  'Enter the frame height in pixels.');
assert.equal(failure({ width: '1920', height: '1080px', hfov: '60', distance: '10' }),
  'Write the frame height as a whole number of pixels.');
assert.equal(failure({ width: '1920', height: '40000', hfov: '60', distance: '10' }),
  'The frame height must be between 16 and 32,768 pixels.');
assert.equal(failure({ width: '1920', height: '1080', hfov: '', distance: '10' }),
  'Enter the horizontal field of view.');
assert.equal(failure({ width: '1920', height: '1080', hfov: 'wide', distance: '10' }),
  'Write the field of view in degrees, for example 60 or 87.5.');
assert.equal(failure({ width: '1920', height: '1080', hfov: '180', distance: '10' }),
  'The field of view must be greater than 0 and less than 180 degrees.');
assert.equal(failure({ width: '1920', height: '1080', hfov: '0', distance: '10' }),
  'The field of view must be greater than 0 and less than 180 degrees.');
assert.equal(failure({ width: '1920', height: '1080', hfov: '60', distance: '' }),
  'Enter the distance to the subject.');
assert.equal(failure({ width: '1920', height: '1080', hfov: '60', distance: 'ten metres' }),
  'Write the distance in metres, for example 12 or 7.5.');
assert.equal(failure({ width: '1920', height: '1080', hfov: '60', distance: '0' }),
  'The distance must be greater than 0 and at most 10,000 m.');
assert.equal(failure({ width: '1920', height: '1080', hfov: '60', distance: '10001' }),
  'The distance must be greater than 0 and at most 10,000 m.');

// ---- The limits themselves are accepted.
assert.equal(C.solve(input(16, 16, 1, 0.1)).width, 16);
assert.equal(C.solve(input(32768, 16, 179, 10000)).width, 32768);

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'DORI Pixel Density Planner');
assert.equal(entry.category, 'IT & Networking');
assert.equal(entry.subcategory, 'Planning');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(entry.icon, '\u{1F3AF}');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 900, 'method must document the model and its limits');
assert.equal(entry.sources.length, 2);
assert.ok(entry.sources.every((source) => /^https:\/\//.test(source.url)), 'https sources');
assert.equal(entry.testCases.length, 24, 'catalog case count');
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'golden').length, 6);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'boundary').length, 5);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'validation').length, 13);

for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = solve(testCase.input);
  for (const [field, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') near(result[field], expected, testCase.name + ' ' + field, 2e-6);
    else assert.equal(result[field], expected, testCase.name + ' ' + field);
  }
}

// ---- A slug, name or alias belongs to one tool only.
const names = new Map();
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  for (const value of [tool.name, ...(tool.aliases || [])]) {
    const key = value.toLowerCase();
    if (!names.has(key)) names.set(key, new Set());
    names.get(key).add(tool.slug);
  }
}
for (const value of [entry.name, ...entry.aliases]) {
  assert.ok(!names.has(value.toLowerCase()), 'name or alias is not taken: ' + value);
}
assert.ok(!catalog.tools.some((tool) => tool.slug === slug && tool.name !== entry.name));

// ---- Page contract.
assert.ok(/<h1>DORI Pixel Density Planner<\/h1>/.test(html), 'heading');
assert.ok(/<form id="dori-form" novalidate>/.test(html), 'form');
for (const id of ['in-width', 'in-height', 'in-fov', 'in-distance', 'err', 'run', 'out',
  'headline', 'sub', 'fact-width', 'fact-height', 'fact-density', 'fact-face', 'fact-needed', 'rows']) {
  assert.ok(html.includes('id="' + id + '"'), 'element id: ' + id);
}
for (const label of ['Frame width', 'Frame height', 'Horizontal field of view', 'Distance to subject']) {
  assert.ok(html.includes('>' + label + '</label>'), 'label: ' + label);
}
assert.ok(/<button type="submit" id="run">Calculate pixel density<\/button>/.test(html), 'submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/Nothing is sent or stored/.test(html), 'the note states local only');
assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(html), 'no off-site links or requests');
assert.ok(!/<script[^>]+src="(?!\/assets\/)/.test(html), 'only local scripts');
assert.ok(!/\son(click|input|change|submit|keydown)=/.test(html), 'no inline event handlers');
assert.equal(html.match(/<script/g).length, 3, 'theme init, shared app and the tool script');
assert.ok(/min-height:44px/.test(html), '44px touch targets');
assert.ok(/<caption>/.test(html) && /scope="col"/.test(html), 'table caption and headers');
const ids = html.match(/\bid="[^"]+"/g).map((value) => value.slice(4, -1));
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');

console.log('dori pixel density planner: all assertions passed');
