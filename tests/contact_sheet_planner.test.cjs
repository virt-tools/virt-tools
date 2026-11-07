/* Regression checks for the contact sheet planner core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(
  path.join(root, 'frontend/tools/contact-sheet-planner/index.html'),
  'utf8'
);
const start = html.indexOf('/* contact-sheet-core:start */');
const end = html.indexOf('/* contact-sheet-core:end */');
assert.ok(start > -1 && end > start, 'contact sheet core markers missing');
const core = html.slice(start, end + '/* contact-sheet-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ContactSheetCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
};
const base = {
  sourceWidth: 1920,
  sourceHeight: 1080,
  duration: 300,
  fps: 24,
  thumbnails: 12,
  thumbWidth: 320,
  columns: 4,
  gap: 6,
  margin: 12,
  captionBand: 20
};
const build = (overrides = {}) => C.calculate({ ...base, ...overrides });
const rejects = (overrides, message) => {
  assert.throws(
    () => C.calculate({ ...base, ...overrides }),
    (error) => error.message === message,
    `expected rejection: ${message}`
  );
};

// Independent reference: grow the rows one tile at a time instead of dividing,
// and walk the clip in equal slices for the sample times.
function reference(spec) {
  const thumbHeight = Math.max(
    1,
    Math.round((spec.thumbWidth * spec.sourceHeight) / spec.sourceWidth)
  );
  const cellHeight = thumbHeight + spec.captionBand;
  let rows = 0;
  let placed = 0;
  while (placed < spec.thumbnails) {
    placed += spec.columns;
    rows += 1;
  }
  const sheetWidth =
    2 * spec.margin + spec.columns * spec.thumbWidth + (spec.columns - 1) * spec.gap;
  const sheetHeight = 2 * spec.margin + rows * cellHeight + (rows - 1) * spec.gap;
  const interval = spec.duration / spec.thumbnails;
  const totalFrames = Math.max(1, Math.round(spec.duration * spec.fps));
  const samples = [];
  for (let i = 0; i < spec.thumbnails; i += 1) {
    const at = (i + 0.5) * interval;
    let frame = Math.round(at * spec.fps);
    if (frame > totalFrames - 1) frame = totalFrames - 1;
    samples.push({ at, frame });
  }
  return {
    thumbHeight,
    cellHeight,
    rows,
    emptyCells: rows * spec.columns - spec.thumbnails,
    sheetWidth,
    sheetHeight,
    interval,
    framesPerInterval: Math.round(interval * spec.fps * 100) / 100,
    totalFrames,
    samples
  };
}

// The default 300 s 24 fps clip with twelve 320 px thumbnails, four columns,
// 6 px gaps, a 12 px margin and a 20 px caption band.
const a = build();
const ref = reference(base);
assert.equal(a.thumbHeight, 180);
assert.equal(a.cellHeight, 200);
assert.equal(a.rows, 3);
assert.equal(a.emptyCells, 0);
assert.equal(a.sheetWidth, 1322);
assert.equal(a.sheetHeight, 636);
assert.equal(a.sheetMegapixels, 0.841);
assert.equal(a.interval, 25);
assert.equal(a.framesPerInterval, 600);
assert.equal(a.totalFrames, 7200);
assert.equal(a.firstSample, 12.5);
assert.equal(a.lastSample, 287.5);
assert.equal(a.firstFrame, 300);
assert.equal(a.lastFrame, 6900);
assert.equal(a.samples.length, 12);
assert.deepEqual(
  Array.from(a.samples, (sample) => sample.frame),
  [300, 900, 1500, 2100, 2700, 3300, 3900, 4500, 5100, 5700, 6300, 6900]
);
assert.equal(a.samples[0].index, 1);
assert.equal(a.samples[11].index, 12);

// Every derived number agrees with the independent reference model.
for (const key of [
  'thumbHeight',
  'cellHeight',
  'rows',
  'emptyCells',
  'sheetWidth',
  'sheetHeight',
  'interval',
  'framesPerInterval',
  'totalFrames'
]) {
  near(a[key], ref[key], `default ${key}`);
}

// The sheet is exactly margin + tiles + gaps on both axes.
assert.equal(a.sheetWidth, 2 * 12 + 4 * 320 + 3 * 6);
assert.equal(a.sheetHeight, 2 * 12 + 3 * (180 + 20) + 2 * 6);
assert.equal(a.sheetWidth * a.sheetHeight, 840792);

// A 4K clip with eight thumbnails in three columns leaves one empty cell.
const fourK = build({
  sourceWidth: 3840,
  sourceHeight: 2160,
  duration: 120,
  fps: 30,
  thumbnails: 8,
  thumbWidth: 480,
  columns: 3,
  gap: 10,
  margin: 20,
  captionBand: 0
});
assert.equal(fourK.thumbHeight, 270);
assert.equal(fourK.cellHeight, 270);
assert.equal(fourK.rows, 3);
assert.equal(fourK.emptyCells, 1);
assert.equal(fourK.sheetWidth, 1500);
assert.equal(fourK.sheetHeight, 870);
assert.equal(fourK.interval, 15);
assert.equal(fourK.framesPerInterval, 450);
assert.equal(fourK.totalFrames, 3600);
assert.equal(fourK.firstFrame, 225);
assert.equal(fourK.lastFrame, 3375);

// A portrait clip derives a taller thumbnail and copes with 23.976 fps.
const portrait = build({
  sourceWidth: 1080,
  sourceHeight: 1920,
  duration: 60,
  fps: 23.976,
  thumbnails: 5,
  thumbWidth: 200,
  columns: 2,
  gap: 0,
  margin: 0,
  captionBand: 0
});
assert.equal(portrait.thumbHeight, 356);
assert.equal(portrait.cellHeight, 356);
assert.equal(portrait.rows, 3);
assert.equal(portrait.emptyCells, 1);
assert.equal(portrait.sheetWidth, 400);
assert.equal(portrait.sheetHeight, 1068);
assert.equal(portrait.interval, 12);
near(portrait.framesPerInterval, 287.71, 'portrait frames per interval');
assert.equal(portrait.totalFrames, 1439);
assert.deepEqual(
  Array.from(portrait.samples, (sample) => sample.frame),
  [144, 432, 719, 1007, 1295]
);

// One thumbnail in one column is a single tile the size of the sheet.
const single = build({
  sourceWidth: 640,
  sourceHeight: 480,
  duration: 10,
  fps: 25,
  thumbnails: 1,
  thumbWidth: 640,
  columns: 1,
  gap: 0,
  margin: 0,
  captionBand: 0
});
assert.equal(single.thumbHeight, 480);
assert.equal(single.rows, 1);
assert.equal(single.emptyCells, 0);
assert.equal(single.sheetWidth, 640);
assert.equal(single.sheetHeight, 480);
assert.equal(single.interval, 10);
assert.equal(single.firstSample, 5);
assert.equal(single.firstFrame, 125);
assert.equal(single.totalFrames, 250);
assert.equal(single.lastFrame, 125);

// A caption band grows every tile, including the partly filled last row.
const banded = build({
  sourceWidth: 1920,
  sourceHeight: 1080,
  duration: 100,
  fps: 25,
  thumbnails: 5,
  thumbWidth: 400,
  columns: 2,
  gap: 8,
  margin: 10,
  captionBand: 30
});
assert.equal(banded.thumbHeight, 225);
assert.equal(banded.cellHeight, 255);
assert.equal(banded.rows, 3);
assert.equal(banded.emptyCells, 1);
assert.equal(banded.sheetWidth, 828);
assert.equal(banded.sheetHeight, 801);
assert.equal(banded.sheetHeight, 2 * 10 + 3 * 255 + 2 * 8);
assert.equal(banded.interval, 20);
assert.equal(banded.firstFrame, 250);
assert.equal(banded.lastFrame, 2250);

// A sample that rounds onto the clip's frame count is clamped to the last frame.
const clamped = build({
  sourceWidth: 1280,
  sourceHeight: 720,
  duration: 10,
  fps: 25,
  thumbnails: 400,
  thumbWidth: 128,
  columns: 20,
  gap: 2,
  margin: 4,
  captionBand: 0
});
assert.equal(clamped.thumbHeight, 72);
assert.equal(clamped.rows, 20);
assert.equal(clamped.emptyCells, 0);
assert.equal(clamped.totalFrames, 250);
assert.equal(clamped.lastFrame, 249);
assert.equal(clamped.samples[399].frame, 249);

// Sample times sit at slice centres and stay inside the clip.
for (const sample of a.samples) {
  assert.ok(sample.at > 0 && sample.at < base.duration, 'sample stays inside the clip');
  assert.ok(sample.frame >= 0 && sample.frame <= a.totalFrames - 1, 'frame stays inside the clip');
}
near(a.samples[3].at, 87.5, 'fourth sample centre');

// Form strings normalise to the same numbers, including surrounding spaces.
const fromForm = C.calculate({
  sourceWidth: ' 1920 ',
  sourceHeight: '1080',
  duration: '300.0',
  fps: '24',
  thumbnails: '12',
  thumbWidth: '320',
  columns: '4',
  gap: '6',
  margin: '12',
  captionBand: '20'
});
assert.equal(fromForm.sheetWidth, a.sheetWidth);
assert.equal(fromForm.sheetHeight, a.sheetHeight);
assert.equal(fromForm.lastFrame, a.lastFrame);

// Boundary values are accepted.
const bounds = build({
  sourceWidth: 16,
  sourceHeight: 16,
  duration: 86400,
  fps: 240,
  thumbnails: 400,
  thumbWidth: 4096,
  columns: 20,
  gap: 200,
  margin: 200,
  captionBand: 200
});
assert.equal(bounds.thumbHeight, 4096);
assert.equal(bounds.rows, 20);
assert.equal(bounds.sheetWidth, 2 * 200 + 20 * 4096 + 19 * 200);
assert.equal(bounds.totalFrames, 86400 * 240);

// Rejections: blanks, ranges, signs, exponents and fractional counts.
rejects({ sourceWidth: '' }, 'Source width is required.');
rejects({ sourceWidth: undefined }, 'Source width is required.');
rejects({ sourceWidth: '15' }, 'Source width must be a whole number from 16 to 16384.');
rejects({ sourceWidth: '16385' }, 'Source width must be a whole number from 16 to 16384.');
rejects({ sourceWidth: '1920.0' }, 'Source width must be a whole number from 16 to 16384.');
rejects({ sourceWidth: '-1920' }, 'Source width must be a whole number from 16 to 16384.');
rejects({ sourceHeight: '1e3' }, 'Source height must be a whole number from 16 to 16384.');
rejects({ duration: '0' }, 'Clip duration must be a number from 0.001 to 86400.');
rejects({ duration: '86401' }, 'Clip duration must be a number from 0.001 to 86400.');
rejects({ duration: '300.' }, 'Clip duration must be a number from 0.001 to 86400.');
rejects({ duration: '-5' }, 'Clip duration must be a number from 0.001 to 86400.');
rejects({ duration: '5m' }, 'Clip duration must be a number from 0.001 to 86400.');
rejects({ fps: '0' }, 'Frame rate must be a number from 1 to 240.');
rejects({ fps: '241' }, 'Frame rate must be a number from 1 to 240.');
rejects({ fps: '29.97fps' }, 'Frame rate must be a number from 1 to 240.');
rejects({ thumbnails: '0' }, 'Thumbnails must be a whole number from 1 to 400.');
rejects({ thumbnails: '401' }, 'Thumbnails must be a whole number from 1 to 400.');
rejects({ thumbnails: '6.5' }, 'Thumbnails must be a whole number from 1 to 400.');
rejects({ thumbWidth: '31' }, 'Thumbnail width must be a whole number from 32 to 4096.');
rejects({ thumbWidth: '4097' }, 'Thumbnail width must be a whole number from 32 to 4096.');
rejects({ columns: '0' }, 'Columns must be a whole number from 1 to 20.');
rejects({ columns: '21' }, 'Columns must be a whole number from 1 to 20.');
rejects({ gap: '2.5' }, 'Gap must be a whole number from 0 to 200.');
rejects({ gap: '201' }, 'Gap must be a whole number from 0 to 200.');
rejects({ margin: '-1' }, 'Margin must be a whole number from 0 to 200.');
rejects({ margin: '201' }, 'Margin must be a whole number from 0 to 200.');
rejects({ captionBand: '-5' }, 'Caption band must be a whole number from 0 to 200.');
rejects({ captionBand: '201' }, 'Caption band must be a whole number from 0 to 200.');
rejects({ duration: '0.01', fps: '24' }, 'The clip is shorter than a single frame at this frame rate.');
rejects({ duration: '0.001', fps: '1' }, 'The clip is shorter than a single frame at this frame rate.');

// A deterministic sweep against the independent reference model.
let seed = 20261107;
const rnd = (n) => {
  seed = (seed * 48271) % 2147483647;
  return seed % n;
};
const framerates = [1, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120];
for (let i = 0; i < 400; i += 1) {
  const spec = {
    sourceWidth: 16 + rnd(4000),
    sourceHeight: 16 + rnd(4000),
    duration: 0.5 + rnd(20000) / 100,
    fps: framerates[rnd(framerates.length)],
    thumbnails: 1 + rnd(400),
    thumbWidth: 32 + rnd(1000),
    columns: 1 + rnd(20),
    gap: rnd(50),
    margin: rnd(50),
    captionBand: rnd(60)
  };
  const got = C.calculate(spec);
  const want = reference(spec);
  near(got.thumbHeight, want.thumbHeight, `sweep ${i} thumb height`);
  near(got.cellHeight, want.cellHeight, `sweep ${i} cell height`);
  near(got.rows, want.rows, `sweep ${i} rows`);
  near(got.emptyCells, want.emptyCells, `sweep ${i} empty cells`);
  near(got.sheetWidth, want.sheetWidth, `sweep ${i} sheet width`);
  near(got.sheetHeight, want.sheetHeight, `sweep ${i} sheet height`);
  near(got.interval, want.interval, `sweep ${i} interval`);
  near(got.framesPerInterval, want.framesPerInterval, `sweep ${i} frames per interval`);
  near(got.totalFrames, want.totalFrames, `sweep ${i} total frames`);
  assert.equal(got.samples.length, spec.thumbnails, `sweep ${i} sample count`);
  for (let n = 0; n < spec.thumbnails; n += 1) {
    near(got.samples[n].at, want.samples[n].at, `sweep ${i} sample ${n} time`);
    assert.equal(got.samples[n].frame, want.samples[n].frame, `sweep ${i} sample ${n} frame`);
    assert.ok(got.samples[n].frame >= 0, `sweep ${i} sample ${n} frame floor`);
    assert.ok(
      got.samples[n].frame <= got.totalFrames - 1,
      `sweep ${i} sample ${n} frame ceiling`
    );
  }
  assert.ok(got.emptyCells >= 0 && got.emptyCells < spec.columns, `sweep ${i} empty cell range`);
  assert.ok(got.sheetWidth > 0 && got.sheetHeight > 0, `sweep ${i} positive sheet`);
}

// The catalog record must describe this page and its cases must hold.
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8')
);
const records = catalog.tools.filter((tool) => tool.slug === 'contact-sheet-planner');
assert.equal(records.length, 1, 'catalog must contain exactly one contact sheet record');
const record = records[0];
assert.equal(record.name, 'Contact Sheet Planner');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(
  record.aliases.includes('Contact Sheet Calculator'),
  'catalog aliases must include Contact Sheet Calculator'
);
assert.ok(record.testCases.length >= 10, 'catalog must carry at least ten checks');

for (const test of record.testCases) {
  if (test.kind === 'validation') {
    assert.throws(
      () => C.calculate(test.input),
      (error) => error.message === test.expected.error,
      `catalog validation case: ${test.name}`
    );
    continue;
  }
  assert.equal(test.kind, 'golden', `catalog case kind: ${test.name}`);
  const got = C.calculate(test.input);
  for (const [key, expected] of Object.entries(test.expected)) {
    if (typeof expected === 'number') {
      near(got[key], expected, `catalog case ${test.name} ${key}`);
    } else {
      assert.equal(got[key], expected, `catalog case ${test.name} ${key}`);
    }
  }
}

assert.equal(C.FIELDS.length, 10, 'ten input fields are exposed');

console.log('contact sheet planner: all assertions passed');
