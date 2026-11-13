/* Regression checks for the Ken Burns pan and zoom planner core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(
  path.join(root, 'frontend/tools/ken-burns-move-planner/index.html'),
  'utf8'
);
const start = html.indexOf('/* ken-burns-core:start */');
const end = html.indexOf('/* ken-burns-core:end */');
assert.ok(start > -1 && end > start, 'ken burns core markers missing');
const core = html.slice(start, end + '/* ken-burns-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = KenBurnsCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
};
const base = {
  sourceWidth: 4000,
  sourceHeight: 3000,
  outputWidth: 1920,
  outputHeight: 1080,
  duration: 6,
  fps: 25,
  zoomStart: 100,
  zoomEnd: 130,
  startX: 50,
  startY: 50,
  endX: 50,
  endY: 50
};
const build = (overrides = {}) => C.calculate({ ...base, ...overrides });
const rejects = (overrides, message) => {
  assert.throws(
    () => C.calculate({ ...base, ...overrides }),
    (error) => error.message === message,
    `expected rejection: ${message}`
  );
};

// Independent reference: ratios of the source rather than output-over-scale,
// with its own rounding helper and its own frame walk.
function reference(spec) {
  const cover = Math.max(spec.outputWidth / spec.sourceWidth, spec.outputHeight / spec.sourceHeight);
  const frames = Math.max(1, Math.round(spec.duration * spec.fps));
  const real = frames / spec.fps;
  const visibleAt = (zoom) => 100 / zoom; // share of the fitted frame
  const cropOf = (zoom) => ({
    width: spec.sourceWidth * (spec.outputWidth / (spec.sourceWidth * cover)) * visibleAt(zoom),
    height: spec.sourceHeight * (spec.outputHeight / (spec.sourceHeight * cover)) * visibleAt(zoom)
  });
  const centreOf = (zoom, px, py) => {
    const crop = cropOf(zoom);
    const roomX = spec.sourceWidth - crop.width;
    const roomY = spec.sourceHeight - crop.height;
    return {
      crop,
      x: crop.width / 2 + (px / 100) * roomX,
      y: crop.height / 2 + (py / 100) * roomY,
      scale: cover * zoom / 100
    };
  };
  const at = (u) => centreOf(
    spec.zoomStart + (spec.zoomEnd - spec.zoomStart) * u,
    spec.startX + (spec.endX - spec.startX) * u,
    spec.startY + (spec.endY - spec.startY) * u
  );
  const first = at(0);
  const last = at(frames > 1 ? 1 : 0);
  let travel = 0;
  let peak = 0;
  for (let i = 0; i < frames - 1; i += 1) {
    const a = at(i / (frames - 1));
    const b = at((i + 1) / (frames - 1));
    const step = Math.hypot(b.x - a.x, b.y - a.y) * a.scale;
    travel += step;
    peak = Math.max(peak, step);
  }
  const tight = spec.zoomStart >= spec.zoomEnd ? first : last;
  return {
    frames,
    real,
    startCropWidth: first.crop.width,
    startCropHeight: first.crop.height,
    endCropWidth: last.crop.width,
    endCropHeight: last.crop.height,
    tightCropWidth: tight.crop.width,
    startCentreX: first.x,
    startCentreY: first.y,
    endCentreX: last.x,
    endCentreY: last.y,
    startScale: first.scale,
    endScale: last.scale,
    oversample: tight.crop.width / spec.outputWidth,
    zoomPerSecond: (spec.zoomEnd - spec.zoomStart) / real,
    panPixels: travel,
    panSpeed: travel / real,
    panPeak: peak * spec.fps
  };
}

// The default 4:3 still pushed from 100% to 130% over 6 s at 25 fps.
const a = build();
const ref = reference(base);
assert.equal(a.frames, 150);
assert.equal(a.exactDuration, 6);
near(a.fitScale, 0.48, 'fit scale');
assert.equal(a.startCropWidth, 4000);
assert.equal(a.startCropHeight, 2250);
assert.equal(a.endCropWidth, 3076.92);
assert.equal(a.endCropHeight, 1730.77);
assert.equal(a.tightCropWidth, 3076.92);
assert.equal(a.startUsedX, 100);
assert.equal(a.startUsedY, 75);
assert.equal(a.endUsedX, 76.92);
assert.equal(a.endUsedY, 57.69);
assert.equal(a.oversample, 1.603);
assert.equal(a.upscale, 0.624);
assert.equal(a.zoomPerSecond, 5);
assert.equal(a.zoomPerFrame, 0.2013);
assert.equal(a.panPixels, 0);
assert.equal(a.startCentreX, 2000);
assert.equal(a.startCentreY, 1500);
assert.equal(a.keys.length, 5);
assert.deepEqual(Array.from(a.keys, (key) => key.frame), [0, 37, 75, 112, 149]);
assert.equal(a.keys[0].zoom, 100);
assert.equal(a.keys[2].zoom, 115.1);
assert.equal(a.keys[4].zoom, 130);
assert.equal(a.keys[4].cropWidth, 3076.92);

for (const key of [
  'startCropWidth',
  'startCropHeight',
  'endCropWidth',
  'endCropHeight',
  'tightCropWidth',
  'startCentreX',
  'startCentreY',
  'endCentreX',
  'endCentreY',
  'startScale',
  'endScale',
  'oversample',
  'zoomPerSecond',
  'panPixels',
  'panSpeed',
  'panPeak'
]) {
  near(a[key], ref[key], `default ${key}`, 2e-2);
}

// Crop x scale reproduces the output frame at both ends.
near(a.startCropWidth * a.startScale, 1920, 'start crop width x scale', 1e-6);
near(a.startCropHeight * a.startScale, 1080, 'start crop height x scale', 1e-6);
near(a.endCropWidth * a.endScale, 1920, 'end crop width x scale', 1e-2);
near(a.endCropHeight * a.endScale, 1080, 'end crop height x scale', 1e-2);
near(a.oversample * a.upscale, 1, 'oversample x upscale', 1e-3);

// A 16:9 pan at fixed zoom moves the crop by the leftover room.
const pan = build({
  sourceWidth: 3840,
  sourceHeight: 2160,
  duration: 5,
  fps: 24,
  zoomStart: 110,
  zoomEnd: 110,
  startX: 0,
  endX: 100
});
assert.equal(pan.frames, 120);
assert.equal(pan.startCropWidth, 3490.91);
assert.equal(pan.startCropHeight, 1963.64);
assert.equal(pan.startUsedX, 90.91);
assert.equal(pan.startUsedY, 90.91);
assert.equal(pan.oversample, 1.818);
assert.equal(pan.panPixels, 192);
assert.equal(pan.panSpeed, 38.4);
assert.equal(pan.panPeak, 38.72);
assert.equal(pan.panStep, 1.613);
assert.equal(pan.startCentreX, 1745.45);
assert.equal(pan.endCentreX, 2094.55);
assert.equal(pan.startCentreY, 1080);
near(pan.startCentreX + pan.startCropWidth / 2, 3490.91, 'pan starts flush left', 1e-2);
near(pan.endCentreX + pan.endCropWidth / 2, 3840, 'pan ends flush right', 1e-2);
near(pan.panPixels, (3840 - pan.startCropWidth) * pan.startScale, 'pan travel matches the room', 0.05);

// Pulling back from 140% to 100% widens the crop and reverses the zoom rate.
const pull = build({
  sourceWidth: 6000,
  sourceHeight: 4000,
  duration: 8,
  fps: 30,
  zoomStart: 140,
  zoomEnd: 100
});
assert.equal(pull.frames, 240);
assert.equal(pull.tightCropWidth, 4285.71);
assert.equal(pull.endCropWidth, 6000);
assert.equal(pull.endCropHeight, 3375);
assert.equal(pull.startUsedX, 71.43);
assert.equal(pull.startUsedY, 60.27);
assert.equal(pull.endUsedX, 100);
assert.equal(pull.endUsedY, 84.38);
assert.equal(pull.oversample, 2.232);
assert.equal(pull.zoomPerSecond, -5);
assert.equal(pull.zoomPerFrame, -0.1674);
assert.equal(pull.panPixels, 0);

// A 720p source is enlarged well past its pixels at 220% zoom.
const soft = build({
  sourceWidth: 1280,
  sourceHeight: 720,
  duration: 4,
  fps: 25,
  zoomStart: 180,
  zoomEnd: 220,
  startX: 0,
  startY: 0,
  endX: 100,
  endY: 100
});
assert.equal(soft.tightCropWidth, 581.82);
assert.equal(soft.tightCropHeight, 327.27);
assert.equal(soft.oversample, 0.303);
assert.equal(soft.upscale, 3.3);
assert.equal(soft.startUsedX, 55.56);
assert.equal(soft.panPixels, 2193.3);
assert.equal(soft.panStep, 22.155);
assert.equal(soft.startCentreX, 355.56);
assert.equal(soft.endCentreX, 989.09);
assert.equal(soft.startCentreY, 200);
assert.equal(soft.endCentreY, 556.36);

// A vertical 23.976 clip keeps the frame vertical and pans down.
const vertical = build({
  sourceWidth: 3000,
  sourceHeight: 4000,
  outputWidth: 1080,
  outputHeight: 1920,
  duration: 4.5,
  fps: 23.976,
  zoomStart: 120,
  zoomEnd: 110,
  startX: 50,
  startY: 0,
  endX: 50,
  endY: 100
});
assert.equal(vertical.frames, 108);
assert.equal(vertical.exactDuration, 4.505);
assert.equal(vertical.startCropWidth, 1875);
assert.equal(vertical.startCropHeight, 3333.33);
assert.equal(vertical.endCropWidth, 2045.45);
assert.equal(vertical.endCropHeight, 3636.36);
assert.equal(vertical.startUsedX, 62.5);
assert.equal(vertical.startUsedY, 83.33);
assert.equal(vertical.endUsedX, 68.18);
assert.equal(vertical.endUsedY, 90.91);
assert.equal(vertical.panPixels, 286.9);
assert.equal(vertical.panSpeed, 63.69);
assert.equal(vertical.panPeak, 103.65);
assert.equal(vertical.panStep, 2.681);
assert.equal(vertical.zoomPerSecond, -2.22);
assert.equal(vertical.zoomPerFrame, -0.0935);

// Identical ends are a held frame, and a single frame has no motion.
const still = build({ duration: 4, fps: 30, zoomStart: 100, zoomEnd: 100 });
assert.equal(still.frames, 120);
assert.equal(still.panPixels, 0);
assert.equal(still.panSpeed, 0);
assert.equal(still.zoomPerSecond, 0);
assert.equal(still.oversample, 2.083);
const single = build({
  sourceWidth: 16,
  sourceHeight: 16,
  outputWidth: 16,
  outputHeight: 16,
  duration: 0.5,
  fps: 1,
  zoomStart: 400,
  zoomEnd: 400,
  startX: 0,
  startY: 0,
  endX: 100,
  endY: 100
});
assert.equal(single.frames, 1);
assert.equal(single.keys.length, 1);
assert.equal(single.tightCropWidth, 4);
assert.equal(single.upscale, 4);
assert.equal(single.panPixels, 0);
assert.equal(single.startCentreX, 2);
assert.equal(single.endCentreX, 2);

// No zoom means no room to pan at all.
const noRoom = build({
  sourceWidth: 1920,
  sourceHeight: 1080,
  duration: 3,
  zoomStart: 100,
  zoomEnd: 100,
  startX: 0,
  startY: 0,
  endX: 100,
  endY: 100
});
assert.equal(noRoom.startCropWidth, 1920);
assert.equal(noRoom.oversample, 1);
assert.equal(noRoom.panPixels, 0);
assert.equal(noRoom.startCentreX, 960);
assert.equal(noRoom.startCentreY, 540);

// Form strings normalise, including surrounding spaces and whole-number zooms.
const fromForm = C.calculate({
  sourceWidth: ' 4000 ',
  sourceHeight: '3000',
  outputWidth: '1920',
  outputHeight: '1080',
  duration: '6.0',
  fps: '25',
  zoomStart: '100',
  zoomEnd: '130.0',
  startX: '50',
  startY: '50',
  endX: '50',
  endY: '50'
});
assert.equal(fromForm.endCropWidth, a.endCropWidth);
assert.equal(fromForm.panPixels, a.panPixels);
assert.equal(fromForm.keys.length, a.keys.length);

// Rejections: blanks, ranges, signs, exponents and fractional sizes.
rejects({ sourceWidth: '' }, 'Source width is required.');
rejects({ sourceWidth: undefined }, 'Source width is required.');
rejects({ sourceWidth: ' ' }, 'Source width is required.');
rejects({ sourceWidth: '15' }, 'Source width must be a whole number from 16 to 16384.');
rejects({ sourceWidth: '16385' }, 'Source width must be a whole number from 16 to 16384.');
rejects({ sourceWidth: '1920.0' }, 'Source width must be a whole number from 16 to 16384.');
rejects({ sourceWidth: '-1920' }, 'Source width must be a whole number from 16 to 16384.');
rejects({ sourceHeight: '1e3' }, 'Source height must be a whole number from 16 to 16384.');
rejects({ outputWidth: '8193' }, 'Frame width must be a whole number from 16 to 8192.');
rejects({ outputWidth: '0' }, 'Frame width must be a whole number from 16 to 8192.');
rejects({ outputHeight: '15' }, 'Frame height must be a whole number from 16 to 8192.');
rejects({ duration: '0' }, 'Clip duration must be a number from 0.1 to 3600.');
rejects({ duration: '3601' }, 'Clip duration must be a number from 0.1 to 3600.');
rejects({ duration: '6.' }, 'Clip duration must be a number from 0.1 to 3600.');
rejects({ duration: '-5' }, 'Clip duration must be a number from 0.1 to 3600.');
rejects({ duration: '5m' }, 'Clip duration must be a number from 0.1 to 3600.');
rejects({ fps: '0' }, 'Frame rate must be a number from 1 to 240.');
rejects({ fps: '241' }, 'Frame rate must be a number from 1 to 240.');
rejects({ fps: '29.97fps' }, 'Frame rate must be a number from 1 to 240.');
rejects({ zoomStart: '99' }, 'Zoom at start must be a number from 100 to 400.');
rejects({ zoomEnd: '401' }, 'Zoom at end must be a number from 100 to 400.');
rejects({ startX: '-1' }, 'Start X must be a number from 0 to 100.');
rejects({ startY: '101' }, 'Start Y must be a number from 0 to 100.');
rejects({ endX: '100.5' }, 'End X must be a number from 0 to 100.');
rejects({ endY: '5%' }, 'End Y must be a number from 0 to 100.');
rejects({ duration: '0.1', fps: '1' }, 'The clip is shorter than a single frame at this frame rate.');

// Boundary values are accepted at both ends of every range.
const bounds = C.calculate({
  sourceWidth: 16,
  sourceHeight: 16384,
  outputWidth: 16,
  outputHeight: 8192,
  duration: 3600,
  fps: 240,
  zoomStart: 400,
  zoomEnd: 100,
  startX: 0,
  startY: 0,
  endX: 100,
  endY: 100
});
assert.equal(bounds.frames, 864000);
assert.equal(bounds.exactDuration, 3600);
assert.ok(bounds.tightCropWidth > 0);
assert.ok(bounds.tightCropHeight > 0);
assert.ok(bounds.startCentreX >= bounds.startCropWidth / 2 - 1e-6);
assert.ok(bounds.endCentreX <= 16 - bounds.endCropWidth / 2 + 1e-6);

// A deterministic sweep against the independent reference model.
let seed = 20261112;
const rnd = (n) => {
  seed = (seed * 48271) % 2147483647;
  return seed % n;
};
const framerates = [1, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120, 240];
for (let i = 0; i < 300; i += 1) {
  const spec = {
    sourceWidth: 16 + rnd(6000),
    sourceHeight: 16 + rnd(6000),
    outputWidth: 16 + rnd(2000),
    outputHeight: 16 + rnd(2000),
    duration: 0.5 + rnd(6000) / 100,
    fps: framerates[rnd(framerates.length)],
    zoomStart: 100 + rnd(301),
    zoomEnd: 100 + rnd(301),
    startX: rnd(101),
    startY: rnd(101),
    endX: rnd(101),
    endY: rnd(101)
  };
  if (spec.duration * spec.fps < 0.5) continue;
  const got = C.calculate(spec);
  const want = reference(spec);
  assert.equal(got.frames, want.frames, `sweep ${i} frames`);
  near(got.startCropWidth, want.startCropWidth, `sweep ${i} start crop width`, 1e-2);
  near(got.startCropHeight, want.startCropHeight, `sweep ${i} start crop height`, 1e-2);
  near(got.endCropWidth, want.endCropWidth, `sweep ${i} end crop width`, 1e-2);
  near(got.endCropHeight, want.endCropHeight, `sweep ${i} end crop height`, 1e-2);
  near(got.tightCropWidth, want.tightCropWidth, `sweep ${i} tight crop`, 1e-2);
  near(got.startCentreX, want.startCentreX, `sweep ${i} start centre x`, 1e-2);
  near(got.startCentreY, want.startCentreY, `sweep ${i} start centre y`, 1e-2);
  near(got.endCentreX, want.endCentreX, `sweep ${i} end centre x`, 1e-2);
  near(got.endCentreY, want.endCentreY, `sweep ${i} end centre y`, 1e-2);
  near(got.oversample, want.oversample, `sweep ${i} oversample`, 1e-3);
  near(got.zoomPerSecond, want.zoomPerSecond, `sweep ${i} zoom rate`, 1e-3);
  near(got.panPixels, want.panPixels, `sweep ${i} pan travel`, 0.2);
  near(got.panSpeed, want.panSpeed, `sweep ${i} pan speed`, 0.2);
  near(got.panPeak, want.panPeak, `sweep ${i} pan peak`, 0.2);
  // Every crop stays inside the source and every centre inside its room.
  for (const state of [got.startCropWidth, got.endCropWidth]) {
    assert.ok(state <= spec.sourceWidth + 1e-6, `sweep ${i} crop fits width`);
  }
  for (const state of [got.startCropHeight, got.endCropHeight]) {
    assert.ok(state <= spec.sourceHeight + 1e-6, `sweep ${i} crop fits height`);
  }
  assert.ok(got.startCentreX >= got.startCropWidth / 2 - 1e-6, `sweep ${i} centre left`);
  assert.ok(got.startCentreX <= spec.sourceWidth - got.startCropWidth / 2 + 1e-6, `sweep ${i} centre right`);
  assert.ok(got.startCentreY >= got.startCropHeight / 2 - 1e-6, `sweep ${i} centre top`);
  assert.ok(got.startCentreY <= spec.sourceHeight - got.startCropHeight / 2 + 1e-6, `sweep ${i} centre bottom`);
  // Keyframes start and end on the first and last frame and rise monotonically.
  assert.equal(got.keys[0].frame, 0, `sweep ${i} first key frame`);
  assert.equal(got.keys[got.keys.length - 1].frame, got.frames - 1, `sweep ${i} last key frame`);
  for (let k = 1; k < got.keys.length; k += 1) {
    assert.ok(got.keys[k].frame > got.keys[k - 1].frame, `sweep ${i} key order`);
  }
  near(got.keys[0].zoom, spec.zoomStart, `sweep ${i} start zoom`, 0.01);
  near(got.keys[got.keys.length - 1].zoom, spec.zoomEnd, `sweep ${i} end zoom`, 0.01);
}

// Doubling the zoom halves the crop and leaves the centre alone.
const wide = build({ zoomStart: 100, zoomEnd: 100 });
const tight = build({ zoomStart: 200, zoomEnd: 200 });
near(wide.startCropWidth / tight.startCropWidth, 2, 'double zoom halves the crop', 1e-6);
near(wide.startCentreX, tight.startCentreX, 'centred crop keeps its centre', 1e-6);

// The catalog record must describe this page and its cases must hold.
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8')
);
assert.equal(catalog.tools.length, 2246, 'catalog total');
const records = catalog.tools.filter((tool) => tool.slug === 'ken-burns-move-planner');
assert.equal(records.length, 1, 'catalog must contain exactly one Ken Burns record');
const record = records[0];
assert.equal(record.name, 'Ken Burns Pan & Zoom Planner');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('Ken Burns Calculator'), 'catalog aliases cover the calculator name');
assert.ok(record.testCases.length >= 10, 'catalog must carry at least ten checks');
assert.equal(typeof record.method, 'string', 'catalog method is a single string');

for (const test of record.testCases) {
  if (test.kind === 'validation') {
    assert.throws(
      () => C.calculate(test.input),
      (error) => error.message === test.expected.error,
      `catalog validation case: ${test.name}`
    );
    continue;
  }
  const got = C.calculate(test.input);
  for (const [key, expected] of Object.entries(test.expected)) {
    if (typeof expected === 'number') {
      near(got[key], expected, `catalog case ${test.name} ${key}`, 1e-6);
    } else {
      assert.equal(got[key], expected, `catalog case ${test.name} ${key}`);
    }
  }
}

assert.equal(C.FIELDS.length, 12, 'twelve input fields are exposed');

console.log('ken burns move planner: all assertions passed');
