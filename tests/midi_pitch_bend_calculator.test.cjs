/* MIDI pitch bend: the fourteen-bit message re-derived from its two seven-bit
   bytes, both conversion directions, validation messages, the catalog record and
   the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'midi-pitch-bend-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* mpb-core:start */';
const endMarker = '/* mpb-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MpbCore;', sandbox);
const C = sandbox.module.exports;

const failure = (fn) => {
  try { fn(); } catch (error) { return error.message; }
  return null;
};
const near = (got, expected, label, tolerance = 1e-6) =>
  assert.ok(Math.abs(got - expected) <= tolerance, label + ': got ' + got + ', expected ' + expected);
const run = (input) => C.compute(input);
const pad = (n) => n.toString(16).toUpperCase().padStart(2, '0');

// ---- Independent oracle: build the fourteen-bit position from its two seven-bit
// bytes, then scale it by the bend range over the centre. The reverse keeps the
// same scaling and rounds the position to the nearest whole step.
const CENTRE = 8192;
const MAX_VALUE = 16383;
const oracleSemitones = (value, range) => ((value - CENTRE) * range) / CENTRE;
const oracleValue = (offset, range) => Math.min(MAX_VALUE, Math.max(0, Math.round(CENTRE + (offset / range) * CENTRE)));
const oracleMessage = (value, channel) => {
  const lsb = value & 0x7f;
  const msb = (value >> 7) & 0x7f;
  return { lsb, msb, status: 0xe0 + (channel - 1), text: pad(0xe0 + (channel - 1)) + ' ' + pad(lsb) + ' ' + pad(msb) };
};

// ---- Constants.
assert.equal(C.CENTRE, 8192);
assert.equal(C.MAX_VALUE, 16383);
assert.equal(C.MIN_RANGE, 0.01);
assert.equal(C.MAX_RANGE, 127);

// ---- Golden and boundary cases, each re-derived from the byte oracle.
const cases = [
  ['default half deflection', { mode: 'value', value: '12288', offset: '1', range: '2', channel: '1' }],
  ['twelve semitone range six semitones down', { mode: 'value', value: '4096', offset: '1', range: '12', channel: '1' }],
  ['channel sixteen', { mode: 'value', value: '6144', offset: '1', range: '2', channel: '16' }],
  ['value without a whole least-significant byte', { mode: 'value', value: '12000', offset: '1', range: '2', channel: '1' }],
  ['full down', { mode: 'value', value: '0', offset: '1', range: '2', channel: '1' }],
  ['full up', { mode: 'value', value: '16383', offset: '1', range: '2', channel: '1' }],
  ['centre', { mode: 'value', value: '8192', offset: '1', range: '2', channel: '1' }],
  ['smallest range', { mode: 'value', value: '16383', offset: '1', range: '0.01', channel: '1' }],
  ['largest range', { mode: 'value', value: '16383', offset: '1', range: '127', channel: '1' }],
  ['one semitone up', { mode: 'offset', value: '12288', offset: '1', range: '2', channel: '1' }],
  ['two and a half semitones down is quantised', { mode: 'offset', value: '12288', offset: '-2.5', range: '12', channel: '1' }],
  ['comma decimal offset', { mode: 'offset', value: '12288', offset: '1,5', range: '2', channel: '1' }],
  ['offset at the top of the range clamps', { mode: 'offset', value: '12288', offset: '2', range: '2', channel: '1' }],
  ['offset at the bottom of the range lands on zero', { mode: 'offset', value: '12288', offset: '-2', range: '2', channel: '1' }],
  ['offset from the centre', { mode: 'offset', value: '12288', offset: '0', range: '2', channel: '1' }],
];
for (const [label, input] of cases) {
  const got = run(input);
  const range = Number(input.range);
  const channel = Number(input.channel);
  const expectedValue = input.mode === 'value' ? Number(input.value) : oracleValue(Number(input.offset.replace(',', '.')), range);
  assert.equal(got.value, expectedValue, label + ' value');
  near(got.semitones, oracleSemitones(expectedValue, range), label + ' semitones');
  near(got.cents, oracleSemitones(expectedValue, range) * 100, label + ' cents', 1e-4);
  near(got.ratio, Math.pow(2, oracleSemitones(expectedValue, range) / 12), label + ' ratio');
  const bytes = oracleMessage(expectedValue, channel);
  assert.equal(got.lsb, bytes.lsb, label + ' lsb');
  assert.equal(got.msb, bytes.msb, label + ' msb');
  assert.equal(got.status, bytes.status, label + ' status');
  assert.equal(got.message, bytes.text, label + ' message');
  assert.ok(got.lsb >= 0 && got.lsb < 128 && got.msb >= 0 && got.msb < 128, label + ' seven-bit bytes');
  assert.equal(got.value, got.msb * 128 + got.lsb, label + ' the bytes rebuild the value');
  near(got.resolutionCents, (range * 100) / CENTRE, label + ' one value step');
  assert.ok(got.semitones >= -range - 1e-12 && got.semitones <= range + 1e-12, label + ' stays inside the range');
  if (input.mode === 'offset') {
    const requested = Number(input.offset.replace(',', '.'));
    near(got.requested, requested, label + ' requested offset');
    near(got.quantisationCents, (oracleSemitones(expectedValue, range) - requested) * 100, label + ' quantisation', 1e-4);
    const stepCents = (range * 100) / CENTRE;
    const clampedEdge = Math.abs(requested) >= range - 1e-12;
    assert.ok(Math.abs(got.quantisationCents) <= (clampedEdge ? stepCents : stepCents / 2) + 1e-4,
      label + ' quantised within ' + (clampedEdge ? 'one step at the clamped edge' : 'half a step'));
  } else {
    assert.equal(got.requested, null, label + ' no request to quantise');
    assert.equal(got.quantisationCents, null, label + ' no quantisation');
  }
}

// ---- The named expectations behind the default view.
assert.equal(run({ mode: 'value', value: '12288', offset: '1', range: '2', channel: '1' }).semitones, 1);
assert.equal(run({ mode: 'value', value: '16383', offset: '1', range: '2', channel: '1' }).semitones, 1.999756);
assert.equal(run({ mode: 'value', value: '0', offset: '1', range: '2', channel: '1' }).cents, -200);
assert.equal(run({ mode: 'value', value: '12000', offset: '1', range: '2', channel: '1' }).message, 'E0 60 5D');
assert.equal(run({ mode: 'offset', value: '12288', offset: '-2.5', range: '12', channel: '1' }).value, 6485);
assert.equal(run({ mode: 'offset', value: '12288', offset: '1,5', range: '2', channel: '1' }).value, 14336);
assert.equal(run({ mode: 'value', value: '6144', offset: '1', range: '2', channel: '16' }).message, 'EF 00 30');

// ---- Invariants across the value range: the pitch rises with the value, the
// ratio follows the semitones, and every request comes back within half a step.
for (const range of [0.5, 1, 2, 7, 12, 127]) {
  let previous = -Infinity;
  for (let value = 0; value <= MAX_VALUE; value += 97) {
    const got = run({ mode: 'value', value: String(value), offset: '0', range: String(range), channel: '1' });
    assert.ok(got.semitones > previous, 'the pitch rises with the value at ' + value + ' / ' + range);
    previous = got.semitones;
    const expectedRatio = Math.pow(2, got.semitones / 12);
    assert.ok(Math.abs(got.ratio - expectedRatio) <= expectedRatio * 1e-6, 'ratio at ' + value + ': got ' + got.ratio + ', expected ' + expectedRatio);
    near(got.percent, ((value - CENTRE) / CENTRE) * 100, 'percent at ' + value, 1e-4);
  }
  for (const offset of [-range, -range / 2, -0.25, 0, 0.25, range / 3, range / 2, range]) {
    const rounded = Number(offset.toFixed(2));
    const got = run({ mode: 'offset', value: '0', offset: String(rounded), range: String(range), channel: '1' });
    assert.ok(got.value >= 0 && got.value <= MAX_VALUE, 'the value stays fourteen-bit for ' + rounded);
    near(got.semitones, oracleSemitones(got.value, range), 'round trip ' + rounded + ' / ' + range);
    const step = range / CENTRE;
    const edge = Math.abs(rounded) >= range - 1e-12;
    assert.ok(Math.abs(got.semitones - rounded) <= (edge ? step : step / 2) + 1e-6, 'round trip within a step for ' + rounded + ' / ' + range);
  }
}

// ---- Every channel maps to its own status byte.
for (let channel = 1; channel <= 16; channel += 1) {
  assert.equal(run({ mode: 'value', value: '12288', offset: '1', range: '2', channel: String(channel) }).status, 0xe0 + channel - 1,
    'status byte for channel ' + channel);
}

// ---- Validation: each message names the field that failed.
assert.equal(failure(() => run({ mode: 'mid', value: '12288', offset: '1', range: '2', channel: '1' })),
  'Choose whether to convert a bend value or a pitch offset.');
assert.equal(failure(() => run({ mode: 'value', value: '12288', offset: '1', range: '', channel: '1' })),
  'Enter the pitch bend range in semitones.');
assert.equal(failure(() => run({ mode: 'value', value: '12288', offset: '1', range: 'abc', channel: '1' })),
  'The bend range must be a number of semitones with at most two decimal places, such as 2 or 1.5.');
assert.equal(failure(() => run({ mode: 'value', value: '12288', offset: '1', range: '-2', channel: '1' })),
  'The bend range must be a number of semitones with at most two decimal places, such as 2 or 1.5.');
assert.equal(failure(() => run({ mode: 'value', value: '12288', offset: '1', range: '0', channel: '1' })),
  'The bend range must be between 0.01 and 127 semitones.');
assert.equal(failure(() => run({ mode: 'value', value: '12288', offset: '1', range: '127.01', channel: '1' })),
  'The bend range must be between 0.01 and 127 semitones.');
assert.equal(failure(() => run({ mode: 'value', value: '12288', offset: '1', range: '2', channel: '' })),
  'Enter the MIDI channel.');
assert.equal(failure(() => run({ mode: 'value', value: '12288', offset: '1', range: '2', channel: '0' })),
  'The MIDI channel must be a whole number from 1 to 16.');
assert.equal(failure(() => run({ mode: 'value', value: '12288', offset: '1', range: '2', channel: '1.5' })),
  'The MIDI channel must be a whole number from 1 to 16.');
assert.equal(failure(() => run({ mode: 'value', value: '', offset: '1', range: '2', channel: '1' })),
  'Enter the pitch bend value.');
assert.equal(failure(() => run({ mode: 'value', value: '16384', offset: '1', range: '2', channel: '1' })),
  'The pitch bend value must be a whole number from 0 to 16383.');
assert.equal(failure(() => run({ mode: 'value', value: '-1', offset: '1', range: '2', channel: '1' })),
  'The pitch bend value must be a whole number from 0 to 16383.');
assert.equal(failure(() => run({ mode: 'value', value: '0x40', offset: '1', range: '2', channel: '1' })),
  'The pitch bend value must be a whole number from 0 to 16383.');
assert.equal(failure(() => run({ mode: 'offset', value: '12288', offset: '', range: '2', channel: '1' })),
  'Enter the pitch offset in semitones.');
assert.equal(failure(() => run({ mode: 'offset', value: '12288', offset: '3', range: '2', channel: '1' })),
  'The pitch offset must be within \u00b12 semitones, the bend range.');
assert.equal(failure(() => run({ mode: 'offset', value: '12288', offset: '-2.01', range: '2', channel: '1' })),
  'The pitch offset must be within \u00b12 semitones, the bend range.');
assert.equal(failure(() => run({ mode: 'offset', value: '12288', offset: 'abc', range: '2', channel: '1' })),
  'The pitch offset must be a number of semitones with at most two decimal places, such as -2.5 or 1.75.');
assert.equal(failure(() => run({})), 'Choose whether to convert a bend value or a pitch offset.');
assert.equal(failure(() => run({ mode: 'value', value: '12288', offset: '1', range: '2', channel: '1', junk: 1 })), null,
  'extra keys are ignored');

// ---- The bend range is echoed in the refusal, not a fixed constant.
assert.equal(failure(() => run({ mode: 'offset', value: '12288', offset: '13', range: '12', channel: '1' })),
  'The pitch offset must be within \u00b112 semitones, the bend range.');

// ---- Catalog record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(record.name, 'MIDI Pitch Bend Calculator');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.guidance && record.guidance.length > 80, 'the guidance is recorded');
assert.ok(record.tags.includes('pitch-bend'), 'the pitch bend tag');
assert.ok(record.tags.includes('bend-range'), 'the bend range tag');
assert.ok(record.aliases.some((alias) => /pitch bend calculator/i.test(alias)), 'the pitch bend alias');
assert.ok(Array.isArray(record.sources) && record.sources.length === 1, 'the message format has one source');
assert.equal(record.sources[0].url, 'https://www.midi.org/specifications-old/item/table-1-summary-of-midi-message');
assert.ok(/fourteen-bit/.test(record.sources[0].title), 'the citation names the fourteen-bit value');
assert.ok(record.method.includes('8191/8192'), 'method states the asymmetry of the top of the travel');
assert.ok(record.method.includes('RPN 0'), 'method names the sensitivity register');
assert.ok(record.description.length > 80 && record.description.endsWith('browser.'),
  'the description says the page runs locally');
assert.ok(record.testCases.length >= 20, 'the catalog carries the test cases');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug is unique');
assert.equal(catalog.tools.filter((tool) => tool.name === record.name).length, 1, 'the name is unique');
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  for (const alias of record.aliases) {
    assert.ok(!(tool.aliases || []).includes(alias), 'alias is not taken: ' + alias);
  }
  assert.notEqual(tool.name.toLowerCase(), record.name.toLowerCase(), 'the name is not taken');
  for (const tag of ['pitch-bend', 'bend-range', 'synthesizer', 'controller']) {
    assert.ok(!(tool.tags || []).includes(tag), 'tag is not already taken: ' + tag + ' on ' + tool.slug);
  }
}
assert.equal(catalog.tools.filter((tool) => tool.category === 'Music').length, 56, 'Music count');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2236, 'public tools');

// ---- Replay every case stored in the record.
for (const item of record.testCases) {
  if (item.kind === 'validation') {
    assert.equal(failure(() => run(item.input)), item.expected.error, 'replay ' + item.name);
    continue;
  }
  const got = run(item.input);
  for (const field of ['value', 'semitones', 'cents', 'percent', 'lsb', 'msb', 'status', 'message', 'quantisationCents']) {
    if (item.expected[field] !== undefined) {
      if (typeof item.expected[field] === 'string') {
        assert.equal(got[field], item.expected[field], 'replay ' + item.name + ' ' + field);
      } else {
        near(got[field], item.expected[field], 'replay ' + item.name + ' ' + field, 1e-9);
      }
    }
  }
}

// ---- Page contract.
assert.ok(html.includes('<div id="site-header"></div>'), 'the shared header mount is present');
assert.ok(html.includes('/assets/app.js'), 'the shared shell script is loaded');
assert.ok(html.includes('/assets/style.css'), 'the shared stylesheet is loaded');
assert.ok(!/https?:\/\//.test(html), 'the page makes no third-party request');
assert.ok(!html.includes('\u0000'), 'no NUL bytes');
assert.ok(html.includes('<h1>MIDI Pitch Bend Calculator</h1>'), 'the page heading');
assert.ok(/nothing is uploaded/i.test(html), 'the note stays local');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|requestMIDIAccess/.test(core), 'the core touches no storage, network or MIDI');
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'ids are unique');
for (const control of ['mode', 'value', 'offset', 'range', 'channel']) {
  assert.ok(new RegExp('<label\\b[^>]*\\bfor="' + control + '"').test(html), 'label for ' + control);
  assert.ok(ids.includes(control), 'control id ' + control);
}
for (const id of ['mpb-form', 'value-field', 'offset-field', 'err', 'out', 'facts']) {
  assert.ok(ids.includes(id), 'element id ' + id);
}
const options = [...html.matchAll(/<option value="(\w+)"/g)].map((match) => match[1]);
assert.deepEqual(options, ['value', 'offset'], 'both conversion directions are offered');
assert.ok(html.includes('aria-live="polite"'), 'the result is announced');
assert.equal((html.match(/inputmode=/g) || []).length, 4, 'numeric keyboards on the four text fields');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no external script');

console.log('midi pitch bend calculator: all checks passed');
