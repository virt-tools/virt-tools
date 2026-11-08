/* Regression checks for the Wi-Fi channel planner core, its catalog cases and
   the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'wifi-channel-planner';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* wifi-channel-core:start */');
const end = html.indexOf('/* wifi-channel-core:end */');
assert.ok(start > -1 && end > start, 'channel core markers missing');
const core = html.slice(start, end + '/* wifi-channel-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = WifiChannelCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.analyze(input));
const channels = (list) => Array.from(list, (item) => item.channel);

// Documented constants and band channel lists.
assert.deepEqual(plain(C.WIDTHS), [20, 40, 80, 160]);
assert.equal(C.MAX_NEIGHBOURS, 24);
assert.equal(C.MAX_APS, 4);
assert.deepEqual(plain(C.bands()), ['2.4', '5', '6']);
assert.equal(C.channelsOf('2.4').length, 13);
assert.equal(C.channelsOf('2.4')[12], 13);
assert.equal(C.channelsOf('5').length, 25);
assert.equal(C.channelsOf('5')[0], 36);
assert.equal(C.channelsOf('5')[24], 165);
assert.equal(C.channelsOf('6').length, 59);
assert.equal(C.channelsOf('6')[58], 233);
assert.deepEqual(plain(C.widthsOf('2.4')), [20]);
assert.deepEqual(plain(C.widthsOf('5')), [20, 40, 80, 160]);

// Block counts per band and width.
assert.equal(C.groups('2.4', 20).length, 13);
assert.equal(C.groups('5', 20).length, 25);
assert.equal(C.groups('5', 40).length, 12);
assert.equal(C.groups('5', 80).length, 6);
assert.equal(C.groups('5', 160).length, 2);
assert.equal(C.groups('6', 20).length, 59);
assert.equal(C.groups('6', 40).length, 29);
assert.equal(C.groups('6', 80).length, 14);
assert.equal(C.groups('6', 160).length, 7);

// Bonded channels are centred on their members.
assert.deepEqual(channels(C.groups('5', 80)), [42, 58, 106, 122, 138, 155]);
assert.deepEqual(plain(C.groups('5', 160).map((g) => [g.channel, g.primary])), [[50, 36], [114, 100]]);
const eighty = C.groups('5', 80)[0];
assert.equal(eighty.primary, 36);
assert.equal(eighty.centreMhz, 5210);
assert.equal(eighty.lowMhz, 5170);
assert.equal(eighty.highMhz, 5250);
const forty = C.groups('5', 40)[10];
assert.equal(forty.channel, 151);
assert.equal(forty.primary, 149);
assert.equal(forty.lowMhz, 5735);
assert.equal(forty.highMhz, 5775);

// 6 GHz 160 MHz blocks are 32 channels apart and start at 5945 MHz.
const six160 = C.groups('6', 160);
assert.deepEqual(channels(six160), [15, 47, 79, 111, 143, 175, 207]);
assert.equal(six160[0].lowMhz, 5945);
assert.equal(six160[0].highMhz, 6105);

// 2.4 GHz channels occupy the 22 MHz legacy mask on a 5 MHz grid.
const ch1 = C.groups('2.4', 20)[0];
assert.equal(ch1.centreMhz, 2412);
assert.equal(ch1.occupiedMhz, 22);
assert.equal(ch1.lowMhz, 2401);
assert.equal(ch1.highMhz, 2423);
const ch5 = C.groups('2.4', 20)[4];
assert.equal(ch5.lowMhz, 2421);
const ch6 = C.groups('2.4', 20)[5];
assert.equal(ch6.lowMhz, 2426);
assert.equal(ch6.lowMhz - ch1.highMhz, 3, 'channels 1 and 6 keep a 3 MHz gap');
assert.equal(ch5.lowMhz - ch1.highMhz, -2, 'channels 1 and 5 overlap by 2 MHz');

// The shipped default: two busy 80 MHz blocks leave 58 and 106 free.
const shipped = run({ band: '5', width: '80', neighbours: '36:80, 149:80', aps: '2' });
assert.equal(shipped.candidateCount, 6);
assert.equal(shipped.best.channel, 58);
assert.equal(shipped.best.primary, 52);
assert.equal(shipped.best.occupiedMhz, 80);
assert.equal(shipped.best.overlapMhz, 0);
assert.equal(shipped.best.congestion, 0);
assert.equal(shipped.best.interfering, 0);
assert.deepEqual(channels(shipped.plan), [58, 106]);
assert.equal(shipped.planShort, false);
assert.equal(shipped.plan[1].lowMhz, 5490);
assert.equal(shipped.plan[1].highMhz, 5570);

// Two access points never share spectrum in the returned plan.
for (const pair of [[0, 1], [1, 0]]) {
  const a = shipped.plan[pair[0]];
  const b = shipped.plan[pair[1]];
  assert.ok(Math.min(a.highMhz, b.highMhz) <= Math.max(a.lowMhz, b.lowMhz), 'plan channels overlap');
}

// A duplicated neighbour counts twice: 13 loses 12 MHz to the single 11.
const doubled = run({ band: '2.4', width: '20', neighbours: '1, 6, 6, 11', aps: '1' });
assert.equal(doubled.neighbourCount, 4);
assert.equal(doubled.best.channel, 13);
assert.equal(doubled.best.overlapMhz, 12);
assert.equal(doubled.best.congestion, 55);
assert.equal(doubled.best.coChannel, 0);
assert.equal(doubled.best.interfering, 1);
assert.equal(doubled.candidateCount, 13);

// A single 2.4 GHz co-channel neighbour fills the whole 22 MHz block.
const alone = run({ band: '2.4', width: '20', neighbours: '5', aps: '1' });
const first = alone.candidates.find((candidate) => candidate.channel === 1);
assert.equal(first.overlapMhz, 2);
assert.equal(first.congestion, 9, '2 MHz of a 22 MHz block is 9 percent');
const same = alone.candidates.find((candidate) => candidate.channel === 5);
assert.equal(same.overlapMhz, 22);
assert.equal(same.congestion, 100);
assert.equal(same.coChannel, 1);

// The classic 2.4 GHz set is the only three-channel plan.
const classic = run({ band: '2.4', width: '20', neighbours: '', aps: '4' });
assert.deepEqual(channels(classic.plan), [1, 6, 11]);
assert.equal(classic.planShort, true);
assert.equal(classic.candidates.length, 13);
assert.equal(classic.best.overlapMhz, 0);

// Blocks that only touch share no spectrum: 44:80 ends at 5250, where 58 begins.
const touching = run({ band: '5', width: '80', neighbours: '44:80, 149:80', aps: '1' });
assert.equal(touching.best.channel, 58);
assert.equal(touching.best.lowMhz, 5250);
assert.equal(touching.best.overlapMhz, 0);
assert.equal(touching.neighbours[0].highMhz, 5250);
assert.equal(touching.neighbours[0].channelLabel, 42);

// A wide neighbour covers four narrow channels completely.
const swallowed = run({ band: '5', width: '20', neighbours: '36:80', aps: '1' });
for (const channel of [36, 40, 44, 48]) {
  const candidate = swallowed.candidates.find((item) => item.channel === channel);
  assert.equal(candidate.overlapMhz, 20, `channel ${channel} is fully covered`);
  assert.equal(candidate.congestion, 100, `channel ${channel} is congested`);
  assert.equal(candidate.interfering, 1);
}
assert.equal(swallowed.best.channel, 52);
assert.equal(swallowed.candidates.find((item) => item.channel === 165).interfering, 0);

// A neighbour given by a non-primary 40 MHz channel resolves to its block.
const byPrimary = run({ band: '5', width: '40', neighbours: '40:40', aps: '1' });
const block38 = byPrimary.candidates.find((candidate) => candidate.channel === 38);
assert.equal(block38.overlapMhz, 40);
assert.equal(block38.coChannel, 1);
assert.equal(byPrimary.neighbours[0].channelLabel, 38);
assert.equal(byPrimary.neighbours[0].primary, undefined, 'neighbour view keeps the entered channel');
assert.equal(byPrimary.best.channel, 46);

// The 144 / 149 gap splits the 5 GHz runs, so 132 cannot start a 160 MHz channel.
assert.throws(() => C.analyze({ band: '5', width: '160', neighbours: '132:160', aps: '1' }),
  /Channel 132 cannot form a 160 MHz channel in the 5 GHz band\./);
assert.deepEqual(channels(C.groups('5', 160)), [50, 114]);
assert.throws(() => C.analyze({ band: '5', width: '160', neighbours: '144:160', aps: '1' }),
  /Channel 144 cannot form a 160 MHz channel in the 5 GHz band\./);

// A fully occupied 2.4 GHz band leaves the edges as the least bad, at the cap.
const full = run({ band: '2.4', width: '20', neighbours: '1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13', aps: '1' });
assert.equal(full.best.channel, 1);
assert.equal(full.best.overlapMhz, 60);
assert.equal(full.best.congestion, 100);
assert.equal(full.best.coChannel, 1);
assert.equal(full.best.interfering, 5);
assert.equal(full.candidates[0].channel, 1, 'ties fall to the lowest channel');

// The plan runs out of separate channels where the band is narrow.
const short160 = run({ band: '5', width: '160', neighbours: '', aps: '3' });
assert.deepEqual(channels(short160.plan), [50, 114]);
assert.equal(short160.planShort, true);
assert.equal(short160.candidateCount, 2);

// Validation: each refusal names the field and the limit.
const bad = (input, pattern) => assert.throws(() => C.analyze(input), pattern);
bad({ band: '7', width: '80', neighbours: '', aps: '1' }, /Choose a band: 2\.4 GHz, 5 GHz or 6 GHz\./);
bad({ band: '5', width: '30', neighbours: '', aps: '1' }, /The channel width must be 20, 40, 80 or 160 MHz\./);
bad({ band: '2.4', width: '80', neighbours: '', aps: '1' },
  /The 2\.4 GHz band is modelled at 20 MHz channels only; choose 20 MHz\./);
bad({ band: '5', width: '80', neighbours: 'abc', aps: '1' },
  /Each neighbouring channel must be a number such as 1, 6 or 36:80\./);
bad({ band: '5', width: '80', neighbours: '36:30', aps: '1' },
  /A neighbouring channel width must be 20, 40, 80 or 160 MHz\./);
bad({ band: '2.4', width: '20', neighbours: '6:40', aps: '1' },
  /The 2\.4 GHz band is modelled at 20 MHz networks only; drop the width or use 20\./);
bad({ band: '2.4', width: '20', neighbours: '14', aps: '1' },
  /Channel 14 is not a primary channel in the 2\.4 GHz band\./);
bad({ band: '5', width: '40', neighbours: '38:40', aps: '1' },
  /Channel 38 is not a primary channel in the 5 GHz band\./);
bad({ band: '5', width: '80', neighbours: new Array(25).fill('36').join(' '), aps: '1' },
  /Enter at most 24 neighbouring networks\./);
bad({ band: '5', width: '80', neighbours: '', aps: '5' },
  /Access points to place must be a whole number from 1 to 4\./);
bad({ band: '5', width: '80', neighbours: '', aps: '1.5' },
  /Access points to place must be a whole number from 1 to 4\./);

// The maximum neighbour count is accepted.
const maxed = run({ band: '5', width: '20', neighbours: new Array(24).fill('36').join(','), aps: '1' });
assert.equal(maxed.neighbourCount, 24);
assert.equal(maxed.best.channel, 40);

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="wifi-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/role="alert"/.test(html), 'errors are announced as alerts');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
for (const control of ['band', 'width', 'aps', 'neighbours']) {
  assert.ok(new RegExp(`<label class="f" for="${control}">`).test(html), `${control} is labelled`);
  assert.ok(new RegExp(`<select id="${control}"`).test(html) || new RegExp(`<input type="text" id="${control}"`).test(html),
    `${control} control exists`);
}
assert.ok(/min-height:44px/.test(html), 'controls keep a 44 px target');
assert.ok(!/<table/i.test(html), 'page needs no table wrapper');
assert.ok(/<html lang=/.test(html) && /name="viewport"/.test(html), 'page has language and viewport');
assert.ok(/<h1>Wi-Fi Channel Planner<\/h1>/.test(html), 'page has its heading');

// Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Wi-Fi Channel Planner');
assert.equal(record.category, 'IT & Networking');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(/no storage, uploads or network access/.test(record.method), 'method documents local limits');
assert.ok(/22 MHz/.test(record.method), 'method states the 2.4 GHz mask');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 26, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 8, 'eight boundary cases');
assert.equal(kinds('validation'), 10, 'ten validation cases');

const flatten = (result) => ({
  bestChannel: result.best.channel,
  bestPrimary: result.best.primary,
  bestCentreMhz: result.best.centreMhz,
  bestOccupiedMhz: result.best.occupiedMhz,
  bestOverlapMhz: result.best.overlapMhz,
  bestCongestion: result.best.congestion,
  bestCoChannel: result.best.coChannel,
  bestInterfering: result.best.interfering,
  candidateCount: result.candidateCount,
  plan: channels(result.plan),
  planShort: result.planShort
});

const close = (actual, expected, label) => {
  const tolerance = Math.max(Math.abs(expected) * 1e-9, 1e-9);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
};

function verify(expected, actual, label) {
  if (typeof expected === 'number') {
    close(actual, expected, label);
    return;
  }
  if (Array.isArray(expected)) {
    assert.deepEqual(actual, expected, label);
    return;
  }
  assert.deepEqual(actual, expected, label);
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  const { expected } = testCase;
  if (expected.error) {
    assert.throws(() => C.analyze(testCase.input), new RegExp(escape(expected.error)), testCase.name);
    continue;
  }
  const actual = flatten(run(testCase.input));
  for (const [key, value] of Object.entries(expected)) verify(value, actual[key], `${testCase.name}.${key}`);
}

console.log('wifi-channel-planner: all checks passed ('
  + record.testCases.length + ' catalog cases, 6 bands-by-width group counts)');
