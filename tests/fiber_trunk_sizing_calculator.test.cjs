/* Fiber trunk sizing: the pair/strand/trunk arithmetic from an independent
   round-up simulation, the connector conventions, the best-fit comparison,
   validation messages, the catalog record and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'fiber-trunk-sizing-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* fts-core:start */';
const endMarker = '/* fts-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = FtsCore;', sandbox);
const C = sandbox.module.exports;

const failure = (fn) => {
  try { fn(); } catch (error) { return error.message; }
  return null;
};
const near = (got, expected, label, tolerance = 1e-9) =>
  assert.ok(Math.abs(got - expected) <= tolerance, label + ': got ' + got + ', expected ' + expected);
const run = (input) => C.compute(input);

// ---- Independent round-up: count pairs upward until the allowance is covered.
const pairsByCounting = (circuits, spareTenths) => {
  const target = circuits * (1000 + spareTenths); // pairs x 1000 must reach this
  let pairs = 0;
  while (pairs * 1000 < target) pairs += 1;
  return pairs;
};

// ---- Constants.
assert.deepEqual(Array.from(C.FIBER_OPTIONS), [8, 12, 24]);
assert.equal(C.MAX_CIRCUITS, 100000);

// ---- Golden cases, each also re-derived from the pair counter and the ceilings.
const golden = [
  ['48 circuits, 25 percent, 12-fiber', { circuits: '48', spare: '25', fibers: '12' },
    60, 120, 10, 120, 0, 1],
  ['10 circuits, no spare, 12-fiber', { circuits: '10', spare: '0', fibers: '12' },
    10, 20, 2, 24, 4, 20 / 24],
  ['one circuit, 8-fiber', { circuits: '1', spare: '0', fibers: '8' },
    1, 2, 1, 8, 6, 0.25],
  ['48 circuits, 12.5 percent, 24-fiber', { circuits: '48', spare: '12.5', fibers: '24' },
    54, 108, 5, 120, 12, 0.9],
  ['96 circuits, 50 percent, 24-fiber', { circuits: '96', spare: '50', fibers: '24' },
    144, 288, 12, 288, 0, 1],
  ['37 circuits, 10 percent, 8-fiber', { circuits: '37', spare: '10', fibers: '8' },
    41, 82, 11, 88, 6, 82 / 88],
];
for (const [label, input, pairs, strands, trunks, installed, unused, utilization] of golden) {
  const got = run(input);
  assert.equal(got.pairs, pairs, label + ' pairs');
  assert.equal(got.pairs, pairsByCounting(Number(input.circuits), Math.round(Number(input.spare) * 10)), label + ' pairs from the counter');
  assert.equal(got.strandsRequired, strands, label + ' strands');
  assert.equal(got.strandsInstalled, trunks * Number(input.fibers), label + ' installed');
  assert.equal(got.trunks, Math.ceil(strands / Number(input.fibers)), label + ' trunks');
  assert.equal(got.spareStrands, installed - strands, label + ' unused');
  near(got.utilization, utilization, label + ' utilisation');
  assert.equal(got.mpoConnectors, 2 * got.trunks, label + ' MPO connectors');
  assert.equal(got.lcDuplexAdapters, got.strandsInstalled, label + ' adapters equal installed strands');
  assert.equal(got.lcConnectors, 2 * got.strandsInstalled, label + ' LC connectors at both ends');
  assert.equal(got.pairsSupplied, got.strandsInstalled / 2, label + ' one pair per two strands');
  near(got.utilization, got.strandsRequired / got.strandsInstalled, label + ' utilisation definition');
}

// ---- Invariants across the range: installed strands are whole trunks, cover the
// requirement, and never exceed it by a full trunk.
for (let circuits = 1; circuits <= 200; circuits += 13) {
  for (const spare of ['0', '0.1', '7.5', '33', '99.9', '100']) {
    for (const fibers of ['8', '12', '24']) {
      const got = run({ circuits: String(circuits), spare, fibers });
      assert.equal(got.strandsInstalled % Number(fibers), 0, 'installed strands are whole trunks');
      assert.ok(got.strandsInstalled >= got.strandsRequired, 'the trunk covers the requirement');
      assert.ok(got.strandsInstalled - got.strandsRequired < Number(fibers), 'no more than one trunk of slack');
      assert.equal(got.spareStrands, got.strandsInstalled - got.strandsRequired, 'unused strands');
      assert.ok(got.utilization > 0 && got.utilization <= 1, 'utilisation stays in range');
      assert.equal(got.pairs * 2, got.strandsRequired, 'two strands per duplex pair');
    }
  }
}

// ---- The best-fit comparison picks the least waste and prefers the larger trunk.
const best = run({ circuits: '96', spare: '0', fibers: '12' });
assert.deepEqual(JSON.parse(JSON.stringify(best.bestFit)), { fibers: 24, trunks: 8, installed: 192, waste: 0 },
  'an exact 24-fiber fit wins over the same waste on a smaller trunk');
const wasteful = run({ circuits: '37', spare: '10', fibers: '24' });
assert.equal(wasteful.bestFit.waste, 2, '82 strands fit 4 x 24 with 14 unused, 7 x 12 with 2 unused');
assert.equal(wasteful.bestFit.fibers, 12, 'the 12-fiber option is the leanest');
for (const fibers of C.FIBER_OPTIONS) {
  const option = C.planFor(wasteful.strandsRequired, fibers);
  assert.ok(wasteful.bestFit.waste <= option.waste, 'no option beats the reported best fit');
}

// ---- Validation: each message names the field that failed.
assert.equal(failure(() => run({ circuits: '', spare: '25', fibers: '12' })),
  'Enter the number of duplex circuits to serve.');
assert.equal(failure(() => run({ circuits: '0', spare: '25', fibers: '12' })),
  'Duplex circuits must be at least 1.');
assert.equal(failure(() => run({ circuits: '4.5', spare: '25', fibers: '12' })),
  'Duplex circuits must be a whole number, such as 48.');
assert.equal(failure(() => run({ circuits: 'abc', spare: '25', fibers: '12' })),
  'Duplex circuits must be a whole number, such as 48.');
assert.equal(failure(() => run({ circuits: '100001', spare: '25', fibers: '12' })),
  'Duplex circuits must be 100,000 or fewer.');
assert.equal(failure(() => run({ circuits: '48', spare: '', fibers: '12' })),
  'Enter a spare capacity from 0 to 100 percent.');
assert.equal(failure(() => run({ circuits: '48', spare: '-5', fibers: '12' })),
  'Spare capacity must be a percentage with at most one decimal place, such as 25 or 12.5.');
assert.equal(failure(() => run({ circuits: '48', spare: '100.5', fibers: '12' })),
  'Spare capacity cannot exceed 100 percent.');
assert.equal(failure(() => run({ circuits: '48', spare: '12.55', fibers: '12' })),
  'Spare capacity must be a percentage with at most one decimal place, such as 25 or 12.5.');
assert.equal(failure(() => run({ circuits: '48', spare: '25', fibers: '16' })),
  'Choose a trunk of 8, 12 or 24 fibers.');
assert.equal(failure(() => run({ circuits: '48', spare: '25', fibers: '' })),
  'Choose a trunk of 8, 12 or 24 fibers.');
assert.equal(failure(() => run({})), 'Enter the number of duplex circuits to serve.');
assert.equal(failure(() => run({ circuits: '48', spare: '25', fibers: '12', junk: 1 })), null,
  'extra keys are ignored');

// ---- A comma decimal separator is accepted for the spare allowance.
assert.equal(run({ circuits: '10', spare: '12,5', fibers: '12' }).pairs, 12);

// ---- Catalog record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(record.name, 'Fiber Trunk Sizing Calculator');
assert.equal(record.category, 'IT & Networking');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.tags.includes('fiber-optic'), 'the fiber tag');
assert.ok(record.tags.includes('mpo'), 'the MPO tag');
assert.ok(record.aliases.some((alias) => /mpo trunk/i.test(alias)), 'the MPO trunk alias');
assert.ok(Array.isArray(record.sources) && record.sources.length === 0,
  'planning arithmetic claims no standard, so no citation is invented');
assert.ok(record.method.includes('ceil(strands / fibers)'), 'method states the trunk rounding');
assert.ok(record.method.includes('strands / installed'), 'method states the utilisation');
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
}
assert.equal(catalog.tools.filter((tool) => tool.category === 'IT & Networking').length, 54, 'IT & Networking count');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2188, 'public tools');

// ---- Replay every case stored in the record.
for (const item of record.testCases) {
  if (item.kind === 'validation') {
    assert.equal(failure(() => run(item.input)), item.expected.error, 'replay ' + item.name);
    continue;
  }
  const got = run(item.input);
  for (const field of ['pairs', 'strandsRequired', 'trunks', 'strandsInstalled', 'spareStrands', 'utilization']) {
    if (item.expected[field] !== undefined) {
      if (field === 'utilization') { near(got[field], item.expected[field], 'replay ' + item.name); continue; }
      assert.equal(got[field], item.expected[field], 'replay ' + item.name + ' ' + field);
    }
  }
}

// ---- Page contract.
assert.ok(html.includes('<div id="site-header"></div>'), 'the shared header mount is present');
assert.ok(html.includes('/assets/app.js'), 'the shared shell script is loaded');
assert.ok(html.includes('/assets/style.css'), 'the shared stylesheet is loaded');
assert.ok(!/https?:\/\//.test(html), 'the page makes no third-party request');
assert.ok(!html.includes('\u0000'), 'no NUL bytes');
assert.ok(html.includes('<h1>Fiber Trunk Sizing Calculator</h1>'), 'the page heading');
assert.ok(html.includes('Nothing is uploaded'), 'the note stays local');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(core), 'the core touches no storage or network');
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'ids are unique');
for (const control of ['circuits', 'spare', 'fibers']) {
  assert.ok(new RegExp('<label\\b[^>]*\\bfor="' + control + '"').test(html), 'label for ' + control);
  assert.ok(ids.includes(control), 'control id ' + control);
}
for (const id of ['fts-form', 'err', 'out', 'facts']) {
  assert.ok(ids.includes(id), 'element id ' + id);
}
const options = [...html.matchAll(/<option value="(\d+)"/g)].map((match) => match[1]);
assert.deepEqual(options, ['8', '12', '24'], 'the three trunk sizes are offered');
assert.ok(html.includes('aria-live="polite"'), 'the result is announced');
assert.equal((html.match(/inputmode=/g) || []).length, 2, 'numeric keyboards on both text fields');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no external script');

console.log('fiber trunk sizing calculator: all checks passed');
