/* Regression checks for the animation exposure core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'animation-exposure-calculator';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* anim-exposure-core:start */');
const end = html.indexOf('/* anim-exposure-core:end */');
assert.ok(start > -1 && end > start, 'animation exposure core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '\nmodule.exports = AnimationExposure;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Video');
assert.equal(entry.subcategory, 'Planning');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.icon, '\u{1F39E}\u{FE0F}');
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 6, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 3, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 800, 'method documented');
assert.equal(catalog.tools.length, 2278, 'catalog total');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');
const aliases = catalog.tools.flatMap((tool) => (tool.slug === slug ? [] : tool.aliases || []))
  .map((alias) => alias.toLowerCase());
for (const alias of entry.aliases) {
  assert.ok(!aliases.includes(alias.toLowerCase()), `alias ${alias} is already used`);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && /exposure sheet|on twos|animation timing/i
  .test([tool.name, ...(tool.aliases || [])].join(' '))), 'no other exposure-sheet timing tool');

const failure = (input) => {
  try {
    C.compute(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
const close = (left, right, tolerance = 1e-9) => Math.abs(Number(left) - Number(right)) <= tolerance;
const same = (left, right, label) => assert.equal(JSON.stringify(left), JSON.stringify(right), label);

// --- Constants and defaults. ---
assert.equal(C.MIN_FPS, 1);
assert.equal(C.MAX_FPS, 120);
assert.equal(C.MIN_EXPOSURE, 1);
assert.equal(C.MAX_EXPOSURE, 12);
assert.equal(C.MAX_DURATION, 3600);
assert.equal(C.MAX_DRAWINGS, 100000);
assert.equal(C.CHART_ROWS, 12);
const defaults = C.compute({});
assert.equal(defaults.mode, 'duration');
assert.equal(defaults.fps, 24);
assert.equal(defaults.exposure, 2);
assert.equal(defaults.frames, 144);
assert.equal(defaults.drawings, 72);
assert.equal(defaults.lastHold, 2);
assert.equal(defaults.drawingsPerSecond, 12);
assert.ok(close(defaults.secondsPerDrawing, 1 / 12), 'seconds per drawing');
assert.equal(defaults.durationSeconds, 6);
assert.equal(defaults.truncated, true);
assert.equal(defaults.chart.length, 13);
same([defaults.chart[0].drawing, defaults.chart[0].first, defaults.chart[0].last, defaults.chart[0].hold],
  [1, 1, 2, 2], 'first chart row');
same([defaults.chart[12].drawing, defaults.chart[12].first, defaults.chart[12].last, defaults.chart[12].hold],
  [72, 143, 144, 2], 'final chart row');
assert.equal(defaults.notes.length, 1);
assert.equal(defaults.warnings.length, 0, 'a truncation note is not a warning');
assert.ok(defaults.notes[0].includes('The table lists the first 12 drawings'), 'truncation note');

// --- Every catalog case must agree with the core. ---
let goldenCount = 0;
let boundaryCount = 0;
let validationCount = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    validationCount += 1;
    assert.equal(failure(testCase.input), testCase.expectedError, `${testCase.name}: validation message`);
    continue;
  }
  if (testCase.kind === 'golden') goldenCount += 1;
  else if (testCase.kind === 'boundary') boundaryCount += 1;
  else assert.fail(`unexpected test kind ${testCase.kind}`);
  const result = C.compute(testCase.input);
  const expected = testCase.expected;
  for (const key of ['frames', 'drawings', 'lastHold', 'truncated']) {
    assert.equal(result[key], expected[key], `${testCase.name}: ${key}`);
  }
  assert.equal(result.chart.length, expected.chartRows, `${testCase.name}: chart length`);
  for (const key of ['drawingsPerSecond', 'secondsPerDrawing', 'durationSeconds']) {
    assert.ok(close(result[key], expected[key], 1e-6), `${testCase.name}: ${key} ${result[key]}`);
  }
  same([result.chart[0].drawing, result.chart[0].first, result.chart[0].last, result.chart[0].hold],
    expected.firstRow, `${testCase.name}: first row`);
  const last = result.chart[result.chart.length - 1];
  same([last.drawing, last.first, last.last, last.hold], expected.lastRow, `${testCase.name}: last row`);
  const joined = result.notes.join(' | ');
  for (const fragment of expected.notesContain) {
    assert.ok(joined.includes(fragment), `${testCase.name}: note ${fragment} missing from ${joined}`);
  }
}
assert.equal(goldenCount, 6, 'expected six golden cases');
assert.equal(boundaryCount, 6, 'expected six boundary cases');
assert.equal(validationCount, 12, 'expected twelve validation cases');

// --- Independent structural checks over generated scenes. ---
let seed = 20261114;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const jsRound = (value) => Math.floor(value + 0.5);
let sweeps = 0;
for (let roundIndex = 0; roundIndex < 300; roundIndex += 1) {
  const fps = 1 + Math.floor(random() * 120);
  const exposure = 1 + Math.floor(random() * 12);
  const byDuration = random() < 0.7;
  let input;
  let expectedFrames;
  if (byDuration) {
    let seconds = Math.round((0.01 + random() * 599.99) * 1000) / 1000;
    if (seconds * fps < 1) seconds = Math.round(1000 / fps) / 1000;
    input = { mode: 'duration', fps: String(fps), exposure: String(exposure), duration: String(seconds) };
    expectedFrames = jsRound(seconds * fps);
    assert.ok(expectedFrames >= 1, 'generated scene holds at least one frame');
  } else {
    const drawings = 1 + Math.floor(random() * 5000);
    input = { mode: 'drawings', fps: String(fps), exposure: String(exposure), drawings: String(drawings) };
    expectedFrames = drawings * exposure;
  }
  const result = C.compute(input);
  assert.equal(result.frames, expectedFrames, 'frame count');
  assert.equal(result.drawings, Math.ceil(expectedFrames / exposure), 'drawing count');
  assert.equal(result.lastHold, expectedFrames - (result.drawings - 1) * exposure, 'last hold');
  assert.ok(result.lastHold >= 1 && result.lastHold <= exposure, 'last hold inside the exposure');
  assert.ok(close(result.drawingsPerSecond, fps / exposure), 'drawings per second');
  assert.ok(close(result.secondsPerDrawing, exposure / fps), 'seconds per drawing');
  assert.ok(close(result.durationSeconds, expectedFrames / fps), 'runtime from frames');

  // The table is contiguous, covers the frame range and never overruns the scene.
  const rows = result.chart;
  const shown = Math.min(result.drawings, C.CHART_ROWS);
  assert.equal(rows.length, shown + (result.truncated ? 1 : 0), 'chart length');
  for (let index = 0; index < shown; index += 1) {
    const row = rows[index];
    assert.equal(row.drawing, index + 1, 'drawing numbers count up');
    assert.equal(row.first, index * exposure + 1, 'row starts where the last one ended');
    assert.equal(row.last, Math.min((index + 1) * exposure, expectedFrames), 'row ends on its hold');
    assert.equal(row.hold, row.last - row.first + 1, 'hold covers the range');
  }
  if (result.truncated) {
    const final = rows[rows.length - 1];
    assert.equal(final.drawing, result.drawings, 'final row carries the last drawing');
    assert.equal(final.last, expectedFrames, 'final row reaches the last frame');
    assert.equal(final.hold, result.lastHold, 'final hold matches the result');
  } else {
    assert.equal(rows[rows.length - 1].last, expectedFrames, 'table ends on the last frame');
  }
  // Notes follow the documented conditions and nothing else.
  const expectedWarnings =
    (byDuration && Math.abs(Number(input.duration) * fps - expectedFrames) > 1e-9 ? 1 : 0) +
    (result.lastHold < exposure && result.drawings > 1 ? 1 : 0) +
    (exposure >= fps ? 1 : 0);
  const expectedNotes = expectedWarnings + (result.truncated ? 1 : 0);
  assert.equal(result.warnings.length, expectedWarnings, `warning count in ${JSON.stringify(input)}`);
  assert.equal(result.notes.length, expectedNotes, `note count in ${JSON.stringify(input)}`);
  for (const line of result.warnings) {
    assert.ok(result.notes.includes(line), 'every warning also appears in the notes');
  }
  sweeps += 1;
}
assert.equal(sweeps, 300, 'three hundred generated scenes');

// --- Timing arithmetic that the sweeps cannot reach by chance. ---
const half = C.compute({ mode: 'duration', fps: '25', exposure: '2', duration: '0.5' });
assert.equal(half.frames, 13, '12.5 frames rounds up to 13');
assert.equal(half.drawings, 7);
assert.equal(half.lastHold, 1);
assert.equal(half.durationSeconds, 0.52);
assert.equal(half.notes.length, 2, 'rounding and short tail');
assert.equal(half.warnings.length, 2, 'rounding and short tail are warnings');
assert.ok(half.warnings.some((line) => line.includes('12.50 frames')), 'rounding note names the exact frames');
assert.ok(half.warnings.some((line) => line.includes('Drawing 7 holds only 1 of its 2 frames')), 'short tail note');

const single = C.compute({ mode: 'duration', fps: '24', exposure: '2', duration: '0.042' });
assert.equal(single.frames, 1);
assert.equal(single.drawings, 1);
assert.equal(single.lastHold, 1);
assert.equal(single.notes.filter((line) => line.includes('holds only')).length, 0,
  'a one-drawing sheet is not called short');

const exact = C.compute({ mode: 'duration', fps: '24', exposure: '2', duration: '6' });
assert.equal(exact.notes.length, 1, 'only the truncation note on an even scene');
assert.equal(exact.warnings.length, 0, 'an even scene raises no warning');
const stop = C.compute({ mode: 'duration', fps: '12', exposure: '12', duration: '4' });
assert.ok(stop.notes.some((line) => line.includes('stop-motion pacing')), 'slow hold note');
assert.equal(stop.drawingsPerSecond, 1);

// --- Drawing counts to runtime are exact. ---
const walk = C.compute({ mode: 'drawings', fps: '12', exposure: '1', drawings: '24' });
assert.equal(walk.frames, 24);
assert.equal(walk.drawings, 24);
assert.equal(walk.durationSeconds, 2);
assert.equal(walk.notes.length, 1, 'only the truncation note on the reverse conversion');
assert.ok(walk.notes[0].includes('The table lists the first 12 drawings'), 'truncation note on the reverse');
assert.equal(walk.truncated, true);
const short = C.compute({ mode: 'drawings', fps: '12', exposure: '1', drawings: '8' });
assert.equal(short.notes.length, 0, 'a sheet inside the table needs no note');
const reverse = C.compute({ mode: 'drawings', fps: '24', exposure: '2', drawings: '72' });
assert.equal(reverse.frames, 144);
assert.equal(reverse.durationSeconds, 6);
same([reverse.frames, reverse.drawings, reverse.lastHold], [defaults.frames, defaults.drawings, defaults.lastHold],
  'the reverse conversion agrees with the forward one');

// --- Page contract. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'), 'live status region');
for (const id of ['mode', 'fps', 'exposure', 'duration', 'drawings', 'calculate', 'reset', 'anim-status',
  'headline-out', 'headline-sub', 'chart-body', 'frames-out', 'drawings-out', 'rate-out', 'hold-out',
  'last-hold-out', 'length-out', 'copy', 'copy-status', 'notes']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or output ${id}`);
}
assert.ok(/<form id="anim-form" novalidate>/.test(html), 'form contract');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(/<option value="duration" selected>/.test(html), 'duration mode selected by default');
assert.ok(/<option value="2" selected>/.test(html), 'twos selected by default');
assert.ok(/id="fps"[^>]*value="24"/.test(html), 'default frame rate');
assert.ok(/id="duration"[^>]*value="6"/.test(html), 'default scene length');
assert.ok(/id="drawings"[^>]*value="24"/.test(html), 'default drawing count');
assert.ok(/id="copy"[^>]*disabled/.test(html), 'copy starts disabled');
assert.ok(/id="drawings-field" hidden/.test(html), 'drawing field starts hidden');
assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(html), 'no raw HTML sinks');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'no browser storage');
assert.ok(!/https?:\/\//.test(html.replace(/<meta name="description"[^>]*>/, '')), 'no external requests');
assert.ok(!/\bfetch\(|XMLHttpRequest/.test(html), 'no network calls');
assert.ok(!/\beval\s*\(|new Function\s*\(/.test(html), 'no runtime compilation');

console.log(`${slug}: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed; ` +
  `${sweeps} generated scenes, half-frame rounding, the short last hold, the reverse conversion and the page contract agreed`);
