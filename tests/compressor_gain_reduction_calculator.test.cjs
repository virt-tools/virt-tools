/* Compressor gain reduction calculator: the static gain computer, hard and soft
   knee behaviour, the transfer curve, formatting, refusals, catalog replay and
   the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'compressor-gain-reduction-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* compressor-core:start */';
const endMarker = '/* compressor-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CompressorCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (inputs) => plain(C.compute(inputs));
const failure = (inputs) => {
  try { run(inputs); } catch (error) { return error.message; }
  return null;
};
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' vs ' + expected);
};
const round2 = (value) => {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const rounded = sign * Math.round(Math.abs(value) * 100 + 1e-9) / 100;
  return rounded === 0 ? 0 : rounded;
};
const withDefaults = (patch) => Object.assign({}, C.DEFAULTS, patch);

// ---- Exported constants and defaults.
assert.equal(C.MIN_LEVEL, -80);
assert.equal(C.MAX_LEVEL, 0);
assert.equal(C.MIN_RATIO, 1);
assert.equal(C.MAX_RATIO, 40);
assert.equal(C.MAX_KNEE, 24);
assert.equal(C.MAX_MAKEUP, 36);
assert.deepEqual(plain(C.TABLE_LEVELS), [-48, -40, -30, -24, -18, -12, -6, -3, 0]);
assert.deepEqual(plain(C.DEFAULTS), { threshold: '-18', ratio: '4', level: '-6', knee: '0', makeup: '0' });

// ---- The hard-knee gain computer, against the definition in decibels.
close(C.gainReduction(-6, -18, 4, 0), -9, 1e-12, '12 dB over a 4:1 threshold is 3 dB over');
close(C.gainReduction(0, -18, 20, 0), -17.1, 1e-12, '18 dB over a 20:1 threshold is 0.9 dB over');
close(C.gainReduction(-6, -18, 1, 0), 0, 1e-15, 'a 1:1 ratio never reduces');
close(C.gainReduction(-18, -18, 4, 0), 0, 1e-15, 'at the threshold a hard knee is at unity');
close(C.gainReduction(-18.001, -18, 4, 0), 0, 1e-15, 'a hundredth below the threshold is untouched');
// The reported output is the input plus the reduction, exactly.
for (const level of [-80, -60.5, -18, -12.25, -6, -0.5, 0]) {
  for (const ratio of [1, 1.5, 4, 20, 40]) {
    for (const knee of [0, 6, 24]) {
      const reduction = C.gainReduction(level, -18, ratio, knee);
      assert.ok(reduction <= 0, 'reduction is never positive');
      close(C.transfer(level, -18, ratio, knee), level + reduction, 1e-12, 'output is input plus reduction');
      const above = level - (-18);
      if (above >= knee / 2) {
        close(reduction, above * (1 / ratio - 1), 1e-12, 'above the knee the slope is 1/R at ' + level);
      }
    }
  }
}

// ---- The soft knee bridges the two regions and joins them smoothly.
const W = 12;
const T = -18;
const R = 4;
const lower = T - W / 2;
const upper = T + W / 2;
close(C.gainReduction(lower, T, R, W), 0, 1e-12, 'the knee starts at zero reduction');
close(C.gainReduction(lower - 0.001, T, R, W), 0, 1e-12, 'below the knee there is no reduction');
close(C.gainReduction(upper, T, R, W), C.gainReduction(upper, T, R, 0), 1e-12,
  'the knee meets the hard-knee value at its upper edge');
const kneeFull = C.gainReduction(upper, T, R, 0);
close(C.gainReduction(T, T, R, W), kneeFull / 4, 1e-12, 'the threshold sits a quarter of the way up the knee');
// Continuity: no jump as the level crosses either knee edge.
for (const edge of [lower, upper]) {
  assert.ok(Math.abs(C.gainReduction(edge - 1e-6, T, R, W) - C.gainReduction(edge + 1e-6, T, R, W)) <= 1e-5,
    'the knee is continuous at ' + edge);
}
// Slope continuity at the upper edge, by central difference.
const step = 1e-4;
close((C.gainReduction(upper + step, T, R, W) - C.gainReduction(upper - step, T, R, W)) / (2 * step),
  1 / R - 1, 1e-3, 'the knee slope matches the hard knee at the upper edge');
// Inside the knee the curve is convex and above the straight line between its ends.
for (let over = -W / 2 + 0.5; over < W / 2; over += 0.5) {
  const value = C.gainReduction(T + over, T, R, W);
  const chord = (over + W / 2) / W * kneeFull;
  assert.ok(value > chord + 1e-12, 'the knee bends above its chord at ' + over);
  assert.ok(value > kneeFull, 'the knee never over-reduces at ' + over);
}

// ---- The transfer curve rises monotonically and never faster than unity.
for (const ratio of [1, 2, 4, 20]) {
  for (const knee of [0, 8, 24]) {
    let previous = C.transfer(-80, -24, ratio, knee);
    for (let level = -79.75; level <= 0.0001; level += 0.25) {
      const output = C.transfer(level, -24, ratio, knee);
      assert.ok(output >= previous - 1e-9, 'output never falls at ' + level);
      assert.ok(output - previous <= 0.25 + 1e-9, 'output never rises faster than the input');
      previous = output;
    }
  }
}

// ---- Results, texts and the table.
const base = run(C.DEFAULTS);
assert.equal(base.gainReductionDb, -9);
assert.equal(base.outputDb, -15);
assert.equal(base.finalDb, -15);
assert.equal(base.peakMakeupDb, 9);
assert.equal(base.active, true);
assert.equal(base.ratioText, '4:1');
assert.equal(base.kneeText, 'Hard knee');
assert.equal(base.gainReductionText, '-9.00 dB');
assert.equal(base.outputText, '-15.00 dBFS');
assert.equal(base.finalText, '-15.00 dBFS');
assert.equal(base.peakMakeupText, '+9.00 dB');
assert.equal(base.slopeText, '0.25 dB out per dB in');
assert.equal(base.headline, '-9.00 dB gain reduction');
assert.equal(base.rows.length, 9);
assert.deepEqual(plain(base.rows.map((row) => row.levelText)), ['-48', '-40', '-30', '-24', '-18', '-12', '-6', '-3', '0']);
assert.deepEqual(plain(base.rows.filter((row) => row.current).map((row) => row.levelText)), ['-6'],
  'the entered level marks one row');
assert.equal(base.rows.find((row) => row.levelText === '-48').outputText, '-48.00 dBFS');
assert.equal(base.rows.find((row) => row.levelText === '0').gainReductionText, '-13.50 dB');
assert.equal(base.rows.find((row) => row.levelText === '0').outputText, '-13.50 dBFS');

const below = run(withDefaults({ level: '-30' }));
assert.equal(below.gainReductionDb, 0);
assert.equal(below.outputDb, -30);
assert.equal(below.peakMakeupDb, 0);
assert.equal(below.active, false);
assert.equal(below.peakMakeupText, '0.00 dB');

const makeup = run(withDefaults({ makeup: '6' }));
assert.equal(makeup.finalDb, -9);
assert.equal(makeup.finalText, '-9.00 dBFS');
assert.equal(makeup.peakMakeupText, '+9.00 dB');

const soft = run(withDefaults({ level: '-18', knee: '12' }));
assert.equal(soft.gainReductionDb, -1.13);
assert.equal(soft.outputDb, -19.13);
assert.equal(soft.peakMakeupDb, 1.13);
assert.equal(soft.active, true, 'a soft knee compresses at the threshold');
assert.equal(soft.kneeText, 'Soft knee, 12 dB');

const fractionalKnee = run(withDefaults({ knee: '6.5' }));
assert.equal(fractionalKnee.kneeText, 'Soft knee, 6.5 dB');

const fractionalRatio = run(withDefaults({ ratio: '2.5' }));
assert.equal(fractionalRatio.ratioText, '2.5:1');
assert.equal(fractionalRatio.slopeText, '0.40 dB out per dB in');

// Negative zero and tiny reductions print without a sign.
assert.equal(C.formatDb(-0.0001), '0.00 dB');
assert.equal(C.formatSigned(-0.0001), '0.00 dB');
assert.equal(C.formatLevel(-0.0001), '0.00 dBFS');
assert.equal(C.ratioLabel(1), '1:1');
assert.equal(C.ratioLabel(40), '40:1');

// The plot samples the whole chart range, one point per decibel.
const points = C.plotPoints(-18, 4, 0);
assert.equal(points.length, 61);
assert.equal(points[0].input, -60);
assert.equal(points[points.length - 1].input, 0);
assert.equal(points[0].output, -60);
close(points[points.length - 1].output, -13.5, 1e-12, 'the last plot point sits at the compressor output');

// ---- Refusals, by exact message.
const refusals = [
  [withDefaults({ threshold: '' }), 'Enter the threshold in dBFS, such as -18.'],
  [withDefaults({ threshold: '  ' }), 'Enter the threshold in dBFS, such as -18.'],
  [withDefaults({ threshold: 'minus eighteen' }), 'Enter the threshold as a number in dBFS, such as -18.'],
  [withDefaults({ threshold: '-81' }), 'Threshold must be between -80 and 0 dBFS.'],
  [withDefaults({ threshold: '1' }), 'Threshold must be between -80 and 0 dBFS.'],
  [withDefaults({ ratio: '' }), 'Enter the compression ratio, such as 4.'],
  [withDefaults({ ratio: 'abc' }), 'Enter the ratio as a number, such as 4.'],
  [withDefaults({ ratio: '0.5' }), 'Ratio must be between 1 and 40.'],
  [withDefaults({ ratio: '41' }), 'Ratio must be between 1 and 40.'],
  [withDefaults({ level: '' }), 'Enter the input level in dBFS, such as -6.'],
  [withDefaults({ level: '1e2' }), 'Enter the input level as a number in dBFS, such as -6.'],
  [withDefaults({ level: '-81' }), 'Input level must be between -80 and 0 dBFS.'],
  [withDefaults({ level: '0.5' }), 'Input level must be between -80 and 0 dBFS.'],
  [withDefaults({ knee: '' }), 'Enter the knee width in dB, such as 6.'],
  [withDefaults({ knee: 'wide' }), 'Enter the knee width as a number in dB, such as 6.'],
  [withDefaults({ knee: '25' }), 'Knee width must be between 0 and 24 dB.'],
  [withDefaults({ knee: '-1' }), 'Knee width must be between 0 and 24 dB.'],
  [withDefaults({ makeup: '' }), 'Enter the makeup gain in dB, such as 0.'],
  [withDefaults({ makeup: 'lots' }), 'Enter the makeup gain as a number in dB, such as 0.'],
  [withDefaults({ makeup: '-1' }), 'Makeup gain must be between 0 and 36 dB.'],
  [withDefaults({ makeup: '37' }), 'Makeup gain must be between 0 and 36 dB.']
];
for (const [inputs, message] of refusals) assert.equal(failure(inputs), message, message);

// ---- Catalog record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.ok(Array.isArray(catalog.tools) && catalog.tools.every((tool) => tool.slug && tool.name),
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Compressor Gain Reduction Calculator');
assert.equal(record.category, 'Audio');
assert.equal(record.subcategory, 'Mixing');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(/^2026-11-27T\d\d:\d\d:\d\dZ$/.test(record.added), 'added is a UTC timestamp');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('1 / R - 1'), 'method states the gain computer');
assert.ok(record.method.includes('W/2'), 'method states the knee blend');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.equal(record.sources.length, 1, 'one source is cited');
assert.ok(record.sources.every((source) => /^https:\/\//.test(source.url)), 'sources carry fetched URLs');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 19, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 3, 'three boundary cases');
assert.equal(kinds('validation'), 8, 'eight validation cases');

let checked = 0;
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = run(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') {
      assert.equal(round2(actual[key]), expected, testCase.name + ' ' + key);
    } else {
      assert.equal(actual[key], expected, testCase.name + ' ' + key);
    }
    checked += 1;
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
for (const key of [record.slug, record.name].concat(record.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');
for (const tag of ['audio', 'dynamics', 'compressor', 'gain-reduction', 'threshold', 'ratio', 'knee', 'mixing', 'gain-staging']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}
assert.equal(catalog.tools.length, 2504, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2243, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Audio').length, 57, 'audio records');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 13, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const field of ['threshold', 'ratio', 'level', 'knee', 'makeup']) {
  assert.ok(new RegExp('<label for="' + field + '">').test(html), 'the ' + field + ' field has a label');
  assert.ok(new RegExp('id="' + field + '"').test(html), 'the ' + field + ' field has an id');
}
assert.equal((html.match(/type="text"/g) || []).length, 5, 'five text inputs');
assert.equal((html.match(/inputmode="decimal"/g) || []).length, 5, 'numeric keyboards on touch');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/<caption>/.test(html) && /<th scope="col">/.test(html), 'the table is described');
assert.ok(/head\.scope = "row"/.test(html), 'the generated table rows are headed');
assert.ok(/<svg id="curve"/.test(html) && /role="img"/.test(html) && /aria-label=/.test(html),
  'the chart is labelled');
assert.ok(/<figcaption>/.test(html), 'the chart has a caption');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html.replace('http://www.w3.org/2000/svg', '')),
  'no external URLs beyond the SVG namespace');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('compressor gain reduction: 8 golden, 3 boundary and 8 validation cases, '
  + refusals.length + ' refusals, ' + checked + ' expected fields and the page contract pass');
