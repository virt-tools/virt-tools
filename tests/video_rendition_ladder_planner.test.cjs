/* Regression checks for the rendition ladder core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/video-rendition-ladder-planner/index.html'), 'utf8');
const start = html.indexOf('/* ladder-core:start */');
const end = html.indexOf('/* ladder-core:end */');
assert.ok(start > -1 && end > start, 'ladder core markers missing');
const core = html.slice(start, end + '/* ladder-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = LadderCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const plan = (options) => C.plan(options);
const shape = (rungs) => rungs.map((r) => [r.width, r.height, r.videoKbps, r.totalKbps].join('x')).join(' ');

// The default ladder is the one used in the page and the method note.
const standard = plan({});
assert.equal(
  shape(standard.rungs),
  '1920x1080x4977x5105 1280x720x2212x2340 854x480x984x1112 568x320x436x564',
  'default rungs'
);
assert.equal(standard.actualSteps, 4);
assert.equal(standard.truncated, false);
assert.equal(standard.totalKbps, 9121);
near(standard.ladderMbps, 9.12, 'default ladder Mbps');
near(standard.ladderGbPerHour, 4.1, 'default ladder GB/h');
near(standard.peakEgressMbps, 510.5, 'default peak egress');
near(standard.rungs[1].bpp, 0.08, 'default rung bpp');
near(standard.rungs[2].mbPerMinute, 8.34, 'default rung MB/min');
near(standard.rungs[3].gbPerHour, 0.25, 'default rung GB/h');
near(standard.rungs[2].pixelShare, 19.8, 'default rung pixel share');

// Even dimensions come from the top aspect ratio, so 480p of 16:9 is 854 wide.
const ntsc = plan({ width: '1920', height: '1080', ratio: '2/3', steps: '3' });
assert.equal(shape(ntsc.rungs), '1920x1080x4977x5105 1280x720x2212x2340 854x480x984x1112');

// A three-quarter step halves the pixel count roughly, and 607.5 rounds to 608.
const threeQuarters = plan({ width: '1920', height: '1080', fps: '60', bpp: '0.1', steps: '5', ratio: '3/4', audio: '160' });
assert.equal(
  threeQuarters.rungs.map((r) => r.width + 'x' + r.height).join(' '),
  '1920x1080 1440x810 1080x608 810x456 608x342'
);

// Vertical video steps by the long edge, so widths fall and heights dominate.
const vertical = plan({ width: '1080', height: '1920', ratio: '2/3', steps: '4' });
assert.equal(
  vertical.rungs.map((r) => r.width + 'x' + r.height).join(' '),
  '1080x1920 720x1280 480x854 320x570'
);

// Audio is added on every rung, including zero.
const silent = plan({ audio: '0', steps: '2' });
assert.equal(silent.rungs[0].audioKbps, 0);
assert.equal(silent.rungs[0].totalKbps, silent.rungs[0].videoKbps);
assert.equal(silent.rungs[1].totalKbps, silent.rungs[1].videoKbps);

// A small top frame stops before a rung below 64 pixels rather than inventing one.
const small = plan({ width: '256', height: '144', fps: '24', bpp: '0.1', steps: '6', audio: '64' });
assert.equal(small.actualSteps, 3);
assert.equal(small.truncated, true);
assert.equal(small.rungs.map((r) => r.width + 'x' + r.height).join(' '), '256x144 170x96 114x64');

// A frame too short to step down reports a single rung.
const tiny = plan({ width: '2', height: '2', fps: '1', bpp: '0.005', steps: '2' });
assert.equal(tiny.actualSteps, 1);
assert.equal(tiny.truncated, true);

// Unknown step ratios fall back to two thirds.
const fallback = plan({ ratio: 'nonsense', steps: '2' });
near(fallback.rungs[1].height, 720, 'fallback ratio');

// Parsing and validation rejections.
assert.throws(() => plan({ width: '' }), /Top width must be a whole number from 2 to 7,680 pixels\./);
assert.throws(() => plan({ width: '1921' }), /Top width must be an even number of pixels\./);
assert.throws(() => plan({ height: '1081' }), /Top height must be an even number of pixels\./);
assert.throws(() => plan({ fps: '29.97' }), /Frame rate must be a whole number from 1 to 240 fps\./);
assert.throws(() => plan({ bpp: '0.0801' }), /Bits per pixel must have at most three decimal places\./);
assert.throws(() => plan({ bpp: '0.004' }), /Bits per pixel must be a number from 0\.005 to 1\./);
assert.throws(() => plan({ steps: '1' }), /Ladder steps must be a whole number from 2 to 6\./);
assert.throws(() => plan({ audio: '513' }), /Audio bitrate must be a whole number from 0 to 512 kbps\./);
assert.throws(() => plan({ viewers: '1,000' }), /Concurrent viewers must be a whole number from 0 to 1,000,000\./);

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'video-rendition-ladder-planner');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Video');
assert.equal(record.risk, 'low');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 40, 'catalog has the full test case set');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => plan(testCase.input), new RegExp(escape(testCase.expectedError)), testCase.name);
    continue;
  }
  const result = plan(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (key === 'rungs') {
      assert.equal(result.rungs.length, value.length, `${testCase.name} rung count`);
      assert.equal(
        shape(result.rungs),
        value.map((rung) => rung.join('x')).join(' '),
        `${testCase.name} rungs`
      );
    } else if (typeof value === 'number') {
      near(result[key], value, `${testCase.name} ${key}`);
    } else {
      assert.equal(result[key], value, `${testCase.name} ${key}`);
    }
  }
}

console.log('video-rendition-ladder-planner: all checks passed (' + record.testCases.length + ' catalog cases)');
