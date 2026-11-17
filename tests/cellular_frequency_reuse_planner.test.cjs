/* cellular frequency reuse: catalog fixtures, hexagonal identities and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'cellular-frequency-reuse-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* cellular-frequency-reuse-core:start */';
const endMarker = '/* cellular-frequency-reuse-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = CellularReuseCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one reuse planner');
const record = records[0];
assert.equal(record.name, 'Cellular Frequency Reuse Planner');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.equal(new Set(record.tags).size, record.tags.length);
assert.equal(new Set(record.aliases).size, record.aliases.length);
assert.ok(record.method.length > 1500, 'method documents the geometry, the ranges and the scope');
assert.match(record.method, /N = i² \+ i·j \+ j²/, 'method states the cluster-size rule');
assert.match(record.method, /\(√\(3N\)\)\^n \/ i₀/, 'method states the S/I form');
assert.match(record.method, /15\.36 dB/, 'method carries the worked default');
assert.match(record.method, /6\/2\/1/, 'method states the sectoring interferer counts');
assert.equal(record.sources.length, 4);
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'https source');
  assert.ok(source.title.length > 60, 'source titles say what the page supplies');
}
assert.ok(catalog.tools.filter((tool) => tool.listed).length >= 2112, 'public tools');
assert.ok(catalog.tools.filter((tool) => tool.category === 'Communications Engineering').length >= 50,
  'Communications Engineering count');
// No other record claims this slug, name or alias.
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name.toLowerCase(), record.name.toLowerCase(), 'name is unique: ' + other.slug);
  for (const alias of record.aliases) {
    assert.ok(!(other.aliases || []).map((a) => a.toLowerCase()).includes(alias.toLowerCase()),
      'alias is unique: ' + alias + ' in ' + other.slug);
  }
}

function failure(input) {
  try { C.analyse(input); } catch (error) { return error.message; }
  return null;
}
function near(actual, expected, label, tolerance) {
  const tol = tolerance == null ? Math.max(1e-6, Math.abs(expected) * 1e-8) : tolerance;
  assert.ok(Math.abs(actual - expected) <= tol,
    label + ': expected ' + expected + ', got ' + actual);
}
// The page reports rounded values (4 decimals for a ratio, 3 for a distance, 2 for a dB figure),
// so a display identity allows half a unit of the last shown digit.
const shown = (actual, expected, label) => near(actual, expected, label, 0.011);
const ratioShown = (actual, expected, label) => near(actual, expected, label, 1e-4);

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
    } else {
      assert.ok(Math.abs(result[key] - expected) <= Math.max(1e-6, Math.abs(expected) * 1e-8),
        testCase.name + ': ' + key + ' expected ' + expected + ', got ' + result[key]);
    }
  }
}

// Hexagonal geometry: the allowed cluster sizes are exactly those an independent i, j sweep produces.
const allowed = new Set();
for (let i = 0; i <= 12; i += 1) {
  for (let j = 0; j <= 12; j += 1) {
    if (i === 0 && j === 0) continue;
    allowed.add(i * i + i * j + j * j);
  }
}
for (const size of [1, 3, 4, 7, 9, 12, 13, 16, 19, 21, 25, 27, 28, 31, 36, 37, 39, 43, 48, 49]) {
  assert.ok(allowed.has(size), 'tessellating cluster size ' + size);
}
for (const size of [2, 5, 6, 8, 10, 11, 14, 15, 17, 18, 20, 22, 23, 24, 26, 29, 30, 32, 33, 34, 35]) {
  assert.ok(!allowed.has(size), 'non-tessellating cluster size ' + size);
}
// Q² = 3N exactly, so the page's Q is the square root of three cluster sizes.
const base = C.analyse({});
assert.equal(base.clusterSize, 7);
near(base.reuseRatio * base.reuseRatio, 21, 'Q squared is 3N', 1e-3);
ratioShown(base.reuseRatio, Math.sqrt(21), 'Q = sqrt(3N)');
near(base.reuseDistanceKm, base.cellRadiusKm * Math.sqrt(21), 'D = R sqrt(3N)', 1e-3);
near(base.reuseFactorPct, 100 / 7, 'reuse factor percentage', 0.05);
// The published reuse ratios: N = 3 -> 3, N = 4 -> 3.464, N = 7 -> 4.583, N = 12 -> 6, N = 19 -> 7.55.
ratioShown(C.analyse({offsetI: 1, offsetJ: 1}).reuseRatio, 3, 'Q for N = 3');
ratioShown(C.analyse({offsetI: 2, offsetJ: 0}).reuseRatio, 3.4641, 'Q for N = 4');
ratioShown(C.analyse({offsetI: 2, offsetJ: 1}).reuseRatio, 4.5826, 'Q for N = 7');
ratioShown(C.analyse({offsetI: 2, offsetJ: 2}).reuseRatio, 6, 'Q for N = 12');
ratioShown(C.analyse({offsetI: 3, offsetJ: 2}).reuseRatio, 7.5498, 'Q for N = 19');
// The same cluster from a swapped offset pair is the same plan.
assert.equal(C.analyse({offsetI: 1, offsetJ: 2}).clusterSize, 7, 'swapped offsets give N = 7');
shown(C.analyse({offsetI: 1, offsetJ: 2}).siDb, C.analyse({offsetI: 2, offsetJ: 1}).siDb, 'swapped offsets give the same S/I');
// S/I is the published dB form 5n log10(3N) - 10 log10(i0).
const published = (n, cluster, i0) => 5 * n * Math.log10(3 * cluster) - 10 * Math.log10(i0);
for (const exponent of [2, 2.5, 3, 3.5, 4, 5, 6]) {
  for (const [i, j] of [[1, 0], [1, 1], [2, 0], [2, 1], [2, 2], [3, 2]]) {
    const result = C.analyse({offsetI: i, offsetJ: j, exponent});
    shown(result.siDb, published(exponent, result.clusterSize, 6), 'published dB form');
  }
}
// The classic AMPS result: 7-cell reuse at n = 4 with six interferers is 18.66 dB.
shown(C.analyse({offsetI: 2, offsetJ: 1, exponent: 4}).siDb, 18.66, 'AMPS 18.66 dB');
// Sectoring buys exactly 10 log10(6/i0) dB on the same plan.
const omni = C.analyse({offsetI: 2, offsetJ: 1, exponent: 4});
const three = C.analyse({offsetI: 2, offsetJ: 1, exponent: 4, sectoring: 'three'});
const six = C.analyse({offsetI: 2, offsetJ: 1, exponent: 4, sectoring: 'six'});
shown(three.siDb - omni.siDb, 10 * Math.log10(3), '120 degree sectoring gain');
shown(six.siDb - omni.siDb, 10 * Math.log10(6), '60 degree sectoring gain');
assert.equal(three.interferers, 2);
assert.equal(six.interferers, 1);
// S/I rises with the cluster size and with the exponent.
assert.ok(C.analyse({offsetI: 2, offsetJ: 2}).siDb > base.siDb, 'a larger cluster improves S/I');
assert.ok(C.analyse({offsetI: 2, offsetJ: 1, exponent: 4.5}).siDb > base.siDb, 'a steeper exponent improves S/I');
// Channels: floor(total/N) and the remainder, and the reuse factor falls as N grows.
const narrow = C.analyse({offsetI: 3, offsetJ: 1, channels: 100});
assert.equal(narrow.channelsPerCell, Math.floor(100 / 13), 'channels per cell');
assert.equal(narrow.channelsRemainder, 100 % 13, 'left-over channels');
assert.ok(C.analyse({offsetI: 2, offsetJ: 2}).reuseFactorPct < base.reuseFactorPct, 'larger cluster, smaller share');
// The table is the eight smallest tessellating clusters, in order, and the current N is in it.
assert.equal(base.rows.length, 8, 'eight table rows');
assert.deepEqual(Array.from(base.rows, (row) => row.clusterSize), [1, 3, 4, 7, 9, 12, 13, 19]);
assert.equal(base.rows.filter((row) => row.current).length, 1, 'exactly one current row');
assert.equal(base.rows.find((row) => row.current).clusterSize, 7);
for (const row of base.rows) {
  ratioShown(row.ratio, Math.sqrt(3 * row.clusterSize), 'table reuse ratio');
  shown(row.siDb, published(base.exponent, row.clusterSize, base.interferers), 'table S/I');
  assert.equal(row.meetsTarget, row.siDb >= base.targetDb, 'table target flag');
}
// The smallest table cluster that clears the target is the first passing row.
assert.equal(base.meetsTarget, false, 'the default 7-cell plan misses 18 dB at n = 3.5');
assert.equal(base.smallestMeeting, 12, 'N = 12 is the smallest cluster on the table that clears 18 dB');
const generous = C.analyse({offsetI: 2, offsetJ: 1, exponent: 4});
assert.equal(generous.meetsTarget, true);
assert.equal(generous.smallestMeeting, 7, 'at n = 4 the 7-cell plan is the first that clears it');
const impossible = C.analyse({offsetI: 1, offsetJ: 0, exponent: 2, targetDb: 40});
assert.equal(impossible.smallestMeeting, null, 'no table cluster clears 40 dB at n = 2');
assert.equal(impossible.meetsTarget, false);
// Numeric input is accepted beside text, as a Node sweep passes numbers.
shown(C.analyse({offsetI: 2, offsetJ: 1, exponent: 3.5, radiusKm: 2}).siDb, base.siDb, 'numeric input');
assert.throws(() => C.analyse({offsetI: 'two'}), /whole number/, 'text offsets are refused');
assert.throws(() => C.analyse({exponent: 'steep'}), /must be a number/, 'text exponent is refused');
assert.throws(() => C.analyse({radiusKm: 101}), /between 0.1 and 100 km/, 'radius above 100 km is refused');

// Page contract: shared shell, keyboard-submittable form, accessible output, no foreign runtime.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html));
assert.ok(!/<script[^>]+src="https?:/i.test(html));
assert.ok(!/<link[^>]+href="https?:/i.test(html));
assert.ok(!/on(?:click|input|change|submit|keydown)=/i.test(html));
assert.ok(!/\beval\s*\(|new\s+Function\b|innerHTML/.test(html));
assert.ok(html.includes('<form id="reuse-form" novalidate>'));
assert.ok(html.includes('type="submit"'));
assert.ok(html.includes('type="button" class="ghost" id="reset"'), 'the reset control is not a submit button');
assert.ok(html.includes('aria-live="polite"') && html.includes('role="alert"'));
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'));
assert.ok(html.includes('<div id="site-header"></div>'));
assert.ok(html.includes('<script src="/assets/theme-init.js"></script>'));
assert.equal((html.match(/<h1>/g) || []).length, 1, 'one h1');
assert.ok(html.includes('aria-labelledby="cluster-title"'), 'the table is labelled by its title');
const ids = (html.match(/ id="([^"]+)"/g) || []).map((token) => token.slice(5, -1));
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
const inputs = {
  'in-i': '2', 'in-j': '1', 'in-n': '3.5', 'in-radius': '2', 'in-channels': '120', 'in-target': '18'
};
for (const id of Object.keys(inputs)) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
  assert.ok(html.includes('for="' + id + '"'), 'missing label ' + id);
  assert.ok(html.includes('id="' + id + '" inputmode='), 'inputmode on ' + id);
  assert.ok(html.includes('value="' + inputs[id] + '">'), 'default value for ' + id);
}
assert.ok(html.includes('<select id="in-sectoring">'), 'sectoring select');
for (const value of ['omni', 'three', 'six']) {
  assert.ok(html.includes('<option value="' + value + '"'), 'sectoring option ' + value);
}
assert.ok(/\.field select\{[^}]*width:auto/.test(html), 'the sectoring select keeps its own width');
for (const id of ['err', 'out', 'reset', 'reuse-form', 'cluster-body', 'cluster-title']) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}
console.log('cellular-frequency-reuse-planner: ' + record.testCases.length +
  ' catalog cases, hexagonal identities, sectoring gains, table and page contract passed');
