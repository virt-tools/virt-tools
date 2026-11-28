/* Bike trail & fork geometry: the published trail, normal-trail and wheel-flop
   formulas, the refusal messages, the page markup and every catalog case. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'bike-trail-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* bike-trail-core:start */';
const endMarker = '/* bike-trail-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, Error, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BikeTrailCore;', sandbox);
const C = sandbox.module.exports;

const failure = (payload) => {
  try { C.compute(payload); } catch (error) { return error.message; }
  return null;
};
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);

// ---- Wheel sizes and the geometry, checked against the formula itself.
assert.deepEqual(Object.keys(C.RIMS).sort(), ['406', '507', '559', '584', '622']);
assert.equal(C.RIMS['622'], 622);
assert.equal(C.RIMS['584'], 584);
const road = C.compute(C.DEFAULTS);
const A = 73 * Math.PI / 180;
assert.ok(near(road.radius, 311 + 28, 1e-12), '622/2 + 28 mm tire');
assert.ok(near(road.trail, (339 * Math.cos(A) - 45) / Math.sin(A), 1e-12), 'trail formula');
assert.ok(near(road.normal, 339 * Math.cos(A) - 45, 1e-12), 'normal trail is the numerator');
assert.ok(near(road.flop, road.trail * Math.sin(A) * Math.cos(A), 1e-12), 'wheel flop identity');
assert.ok(near(road.rake, 339 * Math.cos(A) - 57 * Math.sin(A), 1e-12), 'inverse offset formula');
assert.ok(road.trail > 56 && road.trail < 57, 'a 73 degree road front end lands near 56.6 mm of trail');

// ---- The inverse is exact: aiming at the trail you already have keeps the fork.
const selfTarget = C.compute(Object.assign({}, C.DEFAULTS, { targetTrail: String(road.trail) }));
assert.ok(near(selfTarget.rake, 45, 1e-6), 'target equal to current trail returns the current offset');
assert.ok(near(selfTarget.rakeDelta, 0, 1e-6), 'no offset change');

// ---- Directions: more offset shortens trail, a slacker angle and a bigger wheel lengthen it.
const moreOffset = C.compute(Object.assign({}, C.DEFAULTS, { forkOffset: '55' }));
const slacker = C.compute(Object.assign({}, C.DEFAULTS, { headAngle: '70' }));
const bigger = C.compute(Object.assign({}, C.DEFAULTS, { tireWidth: '40' }));
assert.ok(moreOffset.trail < road.trail, 'offset reduces trail');
assert.ok(slacker.trail > road.trail, 'a slacker head angle increases trail');
assert.ok(bigger.trail > road.trail, 'a larger wheel increases trail');
assert.ok(moreOffset.flop < road.flop && slacker.flop > road.flop, 'flop follows trail');

// ---- Custom radius ignores the tire width, and numeric input is accepted.
const custom = C.compute({ rim: 'custom', radius: 330, tireWidth: '25', headAngle: '74', forkOffset: '38', targetTrail: '57' });
assert.equal(custom.bead, null);
assert.equal(custom.radius, 330);
assert.ok(custom.explanation.some((line) => line.includes('used directly')), 'custom radius note');

// ---- Warnings instead of unusable offsets.
const negativeRake = C.compute({ rim: 'custom', radius: 200, tireWidth: '25', headAngle: '80', forkOffset: '20', targetTrail: '40' });
assert.ok(negativeRake.rake < 0);
assert.equal(negativeRake.warnings.length, 1);
assert.match(negativeRake.warnings[0], /negative offset is not physically available/);
const wideRake = C.compute({ rim: '622', tireWidth: '120', headAngle: '50', forkOffset: '45', targetTrail: '150' });
assert.match(wideRake.warnings[0], /wider than the 100 mm this tool accepts/);

// ---- Refusals, spelled out here and again in the catalog.
assert.equal(failure(Object.assign({}, C.DEFAULTS, { rim: '700c' })),
  'Pick a wheel size from the list, or choose a custom wheel radius; got "700c".');
assert.equal(failure(Object.assign({}, C.DEFAULTS, { headAngle: '' })),
  'Head angle must be a number in degrees; got "".');
assert.equal(failure(Object.assign({}, C.DEFAULTS, { tireWidth: 'wide' })),
  'Tire width must be a number in mm; got "wide".');
assert.equal(failure(Object.assign({}, C.DEFAULTS, { tireWidth: '10' })),
  'Tire width must be between 18 and 120 mm; got 10.');
assert.equal(failure(Object.assign({}, C.DEFAULTS, { headAngle: '95' })),
  'Head angle must be between 50 and 80 degrees; got 95.');
assert.equal(failure(Object.assign({}, C.DEFAULTS, { forkOffset: '-5' })),
  'Fork offset must be between 0 and 100 mm; got -5.');
assert.equal(failure({ rim: 'custom', radius: '120', tireWidth: '28', headAngle: '73', forkOffset: '45', targetTrail: '57' }),
  'Wheel radius must be between 150 and 450 mm; got 120.');
assert.match(failure({ rim: 'custom', radius: '200', tireWidth: '28', headAngle: '80', forkOffset: '100', targetTrail: '40' }),
  /^This combination has no positive trail: a 100\.0 mm fork offset on a 200\.0 mm wheel at 80 degrees/);

// ---- Determinism and input immutability.
const probe = Object.assign({}, C.DEFAULTS, { forkOffset: '47.5' });
const snapshot = JSON.stringify(probe);
assert.equal(C.compute(probe).trail, C.compute(probe).trail, 'deterministic');
assert.equal(JSON.stringify(probe), snapshot, 'input is not mutated');

// ---- The catalog record and every case in it.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Bike Trail & Fork Geometry Calculator');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.legacyCategory, null);
assert.ok(record.description.length >= 80 && record.description.length <= 300, 'description length');
assert.equal(record.testCases.length, 33, 'catalog case count');
assert.equal(record.sources.length, 2, 'two references');
assert.ok(/^https:\/\//.test(record.sources[0].url), 'source URL');
assert.ok(record.sources[0].title.length > 20 && record.sources[0].title.includes('trail'), 'source title names the part used');
assert.ok(record.method.length > 400, 'method explains the formulas');
assert.ok(record.tags.includes('cycling') && record.tags.includes('trail'), 'tags');
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
    assert.ok(near(result.normal, result.trail * Math.sin(result.headAngle * Math.PI / 180), 1e-9),
      testCase.name + ': normal trail identity');
    goldens += 1;
  } else {
    assert.equal(testCase.kind, 'validation');
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    refusals += 1;
  }
}
assert.equal(goldens, 23, 'golden cases');
assert.equal(refusals, 10, 'refusal cases');

// ---- Catalog totals pinned site-wide.
assert.equal(catalog.tools.length, 2528, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2267, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Sports & Outdoors').length, 58,
  'Sports & Outdoors count');

// ---- Page contract.
assert.match(html, /<title>Bike Trail &amp; Fork Geometry Calculator/);
assert.match(html, /<meta name="description" content="Work out a bicycle's steering trail/);
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.ok(html.includes('/assets/app.js'));
for (const id of ['in-rim', 'in-tire', 'in-radius', 'in-head', 'in-offset', 'in-target']) {
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
assert.ok(html.includes('<h1>Bike Trail &amp; Fork Geometry Calculator</h1>'));
assert.ok(html.includes('<h3>How this is worked out</h3>'));
assert.ok(html.includes('<h3>What this does not do</h3>'));
assert.ok(html.includes('Nothing is saved'), 'storage disclosure');
assert.ok(html.includes('id="radius-field" hidden'), 'custom radius hidden by default');

console.log('bike trail calculator: ' + goldens + ' goldens, ' + refusals +
  ' refusals, page and catalog contract ok');
