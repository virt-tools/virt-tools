/* double elimination planner: catalog fixtures, bracket structure against an independent pairing
   simulation, block scheduling arithmetic and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'double-elimination-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* double-elim-core:start */';
const endMarker = '/* double-elim-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = DoubleElimCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one double elimination planner');
const record = records[0];
assert.equal(record.name, 'Double Elimination Planner');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.equal(new Set(record.tags).size, record.tags.length);
assert.equal(new Set(record.aliases).size, record.aliases.length);
assert.ok(record.method.length > 1200, 'method documents the brackets, the block schedule and the exclusions');
assert.equal(record.sources.length, 1);
assert.match(record.sources[0].url, /^https:\/\/en\.wikipedia\.org\/wiki\/Double-elimination_tournament$/);
assert.ok(record.sources[0].title.length > 40, 'source title names the document and the part used');
assert.equal(record.testCases.length, 16);
assert.equal(record.testCases.filter((t) => t.kind === 'golden').length, 6);
assert.equal(record.testCases.filter((t) => t.kind === 'boundary').length, 4);
assert.equal(record.testCases.filter((t) => t.kind === 'validation').length, 6);
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug appears exactly once');
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name, record.name, 'name collides with ' + other.slug);
  for (const alias of other.aliases || []) {
    assert.ok(!record.aliases.includes(alias), 'alias collides with ' + other.slug + ': ' + alias);
  }
}

// Replay every published case.
function failure(input) {
  try { C.build(input); } catch (error) { return error.message; }
  return null;
}
const EXPECTED_KEYS = ['teams', 'rounds', 'winnersMatches', 'losersMatches', 'finals', 'totalMatches',
  'longestPath', 'slots', 'makespanMinutes', 'floorSlots', 'floorMinutes', 'stationMinutes'];
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.build(testCase.input);
  for (const key of EXPECTED_KEYS) {
    if (testCase.expected[key] !== undefined) assert.equal(result[key], testCase.expected[key], `${testCase.name}: ${key}`);
  }
  for (const fragment of testCase.expected.contains || []) {
    assert.ok(result.planText.includes(fragment), `${testCase.name}: plan text missing ${JSON.stringify(fragment)}`);
  }
  assert.equal(result.blocks.length, result.rounds, testCase.name + ' block count');
  assert.equal(result.blocks.reduce((sum, block) => sum + block.matches, 0), result.totalMatches, testCase.name + ' block sum');
  assert.equal(result.blocks[result.blocks.length - 1].bracket, 'final');
}

// Independent pairing simulation: walk the tokens through the brackets and count what is actually played.
// It shares no arithmetic with the page's closed forms (the page derives round sizes from n and r).
function simulate(teams) {
  const levels = Math.log2(teams);
  const losses = new Map();
  const sizes = [];
  const drop = (id) => {
    const next = (losses.get(id) || 0) + 1;
    assert.ok(next <= 2, 'a team cannot lose three times: ' + id);
    losses.set(id, next);
  };
  let winners = Array.from({length: teams}, (_, index) => index);
  let losers = [];
  for (let round = 1; round <= levels; round += 1) {
    const advanced = [];
    const dropped = [];
    for (let i = 0; i < winners.length; i += 2) {
      advanced.push(winners[i]);
      dropped.push(winners[i + 1]);
      drop(winners[i + 1]);
    }
    sizes.push(winners.length / 2);
    winners = advanced;
    if (round === 1) {
      const survivors = [];
      for (let i = 0; i < dropped.length; i += 2) {
        survivors.push(dropped[i]);
        drop(dropped[i + 1]);
      }
      sizes.push(dropped.length / 2);
      losers = survivors;
      continue;
    }
    const majors = [];
    for (let i = 0; i < losers.length; i += 1) {
      majors.push(losers[i]);
      drop(dropped[i]);
    }
    assert.equal(losers.length, dropped.length, 'major stage pairs equal halves');
    sizes.push(losers.length);
    losers = majors;
    if (round < levels) {
      const minors = [];
      for (let i = 0; i < losers.length; i += 2) {
        minors.push(losers[i]);
        drop(losers[i + 1]);
      }
      sizes.push(losers.length / 2);
      losers = minors;
    }
  }
  return {levels, sizes, winners: winners[0], losers: losers[0], losses};
}
for (const teams of C.SIZES) {
  const sim = simulate(teams);
  const plan = C.build({teams: String(teams), minutes: '30', stations: '2', final: 'single'});
  assert.equal(sim.levels, Math.log2(teams));
  assert.equal(plan.winnersRounds, sim.levels);
  assert.equal(plan.losersRounds, 2 * sim.levels - 2);
  assert.equal(plan.blocks.length - 1, sim.sizes.length, teams + ': every simulated block is planned');
  for (let index = 0; index < sim.sizes.length; index += 1) {
    assert.equal(plan.blocks[index].matches, sim.sizes[index], `${teams} teams: block ${index + 1} match count`);
  }
  assert.equal(plan.rounds, 3 * sim.levels - 1, teams + ': three blocks per level minus one');
  assert.equal(plan.winnersMatches + plan.losersMatches, sim.sizes.reduce((a, b) => a + b, 0));
  assert.equal(plan.totalMatches, 2 * teams - 2, teams + ': published game count');
  assert.equal(plan.totalMatches, teams * 2 - 2);
  assert.equal(C.build({teams: String(teams), minutes: '30', stations: '2', final: 'reset'}).totalMatches, 2 * teams - 1);
  // Everyone but the unbeaten winners-bracket champion has lost: the losers-bracket finalist once, the rest twice.
  assert.equal(sim.losses.size, teams - 1, teams + ': only the winners-bracket champion is unbeaten');
  for (const [id, count] of sim.losses) {
    if (id === sim.losers) assert.equal(count, 1, teams + ': the losers-bracket champion lost once');
    else assert.equal(count, 2, teams + ': eliminated team ' + id + ' lost twice');
  }
  assert.equal(sim.losses.has(sim.winners), false, teams + ': the winners-bracket champion is unbeaten');
  assert.equal(sim.losses.get(sim.losers), 1, teams + ': the losers-bracket champion has one defeat');
  // Longest route: the first-round loser who wins the title plays one winners match, every losers round, the final.
  assert.equal(plan.longestPath, 2 * sim.levels);
  assert.equal(C.build({teams: String(teams), minutes: '30', stations: '2', final: 'reset'}).longestPath, 2 * sim.levels + 1);
  // Drop map: a major losers round takes exactly the losers of the matching winners round.
  for (const block of plan.blocks) {
    if (block.bracket !== 'losers' || block.stage !== 'major') continue;
    const winnersRound = block.round / 2 + 1;
    assert.ok(new RegExp('losers? of winners round ' + winnersRound + '\\b').test(block.players), block.name + ' drop source');
  }
}

// Block scheduling is a closed form over the per-block counts.
for (const teams of C.SIZES) {
  for (const stations of [1, 2, 3, 5, 8, 16]) {
    const plan = C.build({teams: String(teams), minutes: '30', stations: String(stations), final: 'single'});
    const slots = plan.blocks.reduce((sum, block) => sum + Math.ceil(block.matches / stations), 0);
    assert.equal(plan.slots, slots, `${teams} teams on ${stations} stations: block slots`);
    assert.equal(plan.makespanMinutes, slots * 30);
    assert.equal(plan.floorSlots, Math.ceil(plan.totalMatches / stations));
    assert.equal(plan.floorMinutes, plan.floorSlots * 30);
    assert.ok(plan.floorSlots <= plan.slots, 'the packing floor never exceeds the block plan');
    for (const block of plan.blocks) {
      assert.equal(block.slots, Math.ceil(block.matches / stations));
      assert.equal(block.blockMinutes, block.slots * 30);
      assert.ok(block.matches >= 1 && Number.isInteger(block.matches), 'matches are whole');
    }
  }
}
// Station time is match count times length, independent of the station count.
const perStation = [1, 4, 16].map((stations) => C.build({teams: '16', minutes: '45', stations: String(stations)}).stationMinutes);
assert.deepEqual(perStation, [perStation[0], perStation[0], perStation[0]]);

// Numeric input from the page's own parse path and from callers that pass numbers.
assert.equal(C.build({teams: 8, minutes: 30, stations: 2}).totalMatches, 14);
assert.ok(failure({teams: 12}) === C.TEAM_MESSAGE);
assert.ok(failure({teams: 7}) === C.TEAM_MESSAGE);
assert.ok(failure({teams: '8.0'}) === C.TEAM_MESSAGE);
assert.ok(failure({minutes: 30.5}) === C.MINUTES_MESSAGE);
assert.ok(failure({minutes: 181}) === C.MINUTES_MESSAGE);
assert.ok(failure({minutes: NaN}) === C.MINUTES_MESSAGE);
assert.ok(failure({minutes: Infinity}) === C.MINUTES_MESSAGE);
assert.ok(failure({minutes: ' 30 '}) === null, 'surrounding whitespace is tolerated');
assert.ok(failure({stations: 0}) === C.STATIONS_MESSAGE);
assert.ok(failure({stations: '99999'}) === C.STATIONS_MESSAGE);
assert.ok(failure({final: 'double'}) === C.FINAL_MESSAGE);
assert.ok(failure({final: ''}) === C.FINAL_MESSAGE);
assert.equal(C.formatMinutes(30), '30 min');
assert.equal(C.formatMinutes(60), '1 h');
assert.equal(C.formatMinutes(270), '4 h 30 min');
assert.equal(C.formatMinutes(5400), '90 h');

// Plan text is copyable and complete.
const plan = C.build({teams: '8', minutes: '30', stations: '2', final: 'single'});
const lines = plan.planText.split('\n');
assert.equal(lines[0], 'Double-elimination plan: 8 teams');
assert.equal(lines.filter((line) => /^\s*\d+\s+(?:Winners round|Losers round|Final)\b/.test(line)).length, plan.rounds);
assert.ok(plan.planText.includes('Longest route to the title: 6 matches'));
for (const block of plan.blocks) assert.ok(plan.planText.includes(block.name));

// Page contract: shared shell, keyboard-submittable form, accessible output, no foreign runtime.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html));
assert.ok(!/<script[^>]+src="https?:/i.test(html));
assert.ok(!/<link[^>]+href="https?:/i.test(html));
assert.ok(!/on(?:click|input|change|submit)=/i.test(html));
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html));
assert.ok(html.includes('<form id="plan-form" novalidate>'));
assert.ok(html.includes('type="submit"'));
assert.ok(html.includes('role="alert"'));
assert.ok(html.includes('role="status" aria-live="polite"'));
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.equal((html.match(/<h1>/g) || []).length, 1);
for (const id of html.matchAll(/\bid="([a-z0-9-]+)"/g)) {
  assert.equal((html.match(new RegExp('id="' + id[1] + '"', 'g')) || []).length, 1, 'duplicate id ' + id[1]);
}
for (const match of html.matchAll(/\$\("([a-z0-9-]+)"\)/g)) assert.ok(html.includes('id="' + match[1] + '"'), 'missing id ' + match[1]);
for (const id of ['in-teams', 'in-final', 'in-minutes', 'in-stations']) assert.ok(html.includes('for="' + id + '"'), 'missing label ' + id);
assert.ok(html.includes('data-label'), 'stacked cells keep their header label');
for (const value of ['4', '8', '16', '32']) assert.ok(html.includes('<option value="' + value + '"'), 'team option ' + value);
assert.ok(html.includes('<option value="single"') && html.includes('<option value="reset"'), 'final options');
assert.ok(html.includes('id="in-minutes" value="30"') && html.includes('id="in-stations" value="2"'), 'defaults are prefilled');
assert.ok(html.includes('id="in-teams"') && /<option value="8" selected>/.test(html), 'eight teams is the default field');
console.log('double-elimination-planner: 16 catalog cases, pairing simulation for 4-32 teams, block scheduling arithmetic and page contract passed');
