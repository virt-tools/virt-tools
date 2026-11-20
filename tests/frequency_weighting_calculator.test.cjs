/* Frequency weighting: the IEC 61672 analytic A and C curves, the published
   nominal table, the formatter, the parser's refusals, the octave-band rows,
   the catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'frequency-weighting-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* frequency-weighting-core:start */';
const endMarker = '/* frequency-weighting-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = FrequencyWeightingCore;', sandbox);
const C = sandbox.module.exports;

const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' vs ' + expected);
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const failure = (input) => {
  try {
    C.calculate(input);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};

// ---- The reference point: both curves are 0 dB at 1 kHz by construction.
close(C.gainA(1000), 0, 1e-3, 'A(1000) is 0 dB');
close(C.gainC(1000), 0, 1e-3, 'C(1000) is 0 dB');
assert.equal(C.gain(1000, 'Z'), 0, 'Z weighting is flat');
close(C.gainA(1000) - C.gainC(1000), 0, 2e-3, 'the curves meet at 1 kHz');

// ---- Nominal values from a published weighting table (Arup Strutt,
// "Weighting Curves"), third-octave centres from 10 Hz to 20 kHz. The
// standard specifies its analytic functions to within a tolerance, so the
// check uses 0.3 dB rather than exact equality.
const TABLE = [
  [10, -70.4, -14.3], [12.5, -63.4, -11.2], [16, -56.7, -8.5], [20, -50.5, -6.2],
  [25, -44.7, -4.4], [31.5, -39.4, -3.0], [40, -34.6, -2.0], [50, -30.2, -1.3],
  [63, -26.2, -0.8], [80, -22.5, -0.5], [100, -19.1, -0.3], [125, -16.1, -0.2],
  [160, -13.4, -0.1], [200, -10.9, 0.0], [250, -8.6, 0.0], [315, -6.6, 0.0],
  [400, -4.8, 0.0], [500, -3.2, 0.0], [630, -1.9, 0.0], [800, -0.8, 0.0],
  [1000, 0.0, 0.0], [1250, 0.6, 0.0], [1600, 1.0, -0.1], [2000, 1.2, -0.2],
  [2500, 1.3, -0.3], [3150, 1.2, -0.5], [4000, 1.0, -0.8], [5000, 0.5, -1.3],
  [6300, -0.1, -2.0], [8000, -1.1, -3.0], [10000, -2.5, -4.4], [12500, -4.3, -6.2],
  [16000, -6.6, -8.5], [20000, -9.3, -11.2]
];
let worstA = 0;
let worstC = 0;
for (const [frequency, wantA, wantC] of TABLE) {
  worstA = Math.max(worstA, Math.abs(C.gainA(frequency) - wantA));
  worstC = Math.max(worstC, Math.abs(C.gainC(frequency) - wantC));
  close(C.gainA(frequency), wantA, 0.3, 'A at ' + frequency + ' Hz');
  close(C.gainC(frequency), wantC, 0.3, 'C at ' + frequency + ' Hz');
  if (frequency <= 1000) {
    assert.ok(C.gainC(frequency) >= C.gainA(frequency) - 1e-9,
      'below 1 kHz the C curve attenuates least, at ' + frequency + ' Hz');
  } else {
    assert.ok(C.gainA(frequency) >= C.gainC(frequency) - 1e-9,
      'above 1 kHz the A curve reads highest, at ' + frequency + ' Hz');
  }
}
assert.ok(worstA < 0.28 && worstC < 0.15, 'departures stay inside the documented maxima');

// ---- Shape: A cuts the bass hard, lifts slightly around 2-4 kHz, and both
// curves fall away above 10 kHz. C is flat through the midrange.
assert.ok(C.gainA(31.5) < C.gainA(100) && C.gainA(100) < C.gainA(1000), 'A rises through the bass');
assert.ok(C.gainA(2000) > 0 && C.gainA(16000) < -6, 'A peaks in the treble and rolls off');
assert.ok(Math.abs(C.gainC(500)) < 0.05 && Math.abs(C.gainC(1000)) < 0.05, 'C is flat mid-band');
assert.ok(C.gainC(63) < -0.5 && C.gainC(20000) < -10, 'C falls at both ends');
assert.equal(C.gain(250, 'A'), C.gainA(250));
assert.equal(C.gain(250, 'C'), C.gainC(250));
assert.equal(C.gain(250, 'Z'), 0);

// ---- Formatting: one decimal, a sign only on positive gains.
assert.equal(C.formatGain(-8.6748), '-8.7 dB');
assert.equal(C.formatGain(1.2017), '+1.2 dB');
assert.equal(C.formatGain(0), '0.0 dB');
assert.equal(C.formatGain(-0.0024), '0.0 dB');
assert.equal(C.formatDecibel(78), '78.0 dB');
assert.equal(C.formatDecibel(-20), '-20.0 dB');
assert.equal(C.formatWeighted(69.3252, 'A'), '69.3 dB(A)');
assert.equal(C.formatWeighted(78.0024, 'C'), '78.0 dB(C)');
assert.equal(C.formatWeighted(70, 'Z'), '70.0 dB(Z)');
assert.equal(C.formatFrequency(31.5), '31.5 Hz');
assert.equal(C.formatFrequency(250), '250 Hz');
assert.equal(C.formatFrequency(1000), '1 kHz');
assert.equal(C.formatFrequency(1250), '1.25 kHz');
assert.equal(C.formatFrequency(16000), '16 kHz');

// ---- The nearest octave band is chosen logarithmically.
assert.equal(C.nearestBand(250), 250);
assert.equal(C.nearestBand(315), 250);
assert.equal(C.nearestBand(420), 500);
assert.equal(C.nearestBand(1000), 1000);
assert.equal(C.nearestBand(11000), 8000);

// ---- A single band: weighted level is one addition.
const mid = C.calculate({ frequency: '250', level: '78', weighting: 'A' });
close(mid.weighted, 69.325, 1e-3, '78 dB at 250 Hz is 69.3 dB(A)');
close(mid.caDifference, 8.6744, 1e-3, 'C minus A at 250 Hz');
assert.equal(mid.headline, '69.3 dB(A)');
assert.equal(mid.gainText, '-8.7 dB');
assert.equal(mid.summary, '78.0 dB at 250 Hz becomes 69.3 dB(A): the A-curve takes 8.7 dB off.');
assert.match(mid.secondary, /^The C curve reads 78\.0 dB\(C\) and the A curve 69\.3 dB\(A\) here, a difference of \+8\.7 dB\.$/);

const flat = C.calculate({ frequency: '1000', level: '78', weighting: 'Z' });
assert.equal(flat.headline, '78.0 dB(Z)');
assert.equal(flat.summary, '78.0 dB at 1 kHz becomes 78.0 dB(Z): the Z-curve is flat here.');
assert.equal(flat.bandText, '1 kHz');

const zero = C.calculate({ frequency: 250, level: 78, weighting: 'C' });
assert.equal(zero.headline, '78.0 dB(C)', 'numbers are accepted as well as text');

// ---- Refusals.
assert.equal(failure({ frequency: '', level: '78', weighting: 'A' }), 'Enter the frequency, such as 250.');
assert.equal(failure({ frequency: 'two fifty', level: '78', weighting: 'A' }), 'Enter the frequency as a number, such as 250.');
assert.equal(failure({ frequency: '5', level: '78', weighting: 'A' }), 'Frequency must be between 10 and 20000 Hz.');
assert.equal(failure({ frequency: '20001', level: '78', weighting: 'A' }), 'Frequency must be between 10 and 20000 Hz.');
assert.equal(failure({ frequency: '-125', level: '78', weighting: 'A' }), 'Frequency must be between 10 and 20000 Hz.');
assert.equal(failure({ frequency: '250', level: '', weighting: 'A' }), 'Enter the measured level, such as 78.');
assert.equal(failure({ frequency: '250', level: 'loud', weighting: 'A' }), 'Enter the measured level as a number, such as 78.');
assert.equal(failure({ frequency: '250', level: '-51', weighting: 'A' }), 'Level must be between -50 and 194 dB.');
assert.equal(failure({ frequency: '250', level: '195', weighting: 'C' }), 'Level must be between -50 and 194 dB.');
assert.equal(failure({ frequency: '250', level: '78', weighting: 'B' }), 'Choose A, C or Z weighting.');
assert.equal(failure({ frequency: '250', level: '78', weighting: '' }), 'Choose A, C or Z weighting.');
assert.equal(failure({}), 'Enter the frequency, such as 250.');

// ---- A sweep against the analytic model, kept in closed form here.
const ratioA = (f) => {
  const f2 = f * f;
  return (12194 ** 2 * f2 * f2) /
    ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
};
const ratioC = (f) => {
  const f2 = f * f;
  return (12194 ** 2 * f2) / ((f2 + 20.6 ** 2) * (f2 + 12194 ** 2));
};
const aOffset = -20 * Math.log10(ratioA(1000));
const cOffset = -20 * Math.log10(ratioC(1000));
for (let step = 0; step <= 200; step += 1) {
  const frequency = 10 * Math.pow(2000, step / 200);
  close(C.gainA(frequency), 20 * Math.log10(ratioA(frequency)) + aOffset, 1e-9, 'A sweep at ' + frequency);
  close(C.gainC(frequency), 20 * Math.log10(ratioC(frequency)) + cOffset, 1e-9, 'C sweep at ' + frequency);
  const level = -50 + 1.22 * step;
  const result = C.calculate({ frequency, level, weighting: step % 2 ? 'A' : 'C' });
  close(result.weighted, level + result.gain, 1e-9, 'weighted level at ' + frequency);
  close(result.caDifference, result.cGain - result.aGain, 1e-12, 'difference at ' + frequency);
}

// ---- The octave-band rows carry all ten centres and the same core values.
const rows = C.bands();
assert.equal(rows.length, 10);
assert.deepEqual(Array.from(rows, (row) => row.frequency), [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
assert.deepEqual(Array.from(rows, (row) => row.bandText),
  ['31.5 Hz', '63 Hz', '125 Hz', '250 Hz', '500 Hz', '1 kHz', '2 kHz', '4 kHz', '8 kHz', '16 kHz']);
assert.deepEqual(Array.from(rows, (row) => row.aText).slice(0, 3), ['-39.5 dB', '-26.2 dB', '-16.2 dB']);
assert.equal(rows[5].aText, '0.0 dB');
assert.equal(rows[5].cText, '0.0 dB');
for (const row of rows) close(row.aGain, C.gainA(row.frequency), 1e-12, 'row A at ' + row.frequency);

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug appears once');
assert.equal(typeof record.method, 'string', 'method is a plain string');
assert.equal(typeof record.guidance, 'string', 'guidance is a plain string');
assert.equal(record.category, 'Audio');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.sources.length, 4);
for (const source of record.sources) assert.match(source.url, /^https:\/\//);
assert.equal(catalog.tools.filter((tool) => tool.category === 'Audio').length, 53, 'Audio count');
assert.equal(catalog.tools.length, 2430, 'catalog total');

const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 6, validation: 9 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = plain(C.calculate(testCase.input));
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') {
      close(actual[key], value, 1e-6 * Math.max(1, Math.abs(value)), testCase.name + ': ' + key);
    } else {
      assert.equal(actual[key], value, testCase.name + ': ' + key);
    }
  }
}

// ---- Uniqueness across the catalog: slug, name and aliases stay distinct.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
for (const alias of record.aliases) {
  const owners = catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase()));
  assert.deepEqual(owners.map((tool) => tool.slug), [slug], 'alias is unique: ' + alias);
}
for (const tag of record.tags) assert.ok(tag.length > 1);

// ---- Page contract: one self-contained page on the shared shell.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Frequency Weighting Calculator<\/h1>/);
assert.match(html, /<form id="fw-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label for="/g) || []).length, 3, 'every control is labelled');
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.match(html, /<option value="A" selected>A/, 'the markup opens on the A weighting');
assert.match(html, /id="frequency"[^>]*value="250"/, 'the default frequency is in the markup');
assert.match(html, /id="level"[^>]*value="78"/, 'the default level is in the markup');
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(/.test(html), 'no network calls');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is sent or stored/i, 'the privacy note stays on the page');
assert.equal((html.match(/\/\* frequency-weighting-core:start \*\//g) || []).length, 1);

// Every id the script reaches for exists in the markup.
for (const id of html.match(/getElementById\("([^"]+)"\)/g) || []) {
  const name = id.slice(16, -2);
  assert.ok(html.includes('id="' + name + '"'), 'the page defines #' + name);
}

console.log('frequency-weighting-calculator: analytic A and C curves, ' + TABLE.length +
  ' published table rows, formatter, refusals, 10 octave bands, ' + record.testCases.length +
  ' catalog cases, uniqueness and page contract OK');
