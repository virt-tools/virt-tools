/* Beat cut planner: the tempo-to-frame contract, the page markup and the
   catalog record's twenty-two cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'beat-cut-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* beat-cut-core:start */';
const endMarker = '/* beat-cut-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BeatCutCore;', sandbox);
const C = sandbox.module.exports;

const near = (value, expected, tolerance, label) => {
  assert.ok(Math.abs(value - expected) <= tolerance, `${label}: ${value} against ${expected}`);
};
const failure = (payload) => {
  try { C.build(Object.assign({}, C.DEFAULTS, payload)); } catch (error) { return error.message; }
  return null;
};

// ---- Tempo parsing and its bounds.
assert.equal(C.parseBpm('120'), 120);
assert.equal(C.parseBpm(' 128.5 '), 128.5);
assert.equal(C.parseBpm('140.25'), 140.25);
assert.equal(C.parseBpm('20'), C.MIN_BPM);
assert.equal(C.parseBpm('300'), C.MAX_BPM);
assert.equal(failure({ bpm: '' }), 'Enter a tempo in BPM, for example 120.');
assert.equal(failure({ bpm: 'abc' }), 'Tempo must be a number of BPM such as 120 or 128.5; "abc" is not.');
assert.equal(failure({ bpm: '120.123' }), 'Tempo must be a number of BPM such as 120 or 128.5; "120.123" is not.');
assert.equal(failure({ bpm: '19' }), 'Tempo must be from 20 to 300 BPM; "19" is outside that range.');
assert.equal(failure({ bpm: '301' }), 'Tempo must be from 20 to 300 BPM; "301" is outside that range.');
assert.equal(failure({ bpm: '-120' }), 'Tempo must be a number of BPM such as 120 or 128.5; "-120" is not.');

// ---- Meter, frame rate and cut interval parsing.
assert.deepEqual(Array.from(C.METERS), [2, 3, 4, 5, 6, 7, 9, 12]);
assert.equal(C.parseMeter('7'), 7);
assert.equal(failure({ meter: '8' }), 'Choose 2, 3, 4, 5, 6, 7, 9 or 12 beats per bar.');
assert.equal(failure({ meter: '' }), 'Choose 2, 3, 4, 5, 6, 7, 9 or 12 beats per bar.');
assert.deepEqual(Array.from(C.RATES, (rate) => rate.value),
  ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60']);
assert.equal(C.parseRate('29.97').df, true);
assert.equal(C.parseRate('59.94').nom, 60);
assert.equal(C.parseRate('24').df, false);
assert.equal(failure({ rate: '48' }), 'Choose a frame rate from the list.');
assert.equal(failure({ rate: '' }), 'Choose a frame rate from the list.');
assert.deepEqual(Array.from(C.EVERIES), ['beat', 'bar', '2bars', '4bars']);
assert.equal(C.stepBeatsFor('beat', 4), 1);
assert.equal(C.stepBeatsFor('bar', 4), 4);
assert.equal(C.stepBeatsFor('2bars', 3), 6);
assert.equal(C.stepBeatsFor('4bars', 7), 28);
assert.equal(failure({ every: '8bars' }), 'Choose a cut interval of every beat, every bar, every 2 bars or every 4 bars.');

// ---- Offsets and bar counts.
assert.equal(C.parseOffset(''), 0);
assert.equal(C.parseOffset('0'), 0);
assert.equal(C.parseOffset('1.5'), 1.5);
assert.equal(C.parseOffset('0:02'), 2);
assert.equal(C.parseOffset('1:02.5'), 62.5);
assert.equal(C.parseOffset('10:00'), C.MAX_OFFSET);
assert.equal(failure({ offset: '1:60' }), 'The seconds in the first-beat position must be below 60; "1:60" is not a valid time.');
assert.equal(failure({ offset: '601' }), 'The first beat must be within 0:00 to 10:00; "601" is outside that range.');
assert.equal(failure({ offset: '-1' }), 'Enter the first beat as seconds or minutes:seconds, for example 0 or 0:02.5; "-1" is not.');
assert.equal(failure({ offset: 'abc' }), 'Enter the first beat as seconds or minutes:seconds, for example 0 or 0:02.5; "abc" is not.');
assert.equal(C.parseBars('1'), 1);
assert.equal(C.parseBars('64'), 64);
assert.equal(failure({ bars: '0' }), 'Bars must be a whole number from 1 to 64; "0" is outside that range.');
assert.equal(failure({ bars: '65' }), 'Bars must be a whole number from 1 to 64; "65" is outside that range.');
assert.equal(failure({ bars: '4.5' }), 'Bars must be a whole number from 1 to 64.');
assert.equal(failure({ bars: '64', meter: '12', every: 'beat' }),
  'Those settings list 769 cut points, and this page lists at most 240. Choose fewer bars or a coarser cut interval.');

// ---- Timecode: non-drop labels and the standard drop-frame skips.
const rate = (value) => C.RATES.find((item) => item.value === value);
assert.equal(C.framesToTimecode(0, rate('24')), '00:00:00:00');
assert.equal(C.framesToTimecode(23, rate('24')), '00:00:00:23');
assert.equal(C.framesToTimecode(24, rate('24')), '00:00:01:00');
assert.equal(C.framesToTimecode(86400, rate('24')), '01:00:00:00');
assert.equal(C.framesToTimecode(1799, rate('29.97')), '00:00:59;29');
assert.equal(C.framesToTimecode(1800, rate('29.97')), '00:01:00;02');
assert.equal(C.framesToTimecode(17982, rate('29.97')), '00:10:00;00');
assert.equal(C.framesToTimecode(3599, rate('59.94')), '00:00:59;59');
assert.equal(C.framesToTimecode(3600, rate('59.94')), '00:01:00;04');
assert.equal(C.framesToTimecode(35964, rate('59.94')), '00:10:00;00');

// ---- Formatting helpers.
assert.equal(C.fmtNum(2, 3), '2.000');
assert.equal(C.fmtNum(-0.0001, 2), '0.00');
assert.equal(C.fmtMs(500), '500.0 ms');
assert.equal(C.fmtMs(20.833333), '20.8 ms');
assert.equal(C.fmtSignedMs(0), '0.00');
assert.equal(C.fmtSignedMs(3.21), '+3.21');
assert.equal(C.fmtSignedMs(-3.21), '-3.21');
assert.equal(C.fmtFrames(12), '12');
assert.equal(C.fmtFrames(11.25), '11.250');

// ---- The default plan: 120 BPM, 4/4, 24 fps, cuts on every bar.
const base = C.build({});
assert.equal(base.bpm, 120);
assert.equal(base.meter, 4);
assert.equal(base.rate.value, '24');
assert.equal(base.every, 'bar');
assert.equal(base.bars, 8);
near(base.beatSeconds, 0.5, 1e-9, 'beat');
near(base.barSeconds, 2, 1e-9, 'bar');
near(base.framesPerBeat, 12, 1e-9, 'frames per beat');
near(base.framesPerBar, 48, 1e-9, 'frames per bar');
near(base.halfFrameMs, 20.8333, 0.0001, 'half frame');
assert.equal(base.rows.length, 9);
assert.equal(base.rows[0].timecode, '00:00:00:00');
assert.equal(base.rows[8].timecode, '00:00:16:00');
assert.equal(base.rows[8].frame, 384);
assert.equal(base.rows[4].positionText, '5.1');
assert.equal(base.warnings.length, 0);
assert.equal(base.statusKind, 'ok');
assert.equal(base.statusText, 'Cut plan computed');
assert.equal(base.driftText, '0.00 ms');
assert.equal(base.beatText, '500.0 ms');
assert.equal(base.framesPerBeatText, '12 frames');
assert.ok(base.summary.includes('At 120 BPM in 4/4'), 'the tempo and meter are stated');
assert.ok(base.summary.includes('exactly 12 frames per beat'), 'the frame grid is stated');
assert.ok(base.summary.includes('00:00:16:00'), 'the end of the plan is stated');
assert.ok(base.explanation.length >= 6, 'the method is explained');
assert.ok(base.explanation[0].includes('60 / 120 = 500.000 ms'), 'the beat formula is stated');

// ---- Every cut is the nearest whole frame to its exact time, on every case.
for (const payload of [{}, { bpm: '128', every: 'beat' }, { bpm: '97', meter: '6', rate: '50', every: 'beat' },
  { bpm: '140.5', meter: '5', rate: '59.94', offset: '2.25', every: '4bars' },
  { bpm: '174', rate: '29.97', every: '2bars', bars: '12' }]) {
  const result = C.build(payload);
  const fps = result.rate.n / result.rate.d;
  for (const row of result.rows) {
    assert.equal(row.frame, Math.round(row.exactSeconds * fps), 'nearest frame');
    assert.ok(Math.abs(row.frame - row.exactSeconds * fps) <= 0.5 + 1e-9, 'within half a frame');
    near(row.errorMs, (row.frame / fps - row.exactSeconds) * 1000, 0.001, 'row error');
    assert.ok(Math.abs(row.errorMs) <= result.halfFrameMs + 0.001, 'error is bounded by half a frame');
  }
  near(result.framesPerBeat, result.beatSeconds * fps, 1e-4, 'frames per beat identity');
  near(result.framesPerBar, result.framesPerBeat * result.meter, 1e-4, 'frames per bar identity');
}

// ---- A beat that is not a whole number of frames raises the bar-grid caution.
const fast = C.build({ bpm: '128', every: 'beat' });
near(fast.framesPerBeat, 11.25, 1e-9, '128 bpm beat');
near(fast.framesPerBar, 45, 1e-9, '128 bpm bar');
assert.equal(fast.rows.length, 33);
assert.equal(fast.warnings.length, 1);
assert.ok(fast.warnings[0].includes('a beat is 11.250 frames at 24 fps'), 'the beat frames are named');
assert.ok(fast.warnings[0].includes('A bar is exactly 45 frames'), 'the exact bar is named');
assert.equal(fast.statusKind, 'warning');
assert.ok(fast.summary.includes('miss their beat by at most'), 'the quantisation is stated');

// ---- Drop-frame labels and the fixed-spacing drift at 29.97.
const drop = C.build({ bpm: '174', rate: '29.97', every: '2bars', bars: '12' });
assert.equal(drop.rows.length, 7);
assert.ok(drop.rows.every((row) => row.timecode.includes(';')), 'drop-frame labels use a semicolon');
assert.equal(drop.rows[0].timecode, '00:00:00;00');
assert.equal(drop.rows[6].timecode, '00:00:16;16');
assert.equal(drop.stepFramesRounded, 83);
near(drop.fixedDriftMs, 64.876, 0.001, 'fixed-spacing drift');
assert.equal(drop.driftText, '+64.88 ms');
assert.equal(drop.warnings.length, 1);
assert.ok(drop.warnings[0].includes('64.9 ms late'), 'the drift is named');

// ---- A non-frame-aligned offset shifts the whole grid and says so.
const shifted = C.build({ bpm: '90', meter: '3', rate: '25', offset: '1.5', bars: '4', every: 'bar' });
assert.equal(shifted.rows.length, 5);
assert.equal(shifted.rows[0].frame, 38);
assert.equal(shifted.rows[0].timecode, '00:00:01:13');
assert.equal(shifted.rows[0].errorText, '+20.00');
near(shifted.halfFrameMs, 20, 1e-9, 'half frame at 25 fps');
assert.ok(shifted.warnings[0].includes('first beat falls 20.0 ms after its frame'), 'the offset shift is named');
assert.ok(shifted.explanation[5].includes('later than the requested time'), 'the offset shift is explained');

// ---- 23.976 stays on non-drop labels and reports the sub-frame grid.
const slow = C.build({ bpm: '120', rate: '23.976', every: 'bar' });
assert.ok(slow.rows.every((row) => !row.timecode.includes(';')), '23.976 uses non-drop labels');
near(slow.framesPerBeat, 11.988012, 1e-6, '23.976 beat frames');
assert.equal(slow.warnings.length, 1);
assert.ok(slow.warnings[0].includes('neither a beat'), 'a sub-frame bar is a caution');

// ---- Coarser intervals still land on the musical positions.
const fourBars = C.build({ bpm: '140.5', meter: '5', rate: '59.94', offset: '2.25', bars: '6', every: '4bars' });
assert.equal(fourBars.rows.length, 2);
assert.equal(fourBars.rows[0].positionText, '1.1');
assert.equal(fourBars.rows[1].positionText, '5.1');
assert.ok(fourBars.rows[1].timecode.includes(';'), '59.94 uses drop-frame labels');

// ---- Page markup: the documented contract.
for (const id of ['bcp-form', 'in-bpm', 'in-meter', 'in-rate', 'in-offset', 'in-bars', 'in-every',
  'calculate', 'example', 'reset', 'status', 'error', 'summary', 'out-beat', 'out-bar', 'out-fpb',
  'out-fpbar', 'out-half', 'out-drift', 'drift-note', 'rows-body', 'table-caption', 'warnings',
  'explanation', 'limits']) {
  assert.ok(html.includes(`id="${id}"`), 'missing element #' + id);
}
for (const field of ['in-bpm', 'in-meter', 'in-rate', 'in-offset', 'in-bars', 'in-every']) {
  assert.ok(new RegExp(`<label for="${field}">`).test(html), 'missing label for ' + field);
}
assert.ok(/role="status" aria-live="polite"/.test(html), 'the status is announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html));
assert.ok(!/\son(click|change|input|submit|load)=/.test(html), 'no inline event handlers');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|navigator\.sendBeacon/.test(html),
  'the page makes no network or storage calls');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no third-party scripts');
assert.ok(html.includes('<option value="24" selected>'), 'the example starts at 24 fps');
assert.ok(html.includes('<option value="4" selected>'), 'the example starts in 4/4');
assert.ok(html.includes('<option value="bar" selected>'), 'the example starts on the bar');
for (const value of ['23.976', '25', '29.97', '30', '50', '59.94', '60']) {
  assert.ok(html.includes(`<option value="${value}">`), 'frame rate option ' + value);
}
for (const value of ['beat', '2bars', '4bars']) {
  assert.ok(html.includes(`<option value="${value}">`), 'cut interval option ' + value);
}
assert.ok(html.includes('id="in-bpm" name="bpm"'), 'the tempo field is named');
assert.ok(html.includes('@media(max-width:720px)'), 'the layout reflows for phones');
assert.ok(html.includes('min-height:44px'), 'controls keep a 44 px target');
assert.ok(html.includes('scope="col"'), 'table headers are scoped');
assert.ok(html.includes('value="120"'), 'the tempo box starts with the documented example');

// ---- Catalog record and every case in it must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2259, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Beat Cut Planner');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.icon, '\u{1f3ac}');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.description.length < 260, 'description stays short');
assert.ok(record.method.includes('60 / BPM'), 'method states the beat formula');
assert.ok(record.method.includes('nearest whole frame'), 'method states the rounding rule');
assert.ok(record.method.includes('20-300 BPM'), 'method states the bounds');
assert.ok(record.method.includes('does not detect beats'), 'method states the limits');
assert.ok(record.method.includes('no uploads'), 'method states the privacy position');
assert.equal(record.sources.length, 3, 'sources are cited');
assert.ok(record.sources.every((source) => source.title.length > 40), 'sources are described');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.tags.includes('beat-sync'));
assert.ok(record.aliases.includes('BPM to Frames Calculator'));

assert.equal(record.testCases.length, 22, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 11);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 11);
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expected.error, testCase.name);
    continue;
  }
  const result = C.build(testCase.input);
  const expected = testCase.expected;
  near(result.beatSeconds * 1000, expected.beatMs, 0.002, testCase.name + ' beat');
  near(result.barSeconds * 1000, expected.barMs, 0.002, testCase.name + ' bar');
  near(result.framesPerBeat, expected.framesPerBeat, 1e-5, testCase.name + ' frames per beat');
  near(result.framesPerBar, expected.framesPerBar, 1e-5, testCase.name + ' frames per bar');
  near(result.halfFrameMs, expected.halfFrameMs, 1e-3, testCase.name + ' half frame');
  near(result.fixedDriftMs, expected.driftMs, 1e-3, testCase.name + ' drift');
  assert.equal(result.warnings.length, expected.warnings, testCase.name + ' warnings');
  assert.equal(result.rows.length, expected.rowCount, testCase.name + ' row count');
  for (const [index, frame, timecode, errorMs] of expected.cuts) {
    const row = result.rows[index];
    assert.ok(row, testCase.name + ' missing cut ' + index);
    assert.equal(row.index, index, testCase.name + ' cut index');
    assert.equal(row.frame, frame, testCase.name + ' cut frame');
    assert.equal(row.timecode, timecode, testCase.name + ' cut timecode');
    near(row.errorMs, errorMs, 1e-3, testCase.name + ' cut error');
  }
}

console.log(slug + ': ' + record.testCases.length + ' catalog cases and the page contract pass');
