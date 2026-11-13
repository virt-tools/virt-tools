/* Regression checks for the cycling power zone page: an independently written
   reference for the Coggan bands, the catalog cases, zone-contiguity
   invariants, formatting and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'cycling-power-zones';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* powerzone-core:start */');
const end = html.indexOf('/* powerzone-core:end */');
assert.ok(start > -1 && end > start, 'power zone core markers missing');
const core = html.slice(start, end + '/* powerzone-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PowerZoneCore;', sandbox);
const C = sandbox.module.exports;

const closeTo = (actual, expected, label, epsilon) => assert.ok(
  Math.abs(actual - expected) <= (epsilon === undefined ? 1e-6 : epsilon),
  `${label}: ${actual} vs ${expected}`
);

/* Independent reference: the same zone model written differently, with
   floor(x + 0.5) half-up rounding and bands accumulated one watt at a time. */
const PCT_EDGES = [55, 75, 90, 105, 120, 150];
function referenceBounds(ftp) {
  const out = [];
  let previous = -1;
  for (const pct of PCT_EDGES) {
    let edge = Math.floor((pct * ftp) / 100 + 0.5);
    if (edge <= previous) edge = previous + 1;
    out.push(edge);
    previous = edge;
  }
  return out;
}
function referenceZones(ftp) {
  const edges = referenceBounds(ftp);
  const zones = [];
  let low = 0;
  for (let index = 0; index < edges.length; index += 1) {
    zones.push({ lowWatts: low, highWatts: edges[index] });
    low = edges[index] + 1;
  }
  zones.push({ lowWatts: low, highWatts: null });
  return zones;
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2252, 'catalog total');
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record present');
assert.equal(entry.name, 'Cycling Power Zone Calculator');
assert.equal(entry.category, 'Health');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.listed, true);
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.ok(entry.method.length > 500, 'method explains the model');
assert.ok(entry.sources.length >= 3, 'sources cite the training-level references');
assert.equal(entry.testCases.length, 26, 'catalog cases cover golden values and refusals');
assert.ok(html.includes('<meta name="description" content="Turn an FTP into Coggan'), 'page description');
assert.ok(html.includes('Cycling Power Zone Calculator</h1>'), 'page heading');

// Names, aliases and tags stay unique across the catalog.
const nameClash = catalog.tools.filter((tool) => tool.slug !== slug).some((tool) => tool.name === entry.name);
assert.equal(nameClash, false, 'name is unique');
for (const alias of entry.aliases) {
  const clash = catalog.tools.filter((tool) => tool.slug !== slug)
    .some((tool) => tool.name === alias || (tool.aliases || []).includes(alias));
  assert.equal(clash, false, `alias is unique: ${alias}`);
}
for (const tag of entry.tags) {
  assert.equal(typeof tag, 'string');
  assert.ok(tag.length > 0);
}
assert.ok(entry.tags.includes('ftp') && entry.tags.includes('power-zones'));

// Every catalog case replays through the page core; refusals match word for word.
let golden = 0;
let refusals = 0;
for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.kind === 'validation') {
    refusals += 1;
    assert.throws(
      () => C.analyze(Object.assign({}, testCase.input)),
      (error) => {
        assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
        return true;
      },
      `${label}: expected a refusal`
    );
    continue;
  }
  golden += 1;
  const result = C.analyze(Object.assign({}, testCase.input));
  const expected = testCase.expected;
  assert.equal(result.ftp, expected.ftp, `${label}: FTP`);
  closeTo(result.wPerKg, expected.wPerKg, `${label}: watts per kilogram`, 1e-5);
  assert.equal(result.target.watts, expected.targetWatts, `${label}: target power`);
  closeTo(result.target.wkg, expected.targetWkg, `${label}: target watts per kilogram`, 1e-5);
  assert.equal(result.target.zone, expected.targetZone, `${label}: target zone`);
  assert.equal(result.zones.length, 7, `${label}: seven zones`);
  expected.zones.forEach((zone, index) => {
    const actual = result.zones[index];
    assert.equal(actual.code, zone.code, `${label}: zone code ${index}`);
    assert.equal(actual.name, zone.name, `${label}: zone name ${index}`);
    assert.equal(actual.lowPct, zone.lowPct, `${label}: low percentage ${index}`);
    assert.equal(actual.highPct, zone.highPct, `${label}: high percentage ${index}`);
    assert.equal(actual.lowWatts, zone.lowWatts, `${label}: low watts ${index}`);
    assert.equal(actual.highWatts, zone.highWatts, `${label}: high watts ${index}`);
    if (zone.lowWkg === null) assert.equal(actual.lowWkg, null);
    else closeTo(actual.lowWkg, zone.lowWkg, `${label}: low W/kg ${index}`, 1e-5);
    if (zone.highWkg === null) assert.equal(actual.highWkg, null);
    else closeTo(actual.highWkg, zone.highWkg, `${label}: high W/kg ${index}`, 1e-5);
  });
}
assert.equal(golden, 10, 'golden case count');
assert.equal(refusals, 16, 'refusal case count');

// The catalog values came from a separate half-up reference, so this sweep
// checks the page against that formulation across the whole FTP range.
for (let ftp = 40; ftp <= 2000; ftp += 7) {
  const result = C.analyze({ source: 'ftp', power: String(ftp), mass: '75', intensity: '70' });
  const reference = referenceZones(ftp);
  result.zones.forEach((zone, index) => {
    assert.equal(zone.lowWatts, reference[index].lowWatts, `FTP ${ftp}: zone ${index} low`);
    assert.equal(zone.highWatts, reference[index].highWatts, `FTP ${ftp}: zone ${index} high`);
  });
}

// Bands are contiguous integers: one watt, one zone, no gaps or overlaps.
for (const ftp of [40, 41, 63, 100, 137, 245, 250, 333, 499, 1000, 1999, 2000]) {
  const zones = C.analyze({ source: 'ftp', power: String(ftp), mass: '75', intensity: '70' }).zones;
  assert.equal(zones[0].lowWatts, 0, `FTP ${ftp}: zone 1 starts at zero`);
  assert.equal(zones[6].highWatts, null, `FTP ${ftp}: top zone is open`);
  for (let index = 0; index < 6; index += 1) {
    assert.equal(zones[index].highWatts + 1, zones[index + 1].lowWatts, `FTP ${ftp}: boundary ${index}`);
    assert.ok(zones[index].highWatts > zones[index].lowWatts, `FTP ${ftp}: zone ${index} not empty`);
  }
}

// The target label names the zone whose watt band holds the target power, so
// the label and the number agree even when a percentage rounds onto a boundary.
for (let pct = 1; pct <= 200; pct += 1) {
  for (const ftp of [40, 120, 245, 400, 1000]) {
    const result = C.analyze({ source: 'ftp', power: String(ftp), mass: '80', intensity: String(pct) });
    const target = result.target;
    const zone = result.zones.find((candidate) => target.watts >= candidate.lowWatts &&
      (candidate.highWatts === null || target.watts <= candidate.highWatts));
    assert.ok(zone, `FTP ${ftp} at ${pct}%: target zone found`);
    assert.equal(target.zone, `${zone.code} ${zone.name}`, `FTP ${ftp} at ${pct}%: zone label`);
    assert.equal(target.watts, Math.round((pct / 100) * result.ftp), `FTP ${ftp} at ${pct}%: target watts`);
  }
}

// Test conversions, including round-half-up at the FTP rounding step.
assert.equal(C.analyze({ source: 'test20', power: '200', mass: '75', intensity: '70' }).ftp, 190);
assert.equal(C.analyze({ source: 'test8', power: '200', mass: '75', intensity: '70' }).ftp, 180);
assert.equal(C.analyze({ source: 'ramp', power: '200', mass: '75', intensity: '70' }).ftp, 150);
assert.equal(C.analyze({ source: 'ftp', power: '250,5', mass: '75', intensity: '70' }).ftp, 251);
assert.equal(C.analyze({ source: 'ftp', power: '250.5', mass: '75', intensity: '70' }).ftp, 251);
assert.equal(C.analyze({ source: 'test20', power: '131', mass: '70', intensity: '70' }).ftp, 124);
assert.equal(C.analyze({ source: 'ftp', power: '245', mass: '75', intensity: '70' }).wPerKg.toFixed(2), '3.27');
assert.equal(C.analyze({ source: 'ftp', power: '245', mass: '75', intensity: '30' }).ftp, 245);

// An unknown source falls back to a known FTP rather than silently failing.
assert.equal(C.analyze({ source: 'bogus', power: '245', mass: '75', intensity: '70' }).source, 'ftp');
assert.equal(C.sourceKey('bogus'), 'ftp');
assert.equal(C.sourceKey('ramp'), 'ramp');

const sample = C.analyze({ source: 'ftp', power: '245', mass: '75', intensity: '70' });
assert.equal(Array.from(sample.zones, (zone) => zone.text).join('|'),
  ['\u2264 135 W', '136\u2013184 W', '185\u2013221 W', '222\u2013257 W', '258\u2013294 W', '295\u2013368 W', '\u2265 369 W'].join('|'));
assert.equal(Array.from(sample.zones, (zone) => C.zoneWkgText(zone)).join('|'),
  ['\u2264 1.80 W/kg', '1.81\u20132.45 W/kg', '2.47\u20132.95 W/kg', '2.96\u20133.43 W/kg',
    '3.44\u20133.92 W/kg', '3.93\u20134.91 W/kg', '\u2265 4.92 W/kg'].join('|'));
assert.equal(C.zoneLabel(sample.zones[0]), 'Z1 \u00b7 Active recovery \u00b7 0\u201355%');
assert.equal(C.zoneLabel(sample.zones[6]), 'Z7 \u00b7 Neuromuscular \u00b7 over 150%');
assert.equal(C.formatWkg(3.2667), '3.27 W/kg');
assert.equal(C.zoneText(0, 135), '\u2264 135 W');
assert.equal(C.zoneText(136, 184), '136\u2013184 W');
assert.equal(C.zoneText(369, null), '\u2265 369 W');
assert.equal(sample.ftpBasis, 'FTP 245 W entered directly');
assert.equal(C.analyze({ source: 'test20', power: '258', mass: '75', intensity: '70' }).ftpBasis,
  'FTP estimated as 20-minute power 258 W \u00d7 0.95');
assert.equal(
  C.copyText(sample),
  'Cycling power zones at FTP 245 W (3.27 W/kg). Z1 \u00b7 Active recovery \u00b7 0\u201355% \u2264 135 W; ' +
  'Z2 \u00b7 Endurance \u00b7 56\u201375% 136\u2013184 W; Z3 \u00b7 Tempo \u00b7 76\u201390% 185\u2013221 W; ' +
  'Z4 \u00b7 Lactate threshold \u00b7 91\u2013105% 222\u2013257 W; Z5 \u00b7 VO2 max \u00b7 106\u2013120% 258\u2013294 W; ' +
  'Z6 \u00b7 Anaerobic capacity \u00b7 121\u2013150% 295\u2013368 W; Z7 \u00b7 Neuromuscular \u00b7 over 150% \u2265 369 W. ' +
  'Target 70% FTP = 172 W (2.29 W/kg), Z2 Endurance.'
);
assert.ok(!C.copyText(sample).includes('undefined') && !C.copyText(sample).includes('NaN'));

// Blank input is refused rather than silently defaulted.
assert.throws(() => C.analyze({}), /^Error: Enter the FTP\.$/);

// The page stays offline: no network, storage or raw-HTML sinks.
for (const banned of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'innerHTML', 'document.write', 'onclick=']) {
  assert.ok(!html.includes(banned), `page unexpectedly uses ${banned}`);
}
assert.ok(html.includes('id="site-header"'), 'shared header mount missing');
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('id="source"') && html.includes('value="test20"'), 'FTP source selector missing');
assert.ok(html.includes('aria-live="polite"'), 'result region should announce changes');
assert.ok(html.includes('novalidate'), 'form should not rely on native validation');

console.log(`cycling power zones: ${entry.testCases.length} catalog cases (${golden} golden, ${refusals} refusals), reference sweep, contiguity and page contract OK`);
