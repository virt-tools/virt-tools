/* Regression checks for the bingo card generator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/bingo-card-generator/index.html'), 'utf8');
const start = html.indexOf('/* bingo-core:start */');
const end = html.indexOf('/* bingo-core:end */');
assert.ok(start > -1 && end > start, 'bingo core markers missing');
const core = html.slice(start, end + '/* bingo-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BingoCore;', sandbox);
const B = sandbox.module.exports;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const words = Array.from({ length: 30 }, (_, i) => 'Word ' + (i + 1));
const flat = (cells) => Array.from(cells).filter((cell) => cell !== null);
const key = (cells) => cells.map((cell) => (cell === null ? '~' : cell)).join('|');

// Parsing: trim, collapse whitespace, drop blanks and case-insensitive duplicates.
const parsed = B.parseEntries('  Apple \n\napple\nBanana\tSplit\n   banana split   \n');
assert.deepEqual(Array.from(parsed.entries), ['Apple', 'Banana Split']);
assert.equal(parsed.duplicates, 2);
assert.equal(parsed.error, '');

assert.equal(B.parseEntries('').entries.length, 0);
assert.equal(B.parseEntries(null).entries.length, 0);

// Control characters are normalised rather than treated as content.
assert.deepEqual(Array.from(B.parseEntries('Tab\u0000here\u001fnow').entries), ['Tab here now']);

// Over-long entries are rejected with a message instead of being truncated.
const longEntry = B.parseEntries('x'.repeat(B.MAX_LENGTH + 1));
assert.equal(longEntry.entries.length, 0);
assert.match(longEntry.error, /40 characters or fewer/);
assert.equal(B.parseEntries('x'.repeat(B.MAX_LENGTH)).entries.length, 1);

// Capacity is bounded.
const tooMany = Array.from({ length: B.MAX_ENTRIES + 2 }, (_, i) => 'E' + i).join('\n');
const capped = B.parseEntries(tooMany);
assert.equal(capped.entries.length, 0);
assert.match(capped.error, /up to 500 entries/);

// Required entry counts.
assert.equal(B.requiredCount(5, true), 24);
assert.equal(B.requiredCount(5, false), 25);
assert.equal(B.requiredCount(4, false), 16);
assert.equal(B.requiredCount(3, true), 8);
assert.equal(B.centreIndex(5), 12);
assert.equal(B.centreIndex(3), 4);

// A full 5x5 card with free space.
const cards = B.buildCards(words, 5, true, 6, mulberry32(42));
assert.equal(cards.length, 6);
for (const cells of cards) {
  assert.equal(cells.length, 25);
  assert.equal(cells[12], null);
  const used = flat(cells);
  assert.equal(used.length, 24);
  assert.equal(new Set(used).size, 24, 'a card repeats an entry');
  for (const word of used) assert.ok(words.includes(word), 'card used an unknown entry');
}
assert.equal(new Set(cards.map(key)).size, 6, 'cards must have distinct layouts');

// Determinism: the same seed rebuilds identical cards.
assert.deepEqual(cards.map(key), B.buildCards(words, 5, true, 6, mulberry32(42)).map(key));
assert.notDeepEqual(cards.map(key), B.buildCards(words, 5, true, 6, mulberry32(43)).map(key));

// With exactly the required entries every card must contain the whole list.
const exact = words.slice(0, 24);
const exactCards = B.buildCards(exact, 5, true, 3, mulberry32(7));
for (const cells of exactCards) {
  assert.deepEqual(flat(cells).slice().sort(), exact.slice().sort());
}
assert.equal(new Set(exactCards.map(key)).size, 3, 'identical cards with an exact-size list');

// 4x4 without a free space and 3x3 with one.
const four = B.buildCards(words, 4, false, 2, mulberry32(9));
assert.equal(four[0].length, 16);
assert.equal(new Set(flat(four[0])).size, 16);
const three = B.buildCards(words, 3, true, 2, mulberry32(9));
assert.equal(three[0].length, 9);
assert.equal(three[0][4], null);
assert.equal(flat(three[0]).length, 8);

// Rejections: too few entries, wrong geometry, out-of-range counts.
assert.throws(() => B.buildCards(words.slice(0, 23), 5, true, 1, mulberry32(1)), /at least 24 entries/);
assert.throws(() => B.buildCards(words, 4, true, 1, mulberry32(1)), /no single centre/);
assert.throws(() => B.buildCards(words, 2, false, 1, mulberry32(1)), /3 × 3, 4 × 4 or 5 × 5/);
assert.throws(() => B.buildCards(words, 5, false, 0, mulberry32(1)), /1 to 30 cards/);
assert.throws(() => B.buildCards(words, 5, false, B.MAX_CARDS + 1, mulberry32(1)), /1 to 30 cards/);

// The call list is a shuffle of the whole list, not a subset.
const calls = B.callList(words, mulberry32(5));
assert.equal(calls.length, words.length);
assert.deepEqual(Array.from(calls).sort(), words.slice().sort());
assert.notDeepEqual(Array.from(calls), words);

console.log('bingo card generator: all checks passed');
