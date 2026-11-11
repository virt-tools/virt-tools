/* Album side split planner: replay the catalog fixtures, recompute the split
   with an independent model, sweep tracklists against the stated invariants,
   pin the refusals and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'album-side-split-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* side-split-core:start */');
const end = html.indexOf('/* side-split-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = SideSplitCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
assert.equal(catalog.tools.length, 2217, 'catalog total');
const entry = matches[0];
assert.equal(entry.name, 'Album Side Split Planner');
assert.equal(entry.category, 'Music');
assert.equal(entry.subcategory, 'Planning');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 1000, 'method must document the model and limits');
assert.ok(entry.sources.length >= 3);
const kinds = entry.testCases.reduce((acc, testCase) => {
  acc[testCase.kind] = (acc[testCase.kind] || 0) + 1;
  return acc;
}, {});
assert.equal(entry.testCases.length, 16, 'catalog case count');
assert.deepEqual(kinds, { golden: 6, boundary: 4, validation: 6 });
assert.ok(!entry.description.toLowerCase().includes('https://'), 'description stays plain');

// Independent model: a single break in the running order, sides summed from
// their tracks, the break with the shorter longest side wins, ties to the
// smaller difference, and a side is legal up to and including the limit.
const CAPACITY = { 'lp12-33': 1320, 'single12-45': 720, 'lp10-33': 840, 'single7-45': 270, c60: 1800, c90: 2700 };
const ORDER = ['single7-45', 'single12-45', 'lp10-33', 'lp12-33', 'c60', 'c90'];
function durationOf(line) {
  const match = /(\d{1,3}):([0-5]\d)$/.exec(line.trim());
  assert.ok(match, 'model cannot parse ' + JSON.stringify(line));
  return Number(match[1]) * 60 + Number(match[2]);
}
function expectedModel(format, text) {
  const seconds = text.split('\n').map((line) => line.trim()).filter(Boolean).map(durationOf);
  assert.ok(seconds.length >= 2 && seconds.length <= 40, 'model track count');
  const total = seconds.reduce((sum, value) => sum + value, 0);
  let best = null;
  for (let k = 1; k < seconds.length; k++) {
    const first = seconds.slice(0, k).reduce((sum, value) => sum + value, 0);
    const second = total - first;
    const longest = Math.max(first, second);
    const gap = Math.abs(first - second);
    if (!best || longest < best.longest || (longest === best.longest && gap < best.gap)) {
      best = { index: k, first, second, longest, gap };
    }
  }
  const capacity = CAPACITY[format];
  const over = Math.max(0, best.first - capacity) + Math.max(0, best.second - capacity);
  const suggested = ORDER.find((id) => CAPACITY[id] >= best.longest) || null;
  return {
    splitIndex: best.index, sideASeconds: best.first, sideBSeconds: best.second,
    gapSeconds: best.gap, longestSeconds: best.longest, overflowSeconds: over,
    trackCount: seconds.length, fits: over === 0, suggestedFormat: suggested,
    totalSeconds: total,
  };
}
function attempt(run) {
  try { return run(); } catch (error) { return error.message; }
}
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.ok(testCase.expectedError, testCase.name + ' needs an expectedError');
    assert.equal(attempt(() => C.calculate(testCase.input)), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const [field, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[field], value, testCase.name + ' ' + field);
  }
  const model = expectedModel(testCase.input.format, testCase.input.tracklist);
  for (const [field, value] of Object.entries(model)) {
    assert.deepEqual(result[field], value, testCase.name + ' (recomputed) ' + field);
  }
}

// Hand anchors: ten tracks total 40:15, the best break after track five is
// 1213 s against 1202 s; the LP limit is 1320 s so both sides fit.
const defaultResult = C.calculate({});
assert.equal(defaultResult.sideASeconds, 1213);
assert.equal(defaultResult.sideBSeconds, 1202);
assert.equal(defaultResult.gapSeconds, 11);
assert.equal(defaultResult.longestSeconds, 1213);
assert.equal(defaultResult.splitIndex, 5);
assert.equal(defaultResult.trackCount, 10);
assert.equal(defaultResult.capacitySeconds, 1320);
assert.equal(defaultResult.fits, true);
assert.equal(defaultResult.suggestedFormat, 'lp12-33');
assert.equal(defaultResult.sideALabel, '20:13');
assert.equal(defaultResult.sideBLabel, '20:02');
assert.equal(defaultResult.spareASeconds, 107);
assert.equal(defaultResult.spareBSeconds, 118);
assert.equal(defaultResult.totalLabel, '40:15');
assert.equal(defaultResult.sideA.tracks.length, 5);
assert.equal(defaultResult.sideB.tracks.length, 5);
assert.equal(defaultResult.sideA.tracks[0].title, 'Opening Statement');
assert.equal(defaultResult.sideB.tracks[0].title, 'Rust and Rain');

const anchors = [
  // [{format, tracklist}, splitIndex, sideA, sideB, gap, fits, suggested]
  [{ format: 'lp12-33', tracklist: 'A 22:00\nB 0:01' }, 1, 1320, 1, 1319, true, 'lp12-33'],
  [{ format: 'lp12-33', tracklist: 'A 22:00\nB 22:00\nC 0:01' }, 1, 1320, 1321, 1, false, 'c60'],
  [{ format: 'single7-45', tracklist: 'A 0:01\nB 0:01' }, 1, 1, 1, 0, true, 'single7-45'],
  [{ format: 'c90', tracklist: Array.from({ length: 40 }, () => '1:00').join('\n') }, 20, 1200, 1200, 0, true, 'lp12-33'],
  [{ format: 'single7-45', tracklist: 'Up 1:05\nOn 1:20\nOut 1:10\nHome 1:15' }, 2, 145, 145, 0, true, 'single7-45'],
  [{ format: 'lp12-33', tracklist: 'Arrival 9:30\nInterlude 8:45\nThe Descent 12:20' }, 2, 1095, 740, 355, true, 'lp12-33'],
];
for (const [input, index, sideA, sideB, gap, fits, suggested] of anchors) {
  const result = C.calculate(input);
  const tag = JSON.stringify(input).slice(0, 60);
  assert.equal(result.splitIndex, index, tag + ' split');
  assert.equal(result.sideASeconds, sideA, tag + ' side A');
  assert.equal(result.sideBSeconds, sideB, tag + ' side B');
  assert.equal(result.gapSeconds, gap, tag + ' gap');
  assert.equal(result.fits, fits, tag + ' fits');
  assert.equal(result.suggestedFormat, suggested, tag + ' suggested');
}

// Formatting: minutes:seconds below an hour, h:mm:ss above, and labels always
// reconstruct the underlying seconds.
assert.equal(C.formatTime(0), '0:00');
assert.equal(C.formatTime(1), '0:01');
assert.equal(C.formatTime(59), '0:59');
assert.equal(C.formatTime(60), '1:00');
assert.equal(C.formatTime(3599), '59:59');
assert.equal(C.formatTime(3600), '1:00:00');
assert.equal(C.formatTime(2700), '45:00');
assert.equal(C.formatTime(3725), '1:02:05');
assert.equal(C.formatTime(1.4), '0:01');
assert.equal(C.formatTime(-5), '0:00');

// Sweep: every format, track counts 2-12 and a pool of durations including
// minute boundaries. Each result must close against the statement of the
// method, and the winning break must be the true optimum.
const durations = [1, 29, 59, 60, 61, 119, 180, 241, 300, 359, 420, 599, 720, 1320, 1800, 2700, 3600];
let swept = 0;
for (const format of C.BY_CAPACITY) {
  for (let count = 2; count <= 12; count++) {
    for (const value of durations) {
      const lines = Array.from({ length: count }, (_, i) => 'Track ' + (i + 1) + ' ' + Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0'));
      const text = lines.join('\n');
      const r = C.calculate({ format, tracklist: text });
      const tag = format + ' n=' + count + ' d=' + value;
      assert.equal(r.trackCount, count, 'count ' + tag);
      assert.equal(r.sideA.seconds + r.sideB.seconds, r.totalSeconds, 'sides close ' + tag);
      assert.equal(r.sideA.seconds, r.sideASeconds, 'side A label ' + tag);
      assert.equal(r.sideB.seconds, r.sideBSeconds, 'side B label ' + tag);
      assert.equal(r.sideA.tracks.length + r.sideB.tracks.length, count, 'track split ' + tag);
      assert.equal(r.sideA.tracks.length, r.splitIndex, 'side A holds the first tracks ' + tag);
      assert.equal(r.longestSeconds, Math.max(r.sideASeconds, r.sideBSeconds), 'longest ' + tag);
      assert.equal(r.gapSeconds, Math.abs(r.sideASeconds - r.sideBSeconds), 'gap ' + tag);
      assert.equal(r.longestSide, r.sideASeconds >= r.sideBSeconds ? 'Side A' : 'Side B', 'longest side ' + tag);
      assert.equal(r.capacitySeconds, CAPACITY[format], 'capacity ' + tag);
      assert.equal(r.fits, r.overflowSeconds === 0, 'fits flag ' + tag);
      assert.equal(r.overflowSeconds, Math.max(0, r.sideASeconds - CAPACITY[format]) + Math.max(0, r.sideBSeconds - CAPACITY[format]), 'overflow ' + tag);
      assert.equal(r.suggestedFormat, ORDER.find((id) => CAPACITY[id] >= r.longestSeconds) || null, 'suggested ' + tag);
      // Brute force the best break for the same tracklist.
      const seconds = Array.from({ length: count }, () => value);
      let bestLongest = Infinity, bestGap = Infinity;
      for (let k = 1; k < count; k++) {
        const first = seconds.slice(0, k).reduce((a, b) => a + b, 0);
        const second = seconds.slice(k).reduce((a, b) => a + b, 0);
        const longest = Math.max(first, second);
        const gap = Math.abs(first - second);
        if (longest < bestLongest || (longest === bestLongest && gap < bestGap)) { bestLongest = longest; bestGap = gap; }
      }
      assert.equal(r.longestSeconds, bestLongest, 'optimal longest ' + tag);
      assert.equal(r.gapSeconds, bestGap, 'optimal gap ' + tag);
      swept += 1;
    }
  }
}
assert.ok(swept >= 1000, 'sweep size ' + swept);

// A mixed-duration sweep, including CRLF, stray blank lines, trailing spaces
// and titles that end in punctuation.
const mixed = [
  { format: 'lp12-33', tracklist: '\n\n  A Song: 3:45  \n\nB Song - 2:20\n\n' },
  { format: 'c60', tracklist: 'One 2:30\r\nTwo 3:15\r\nThree 4:05' },
  { format: 'lp10-33', tracklist: ' 3:00 \n 4:00 \n 5:00' },
  { format: 'single12-45', tracklist: 'Untitled 6:00\nUntitled 5:59' },
];
for (const input of mixed) {
  const r = C.calculate(input);
  assert.ok(r.trackCount >= 2, 'mixed parse ' + JSON.stringify(input));
  assert.equal(r.sideA.tracks[0].title.length > 0, true, 'title fallback');
  assert.equal(r.sideA.seconds + r.sideB.seconds, r.totalSeconds, 'mixed closes');
}

// Refusals: parser limits, the one-hour cap, the 40-track cap and the medium
// whitelist each keep their own message.
const base = { format: 'lp12-33', tracklist: 'One 3:00\nTwo 3:00' };
const refusals = [
  [{ tracklist: 'Solo 3:30' }, 'Add at least two tracks, one per line, like \'Opening 3:45\'.'],
  [{ tracklist: '' }, 'Add at least two tracks, one per line, like \'Opening 3:45\'.'],
  [{ tracklist: '\n \n' }, 'Add at least two tracks, one per line, like \'Opening 3:45\'.'],
  [{ tracklist: 'Title only\nSecond 3:00' }, 'Line 1: add a duration like 3:45.'],
  [{ tracklist: 'One 3:00\nTwo 3:0' }, 'Line 2: add a duration like 3:45.'],
  [{ tracklist: 'One 3:00\nTwo 3:60' }, 'Line 2: add a duration like 3:45.'],
  [{ tracklist: 'One 3:00\nTwo three:zero' }, 'Line 2: add a duration like 3:45.'],
  [{ tracklist: 'Zero 0:00\nTwo 3:00' }, 'Line 1: durations must be at least 0:01.'],
  [{ tracklist: 'One 3:00\nHour 60:01' }, 'Line 2: durations must be 60:00 or less.'],
  [{ tracklist: Array.from({ length: 41 }, () => '1:00').join('\n') }, 'The tracklist is limited to 40 tracks.'],
  [{ format: 'lp7-33' }, 'Choose a side format from the list.'],
  [{ format: '' }, 'Choose a side format from the list.'],
  [{ format: '12-inch' }, 'Choose a side format from the list.'],
];
for (const [patch, message] of refusals) {
  const input = Object.assign({}, base, patch);
  assert.equal(attempt(() => C.calculate(input)), message, JSON.stringify(patch));
}
// Inclusive limits still convert: 40 tracks, 1 second, and exactly 60:00.
assert.equal(C.calculate({ format: 'c90', tracklist: Array.from({ length: 40 }, () => '1:00').join('\n') }).trackCount, 40);
assert.equal(C.calculate({ tracklist: 'A 0:01\nB 0:01' }).sideASeconds, 1);
assert.equal(C.calculate({ tracklist: 'A 60:00\nB 0:01' }).totalSeconds, 3601);

// Page contract: every id the script looks up exists, the markup starts at the
// core defaults, and the page stays self-contained.
assert.equal(C.DEFAULTS.format, 'lp12-33');
assert.equal(C.DEFAULTS.tracklist.split('\n').length, 10);
assert.equal(C.MAX_TRACKS, 40);
assert.equal(C.MAX_SECONDS, 3600);
assert.deepEqual(Object.keys(C.FORMATS).sort(), Object.keys(CAPACITY).sort());
assert.deepEqual(Array.from(C.BY_CAPACITY), ORDER);
for (const id of Object.keys(C.FORMATS)) {
  assert.ok(html.includes('<option value="' + id + '"'), 'missing option ' + id);
}
assert.ok(/<option value="lp12-33" selected>/.test(html), 'format default');
const scriptText = html.slice(html.indexOf('/* side-split-core:end */'));
for (const match of scriptText.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'missing element #' + match[1]);
}
for (const id of ['in-tracks', 'in-format']) {
  assert.ok(new RegExp('<label[^>]*for="' + id + '"').test(html), 'missing label for ' + id);
}
assert.ok(html.includes('id="in-tracks" rows="10"'), 'tracklist default rows');
assert.ok(html.includes('Opening Statement 3:52'), 'default tracklist in markup');
assert.ok(html.includes('novalidate'), 'form must not block the page validation');
assert.ok(html.includes('role="alert"') && html.includes('aria-live="polite"'), 'error region');
assert.ok(html.includes('aria-live="polite" aria-atomic="true"'), 'result region');
assert.ok(!/https?:\/\//.test(html.slice(0, html.indexOf('<script src="/assets/app.js">'))), 'no external references');
assert.ok(!/<button(?![^>]*type=)/.test(html), 'every button needs an explicit type');
console.log('album side split: ' + entry.testCases.length + ' catalog cases, ' + swept + ' swept combinations, '
  + anchors.length + ' hand anchors, ' + refusals.length + ' refusals passed');
