/* Flicker-free shutter planner: the pulse model, the page markup and the
   catalog record's eighteen cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'flicker-free-shutter-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* flicker-core:start */';
const endMarker = '/* flicker-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, isFinite, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = FlickerCore;', sandbox);
const C = sandbox.module.exports;

const near = (value, expected, tolerance, label) => {
  assert.ok(Math.abs(value - expected) <= tolerance, `${label}: ${value} against ${expected}`);
};
const failure = (payload) => {
  try { C.plan(payload); } catch (error) { return error.message; }
  return null;
};
const plan = (light, fps, angle, freq) => C.plan({ light, fps, angle, freq });

// ---- Parsing and limits.
assert.equal(failure({ light: '50', fps: 'abc', angle: '180' }), 'Frame rate must be a number.');
assert.equal(failure({ light: '50', fps: '', angle: '180' }), 'Frame rate is required.');
assert.equal(failure({ light: '50', fps: '0', angle: '180' }), 'Frame rate must be from 1 to 240 fps.');
assert.equal(failure({ light: '50', fps: '241', angle: '180' }), 'Frame rate must be from 1 to 240 fps.');
assert.equal(failure({ light: '50', fps: '24', angle: '0.5' }),
  'Shutter angle must be from 1 to 360 degrees.');
assert.equal(failure({ light: '50', fps: '24', angle: '361' }),
  'Shutter angle must be from 1 to 360 degrees.');
assert.equal(failure({ light: '70', fps: '24', angle: '180' }),
  'Choose 50 Hz mains, 60 Hz mains or a custom ripple frequency.');
assert.equal(failure({ light: 'custom', freq: '', fps: '24', angle: '180' }),
  'Light ripple frequency is required.');
assert.equal(failure({ light: 'custom', freq: '9.9', fps: '24', angle: '180' }),
  'Light ripple frequency must be from 10 to 2000 Hz.');
assert.equal(failure({ light: 'custom', freq: '2001', fps: '24', angle: '180' }),
  'Light ripple frequency must be from 10 to 2000 Hz.');
near(plan('custom', '24', '180', '10').rippleHz, 10, 1e-12, '10 Hz accepted');
near(plan('custom', '24', '180', '2000').rippleHz, 2000, 1e-12, '2000 Hz accepted');

// ---- Mains presets and the pulse arithmetic.
assert.deepEqual({ ...C.MAINS_RIPPLE }, { 50: 100, 60: 120 });
assert.deepEqual(Array.from(C.FPS_LIMITS), [1, 240]);
assert.deepEqual(Array.from(C.ANGLE_LIMITS), [1, 360]);
assert.deepEqual(Array.from(C.FREQ_LIMITS), [10, 2000]);
assert.equal(C.ROW_LIMIT, 12);
assert.equal(C.SAFE_LIMIT, 0.005);

const base = plan('50', '24', '180');
near(base.rippleHz, 100, 1e-12, 'ripple');
near(base.pulseMs, 10, 1e-9, 'pulse period');
near(base.frameMs, 41.6666667, 1e-6, 'frame interval');
near(base.exposureMs, 20.8333333, 1e-6, 'target exposure');
near(base.pulses, 2.0833333, 1e-6, 'pulses covered');
assert.equal(base.nearestPulses, 2);
near(base.swingPct, 8.3333333, 1e-6, 'brightness swing');
assert.equal(base.safe, false);
assert.equal(base.maxPulses, 4);
near(base.best.angle, 172.8, 1e-9, 'best angle');
near(1 / base.best.shutterSeconds, 50, 1e-9, 'best shutter speed');
near(base.best.stops, -0.0591, 0.001, 'best exposure change');

// The identities that define the page.
for (const [light, fps, angle, freq] of [
  ['50', '24', '180', ''], ['50', '25', '180', ''], ['60', '30', '180', ''],
  ['60', '24', '180', ''], ['50', '30', '144', ''], ['custom', '25', '144', '200'],
  ['60', '29.97', '172.8', ''], ['50', '23.976', '180', ''], ['50', '96', '270', ''],
]) {
  const result = plan(light, fps, angle, freq);
  const frame = 1 / Number(fps);
  near(result.pulses, Number(angle) * result.rippleHz / (360 * Number(fps)), 1e-9, 'pulse identity');
  near(result.shutterSeconds, Number(angle) / (360 * Number(fps)), 1e-12, 'exposure identity');
  near(result.frameMs, frame * 1000, 1e-9, 'frame identity');
  for (const row of result.rows) {
    near(row.angle, 360 * row.pulses * Number(fps) / result.rippleHz, 1e-9, 'row angle identity');
    near(row.shutterSeconds * result.rippleHz, row.pulses, 1e-12, 'row whole-pulse identity');
    assert.ok(row.angle <= 360 + 1e-9, 'row fits inside a frame');
  }
  assert.ok(result.rows.length <= C.ROW_LIMIT, 'row cap');
  assert.ok(result.best === null || (result.best.pulses >= 1 && result.best.pulses <= result.maxPulses),
    'best stays inside the frame');
}

// ---- The safety boundary at half a percent of a pulse.
const atLimit = C.plan({ light: 'custom', freq: '100', fps: '24', angle: '172.8' });
assert.equal(atLimit.safe, true, 'exactly two pulses is safe');
const faster = C.plan({ light: 'custom', freq: '1000', fps: '240', angle: '180' });
assert.equal(faster.maxPulses, 4, '1000 Hz ripple leaves four pulses per 240 fps frame');
const boundary = C.plan({ light: '50', fps: '100', angle: '180' });
near(boundary.pulses, 0.5, 1e-12, 'boundary pulses');
assert.equal(boundary.safe, false);
const edgeIn = C.plan({ light: '50', fps: '100', angle: '1.8' });
near(edgeIn.pulses, 0.005, 1e-12, 'edge pulses');
assert.equal(edgeIn.safe, true, 'exactly half a percent of a pulse is safe');
const edgeOut = C.plan({ light: '50', fps: '100', angle: '1.81' });
near(edgeOut.pulses, 0.0050277, 1e-6, 'edge out pulses');
assert.equal(edgeOut.safe, false, 'just past half a percent is not safe');

// ---- Whole-pulse cases and the recommendation rule.
assert.equal(plan('50', '25', '180').safe, true);
assert.equal(plan('50', '24', '172.8').safe, true);
assert.equal(plan('60', '30', '180').safe, true);
near(plan('60', '24', '180').best.angle, 216, 1e-9, '216 degrees wins the stop tie at 24 fps and 60 Hz');
near(plan('50', '30', '180').best.angle, 216, 1e-9, '216 degrees at 30 fps and 50 Hz');
near(plan('50', '1', '180').best.angle, 180, 1e-9, 'a long exposure still finds 180 degrees');
near(plan('60', '120', '180').best.angle, 360, 1e-9, 'only the open shutter fits at 120 fps');
assert.equal(plan('60', '120', '180').maxPulses, 1);
assert.equal(plan('50', '240', '180').best, null);
assert.deepEqual(Array.from(plan('50', '240', '180').suggestedFps).map((v) => Math.round(v)),
  [100, 50, 33]);
assert.equal(plan('50', '240', '180').rows.length, 0);
assert.equal(plan('50', '1', '180').rows.length, 12, 'the table is capped at twelve rows');

// ---- Every row is one whole pulse step of the ripple.
const custom = plan('custom', '48', '180', '600');
const step = 360 * 48 / 600;
assert.equal(custom.maxPulses, 12, '600 Hz at 48 fps leaves twelve pulses inside a frame');
assert.equal(custom.rows.length, 12);
custom.rows.forEach((row, index) => {
  near(row.angle, step * (index + 1), 1e-9, 'row ' + index + ' is a whole pulse step');
  near(row.exposureMs, (index + 1) / 600 * 1000, 1e-9, 'row ' + index + ' exposure');
  near(row.shutterSeconds, (index + 1) / 600, 1e-12, 'row ' + index + ' shutter');
});

// ---- Page markup contract.
assert.ok(html.includes('<title>Flicker-Free Shutter Planner — Virtual Tools</title>'));
assert.ok(html.includes('name="description"'));
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.ok(html.includes('/assets/app.js'));
assert.ok(html.includes('<select id="in-light">'));
assert.ok(html.includes('<input type="text" id="in-freq" inputmode="decimal"'));
assert.ok(html.includes('<input type="text" id="in-fps" inputmode="decimal"'));
assert.ok(html.includes('<input type="text" id="in-angle" inputmode="decimal"'));
assert.ok(html.includes('<option value="50" selected>'));
assert.ok(html.includes('<option value="60">'));
assert.ok(html.includes('<option value="custom">'));
assert.ok(html.includes('value="24"'));
assert.ok(html.includes('value="180"'));
assert.ok(html.includes('id="out" aria-live="polite" aria-atomic="true"'));
assert.ok(html.includes('role="alert" aria-live="polite"'));
assert.ok(html.includes('<ul class="warn-list" id="warnings" aria-live="polite">'));
assert.ok(html.includes('<table>'));
assert.ok(html.includes('chart-scroll'), 'the table scrolls inside its own box');
assert.ok(html.includes('@media(max-width:720px)'), 'the layout reflows for phones');
assert.ok(html.includes('min-height:44px'), 'controls keep a 44 px target');
assert.ok(!/\son[a-z]+=/.test(html), 'no inline event handlers');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), 'no network or storage');
assert.ok(!/https?:\/\//.test(html), 'no third-party requests');
assert.ok(html.includes('no uploads, network access or storage'));

// ---- Catalog record and every case in it must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2248, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Flicker-Free Shutter Planner');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.icon, '\u{1f505}');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.description.length < 260, 'description stays short');
assert.ok(record.method.includes('twice the mains frequency'), 'method states the ripple');
assert.ok(record.method.includes('0.5%'), 'method states the safety tolerance');
assert.ok(record.method.includes('stops'), 'method states the recommendation rule');
assert.ok(record.method.includes('1-240 fps'), 'method states the frame-rate range');
assert.ok(record.method.includes('no uploads'), 'method states the privacy position');
assert.ok(record.sources.length >= 3, 'sources are cited');
assert.ok(record.sources.every((source) => source.title.length > 40), 'sources are described');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.tags.includes('flicker'));

assert.equal(record.testCases.length, 18, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 12);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 6);
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expected.error, testCase.name);
    continue;
  }
  const result = C.plan(testCase.input);
  const expected = testCase.expected;
  near(result.rippleHz, expected.rippleHz, 1e-6, testCase.name + ' ripple');
  near(result.pulseMs, expected.pulseMs, 1e-6, testCase.name + ' pulse');
  near(result.frameMs, expected.frameMs, 1e-6, testCase.name + ' frame');
  near(result.exposureMs, expected.shutterMs, 1e-6, testCase.name + ' shutter');
  near(result.pulses, expected.pulses, 1e-6, testCase.name + ' pulses');
  assert.equal(result.nearestPulses, expected.nearestPulses, testCase.name + ' nearest');
  near(result.swingPct, expected.swingPct, 1e-6, testCase.name + ' swing');
  assert.equal(result.safe, expected.safe, testCase.name + ' safe');
  assert.equal(result.maxPulses, expected.maxPulses, testCase.name + ' max pulses');
  if (expected.bestAngle === null) {
    assert.equal(result.best, null, testCase.name + ' best');
  } else {
    near(result.best.angle, expected.bestAngle, 1e-6, testCase.name + ' best angle');
    near(1 / result.best.shutterSeconds, expected.bestShutterDen, 1e-6, testCase.name + ' best den');
    near(result.best.stops, expected.bestStops, 1e-6, testCase.name + ' best stops');
  }
  assert.equal(result.rows.length, expected.rowCount, testCase.name + ' rows');
  expected.rowAngles.forEach((value, index) => {
    near(result.rows[index].angle, value, 1e-6, testCase.name + ' row ' + index);
  });
  if (expected.suggestedFps) {
    assert.deepEqual(Array.from(result.suggestedFps).map((v) => Math.round(v * 1e6) / 1e6),
      expected.suggestedFps, testCase.name + ' suggested frame rates');
  }
}

// Slugs, names and aliases stay unique across the whole catalog.
const owners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!owners.has(folded)) owners.set(folded, new Set());
    owners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases)) {
  assert.deepEqual(Array.from(owners.get(String(key).toLowerCase())), [slug],
    'catalog key is unique: ' + key);
}

// The page directory and the catalog must agree.
assert.ok(fs.existsSync(path.join(root, 'frontend/tools', slug, 'index.html')));
assert.ok(fs.existsSync(path.join(root, 'frontend/assets/tool-meta', slug + '.json')),
  'generated metadata exists');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-meta', slug + '.json'), 'utf8'));
assert.equal(meta.slug, slug);
assert.equal(meta.testCaseCount, 18);

console.log('flicker_free_shutter_planner: all checks passed');
