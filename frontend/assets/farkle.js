(function () {
  'use strict';

  // A selection is valid only when every selected die contributes to its score.
  function scoreSet(values) {
    if (!Array.isArray(values) || !values.length || values.length > 6
        || values.some(value => !Number.isInteger(value) || value < 1 || value > 6)) return 0;
    const counts = Array(7).fill(0);
    values.forEach(value => counts[value]++);
    if (values.length === 6 && counts.slice(1).every(count => count === 1)) return 1500;
    if (counts.slice(1).filter(count => count === 2).length === 3) return 750;
    let score = 0;
    for (let face = 1; face <= 6; face++) {
      const count = counts[face];
      if (count >= 3) score += (face === 1 ? 1000 : face * 100) * 2 ** (count - 3);
      else if (face === 1 || face === 5) score += count * (face === 1 ? 100 : 50);
      else if (count) return 0;
    }
    return score;
  }

  function bestSelection(dice, kept) {
    let best = { indices: [], score: 0 };
    for (let mask = 1; mask < 2 ** dice.length; mask++) {
      const indices = dice.map((_, index) => index).filter(index => mask & (1 << index));
      if (indices.some(index => kept[index])) continue;
      const score = scoreSet(indices.map(index => dice[index]));
      if (score > best.score) best = { indices, score };
    }
    return best;
  }

  class FarkleGame {
    constructor(target = 5000, random = Math.random) {
      this.target = [3000, 5000, 10000].includes(target) ? target : 5000;
      this.random = random;
      this.scores = [0, 0];
      this.player = 0;
      this.winner = null;
      this.resetTurn();
    }

    resetTurn() {
      this.dice = Array(6).fill(null);
      this.kept = Array(6).fill(false);
      this.selected = new Set();
      this.turnScore = 0;
      this.rolled = false;
    }

    get selectionScore() {
      return scoreSet([...this.selected].map(index => this.dice[index]));
    }

    toggle(index) {
      if (this.winner !== null || !this.rolled || !Number.isInteger(index)
          || index < 0 || index >= 6 || this.kept[index]) return;
      if (this.selected.has(index)) this.selected.delete(index);
      else this.selected.add(index);
    }

    roll() {
      if (this.winner !== null) return { type: 'finished' };
      if (this.rolled) {
        if (!this.selectionScore) return { type: 'invalid' };
        this.turnScore += this.selectionScore;
        this.selected.forEach(index => { this.kept[index] = true; });
        if (this.kept.every(Boolean)) this.kept.fill(false); // Hot dice: roll all six again.
      }
      this.selected.clear();
      this.dice = this.dice.map((value, index) => this.kept[index] ? value : Math.floor(this.random() * 6) + 1);
      this.rolled = true;
      if (!bestSelection(this.dice, this.kept).score) return this.endTurn('farkle', 0);
      return { type: 'roll' };
    }

    bank() {
      if (this.winner !== null) return { type: 'finished' };
      if (!this.rolled || !this.selectionScore) return { type: 'invalid' };
      return this.endTurn('bank', this.turnScore + this.selectionScore);
    }

    endTurn(type, points) {
      const player = this.player;
      this.scores[player] += points;
      if (this.scores[player] >= this.target) this.winner = player;
      else this.player = 1 - player;
      this.resetTurn();
      return { type, player, points };
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { scoreSet, bestSelection, FarkleGame };
  if (typeof document === 'undefined') return;

  const byId = id => document.getElementById(id);
  let game;
  let aiTimer;
  const isLocal = () => byId('mode').value === 'local';
  const playerName = player => isLocal() ? 'Player ' + (player + 1) : (player === 0 ? 'You' : 'AI');
  const humanTurn = () => game.winner === null && (isLocal() || game.player === 0);
  const prompt = () => isLocal() ? playerName(game.player) + ': your turn. Roll the dice.'
    : (game.player === 0 ? 'Your turn. Roll the dice.' : 'AI is playing…');
  const buttons = Array.from({ length: 6 }, (_, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'die';
    button.addEventListener('click', () => {
      if (!humanTurn()) return;
      game.toggle(index);
      byId('msg').textContent = game.selected.size && !game.selectionScore
        ? 'Select a complete scoring group; every selected die must score.'
        : 'Keep scoring dice, then roll again or bank.';
      render();
    });
    byId('dice-area').appendChild(button);
    return button;
  });

  function render() {
    byId('p1-label').textContent = playerName(0);
    byId('p2-label').textContent = playerName(1);
    byId('p1').textContent = game.scores[0];
    byId('p2').textContent = game.scores[1];
    byId('turn-score').textContent = game.turnScore;
    byId('current-player').textContent = game.winner === null ? playerName(game.player) + ' to play' : 'Game over';
    byId('bankable').textContent = game.selectionScore;
    byId('bank-amt').textContent = game.turnScore + game.selectionScore;
    byId('roll-btn').disabled = !humanTurn() || (game.rolled && !game.selectionScore);
    byId('bank-btn').disabled = !humanTurn() || !game.selectionScore;
    buttons.forEach((button, index) => {
      const kept = game.kept[index];
      const selected = game.selected.has(index);
      const value = game.dice[index];
      button.textContent = value === null ? '–' : '⚀⚁⚂⚃⚄⚅'[value - 1];
      button.classList.toggle('held', selected);
      button.classList.toggle('kept', kept);
      button.disabled = !humanTurn() || !game.rolled || kept;
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', 'Die ' + (index + 1) + (value === null ? ', not rolled' : ': ' + value)
        + (kept ? ', set aside' : ''));
    });
  }

  function showResult(result) {
    if (game.winner !== null) {
      byId('msg').textContent = (isLocal() ? playerName(game.winner) + ' wins!' : (game.winner === 0 ? 'You win!' : 'AI wins!'))
        + ' ' + game.scores[0] + ' – ' + game.scores[1];
    } else if (result.type === 'bank' || result.type === 'farkle') {
      byId('msg').textContent = playerName(result.player)
        + (result.type === 'bank' ? ' banked ' + result.points + ' points. ' : ' farkled! No points banked. ')
        + prompt();
    } else if (result.type === 'invalid') {
      byId('msg').textContent = 'Select scoring dice first; every selected die must score.';
    } else byId('msg').textContent = 'Select scoring dice, then roll again or bank.';
    render();
  }

  function scheduleAI() {
    clearTimeout(aiTimer);
    if (!isLocal() && game.player === 1 && game.winner === null) aiTimer = setTimeout(aiStep, 650);
  }

  function aiStep() {
    if (isLocal() || game.player !== 1 || game.winner !== null) return;
    const result = game.roll();
    if (result.type === 'farkle') { showResult(result); return; }
    game.selected = new Set(bestSelection(game.dice, game.kept).indices);
    if (game.turnScore + game.selectionScore >= 500 || Math.random() < 0.5) showResult(game.bank());
    else { byId('msg').textContent = 'AI is rolling again…'; render(); scheduleAI(); }
  }

  function newGame() {
    clearTimeout(aiTimer);
    game = new FarkleGame(Number(byId('target').value));
    byId('msg').textContent = prompt();
    render();
  }

  byId('roll-btn').addEventListener('click', () => {
    if (!humanTurn()) return;
    showResult(game.roll());
    scheduleAI();
  });
  byId('bank-btn').addEventListener('click', () => {
    if (!humanTurn()) return;
    showResult(game.bank());
    scheduleAI();
  });
  byId('new-game').addEventListener('click', newGame);
  byId('mode').addEventListener('change', newGame);
  byId('target').addEventListener('change', newGame);
  newGame();
}());
