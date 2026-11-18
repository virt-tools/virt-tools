/* Regression checks for the Playing Time Rotation Planner core and its catalog record.
 *
 * The fairness, coverage and minute figures are recomputed here without reusing the page's
 * loop: totals come from floor/ceil of the slot count, the per-period sets are checked against
 * the water-filling invariant, and bench runs are rebuilt by scanning the rotation again.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'playing-time-rotation-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* playing-time-core:start */');
const end = html.indexOf('/* playing-time-core:end */');
assert.ok(start > -1 && end > start, 'playing-time core markers missing');
const core = html.slice(start, end + '/* playing-time-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PlayingTimeCore;', sandbox);
const raw = sandbox.module.exports;
const plan = (options) => JSON.parse(JSON.stringify(raw.plan(options)));

// ---- Independent properties over the whole input grid ---------------------
let plans = 0;
for (let squad = 2; squad <= 30; squad += 1) {
  for (let onField = 1; onField <= squad; onField += 1) {
    for (let periods = 1; periods <= 20; periods += 1) {
      const periodMinutes = 1 + ((squad * 7 + onField * 3 + periods) % 120);
      const result = plan({ squad, onField, periods, periodMinutes });
      assert.deepEqual(plan({ squad, onField, periods, periodMinutes }), result, 'deterministic');
      plans += 1;

      assert.equal(result.rotation.length, periods, 'one row per period');
      assert.equal(result.totalSlots, periods * onField, 'total slots');
      const seenOn = new Map();
      for (const row of result.rotation) {
        assert.equal(row.on.length, onField, 'on-field size');
        assert.equal(new Set(row.on).size, onField, 'no player twice in a period');
        assert.equal(row.on.length + row.bench.length, squad, 'on field plus resting is the squad');
        assert.deepEqual(
          row.bench,
          Array.from({ length: squad }, (_, i) => i + 1).filter((n) => !row.on.includes(n)),
          'resting is the complement of the field'
        );
        for (const n of row.on) {
          assert.ok(n >= 1 && n <= squad, 'player number in range');
          seenOn.set(n, (seenOn.get(n) || 0) + 1);
        }
      }

      // Slot count split: everyone gets floor or ceil of periods*onField/squad.
      const low = Math.floor((periods * onField) / squad);
      const high = Math.ceil((periods * onField) / squad);
      assert.equal(result.fairness.minPeriods, low, 'minimum periods');
      assert.equal(result.fairness.maxPeriods, high, 'maximum periods');
      assert.equal(result.fairness.gapPeriods, high - low, 'gap in periods');
      assert.equal(result.fairness.gapMinutes, (high - low) * periodMinutes, 'gap in minutes');
      assert.equal(result.fairness.minMinutes, low * periodMinutes, 'minimum minutes');
      assert.equal(result.fairness.maxMinutes, high * periodMinutes, 'maximum minutes');

      let sum = 0;
      for (const player of result.players) {
        sum += player.periodsOn;
        assert.equal(player.periodsOn, seenOn.get(player.number) || 0, 'periods on match the rotation');
        assert.equal(player.minutes, player.periodsOn * periodMinutes, 'minutes are whole periods');
        assert.deepEqual(
          player.periods,
          result.rotation.filter((row) => row.on.includes(player.number)).map((row) => row.period),
          'played period list'
        );

        const runs = [];
        let run = 0;
        for (const row of result.rotation) {
          if (row.on.includes(player.number)) {
            if (run > 0) runs.push(run);
            run = 0;
          } else {
            run += 1;
          }
        }
        if (run > 0) runs.push(run);
        assert.deepEqual(player.benchRuns, runs, 'bench runs recomputed');
        assert.equal(player.longestBench, runs.length ? Math.max(...runs) : 0, 'longest bench run');
        assert.equal(
          result.longestBench >= player.longestBench,
          true,
          'team longest bench run covers every player'
        );
      }
      assert.equal(sum, result.totalSlots, 'every slot belongs to a player');
      assert.equal(result.allPlay, onField === squad, 'all-play flag');
    }
  }
}

// ---- Water filling: no fresh player rests while a tired player plays ------
for (const [squad, onField, periods] of [[14, 7, 4], [7, 5, 3], [13, 5, 8], [30, 1, 10], [16, 11, 3], [9, 9, 2]]) {
  const result = plan({ squad, onField, periods, periodMinutes: 10 });
  const played = new Map(result.players.map((player) => [player.number, 0]));
  for (const row of result.rotation) {
    if (row.bench.length) {
      const onCounts = row.on.map((n) => played.get(n));
      const benchCounts = row.bench.map((n) => played.get(n));
      assert.ok(
        Math.max(...onCounts) <= Math.min(...benchCounts),
        `period ${row.period} plays a fresher player on the bench (${squad}/${onField}/${periods})`
      );
    }
    for (const n of row.on) played.set(n, played.get(n) + 1);
  }
}

// ---- Refusals -------------------------------------------------------------
const refusals = [
  [{ squad: 1, onField: 1, periods: 1, periodMinutes: 10 }, raw.MESSAGES.squad],
  [{ squad: 31, onField: 1, periods: 1, periodMinutes: 10 }, raw.MESSAGES.squad],
  [{ squad: 10.5, onField: 5, periods: 4, periodMinutes: 10 }, raw.MESSAGES.squad],
  [{ squad: '14', onField: 7, periods: 4, periodMinutes: 12 }, raw.MESSAGES.squad],
  [{ squad: 14, onField: 0, periods: 4, periodMinutes: 12 }, raw.MESSAGES.field],
  [{ squad: 14, onField: 15, periods: 4, periodMinutes: 12 }, raw.MESSAGES.field],
  [{ squad: 14, onField: 7, periods: 0, periodMinutes: 12 }, raw.MESSAGES.periods],
  [{ squad: 14, onField: 7, periods: 21, periodMinutes: 12 }, raw.MESSAGES.periods],
  [{ squad: 14, onField: 7, periods: 4, periodMinutes: 0 }, raw.MESSAGES.minutes],
  [{ squad: 14, onField: 7, periods: 4, periodMinutes: 121 }, raw.MESSAGES.minutes],
];
for (const [input, message] of refusals) {
  assert.throws(() => plan(input), (error) => error.message === message, 'refusal ' + JSON.stringify(input));
}

// ---- Catalog record -------------------------------------------------------
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record');
assert.equal(record.name, 'Playing Time Rotation Planner');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '🪑');
assert.ok(record.description.length > 100, 'description');
assert.ok(record.method.length > 600, 'method');
assert.deepEqual(record.sources, [], 'bespoke heuristic carries no citation');
for (const tag of record.tags) assert.equal(tag, tag.toLowerCase(), 'lowercase tags');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'unique aliases');

const ownValues = new Set([record.slug, record.name.toLowerCase(), ...record.aliases.map((a) => a.toLowerCase())]);
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  for (const value of [tool.slug, tool.name.toLowerCase(), ...tool.aliases.map((a) => a.toLowerCase())]) {
    assert.equal(ownValues.has(value), false, 'name, alias or slug already used: ' + value);
  }
}

const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2127, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Sports & Outdoors').length, 51, 'Sports count');

// Every recorded case replays exactly.
assert.equal(record.testCases.length, 12, 'recorded cases');
for (const testCase of record.testCases) {
  const input = testCase.input;
  const result = plan(input);
  assert.equal(result.rotation.length, input.periods, testCase.name + ': periods');
  assert.deepEqual(
    result.rotation.map((row) => ({ on: row.on, bench: row.bench })),
    testCase.expected.rotation,
    testCase.name + ': rotation'
  );
  assert.deepEqual(
    result.players.map((player) => [player.number, player.periodsOn, player.minutes, player.longestBench]),
    testCase.expected.players,
    testCase.name + ': players'
  );
  assert.deepEqual(
    {
      minPeriods: result.fairness.minPeriods,
      maxPeriods: result.fairness.maxPeriods,
      gapPeriods: result.fairness.gapPeriods,
      gapMinutes: result.fairness.gapMinutes,
    },
    testCase.expected.fairness,
    testCase.name + ': fairness'
  );
  assert.equal(result.longestBench, testCase.expected.longestBench, testCase.name + ': longest bench');
}

// ---- Page contract --------------------------------------------------------
assert.ok(html.includes('<html lang="en"'));
assert.ok(html.includes('name="viewport"'));
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.ok(html.includes('<main'));
assert.ok(html.includes('<h1>Playing Time Rotation Planner</h1>'));
for (const id of ['in-squad', 'in-field', 'in-periods', 'in-minutes', 'in-names', 'out']) {
  assert.ok(html.includes(`id="${id}"`), 'input ' + id);
  if (id !== 'out') assert.ok(html.includes(`for="${id}"`), 'label for ' + id);
}
assert.ok(html.includes('role="alert"'));
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('role="status"') || html.includes('setAttribute("role","status")'), 'live status region');
assert.ok(html.includes('scope="col"') || html.includes('setAttribute("scope","col")'), 'column headers');
assert.ok(/setAttribute\(["']data-label["']/.test(html), 'mobile row labels');
assert.ok(html.includes('<caption') || html.includes('el("caption"'), 'table captions');
const markup = html.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, '');
assert.equal(/\son[a-z]+\s*=/i.test(markup), false, 'no inline event handlers');
for (const banned of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'eval(', 'new Function']) {
  assert.equal(html.includes(banned), false, 'page must not use ' + banned);
}
assert.ok(html.includes('min-height:44px'), '44 px action targets');
assert.ok(html.includes('@media(max-width:520px)'), 'mobile layout');
assert.ok(html.includes('navigator.clipboard'), 'copy button');

console.log(
  'playing-time-rotation-planner: ' + plans + ' plans, ' + refusals.length + ' refusals, '
  + record.testCases.length + ' catalog cases'
);
