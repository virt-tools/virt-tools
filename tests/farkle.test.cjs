'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { scoreSet, bestSelection, FarkleGame } = require('../frontend/assets/farkle.js');

function gameWith(rolls, target = 5000) {
  const values = rolls.flat();
  return new FarkleGame(target, () => {
    assert.ok(values.length, 'Unexpected extra dice roll');
    return (values.shift() - 0.5) / 6;
  });
}
function select(game, indices) { indices.forEach(index => game.toggle(index)); }

test('house scoring: singles, full groups, combinations and boundaries', () => {
  for (const [dice, score] of [
    [[1], 100], [[5], 50], [[1, 5], 150], [[1, 1, 1], 1000],
    [[2, 2, 2, 5, 1], 350], [[3, 3, 3, 3], 600],
    [[4, 4, 4, 4, 4], 1600], [[1, 1, 1, 1, 1, 1], 8000],
    [[1, 2, 3, 4, 5, 6], 1500], [[2, 2, 4, 4, 6, 6], 750],
    [[2, 2, 2, 6, 6, 6], 800], [[1, 1, 1, 5, 5, 5], 1500],
  ]) assert.equal(scoreSet(dice), score, String(dice));
  for (const dice of [[], [2], [1, 2], [2, 2, 2, 4], [0], [7], [1.5], ['1'], [NaN], Array(7).fill(1), null]) {
    assert.equal(scoreSet(dice), 0, String(dice));
  }
});

test('best hold excludes non-scoring and previously kept dice', () => {
  assert.deepEqual(bestSelection([2, 2, 2, 4, 5, 6], Array(6).fill(false)), { indices: [0, 1, 2, 4], score: 250 });
  assert.equal(bestSelection([1, 2, 3, 4, 6, 2], [true, false, false, false, false, false]).score, 0);
});

test('two players bank separately; new turns cannot reuse dice', () => {
  const game = gameWith([[1, 2, 3, 4, 6, 2], [5, 2, 3, 4, 6, 2]]);
  game.toggle(0);
  assert.equal(game.bank().type, 'invalid');
  game.roll(); select(game, [0]); game.bank();
  assert.equal(game.player, 1);
  assert.deepEqual(game.scores, [100, 0]);
  assert.equal(game.bank().type, 'invalid');
  game.roll(); select(game, [0]); game.bank();
  assert.equal(game.player, 0);
  assert.deepEqual(game.scores, [100, 50]);
  assert.deepEqual(game.dice, Array(6).fill(null));
});

test('invalid selection cannot bank or reroll; triples can be selected incrementally', () => {
  const game = gameWith([[2, 2, 2, 4, 5, 6]]);
  game.roll(); select(game, [0]);
  assert.equal(game.roll().type, 'invalid');
  assert.equal(game.bank().type, 'invalid');
  select(game, [1, 2]); assert.equal(game.selectionScore, 200);
  game.toggle(3); assert.equal(game.bank().type, 'invalid');
  game.toggle(3); game.toggle(-1); game.toggle(6); game.toggle(1.5);
  game.bank(); assert.deepEqual(game.scores, [200, 0]);
});

test('rerolls lock scored dice and accumulate each selection only once', () => {
  const game = gameWith([[1, 2, 3, 4, 6, 2], [5, 2, 3, 4, 6]]);
  game.roll(); select(game, [0]); game.roll();
  assert.equal(game.turnScore, 100);
  assert.equal(game.kept[0], true);
  game.toggle(0); assert.equal(game.selected.size, 0);
  select(game, [1]); game.bank();
  assert.deepEqual(game.scores, [150, 0]);
});

test('farkle loses accumulated turn points and passes to the other player', () => {
  const game = gameWith([[1, 2, 3, 4, 6, 2], [2, 3, 4, 6, 2], [2, 3, 4, 6, 2, 3]]);
  game.roll(); select(game, [0]);
  assert.equal(game.roll().type, 'farkle');
  assert.equal(game.player, 1); assert.equal(game.turnScore, 0);
  assert.equal(game.roll().type, 'farkle');
  assert.equal(game.player, 0); assert.deepEqual(game.scores, [0, 0]);
});

test('hot dice reroll all six and retain the previous roll score', () => {
  const game = gameWith([[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 6, 2]]);
  game.roll(); select(game, [0, 1, 2, 3, 4, 5]); game.roll();
  assert.equal(game.turnScore, 1500); assert.ok(game.kept.every(value => !value));
  select(game, [0]); game.bank(); assert.deepEqual(game.scores, [1600, 0]);
});

test('either player wins at the target; further actions cannot change the result', () => {
  for (const player of [0, 1]) {
    const game = gameWith([[1, 1, 1, 1, 5, 5]], 3000);
    game.player = player; game.scores[player] = 900;
    game.roll(); select(game, [0, 1, 2, 3, 4, 5]); game.bank();
    assert.equal(game.scores[player], 3000); assert.equal(game.winner, player);
    assert.equal(game.roll().type, 'finished'); assert.equal(game.bank().type, 'finished');
    game.toggle(0); assert.equal(game.selected.size, 0);
  }
  assert.equal(new FarkleGame(NaN).target, 5000);
});
