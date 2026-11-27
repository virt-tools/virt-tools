/* zram swap planner: the device/metadata/limit arithmetic, the ratio and
   warning bands, the token format, the parser's refusals, an independent
   rebuild of every golden, the catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'zram-swap-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* zram-core:start */';
const endMarker = '/* zram-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ZramCore;', sandbox);
const C = sandbox.module.exports;

const plan = (input) => JSON.parse(JSON.stringify(C.plan(input)));
const refused = (input) => {
  try { C.plan(input); } catch (error) { return error.message; }
  return null;
};

// ---- The documented constants and input ranges.
assert.equal(C.metadataShare, 0.001, 'the idle metadata table is 0.1 % of the device');
assert.deepEqual(Array.from(C.ramRange), [256, 4194304]);
assert.deepEqual(Array.from(C.sizeRange), [10, 400]);
assert.deepEqual(Array.from(C.ratioRange), [1, 20]);
assert.deepEqual(Array.from(C.memRange), [0, 400]);

// ---- The default: 16 GiB RAM, an 8 GiB device at 2:1, no memory limit.
const base = plan({ ram: '16384', size: '50', ratio: '2.0', mem: '0' });
assert.equal(base.swapMiB, 8192);
assert.equal(base.metadataMiB, 8.19, '0.1 % of 8 GiB is 8.192 MiB, rounded half up');
assert.equal(base.usableMiB, 8192);
assert.equal(base.compressedMiB, 4096);
assert.equal(base.footprintMiB, 4104.19);
assert.equal(base.freedMiB, 4087.81);
assert.equal(base.freedShare, 49.9);
assert.equal(base.limitMiB, null);
assert.equal(base.ratioToFill, null);
assert.equal(base.capped, false);
assert.equal(base.overTwice, false);
assert.deepEqual(base.warnings, []);
assert.equal(base.sizeToken, '8G');
assert.equal(base.memToken, null);

// ---- A disk-backed swap would return the same pages but spend the disk instead.
assert.ok(Math.abs((base.usableMiB - base.footprintMiB) - base.freedMiB) < 1e-6,
  'freed is the pages stored minus what zram keeps');
assert.ok(Math.abs((base.footprintMiB - base.compressedMiB) - base.metadataMiB) < 1e-6,
  'RAM used is compressed data plus metadata');

// ---- Compression ratio: 3:1 keeps a third, 4:1 a quarter.
const three = plan({ ram: '8192', size: '100', ratio: '3', mem: '0' });
assert.equal(three.compressedMiB, 2730.67);
assert.equal(three.freedMiB, 5453.14);
assert.equal(three.freedShare, 66.6);
const four = plan({ ram: '16384', size: '50', ratio: '4', mem: '40' });
assert.equal(four.compressedMiB, 2048);
assert.equal(four.freedMiB, 6135.81);
assert.equal(four.ratioToFill, 1.25, 'a 40 % limit covers a 4:1 device');
assert.equal(four.capped, false);
assert.deepEqual(four.warnings, []);

// ---- mem_limit caps the memory zram may use; the metadata comes out first.
const capped = plan({ ram: '16384', size: '100', ratio: '2', mem: '25' });
assert.equal(capped.limitMiB, 4096);
assert.equal(capped.ratioToFill, 4.02, '4,079.616 MiB of room must hold 16 GiB at 2:1');
assert.equal(capped.usableMiB, 8159.23, 'the limit holds 8,159.232 MiB of pages at 2:1');
assert.equal(capped.compressedMiB, 4079.62);
assert.equal(capped.footprintMiB, 4096, 'compressed data plus metadata is exactly the limit');
assert.equal(capped.freedMiB, 4063.23);
assert.equal(capped.capped, true);
assert.equal(capped.warnings.length, 1);
assert.match(capped.warnings[0], /holds only .* of the .* device/);
assert.match(capped.warnings[0], /4\.02:1 would fill it/);

// ---- An unset limit is the only zero; one percent is a real limit.
assert.equal(plan({ ram: '16384', size: '50', ratio: '2', mem: '0' }).limitMiB, null);
assert.equal(plan({ ram: '16384', size: '50', ratio: '2', mem: '1' }).limitMiB, 163.84);

// ---- The device may be larger than RAM, but the page says it is wasteful.
const twice = plan({ ram: '2048', size: '200', ratio: '2', mem: '0' });
assert.equal(twice.swapMiB, 4096);
assert.equal(twice.overTwice, false, 'exactly twice RAM is the documented ceiling, not over it');
assert.deepEqual(twice.warnings, []);
const overTwice = plan({ ram: '2048', size: '201', ratio: '2', mem: '0' });
assert.equal(overTwice.swapMiB, 4116.48);
assert.equal(overTwice.overTwice, true);
assert.equal(overTwice.warnings.length, 1);
assert.match(overTwice.warnings[0], /larger than twice RAM \(4 GiB\)/);

// ---- Incompressible data: 1:1 stores the pages as they are, so the metadata is a net cost.
const flat = plan({ ram: '4096', size: '50', ratio: '1', mem: '0' });
assert.equal(flat.compressedMiB, 2048);
assert.equal(flat.freedMiB, -2.05);
assert.equal(flat.freedShare, -0.1);
assert.equal(flat.warnings.length, 1);
assert.match(flat.warnings[0], /Below 1\.5:1 little RAM is saved/);
assert.equal(plan({ ram: '4096', size: '50', ratio: '1.49', mem: '0' }).warnings.length, 1,
  'just below 1.5:1 warns');
assert.equal(plan({ ram: '4096', size: '50', ratio: '1.5', mem: '0' }).warnings.length, 0,
  'exactly 1.5:1 is the documented band edge and does not warn');
assert.equal(plan({ ram: '4096', size: '50', ratio: '1.51', mem: '0' }).warnings.length, 0);

// ---- Tokens: whole gibibytes keep the G form, everything else is floored to whole MiB.
assert.equal(C.sizeToken(8192), '8G');
assert.equal(C.sizeToken(1024), '1G');
assert.equal(C.sizeToken(1025), '1025M');
assert.equal(C.sizeToken(25.6), '25M', 'a device size is never rounded up');
assert.equal(C.sizeToken(2.56), '2M', 'the same for a mem_limit');
assert.equal(C.sizeToken(0.5), '1M', 'a command never asks for a zero size');

// ---- The parser refuses rather than guesses; a decimal comma is accepted.
assert.equal(refused({ ram: '', size: '50', ratio: '2.0', mem: '0' }),
  'Enter the RAM size in MiB, such as 16384.');
assert.equal(refused({ ram: '16g', size: '50', ratio: '2.0', mem: '0' }),
  'Enter the RAM size as a whole number of MiB, such as 16384.');
assert.equal(refused({ ram: '128', size: '50', ratio: '2.0', mem: '0' }),
  'Enter the RAM size from 256 to 4,194,304 MiB.');
assert.equal(refused({ ram: '4194305', size: '50', ratio: '2.0', mem: '0' }),
  'Enter the RAM size from 256 to 4,194,304 MiB.');
assert.equal(refused({ ram: '16384', size: '9', ratio: '2.0', mem: '0' }),
  'Enter the device size from 10 to 400 % of RAM.');
assert.equal(refused({ ram: '16384', size: '50.5', ratio: '2.0', mem: '0' }),
  'Enter the device size as a whole percentage of RAM, such as 50.');
assert.equal(refused({ ram: '16384', size: '50', ratio: '0.5', mem: '0' }),
  'Enter the compression ratio from 1.0 to 20.0.');
assert.equal(refused({ ram: '16384', size: '50', ratio: '21', mem: '0' }),
  'Enter the compression ratio from 1.0 to 20.0.');
assert.equal(refused({ ram: '16384', size: '50', ratio: '', mem: '0' }),
  'Enter the compression ratio, such as 2.0.');
assert.equal(refused({ ram: '16384', size: '50', ratio: 'two', mem: '0' }),
  'Enter the compression ratio as a number, such as 2.0.');
assert.equal(refused({ ram: '16384', size: '50', ratio: '2.0', mem: '401' }),
  'Enter the memory limit from 0 to 400 % of RAM, where 0 means no limit.');
assert.equal(refused({ ram: '16384', size: '50', ratio: '2.0', mem: '-1' }),
  'Enter the memory limit as a whole percentage of RAM, such as 25, or 0 for no limit.');

const comma = plan({ ram: '16384', size: '50', ratio: ' 2,5 ', mem: '0' });
assert.equal(comma.ratio, 2.5, 'a decimal comma and surrounding spaces are accepted');
assert.equal(comma.compressedMiB, 3276.8);

// ---- Independent rebuild of the arithmetic in exact hundredths of a MiB.
const exact = (ram, size, ratio, mem) => {
  const swap = ram * size / 100;
  const meta = swap / 1000;
  const limit = mem > 0 ? ram * mem / 100 : null;
  if (limit === null) return { swap, meta, usable: swap, room: null };
  const room = limit - meta;
  return { swap, meta, usable: Math.min(swap, room * ratio), room };
};
for (const [ram, size, ratio, mem] of [[16384, 50, 2, 0], [8192, 100, 3, 0], [1024, 25, 2.5, 0],
  [16384, 100, 2, 25], [16384, 50, 4, 40], [2048, 200, 2, 0], [4096, 50, 1, 0], [512, 50, 2.2, 0]]) {
  const got = plan({ ram: String(ram), size: String(size), ratio: String(ratio), mem: String(mem) });
  const ref = exact(ram, size, ratio, mem);
  assert.ok(Math.abs(got.swapMiB - ref.swap) < 0.005, 'device size ' + ram + '/' + size);
  assert.ok(Math.abs(got.metadataMiB - ref.meta) < 0.005, 'metadata ' + ram + '/' + size);
  assert.ok(Math.abs(got.usableMiB - ref.usable) < 0.005, 'usable ' + ram + '/' + size);
  assert.ok(Math.abs(got.compressedMiB - ref.usable / ratio) < 0.005, 'compressed ' + ram + '/' + size);
  assert.ok(Math.abs(got.freedMiB - (ref.usable - ref.usable / ratio - ref.meta)) < 0.005,
    'freed ' + ram + '/' + size);
  assert.ok(got.footprintMiB > got.compressedMiB, 'the metadata table is always added');
  assert.ok(Math.abs(got.footprintMiB - (ref.usable / ratio + ref.meta)) < 0.01,
    'RAM used is compressed data plus metadata ' + ram + '/' + size);
}

// ---- A sweep over the ratio range: the saving rises with the ratio and never exceeds the pages.
for (let ratio = 1; ratio <= 20; ratio += 0.5) {
  const got = plan({ ram: '8192', size: '100', ratio: String(ratio), mem: '0' });
  assert.ok(got.freedMiB < got.usableMiB, 'the saving is below the pages stored at ' + ratio);
  if (ratio > 1) {
    const lower = plan({ ram: '8192', size: '100', ratio: String(ratio - 0.5), mem: '0' });
    assert.ok(got.freedMiB > lower.freedMiB, 'a higher ratio frees more at ' + ratio);
  }
}

// ---- The independent fixtures, rebuilt in Python from the documented rules.
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/zram_swap_cases.json'), 'utf8'));
assert.ok(fixtures.cases.length >= 12, 'the fixture set covers defaults, limits, the ceiling and the floor');
for (const item of fixtures.cases) {
  const actual = plan(item.input);
  for (const [key, value] of Object.entries(item.expected)) {
    if (key === 'warnings') continue;
    assert.deepEqual(actual[key], value, item.name + ': ' + key);
  }
  assert.equal(actual.warnings.length, item.warningCount, item.name + ': warning count');
  assert.ok(actual.footprintMiB >= actual.compressedMiB, item.name + ': metadata is never negative');
}

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug appears once');
assert.equal(record.name, 'ZRAM Swap Planner');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(typeof record.method, 'string', 'method is a plain string');
assert.equal(typeof record.guidance, 'string', 'guidance is a plain string');
assert.ok(record.sources.length >= 2);
for (const source of record.sources) assert.match(source.url, /^https:\/\//);
const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 4, validation: 8 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(refused(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = plan(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(actual[key], value, testCase.name + ': ' + key);
  }
}

// ---- Uniqueness across the catalog: name and aliases stay distinct.
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
assert.match(html, /<h1>ZRAM Swap Planner<\/h1>/);
assert.match(html, /<form id="zram-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
for (const id of ['ram', 'size', 'ratio', 'mem']) {
  assert.match(html, new RegExp('<label for="' + id + '">'), 'label for ' + id);
}
assert.match(html, /<input id="ram"[^>]*value="16384"/);
assert.match(html, /<input id="size"[^>]*value="50"/);
assert.match(html, /<input id="ratio"[^>]*value="2\.0"/);
assert.match(html, /<input id="mem"[^>]*value="0"/);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(/.test(html), 'no network calls');
assert.ok(!/<iframe|<img|<canvas|<svg/.test(html), 'no embedded media');
assert.match(html, /aria-hidden="true"/, 'the usage bar is decorative');
assert.match(html, /nothing is sent anywhere else/i, 'the privacy note stays on the page');
assert.equal((html.match(/\/\* zram-core:start \*\//g) || []).length, 1);

console.log('zram-swap-planner: metadata at 0.1 %, mem_limit and ratio-to-fill, the twice-RAM ceiling, '
  + 'the 1:1 floor, tokens, refusals, ' + fixtures.cases.length + ' fixtures, '
  + record.testCases.length + ' catalog cases, uniqueness and page contract OK');
