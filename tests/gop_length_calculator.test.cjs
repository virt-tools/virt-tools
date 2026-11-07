/* Regression checks for the GOP length core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/gop-length-calculator/index.html'), 'utf8');
const start = html.indexOf('/* gop-core:start */');
const end = html.indexOf('/* gop-core:end */');
assert.ok(start > -1 && end > start, 'GOP core markers missing');
const core = html.slice(start, end + '/* gop-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = GopCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const analyse = (options) => C.analyse(options);

// A two-second interval at 25 fps is the familiar 50-frame GOP.
const standard = analyse({});
assert.equal(standard.mode, 'interval');
near(standard.fps, 25, 'default fps');
near(standard.duration, 600, 'default duration');
near(standard.requestedInterval, 2, 'default interval');
near(standard.exactFrames, 50, 'default exact frames');
assert.equal(standard.gopFrames, 50);
near(standard.effectiveInterval, 2, 'default effective interval');
near(standard.roundingFrames, 0, 'default rounding');
assert.equal(standard.clipFrames, 15000);
assert.equal(standard.keyframes, 300);
near(standard.keyframesPerMinute, 30, 'default keyframes per minute');
assert.equal(standard.table.length, 5);
assert.deepEqual(
  Array.from(standard.table, (row) => [row.interval, row.frames, row.effectiveInterval, row.keyframes]),
  [[0.5, 13, 0.52, 1154], [1, 25, 1, 600], [2, 50, 2, 300], [4, 100, 4, 150], [10, 250, 10, 60]],
  'default interval table'
);

// 29.97 fps leaves a fractional frame count that has to round.
const ntsc = analyse({ fps: '29.97', interval: '2', duration: '600' });
near(ntsc.exactFrames, 59.94, 'ntsc exact frames');
assert.equal(ntsc.gopFrames, 60);
near(ntsc.effectiveInterval, 2.002002002002002, 'ntsc effective interval');
near(ntsc.roundingFrames, 0.06, 'ntsc rounding');
assert.equal(ntsc.clipFrames, 17982);
assert.equal(ntsc.keyframes, 300);
near(ntsc.keyframesPerMinute, 29.97, 'ntsc keyframes per minute');
assert.equal(ntsc.table[0].frames, 15);
assert.equal(ntsc.table[1].frames, 30);
assert.equal(ntsc.table[2].frames, 60);

// The inverse mode divides the GOP length by the frame rate.
const frames = analyse({ mode: 'frames', fps: '25', gop: '250', duration: '600' });
assert.equal(frames.mode, 'frames');
near(frames.requestedInterval, 10, 'frames requested interval');
near(frames.exactFrames, 250, 'frames exact');
assert.equal(frames.gopFrames, 250);
near(frames.effectiveInterval, 10, 'frames effective interval');
assert.equal(frames.clipFrames, 15000);
assert.equal(frames.keyframes, 60);
near(frames.keyframesPerMinute, 6, 'frames keyframes per minute');

// A stale interval is ignored once the frame count is the input.
const ignored = analyse({ mode: 'frames', fps: '25', gop: '250', interval: '999', duration: '600' });
assert.equal(ignored.gopFrames, 250);
near(ignored.effectiveInterval, 10, 'ignored interval');

// Film-rate input lands on a fractional effective interval.
const film = analyse({ mode: 'frames', fps: '23.976', gop: '48', duration: '600' });
near(film.effectiveInterval, 2.002002002002002, 'film effective interval');
assert.equal(film.clipFrames, 14386);
assert.equal(film.keyframes, 300);
near(film.keyframesPerMinute, 29.97, 'film keyframes per minute');

// Short clips still count the opening keyframe.
const short = analyse({ fps: '60', interval: '0.5', duration: '30' });
assert.equal(short.gopFrames, 30);
assert.equal(short.clipFrames, 1800);
assert.equal(short.keyframes, 60);
near(short.keyframesPerMinute, 120, 'short keyframes per minute');

// The upper bounds are inclusive, and a single GOP covers the whole clip.
const upper = analyse({ fps: '240', interval: '60', duration: '60' });
assert.equal(upper.gopFrames, 14400);
assert.equal(upper.clipFrames, 14400);
assert.equal(upper.keyframes, 1);

// An interval shorter than one frame cannot produce a zero-frame GOP.
const clamped = analyse({ fps: '1', interval: '0.1', duration: '60' });
near(clamped.exactFrames, 0.1, 'clamped exact');
assert.equal(clamped.gopFrames, 1);
near(clamped.effectiveInterval, 1, 'clamped effective');
near(clamped.roundingFrames, 0.9, 'clamped rounding');

// Parsing and validation rejections.
assert.throws(() => analyse({ fps: '' }), /Frame rate is required\./);
assert.throws(() => analyse({ fps: 'abc' }), /Frame rate must be a number between 1 and 240 fps\./);
assert.throws(() => analyse({ fps: '0' }), /Frame rate must be between 1 and 240 fps\./);
assert.throws(() => analyse({ fps: '241' }), /Frame rate must be between 1 and 240 fps\./);
assert.throws(() => analyse({ interval: '' }), /Keyframe interval is required\./);
assert.throws(() => analyse({ interval: '0.05' }), /Keyframe interval must be between 0\.1 and 60 seconds\./);
assert.throws(() => analyse({ interval: '61' }), /Keyframe interval must be between 0\.1 and 60 seconds\./);
assert.throws(() => analyse({ interval: 'two' }), /Keyframe interval must be a number between 0\.1 and 60 seconds\./);
assert.throws(() => analyse({ mode: 'frames', gop: '' }), /GOP length is required\./);
assert.throws(() => analyse({ mode: 'frames', gop: '2.5' }), /GOP length must be a whole number from 1 to 20,000 frames\./);
assert.throws(() => analyse({ mode: 'frames', gop: '0' }), /GOP length must be between 1 and 20,000 frames\./);
assert.throws(() => analyse({ mode: 'frames', gop: '20001' }), /GOP length must be between 1 and 20,000 frames\./);
assert.throws(() => analyse({ duration: '' }), /Clip duration is required\./);
assert.throws(() => analyse({ duration: '0' }), /Clip duration must be between 1 and 86,400 seconds\./);
assert.throws(() => analyse({ duration: '90000' }), /Clip duration must be between 1 and 86,400 seconds\./);
assert.throws(() => analyse({ duration: 'ten' }), /Clip duration must be a number between 1 and 86,400 seconds\./);

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'gop-length-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Video');
assert.equal(record.risk, 'low');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 22, 'catalog has the full test case set');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => analyse(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  const result = analyse(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (Array.isArray(value)) {
      assert.equal(result[key].length, value.length, `${testCase.name} ${key} length`);
      value.forEach((item, index) => {
        if (typeof item === 'number') near(result[key][index], item, `${testCase.name} ${key}[${index}]`);
        else assert.equal(result[key][index], item, `${testCase.name} ${key}[${index}]`);
      });
    } else if (typeof value === 'number') {
      near(result[key], value, `${testCase.name} ${key}`);
    } else {
      assert.equal(result[key], value, `${testCase.name} ${key}`);
    }
  }
}

console.log('gop-length-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
