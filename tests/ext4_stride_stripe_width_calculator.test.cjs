/* Regression checks for the ext4 stride and stripe-width core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ext4-stride-stripe-width-calculator';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* ext4-stride-core:start */');
const end = html.indexOf('/* ext4-stride-core:end */');
assert.ok(start > -1 && end > start, 'ext4 stride core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '\nmodule.exports = Ext4Stride;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'System');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 10, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 3, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 800, 'method documented');
assert.equal(catalog.tools.length, 2292, 'catalog total');
assert.equal(catalog.tools.filter((tool) => tool.category === 'System').length, 45, 'System count');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');
const aliases = catalog.tools.flatMap((tool) => (tool.slug === slug ? [] : tool.aliases || []))
  .map((alias) => alias.toLowerCase());
for (const alias of entry.aliases) {
  assert.ok(!aliases.includes(alias.toLowerCase()), `alias ${alias} is already used`);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug &&
  /stride|stripe[- ]width|mkfs/i.test([tool.name, ...(tool.aliases || []), ...(tool.tags || [])].join(' '))),
'no other stride or stripe-width tool');

const failure = (input) => {
  try {
    C.compute(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
const close = (left, right, label, tolerance = 1e-9) => {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  assert.ok(Math.abs(Number(left) - Number(right)) <= tolerance * scale, `${label}: ${left} != ${right}`);
};

// --- Constants and conventions. ---
assert.deepEqual(Object.keys(C.LEVELS).sort(), ['raid0', 'raid1', 'raid10', 'raid5', 'raid6', 'single']);
assert.deepEqual(Array.from(C.BLOCKS), [1024, 2048, 4096]);
assert.deepEqual([C.CHUNK.min, C.CHUNK.max, C.CHUNK.multiple], [4, 4096, 4]);
assert.deepEqual([C.DISKS.min, C.DISKS.max], [1, 64]);
assert.equal(C.NARROW_STRIDE, 4);
assert.equal(C.dataDisksFor('raid6', 8), 6);
assert.equal(C.dataDisksFor('raid5', 8), 7);
assert.equal(C.dataDisksFor('raid10', 6), 3);
assert.equal(C.dataDisksFor('raid0', 4), 4);
assert.equal(C.dataDisksFor('raid1', 3), 1);
assert.equal(C.dataDisksFor('single', 1), 1);
assert.equal(C.sig(393216 / 1048576), '0.375');
assert.equal(C.sizeText(393216), '384 KiB');
assert.equal(C.sizeText(268435456), '256 MiB');
assert.equal(C.sizeText(1073741824), '1 GiB');
assert.equal(C.sizeText(8192), '8 KiB');
assert.equal(C.blockText(4096), '4 KiB');
assert.equal(C.blockText(1024), '1 KiB');
assert.equal(C.classify(2, 1, 4096, 8192, 'raid6').key, 'narrow');
assert.equal(C.classify(6, 16, 65536, 393216, 'raid6').key, 'aligned');
assert.equal(C.classify(1, 16, 65536, 65536, 'raid1').key, 'no-stripe');
assert.equal(C.classify(1, 16, 65536, 65536, 'single').key, 'no-stripe');
const rowSet = C.rowsFor(65536, 6, 2048);
assert.deepEqual(Array.from(rowSet, (row) => row.stride), [64, 32, 16]);
assert.deepEqual(Array.from(rowSet, (row) => row.stripeWidth), [384, 192, 96]);
assert.deepEqual(Array.from(rowSet, (row) => row.isTarget), [false, true, false]);

// --- Every catalog case must agree with the core. ---
let goldenCount = 0;
let boundaryCount = 0;
let validationCount = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    validationCount += 1;
    assert.equal(failure(testCase.input), testCase.expected.error, `${testCase.name}: validation message`);
    continue;
  }
  if (testCase.kind === 'golden') goldenCount += 1;
  else if (testCase.kind === 'boundary') boundaryCount += 1;
  else assert.fail(`unexpected test kind ${testCase.kind}`);
  const result = C.compute(testCase.input);
  const expected = testCase.expected;
  assert.equal(result.level, expected.level, `${testCase.name}: level echoed`);
  assert.equal(result.disks, expected.disks, `${testCase.name}: disks echoed`);
  assert.equal(result.chunkKb, expected.chunkKb, `${testCase.name}: chunk echoed`);
  assert.equal(result.block, expected.block, `${testCase.name}: block echoed`);
  assert.equal(result.dataDisks, expected.dataDisks, `${testCase.name}: data disks`);
  assert.equal(result.stride, expected.stride, `${testCase.name}: stride`);
  assert.equal(result.stripeWidth, expected.stripeWidth, `${testCase.name}: stripe width`);
  assert.equal(result.fullStripeBytes, expected.fullStripeBytes, `${testCase.name}: full stripe`);
  assert.equal(result.striping, expected.striping, `${testCase.name}: striping flag`);
  assert.equal(result.ext4Command, expected.ext4Command, `${testCase.name}: mkfs.ext4 command`);
  assert.equal(result.xfsCommand, expected.xfsCommand, `${testCase.name}: mkfs.xfs command`);
  assert.equal(result.verdict.key, expected.verdict, `${testCase.name}: verdict`);
  assert.equal(result.rows.length, expected.rows.length, `${testCase.name}: table rows`);
  for (let index = 0; index < expected.rows.length; index += 1) {
    const row = result.rows[index];
    const want = expected.rows[index];
    assert.equal(row.block, want.block, `${testCase.name}: row ${index} block`);
    assert.equal(row.stride, want.stride, `${testCase.name}: row ${index} stride`);
    assert.equal(row.stripeWidth, want.stripeWidth, `${testCase.name}: row ${index} width`);
    assert.equal(row.isTarget, want.isTarget, `${testCase.name}: row ${index} highlight`);
  }
}
assert.equal(goldenCount, 6, 'expected six golden cases');
assert.equal(boundaryCount, 6, 'expected six boundary cases');
assert.equal(validationCount, 13, 'expected thirteen validation cases');

// --- Three hundred generated configurations against the algebra. ---
let seed = 20261114n;
const MOD = 2147483648n;
const random = () => {
  seed = (seed * 1103515245n + 12345n) % MOD;
  return Number(seed) / 2147483648;
};
const levelKeys = Object.keys(C.LEVELS);
const minDisks = { single: 1, raid0: 2, raid1: 2, raid5: 3, raid6: 4, raid10: 2 };
const chunkChoices = [4, 8, 12, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];
let sweeps = 0;
for (let index = 0; index < 300; index += 1) {
  const level = levelKeys[index % levelKeys.length];
  let disks;
  if (level === 'single') {
    disks = 1;
  } else if (level === 'raid10') {
    disks = 2 * (1 + Math.floor(random() * 12));
    if (disks < 2) disks = 2;
  } else {
    disks = minDisks[level] + Math.floor(random() * (64 - minDisks[level] + 1));
    if (disks > 64) disks = 64;
  }
  const chunkKb = chunkChoices[Math.floor(random() * chunkChoices.length)];
  const block = C.BLOCKS[Math.floor(random() * C.BLOCKS.length)];
  const result = C.compute({ level: level, disks: String(disks), chunk: String(chunkKb), block: String(block) });

  const chunkBytes = chunkKb * 1024;
  const expectedData = level === 'single' ? 1
    : level === 'raid0' ? disks
      : level === 'raid1' ? 1
        : level === 'raid5' ? disks - 1
          : level === 'raid6' ? disks - 2
            : disks / 2;

  // Geometry from the definitions, not from the implementation.
  assert.equal(result.dataDisks, expectedData, 'data disk count');
  assert.equal(result.stride, chunkBytes / block, 'stride is the chunk in blocks');
  assert.equal(result.stride, Math.floor(result.stride), 'stride is a whole number of blocks');
  assert.equal(result.stride * block, chunkBytes, 'stride times block size is the chunk');
  assert.equal(result.stripeWidth, (chunkBytes / block) * expectedData, 'stripe width spans the data disks');
  assert.equal(result.fullStripeBytes, chunkBytes * expectedData, 'full stripe spans the data disks');
  assert.equal(result.striping, expectedData > 1, 'striping flag follows the data disks');
  close(result.stride * result.block, result.chunkBytes, 'chunk identity');

  // The commands carry the numbers, and drop them when there is no stripe.
  if (expectedData > 1) {
    assert.ok(result.ext4Command.includes(`-b ${block} -E stride=${result.stride},stripe-width=${result.stripeWidth}`),
      'ext4 command carries the options');
    assert.ok(result.xfsCommand.includes(`su=${chunkKb}k,sw=${expectedData}`), 'xfs command carries su and sw');
  } else {
    assert.ok(!/stride=|stripe-width=|su=|sw=/.test(result.ext4Command + result.xfsCommand),
      'no stripe options without striping');
  }

  // Verdict, warnings and notes.
  const expectedVerdict = expectedData <= 1 ? 'no-stripe' : (result.stride < 4 ? 'narrow' : 'aligned');
  assert.equal(result.verdict.key, expectedVerdict, 'verdict follows the geometry');
  let expectedWarnings = 0;
  if (expectedVerdict === 'narrow') expectedWarnings += 1;
  if (expectedVerdict === 'no-stripe') expectedWarnings += 1;
  if (level === 'raid10') expectedWarnings += 1;
  assert.equal(result.warnings.length, expectedWarnings, 'warning rows');
  assert.equal(result.notes.length, 6 + expectedWarnings, 'notes plus warnings');

  // Table rows: all three block sizes, exactly one highlighted.
  assert.deepEqual(Array.from(result.rows, (row) => row.block), [1024, 2048, 4096], 'table block sizes');
  assert.equal(result.rows.filter((row) => row.isTarget).length, 1, 'one highlighted row');
  for (const row of result.rows) {
    assert.equal(row.stride, chunkBytes / row.block, `stride at ${row.block}`);
    assert.equal(row.stripeWidth, row.stride * expectedData, `width at ${row.block}`);
    assert.equal(row.isTarget, row.block === block, 'highlight follows the chosen block size');
  }
  sweeps += 1;
}
assert.equal(sweeps, 300, 'three hundred generated configurations');

// --- Behaviour the sweep cannot reach reliably. ---
const desk = C.compute({});
assert.equal(desk.level, 'raid6');
assert.equal(desk.disks, 8);
assert.equal(desk.stride, 16);
assert.equal(desk.stripeWidth, 96);
assert.equal(desk.verdict.key, 'aligned');
assert.equal(desk.notes.length, 6);
assert.equal(desk.warnings.length, 0);
assert.equal(desk.ext4Command, 'mkfs.ext4 -b 4096 -E stride=16,stripe-width=96 /dev/md0');
assert.equal(desk.xfsCommand, 'mkfs.xfs -b size=4096 -d su=64k,sw=6 /dev/md0');
assert.ok(desk.notes[0].includes('16'), 'the first note shows the stride arithmetic');

const narrow = C.compute({ level: 'raid6', disks: '4', chunk: '4', block: '4096' });
assert.equal(narrow.stride, 1);
assert.equal(narrow.stripeWidth, 2);
assert.equal(narrow.verdict.key, 'narrow');
assert.equal(narrow.warnings.length, 1);
assert.ok(narrow.warnings[0].includes('16 KiB'), 'the narrow warning names the smallest useful chunk');

const mirror = C.compute({ level: 'raid1', disks: '2', chunk: '64', block: '1024' });
assert.equal(mirror.dataDisks, 1);
assert.equal(mirror.stride, 64);
assert.equal(mirror.stripeWidth, 64);
assert.equal(mirror.verdict.key, 'no-stripe');
assert.equal(mirror.ext4Command, 'mkfs.ext4 -b 1024 /dev/md0');
assert.equal(mirror.xfsCommand, 'mkfs.xfs -b size=1024 /dev/md0');
assert.equal(mirror.warnings.length, 1);

const ten = C.compute({ level: 'raid10', disks: '6', chunk: '128', block: '4096' });
assert.equal(ten.dataDisks, 3);
assert.equal(ten.stride, 32);
assert.equal(ten.stripeWidth, 96);
assert.equal(ten.warnings.length, 1, 'RAID 10 warns about its assumed layout');
assert.ok(ten.warnings[0].includes('near-2'), 'the RAID 10 warning names the layout');

const big = C.compute({ level: 'raid0', disks: '64', chunk: '4096', block: '1024' });
assert.equal(big.stride, 4096);
assert.equal(big.stripeWidth, 262144);
assert.equal(C.sizeText(big.fullStripeBytes), '256 MiB');

assert.deepEqual(Object.keys(C.DEFAULTS).sort(), ['block', 'chunk', 'disks', 'level']);

// --- Page contract. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'), 'live status region');
for (const id of ['level', 'disks', 'chunk', 'block', 'calculate', 'reset', 'stride-status',
  'block-body', 'notes', 'stride-note', 'mode-cap', 'level-cap', 'stride-out', 'out-stride', 'out-width', 'stride-sub',
  'stat-stride', 'stat-width', 'stat-data', 'stat-chunk', 'stat-stripe', 'stat-disks',
  'verdict-title', 'verdict-text', 'cmd-ext4', 'cmd-xfs', 'copy', 'copy-status']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or output ${id}`);
}
assert.ok(/<form id="stride-form" novalidate>/.test(html), 'form contract');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(/<option value="raid6" selected>/.test(html), 'RAID 6 selected by default');
assert.ok(/<option value="4096" selected>/.test(html), '4 KiB blocks selected by default');
assert.ok(/id="copy"[^>]*disabled/.test(html), 'copy starts disabled');
assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(html), 'no raw HTML sinks');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'no browser storage');
assert.ok(!/https?:\/\//.test(html.replace(/<meta name="description"[^>]*>/, '')), 'no external requests');
assert.ok(!/\bfetch\(|XMLHttpRequest/.test(html), 'no network calls');
assert.ok(!/\beval\s*\(|new Function\s*\(/.test(html), 'no runtime compilation');
assert.ok(!/\son[a-z]+\s*=/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no inline handlers');

console.log(`${slug}: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed; ` +
  `${sweeps} generated configurations agreed on the data-disk count, the stride, the stripe width, the full-stripe size, ` +
  'the mkfs commands, the verdict, the warning rows and the block-size table');
