/* Regression checks for the video transition timeline core and catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/video-transition-timeline-planner/index.html'), 'utf8');
const start = html.indexOf('/* video-transition-timeline-core:start */');
const end = html.indexOf('/* video-transition-timeline-core:end */');
assert.ok(start > -1 && end > start, 'video transition timeline core markers missing');
const core = html.slice(start, end + '/* video-transition-timeline-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = VideoTransitionTimelineCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)), `${label}: expected ${expected}, got ${actual}`);
};
const base = { clips: '5 | Opening\n8 | Interview\n6 | Closing', transitions: '1\n0.5', fps: '30' };
const plan = (overrides = {}) => C.calculate({ ...base, ...overrides });

const standard = plan();
assert.equal(standard.totalClipFrames, 570);
assert.equal(standard.totalOverlapFrames, 45);
assert.equal(standard.totalFrames, 525);
assert.equal(standard.clipCount, 3);
assert.equal(C.clockFrames(standard.totalFrames, standard.fpsScaled), '00:17.500');
const standardClips = Array.from(standard.clips);
assert.deepEqual(standardClips.map((clip) => clip.startFrame), [0, 120, 345]);
assert.deepEqual(standardClips.map((clip) => clip.endFrame), [150, 360, 525]);
assert.deepEqual(standardClips.map((clip) => clip.label), ['Opening', 'Interview', 'Closing']);
assert.equal(C.clockFrames(standardClips[1].startFrame, standard.fpsScaled), '00:04.000');
assert.equal(C.clockFrames(standardClips[2].endFrame, standard.fpsScaled), '00:17.500');
const text = C.summary(standard);
assert.match(text, /2\. Interview \| 00:04\.000–00:12\.000 \| 240 frames/);
assert.match(text, /Outgoing overlap: 15 frames/);
assert.match(text, /Finished runtime: 00:17\.500 \(525 frames; 17\.5 s\)/);

// A blank transition line is a cut; one clip needs no transition rows.
const cuts = plan({ clips: '4|A\n4|B\n4|C', transitions: '\n1', fps: '25' });
assert.equal(cuts.totalFrames, 275);
assert.deepEqual(Array.from(cuts.clips).map((clip) => clip.startFrame), [0, 100, 175]);
const solo = plan({ clips: '00:01.500 | Solo', transitions: '' });
assert.equal(solo.totalFrames, 45);
assert.equal(solo.totalOverlapFrames, 0);
assert.equal(C.summary(solo).includes('Outgoing overlap'), false);

// Independent scalar arithmetic across fractional rates and durations.
let referenceCount = 0;
for (const fps of [1, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 240]) {
  for (const duration of [1, 2.5, 7]) {
    for (const overlap of [0, 0.25, 0.5]) {
      const clipFrames = Math.round(duration * fps);
      const overlapFrames = Math.round(overlap * fps);
      if (clipFrames <= overlapFrames * 2) continue;
      const result = plan({ clips: `${duration}|A\n${duration}|B\n${duration}|C`, transitions: `${overlap}\n${overlap}`, fps: String(fps) });
      referenceCount += 1;
      assert.equal(result.totalClipFrames, clipFrames * 3);
      assert.equal(result.totalOverlapFrames, overlapFrames * 2);
      assert.equal(result.totalFrames, clipFrames * 3 - overlapFrames * 2);
      const clips = Array.from(result.clips);
      assert.equal(clips[0].startFrame, 0);
      assert.equal(clips[1].startFrame, clipFrames - overlapFrames);
      assert.equal(clips[2].startFrame, 2 * (clipFrames - overlapFrames));
      assert.equal(clips[2].endFrame, result.totalFrames);
    }
  }
}

// Maximum bounds and the 100-clip cap are enforced without unsafe arithmetic.
const maximum = plan({ clips: '86400', transitions: '', fps: '240' });
assert.equal(maximum.totalFrames, 20736000);
const hundred = Array.from({ length: 100 }, (_, i) => `1 | Clip ${i + 1}`).join('\n');
const cuts99 = Array.from({ length: 99 }, () => '0').join('\n');
assert.equal(plan({ clips: hundred, transitions: cuts99, fps: '30' }).clipCount, 100);
assert.throws(() => plan({ clips: hundred + '\n1 | Extra', transitions: cuts99 + '\n0' }), /Enter no more than 100 clips\./);
assert.throws(() => plan({ clips: '1|A|B', transitions: '' }), /at most one \| label separator/);
assert.throws(() => plan({ clips: `1 | ${'x'.repeat(81)}`, transitions: '' }), /no more than 80 characters/);
assert.throws(() => plan({ clips: '1', transitions: '0.001', fps: '30' }), /Enter exactly 0 transition durations/);

// Replay every canonical catalog case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'video-transition-timeline-planner');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Video');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 18, 'catalog has the full test case set');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.calculate(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') near(result[key], value, `${testCase.name} ${key}`);
    else assert.equal(result[key], value, `${testCase.name} ${key}`);
  }
}

console.log(`video-transition-timeline-planner: all checks passed (${record.testCases.length} catalog cases, ${referenceCount} reference timelines)`);
