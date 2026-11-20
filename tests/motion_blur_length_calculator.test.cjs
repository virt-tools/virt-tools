/* Motion blur length calculator: the shutter and projection arithmetic, a
   seeded sweep against an independent frame-fraction formulation, the angle
   table, the catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'motion-blur-length-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* mbl-core:start */';
const endMarker = '/* mbl-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MblCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const failure = (input) => {
  try { C.analyse(input); } catch (error) { return error.message; }
  return null;
};

const base = {
  fps: '24', angle: '180', focal: '50', sensor: '36',
  width: '1920', distance: '10', speed: '1'
};

// ---- The exported surface and its limits.
assert.deepEqual(plain(Object.keys(C)).sort(), ['analyse', 'angles', 'exposureLabel', 'limits', 'roundTo']);
assert.deepEqual(plain(C.limits.fps), [1, 240]);
assert.deepEqual(plain(C.limits.angle), [1, 360]);
assert.deepEqual(plain(C.limits.focal), [1, 2000]);
assert.deepEqual(plain(C.limits.sensor), [1, 100]);
assert.deepEqual(plain(C.limits.width), [64, 16384]);
assert.deepEqual(plain(C.limits.distance), [0.05, 100000]);
assert.deepEqual(plain(C.limits.speed), [0, 1000]);
assert.deepEqual(plain(C.angles), [45, 90, 144, 172.8, 180, 270, 360]);

// ---- The default shot: 1 m/s across the frame at 10 m, 50 mm on full frame.
const d = C.analyse(base);
assert.equal(d.exposureSeconds, 0.020833333);
assert.equal(d.exposureMs, 20.833);
assert.equal(d.exposureFraction, '1/48');
assert.equal(d.frameIntervalMs, 41.667);
assert.equal(d.frameWidthMetres, 7.2);
assert.equal(d.subjectTravelMm, 20.833);
assert.equal(d.sensorTravelMm, 0.1042);
assert.equal(d.pixelsPerMm, 53.3333);
assert.equal(d.blurPixels, 5.556);
assert.equal(d.blurPercent, 0.2894);
assert.equal(d.horizontalFovDegrees, 39.598);

// ---- Exposure time is the angle over 360 of the frame interval.
assert.equal(C.analyse({ ...base, angle: '360' }).exposureFraction, '1/24');
assert.equal(C.analyse({ ...base, fps: '25' }).exposureFraction, '1/50');
assert.equal(C.analyse({ ...base, fps: '48', angle: '90' }).exposureFraction, '1/192');
assert.equal(C.analyse({ ...base, fps: '24', angle: '172.8' }).exposureFraction, '1/50');
assert.equal(C.analyse({ ...base, angle: '179.9' }).exposureFraction, null);
assert.equal(C.analyse({ ...base, fps: '23.976', angle: '180' }).exposureFraction, null);
assert.equal(C.exposureLabel(1 / 48, 24, 180), '1/48');
assert.equal(C.exposureLabel(0.011, 25, 90), '1/100');
assert.equal(C.exposureLabel(0.011, 25, 91), null);
for (const [fps, angle] of [[1, 1], [240, 360], [25, 90], [60, 144], [120, 45]]) {
  const answer = C.analyse({ ...base, fps: String(fps), angle: String(angle) });
  assert.ok(Math.abs(answer.exposureSeconds - angle / (360 * fps)) < 1e-9, 'exposure ' + fps + '/' + angle);
  assert.ok(Math.abs(answer.exposureMs - angle / (360 * fps) * 1000) < 0.002, 'exposure ms ' + fps + '/' + angle);
}

// ---- The projection: magnification, frame width at the subject and field of view.
for (const distance of ['0.5', '2', '10', '50', '1000']) {
  const answer = C.analyse({ ...base, distance });
  const m = 50 / (Number(distance) * 1000);
  assert.ok(Math.abs(answer.sensorTravelMm - answer.subjectTravelMm * m) < 1e-3, 'magnification ' + distance);
  assert.ok(Math.abs(answer.frameWidthMetres - 0.036 * Number(distance) / 0.05) < 0.002, 'frame width ' + distance);
}
for (const focal of ['8', '24', '50', '135', '2000']) {
  const answer = C.analyse({ ...base, focal });
  const expected = 2 * Math.atan(36 / (2 * Number(focal))) * 180 / Math.PI;
  assert.ok(Math.abs(answer.horizontalFovDegrees - expected) < 0.002, 'fov ' + focal);
}

// ---- An independent formulation: blur = travel / frame width at the subject.
// The page never forms this ratio, so a shared algebra bug cannot hide here.
for (const speed of ['0', '0.25', '1', '7', '55']) {
  for (const distance of ['0.5', '3', '10', '80', '1000']) {
    const answer = C.analyse({ ...base, speed, distance });
    const travel = Number(speed) * answer.exposureSeconds;
    const fraction = travel / answer.frameWidthMetres;
    assert.ok(Math.abs(answer.blurPixels - fraction * 1920) < 0.002,
      'blur ' + speed + ' m/s at ' + distance + ' m');
  }
}

// ---- Scaling: blur is linear in speed, exposure, focal and inverse distance,
// and the share of the frame is independent of the capture width.
const doubled = C.analyse({ ...base, speed: '2' });
assert.ok(Math.abs(doubled.blurPixels - 2 * d.blurPixels) < 0.005, 'twice the speed');
const wider = C.analyse({ ...base, width: '3840' });
assert.ok(Math.abs(wider.blurPixels - 2 * d.blurPixels) < 0.005, 'twice the width');
assert.equal(wider.blurPercent, d.blurPercent);
assert.ok(Math.abs(C.analyse({ ...base, angle: '90' }).blurPixels - d.blurPixels / 2) < 0.005, 'half the angle');
assert.ok(Math.abs(C.analyse({ ...base, focal: '100' }).blurPixels - 2 * d.blurPixels) < 0.005, 'twice the focal length');
assert.ok(Math.abs(C.analyse({ ...base, distance: '20' }).blurPixels - d.blurPixels / 2) < 0.005, 'twice the distance');
const still = C.analyse({ ...base, speed: '0' });
assert.equal(still.blurPixels, 0);
assert.equal(still.blurPercent, 0);
assert.equal(still.subjectTravelMm, 0);
assert.equal(still.sensorTravelMm, 0);

// ---- A seeded sweep over the whole input space: the reported share always
// matches the reported pixels, the exposure matches the shutter relation and
// every value stays finite.
let seed = 20261120;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let index = 0; index < 250; index += 1) {
  const fps = 1 + rnd() * 239;
  const angle = 1 + rnd() * 359;
  const focal = 1 + rnd() * 1999;
  const sensor = 1 + rnd() * 99;
  const width = 64 + Math.floor(rnd() * (16384 - 64));
  const distance = 0.05 + rnd() * 999.95;
  const speed = rnd() * 100;
  const answer = C.analyse({
    fps: String(fps), angle: String(angle), focal: String(focal), sensor: String(sensor),
    width: String(width), distance: String(distance), speed: String(speed)
  });
  for (const field of ['blurPixels', 'blurPercent', 'subjectTravelMm', 'sensorTravelMm',
    'pixelsPerMm', 'frameWidthMetres', 'horizontalFovDegrees', 'exposureMs']) {
    assert.ok(Number.isFinite(answer[field]), 'finite ' + field);
  }
  assert.ok(Math.abs(answer.blurPercent - answer.blurPixels / width * 100) < 0.001, 'share matches pixels');
  assert.ok(Math.abs(answer.exposureMs - angle * 1000 / (360 * fps)) < 0.002, 'exposure matches angle');
  const sensorProduct = answer.sensorTravelMm * answer.pixelsPerMm;
  const quantum = 5e-5 * answer.pixelsPerMm; // half a 0.0001 mm step, in pixels
  assert.ok(Math.abs(sensorProduct - answer.blurPixels) <= 0.002 + quantum,
    'sensor travel matches pixels');
  assert.equal(answer.table.length, 7);
  assert.ok(answer.blurPixels >= 0 && answer.blurPercent >= 0);
}

// ---- The angle table: seven rows, the entered angle marked once, and twice
// the angle giving twice the blur.
assert.deepEqual(plain(d.table).map((row) => row.angle), [45, 90, 144, 172.8, 180, 270, 360]);
assert.deepEqual(plain(d.table).map((row) => row.current), [false, false, false, false, true, false, false]);
assert.deepEqual(plain(d.table)[4], {
  angle: 180, exposureMs: 20.833, blurPixels: 5.556, blurPercent: 0.2894, current: true
});
assert.equal(d.table[0].exposureMs, 5.208);
assert.equal(d.table[3].exposureMs, 20);
assert.ok(Math.abs(d.table[6].blurPixels - 2 * d.table[4].blurPixels) < 0.01, 'open shutter doubles blur');
assert.ok(Math.abs(d.table[0].blurPixels - d.table[4].blurPixels / 4) < 0.01, 'a quarter angle is a quarter blur');
assert.equal(C.analyse({ ...base, angle: '172.8' }).table[3].current, true);
assert.equal(C.analyse({ ...base, angle: '172.8' }).table[4].current, false);

// ---- The limits themselves are accepted.
assert.ok(C.analyse({ ...base, fps: '1', angle: '1', focal: '1', sensor: '1', width: '64', distance: '0.05', speed: '0' }).blurPixels === 0);
const extremes = C.analyse({ ...base, fps: '240', angle: '360', focal: '2000', sensor: '100', width: '16384', distance: '100000', speed: '1000' });
assert.ok(Number.isFinite(extremes.blurPixels));
assert.ok(extremes.blurPixels > 0);
assert.equal(C.analyse({ ...base, width: '64' }).blurPixels, 0.185);
assert.equal(C.analyse({ ...base, distance: '0.05', speed: '1000' }).frameWidthMetres, 0.036);

// ---- Refusals.
assert.equal(failure({ ...base, fps: '' }), 'Frame rate is required.');
assert.equal(failure({ ...base, fps: 'fast' }), 'Frame rate must be a number between 1 and 240 fps.');
assert.equal(failure({ ...base, fps: '0' }), 'Frame rate must be between 1 and 240 fps.');
assert.equal(failure({ ...base, fps: '241' }), 'Frame rate must be between 1 and 240 fps.');
assert.equal(failure({ ...base, angle: '' }), 'Shutter angle is required.');
assert.equal(failure({ ...base, angle: 'wide' }), 'Shutter angle must be a number between 1 and 360 degrees.');
assert.equal(failure({ ...base, angle: '0.5' }), 'Shutter angle must be between 1 and 360 degrees.');
assert.equal(failure({ ...base, angle: '400' }), 'Shutter angle must be between 1 and 360 degrees.');
assert.equal(failure({ ...base, focal: '' }), 'Focal length is required.');
assert.equal(failure({ ...base, focal: '0' }), 'Focal length must be between 1 and 2000 mm.');
assert.equal(failure({ ...base, focal: '2001' }), 'Focal length must be between 1 and 2000 mm.');
assert.equal(failure({ ...base, sensor: '' }), 'Sensor width is required.');
assert.equal(failure({ ...base, sensor: '0' }), 'Sensor width must be between 1 and 100 mm.');
assert.equal(failure({ ...base, sensor: '101' }), 'Sensor width must be between 1 and 100 mm.');
assert.equal(failure({ ...base, width: '' }), 'Capture width is required.');
assert.equal(failure({ ...base, width: '1e3' }), 'Capture width must be a whole number of pixels between 64 and 16384.');
assert.equal(failure({ ...base, width: '1920.5' }), 'Capture width must be a whole number of pixels between 64 and 16384.');
assert.equal(failure({ ...base, width: '63' }), 'Capture width must be a whole number of pixels between 64 and 16384.');
assert.equal(failure({ ...base, width: '16385' }), 'Capture width must be a whole number of pixels between 64 and 16384.');
assert.equal(failure({ ...base, distance: '' }), 'Subject distance is required.');
assert.equal(failure({ ...base, distance: '0' }), 'Subject distance must be between 0.05 and 100000 metres.');
assert.equal(failure({ ...base, distance: '0.04' }), 'Subject distance must be between 0.05 and 100000 metres.');
assert.equal(failure({ ...base, distance: '100001' }), 'Subject distance must be between 0.05 and 100000 metres.');
assert.equal(failure({ ...base, speed: '' }), 'Subject speed is required.');
assert.equal(failure({ ...base, speed: '-1' }), 'Subject speed must be between 0 and 1000 m/s.');
assert.equal(failure({ ...base, speed: '1001' }), 'Subject speed must be between 0 and 1000 m/s.');
assert.equal(failure({}), 'Frame rate is required.');

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Motion Blur Length Calculator');
assert.equal(entry.category, 'Video');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 700, 'method must document the model and its limits');
assert.ok(entry.sources.length >= 2);
assert.ok(entry.sources.every((source) => /^https:\/\//.test(source.url)), 'https sources');
assert.equal(entry.testCases.length, 30, 'catalog case count');
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'golden').length, 6);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'boundary').length, 6);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'validation').length, 18);

for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const answer = C.analyse(testCase.input);
  for (const [field, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(plain(answer[field]), expected, testCase.name + ' ' + field);
  }
}

// ---- A name or alias belongs to one tool only.
const names = new Map();
for (const tool of catalog.tools) {
  for (const value of [tool.name, ...(tool.aliases || [])]) {
    const key = value.toLowerCase();
    if (!names.has(key)) names.set(key, new Set());
    names.get(key).add(tool.slug);
  }
}
for (const value of [entry.name, ...entry.aliases]) {
  const holders = names.get(value.toLowerCase());
  assert.deepEqual([...holders], [slug], 'name or alias is not shared: ' + value);
}

// ---- Page contract.
assert.ok(/<h1>Motion Blur Length Calculator<\/h1>/.test(html), 'heading');
assert.ok(/<form id="blur-form" novalidate>/.test(html), 'form');
for (const id of ['in-fps', 'in-angle', 'in-focal', 'in-sensor', 'in-width', 'in-distance',
  'in-speed', 'err', 'run', 'out', 'chart-wrap', 'chart-title', 'chart-rows']) {
  assert.ok(html.includes('id="' + id + '"'), 'element id: ' + id);
}
for (const label of ['Frame rate', 'Shutter angle', 'Focal length', 'Sensor width',
  'Capture width', 'Subject distance', 'Subject speed']) {
  assert.ok(html.includes('>' + label + '</label>'), 'label: ' + label);
}
assert.ok(/<button type="submit" id="run">Measure the blur<\/button>/.test(html), 'submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/Nothing is uploaded, stored or fetched/.test(html), 'the note states local only');
assert.ok(/\[hidden\]\{display:none!important\}/.test(html), 'hidden elements stay hidden');
assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(html), 'no off-site links or requests');
assert.ok(!/<script[^>]+src="(?!\/assets\/)/.test(html), 'only local scripts');
assert.ok(!/\son(click|input|change|submit|keydown)=/.test(html), 'no inline event handlers');
assert.equal(html.match(/<script/g).length, 3, 'theme init, shared app and the tool script');
assert.ok(/min-height:44px/.test(html), '44px touch targets');
assert.ok(/<caption>/.test(html) && /scope="col"/.test(html), 'table caption and headers');
assert.ok(!/\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), 'no network or storage');
const ids = html.match(/\bid="[^"]+"/g).map((value) => value.slice(4, -1));
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');

console.log('motion blur length calculator: all assertions passed');
