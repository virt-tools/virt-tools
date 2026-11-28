/* O-ring gland fit: catalog fixtures, squeeze/stretch/fill geometry and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'oring-gland-fit-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* oring-gland-core:start */';
const endMarker = '/* oring-gland-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = OringGlandCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one O-ring gland calculator');
const record = records[0];
assert.equal(record.name, 'O-Ring Gland Fit Calculator');
assert.equal(record.category, 'Mechanical & Structural Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.equal(new Set(record.tags).size, record.tags.length);
assert.equal(new Set(record.aliases).size, record.aliases.length);
assert.ok(record.method.length > 1200, 'method documents the three figures and their scope');
assert.match(record.method, /0\.2 mm/);
assert.match(record.method, /60 % and 85 %/);
assert.equal(record.sources.length, 1);
assert.match(record.sources[0].url, /^https:\/\/nfc\.arizona\.edu\//, 'source was fetched');
assert.ok(record.sources[0].title.includes('ORD 5700'), 'source names the handbook');
assert.equal(record.testCases.length, 27);
assert.equal(record.testCases.filter((t) => t.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((t) => t.kind === 'boundary').length, 6);
assert.equal(record.testCases.filter((t) => t.kind === 'validation').length, 11);
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2262, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Mechanical & Structural Engineering').length, 57,
  'Mechanical & Structural Engineering count');
// No other record claims this slug, name, alias or tag.
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name.toLowerCase(), record.name.toLowerCase(), 'name is unique: ' + other.slug);
  for (const alias of record.aliases) {
    assert.ok(!other.aliases.map((a) => a.toLowerCase()).includes(alias.toLowerCase()),
      'alias is unique: ' + alias + ' in ' + other.slug);
  }
  assert.ok(!other.tags.includes('o-ring'), 'o-ring tag is unique: ' + other.slug);
}

function failure(input) {
  try { C.analyse(input); } catch (error) { return error.message; }
  return null;
}
function near(actual, expected, label) {
  const tol = Math.max(1e-6, Math.abs(expected) * 1e-8);
  assert.ok(Math.abs(actual - expected) <= tol,
    label + ': expected ' + expected + ', got ' + actual);
}

// Every catalog case replays against the page core.
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.analyse(testCase.input);
  for (const key of Object.keys(testCase.expected)) {
    const expected = testCase.expected[key];
    if (typeof expected === 'boolean') {
      assert.equal(result[key], expected, testCase.name + ': ' + key);
    } else if (key === 'warningCount') {
      assert.equal(result.warnings.length, expected, testCase.name + ': warningCount');
    } else {
      near(result[key], expected, testCase.name + ': ' + key);
    }
  }
}

const base = C.analyse({});
// The three figures are pure geometry: rebuild each from the raw inputs.
const id = 24.99, cs = 3.53, groove = 26, depth = 2.9, width = 4.6;
near(base.squeezeMm, cs - depth, 'squeeze is the cord minus the gland depth');
near(base.squeezePct, 100 * (cs - depth) / cs, 'compression ratio');
near(base.stretchPct, 100 * (groove - id) / id, 'stretch over the groove bottom');
near(base.ringAreaMm2, Math.PI * cs * cs / 4, 'cross-section area');
near(base.glandAreaMm2, depth * width, 'gland area');
near(base.fillPct, 100 * (Math.PI * cs * cs / 4) / (depth * width), 'fill is ring area over gland area');
near(base.widthRatio, width / cs, 'groove width per cross-section');
near(base.squeezePct + 100 * (depth / cs) - 100, 0, 'squeeze and depth/cord make up 100 %');
near(base.fillPct * base.glandAreaMm2 / 100, base.ringAreaMm2, 'fill times gland area is the ring area');
assert.equal(base.ok, true, 'default gland is inside every window');
assert.equal(Array.from(base.warnings).length, 0);

// A deeper groove flattens less and fills less; a wider groove only fills less.
const deeper = C.analyse({depthMm: '3.1'});
assert.ok(deeper.squeezeMm < base.squeezeMm, 'deeper gland squeezes less');
assert.ok(deeper.fillPct < base.fillPct, 'deeper gland fills less');
near(deeper.squeezeMm + 0.2, base.squeezeMm, '0.2 mm more depth is 0.2 mm less squeeze');
const wider = C.analyse({widthMm: '9.2'});
near(wider.squeezeMm, base.squeezeMm, 'width leaves the squeeze alone');
near(wider.fillPct, base.fillPct / 2, 'doubling the width halves the fill');
// Growing the groove bottom only stretches the ring.
const stretched = C.analyse({grooveDiameterMm: '26.5'});
assert.ok(stretched.stretchPct > base.stretchPct, 'a larger groove bottom stretches more');
near(stretched.fillPct, base.fillPct, 'stretch leaves the fill alone');
near(stretched.squeezePct, base.squeezePct, 'stretch leaves the nominal squeeze alone');
// A cord twice as thick fills four times the groove for the same depth ratio.
const fat = C.analyse({crossSectionMm: '7.06', depthMm: '5.8', widthMm: '9.2'});
near(fat.fillPct, base.fillPct, 'same depth and width ratios fill the same share');

// Each warning fires on its own condition and only there.
const thinSqueeze = C.analyse({depthMm: '3.4'});
assert.ok(Array.from(thinSqueeze.warnings).some((w) => w.includes('under 0.2 mm')), 'minimum squeeze warning');
assert.equal(thinSqueeze.squeezeMm < 0.2, true, 'the case is under 0.2 mm');
const hardStatic = C.analyse({depthMm: '2.2'});
assert.ok(Array.from(hardStatic.warnings).some((w) => w.includes('30 %')), 'static maximum warning');
const hardDynamic = C.analyse({depthMm: '2.2', mode: 'dynamic'});
assert.ok(Array.from(hardDynamic.warnings).some((w) => w.includes('16 %')), 'dynamic maximum warning uses its own message');
const sameRingDynamic = C.analyse({depthMm: '3.1', mode: 'dynamic'});
assert.equal(Array.from(sameRingDynamic.warnings).length, 0, '12 % squeeze is inside the dynamic window');
const tooFull = C.analyse({widthMm: '3.5'});
assert.ok(Array.from(tooFull.warnings).some((w) => w.includes('above 85 %')), 'overfill warning');
const tooEmpty = C.analyse({widthMm: '8'});
assert.ok(Array.from(tooEmpty.warnings).some((w) => w.includes('below the 60 %')), 'underfill warning');
const overStretched = C.analyse({grooveDiameterMm: '27'});
assert.ok(Array.from(overStretched.warnings).some((w) => w.includes('above 5 %')), 'stretch warning');
const looseRing = C.analyse({grooveDiameterMm: '24'});
assert.ok(Array.from(looseRing.warnings).some((w) => w.includes('sits loose')), 'negative stretch warning');
const narrowGroove = C.analyse({widthMm: '3'});
assert.ok(Array.from(narrowGroove.warnings).some((w) => w.includes('narrower than the free cross-section')),
  'narrow groove warning');
assert.equal(Array.from(narrowGroove.warnings).length, 2, 'a narrow groove is also overfilled');

// Thresholds are inclusive: a figure exactly on the limit stays quiet.
assert.equal(C.analyse({depthMm: '3.33'}).ok, true, 'exactly 0.2 mm of squeeze is allowed');
assert.equal(C.analyse({grooveDiameterMm: '26.2395'}).ok, true, 'exactly 5 % of stretch is allowed');
assert.equal(C.analyse({mode: 'dynamic', depthMm: '2.9652'}).ok, true, 'exactly 16 % of squeeze is allowed');

// Refusals.
assert.match(failure({depthMm: '3.53'}), /not compressed/);
assert.match(failure({depthMm: '16'}), /between 0.2 and 15 mm/);
assert.match(failure({crossSectionMm: '30'}), /between 0.5 and 25 mm/);
assert.match(failure({insideDiameterMm: '1'}), /between 3 and 2000 mm/);
assert.match(failure({mode: 'axial'}), /static or dynamic/);
assert.match(failure({insideDiameterMm: '  '}), /required/);

// A random sweep against an independent geometry model over the whole input range.
let seed = 20261119;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
for (let i = 0; i < 400; i += 1) {
  const ringId = 3 + rnd() * 200;
  const cord = 0.5 + rnd() * 12;
  const grooveBottom = ringId * (0.98 + rnd() * 0.12);
  const glandDepth = 0.2 + rnd() * (cord - 0.25);
  const grooveWidth = cord * (0.6 + rnd() * 1.4);
  const mode = rnd() < 0.5 ? 'static' : 'dynamic';
  const r = C.analyse({
    insideDiameterMm: ringId, crossSectionMm: cord, grooveDiameterMm: grooveBottom,
    depthMm: glandDepth, widthMm: grooveWidth, mode
  });
  near(r.squeezeMm, cord - glandDepth, 'sweep squeeze');
  near(r.squeezePct, 100 * (cord - glandDepth) / cord, 'sweep compression ratio');
  near(r.stretchPct, 100 * (grooveBottom - ringId) / ringId, 'sweep stretch');
  near(r.fillPct, 100 * Math.PI * cord * cord / 4 / (glandDepth * grooveWidth), 'sweep fill');
  const squeezePct = 100 * (cord - glandDepth) / cord;
  const maxSqueeze = mode === 'static' ? 30 : 16;
  const minFlag = (cord - glandDepth) < 0.2 - 1e-9;
  const maxFlag = squeezePct > maxSqueeze + 1e-9;
  const filled = r.fillPct > 85 + 1e-9 || r.fillPct < 60 - 1e-9;
  const stretchedOut = r.stretchPct > 5 + 1e-9;
  assert.equal(r.warnings.some((w) => w.includes('under 0.2 mm')), minFlag, 'sweep minimum squeeze flag');
  assert.equal(r.warnings.some((w) => w.includes('maximum')), maxFlag, 'sweep squeeze maximum flag');
  assert.equal(r.warnings.some((w) => w.includes('Gland fill')), filled, 'sweep fill flag');
  assert.equal(r.warnings.some((w) => w.includes('Stretch is above')), stretchedOut, 'sweep stretch flag');
}

// Page contract: the markup starts at the core defaults and wires every field.
for (const pair of [
  ['in-id', '24.99'], ['in-cs', '3.53'], ['in-groove', '26'],
  ['in-depth', '2.9'], ['in-width', '4.6']
]) {
  assert.match(html, new RegExp('id="' + pair[0] + '"[^>]*value="' + pair[1].replace('.', '\\.') + '"'),
    'default markup for ' + pair[0]);
}
assert.match(html, /<option value="static" selected>/, 'static is the default application');
const ids = new Set(Array.from(html.matchAll(/getElementById\("([^"]+)"\)/g), (m) => m[1]));
for (const id of ids) {
  assert.ok(html.includes('id="' + id + '"'), 'getElementById target exists: ' + id);
}
assert.ok(ids.has('warnings'), 'warnings panel is wired');
assert.ok(!/<h2[^>]*>Sources<\/h2>/i.test(html), 'sources are rendered by app.js, not the page');
assert.ok(!/https?:\/\/(?!virt\.tools)/.test(html), 'the page references no external URL');
