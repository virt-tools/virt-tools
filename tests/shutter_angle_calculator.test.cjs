/* Regression checks for the shutter angle core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/shutter-angle-calculator/index.html'), 'utf8');
const start = html.indexOf('/* shutter-angle-core:start */');
const end = html.indexOf('/* shutter-angle-core:end */');
assert.ok(start > -1 && end > start, 'shutter angle core markers missing');
const core = html.slice(start, end + '/* shutter-angle-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ShutterAngleCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const plan = (input) => C.plan(input);
const base = { fps: '24', angle: '180' };
const seconds = (fps, angle) => angle / (360 * fps);

// 180 degrees at 24 fps is half of each frame: 1/48 s.
const standard = plan(base);
near(standard.shutterSeconds, 1 / 48, 'standard shutter seconds');
near(standard.shutterDenominator, 48, 'standard denominator');
near(standard.exposureMs, 1000 / 48, 'standard exposure ms');
near(standard.frameIntervalMs, 1000 / 24, 'standard frame interval');
near(standard.openPct, 50, 'standard open percentage');
near(standard.stopsVs180, 0, 'standard stops');
assert.equal(standard.mode, 'angle');
assert.equal(standard.fps, 24);
assert.equal(standard.angle, 180);
near(standard.exposureMs, standard.frameIntervalMs / 2, 'half the frame');

// 172.8 degrees at 24 fps is exactly the 1/50 s anti-flicker shutter.
const pal = plan({ fps: '24', angle: '172.8' });
near(pal.shutterSeconds, 0.02, '172.8 shutter seconds');
near(pal.shutterDenominator, 50, '172.8 denominator');
near(pal.openPct, 48, '172.8 open percentage');
near(pal.stopsVs180, Math.log2(172.8 / 180), '172.8 stops');

// Whole-frame exposure at 360 degrees equals the frame interval.
const wide = plan({ fps: '24', angle: '360' });
near(wide.shutterSeconds, 1 / 24, '360 shutter seconds');
near(wide.exposureMs, wide.frameIntervalMs, '360 equals frame interval');
near(wide.openPct, 100, '360 open percentage');
near(wide.stopsVs180, 1, '360 is one stop over 180');

// Frame-rate independence: the same angle halves the exposure as the rate doubles.
const fast = plan({ fps: '48', angle: '180' });
near(fast.shutterSeconds, 1 / 96, '48 fps shutter');
near(fast.shutterSeconds * 2, standard.shutterSeconds, 'doubling fps halves exposure');

// 29.97 fps at 180 degrees is 1/59.94 s.
const ntsc = plan({ fps: '29.97', angle: '180' });
near(ntsc.shutterSeconds, 0.5 / 29.97, '29.97 shutter');
near(ntsc.shutterDenominator, 59.94, '29.97 denominator');
near(ntsc.openPct, 50, '29.97 open percentage');

// Reverse mode: angle = 360 x shutter x fps.
const reverse = plan({ mode: 'shutter', fps: '24', shutter: '1/48' });
near(reverse.angle, 180, 'reverse 1/48 at 24 fps');
near(reverse.shutterSeconds, 1 / 48, 'reverse shutter preserved');
near(reverse.stopsVs180, 0, 'reverse stops');
assert.equal(reverse.mode, 'shutter');
const reversePal = plan({ mode: 'shutter', fps: '24', shutter: '1/50' });
near(reversePal.angle, 172.8, 'reverse 1/50 at 24 fps');
near(reversePal.openPct, 48, 'reverse open percentage');

// Equivalent fractions and a decimal shutter give the same angle.
near(plan({ mode: 'shutter', fps: '24', shutter: '2/96' }).angle, 180, 'equivalent fraction');
near(plan({ mode: 'shutter', fps: '24', shutter: '1 / 48' }).angle, 180, 'spaced fraction');
near(plan({ mode: 'shutter', fps: '24', shutter: '0.02' }).angle, 172.8, 'decimal shutter');

// Round-trip every table angle back through the reverse mode.
for (const angle of C.TABLE_ANGLES) {
  const forward = plan({ fps: '25', angle: String(angle) });
  const back = plan({ mode: 'shutter', fps: '25', shutter: '1/' + forward.shutterDenominator });
  near(back.angle, angle, 'round trip ' + angle, 1e-9);
}

// The table has seven rows, rising in angle and exposure, all consistent with the rate.
assert.equal(standard.angleRows.length, 7);
assert.equal(standard.angleRows.map((row) => row.angle).join(','), '45,90,144,172.8,180,270,360');
near(standard.angleRows[0].shutterSeconds, 45 / 8640, 'table first row');
near(standard.angleRows[6].shutterSeconds, 1 / 24, 'table last row');
for (let i = 0; i < standard.angleRows.length; i += 1) {
  const row = standard.angleRows[i];
  near(row.shutterSeconds, row.angle / (360 * 24), 'table row ' + row.angle);
  near(row.exposureMs, row.shutterSeconds * 1000, 'table ms ' + row.angle);
  if (i > 0) assert.ok(row.shutterSeconds > standard.angleRows[i - 1].shutterSeconds, 'table ascending');
}

// Parsing and range rejections.
const rejects = (input, pattern, label) =>
  assert.throws(() => plan({ ...base, ...input }), pattern, label);
rejects({ fps: '' }, /Frame rate is required\./);
rejects({ fps: '   ' }, /Frame rate is required\./);
rejects({ fps: '24fps' }, /Frame rate must be a number\./);
rejects({ fps: '-24' }, /Frame rate must be a number\./);
rejects({ fps: '1e1' }, /Frame rate must be a number\./);
rejects({ fps: '0' }, /Frame rate must be from 1 to 240 fps\./);
rejects({ fps: '241' }, /Frame rate must be from 1 to 240 fps\./);
rejects({ angle: '' }, /Shutter angle is required\./);
rejects({ angle: '180deg' }, /Shutter angle must be a number\./);
rejects({ angle: '0' }, /Shutter angle must be from 1 to 360 degrees\./);
rejects({ angle: '361' }, /Shutter angle must be from 1 to 360 degrees\./);
rejects({ mode: 'shutter', shutter: '' }, /Shutter speed is required\./);
rejects({ mode: 'shutter', shutter: 'abc' }, /Shutter speed must be a number or a fraction such as 1\/48\./);
rejects({ mode: 'shutter', shutter: '1/0' }, /The shutter fraction cannot have a zero denominator\./);
rejects({ mode: 'shutter', shutter: '0' }, /Shutter speed must be greater than zero\./);
rejects({ mode: 'shutter', shutter: '-1/48' }, /Shutter speed must be a number or a fraction such as 1\/48\./);
rejects({ mode: 'shutter', shutter: '1/48/2' }, /Shutter speed must be a number or a fraction such as 1\/48\./);
rejects({ mode: 'shutter', shutter: '1/20' }, /Shutter speed must not be longer than the frame interval \(1\/24 s at 24 fps\)\./);
rejects({ mode: 'both' }, /Choose what to solve for\./);

// The exact frame interval is allowed at 360 degrees.
const edge = plan({ mode: 'shutter', fps: '25', shutter: '1/25' });
near(edge.angle, 360, 'frame interval equals 360 degrees');

// Missing options object is rejected rather than crashing.
assert.throws(() => C.plan(), /Frame rate is required\./);

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'shutter-angle-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Video');
assert.ok(record.testCases.length >= 20, 'catalog has the full test case set');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(
      () => plan(testCase.input),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = plan(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (key === 'angleRowCount') assert.equal(result.angleRows.length, value, testCase.name);
    else if (key === 'angleRowFirst') assert.equal(result.angleRows[0].angle, value, testCase.name);
    else if (key === 'angleRowFirstShutter') near(result.angleRows[0].shutterSeconds, value, testCase.name);
    else if (key === 'angleRowLast') assert.equal(result.angleRows[result.angleRows.length - 1].angle, value, testCase.name);
    else if (key === 'angleRowLastShutter') near(result.angleRows[result.angleRows.length - 1].shutterSeconds, value, testCase.name);
    else if (typeof value === 'number') near(result[key], value, testCase.name + ' ' + key);
    else assert.equal(result[key], value, testCase.name + ' ' + key);
  }
}

console.log('shutter-angle-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
