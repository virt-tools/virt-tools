/* Regression checks for the video scan format timing calculator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'video-scan-format-timing-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* scan-timing-core:start */');
const end = html.indexOf('/* scan-timing-core:end */');
assert.ok(start > -1 && end > start, 'scan timing core markers missing');
const core = html.slice(start, end + '/* scan-timing-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ScanTimingCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-6) => {
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= eps * scale,
    `${label}: expected ${expected}, got ${actual}`);
};
const run = (format, clock) => C.calculate({ format, clock: String(clock) });
const refuses = (input, pattern) => {
  assert.throws(() => C.calculate(input), pattern);
};

// ---- The format table agrees with the standards it cites.
// Total lines, samples per total line and clock, typed here from BT.601 Table 3,
// BT.709 items 5.2/5.6/5.8, EBU Tech 3299 Table 1 and TI SNLA232 Table 1.
const PUBLISHED = {
  '525i/59.94': [525, 858, 13.5, 720, 486],
  '625i/50': [625, 864, 13.5, 720, 576],
  '720p/50': [750, 1980, 74.25, 1280, 720],
  '720p/59.94': [750, 1650, 74.25 / 1.001, 1280, 720],
  '720p/60': [750, 1650, 74.25, 1280, 720],
  '1080i/50': [1125, 2640, 74.25, 1920, 1080],
  '1080i/59.94': [1125, 2200, 74.25 / 1.001, 1920, 1080],
  '1080i/60': [1125, 2200, 74.25, 1920, 1080],
  '1080p/23.98': [1125, 2750, 74.25 / 1.001, 1920, 1080],
  '1080p/24': [1125, 2750, 74.25, 1920, 1080],
  '1080p/25': [1125, 2640, 74.25, 1920, 1080],
  '1080p/29.97': [1125, 2200, 74.25 / 1.001, 1920, 1080],
  '1080p/30': [1125, 2200, 74.25, 1920, 1080],
  '1080p/50': [1125, 2640, 148.5, 1920, 1080],
  '1080p/59.94': [1125, 2200, 148.5 / 1.001, 1920, 1080],
  '1080p/60': [1125, 2200, 148.5, 1920, 1080]
};
assert.equal(C.FORMATS.length, Object.keys(PUBLISHED).length, 'format count');
for (const format of C.FORMATS) {
  const published = PUBLISHED[format.label];
  assert.ok(published, `unexpected format ${format.label}`);
  const [lines, samples, clock, width, height] = published;
  assert.equal(format.lines, lines, `${format.label} total lines`);
  assert.equal(format.samples, samples, `${format.label} samples per line`);
  near(format.clock, clock, `${format.label} clock`, 1e-12);
  assert.equal(format.width, width, `${format.label} active samples`);
  assert.equal(format.height, height, `${format.label} active lines`);
  assert.ok(format.interlaced === format.label.includes('i/'), `${format.label} interlace flag`);

  // The page's four counts must reproduce the rate its own label states: the
  // clock over the samples per line over the total lines.
  const stated = Number(format.label.split('/')[1]);
  const expectedFrame = format.interlaced ? stated / 2 : stated;
  const derived = format.clock * 1e6 / (format.samples * format.lines);
  // The label rounds to two decimals ("23.98" for 24000/1001), so allow half of
  // that last published decimal plus a little float slack.
  assert.ok(Math.abs(derived - expectedFrame) <= 0.005 + expectedFrame * 2e-5,
    `${format.label} rate from its own counts: expected ${expectedFrame}, got ${derived}`);
}

// Every format keeps the active picture inside the raster and the standard's clock.
for (const format of C.FORMATS) {
  const result = C.calculate({ format: format.key, clock: String(format.clock) });
  assert.ok(result.activeSamples < result.samples, `${format.label} has blanking samples`);
  assert.ok(result.activeLines < result.lines, `${format.label} has blanking lines`);
  near(result.activeSharePercent, result.width * result.height / (result.samples * result.lines) * 100,
    `${format.label} active share`);
  near(result.samplesPerFrame, result.samples * result.lines, `${format.label} samples per frame`);
  assert.ok(result.activeSharePercent > 60 && result.activeSharePercent < 90,
    `${format.label} active share is plausible: ${result.activeSharePercent}`);
  near(result.driftPercent, 0, `${format.label} nominal clock drift`);
}

// ---- Published timings.
// 1080p/25: 74.25 MHz over 2,640 samples is a 28.125 kHz line of 35.556 us,
// 25.859 us of which is the 1,920 active samples.
const p25 = run('1080p25', '74.250');
assert.equal(p25.samples, 2640);
assert.equal(p25.blankingSamples, 720);
assert.equal(p25.lines, 1125);
assert.equal(p25.blankingLines, 45);
near(p25.lineRate, 28125, '1080p25 line rate');
near(p25.linePeriodUs, 35.55555555555556, '1080p25 line period');
near(p25.activeLineUs, 25.858585858585858, '1080p25 active line');
near(p25.blankingUs, 9.696969696969697, '1080p25 blanking');
near(p25.frameRate, 25, '1080p25 frame rate');
near(p25.framePeriodMs, 40, '1080p25 frame period');
assert.equal(p25.fieldRate, null);
near(p25.activeSharePercent, 69.81818181818183, '1080p25 active share');

// 720p/50: 1,980 samples of a 26.667 us line, 700 of them blanking.
const p720 = run('720p50', '74.250');
assert.equal(p720.samples, 1980);
assert.equal(p720.blankingSamples, 700);
near(p720.lineRate, 37500, '720p50 line rate');
near(p720.linePeriodUs, 26.666666666666668, '720p50 line period');
near(p720.activeLineUs, 17.23905723905724, '720p50 active line');
near(p720.frameRate, 50, '720p50 frame rate');
near(p720.activeSharePercent, 62.06060606060606, '720p50 active share');

// 525i/59.94: 13.5 MHz over 858 samples is a 63.556 us line at 29.97 frames.
const sd = run('525i5994', '13.500');
assert.equal(sd.samples, 858);
assert.equal(sd.blankingSamples, 138);
near(sd.lineRate, 15734.265734265735, '525i line rate');
near(sd.linePeriodUs, 63.55555555555555, '525i line period');
near(sd.activeLineUs, 53.333333333333336, '525i active line');
near(sd.frameRate, 29.97002997002997, '525i frame rate');
near(sd.fieldRate, 59.94005994005994, '525i field rate');
near(sd.activeSharePercent, 77.68231768231769, '525i active share');

// 625i/50 is an exact 15.625 kHz line and 64 us period.
const pal = run('625i50', '13.5');
assert.equal(pal.samples, 864);
near(pal.lineRate, 15625, '625i line rate');
near(pal.linePeriodUs, 64, '625i line period');
near(pal.frameRate, 25, '625i frame rate');
near(pal.fieldRate, 50, '625i field rate');
near(pal.activeSharePercent, 76.8, '625i active share');

// 1080p/24 fills the same 74.25 MHz clock with 2,750 samples.
const p24 = run('1080p24', '74.250');
assert.equal(p24.samples, 2750);
near(p24.lineRate, 27000, '1080p24 line rate');
near(p24.linePeriodUs, 37.03703703703704, '1080p24 line period');
near(p24.frameRate, 24, '1080p24 frame rate');
near(p24.activeSharePercent, 67.02545454545455, '1080p24 active share');

// 1080p/60 doubles the clock and keeps 2,200 samples per line.
const p60 = run('1080p60', '148.500');
assert.equal(p60.samples, 2200);
near(p60.lineRate, 67500, '1080p60 line rate');
near(p60.linePeriodUs, 14.814814814814815, '1080p60 line period');
near(p60.activeLineUs, 12.929292929292929, '1080p60 active line');
near(p60.frameRate, 60, '1080p60 frame rate');
near(p60.activeSharePercent, 83.78181818181818, '1080p60 active share');

// 1080i/59.94 doubles 29.97 to a 59.94 Hz field rate.
const i60 = run('1080i5994', '74.176');
near(i60.frameRate, 29.970101010101015, '1080i frame rate');
near(i60.fieldRate, 59.94020202020203, '1080i field rate');

// ---- Measured clock: the rates follow it and the drift is reported.
const doubled = run('1080p25', '148.500');
near(doubled.frameRate, 50, 'double clock doubles the frame rate');
near(doubled.linePeriodUs, p25.linePeriodUs / 2, 'double clock halves the line period');
near(doubled.driftPercent, 100, 'double clock drift');
assert.ok(doubled.lineRate > p25.lineRate, 'line rate follows the clock');

const slow = run('1080p25', '37.125');
near(slow.frameRate, 12.5, 'half clock halves the frame rate');
near(slow.driftPercent, -50, 'half clock drift is negative');
assert.ok(slow.driftPercent < 0);

const rounded = run('1080p2997', '74.176');
assert.ok(rounded.driftPercent > 0, '74.176 is the 1.001 clock rounded up');
assert.ok(Math.abs(rounded.driftPercent) < 0.001, 'three decimals of the 1.001 clock is a tiny drift');
assert.ok(rounded.frameRate < 29.9702 && rounded.frameRate > 29.9700, 'the derived rate stays 29.97');

// The limits are exposed so the page and the tests agree on them.
assert.equal(C.LIMITS.clock.join(','), '1,1000,MHz');

// ---- Refusals: the clock field is the only free entry.
refuses({ format: '1080p25', clock: '' }, /^Error: Pixel clock is required\.$/);
refuses({ format: '1080p25', clock: '   ' }, /^Error: Pixel clock is required\.$/);
refuses({ format: '1080p25', clock: 'sixty' }, /^Error: Pixel clock must be a number in MHz\.$/);
refuses({ format: '1080p25', clock: '74.25.1' }, /^Error: Pixel clock must be a number in MHz\.$/);
refuses({ format: '1080p25', clock: '0' }, /^Error: Pixel clock must be from 1 to 1000 MHz\.$/);
refuses({ format: '1080p25', clock: '-1' }, /^Error: Pixel clock must be from 1 to 1000 MHz\.$/);
refuses({ format: '1080p25', clock: '1000.5' }, /^Error: Pixel clock must be from 1 to 1000 MHz\.$/);
refuses({ format: 'ntsc', clock: '13.5' }, /^Error: Choose a scan format from the list\.$/);
refuses({ format: '', clock: '13.5' }, /^Error: Choose a scan format from the list\.$/);
refuses({ clock: '13.5' }, /^Error: Choose a scan format from the list\.$/);

// A label and a key both select the format, and the nominal clock is kept.
assert.equal(C.normalise({ format: '1080p/25', clock: ' 74.25 ' }).format.key, '1080p25');
assert.equal(C.normalise({ format: '1080p25', clock: 74.25 }).clock, 74.25);

// ---- Catalog record, totals, and every case stored in the record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2156, 'public tools');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Video Scan Format Timing Calculator');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(Array.isArray(record.sources) && record.sources.length >= 4, 'sources present');
for (const source of ['BT.601', 'BT.709', 'tech3299', 'snla232']) {
  assert.ok(record.sources.some((entry) => (entry.title + (entry.url || '')).includes(source)),
    `the ${source} reference is cited`);
}
assert.ok(typeof record.method === 'string' && record.method.length > 500, 'method documented');
assert.ok(Array.isArray(record.aliases) && record.aliases.length >= 6, 'aliases present');
assert.ok(Array.isArray(record.tags) && record.tags.length >= 6, 'tags present');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags unique');
assert.ok(record.description.length > 80, 'description present');
assert.equal(record.testCases.length, 16, 'catalog cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 5,
  'validation cases');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug unique');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Video').length, 52, 'Video count');
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.ok(!record.aliases.map((alias) => alias.toLowerCase()).includes(other.name.toLowerCase()),
    `alias collides with ${other.slug}`);
  assert.ok(other.name !== record.name, `name collides with ${other.slug}`);
}

// Catalog expectations are published at display precision, so allow half a unit
// of the last decimal plus float slack and nothing looser.
const closeTo = (actual, expected, label) => {
  const text = String(expected);
  const decimals = text.includes('.') ? text.split('.')[1].length : 0;
  const tolerance = 0.5 * Math.pow(10, -decimals) + Math.abs(expected) * 1e-9;
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`);
};
for (const testCase of record.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(() => C.calculate(testCase.input), (error) => {
      assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
      return true;
    }, `${label}: expected a refusal`);
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const [field, value] of Object.entries(testCase.expected)) {
    if (value === null) {
      assert.equal(result[field], null, `${label}: ${field} should be null`);
      continue;
    }
    assert.ok(typeof result[field] === 'number', `${label}: ${field} should be a number`);
    closeTo(result[field], value, `${label}: ${field}`);
  }
}

// ---- Page contract: local-only, keyboard-submittable, one form.
assert.ok(html.includes('id="timing-form"'), 'form present');
assert.ok(html.includes('id="in-format"') && html.includes('id="in-clock"'), 'inputs present');
assert.ok(!html.includes('fetch(') && !html.includes('XMLHttpRequest'), 'no network calls');
assert.ok(!/https?:\/\//.test(html.replace(/<script src="[^"]*"><\/script>/g, '')),
  'no external URLs in the page');
assert.equal((html.match(/<script src="\/assets\/theme-init\.js"><\/script>/g) || []).length, 1,
  'theme init once');
assert.equal((html.match(/<script src="\/assets\/app\.js"><\/script>/g) || []).length, 1, 'app shell once');
assert.ok(html.includes('<button type="submit">'), 'submit button present');

console.log('video scan format timing calculator: all assertions passed');
