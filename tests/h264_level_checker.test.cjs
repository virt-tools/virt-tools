/* Regression checks for the H.264 level checker: an independently written
   annex-A reference, the catalog cases, monotonicity and rounding invariants,
   a size/rate/profile sweep, and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'h264-level-checker';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* h264-core:start */');
const end = html.indexOf('/* h264-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + '/* h264-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = H264Level;', sandbox);
const C = sandbox.module.exports;

/* Independent reference. The table is written as tuples in the order the
   standard prints it - level, level_idc, MaxMBPS, MaxFS, MaxDpbMbs, MaxBR -
   read back from the published table rather than from the page, and the
   profile factors are kept in tenths of the kbit-to-bit conversion so the
   bitrate test compares whole bits. */
const TABLE = [
  ['1', 10, 1485, 99, 396, 64],
  ['1.1', 11, 3000, 396, 900, 192],
  ['1.2', 12, 6000, 396, 2376, 384],
  ['1.3', 13, 11880, 396, 2376, 768],
  ['2', 20, 11880, 396, 2376, 2000],
  ['2.1', 21, 19800, 792, 4752, 4000],
  ['2.2', 22, 20250, 1620, 8100, 4000],
  ['3', 30, 40500, 1620, 8100, 10000],
  ['3.1', 31, 108000, 3600, 18000, 14000],
  ['3.2', 32, 216000, 5120, 20480, 20000],
  ['4', 40, 245760, 8192, 32768, 20000],
  ['4.1', 41, 245760, 8192, 32768, 50000],
  ['4.2', 42, 522240, 8704, 34816, 50000],
  ['5', 50, 589824, 22080, 110400, 135000],
  ['5.1', 51, 983040, 36864, 184320, 240000],
  ['5.2', 52, 2073600, 36864, 184320, 240000],
  ['6', 60, 4177920, 139264, 696320, 240000],
  ['6.1', 61, 8355840, 139264, 696320, 480000],
  ['6.2', 62, 16711680, 139264, 696320, 800000],
];
const TENTHS = { baseline: 12, main: 12, extended: 12, high: 15, high10: 36, high422: 48, high444: 48 };
const LABEL = {
  baseline: 'Baseline', main: 'Main', extended: 'Extended', high: 'High',
  high10: 'High 10', high422: 'High 4:2:2', high444: 'High 4:4:4 Predictive',
};
const IDC = { baseline: 66, main: 77, extended: 88, high: 100, high10: 110, high422: 122, high444: 244 };

function refMbs(px) { return (px + 15 - ((px + 15) % 16)) / 16; }
function refFails(row, wmbs, hmbs, fps, kbps, profile) {
  const out = [];
  const picture = wmbs * hmbs;
  if (picture > row[3]) out.push('frame size');
  if (wmbs * wmbs > row[3] * 8) out.push('frame width');
  if (hmbs * hmbs > row[3] * 8) out.push('frame height');
  if (picture * fps > row[2]) out.push('frame rate');
  if (kbps !== null && kbps * 10000 > row[5] * 1000 * TENTHS[profile]) out.push('bitrate');
  return out;
}
function refLevel(width, height, fps, profile, kbps) {
  const wmbs = refMbs(width);
  const hmbs = refMbs(height);
  for (let i = 0; i < TABLE.length; i += 1) {
    if (refFails(TABLE[i], wmbs, hmbs, fps, kbps, profile).length === 0) {
      return { level: TABLE[i][0], idc: TABLE[i][1], picture: wmbs * hmbs, index: i };
    }
  }
  return null;
}

assert.equal(C.MB, 16);
assert.equal(C.LEVELS.length, 19, 'level count');
assert.equal(C.PROFILES.length, 7, 'profile count');
assert.equal(C.LIMITS.width.min, 16);
assert.equal(C.LIMITS.width.max, 16384);
assert.equal(C.LIMITS.fps.max, 300);
assert.equal(C.LIMITS.bitrate.max, 1000000);

// The page table matches the published table row for row.
for (let i = 0; i < TABLE.length; i += 1) {
  const page = C.LEVELS[i];
  assert.equal(page.name, TABLE[i][0], 'level name ' + i);
  assert.equal(page.idc, TABLE[i][1], 'level_idc ' + i);
  assert.equal(page.maxMbps, TABLE[i][2], 'MaxMBPS ' + i);
  assert.equal(page.maxFs, TABLE[i][3], 'MaxFS ' + i);
  assert.equal(page.maxDpbMbs, TABLE[i][4], 'MaxDpbMbs ' + i);
  assert.equal(page.maxBr, TABLE[i][5], 'MaxBR ' + i);
}
for (const profile of C.PROFILES) {
  assert.equal(profile.idc, IDC[profile.key], 'profile idc ' + profile.key);
  assert.equal(profile.label, LABEL[profile.key], 'profile label ' + profile.key);
  assert.equal(profile.factor, TENTHS[profile.key] * 100, 'profile factor ' + profile.key);
}
// A missing or unknown profile falls back to High.
assert.equal(C.profileFor('bogus').key, 'high');

// Headline: 1080p30 in High.
const base = C.analyze({ width: '1920', height: '1080', fps: '30', profile: 'high', bitrate: '' });
assert.equal(base.level, '4');
assert.equal(base.levelIdc, 40);
assert.equal(base.widthMbs, 120);
assert.equal(base.heightMbs, 68);
assert.equal(base.picture, 8160);
assert.equal(base.mbps, 244800);
assert.equal(base.maxFs, 8192);
assert.equal(base.maxMbps, 245760);
assert.equal(base.maxDpbMbs, 32768);
assert.equal(base.bitrate, null);
assert.equal(base.bitrateCeiling, 30000);
assert.equal(base.dpbFrames, 4);
assert.equal(base.maxWholeFps, 30);
assert.ok(Math.abs(base.maxFps - 245760 / 8160) < 1e-9, 'max frame rate quotient');
assert.deepEqual(Array.from(base.binding), ['frame size', 'frame rate']);
assert.equal(base.belowLevel, '3.2');

// Macroblock rounding: 1928x1088 is 121x68 macroblocks, not 120x68.
const rounded = C.analyze({ width: '1928', height: '1088', fps: '30', profile: 'high', bitrate: '' });
assert.equal(rounded.widthMbs, 121);
assert.equal(rounded.heightMbs, 68);
assert.equal(rounded.picture, 8228);
assert.equal(rounded.level, '4.2', 'a 1088-line frame needs 4.2');
// 1 px above a macroblock boundary must never round down.
for (const px of [17, 31, 33, 49, 1089, 1921]) {
  assert.equal(refMbs(px) * 16 >= px, true);
  const result = C.analyze({ width: String(px), height: '1088', fps: '24', profile: 'high', bitrate: '' });
  assert.equal(result.widthMbs, refMbs(px), 'macroblock rounding at ' + px);
}

// Raising the frame rate never lowers the level and never lowers the load.
let previousLevel = -1;
for (const fps of ['1', '5', '12.5', '15', '23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60', '120', '240', '300']) {
  let result;
  try {
    result = C.analyze({ width: '1280', height: '720', fps, profile: 'high', bitrate: '' });
  } catch (error) {
    assert.match(error.message, /^No level in the H\.264 table carries these inputs\./, 'only the no-level refusal raises at 1280x720');
    continue;
  }
  const index = C.LEVELS.findIndex((level) => level.name === result.level);
  assert.ok(index >= previousLevel, 'level never falls as the frame rate rises (' + fps + ' fps)');
  previousLevel = index;
  const ref = refLevel(1280, 720, Number(fps), 'high', null);
  assert.equal(result.level, ref.level, 'reference level at ' + fps + ' fps');
  assert.ok(result.mbps <= result.maxMbps, 'macroblock rate inside the level at ' + fps);
}

// Raising the resolution never lowers the level.
previousLevel = -1;
for (const height of [144, 240, 360, 480, 576, 720, 1080, 1440, 2160, 4320]) {
  let result;
  try {
    result = C.analyze({ width: String(Math.round(height * 16 / 9)), height: String(height), fps: '24', profile: 'high', bitrate: '' });
  } catch (error) {
    assert.match(error.message, /^No level in the H\.264 table carries these inputs\./);
    continue;
  }
  const index = C.LEVELS.findIndex((level) => level.name === result.level);
  assert.ok(index >= previousLevel, 'level never falls as the resolution rises (' + height + ' lines)');
  previousLevel = index;
}

// The chosen level fits and the level below does not (unless it is level 1).
for (const [w, h, fps, profile] of [['1920', '1080', '30', 'high'], ['3840', '2160', '60', 'high'],
  ['1280', '720', '50', 'main'], ['720', '480', '29.97', 'baseline'], ['1024', '576', '25', 'high10'],
  ['176', '144', '15', 'baseline'], ['1080', '1920', '30', 'high444']]) {
  const result = C.analyze({ width: w, height: h, fps, profile, bitrate: '' });
  const row = TABLE[C.LEVELS.findIndex((level) => level.name === result.level)];
  assert.deepEqual(refFails(row, result.widthMbs, result.heightMbs, Number(fps), null, profile), [],
    'chosen level carries ' + w + 'x' + h);
  if (result.belowLevel !== null) {
    const below = TABLE[C.LEVELS.findIndex((level) => level.name === result.belowLevel)];
    assert.notDeepEqual(refFails(below, result.widthMbs, result.heightMbs, Number(fps), null, profile), [],
      'the level below is excluded for ' + w + 'x' + h);
    assert.deepEqual(Array.from(result.binding),
      refFails(below, result.widthMbs, result.heightMbs, Number(fps), null, profile),
      'binding constraints for ' + w + 'x' + h);
  } else {
    assert.deepEqual(Array.from(result.binding), []);
  }
  assert.ok(result.dpbFrames >= 1 && result.dpbFrames <= 16, 'DPB frames inside 1..16');
  assert.equal(result.dpbFrames, Math.min(Math.floor(result.maxDpbMbs / result.picture), 16));
  assert.equal(result.maxWholeFps, Math.floor(result.maxMbps / result.picture));
  assert.ok(result.maxWholeFps <= result.maxFps + 1e-9, 'whole frame rate is not above the limit');
}

// The profile factor moves the bitrate ceiling by exactly 1.2, 1.5, 3.6 and 4.8.
for (const profile of ['baseline', 'high', 'high10', 'high422', 'high444']) {
  const result = C.analyze({ width: '1280', height: '720', fps: '30', profile, bitrate: '' });
  const row = TABLE[C.LEVELS.findIndex((level) => level.name === result.level)];
  assert.equal(result.bitrateCeiling * 1000, row[5] * 1000 * TENTHS[profile] / 10, 'ceiling for ' + profile);
}
assert.equal(C.analyze({ width: '1920', height: '1080', fps: '30', profile: 'baseline', bitrate: '' }).bitrateCeiling, 24000);
assert.equal(C.analyze({ width: '1920', height: '1080', fps: '30', profile: 'high', bitrate: '' }).bitrateCeiling, 30000);
assert.equal(C.analyze({ width: '1920', height: '1080', fps: '30', profile: 'high10', bitrate: '' }).bitrateCeiling, 72000);
assert.equal(C.analyze({ width: '1920', height: '1080', fps: '30', profile: 'high422', bitrate: '' }).bitrateCeiling, 96000);

// A bitrate one kbit/s above a level's ceiling pushes the stream to the next level.
const under = C.analyze({ width: '1920', height: '1080', fps: '30', profile: 'high', bitrate: '30000' });
const over = C.analyze({ width: '1920', height: '1080', fps: '30', profile: 'high', bitrate: '30001' });
assert.equal(under.level, '4');
assert.equal(over.level, '4.1');
assert.deepEqual(Array.from(over.binding), ['bitrate']);
assert.equal(C.analyze({ width: '1920', height: '1080', fps: '30', profile: 'baseline', bitrate: '24000' }).level, '4');
assert.equal(C.analyze({ width: '1920', height: '1080', fps: '30', profile: 'baseline', bitrate: '24001' }).level, '4.1');

// Sweep: every combination either matches the reference or is refused for
// having no level, and everything returned stays inside its own level.
let swept = 0;
let refused = 0;
for (const [w, h] of [[16, 16], [160, 120], [320, 240], [640, 360], [720, 480], [854, 480],
  [1024, 576], [1280, 720], [1366, 768], [1600, 900], [1920, 1080], [2048, 1080], [2560, 1440],
  [3840, 2160], [4096, 2160], [7680, 4320], [1080, 1920], [1928, 1088], [1912, 1072], [400, 300],
  [8192, 4320], [16384, 16], [16384, 8640]]) {
  for (const fps of ['23.976', '30', '60']) {
    for (const profile of ['baseline', 'high', 'high10']) {
      for (const bitrate of ['', '0', '8000', '200000']) {
        const input = { width: String(w), height: String(h), fps, profile, bitrate: bitrate === '0' ? '' : bitrate };
        const ref = refLevel(w, h, Number(fps), profile, input.bitrate === '' ? null : Number(bitrate));
        let result = null;
        try {
          result = C.analyze(input);
        } catch (error) {
          assert.match(error.message, /^No level in the H\.264 table carries these inputs\./,
            'sweep refusal message at ' + w + 'x' + h + '@' + fps);
        }
        if (ref === null) {
          assert.equal(result, null, 'refused only when no level carries the stream at ' + w + 'x' + h + '@' + fps);
          refused += 1;
          continue;
        }
        assert.ok(result !== null, 'a level exists for ' + w + 'x' + h + '@' + fps + ' ' + profile);
        assert.equal(result.level, ref.level, 'sweep level at ' + w + 'x' + h + '@' + fps + ' ' + profile);
        assert.equal(result.levelIdc, ref.idc);
        assert.equal(result.picture, ref.picture);
        const row = TABLE[ref.index];
        assert.deepEqual(refFails(row, result.widthMbs, result.heightMbs, Number(fps),
          input.bitrate === '' ? null : Number(bitrate), profile), [], 'sweep stays inside the level');
        assert.equal(result.bitrateCeiling * 1000, row[5] * 1000 * TENTHS[profile] / 10);
        swept += 1;
      }
    }
  }
}
assert.ok(swept > 400, 'the sweep covered the range');
assert.ok(refused > 0, 'the sweep hit combinations that no level carries');

// Formatting and copy text.
assert.equal(C.group(1234567), '1,234,567');
assert.equal(C.group(8160), '8,160');
assert.equal(C.trim(30000), '30,000');
assert.equal(C.trim(921.6), '921.6');
assert.equal(C.trim(76800), '76,800');
assert.equal(C.fmtLevel(base), 'Level 4');
assert.equal(C.fmtResolution(base), '1920 \u00d7 1080');
assert.equal(C.fmtPicture(base), '8,160 (120 \u00d7 68)');
assert.equal(C.fmtLoad(base), '244,800 of 245,760 per second');
assert.equal(C.fmtCeiling(base), 'not checked');
assert.equal(C.fmtMaxFps(base), '30.11 fps');
assert.equal(C.fmtDpb(base), '4 frames');
assert.equal(C.reason(base), 'Level 4 is the lowest level that fits; level 3.2 fails on frame size and frame rate.');
assert.equal(C.reason(C.analyze({ width: '176', height: '144', fps: '15', profile: 'baseline', bitrate: '' })),
  'Level 1 is the lowest level in the table and it already carries these inputs.');
assert.equal(C.copyText(base),
  '1920 \u00d7 1080 at 30 fps with the High profile needs H.264 Level 4 (level_idc 40): 8,160 macroblocks, '
  + '244,800 of 245,760 macroblocks per second, and a bitrate ceiling of 30,000 kbit/s, with the bitrate not checked.');
assert.ok(C.copyText(over).includes('against 30,001 kbit/s entered'));

// Catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug appears exactly once');
const record = matches[0];
assert.equal(catalog.tools.length, 2268, 'catalog total');
assert.equal(record.name, 'H.264 Level Checker');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.added, '2026-11-13T03:40:00Z');
assert.equal(record.testCases.length, 23, 'catalog case count');
assert.ok(record.method.length > 800, 'method documents the model');
assert.ok(record.sources.length >= 3, 'sources are listed');
for (const alias of record.aliases) {
  const clash = catalog.tools.filter((tool) => tool.slug !== slug)
    .some((tool) => tool.name === alias || (tool.aliases || []).includes(alias));
  assert.equal(clash, false, 'alias is unique: ' + alias);
}
assert.equal(catalog.tools.filter((tool) => tool.category === record.category).length, 43, 'Video count');

let goldens = 0;
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    try {
      C.analyze(testCase.input);
      assert.fail(testCase.name + ': expected a refusal');
    } catch (error) {
      assert.equal(error.message, testCase.expected.error, testCase.name);
    }
    continue;
  }
  goldens += 1;
  const result = C.analyze(testCase.input);
  const expected = testCase.expected;
  for (const key of ['level', 'levelIdc', 'widthMbs', 'heightMbs', 'picture', 'maxFs', 'maxMbps',
    'maxDpbMbs', 'maxBr', 'maxWholeFps', 'dpbFrames', 'profileLabel', 'profileIdc', 'belowLevel']) {
    assert.equal(result[key], expected[key], testCase.name + ' ' + key);
  }
  for (const key of ['mbps', 'maxFps', 'bitrateCeiling']) {
    assert.ok(Math.abs(result[key] - expected[key]) <= 1e-6, testCase.name + ' ' + key);
  }
  assert.deepEqual(Array.from(result.binding), expected.binding, testCase.name + ' binding');
  if ('bitrate' in expected) {
    assert.ok(Math.abs(result.bitrate - expected.bitrate) <= 1e-9, testCase.name + ' bitrate');
  }
  // Each golden is also checked against the independent reference.
  const ref = refLevel(Number(testCase.input.width), Number(testCase.input.height),
    Number(testCase.input.fps), testCase.input.profile || 'high',
    testCase.input.bitrate === '' ? null : Number(testCase.input.bitrate));
  assert.equal(ref.level, expected.level, testCase.name + ' reference level');
}
assert.equal(goldens, 11, 'golden case count');

// Page contract: shared chrome, one form, default state, no storage, no
// network, no HTML sinks, 44 px targets, and every element the script looks
// up exists in the markup.
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style\.css">/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/tool-css\/tool-form-[0-9a-f]{8}\.css">/);
assert.equal((html.match(/id="level-form"/g) || []).length, 1);
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('role="alert"'));
for (const id of ['width', 'height', 'fps', 'profile', 'bitrate', 'err', 'out', 'reset', 'level-form']) {
  assert.ok(html.includes('id="' + id + '"'), 'element present: ' + id);
}
assert.match(html, /id="width"[^>]*value="1920"/);
assert.match(html, /id="height"[^>]*value="1080"/);
assert.match(html, /id="fps"[^>]*value="30"/);
assert.match(html, /<option value="high" selected>/);
assert.match(html, /id="bitrate"[^>]*value=""/);
assert.match(html, /\.actions button\{[^}]*min-height:44px/);
assert.match(html, /\.tools button\{[^}]*min-height:44px/);
assert.match(html, /\.field input,\.field select\{min-height:44px\}/);
assert.match(html, /<button type="submit">/);
const lookups = Array.from(html.matchAll(/getElementById\("([a-z-]+)"\)/g)).map((m) => m[1]);
assert.ok(lookups.length >= 8, 'script looks up its controls');
for (const id of new Set(lookups)) {
  assert.ok(new RegExp('id="' + id + '"').test(html), 'getElementById target exists: ' + id);
}
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), 'page stores nothing');
assert.ok(!/https?:\/\//.test(html), 'page references no external URL');
assert.ok(!/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/.test(html), 'page makes no requests');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page uses no HTML sinks');

console.log(slug + ' core: all checks passed (' + record.testCases.length + ' catalog cases, ' + goldens
  + ' golden, ' + swept + ' swept combinations and the profile factor ladder)');
