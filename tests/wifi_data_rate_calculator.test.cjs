/* Wi-Fi data rate: the vendor MCS tables, the subcarrier and symbol-time
   model, the undefined 802.11ac combinations, goodput and airtime identities,
   refused inputs, randomised sweeps, catalogue replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'wifi-data-rate-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* wdr-core:start */';
const endMarker = '/* wdr-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = WifiRateCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const compute = (settings) => plain(C.calculate(settings));
const failure = (settings) => {
  try { compute(settings); } catch (error) { return error.message; }
  return null;
};
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} is not within ${tolerance} of ${expected}`);
};
const show = (value) => Math.round(value * 10 + 1e-7) / 10;
const link = (standard, width, mcs, streams, gi, extra) =>
  Object.assign({ standard: standard, width: String(width), mcs: String(mcs),
    streams: String(streams), gi: String(gi) }, extra || {});

// ---- The vendor tables: 802.11n MCS parameters printed by the H3C radio
// management manual and the SCALANCE W700 reference manual, 802.11ac VHT-MCS
// parameters from the same manuals, and the 802.11ax HE-MCS table with its
// 0.8, 1.6 and 3.2 microsecond guard intervals.
const published = [
  // 802.11n, 20 MHz, one stream
  ['ht', 20, 0, 1, 800, 6.5], ['ht', 20, 1, 1, 800, 13], ['ht', 20, 2, 1, 800, 19.5],
  ['ht', 20, 3, 1, 800, 26], ['ht', 20, 4, 1, 800, 39], ['ht', 20, 5, 1, 800, 52],
  ['ht', 20, 6, 1, 800, 58.5], ['ht', 20, 7, 1, 800, 65],
  ['ht', 20, 7, 1, 400, 72.2], ['ht', 20, 0, 1, 400, 7.2], ['ht', 20, 6, 1, 400, 65],
  // 802.11n, 40 MHz
  ['ht', 40, 7, 1, 800, 135], ['ht', 40, 7, 1, 400, 150], ['ht', 40, 0, 1, 800, 13.5],
  ['ht', 40, 7, 2, 800, 270], ['ht', 40, 7, 2, 400, 300], ['ht', 40, 5, 3, 800, 324],
  ['ht', 40, 7, 4, 800, 540], ['ht', 40, 7, 4, 400, 600],
  ['ht', 20, 7, 4, 800, 260], ['ht', 20, 7, 4, 400, 288.9],
  // 802.11ac
  ['vht', 20, 0, 1, 800, 6.5], ['vht', 20, 8, 1, 800, 78], ['vht', 20, 8, 1, 400, 86.7],
  ['vht', 40, 9, 1, 800, 180], ['vht', 40, 9, 1, 400, 200],
  ['vht', 80, 0, 1, 800, 29.3], ['vht', 80, 0, 1, 400, 32.5],
  ['vht', 80, 5, 1, 800, 234], ['vht', 80, 6, 1, 800, 263.3],
  ['vht', 80, 9, 1, 800, 390], ['vht', 80, 9, 1, 400, 433.3],
  ['vht', 80, 9, 2, 400, 866.7], ['vht', 80, 9, 4, 400, 1733.3],
  ['vht', 160, 9, 1, 800, 780], ['vht', 160, 9, 1, 400, 866.7],
  // 802.11ax, 20 MHz, one stream, all three guard intervals
  ['he', 20, 0, 1, 800, 8.6], ['he', 20, 0, 1, 1600, 8.1], ['he', 20, 0, 1, 3200, 7.3],
  ['he', 20, 7, 1, 800, 86], ['he', 20, 7, 1, 1600, 81.3], ['he', 20, 7, 1, 3200, 73.1],
  ['he', 20, 10, 1, 800, 129], ['he', 20, 10, 1, 1600, 121.9], ['he', 20, 10, 1, 3200, 109.7],
  ['he', 20, 11, 1, 800, 143.4], ['he', 20, 11, 1, 1600, 135.4], ['he', 20, 11, 1, 3200, 121.9],
  ['he', 20, 11, 2, 800, 286.8], ['he', 20, 11, 2, 3200, 243.8],
  // 802.11ax, wider channels
  ['he', 40, 11, 1, 800, 286.8], ['he', 40, 11, 1, 1600, 270.8], ['he', 40, 11, 1, 3200, 243.8],
  ['he', 80, 0, 1, 800, 36], ['he', 80, 0, 1, 1600, 34], ['he', 80, 0, 1, 3200, 30.6],
  ['he', 80, 11, 1, 800, 600.5], ['he', 80, 11, 1, 1600, 567.1], ['he', 80, 11, 1, 3200, 510.4],
  ['he', 80, 9, 2, 800, 960.8], ['he', 80, 9, 2, 3200, 816.7],
  ['he', 160, 11, 1, 800, 1201], ['he', 160, 11, 1, 1600, 1134.3], ['he', 160, 11, 1, 3200, 1020.8],
  ['he', 160, 11, 4, 800, 4803.9], ['he', 160, 11, 8, 800, 9607.8],
];
for (const [standard, width, mcs, streams, gi, expected] of published) {
  const result = compute(link(standard, width, mcs, streams, gi));
  assert.equal(show(result.rateMbps), expected,
    `${standard} ${width} MHz MCS ${mcs} ${streams}ss ${gi} ns should read ${expected} Mbps`);
}

// ---- The model itself: data subcarriers times bits times coding, divided by
// the symbol time, times the streams.
const tones = [[1, 1, 2], [2, 1, 2], [2, 3, 4], [4, 1, 2], [4, 3, 4], [6, 2, 3],
  [6, 3, 4], [6, 5, 6], [8, 3, 4], [8, 5, 6], [10, 3, 4], [10, 5, 6]];
const carriers = { ht: { 20: 52, 40: 108 }, vht: { 20: 52, 40: 108, 80: 234, 160: 468 },
  he: { 20: 234, 40: 468, 80: 980, 160: 1960 } };
const bases = { ht: 3.2, vht: 3.2, he: 12.8 };
for (const standard of ['ht', 'vht', 'he']) {
  const spec = C.STANDARDS[standard];
  for (const width of spec.widths) {
    for (let mcs = 0; mcs <= spec.maxMcs; mcs += 1) {
      for (const streams of [1, spec.maxStreams]) {
        for (const gi of spec.gis) {
          const message = failure(link(standard, width, mcs, streams, gi));
          if (message) {
            assert.equal(standard, 'vht', 'only 802.11ac leaves combinations undefined');
            continue;
          }
          const result = compute(link(standard, width, mcs, streams, gi));
          const tone = tones[mcs];
          const symbol = bases[standard] + gi / 1000;
          const perStream = carriers[standard][width] * tone[0] * tone[1] / tone[2] / symbol;
          close(result.subcarriers, carriers[standard][width], 0, 'subcarriers');
          close(result.bitsPerSymbol, perStream * streams * symbol, 1e-6, 'bits per symbol');
          close(result.symbolUs, symbol, 1e-9, 'symbol time');
          close(result.perStreamMbps, perStream, 1e-9, 'one stream');
          close(result.rateMbps, perStream * streams, 1e-6, 'link rate');
          close(result.goodputMbps, result.rateMbps * result.efficiency / 100, 1e-6, 'goodput');
          close(result.airtimePercent, result.demand / result.goodputMbps * 100, 1e-6, 'airtime');
          assert.equal(result.streamsFit, Math.floor(result.budget / 100 * result.goodputMbps / result.demand),
            'streams that fit the airtime budget');
        }
      }
    }
  }
}

// ---- A shorter symbol carries a proportionally higher rate at the same MCS.
const longHt = compute(link('ht', 20, 7, 1, 800));
const shortHt = compute(link('ht', 20, 7, 1, 400));
close(shortHt.rateMbps / longHt.rateMbps, 4 / 3.6, 1e-9, 'the short guard interval is 4 / 3.6 faster');
const longHe = compute(link('he', 80, 11, 1, 800));
const mediumHe = compute(link('he', 80, 11, 1, 1600));
const longGiHe = compute(link('he', 80, 11, 1, 3200));
close(mediumHe.rateMbps / longHe.rateMbps, 13.6 / 14.4, 1e-9, 'the 1.6 us interval scales with the symbol');
close(longGiHe.rateMbps / longHe.rateMbps, 13.6 / 16, 1e-9, 'the 3.2 us interval scales with the symbol');

// ---- Doubling the width, the streams or the modulation index raises the rate.
assert.ok(compute(link('vht', 80, 5, 1, 800)).rateMbps > compute(link('vht', 40, 5, 1, 800)).rateMbps * 2 - 1e-9,
  '80 MHz is more than twice 40 MHz at the same index');
assert.ok(compute(link('he', 20, 11, 1, 800)).rateMbps > compute(link('he', 20, 9, 1, 800)).rateMbps,
  '1024-QAM beats 256-QAM');
close(compute(link('he', 80, 11, 4, 800)).rateMbps, 4 * compute(link('he', 80, 11, 1, 800)).rateMbps,
  1e-6, 'four streams are four times one stream');

// ---- 802.11n encodes the stream count in the MCS index, the others do not.
assert.equal(compute(link('ht', 20, 7, 1, 800)).htIndex, 7, 'one stream stays MCS 7');
assert.equal(compute(link('ht', 20, 7, 2, 800)).htIndex, 15, 'two streams read MCS 15');
assert.equal(compute(link('ht', 40, 0, 4, 800)).htIndex, 24, 'four streams start at MCS 24');
assert.equal(compute(link('vht', 80, 9, 3, 400)).htIndex, null, 'no 802.11n index outside 802.11n');
assert.equal(compute(link('he', 20, 11, 1, 800)).htIndex, null, 'no 802.11n index outside 802.11n');

// ---- The combinations 802.11ac leaves undefined are refused, and the nearest
// defined neighbours work.
const undefined = [[20, 9, 1], [20, 9, 2], [20, 9, 4], [20, 9, 5], [20, 9, 7], [20, 9, 8],
  [80, 6, 3], [80, 6, 7], [80, 9, 6], [160, 9, 3]];
for (const [width, mcs, streams] of undefined) {
  assert.equal(failure(link('vht', width, mcs, streams, 800)),
    '802.11ac does not define MCS ' + mcs + ' at ' + width + ' MHz with ' + streams
      + ' spatial ' + (streams === 1 ? 'stream' : 'streams')
      + '. Choose another MCS index, channel width or stream count.',
    `MCS ${mcs} at ${width} MHz with ${streams} streams is undefined`);
}
assert.equal(failure(link('vht', 20, 9, 3, 800)), null, 'MCS 9 at 20 MHz with three streams is defined');
assert.equal(failure(link('vht', 20, 9, 6, 800)), null, 'MCS 9 at 20 MHz with six streams is defined');
assert.equal(failure(link('vht', 40, 9, 1, 800)), null, 'MCS 9 at 40 MHz is defined');
assert.equal(failure(link('vht', 80, 6, 2, 800)), null, 'MCS 6 at 80 MHz with two streams is defined');
assert.equal(failure(link('vht', 160, 9, 2, 800)), null, 'MCS 9 at 160 MHz with two streams is defined');

// ---- Goodput and airtime follow the efficiency, the demand and the budget.
const base = compute(link('vht', 80, 9, 1, 400, { efficiency: '65', demand: '25', budget: '80' }));
close(base.goodputMbps, base.rateMbps * 0.65, 1e-6, 'goodput at 65 percent');
assert.equal(base.streamsFit, Math.floor(0.8 * base.goodputMbps / 25), 'streams inside the budget');
const half = compute(link('vht', 80, 9, 1, 400, { efficiency: '50', demand: '25', budget: '80' }));
close(half.goodputMbps, base.goodputMbps * 50 / 65, 1e-6, 'a lower efficiency lowers the goodput');
assert.ok(half.airtimePercent > base.airtimePercent, 'a lower efficiency costs more airtime');
const tight = compute(link('vht', 80, 9, 1, 400, { efficiency: '65', demand: '25', budget: '10' }));
assert.ok(tight.streamsFit < base.streamsFit, 'a smaller budget carries fewer streams');
assert.equal(compute(link('he', 20, 0, 1, 3200, { efficiency: '10', demand: '2000', budget: '10' })).streamsFit, 0,
  'a demand above the goodput carries no stream');
assert.equal(compute(link('he', 20, 11, 1, 800, { demand: '0.1', budget: '100' })).streamsFit,
  Math.floor(100 / 100 * compute(link('he', 20, 11, 1, 800, { demand: '0.1', budget: '100' })).goodputMbps / 0.1),
  'the whole channel carries the smallest demand');

// ---- Boundaries the page accepts.
assert.equal(compute(link('he', 20, 0, 1, 3200, { efficiency: '10', demand: '0.1', budget: '10' })).mcs, 0,
  'the smallest 802.11ax link');
assert.equal(compute(link('he', 160, 11, 8, 800, { efficiency: '95', demand: '2000', budget: '100' })).streams, 8,
  'the widest 802.11ax link');
assert.equal(show(compute(link('he', 160, 11, 8, 800)).rateMbps), 9607.8, 'the fastest 802.11ax link');
assert.equal(compute(link('ht', 40, 0, 4, 400, { efficiency: '95', demand: '0.1', budget: '100' })).streams, 4,
  'four 802.11n streams');
assert.equal(compute(link('vht', 20, 9, 3, 400)).streams, 3, 'three streams at 20 MHz MCS 9');
assert.equal(compute(link('he', 20, 11, 1, 800, { demand: '2000' })).demand, 2000, 'the largest demand');
assert.equal(compute(link('he', 20, 11, 1, 800, { demand: '.5' })).demand, 0.5, 'a bare decimal point is accepted');

// ---- Refusals, message by message.
const refusals = [
  [{ ...link('he', 20, 11, 1, 800), standard: 'eht' }, 'Choose 802.11n, 802.11ac or 802.11ax.'],
  [{ ...link('he', 20, 11, 1, 800), standard: '' }, 'Choose 802.11n, 802.11ac or 802.11ax.'],
  [{ ...link('he', 20, 11, 1, 800), width: '320' },
    'Enter the channel width in MHz as a whole number from 20 to 160.'],
  [{ ...link('he', 20, 11, 1, 800), width: '' }, 'Enter the channel width in MHz.'],
  [{ ...link('ht', 80, 7, 1, 800), width: '80' },
    '802.11n (Wi-Fi 4) does not define an 80 MHz channel. Choose 20 or 40 MHz.'],
  [{ ...link('ht', 20, 7, 1, 800), width: '160' },
    '802.11n (Wi-Fi 4) does not define a 160 MHz channel. Choose 20 or 40 MHz.'],
  [{ ...link('he', 20, 12, 1, 800), mcs: '12' },
    'Enter the MCS index as a whole number from 0 to 11.'],
  [{ ...link('ht', 20, 8, 1, 800), mcs: '8' },
    'Enter the MCS index as a whole number from 0 to 7.'],
  [{ ...link('vht', 80, 9, 9, 400), streams: '9' },
    'Enter the number of spatial streams as a whole number from 1 to 8.'],
  [{ ...link('ht', 20, 7, 5, 800), streams: '5' },
    'Enter the number of spatial streams as a whole number from 1 to 4.'],
  [{ ...link('he', 20, 11, 1, 400), gi: '400' },
    '802.11ax (Wi-Fi 6) does not define a 400 ns guard interval. Choose 800, 1600 or 3200 ns.'],
  [{ ...link('vht', 80, 9, 1, 1600), gi: '1600' },
    '802.11ac (Wi-Fi 5) does not define a 1600 ns guard interval. Choose 400 or 800 ns.'],
  [{ ...link('he', 20, 11, 1, 800), efficiency: '99' },
    'Enter the MAC efficiency in percent as a whole number from 10 to 95.'],
  [{ ...link('he', 20, 11, 1, 800), efficiency: '65.5' },
    'Enter the MAC efficiency in percent as a whole number from 10 to 95.'],
  [{ ...link('he', 20, 11, 1, 800), demand: '3.456' },
    'Enter the stream demand in Mbps as a number with up to two decimals.'],
  [{ ...link('he', 20, 11, 1, 800), demand: '0' }, 'Enter the stream demand in Mbps from 0.1 to 2000.'],
  [{ ...link('he', 20, 11, 1, 800), demand: 'fast' },
    'Enter the stream demand in Mbps as a number with up to two decimals.'],
  [{ ...link('he', 20, 11, 1, 800), budget: '101' },
    'Enter the airtime budget in percent as a whole number from 10 to 100.'],
  [{ ...link('he', 20, 11, 1, 800), budget: '' }, 'Enter the airtime budget in percent.'],
  [{ ...link('he', 20, 11, 1, 800), mcs: '' }, 'Enter the MCS index.'],
  [{ ...link('he', 20, 11, 1, 0), gi: '0' },
    'Enter the guard interval in nanoseconds as a whole number from 400 to 3200.'],
];
for (const [settings, message] of refusals) {
  assert.equal(failure(settings), message, 'message: ' + message);
}
// Numbers are accepted directly and the defaults fill whatever is left out.
assert.equal(compute({ width: 40, mcs: 7, streams: 2, gi: 800 }).mcs, 7, 'numeric values are accepted');
assert.equal(compute({}).rateMbps, 143.382352941, 'the default is a 20 MHz 802.11ax MCS 11 link');
assert.equal(compute({ mcs: '0' }).mcs, 0, 'one field can be overridden alone');

// ---- Randomised sweeps: the identities hold for every defined combination.
let seed = 20261116;
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
  return seed / 0x80000000;
};
const standards = ['ht', 'vht', 'he'];
let checked = 0;
for (let trial = 0; trial < 400; trial += 1) {
  const standard = standards[Math.floor(random() * 3)];
  const spec = C.STANDARDS[standard];
  const width = spec.widths[Math.floor(random() * spec.widths.length)];
  const mcs = Math.floor(random() * (spec.maxMcs + 1));
  const streams = 1 + Math.floor(random() * spec.maxStreams);
  const gi = spec.gis[Math.floor(random() * spec.gis.length)];
  const settings = link(standard, width, mcs, streams, gi, {
    efficiency: String(10 + Math.floor(random() * 86)),
    demand: (Math.round((0.1 + random() * 1999.9) * 100) / 100).toFixed(2),
    budget: String(10 + Math.floor(random() * 91)),
  });
  const message = failure(settings);
  if (message) {
    assert.equal(standard, 'vht', 'only 802.11ac leaves combinations undefined, trial ' + trial);
    assert.ok(/^802\.11ac does not define MCS /.test(message), 'the undefined message, trial ' + trial);
    continue;
  }
  const result = compute(settings);
  const tone = tones[mcs];
  const symbol = bases[standard] + gi / 1000;
  const expectedPerStream = carriers[standard][width] * tone[0] * tone[1] / tone[2] / symbol;
  close(result.perStreamMbps, expectedPerStream, 1e-9, `one stream, trial ${trial}`);
  close(result.rateMbps, expectedPerStream * streams, 1e-6, `link rate, trial ${trial}`);
  close(result.goodputMbps, result.rateMbps * Number(settings.efficiency) / 100, 1e-5, `goodput, trial ${trial}`);
  close(result.airtimePercent, Number(settings.demand) / result.goodputMbps * 100, 1e-5, `airtime, trial ${trial}`);
  assert.equal(result.streamsFit,
    Math.floor(Number(settings.budget) / 100 * result.goodputMbps / Number(settings.demand) + 1e-9),
    `streams inside the budget, trial ${trial}`);
  assert.ok(result.rateMbps > 0 && isFinite(result.rateMbps), `a finite rate, trial ${trial}`);
  assert.ok(result.symbolUs === 3.6 || result.symbolUs === 4 || result.symbolUs === 13.6
    || result.symbolUs === 14.4 || result.symbolUs === 16, `a defined symbol time, trial ${trial}`);
  checked += 1;
}

// ---- Catalogue record: 19 cases, replayed against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2225, 'public tools');
assert.ok(catalog.tools.some((tool) => tool.slug === slug), 'the new record is present');
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.equal(entry.name, 'Wi-Fi Data Rate Calculator');
assert.equal(entry.category, 'IT & Networking');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.reviewedAt, null);
assert.ok(entry.method.includes('browser'), 'method documents local execution');
assert.ok(entry.method.includes('data subcarriers'), 'method names the subcarrier model');
assert.ok(entry.method.includes('symbol time'), 'method states the symbol time');
assert.ok(entry.method.includes('143.4'), 'method carries a worked figure');
assert.ok(entry.description.length > 120, 'description is descriptive');
assert.equal(entry.sources.length, 2, 'two vendor references are cited');
for (const source of entry.sources) {
  assert.ok(source.title.length > 20, 'a source names the document and the part used');
  assert.match(source.url, /^https:\/\//, 'every URL is absolute https');
}
assert.ok(entry.sources.some((source) => source.url.includes('h3c.com')), 'the MCS tables are cited');
assert.ok(entry.sources.some((source) => source.url.includes('siemens.com')), 'the guard intervals are cited');
const kinds = (kind) => entry.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(entry.testCases.length, 19, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 3, 'three boundary cases');
assert.equal(kinds('validation'), 8, 'eight validation cases');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = compute(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], expected, testCase.name + ' ' + key);
  }
}

// The new record's slug, name and aliases must not collide with any other record.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [entry.slug, entry.name].concat(entry.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'aliases are internally unique');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'tags are internally unique');
for (const tag of ['wifi', 'mcs', '802.11ax', 'airtime']) {
  assert.ok(entry.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: labelled controls, no storage or network, ASCII source.
const markup = html.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, '');
const controlIds = [...markup.matchAll(/<(?:input|select)\b[^>]*\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(controlIds.length, 8, 'every control is in the markup');
for (const id of controlIds) {
  assert.ok(new RegExp(`<label\\b[^>]*\\bfor="${id}"`).test(markup), 'control has a visible label: ' + id);
}
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'refusals are announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/<form id="wdr-form" novalidate>/.test(html), 'the form is a real form and does not native-validate');
assert.ok(/<button type="submit">Calculate the rate<\/button>/.test(html), 'the action button submits');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/[^\x00-\x7f]/.test(html), 'the page source stays ASCII');
assert.ok(/@media \(max-width:360px\)/.test(html), 'a phone layout is defined');

console.log('wifi data rate: ' + published.length + ' vendor table cells, the subcarrier and symbol model, '
  + undefined.length + ' undefined 802.11ac combinations, the goodput and airtime identities, '
  + refusals.length + ' refusals, ' + checked + ' randomised links, 19 catalogue cases and the page contract pass');
