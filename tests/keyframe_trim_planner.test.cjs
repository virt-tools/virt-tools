/* Keyframe-aligned trim planner: drop-frame timecode conversions, the keyframe
   grid invariants, exhaustive boundary checks, the catalog cases and the page
   contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'keyframe-trim-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* ktp-core:start */';
const endMarker = '/* ktp-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = KtpCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const failure = (input) => {
  try { C.analyse(input); } catch (error) { return error.message; }
  return null;
};
const tc = (value, fps) => C.parseTimecode(value, 'In point', fps).frames;

// ---- The exported surface and limits.
assert.deepEqual(plain(Object.keys(C)).sort(), [
  'analyse', 'gopForInterval', 'isDropRate', 'maxFps', 'maxHours', 'maxInterval', 'minFps',
  'minInterval', 'nominalFrames', 'parseFps', 'parseInterval', 'parseTimecode',
  'tableBefore', 'tableRows', 'timecodeFromFrames'
]);
assert.equal(C.minFps, 1);
assert.equal(C.maxFps, 240);
assert.equal(C.minInterval, 0.1);
assert.equal(C.maxInterval, 60);
assert.equal(C.maxHours, 23);
assert.equal(C.tableRows, 5);
assert.equal(C.tableBefore, 2);
assert.equal(C.nominalFrames(23.976), 24);
assert.equal(C.nominalFrames(29.97), 30);
assert.equal(C.nominalFrames(59.94), 60);
assert.equal(C.isDropRate(29.97), true);
assert.equal(C.isDropRate(59.94), true);
assert.equal(C.isDropRate(25), false);
assert.equal(C.gopForInterval(2, 25), 50);
assert.equal(C.gopForInterval(2, 23.976), 48);
assert.equal(C.gopForInterval(2, 29.97), 60);
assert.equal(C.gopForInterval(0.1, 1), 1, 'a GOP is never shorter than one frame');

// ---- Non-drop timecode: frame = (h*3600 + m*60 + s) * nominal + f.
assert.equal(tc('00:00:00:00', 25), 0);
assert.equal(tc('00:00:10:00', 25), 250);
assert.equal(tc('00:00:10:10', 25), 260);
assert.equal(tc('00:00:11:24', 25), 299);
assert.equal(tc('00:00:10:00', 23.976), 240);
assert.equal(tc('00:00:10:00', 29.97), 300);
assert.equal(tc('01:00:00:00', 25), 90000);
assert.equal(C.timecodeFromFrames(0, 25, false), '00:00:00:00');
assert.equal(C.timecodeFromFrames(250, 25, false), '00:00:10:00');
assert.equal(C.timecodeFromFrames(260, 25, false), '00:00:10:10');
assert.equal(C.timecodeFromFrames(299, 25, false), '00:00:11:24');
assert.equal(C.timecodeFromFrames(90000, 25, false), '01:00:00:00');
assert.equal(C.timecodeFromFrames(240, 23.976, false), '00:00:10:00');

// ---- Drop-frame 29.97: two frame numbers are skipped every minute except
// every tenth minute, so 00:01:00;02 is frame 1800 and an hour is 107892 frames.
assert.equal(tc('00:00:59;29', 29.97), 1799);
assert.equal(tc('00:01:00;02', 29.97), 1800);
assert.equal(tc('00:01:00;29', 29.97), 1827);
assert.equal(tc('00:02:00;04', 29.97), 3600);
assert.equal(tc('00:10:00;00', 29.97), 17982);
assert.equal(tc('01:00:00;00', 29.97), 107892);
assert.equal(C.timecodeFromFrames(1799, 29.97, true), '00:00:59;29');
assert.equal(C.timecodeFromFrames(1800, 29.97, true), '00:01:00;02');
assert.equal(C.timecodeFromFrames(17982, 29.97, true), '00:10:00;00');
assert.equal(C.timecodeFromFrames(107892, 29.97, true), '01:00:00;00');

// Round trip every seventh frame of the first two hours, both NTSC rates.
for (let frame = 0; frame <= 215784; frame += 7) {
  const label = C.timecodeFromFrames(frame, 29.97, true);
  assert.equal(tc(label, 29.97), frame, '29.97 round trip at ' + frame + ' (' + label + ')');
}
for (let frame = 0; frame <= 215784; frame += 13) {
  const label = C.timecodeFromFrames(frame, 59.94, true);
  assert.equal(tc(label, 59.94), frame, '59.94 round trip at ' + frame + ' (' + label + ')');
}
assert.equal(tc('00:10:00;00', 59.94), 35964, '59.94 ten minutes');
assert.equal(C.timecodeFromFrames(3600, 59.94, true), '00:01:00;04');

// ---- The default: a forty-frame cut ten frames into a fifty-frame GOP.
const base = { fps: '25', interval: '2', in: '00:00:10:10', out: '00:00:11:24' };
const result = C.analyse(base);
assert.equal(result.gopFrames, 50);
assert.equal(result.gopExact, 50);
assert.equal(result.effectiveInterval, 2);
assert.equal(result.inFrame, 260);
assert.equal(result.outFrame, 299);
assert.equal(result.clipFrames, 40);
assert.equal(result.inTimecode, '00:00:10:10');
assert.equal(result.outTimecode, '00:00:11:24');
assert.equal(result.durationTimecode, '00:00:01:15');
assert.equal(result.keyframeBeforeFrame, 250);
assert.equal(result.keyframeBeforeTc, '00:00:10:00');
assert.equal(result.preroll, 10);
assert.equal(result.smartStartFrame, 250);
assert.equal(result.smartStartTc, '00:00:10:00');
assert.equal(result.smartEndFrame, 300);
assert.equal(result.smartEndTc, '00:00:12:00');
assert.equal(result.smartFrames, 50);
assert.equal(result.keyframesInRange, 1);
assert.equal(result.tail, 0);
assert.equal(result.reencodeFrames, 10);
assert.equal(result.requestedShare, 0.8);
assert.equal(result.keyframesInside, 0);
assert.equal(result.table.length, 5);
assert.deepEqual(plain(result.table), [
  { frame: 150, timecode: '00:00:06:00', offsetFrames: -110, offsetSeconds: -4.4 },
  { frame: 200, timecode: '00:00:08:00', offsetFrames: -60, offsetSeconds: -2.4 },
  { frame: 250, timecode: '00:00:10:00', offsetFrames: -10, offsetSeconds: -0.4 },
  { frame: 300, timecode: '00:00:12:00', offsetFrames: 40, offsetSeconds: 1.6 },
  { frame: 350, timecode: '00:00:14:00', offsetFrames: 90, offsetSeconds: 3.6 }
]);

// ---- A cut that begins on a keyframe needs no preroll; one that ends on the
// last frame of a GOP needs no tail.
const aligned = C.analyse({ ...base, in: '00:00:10:00', out: '00:00:12:00' });
assert.equal(aligned.preroll, 0);
assert.equal(aligned.tail, 49);
assert.equal(aligned.clipFrames, 51);
assert.equal(aligned.keyframesInside, 2);
const flush = C.analyse({ fps: '24', interval: '2', in: '00:00:10:00', out: '00:00:11:23' });
assert.equal(flush.tail, 0);
assert.equal(flush.reencodeFrames, 0);
assert.equal(flush.smartFrames, 48);

// ---- Drop-frame analysis keeps the drop-frame labels.
const ntsc = C.analyse({ fps: '29.97', interval: '2', in: '00:01:00;02', out: '00:02:00;04' });
assert.equal(ntsc.dropFrame, true);
assert.equal(ntsc.gopFrames, 60);
assert.equal(ntsc.inFrame, 1800);
assert.equal(ntsc.outFrame, 3600);
assert.equal(ntsc.clipFrames, 1801);
assert.equal(ntsc.keyframeBeforeTc, '00:01:00;02');
assert.equal(ntsc.smartEndTc, '00:02:02;04');
assert.equal(ntsc.keyframesInside, 31);
assert.equal(ntsc.durationTimecode, '00:01:00:01');

// ---- Invariants over 400 seeded clips: the range is whole GOPs, contains the
// cut, and the handles add up to the frames outside it.
let seed = 20261119;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const rates = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
for (let index = 0; index < 400; index += 1) {
  const fps = rates[Math.floor(rnd() * rates.length)];
  const interval = 0.1 + rnd() * 10;
  const gop = C.gopForInterval(interval, fps);
  const inFrame = Math.floor(rnd() * 300000);
  const outFrame = inFrame + Math.floor(rnd() * 500);
  const answer = C.analyse({
    fps: String(fps),
    interval: String(interval),
    in: C.timecodeFromFrames(inFrame, fps, false),
    out: C.timecodeFromFrames(outFrame, fps, false)
  });
  assert.equal(answer.inFrame, inFrame, 'round trip in');
  assert.equal(answer.outFrame, outFrame, 'round trip out');
  assert.equal(answer.gopFrames, gop);
  assert.equal(answer.smartStartFrame % gop, 0, 'start on a keyframe');
  assert.equal(answer.smartEndFrame % gop, 0, 'end on a keyframe');
  assert.ok(answer.smartStartFrame <= inFrame, 'range starts at or before in');
  assert.ok(answer.smartEndFrame > outFrame, 'range ends after out');
  assert.equal(answer.preroll, inFrame - answer.smartStartFrame);
  assert.equal(answer.tail, answer.smartEndFrame - outFrame - 1);
  assert.equal(answer.preroll + answer.tail, answer.reencodeFrames);
  assert.equal(answer.smartFrames, answer.clipFrames + answer.reencodeFrames);
  assert.ok(answer.preroll >= 0 && answer.preroll < gop, 'preroll inside one GOP');
  assert.ok(answer.tail >= 0 && answer.tail < gop, 'tail inside one GOP');
  assert.equal(answer.keyframesInRange, answer.smartFrames / gop);
  assert.ok(answer.requestedShare > 0 && answer.requestedShare <= 1);
}

// ---- The limits themselves are accepted.
assert.equal(C.analyse({ ...base, fps: '1', interval: '0.1', in: '00:00:10:00', out: '00:00:11:00' }).gopFrames, 1);
assert.equal(C.analyse({ ...base, fps: '240', interval: '60' }).gopFrames, 14400);
assert.equal(C.analyse({ ...base, interval: '0.1' }).gopFrames, 3);
assert.equal(C.analyse({ fps: '25', interval: '60', in: '00:00:00:00', out: '00:00:00:00' }).gopFrames, 1500);
assert.equal(C.analyse({ ...base, in: '23:59:59:24', out: '23:59:59:24' }).inFrame, 2159999);
assert.equal(C.analyse({ ...base, in: '00:00:10:10', out: '00:00:10:10' }).clipFrames, 1);

// ---- Refusals.
assert.equal(failure({ ...base, fps: '' }), 'Frame rate is required.');
assert.equal(failure({ ...base, fps: 'abc' }), 'Frame rate must be a number between 1 and 240 fps.');
assert.equal(failure({ ...base, fps: '0' }), 'Frame rate must be between 1 and 240 fps.');
assert.equal(failure({ ...base, fps: '241' }), 'Frame rate must be between 1 and 240 fps.');
assert.equal(failure({ ...base, interval: '' }), 'Keyframe interval is required.');
assert.equal(failure({ ...base, interval: 'two' }),
  'Keyframe interval must be a number between 0.1 and 60 seconds.');
assert.equal(failure({ ...base, interval: '0.05' }), 'Keyframe interval must be between 0.1 and 60 seconds.');
assert.equal(failure({ ...base, interval: '61' }), 'Keyframe interval must be between 0.1 and 60 seconds.');
assert.equal(failure({ ...base, in: '' }), 'In point is required.');
assert.equal(failure({ ...base, in: '10:00' }), 'In point must look like HH:MM:SS:FF.');
assert.equal(failure({ ...base, in: '00:60:00:00' }), 'In point must look like HH:MM:SS:FF.');
assert.equal(failure({ ...base, in: '24:00:00:00' }), 'Timecode hours must be from 0 to 23.');
assert.equal(failure({ ...base, in: '00:00:10:25' }), 'In point frame must be less than 25 at 25 fps.');
assert.equal(failure({ ...base, out: '' }), 'Out point is required.');
assert.equal(failure({ ...base, out: '00:00:10:00' }), 'The out point must be at or after the in point.');
assert.equal(failure({ ...base, in: '00:00:10;00' }), 'Drop-frame timecode needs 29.97 or 59.94 fps.');
assert.equal(failure({ fps: '29.97', interval: '2', in: '00:01:00;00', out: '00:02:00;04' }),
  'That drop-frame timecode names a frame that does not exist.');
assert.equal(failure({ fps: '29.97', interval: '2', in: '00:01:00;02', out: '00:02:00:00' }),
  'Use the same timecode notation for the in and out points.');

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Keyframe-Aligned Trim Planner');
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
assert.ok(/<h1>Keyframe-Aligned Trim Planner<\/h1>/.test(html), 'heading');
assert.ok(/<form id="trim-form" novalidate>/.test(html), 'form');
for (const id of ['in-fps', 'in-interval', 'in-in', 'in-out', 'err', 'run', 'out', 'chart-wrap',
  'chart-title', 'chart-rows']) {
  assert.ok(html.includes('id="' + id + '"'), 'element id: ' + id);
}
for (const label of ['Frame rate', 'Keyframe interval', 'In point', 'Out point']) {
  assert.ok(html.includes('>' + label + '</label>'), 'label: ' + label);
}
assert.ok(/<button type="submit" id="run">Plan the cut<\/button>/.test(html), 'submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/Nothing is uploaded, stored or fetched/.test(html), 'the note states local only');
assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(html), 'no off-site links or requests');
assert.ok(!/<script[^>]+src="(?!\/assets\/)/.test(html), 'only local scripts');
assert.ok(!/\son(click|input|change|submit|keydown)=/.test(html), 'no inline event handlers');
assert.equal(html.match(/<script/g).length, 3, 'theme init, shared app and the tool script');
assert.ok(/min-height:44px/.test(html), '44px touch targets');
assert.ok(/<caption>/.test(html) && /scope="col"/.test(html), 'table caption and headers');
assert.ok(!/\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), 'no network or storage');
const ids = html.match(/\bid="[^"]+"/g).map((value) => value.slice(4, -1));
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');

console.log('keyframe trim planner: all assertions passed');
