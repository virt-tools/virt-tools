/* Regression checks for the chess-clock state machine in its shipped page. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/chess-clock/index.html'), 'utf8');
const start = html.indexOf('/* clock:start */');
const end = html.indexOf('/* clock:end */');
assert.ok(start > -1 && end > start, 'clock core markers missing');
const core = html.slice(start, end + '/* clock:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CLOCK;', sandbox);
const CLOCK = sandbox.module.exports;

function runCase(tc) {
  const inp = tc.input;
  if (inp.formatMs) return { labels: inp.formatMs.map((ms) => CLOCK.formatTime(ms)) };
  const baseMs = inp.baseSeconds * 1000;
  const incMs = inp.incrementSeconds * 1000;
  const state = CLOCK.makeState(baseMs);
  let t = 0;
  for (const ev of inp.events) {
    const [cmd, arg] = ev.split(':');
    if (cmd === 'run') {
      t += Number(arg);
      CLOCK.tick(state, t);
    } else if (cmd === 'start') {
      assert.equal(CLOCK.start(state, t), true, 'start refused');
    } else if (cmd === 'press') {
      CLOCK.press(state, arg === 'White' ? 0 : 1, t, incMs);
    } else if (cmd === 'pause') {
      CLOCK.pause(state, t);
    } else if (cmd === 'resume') {
      CLOCK.resume(state, t);
    } else if (cmd === 'reset') {
      CLOCK.reset(state, baseMs);
    } else {
      throw new Error('unknown event ' + ev);
    }
  }
  return {
    display: [CLOCK.formatTime(state.remaining[0]), CLOCK.formatTime(state.remaining[1])],
    active: CLOCK.SIDES[state.active],
    moves: state.moves,
    running: state.running,
    paused: state.paused,
    started: state.started,
    flagged: state.flagged < 0 ? null : CLOCK.SIDES[state.flagged]
  };
}

const doc = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = doc.tools.find((t) => t.slug === 'chess-clock');
assert.ok(entry, 'catalog entry missing');
assert.ok(entry.testCases.length >= 6, 'catalog needs at least six vectors');

let checked = 0;
for (const tc of entry.testCases) {
  const got = runCase(tc);
  for (const [key, want] of Object.entries(tc.expected)) {
    const actual = got[key];
    if (Array.isArray(want)) {
      assert.deepEqual(JSON.parse(JSON.stringify(actual)), want, `${tc.name}: ${key} -> ${JSON.stringify(actual)}`);
    } else if (want === null) {
      assert.equal(actual, null, `${tc.name}: ${key} -> ${actual}`);
    } else {
      assert.equal(actual, want, `${tc.name}: ${key} -> ${actual}`);
    }
  }
  checked += 1;
}

/* Invariants beyond the catalog vectors. */
{
  const s = CLOCK.makeState(300000);
  assert.equal(CLOCK.tick(s, 5000), -1, 'idle tick must not flag');
  assert.equal(CLOCK.pause(s, 1000), false, 'pause while idle must be refused');
  assert.equal(CLOCK.resume(s, 1000), false, 'resume while idle must be refused');
  assert.equal(CLOCK.press(s, 1, 1000, 3000), false, 'Black cannot start the game');
  assert.equal(CLOCK.press(s, 0, 2000, 3000), true, 'White starts');
  assert.equal(CLOCK.start(s, 2000), false, 'start cannot restart');
  assert.equal(CLOCK.press(s, 0, 3000, 3000), true, 'White presses');
  assert.equal(s.remaining[1], 303000, 'increment lands on the next player');
  assert.equal(CLOCK.pause(s, 4000), true);
  const frozen = s.remaining[1];
  assert.equal(CLOCK.tick(s, 60000), -1);
  assert.equal(s.remaining[1], frozen, 'paused clock must not run');
  assert.equal(CLOCK.press(s, 1, 61000, 3000), false, 'paused game must ignore presses');
}
{
  const s = CLOCK.makeState(5000);
  CLOCK.start(s, 0);
  CLOCK.tick(s, 5000);
  assert.equal(s.flagged, 0);
  assert.equal(s.remaining[0], 0);
  assert.equal(CLOCK.press(s, 0, 5001, 3000), false, 'flagged game must ignore presses');
  assert.equal(CLOCK.pause(s, 5001), false, 'flagged game cannot pause');
  CLOCK.reset(s, 5000);
  assert.equal(s.flagged, -1);
  assert.equal(s.started, false);
  assert.equal(s.running, false);
  assert.deepEqual(Array.from(s.remaining), [5000, 5000]);
}
{
  for (const ms of [-1, -5000, 0, 99, 100, 999, 1000, 9999, 10000, 59999, 60000, 3599999]) {
    const label = CLOCK.formatTime(ms);
    assert.match(label, /^(\d+):\d\d(\.\d)?$/, `bad label for ${ms}: ${label}`);
  }
  const s = CLOCK.makeState(60000);
  CLOCK.start(s, 0);
  for (let i = 0; i < 400; i++) CLOCK.press(s, s.active, 0, 60000);
  assert.match(CLOCK.formatTime(s.remaining[s.active]), /^\d+:\d\d$/);
}

console.log(`chess clock: ${checked} catalog vectors plus invariants passed`);
