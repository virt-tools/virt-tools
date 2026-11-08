/* Regression checks for the multicam sync planner core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/multicam-sync-planner/index.html'), 'utf8');
const start = html.indexOf('/* multicam-core:start */');
const end = html.indexOf('/* multicam-core:end */');
assert.ok(start > -1 && end > start, 'multicam core markers missing');
const core = html.slice(start, end + '/* multicam-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = McCore;', sandbox);
const C = sandbox.module.exports;

const DEFAULTS = {
  fps: '29.97',
  dropFrame: true,
  cameras: [
    { label: 'A', mark: '10:00:00:00', start: '09:59:40:00', end: '10:01:15:00' },
    { label: 'B', mark: '14:23:11:07', start: '14:22:58:00', end: '14:24:05:00' },
    { label: 'C', mark: '01:05:00:12', start: '01:04:52:24', end: '01:06:10:00' }
  ]
};
const plan = (options) => C.plan(options);
const t2997 = C.rateFor('29.97');

// Drop-frame label anchors: minute zero has no skip, later minutes open at :02.
assert.equal(C.parseTimecode('00:00:00:00', t2997, true, 'x'), 0);
assert.equal(C.parseTimecode('00:00:59:29', t2997, true, 'x'), 1799);
assert.equal(C.parseTimecode('00:01:00:02', t2997, true, 'x'), 1800);
assert.equal(C.parseTimecode('00:10:00:00', t2997, true, 'x'), 17982);
assert.equal(C.parseTimecode('10:00:00:00', t2997, true, 'x'), 1078920);
assert.equal(C.timecode(226, t2997, true), '00:00:07:16');
assert.equal(C.timecode(1800, t2997, true), '00:01:00:02');

// The page defaults: three angles, one clap, C limiting the head and B the tail.
const standard = plan(DEFAULTS);
assert.equal(standard.rate, '29.97');
assert.equal(standard.dropFrame, true);
assert.equal(standard.cameraCount, 3);
assert.equal(standard.overlapFrames, 1837);
assert.equal(standard.overlapTc, '00:01:01:09');
assert.equal(standard.overlapSeconds, 61.29);
assert.equal(standard.opensBeforeTc, '00:00:07:16');
assert.equal(standard.closesAfterTc, '00:00:53:21');
assert.equal(standard.startCamera, 'C');
assert.equal(standard.endCamera, 'B');
assert.equal(standard.totalClipTc, '00:03:59:02');
assert.equal(
  standard.cameras.map((camera) => [camera.label, camera.headTc, camera.tailTc, camera.clipTc, camera.outsideTc].join('|')).join(' '),
  'A|00:00:20:00|00:01:15:00|00:01:35:00|00:00:33:21 '
  + 'B|00:00:13:05|00:00:53:21|00:01:06:28|00:00:05:19 '
  + 'C|00:00:07:16|00:01:09:18|00:01:17:04|00:00:15:25'
);
assert.equal(standard.cameras.map((camera) => camera.setsStart).join(','), 'false,false,true');
assert.equal(standard.cameras.map((camera) => camera.setsEnd).join(','), 'false,true,false');

// Angles that only meet at their marks share no frames, and that is reported.
assert.throws(() => plan({ fps: '30', dropFrame: false, cameras: [
  { label: 'A', mark: '00:00:20:00', start: '00:00:00:00', end: '00:00:20:00' },
  { label: 'B', mark: '00:00:20:00', start: '00:00:20:00', end: '00:00:40:00' }
] }), /No common overlap: camera A ends at 00:00:00:00 after its sync mark and camera B starts 00:00:00:00 before its own, so the angles share no frames\./);

// Drop-frame refusals keep impossible labels out instead of shifting them.
assert.throws(() => C.parseTimecode('00:01:00:00', t2997, true, 'x'), /not a valid drop-frame timecode: frames 00 to 01 are skipped/);
assert.throws(() => C.parseTimecode('00:01:00:03', C.rateFor('59.94'), true, 'x'), /not a valid drop-frame timecode: frames 00 to 03 are skipped/);
// The same label is legal when counting straight through.
assert.equal(C.parseTimecode('00:01:00:00', t2997, false, 'x'), 1800);

const cam = (label, mark, start, end) => ({ label, mark, start, end });
assert.throws(() => plan({ fps: '24', dropFrame: true, cameras: [cam('A', '00:00:01:00', '00:00:00:00', '00:00:10:00'), cam('B', '00:00:01:00', '00:00:00:00', '00:00:08:00')] }),
  /Drop-frame timecode is only available at 29\.97 or 59\.94 fps\./);
assert.throws(() => plan({ fps: '48', cameras: [cam('A', '00:00:01:00', '00:00:00:00', '00:00:10:00'), cam('B', '00:00:01:00', '00:00:00:00', '00:00:08:00')] }),
  /Frame rate must be one of 23\.976, 24, 25, 29\.97, 30, 50, 59\.94 or 60\./);
assert.throws(() => plan({ cameras: [cam('A', '00:00:01:00', '00:00:00:00', '00:00:10:00')] }),
  /Add at least two camera angles\./);
assert.throws(() => plan({ cameras: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((label) => cam(label, '00:00:01:00', '00:00:00:00', '00:00:10:00')) }),
  /A plan can cover at most six camera angles\./);

// Sequence zero is the earliest mark, so the window is measured from it.
const window = plan({ fps: '30', dropFrame: false, cameras: [
  cam('A', '00:01:00:00', '00:00:00:00', '00:03:00:00'),
  cam('B', '00:01:00:00', '00:00:55:00', '00:01:10:00')
] });
assert.equal(window.overlapFrames, 450);
assert.equal(window.overlapTc, '00:00:15:00');
assert.equal(window.startCamera, 'B');
assert.equal(window.endCamera, 'B');

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'multicam-sync-planner');
assert.ok(record, 'catalog entry present');
assert.equal(record.name, 'Multicam Sync Planner');
assert.equal(record.category, 'Video');
assert.equal(record.risk, 'low');
assert.equal(record.listed, true);
assert.equal(record.testCases.length, 40);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => plan(testCase.input), new RegExp(escape(testCase.expectedError)), testCase.name);
    continue;
  }
  const result = plan(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (key === 'angles') {
      assert.equal(result.cameras.length, value.length, `${testCase.name} angle count`);
      const rows = result.cameras.map((camera) => [camera.label, camera.headTc, camera.tailTc, camera.clipTc, camera.outsideTc]);
      assert.equal(JSON.stringify(rows), JSON.stringify(value), `${testCase.name} angles`);
    } else if (typeof value === 'number') {
      assert.ok(Math.abs(result[key] - value) < 0.005, `${testCase.name} ${key}: ${result[key]} != ${value}`);
    } else {
      assert.equal(result[key], value, `${testCase.name} ${key}`);
    }
  }
}

console.log('multicam-sync-planner: all checks passed (' + record.testCases.length + ' catalog cases)');
