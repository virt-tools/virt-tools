/* Quilt setting triangles: the published on-point formulas, the rounding
   lattice, the piece counts, seam scaling and unit symmetry, refused inputs,
   randomised identities, catalogue replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'quilt-setting-triangle-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* qst-core:start */';
const endMarker = '/* qst-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = QuiltTrianglesCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const compute = (settings) => plain(C.calculate(settings));
const failure = (settings) => {
  try { compute(settings); } catch (error) { return error.message; }
  return null;
};
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} is not within ${tolerance} of ${expected}`);
};
const ROOT2 = Math.SQRT2;
const layout = (block, allowance, across, down, units) =>
  ({ units: units || 'in', block: String(block), seamAllowance: String(allowance),
     across: String(across), down: String(down) });

// ---- The published rules: side square = diagonal + 1 1/4 in, corner square =
// diagonal / 2 + 7/8 in at a quarter-inch seam, which is five and three and a
// half seam allowances, and the worked examples the references print.
assert.equal(C.RULES.SIDE_SEAM_FACTOR, 5);
assert.equal(C.RULES.CORNER_SEAM_FACTOR, 3.5);
const published = [
  [12, 18.25, 9.375, 'Quilter\'s Cache and Quiltville'],
  [15, 22.5, 11.5, 'Craftsy'],
  [6, 9.75, 5.125, 'Snuggles Quilts'],
  [10, 15.5, 8, 'Quilt Fabrication'],
];
for (const [block, side, corner, who] of published) {
  const result = compute(layout(block, 0.25, 3, 3));
  assert.equal(result.sideSquareRounded, side, `${who}: side square for a ${block} in block`);
  assert.equal(result.cornerSquareRounded, corner, `${who}: corner square for a ${block} in block`);
  close(result.sideSquare, block * ROOT2 + 1.25, 1e-9, `exact side square, ${block} in`);
  close(result.cornerSquare, block / ROOT2 + 0.875, 1e-9, `exact corner square, ${block} in`);
  close(result.diagonal, block * ROOT2, 1e-9, `block diagonal, ${block} in`);
}

// ---- The cut sizes sit on the eighth-inch lattice, never below the exact
// minimum and never a whole step above it.
for (const block of [0.5, 2.25, 4, 7.5, 9, 11.75, 16, 23, 44, 59.75]) {
  const result = compute(layout(block, 0.25, 4, 5));
  assert.ok(result.sideSquareRounded >= result.sideSquare - 1e-9, `side rounds up, ${block}`);
  assert.ok(result.sideSquareRounded < result.sideSquare + 0.125 + 1e-9, `side rounds by at most 1/8, ${block}`);
  assert.ok(Math.abs(result.sideSquareRounded * 8 - Math.round(result.sideSquareRounded * 8)) < 1e-9,
    `side lands on an eighth, ${block}`);
  assert.ok(Math.abs(result.cornerSquareRounded * 8 - Math.round(result.cornerSquareRounded * 8)) < 1e-9,
    `corner lands on an eighth, ${block}`);
}

// ---- Piece counts follow from the layout: two side triangles per gap on each
// edge, four corners, four side triangles per square and two corners per square.
const counts = [
  [4, 5, 14, 4, 6, 32],
  [3, 3, 8, 2, 4, 13],
  [3, 4, 10, 3, 5, 18],
  [1, 1, 0, 0, 2, 1],
  [2, 2, 4, 1, 3, 5],
  [6, 7, 22, 6, 8, 72],
  [25, 25, 96, 24, 26, 1201],
];
for (const [across, down, sideCount, sideSquares, totalSquares, blockCount] of counts) {
  const result = compute(layout(12, 0.25, across, down));
  assert.equal(result.sideCount, sideCount, `side triangles for ${across} by ${down}`);
  assert.equal(result.sideSquares, sideSquares, `side squares for ${across} by ${down}`);
  assert.equal(result.sideTrianglesCut, sideSquares * 4, `side triangles cut for ${across} by ${down}`);
  assert.equal(result.sideSpares, sideSquares * 4 - sideCount, `spares for ${across} by ${down}`);
  assert.equal(result.cornerCount, 4, 'four corners always');
  assert.equal(result.cornerSquares, 2, 'two corner squares always');
  assert.equal(result.totalSquares, totalSquares, `squares to cut for ${across} by ${down}`);
  assert.equal(result.blockCount, blockCount, `blocks in a ${across} by ${down} setting`);
}

// ---- The finished centre is the block diagonal times the count each way.
const centre = compute(layout(12, 0.25, 4, 5));
close(centre.centreWidth, 4 * 12 * ROOT2, 1e-6, 'centre width');
close(centre.centreHeight, 5 * 12 * ROOT2, 1e-6, 'centre height');
assert.equal(compute(layout(12, 0.25, 3, 3)).centreWidth,
  compute(layout(12, 0.25, 3, 3)).centreHeight, 'a square setting has a square centre');

// ---- The seam allowance scales both additions, five times for the side square
// and three and a half times for the corner.
const quarter = compute(layout(12, 0.25, 4, 5));
const threeEighths = compute(layout(12, 0.375, 4, 5));
close(threeEighths.sideSquare - quarter.sideSquare, 5 * 0.125, 1e-9, 'side square scales with the seam');
close(threeEighths.cornerSquare - quarter.cornerSquare, 3.5 * 0.125, 1e-9, 'corner square scales with the seam');
assert.equal(threeEighths.sideSquareRounded, 18.875, 'a three eighths seam cuts 18 7/8 in');
assert.equal(threeEighths.cornerSquareRounded, 9.875, 'a three eighths seam cuts 9 7/8 in');

// ---- Metric mode uses the same geometry on a whole-millimetre lattice.
const metric = compute(layout(30.48, 0.635, 4, 5, 'cm'));
close(metric.sideSquare, quarter.sideSquare * 2.54, 1e-6, 'metric side square matches the inch figure');
close(metric.cornerSquare, quarter.cornerSquare * 2.54, 1e-6, 'metric corner square matches');
assert.equal(metric.sideSquareRounded, 46.3, 'metric side square rounds to the next millimetre');
assert.equal(metric.cornerSquareRounded, 23.8, 'metric corner square rounds to the next millimetre');
close(metric.sideSquareOther, 46.3 / 2.54, 1e-6, 'the inch figure rides along in metric mode');
close(quarter.sideSquareOther, 18.25 * 2.54, 1e-6, 'the centimetre figure rides along in inch mode');

// ---- Boundaries the page accepts.
assert.equal(compute(layout(0.25, 0.1, 1, 1)).sideCount, 0, 'a single block needs no side triangles');
assert.equal(compute(layout(60, 1, 25, 25)).sideSquares, 24, 'the largest setting');
assert.equal(compute(layout(152.4, 2.54, 25, 25, 'cm')).blockCount, 1201, 'the largest metric setting');
assert.equal(compute(layout(0.635, 0.254, 1, 1, 'cm')).cornerCount, 4, 'the metric minimum');

// ---- Refusals, message by message.
const refusals = [
  [{ ...layout(12, 0.25, 4, 5), block: '' }, 'Enter the finished block size.'],
  [{ ...layout(12, 0.25, 4, 5), block: '   ' }, 'Enter the finished block size.'],
  [{ ...layout(12, 0.25, 4, 5), block: '0.2' }, 'Enter a finished block size from 0.25 to 60 inches.'],
  [{ ...layout(12, 0.25, 4, 5), block: '61' }, 'Enter a finished block size from 0.25 to 60 inches.'],
  [{ ...layout(12, 0.25, 4, 5), block: 'twelve' }, 'Enter the finished block size as a number with up to three decimals.'],
  [{ ...layout(12, 0.25, 4, 5), block: '-12' }, 'Enter the finished block size as a number with up to three decimals.'],
  [{ ...layout(12, 0.25, 4, 5), block: '12.1234' }, 'Enter the finished block size as a number with up to three decimals.'],
  [{ ...layout(12, 0.25, 4, 5), block: '1e2' }, 'Enter the finished block size as a number with up to three decimals.'],
  [{ ...layout(12, 0.25, 4, 5), seamAllowance: '' }, 'Enter the seam allowance.'],
  [{ ...layout(12, 1.5, 4, 5) }, 'Enter a seam allowance from 0.1 to 1 inches.'],
  [{ ...layout(12, 0.05, 4, 5) }, 'Enter a seam allowance from 0.1 to 1 inches.'],
  [{ ...layout(12, 0.25, 4, 5), seamAllowance: 'quarter' }, 'Enter the seam allowance as a number with up to three decimals.'],
  [{ ...layout(12, 0.25, 0, 5) }, 'Enter whole blocks across the top from 1 to 25.'],
  [{ ...layout(12, 0.25, 4.5, 5) }, 'Enter whole blocks across the top from 1 to 25.'],
  [{ ...layout(12, 0.25, 4, 0) }, 'Enter whole blocks down one side from 1 to 25.'],
  [{ ...layout(12, 0.25, 4, 26) }, 'Enter whole blocks down one side from 1 to 25.'],
  [{ ...layout(12, 0.25, 4, 5), down: '' }, 'Enter the number of blocks down one side.'],
  [{ ...layout(12, 0.25, 4, 5), units: 'pints' }, 'Choose inches or centimetres.'],
  [{ block: '12', across: '4', down: '5', seamAllowance: '0.2', units: 'cm' },
    'Enter a seam allowance from 0.254 to 2.54 centimetres.'],
  [{ block: '152.5', across: '4', down: '5', seamAllowance: '0.635', units: 'cm' },
    'Enter a finished block size from 0.635 to 152.4 centimetres.'],
];
for (const [settings, message] of refusals) {
  assert.equal(failure(settings), message, 'message: ' + message);
}
// Numbers are accepted directly, so a sweep that passes 12 for 12 does not trip
// the string pattern, and the defaults fill anything left out.
assert.equal(compute({ block: 12, across: 4, down: 5 }).sideCount, 14, 'numeric block accepted');
assert.equal(compute({}).block, 12, 'the defaults are a twelve inch block in a four by five setting');
assert.equal(compute({ across: '3' }).sideCount, 2 * 2 + 2 * 4, 'one field can be overridden alone');

// ---- Randomised identities: rounding, counts, spares and the centre hold for
// any layout inside the accepted ranges.
let seed = 20261116;
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
  return seed / 0x80000000;
};
const roundTo = (value, places) => {
  const factor = Math.pow(10, places);
  return Math.round(value * factor + (value < 0 ? -1e-9 : 1e-9)) / factor;
};
let checked = 0;
for (let trial = 0; trial < 250; trial += 1) {
  const metricMode = random() < 0.35;
  const block = metricMode ? roundTo(0.635 + random() * 151.7, 2) : roundTo(0.25 + random() * 59.7, 2);
  const allowance = metricMode ? roundTo(0.254 + random() * 2.2, 3) : roundTo(0.1 + random() * 0.9, 3);
  const across = 1 + Math.floor(random() * 25);
  const down = 1 + Math.floor(random() * 25);
  const units = metricMode ? 'cm' : 'in';
  const result = compute(layout(block, allowance, across, down, units));
  const step = metricMode ? 0.1 : 0.125;
  assert.equal(result.sideCount, 2 * (across - 1) + 2 * (down - 1), `side count, trial ${trial}`);
  assert.equal(result.sideSquares, Math.ceil(result.sideCount / 4), `side squares, trial ${trial}`);
  assert.ok(result.sideSpares >= 0 && result.sideSpares < 4, `spares are under four, trial ${trial}`);
  assert.equal(result.totalSquares, result.sideSquares + 2, `total squares, trial ${trial}`);
  assert.equal(result.blockCount, across * down + (across - 1) * (down - 1), `blocks, trial ${trial}`);
  close(result.diagonal, block * ROOT2, 1e-6, `diagonal, trial ${trial}`);
  close(result.sideSquare, result.diagonal + 5 * allowance, 1e-6, `side exact, trial ${trial}`);
  close(result.cornerSquare, block / ROOT2 + 3.5 * allowance, 1e-6, `corner exact, trial ${trial}`);
  close(result.centreWidth, across * result.diagonal, 1e-5, `centre width, trial ${trial}`);
  close(result.centreHeight, down * result.diagonal, 1e-5, `centre height, trial ${trial}`);
  for (const [exact, rounded, label] of [[result.sideSquare, result.sideSquareRounded, 'side'],
    [result.cornerSquare, result.cornerSquareRounded, 'corner']]) {
    assert.ok(rounded >= exact - 1e-6, `${label} never rounds down, trial ${trial}`);
    assert.ok(rounded < exact + step + 1e-6, `${label} rounds by under one step, trial ${trial}`);
    assert.ok(Math.abs(rounded / step - Math.round(rounded / step)) < 1e-6,
      `${label} is on the ruler lattice, trial ${trial}`);
  }
  checked += 1;
}

// ---- Catalogue record: 19 cases, replayed against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2220, 'public tools');
assert.ok(catalog.tools.some((tool) => tool.slug === slug), 'the new record is present');
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.equal(entry.name, 'Quilt Setting Triangle Calculator');
assert.equal(entry.category, 'Crafts & Hobbies');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.reviewedAt, null);
assert.ok(entry.method.includes('browser'), 'method documents local execution');
assert.ok(entry.method.includes('square root of 2'), 'method states the diagonal relationship');
assert.ok(entry.method.includes('quarter-square'), 'method names the side triangle type');
assert.ok(entry.method.includes('half-square'), 'method names the corner triangle type');
assert.ok(entry.method.includes('1/8 inch'), 'method states the rounding lattice');
assert.ok(entry.description.length > 120, 'description is descriptive');
assert.equal(entry.sources.length, 2, 'two published references are cited');
for (const source of entry.sources) {
  assert.ok(source.title.length > 20, 'a source names the document and the part used');
  assert.match(source.url, /^https:\/\//, 'every URL is absolute https');
}
assert.ok(entry.sources.some((source) => source.url.includes('quilterscache.com')), 'the setting triangle rules are cited');
assert.ok(entry.sources.some((source) => source.url.includes('quiltlab.co')), 'the worked figures are cited');
const kinds = (kind) => entry.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(entry.testCases.length, 19, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 3, 'three boundary cases');
assert.equal(kinds('validation'), 8, 'eight validation cases');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = compute(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], expected, testCase.name + ' ' + key);
  }
}

// The new record's slug, name and aliases must not collide with any other record.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [entry.slug, entry.name].concat(entry.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'aliases are internally unique');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'tags are internally unique');
for (const tag of ['quilting', 'on-point', 'setting-triangles']) {
  assert.ok(entry.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: labelled controls, no storage or network, ASCII source.
const markup = html.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, '');
const controlIds = [...markup.matchAll(/<(?:input|select)\b[^>]*\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(controlIds.length, 5, 'every control is in the markup');
for (const id of controlIds) {
  assert.ok(new RegExp(`<label\\b[^>]*\\bfor="${id}"`).test(markup), 'control has a visible label: ' + id);
}
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'refusals are announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/<form id="qst-form" novalidate>/.test(html), 'the form is a real form and does not native-validate');
assert.ok(/<button type="submit">Plan the triangles<\/button>/.test(html), 'the action button submits');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/[^\x00-\x7f]/.test(html), 'the page source stays ASCII');
assert.ok(/@media \(max-width:360px\)/.test(html), 'a phone layout is defined');

console.log('quilt setting triangles: published on-point formulas, the eighth-inch lattice, piece ' +
  'counts, seam and unit scaling, ' + checked + ' randomised layouts with count and rounding ' +
  'identities, 19 catalogue cases and the page contract pass');
