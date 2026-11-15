/* Regression checks for the segmented ring core, its catalog cases and the page's
   offline, no-storage contract. The oracle below derives the same figures from the
   regular-polygon interior angle and the law of cosines on the circumradius, so it
   never reuses the page's D sin(pi/n) form. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'segmented-ring-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* segmented-ring-core:start */');
const end = html.indexOf('/* segmented-ring-core:end */');
assert.ok(start > -1 && end > start, 'segmented ring core markers missing');
const core = html.slice(start, end + '/* segmented-ring-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SegmentedRingCore;', sandbox);
const C = sandbox.module.exports;

const closeTo = (actual, expected, label, epsilon) => assert.ok(
  Math.abs(actual - expected) < (epsilon === undefined ? 1e-6 : epsilon),
  label + ': ' + actual + ' vs ' + expected);

const DEFAULTS = { segments: '12', outer: '300', wall: '25', kerf: '3.2', rings: '1' };
const run = (overrides) => C.calculate(Object.assign({}, DEFAULTS, overrides));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return null;
};

// Independent model: interior angle of a regular n-gon gives the miter, and the
// chord length comes from the law of cosines on the half-diameter.
function oracle(n, outer, wall, kerf, rings) {
  const radiusOut = outer / 2;
  const radiusIn = (outer - 2 * wall) / 2;
  const central = (2 * Math.PI) / n;
  const chord = (radius) => Math.sqrt(radius * radius + radius * radius - 2 * radius * radius * Math.cos(central));
  const interior = ((n - 2) * 180) / n;
  const outerEdge = chord(radiusOut);
  const innerEdge = chord(radiusIn);
  const cut = outerEdge + kerf;
  return {
    angle: (180 - interior) / 2,
    included: interior,
    outerEdge,
    innerEdge,
    cutLength: cut,
    stripLength: n * cut,
    totalLength: n * cut * rings,
    kerfShare: cut > 0 ? kerf / cut : 0,
  };
}

// Documented surface.
assert.deepEqual({
  segments: Array.from(C.LIMITS.segments), outer: Array.from(C.LIMITS.outer),
  wall: Array.from(C.LIMITS.wall), kerf: Array.from(C.LIMITS.kerf),
  rings: Array.from(C.LIMITS.rings),
}, {
  segments: [3, 96], outer: [50, 2000], wall: [5, 250], kerf: [0, 6], rings: [1, 50],
});
assert.equal(C.MIN_INNER, 20);
assert.equal(C.MIN_EDGE, 8);
assert.equal(C.NARROW_EDGE, 20);
assert.equal(C.MIN_INNER_EDGE, 5);
assert.equal(C.KERF_SHARE, 0.1);
assert.deepEqual({ ...C.DEFAULTS }, { segments: 12, outer: 300, wall: 25, kerf: 3.2, rings: 1 });
assert.match(C.MESSAGES.inner, /inner diameter under 20 mm/);
assert.match(C.MESSAGES.edge, /outer edges under 8 mm/);

// The default ring, step by step.
const base = run();
assert.equal(base.segments, 12);
assert.equal(base.rings, 1);
assert.equal(base.joints, 12);
assert.equal(base.totalSegments, 12);
assert.equal(base.inner, 250);
assert.equal(base.angle, 15);
assert.equal(base.included, 150);
assert.equal(base.outerEdge, 77.646);
assert.equal(base.innerEdge, 64.705);
assert.equal(base.cutLength, 80.846);
assert.equal(base.stripLength, 970.149);
assert.equal(base.totalLength, 970.149);
assert.equal(base.kerfAllowance, 38.4);
assert.equal(base.warnings.length, 0);

// Sweep the documented envelope against the independent model.
let compared = 0;
const random = (() => {
  let state = 20261115;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
})();
for (let index = 0; index < 400; index += 1) {
  const n = 3 + Math.floor(random() * 94);
  const outer = 50 + random() * 1950;
  const wall = 5 + random() * Math.min(245, outer / 2 - 10 - 5);
  if (!(outer - 2 * wall >= 20)) continue;
  const kerf = random() * 6;
  const rings = 1 + Math.floor(random() * 50);
  const input = { segments: String(n), outer: outer.toFixed(2), wall: wall.toFixed(2), kerf: kerf.toFixed(2), rings: String(rings) };
  let result;
  try {
    result = C.calculate(input);
  } catch (error) {
    // Only the documented refusals may fire here.
    assert.ok([C.MESSAGES.inner, C.MESSAGES.edge].includes(error.message),
      'unexpected refusal for ' + JSON.stringify(input) + ': ' + error.message);
    continue;
  }
  const expected = oracle(n, Number(input.outer), Number(input.wall), Number(input.kerf), rings);
  closeTo(result.angle * n, 180, 'miter closes the ring', 0.01);
  closeTo(result.angle, expected.angle, 'oracle miter', 1e-4);
  closeTo(result.included, expected.included, 'oracle included angle', 1e-4);
  closeTo(result.outerEdge, expected.outerEdge, 'oracle outer edge', 0.002);
  closeTo(result.innerEdge, expected.innerEdge, 'oracle inner edge', 0.002);
  closeTo(result.cutLength, expected.cutLength, 'oracle cut length', 0.002);
  closeTo(result.stripLength, expected.stripLength, 'oracle strip length', 0.01);
  closeTo(result.totalLength, expected.totalLength, 'oracle total length', 0.02);
  closeTo(result.kerfShare, expected.kerfShare, 'oracle kerf share', 0.002);
  assert.equal(result.totalSegments, n * rings);
  assert.equal(result.joints, n);
  closeTo(result.inner, Number(input.outer) - 2 * Number(input.wall), 'inner diameter', 0.0015);
  assert.ok(result.innerEdge < result.outerEdge, 'inner edge is shorter than the outer edge');
  assert.ok(result.cutLength >= result.outerEdge, 'kerf only lengthens the cut');
  compared += 1;
}
assert.ok(compared > 300, 'sweep compared ' + compared + ' rings');

// Refusals, in page order, with the exact wording.
assert.equal(failure({ segments: '' }), 'Enter the number of segments per ring.');
assert.equal(failure({ segments: '2' }), 'Segments per ring must be a whole number from 3 to 96.');
assert.equal(failure({ segments: '97' }), 'Segments per ring must be a whole number from 3 to 96.');
assert.equal(failure({ segments: '12.5' }), 'Segments per ring must be a whole number from 3 to 96.');
assert.equal(failure({ outer: '' }), 'Enter the finished outer diameter.');
assert.equal(failure({ outer: '49' }), 'The outer diameter must be a number from 50 to 2000 mm.');
assert.equal(failure({ outer: 'wide' }), 'The outer diameter must be a number from 50 to 2000 mm.');
assert.equal(failure({ wall: '4' }), 'The wall thickness must be a number from 5 to 250 mm.');
assert.equal(failure({ wall: '300' }), 'The wall thickness must be a number from 5 to 250 mm.');
assert.equal(failure({ kerf: '' }), 'Enter the saw kerf.');
assert.equal(failure({ kerf: '7' }), 'The saw kerf must be a number from 0 to 6 mm.');
assert.equal(failure({ rings: '0' }), 'The number of rings must be a whole number from 1 to 50.');
assert.equal(failure({ rings: '51' }), 'The number of rings must be a whole number from 1 to 50.');
assert.equal(failure({ segments: '12', outer: '100', wall: '45' }),
  'That wall leaves an inner diameter under 20 mm; use a thinner wall or a larger diameter.');
assert.equal(failure({ segments: '96', outer: '50', wall: '5' }),
  'That many segments on this diameter leaves outer edges under 8 mm; use fewer segments or a larger diameter.');
// A wall that leaves exactly the 20 mm inner diameter limit is accepted.
const atLimit = run({ segments: '24', outer: '200', wall: '90' });
assert.equal(atLimit.inner, 20);
assert.ok(atLimit.warnings.includes(C.MESSAGES.innerEdge), 'inner edge warning expected');
// Decimal commas are accepted in every numeric field.
closeTo(run({ segments: '16', outer: '240,5', wall: '15', kerf: '3,2' }).outerEdge, 46.919, 'decimal comma run');

// Warnings.
const narrow = run({ segments: '48', outer: '300', wall: '25', kerf: '5' });
assert.ok(narrow.warnings.includes(C.MESSAGES.narrow), 'narrow segment warning');
assert.ok(narrow.warnings.includes(C.MESSAGES.kerfShare), 'kerf share warning');
assert.equal(narrow.warnings.length, 2);
const wide = run({ segments: '6', outer: '150', wall: '30', kerf: '0' });
assert.equal(wide.warnings.length, 0);

// Catalog cases replay.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2320, 'catalog total');
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(entry.category, 'Crafts & Hobbies');
assert.equal(entry.risk, 'low');
assert.equal(entry.listed, true);
assert.equal(entry.sources.length, 2);
for (const source of entry.sources) assert.match(source.url, /^https:\/\//);
assert.ok(entry.testCases.length >= 18, 'at least eighteen catalog cases');
let goldenCases = 0;
let validationCases = 0;
for (const testCase of entry.testCases) {
  const input = Object.assign({}, DEFAULTS, testCase.input);
  if (testCase.kind === 'golden') {
    const result = C.calculate(input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      if (Array.isArray(value)) {
        assert.deepEqual(Array.from(result[key]), value, testCase.name + ' ' + key);
      } else {
        closeTo(result[key], value, testCase.name + ' ' + key);
      }
    }
    goldenCases += 1;
  } else {
    assert.equal(failure(testCase.input), testCase.expected.error, testCase.name);
    validationCases += 1;
  }
}
assert.ok(goldenCases >= 10, 'golden cases: ' + goldenCases);
assert.ok(validationCases >= 8, 'validation cases: ' + validationCases);

// Slug and name stay unique across the whole catalog.
for (const field of ['slug', 'name']) {
  const values = catalog.tools.map((tool) => String(tool[field]).toLowerCase());
  assert.equal(new Set(values).size, values.length, 'duplicate ' + field);
}
assert.ok(!catalog.tools.some((tool) => tool.slug === 'segmented-turning-calculator'),
  'no competing segmented turning record');

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/https?:\/\/[a-z]/i.test(html.replace(/http:\/\/www\.w3\.org/g, '')),
  'page must not reference an external URL');
assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(html), 'page source must stay ASCII');
assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'page needs exactly one h1');
assert.ok(html.includes('<form id="ring-form"'), 'page form missing');
assert.ok(html.includes('type="submit"'), 'page needs an explicit submit button');
assert.ok(html.includes('type="reset"') || html.includes('type="button"'), 'reset needs an explicit type');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('min-height:44px'), 'controls must keep a 44 px target');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
for (const id of ['segments', 'outer', 'wall', 'kerf', 'rings', 'err', 'out', 'reset', 'warn']) {
  assert.ok(html.includes('id="in-' + id + '"') || html.includes('id="' + id + '"'), 'control ' + id + ' missing');
}
for (const value of ['value="12"', 'value="300"', 'value="25"', 'value="3.2"', 'value="1"']) {
  assert.ok(html.includes(value), 'default ' + value + ' missing from the markup');
}
for (const match of html.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'getElementById(' + match[1] + ') has no element');
}
for (const match of html.matchAll(/<label class="f" for="([^"]+)"/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'label for ' + match[1] + ' has no control');
}

console.log('segmented ring: ' + entry.testCases.length + ' catalog cases, '
  + compared + ' oracle rings and ' + goldenCases + ' golden / ' + validationCases + ' validation replays passed');
