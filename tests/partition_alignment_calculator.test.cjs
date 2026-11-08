/* Regression checks for the partition alignment core, its catalog cases and
   the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'partition-alignment-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* partition-align-core:start */');
const end = html.indexOf('/* partition-align-core:end */');
assert.ok(start > -1 && end > start, 'partition align core markers missing');
const core = html.slice(start, end + '/* partition-align-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PartitionAlignCore;', sandbox);
const T = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(T.analyze(input));

// Documented surface.
assert.equal(T.MIB, 1048576);
assert.deepEqual(plain(T.SECTOR_SIZES), [512, 4096]);
assert.equal(T.MAX_START_MIB, 1000000);
assert.equal(T.MAX_SIZE_MIB, 1000000);
assert.equal(T.MIN_SIZE_MIB, 0.000001);
assert.equal(T.MAX_ALIGNMENT, 1073741824);
assert.deepEqual(plain(T.LIMITS.chunk), [4, 4096]);
assert.deepEqual(plain(T.LIMITS.disks), [1, 64]);
assert.match(T.MESSAGES.startEmpty, /planned start/);
assert.match(T.MESSAGES.startRange, /between 0 and 1000000 MiB/);
assert.match(T.MESSAGES.sizeRange, /0.000001 and 1000000 MiB/);
assert.match(T.MESSAGES.unit, /exceeds 1 GiB/);
assert.equal(T.alignUp(0, 1048576), 0);
assert.equal(T.alignUp(1048575, 1048576), 1048576);
assert.equal(T.alignUp(1048576, 1048576), 1048576);
assert.equal(T.lcm(1048576, 1572864), 3145728);
assert.equal(T.lcm(1048576, 196608), 3145728);

const base = { start: '1', size: '100', logical: '512', physical: '4096', stripe: false, chunk: '512', disks: '4' };
const withInput = (overrides) => Object.assign({}, base, overrides);

// A 1 MiB start on a 512e disk needs no padding at either end.
const aligned = run(base);
assert.equal(aligned.startMiB, 1);
assert.equal(aligned.startBytes, 1048576);
assert.equal(aligned.startLBA, 2048);
assert.equal(aligned.startWholeSectors, true);
assert.equal(aligned.startPhysicalAligned, true);
assert.equal(aligned.offsetPastMiB, 0);
assert.equal(aligned.alignmentBytes, 1048576);
assert.equal(aligned.alignmentMiB, 1);
assert.equal(aligned.alignmentSectors, 2048);
assert.equal(aligned.alignedStartBytes, 1048576);
assert.equal(aligned.alignedStartLBA, 2048);
assert.equal(aligned.startPaddingBytes, 0);
assert.equal(aligned.startPaddingPercent, 0);
assert.equal(aligned.sizeBytes, 104857600);
assert.equal(aligned.alignedEndBytes, 105906176);
assert.equal(aligned.alignedEndLBA, 206848);
assert.equal(aligned.endPaddingBytes, 0);
assert.equal(aligned.spanBytes, 104857600);
assert.equal(aligned.sizeAligned, true);
assert.equal(aligned.verdict, 'aligned');
assert.equal(aligned.endVerdict, 'exact');

// Half a MiB is sector- and physical-aligned but inside the unit.
const half = run(withInput({ start: '0.5' }));
assert.equal(half.startBytes, 524288);
assert.equal(half.offsetPastMiB, 524288);
assert.equal(half.startPaddingBytes, 524288);
assert.equal(half.alignedStartBytes, 1048576);
assert.equal(half.alignedStartMiB, 1);
assert.equal(half.verdict, 'padded');
assert.equal(half.endVerdict, 'exact');
assert.equal(half.startPaddingPercent, 0.5);

// 4Kn: the LBA unit is 4096 bytes, so 1.25 MiB is 320 whole sectors.
const kn = run(withInput({ start: '1.25', size: '64', logical: '4096', physical: '4096' }));
assert.equal(kn.startBytes, 1310720);
assert.equal(kn.startLBA, 320);
assert.equal(kn.startWholeSectors, true);
assert.equal(kn.alignedStartLBA, 512);
assert.equal(kn.startPaddingBytes, 786432);
assert.equal(kn.alignedEndLBA, 16896);
assert.equal(kn.sizeBytes, 67108864);
assert.equal(kn.endPaddingBytes, 0);
assert.equal(kn.verdict, 'padded');

// A 512 KiB chunk over four data disks is a 2 MiB stripe.
const stripe = run(withInput({ start: '3', stripe: true, chunk: '512', disks: '4' }));
assert.equal(stripe.stripeBytes, 2097152);
assert.equal(stripe.alignmentBytes, 2097152);
assert.equal(stripe.alignmentMiB, 2);
assert.equal(stripe.alignedStartBytes, 4194304);
assert.equal(stripe.alignedStartLBA, 8192);
assert.equal(stripe.startPaddingBytes, 1048576);
assert.equal(stripe.endPaddingBytes, 0);
assert.equal(stripe.verdict, 'padded');

// A 1.5 MiB stripe is not a multiple of 1 MiB: the unit becomes 3 MiB.
const odd = run(withInput({ start: '1', stripe: true, chunk: '256', disks: '6' }));
assert.equal(odd.stripeBytes, 1572864);
assert.equal(odd.alignmentBytes, 3145728);
assert.equal(odd.alignmentMiB, 3);
assert.equal(odd.alignedStartBytes, 3145728);
assert.equal(odd.alignedStartLBA, 6144);
assert.equal(odd.startPaddingBytes, 2097152);
assert.equal(odd.alignedEndBytes, 110100480);
assert.equal(odd.alignedEndLBA, 215040);
assert.equal(odd.endPaddingBytes, 2097152);
assert.equal(odd.spanBytes, 106954752);
assert.equal(odd.sizeAligned, false);
assert.equal(odd.endVerdict, 'padded');

// Zero, one byte and the maximum inputs behave.
const zero = run(withInput({ start: '0', size: '1' }));
assert.equal(zero.alignedStartBytes, 0);
assert.equal(zero.alignedStartLBA, 0);
assert.equal(zero.verdict, 'aligned');
assert.equal(zero.alignedEndBytes, 1048576);

const oneByte = run(withInput({ start: '0.000001', size: '1' }));
assert.equal(oneByte.startBytes, 1);
assert.equal(oneByte.startWholeSectors, false);
assert.equal(oneByte.startPaddingBytes, 1048575);
assert.equal(oneByte.verdict, 'sector');

const maximum = run(withInput({ start: '1000000', size: '1000000' }));
assert.equal(maximum.startBytes, 1048576000000);
assert.equal(maximum.alignedStartLBA, 2048000000);
assert.equal(maximum.alignedEndBytes, 2097152000000);
assert.equal(maximum.alignedEndLBA, 4096000000);
assert.equal(maximum.verdict, 'aligned');

// A 512-byte-aligned start on a 4 KiB physical sector is flagged separately.
const physical = run(withInput({ start: '0.001953' }));
assert.equal(physical.startBytes, 2048);
assert.equal(physical.startWholeSectors, true);
assert.equal(physical.startPhysicalAligned, false);
assert.equal(physical.startPaddingBytes, 1046528);
assert.equal(physical.verdict, 'physical');

// A size that is not a multiple of the unit pads the end but not the start.
const shortSize = run(withInput({ start: '1', size: '0.5' }));
assert.equal(shortSize.startPaddingBytes, 0);
assert.equal(shortSize.alignedEndBytes, 2097152);
assert.equal(shortSize.endPaddingBytes, 524288);
assert.equal(shortSize.spanBytes, 1048576);
assert.equal(shortSize.verdict, 'aligned');
assert.equal(shortSize.endVerdict, 'padded');

// Identities hold over a grid of offsets, sector sizes and stripes.
const grid = [];
for (const startValue of ['0', '0.25', '0.5', '1', '1.25', '3', '7.5', '999.999']) {
  for (const logical of ['512', '4096']) {
    for (const physical of ['512', '4096']) {
      for (const stripe of [false, true]) {
        grid.push({ start: startValue, size: '50', logical, physical, stripe, chunk: '256', disks: '6' });
      }
    }
  }
}
let identityChecks = 0;
for (const input of grid) {
  const row = run(input);
  assert.equal(row.alignedStartBytes % row.alignmentBytes, 0, 'start not on a unit boundary');
  assert.ok(row.alignedStartBytes >= row.startBytes, 'start moved backwards');
  assert.ok(row.alignedStartBytes - row.startBytes < row.alignmentBytes, 'start padding too large');
  assert.equal(row.alignmentSectors * row.logical, row.alignmentBytes, 'unit in sectors');
  assert.equal(row.alignedStartLBA * row.logical, row.alignedStartBytes, 'start LBA');
  assert.equal(row.alignedEndLBA * row.logical, row.alignedEndBytes, 'end LBA');
  assert.equal(row.alignedEndBytes, row.alignedStartBytes + row.sizeBytes + row.endPaddingBytes, 'end padding');
  assert.equal(row.spanBytes, row.sizeBytes + row.endPaddingBytes, 'span');
  assert.equal(row.sizeAligned, row.endPaddingBytes === 0, 'size flag');
  assert.equal(row.endVerdict, row.endPaddingBytes === 0 ? 'exact' : 'padded');
  assert.equal(row.startPaddingPercent, row.startBytes ? row.startPaddingBytes / row.sizeBytes * 100 : 0);
  identityChecks += 11;
}

// Every verdict is reachable and the checks are applied in order.
assert.equal(run(withInput({ start: '2' })).verdict, 'aligned');
assert.equal(run(withInput({ start: '2.5' })).verdict, 'padded');
assert.equal(run(withInput({ start: '0.001953', physical: '4096' })).verdict, 'physical');
assert.equal(run(withInput({ start: '0.001953', physical: '512' })).verdict, 'padded');
assert.equal(run(withInput({ start: '0.0001' })).verdict, 'sector');

// The reference table shows the unit each layout needs.
const table = plain(T.table());
assert.equal(table.length, 5);
assert.deepEqual(table.map((row) => row.alignmentMiB), [2, 3, 1, 2, 3]);
assert.deepEqual(table.map((row) => row.stripeMiB), [2, 1.5, 1, 2, 0.1875]);
for (const row of table) {
  assert.equal(row.stripeBytes, row.chunkKiB * 1024 * row.disks, 'stripe width');
  assert.equal(row.alignmentBytes, T.lcm(T.MIB, row.stripeBytes), 'unit is the lcm');
}

// Decimal commas, a leading plus and surrounding spaces are accepted.
assert.equal(run(withInput({ start: '1,5' })).startBytes, 1572864);
assert.equal(run(withInput({ start: ' +1.5 ', size: ' 100 ' })).startBytes, 1572864);
assert.equal(run(withInput({ start: '0' })).startMiB, 0);

// Validation: each refusal names the field and its range, in field order.
const failure = (input) => {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
assert.equal(failure(withInput({ start: '' })), 'Enter the planned start offset.');
assert.equal(failure(withInput({ start: '   ' })), 'Enter the planned start offset.');
assert.equal(failure(withInput({ start: 'one' })), 'Start offset must be a number of MiB.');
assert.equal(failure(withInput({ start: '-1' })), 'Start offset must be a number of MiB.');
assert.equal(failure(withInput({ start: '1e3' })), 'Start offset must be a number of MiB.');
assert.equal(failure(withInput({ start: '1.1234567' })), 'Start offset must be a number of MiB.');
assert.equal(failure(withInput({ start: '1000001' })), 'Start offset must be between 0 and 1000000 MiB.');
assert.equal(failure(withInput({ size: '' })), 'Enter the partition size.');
assert.equal(failure(withInput({ size: '1e3' })), 'Partition size must be a number of MiB.');
assert.equal(failure(withInput({ size: '0' })), 'Partition size must be between 0.000001 and 1000000 MiB.');
assert.equal(failure(withInput({ size: '1000001' })), 'Partition size must be between 0.000001 and 1000000 MiB.');
assert.equal(failure(withInput({ stripe: true, chunk: '3' })), 'Chunk size must be a whole number from 4 to 4096 KiB.');
assert.equal(failure(withInput({ stripe: true, chunk: '512.5' })), 'Chunk size must be a whole number from 4 to 4096 KiB.');
assert.equal(failure(withInput({ stripe: true, chunk: '4097' })), 'Chunk size must be a whole number from 4 to 4096 KiB.');
assert.equal(failure(withInput({ stripe: true, disks: '0' })), 'Data disks must be a whole number from 1 to 64.');
assert.equal(failure(withInput({ stripe: true, disks: '65' })), 'Data disks must be a whole number from 1 to 64.');
assert.equal(failure(withInput({ stripe: true, chunk: '4095', disks: '63' })),
  'Alignment unit exceeds 1 GiB; reduce the chunk size or the data disk count.');
// Refusals follow field order, not the order the fields were set.
assert.equal(failure(withInput({ start: '', size: '' })),
  'Enter the planned start offset.');
assert.equal(failure(withInput({ size: '', stripe: true, chunk: 'abc' })), 'Enter the partition size.');
// A stripe that is off ignores the chunk and disk fields.
assert.equal(run(withInput({ stripe: false, chunk: 'abc', disks: '0' })).alignmentBytes, 1048576);
// Both ends of every range are accepted.
assert.equal(run(withInput({ start: '1000000', size: '0.000001' })).startMiB, 1000000);
assert.equal(run(withInput({ stripe: true, chunk: '4', disks: '1' })).alignmentBytes, 1048576);
assert.equal(run(withInput({ stripe: true, chunk: '4096', disks: '64' })).alignmentBytes, 268435456);

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="align-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/type="button" id="reset"/.test(html), 'page has an explicit reset button');
assert.ok(/role="alert"/.test(html), 'errors are announced as alerts');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
for (const control of ['start', 'size', 'logical', 'physical', 'chunk', 'disks']) {
  assert.ok(new RegExp(`<label class="f" for="${control}">`).test(html), `${control} is labelled`);
  assert.ok(new RegExp(`id="${control}"[^>]*(inputmode=|aria-describedby=)`).test(html), `${control} is described`);
  assert.ok(new RegExp(`id="${control}"[^>]*aria-describedby=`).test(html), `${control} has a help text`);
}
assert.ok(/min-height:44px/.test(html), 'controls keep a 44 px target');
assert.ok(/<html lang=/.test(html) && /name="viewport"/.test(html), 'page has language and viewport');
assert.ok(/<h1>Partition Alignment Calculator<\/h1>/.test(html), 'page has its heading');
assert.ok(/name="description"/.test(html), 'page has a description');
assert.ok(/<\/html>\s*$/.test(html), 'page is complete');

// Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Partition Alignment Calculator');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.tags.includes('partition') && record.tags.includes('alignment'), 'record tags');
assert.ok(record.tags.includes('raid') && record.tags.includes('lba'), 'record tags cover storage');
assert.ok(record.aliases.some((alias) => /4K Alignment Calculator/.test(alias)), 'record alias');
assert.ok(/least common multiple/.test(record.method), 'method states the stripe rule');
assert.ok(/no storage, uploads or network access/.test(record.method), 'method documents local limits');
assert.equal(record.sources.length, 3, 'three sources');
for (const source of record.sources) {
  assert.ok(source.title && /^https:\/\//.test(source.url), 'source has a title and URL');
}
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 20, 'catalog case count');
assert.equal(kinds('golden'), 5, 'five golden cases');
assert.equal(kinds('boundary'), 5, 'five boundary cases');
assert.equal(kinds('validation'), 10, 'ten validation cases');

let checked = 0;
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') {
      const tolerance = Math.max(Math.abs(value) * 1e-9, 1e-9);
      assert.ok(Math.abs(actual[key] - value) <= tolerance,
        `${testCase.name}.${key}: ${actual[key]} vs ${value}`);
      checked += 1;
    } else {
      assert.equal(actual[key], value, `${testCase.name}.${key}`);
    }
  }
}

// The catalog cases must cover every verdict.
const covered = new Set(record.testCases.filter((testCase) => testCase.kind !== 'validation')
  .map((testCase) => T.analyze(testCase.input).verdict));
assert.ok(covered.has('aligned') && covered.has('padded') && covered.has('physical') && covered.has('sector'),
  'catalog cases cover every verdict');

console.log('partition-alignment-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + checked + ' numeric fields, '
  + identityChecks + ' identity checks)');
