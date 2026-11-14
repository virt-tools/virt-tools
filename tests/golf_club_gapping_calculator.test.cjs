/* Regression checks for the golf club gapping core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'golf-club-gapping-calculator';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* golf-gap-core:start */');
const end = html.indexOf('/* golf-gap-core:end */');
assert.ok(start > -1 && end > start, 'golf gap core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '\nmodule.exports = GolfGap;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Sports & Outdoors');
assert.equal(entry.subcategory, 'Golf');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.icon, '\u{1F3CC}\uFE0F');
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 8, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 3, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 800, 'method documented');
assert.equal(catalog.tools.length, 2280, 'catalog total');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Sports & Outdoors').length, 45, 'Sports & Outdoors count');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');
const aliases = catalog.tools.flatMap((tool) => (tool.slug === slug ? [] : tool.aliases || []))
  .map((alias) => alias.toLowerCase());
for (const alias of entry.aliases) {
  assert.ok(!aliases.includes(alias.toLowerCase()), `alias ${alias} is already used`);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && /gapping|carry distance|yardage gap|club gap/i
  .test([tool.name, ...(tool.aliases || [])].join(' '))), 'no other gapping tool');

const failure = (input) => {
  try {
    C.compute(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
const close = (left, right, tolerance = 1e-9) =>
  assert.ok(Math.abs(Number(left) - Number(right)) <= tolerance, `${left} != ${right}`);
const round1 = (value) => C.round(value, 1);
const shownSame = (left, right, label) => {
  if (left === null || right === null) {
    assert.equal(left, right, `${label}: null mismatch`);
    return;
  }
  assert.ok(Math.abs(round1(left) - round1(right)) < 1e-9, `${label}: ${left} != ${right}`);
};

// --- Constants, flags and the fixed club list. ---
assert.equal(C.MIN_CLUBS, 2);
assert.equal(C.MAX_CLUBS, 14);
assert.equal(C.HOLE_YD, 15);
assert.equal(C.TIGHT_YD, 8);
assert.equal(C.TWIN_YD, 3);
assert.equal(C.M_PER_YD, 0.9144);
close(C.YD_PER_M, 1.0936132983377078, 1e-12);
assert.equal(C.CLUBS.length, 19);
assert.equal(new Set(C.CLUBS.map((club) => club.key)).size, 19, 'club keys unique');
assert.equal(new Set(C.CLUBS.map((club) => club.label)).size, 19, 'club labels unique');
assert.equal(C.flagFor(15), 'ok');
assert.equal(C.flagFor(15.01), 'wide');
assert.equal(C.flagFor(8), 'ok');
assert.equal(C.flagFor(7.99), 'tight');
assert.equal(C.flagFor(3), 'tight');
assert.equal(C.flagFor(2.99), 'twin');

// --- Every catalog case must agree with the core. ---
let goldenCount = 0;
let boundaryCount = 0;
let validationCount = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    validationCount += 1;
    assert.equal(failure(testCase.input), testCase.expectedError, `${testCase.name}: validation message`);
    continue;
  }
  if (testCase.kind === 'golden') goldenCount += 1;
  else if (testCase.kind === 'boundary') boundaryCount += 1;
  else assert.fail(`unexpected test kind ${testCase.kind}`);
  const result = C.compute(testCase.input);
  const expected = testCase.expected;
  assert.equal(result.count, expected.count, `${testCase.name}: club count`);
  close(result.longest, expected.longest, 1e-6);
  close(result.shortest, expected.shortest, 1e-6);
  close(result.span, expected.span, 1e-6);
  assert.equal(round1(result.averageGap), expected.averageGap, `${testCase.name}: average gap`);
  assert.equal(round1(result.widestGap), expected.widestGap, `${testCase.name}: widest gap`);
  assert.equal(round1(result.narrowestGap), expected.narrowestGap, `${testCase.name}: narrowest gap`);
  assert.equal(result.holes, expected.holes, `${testCase.name}: wide gaps`);
  assert.equal(result.tights, expected.tights, `${testCase.name}: tight gaps`);
  assert.equal(result.twins, expected.twins, `${testCase.name}: twins`);
  assert.equal(result.clubs.length, expected.clubs.length, `${testCase.name}: rows`);
  for (let index = 0; index < expected.clubs.length; index += 1) {
    const row = result.clubs[index];
    const want = expected.clubs[index];
    assert.equal(row.key, want.key, `${testCase.name}: row ${index} key`);
    assert.equal(row.label, want.label, `${testCase.name}: row ${index} label`);
    assert.equal(row.flag, want.flag, `${testCase.name}: row ${index} flag`);
    shownSame(row.carry, want.carry, `${testCase.name}: row ${index} carry`);
    shownSame(row.gap, want.gap, `${testCase.name}: row ${index} gap`);
    shownSame(row.ideal, want.ideal, `${testCase.name}: row ${index} ideal`);
    shownSame(row.offIdeal, want.offIdeal, `${testCase.name}: row ${index} off ideal`);
  }
}
assert.equal(goldenCount, 6, 'expected six golden cases');
assert.equal(boundaryCount, 6, 'expected six boundary cases');
assert.equal(validationCount, 12, 'expected twelve validation cases');

// --- Three hundred generated sets against the algebraic relations. ---
let seed = 20261114n;
const MOD = 2147483648n;
const random = () => {
  seed = (seed * 1103515245n + 12345n) % MOD;
  return Number(seed) / 2147483648;
};
const pool = C.CLUBS.map((club) => club.key);
let sweeps = 0;
for (let index = 0; index < 300; index += 1) {
  const unit = random() < 0.3 ? 'm' : 'yd';
  const count = 2 + Math.floor(random() * 13);
  const picked = [];
  while (picked.length < count) {
    const key = pool[Math.floor(random() * pool.length)];
    if (!picked.includes(key)) picked.push(key);
  }
  const bounds = C.BOUNDS[unit];
  const clubs = picked.map((key) => ({
    key,
    distance: (bounds.min + random() * (bounds.max - bounds.min) * 0.75).toFixed(1)
  }));
  const result = C.compute({ unit, clubs });
  const scale = unit === 'm' ? C.YD_PER_M : 1;
  assert.equal(result.count, count, 'club count');
  let sum = 0;
  for (let row = 0; row < result.clubs.length; row += 1) {
    const current = result.clubs[row];
    assert.equal(round1(current.carry), Number(clubs[picked.indexOf(current.key)].distance),
      'carry echoes the typed distance');
    shownSame(current.ideal, result.longest - row * result.averageGap, 'ideal step');
    shownSame(current.offIdeal, current.carry - current.ideal, 'off ideal');
    if (row > 0) {
      assert.ok(result.clubs[row - 1].carry >= current.carry, 'sorted longest first');
    }
    if (row === result.clubs.length - 1) {
      assert.equal(current.flag, 'end', 'the shortest club has no gap');
      assert.equal(current.gap, null);
    } else {
      sum += current.gap;
      const gapYd = current.gap * scale;
      const expectedFlag = gapYd > 15 ? 'wide' : (gapYd < 3 ? 'twin' : (gapYd < 8 ? 'tight' : 'ok'));
      assert.equal(current.flag, expectedFlag, 'flag follows the yard gap');
    }
  }
  close(sum, result.span, 1e-6);
  close(result.span, result.longest - result.shortest, 1e-6);
  close(result.averageGap * (count - 1), result.span, 1e-6);
  const gaps = result.clubs.map((row) => row.gap).filter((gap) => gap !== null);
  close(result.widestGap, Math.max(...gaps), 1e-6);
  close(result.narrowestGap, Math.min(...gaps), 1e-6);
  const flagCounts = { wide: 0, tight: 0, twin: 0, ok: 0, end: 0 };
  for (const row of result.clubs) flagCounts[row.flag] += 1;
  assert.equal(flagCounts.end, 1, 'only the shortest club ends the list');
  assert.equal(flagCounts.wide, result.holes, 'every wide gap counted');
  assert.equal(flagCounts.tight, result.tights, 'every tight gap counted');
  assert.equal(flagCounts.twin, result.twins, 'every twin counted');
  assert.equal(Object.values(flagCounts).reduce((sum, value) => sum + value, 0), count, 'every club classified');
  assert.equal(result.warnings.length, Number(result.holes > 0) + Number(result.tights + result.twins > 0),
    'one caution per threshold');
  assert.equal(result.notes.filter((line) => line.includes('carry within')).length, result.twins,
    'one twin note per twin pair');
  for (const line of result.warnings) {
    assert.ok(result.notes.includes(line), 'every warning also appears in the notes');
  }
  assert.ok(result.notes.some((line) => line.startsWith('Compare carry with carry')), 'carry note');
  sweeps += 1;
}
assert.equal(sweeps, 300, 'three hundred generated sets');

// --- Behaviour the sweeps cannot reach reliably. ---
const tour = C.compute({
  unit: 'yd',
  clubs: [
    { key: 'driver', distance: '250' }, { key: '3-wood', distance: '225' }, { key: '5-iron', distance: '180' },
    { key: '6-iron', distance: '168' }, { key: '7-iron', distance: '155' }, { key: '8-iron', distance: '143' },
    { key: '9-iron', distance: '130' }, { key: 'pitching-wedge', distance: '115' }
  ]
});
close(tour.span, 135, 1e-9);
close(tour.averageGap, 135 / 7, 1e-9);
close(tour.widestGap, 45, 1e-9);
assert.equal(tour.widestPair.upper, '3-wood');
assert.equal(tour.widestPair.lower, '5-iron');
assert.equal(tour.holes, 2, 'the 25 and the 45 yard gaps are both wide');
assert.equal(tour.clubs[0].ideal, 250, 'the longest club sits on the ideal');
close(tour.clubs[6].offIdeal, 130 - (250 - 6 * (135 / 7)), 1e-9);

const two = C.compute({ unit: 'yd', clubs: [{ key: 'driver', distance: '250' }, { key: 'lob-wedge', distance: '60' }] });
assert.equal(two.count, 2);
assert.equal(two.holes, 1);
close(two.narrowestGap, 190, 1e-9);
close(two.averageGap, 190, 1e-9);
assert.equal(two.clubs[0].flag, 'wide');

const twins = C.compute({
  unit: 'yd',
  clubs: [{ key: 'driver', distance: '200' }, { key: '3-wood', distance: '198' }, { key: '5-wood', distance: '160' }]
});
assert.equal(twins.twins, 1);
assert.ok(twins.notes.some((line) => line.includes('Driver and 3-wood carry within 3 yd')), 'twin note');
assert.equal(twins.holes, 1, 'the 38 yard gap is wide');

const metric = C.compute({
  unit: 'm',
  clubs: [{ key: 'driver', distance: '228' }, { key: '5-iron', distance: '165' }, { key: '9-iron', distance: '119' }]
});
close(metric.span, 109, 1e-9);
close(metric.averageGap, 54.5, 1e-9);
close(metric.widestGap, 63, 1e-9);
assert.equal(metric.thresholds.hole, 15 * C.M_PER_YD, 'the hole threshold in metres');
close(metric.thresholds.hole, 13.716, 1e-9);

const ordered = C.compute({
  unit: 'yd',
  clubs: [{ key: '5-iron', distance: '170' }, { key: 'driver', distance: '240' }]
});
assert.equal(ordered.clubs[0].key, 'driver', 'sorted longest first regardless of typing order');

const ties = C.compute({
  unit: 'yd',
  clubs: [{ key: 'driver', distance: '180' }, { key: '3-wood', distance: '180' }]
});
assert.equal(ties.clubs[0].key, 'driver', 'ties keep the typed order');
assert.equal(ties.twins, 1);
close(ties.span, 0, 1e-12);

// --- Page contract. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'), 'live status region');
for (const id of ['unit', 'club-body', 'add', 'calculate', 'reset', 'gap-status', 'widest-out', 'widest-sub',
  'stat-count', 'stat-longest', 'stat-shortest', 'stat-span', 'stat-average', 'stat-narrowest', 'gap-body',
  'copy', 'copy-status', 'notes', 'mode-cap', 'gap-note', 'row-cap']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or output ${id}`);
}
assert.ok(/<form id="gap-form" novalidate>/.test(html), 'form contract');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(/<option value="yd" selected>/.test(html), 'yards selected by default');
assert.ok(/id="copy"[^>]*disabled/.test(html), 'copy starts disabled');
assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(html), 'no raw HTML sinks');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'no browser storage');
assert.ok(!/https?:\/\//.test(html.replace(/<meta name="description"[^>]*>/, '')), 'no external requests');
assert.ok(!/\bfetch\(|XMLHttpRequest/.test(html), 'no network calls');
assert.ok(!/\beval\s*\(|new Function\s*\(/.test(html), 'no runtime compilation');
assert.ok(!/\son[a-z]+\s*=/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no inline handlers');

console.log(`${slug}: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed; ` +
  `${sweeps} generated sets, the 15/8/3 yard flags, the metric conversion, the sort order, tie handling and the ` +
  'page contract agreed');
