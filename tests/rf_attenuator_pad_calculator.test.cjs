/* Regression checks for the RF attenuator pad calculator: every catalog case is
   replayed against the page core, the closed-form resistor values are checked
   against an independent nodal solve of the network, the E96 fitting and the
   monotonic behaviour of the two topologies are pinned, and the page's offline
   and accessible contract is asserted. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'rf-attenuator-pad-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* attenuator-core:start */');
const end = html.indexOf('/* attenuator-core:end */');
assert.ok(start > -1 && end > start, 'attenuator core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = AttenuatorCore;', sandbox);
const A = sandbox.module.exports;

const design = (input) => A.design(input);
const failure = (input) => {
  try {
    design(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

function base(overrides) {
  return Object.assign({ topology: 'pi', db: '6', z0: '50' }, overrides || {});
}

// Independent route: solve the network node by node with a 1 V source behind
// Z0 and a Z0 load. A through connection would leave 0.5 V on the load, so the
// loss is 20 log10(0.5 / |Vout|) and the input impedance is V1 Z0 / (1 - V1).
function solve(matrix, rhs) {
  const size = rhs.length;
  const rows = matrix.map((row, index) => row.concat(rhs[index]));
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    for (let row = column + 1; row < size; row += 1) {
      const factor = rows[row][column] / rows[column][column];
      for (let entry = column; entry <= size; entry += 1) rows[row][entry] -= factor * rows[column][entry];
    }
  }
  const answer = new Array(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let total = rows[row][size];
    for (let column = row + 1; column < size; column += 1) total -= rows[row][column] * answer[column];
    answer[row] = total / rows[row][row];
  }
  return answer;
}

function nodal(topology, series, shunt, z0) {
  let matrix, rhs;
  if (topology === 'pi') {
    matrix = [
      [1 / z0 + 1 / shunt + 1 / series, -1 / series],
      [-1 / series, 1 / series + 1 / shunt + 1 / z0],
    ];
    rhs = [1 / z0, 0];
  } else {
    matrix = [
      [1 / z0 + 1 / series, -1 / series, 0],
      [-1 / series, 2 / series + 1 / shunt, -1 / series],
      [0, -1 / series, 1 / series + 1 / z0],
    ];
    rhs = [1 / z0, 0, 0];
  }
  const volts = solve(matrix, rhs);
  const v1 = volts[0];
  const v2 = volts[volts.length - 1];
  return {
    loss: 20 * Math.log10(0.5 / Math.abs(v2)),
    zin: (v1 * z0) / (1 - v1),
  };
}

function exactResistors(topology, db, z0) {
  const k = Math.pow(10, db / 20);
  if (topology === 'pi') {
    return { series: z0 * (k * k - 1) / (2 * k), shunt: z0 * (k + 1) / (k - 1) };
  }
  return { series: z0 * (k - 1) / (k + 1), shunt: z0 * 2 * k / (k * k - 1) };
}

// The default six decibel pi pad, worked out longhand: K = 1.995262, series
// 50(3.98107-1)/(2*1.995262) = 37.352 ohms, shunt 50(2.995262)/(0.995262)
// = 150.476 ohms, and the nearest one percent parts are 37.4 and 150 ohms.
const standard = design(base());
assert.equal(standard.topology, 'pi');
assert.equal(standard.db, 6);
assert.equal(standard.z0, 50);
assert.equal(standard.series, 37.352);
assert.equal(standard.shunt, 150.476);
assert.equal(standard.fittedSeries, 37.4);
assert.equal(standard.fittedShunt, 150);
assert.equal(standard.loss, 6);
assert.equal(standard.fittedLoss, 6.01);
assert.equal(standard.fittedReturn, 67);
assert.deepEqual(JSON.parse(JSON.stringify(standard.rows)), [
  { label: 'Series arm', count: 1, exact: 37.352, nearest: 37.4, errorPct: 0.13 },
  { label: 'Shunt arm, each end', count: 2, exact: 150.476, nearest: 150, errorPct: -0.32 },
]);

// The T pad twin: 16.614 ohms in each series arm and 66.931 in the shunt.
const tee = design(base({ topology: 't' }));
assert.equal(tee.series, 16.614);
assert.equal(tee.shunt, 66.931);
assert.equal(tee.loss, 6);
assert.equal(tee.rows[0].label, 'Series arm, each side');
assert.equal(tee.rows[0].count, 2);
assert.equal(tee.rows[1].label, 'Shunt arm');
assert.equal(tee.rows[1].count, 1);
assert.deepEqual(JSON.parse(JSON.stringify(tee.rows.map((row) => [row.exact, row.nearest]))),
  [[16.614, 16.5], [66.931, 66.5]]);

// Twenty decibels in fifty ohms is K = 10: pi 247.5 and 61.111, T 40.909 and
// 10.101. Three decibels in seventy five ohms is K = 1.412538: pi 26.422 and
// 438.603.
const twentyPi = design(base({ db: '20' }));
assert.equal(twentyPi.series, 247.5);
assert.equal(twentyPi.shunt, 61.111);
const twentyT = design(base({ db: '20', topology: 't' }));
assert.equal(twentyT.series, 40.909);
assert.equal(twentyT.shunt, 10.101);
const three75 = design(base({ db: '3', z0: '75' }));
assert.equal(three75.series, 26.422);
assert.equal(three75.shunt, 438.603);

// The closed forms must be matched and must realise the requested loss when the
// network is solved node by node, for both topologies across the whole range.
const dbValues = [0.1, 0.5, 1, 2, 3, 6, 9, 12, 20, 30, 40];
const impedances = [5, 25, 50, 75, 300, 600, 1000];
let solved = 0;
for (const topology of ['pi', 't']) {
  for (const db of dbValues) {
    for (const z0 of impedances) {
      const { series, shunt } = exactResistors(topology, db, z0);
      const check = nodal(topology, series, shunt, z0);
      assert.ok(Math.abs(check.loss - db) < 1e-9, 'nodal loss ' + JSON.stringify({ topology, db, z0, loss: check.loss }));
      assert.ok(Math.abs(check.zin - z0) < 1e-9 * z0, 'nodal match ' + JSON.stringify({ topology, db, z0, zin: check.zin }));
      // The page's chain-matrix loss and its rounded values must agree too.
      assert.ok(Math.abs(A.insertionLoss(topology, series, shunt, z0) - db) < 1e-9, 'chain loss');
      assert.ok(Math.abs(A.inputImpedance(topology, series, shunt, z0) - z0) < 1e-9 * z0, 'chain match');
      const result = design(base({ topology, db: String(db), z0: String(z0) }));
      assert.equal(result.loss, A.round(db, 2), 'reported loss');
      for (const row of result.rows) {
        assert.ok(row.exact > 0 && Number.isFinite(row.exact), 'positive resistor');
        const target = exactResistors(topology, db, z0)[row.label.indexOf('Series') === 0 ? 'series' : 'shunt'];
        assert.ok(Math.abs(row.nearest - target) / target < 0.05, 'fitted within five percent');
        assert.ok(A.E96.includes(row.nearest), 'fitted value is an E96 part');
        // The chosen part really is the closest one in the table.
        let closest = A.E96[0];
        for (const candidate of A.E96) {
          if (Math.abs(candidate - target) < Math.abs(closest - target) - 1e-12) closest = candidate;
        }
        assert.equal(row.nearest, closest, 'nearest E96 part');
      }
      assert.ok(result.fittedReturn === null || result.fittedReturn > 20, 'fitted match stays usable');
      assert.ok(Math.abs(result.fittedLoss - db) < 0.35, 'fitted loss close to design');
      solved += 1;
    }
  }
}

// Series resistance rises with attenuation in both topologies; the shunt falls.
for (const topology of ['pi', 't']) {
  let previous = null;
  for (const db of dbValues) {
    const result = design(base({ topology, db: String(db) }));
    if (previous) {
      assert.ok(result.series > previous.series, 'series rises with loss');
      assert.ok(result.shunt < previous.shunt, 'shunt falls with loss');
    }
    previous = result;
  }
}

// Refusals name the field and the range.
assert.equal(failure(base({ db: '' })), 'Attenuation must be a number from 0.1 to 40 dB.');
assert.equal(failure(base({ db: 'six' })), 'Attenuation must be a number from 0.1 to 40 dB.');
assert.equal(failure(base({ db: '-3' })), 'Attenuation must be a number from 0.1 to 40 dB.');
assert.equal(failure(base({ db: '0' })), 'Attenuation must be a number from 0.1 to 40 dB.');
assert.equal(failure(base({ db: '0.09' })), 'Attenuation must be a number from 0.1 to 40 dB.');
assert.equal(failure(base({ db: '41' })), 'Attenuation must be a number from 0.1 to 40 dB.');
assert.equal(failure(base({ db: '6e0' })), 'Attenuation must be a number from 0.1 to 40 dB.');
assert.equal(failure(base({ z0: '' })), 'System impedance must be a number from 5 to 1000 ohms.');
assert.equal(failure(base({ z0: 'fifty' })), 'System impedance must be a number from 5 to 1000 ohms.');
assert.equal(failure(base({ z0: '0' })), 'System impedance must be a number from 5 to 1000 ohms.');
assert.equal(failure(base({ z0: '-50' })), 'System impedance must be a number from 5 to 1000 ohms.');
assert.equal(failure(base({ z0: '4' })), 'System impedance must be a number from 5 to 1000 ohms.');
assert.equal(failure(base({ z0: '1001' })), 'System impedance must be a number from 5 to 1000 ohms.');
assert.equal(failure(base({ topology: 'l' })), 'Choose a pi or T pad.');
assert.equal(failure(base({ topology: undefined })), 'Choose a pi or T pad.');

// Whitespace and leading zeros are read, not rejected.
assert.equal(design(base({ db: ' 6.0 ', z0: ' 075 ' })).db, 6);
assert.equal(design(base({ db: '06' })).series, 37.352);

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Communications Engineering');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 900, 'method must describe the arithmetic');
assert.ok(entry.testCases.length >= 30, 'expected at least thirty catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = design(testCase.input);
    for (const [field, value] of Object.entries(testCase.expected)) {
      assert.equal(JSON.stringify(result[field]), JSON.stringify(value), testCase.name + ' ' + field);
    }
  }
}

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket|sendBeacon/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/gi, '')), 'no inline event handlers');
assert.ok(html.includes('<form id="pad-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
for (const id of ['topology', 'db', 'z0']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label ' + id + ' missing');
}
for (const id of ['db', 'z0']) {
  assert.ok(html.includes('aria-describedby="' + id + '-hint"'), 'help reference ' + id + ' missing');
}
assert.ok(html.includes('<option value="pi">') && html.includes('<option value="t">'), 'both topologies listed');
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet missing');
assert.ok(html.includes('type="submit"'), 'submit button missing');
assert.ok(html.includes('id="reset"'), 'reset button missing');
assert.ok(html.includes('<h1>RF Attenuator Pad Calculator</h1>'), 'heading missing');
assert.ok(html.includes('href="/">← All tools</a>'), 'back link missing');
assert.ok(html.includes('name="viewport"'), 'viewport meta missing');

console.log('RF attenuator pad calculator: ' + entry.testCases.length + ' catalog cases and '
  + solved + ' nodal network checks passed');
