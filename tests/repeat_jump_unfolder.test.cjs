/* Regression checks for the repeat and jump unfolder core and its catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/repeat-jump-unfolder/index.html'), 'utf8');
const start = html.indexOf('/* repeat-jump-core:start */');
const end = html.indexOf('/* repeat-jump-core:end */');
assert.ok(start > -1 && end > start, 'repeat jump core markers missing');
const core = html.slice(start, end + '/* repeat-jump-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RepeatJumpCore;', sandbox);
const C = sandbox.module.exports;

const same = (actual, expected, message) =>
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'repeat-jump-unfolder');
assert.ok(entry, 'catalog entry missing');
assert.equal(catalog.tools.length, 2523, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2262, 'public tools');
assert.ok(entry.testCases.length >= 30, `expected at least 30 cases, found ${entry.testCases.length}`);

// Replay every catalog case: refusals by exact message, results by the documented fields.
for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(
      () => C.calculate(testCase.input),
      (error) => {
        assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
        return true;
      },
      `${label}: expected a refusal`
    );
    continue;
  }
  const plan = C.calculate(testCase.input);
  same(plan.order, testCase.expected.order, `${label}: played order`);
  assert.equal(plan.totalBars, testCase.expected.totalBars, `${label}: total bars`);
  assert.equal(plan.firstPassBars, testCase.expected.firstPassBars, `${label}: first pass bars`);
  assert.equal(plan.jumpPassBars, testCase.expected.jumpPassBars, `${label}: jump pass bars`);
  assert.equal(plan.totalBars, plan.firstPassBars + plan.jumpPassBars, `${label}: passes add up`);
  assert.equal(plan.entries.length, plan.order.length, `${label}: one entry per play`);
  assert.equal(plan.entries.length, plan.playCount, `${label}: play count`);
  assert.equal(plan.sectionCount, plan.sectionNames.length, `${label}: section count`);
  let cursor = 0;
  for (const played of plan.entries) {
    assert.equal(played.startBar, cursor + 1, `${label}: contiguous bar start`);
    assert.equal(played.endBar, cursor + played.bars, `${label}: contiguous bar end`);
    assert.ok(plan.sectionNames.includes(played.name), `${label}: section exists`);
    cursor += played.bars;
  }
  assert.equal(cursor, plan.totalBars, `${label}: bar cursor`);
  if (plan.roadmap === 'none') assert.equal(plan.jumpPassBars, 0, `${label}: no jump bars`);
}

// The example is a D.C. al Fine over the five-section default list.
const plan = C.calculate({ roadmap: 'dc-fine', fine: 'Chorus' });
same(plan.order.join(','), 'Intro,Verse,Verse,Chorus,Bridge,Outro,Intro,Verse,Chorus', 'example order');
assert.equal(plan.totalBars, 84, 'example total');
assert.equal(plan.firstPassBars, 56, 'example first pass');
assert.equal(plan.jumpPassBars, 28, 'example jump pass');
assert.equal(plan.entries[1].repeat, 1, 'first Verse is repeat one');
assert.equal(plan.entries[2].repeat, 2, 'second Verse is repeat two');
assert.equal(plan.entries[8].endBar, 84, 'the last entry ends on the final bar');

// A coda is entered only after the jump, and the jump ignores written repeats by default.
const coda = C.calculate({
  sections: [
    { name: 'A', bars: 4, repeats: 1 },
    { name: 'B', bars: 8, repeats: 2 },
    { name: 'C', bars: 4, repeats: 1 },
    { name: 'D', bars: 4, repeats: 1 },
  ],
  roadmap: 'dc-coda', toCoda: 'C', coda: 'D',
});
same(coda.order, ['A', 'B', 'B', 'C', 'A', 'B', 'C', 'D'], 'coda order');
assert.equal(coda.totalBars, 44, 'coda total');
assert.equal(coda.jumpPassBars, 20, 'coda jump pass');

// With repeats on the jump pass, the same coda carries the second B.
const codaRepeats = C.calculate({
  sections: [
    { name: 'A', bars: 4, repeats: 1 },
    { name: 'B', bars: 8, repeats: 2 },
    { name: 'C', bars: 4, repeats: 1 },
    { name: 'D', bars: 4, repeats: 1 },
  ],
  roadmap: 'dc-coda', toCoda: 'C', coda: 'D', repeatPassRepeats: true,
});
same(codaRepeats.order, ['A', 'B', 'B', 'C', 'A', 'B', 'B', 'C', 'D'], 'coda repeat order');
assert.equal(codaRepeats.totalBars, 52, 'coda repeat total');

// The slug, name, aliases and tags stay unique against the rest of the catalog.
const others = catalog.tools.filter((tool) => tool.slug !== entry.slug);
const folded = new Set();
for (const tool of others) {
  folded.add(tool.slug);
  folded.add(tool.name.toLowerCase());
  for (const alias of tool.aliases || []) folded.add(alias.toLowerCase());
}
assert.ok(!folded.has(entry.slug), 'slug collides');
assert.ok(!folded.has(entry.name.toLowerCase()), 'name collides');
for (const alias of entry.aliases) assert.ok(!folded.has(alias.toLowerCase()), `alias collides: ${alias}`);
assert.ok(entry.tags.includes('repeat') && entry.tags.includes('coda'));
assert.equal(entry.category, 'Music');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Music').length, 57, 'Music count');
assert.equal(entry.listed, true);
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.ok(entry.sources.length >= 2);
assert.ok(entry.sources.every((source) => source.url && source.url.startsWith('https://')), 'https sources');
assert.ok(entry.sources.some((source) => source.url.includes('Da_capo')), 'D.C. cited');
assert.ok(entry.sources.some((source) => source.url.includes('Dal_segno')), 'D.S. cited');
assert.ok(entry.sources.some((source) => source.url.includes('Repeat_sign')), 'repeat signs cited');

// Page contract: the shared shell, labelled controls, and no network or dynamic-code sinks.
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.match(html, /href="\/assets\/style\.css"/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.equal((html.match(/<h1>/g) || []).length, 1);
assert.ok(!/\beval\s*\(/.test(html), 'eval is not allowed');
assert.ok(!/new\s+Function\s*\(/.test(html), 'new Function is not allowed');
assert.ok(!/\.innerHTML\s*=/.test(html), 'innerHTML is not allowed');
assert.ok(!/XMLHttpRequest|fetch\(|sendBeacon|WebSocket/.test(html), 'no network calls');
const pageUrls = (html.match(/https?:\/\/[^\s"'<>]+/g) || []).filter((url) => !url.includes('www.w3.org'));
assert.deepEqual(pageUrls, [], 'page markup is offline');
for (const id of ['roadmap', 'segno', 'fine', 'tocoda', 'coda', 'repeat-pass']) {
  assert.ok(html.includes(`for="${id}"`) || html.includes(`id="${id}"`), `control ${id}`);
}
for (const id of ['error', 'results', 'total-bars', 'timeline-list']) {
  assert.ok(html.includes(`id="${id}"`), `container ${id}`);
}
assert.ok(!/<button(?![^>]*\btype=)/.test(html), 'every button declares a type');
assert.match(html, /role="alert"/);
assert.match(html, /aria-live="polite"/);
assert.ok(!/\bsrc="\/(?!assets\/)/.test(html), 'only shared assets are loaded');

console.log(`repeat jump unfolder: ${entry.testCases.length} catalog cases replayed`);
