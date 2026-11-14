/* Regression checks for the PoE voltage drop core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'poe-voltage-drop-calculator';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* poe-drop-core:start */');
const end = html.indexOf('/* poe-drop-core:end */');
assert.ok(start > -1 && end > start, 'poe-drop core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '/* poe-drop-core:end */' + '\nmodule.exports = PoeDrop;', sandbox);
const P = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'IT & Networking');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.icon, '\u{1F50C}');
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 5, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 2, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 200, 'method documented');
assert.equal(catalog.tools.length, 2278, 'catalog total');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && /poe/i.test(tool.name) && /drop|length/i.test(tool.name)),
  'no other PoE voltage or run-length tool');

const failure = (input) => {
  try {
    P.compute(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// --- Constants and defaults. ---
assert.equal(P.COPPER_RESISTIVITY, 1.724e-8);
assert.equal(P.METRES_PER_FOOT, 0.3048);
assert.equal(P.CHANNEL_LIMIT_M, 100);
const defaults = P.compute({});
assert.equal(defaults.standard, 'at');
assert.equal(defaults.pairs, 2);
assert.equal(defaults.voltage, 54);
assert.equal(defaults.power, 25.5);
assert.equal(defaults.awg, 24);
assert.equal(defaults.length, 100);
assert.equal(defaults.floor, 42.5);
assert.equal(defaults.pdVoltage, 49.68);
assert.equal(defaults.drop, 4.32);
assert.equal(defaults.loopResistance, 8.42);
assert.equal(defaults.current, 0.513);
assert.equal(defaults.cableLoss, 2.22);
assert.equal(defaults.efficiency, 92);
assert.equal(defaults.margin, 7.18);
assert.equal(defaults.maxRun, 227.6);
assert.equal(defaults.verdict, 'pass');
assert.equal(defaults.warnings.length, 0);

// --- Conductors follow the AWG table. ---
for (const [awg, expected] of [[22, 0.052959], [23, 0.06678], [24, 0.084208], [26, 0.133897]]) {
  assert.ok(Math.abs(P.resistancePerMetre(awg) - expected) < 1e-6, `${awg} AWG resistance per metre`);
}
assert.ok(P.resistancePerMetre(23) < P.resistancePerMetre(24), 'thicker wire resists less');

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
  const result = P.compute(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
}
assert.equal(goldenCount, 6, 'expected six golden cases');
assert.equal(boundaryCount, 6, 'expected six boundary cases');
assert.equal(validationCount, 12, 'expected twelve validation cases');

// --- Independent recomputation in the voltage-first form. ---
const roundHalfAway = (value, places) => {
  const factor = Math.pow(10, places);
  return Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
};
const rPerMetre = (awg) => {
  const d = 0.127 * Math.pow(92, (36 - awg) / 39) / 1000;
  return 1.724e-8 / (Math.PI * d * d / 4);
};
let sweeps = 0;
for (const [standard, pairs, floor] of [['af', 2, 37], ['at', 2, 42.5], ['bt3', 4, 42.5], ['bt4', 4, 41.1]]) {
  for (const awg of [22, 23, 24, 26]) {
    for (const lengthM of [1, 5, 30.48, 100, 150, 200]) {
      for (const [voltage, power] of [[44, 5], [48, 12.95], [54, 25.5], [57, 71.3], [50, 51]]) {
        const loop = rPerMetre(awg) * lengthM / (pairs / 2);
        const disc = voltage * voltage - 4 * loop * power;
        let expected = null;
        if (disc >= 0) {
          // Voltage-first: the device voltage is the larger root, current follows from constant power.
          const pd = (voltage + Math.sqrt(disc)) / 2;
          const current = power / pd;
          const loss = current * current * loop;
          expected = {
            pdVoltage: roundHalfAway(pd, 2),
            drop: roundHalfAway(voltage - pd, 2),
            dropPercent: roundHalfAway(100 * (voltage - pd) / voltage, 2),
            loopResistance: roundHalfAway(loop, 2),
            cableLoss: roundHalfAway(loss, 2),
            efficiency: roundHalfAway(100 * power / (power + loss), 1),
            margin: roundHalfAway(pd - floor, 2),
            current: roundHalfAway(current, 3),
            maxRun: roundHalfAway((voltage - floor) / ((power / floor) * rPerMetre(awg) / (pairs / 2)), 1),
          };
        }
        const input = {
          standard, voltage: String(voltage), power: String(power), awg: String(awg), length: String(lengthM)
        };
        if (expected === null) {
          assert.equal(failure(input),
            `This run cannot deliver ${power} W at ${voltage} V: the cable resistance is too high.`,
            `${standard}/${awg}/${lengthM}/${voltage}/${power}: infeasible run refused`);
          continue;
        }
        const result = P.compute(input);
        for (const [key, value] of Object.entries(expected)) {
          assert.equal(result[key], value, `${standard}/${awg}/${lengthM}/${voltage}/${power}: ${key}`);
        }
        assert.equal(result.verdict, result.margin >= 0 ? 'pass' : 'fail', 'verdict follows the margin');
        // The device voltage and current must reproduce the load power.
        assert.ok(Math.abs(result.pdVoltage * result.current - power) <= Math.max(0.02, 0.002 * power),
          'P = V * I at the device');
        sweeps += 1;
      }
    }
  }
}
assert.ok(sweeps > 300, 'enough independent recomputations');

// --- A longer run drops more; four pairs halve the loop. ---
let previous = Infinity;
for (const lengthM of [10, 25, 50, 75, 100, 125, 150, 175, 200]) {
  const result = P.compute({ length: String(lengthM) });
  assert.ok(result.pdVoltage < previous, `${lengthM} m: the device voltage falls as the run grows`);
  previous = result.pdVoltage;
}
const twoPair = P.compute({ standard: 'at', length: '100', awg: '23' });
const fourPair = P.compute({ standard: 'bt4', length: '100', awg: '23', power: '25.5', voltage: '54' });
assert.ok(Math.abs(twoPair.loopResistance - 2 * fourPair.loopResistance) < 0.02, 'four pairs halve the loop');
const doubled = P.compute({ standard: 'af', voltage: '48', power: '5', length: '50' });
const single = P.compute({ standard: 'af', voltage: '48', power: '5', length: '25' });
assert.ok(doubled.drop > single.drop, 'twice the cable drops more volts');

// --- Feet and metres describe the same run. ---
for (const [standard, power, lengthM, awg] of [['at', 25.5, 30.48, 23], ['bt4', 71.3, 60, 22], ['af', 12.95, 100, 24]]) {
  const metric = P.compute({ standard, power: String(power), awg: String(awg), length: String(lengthM) });
  const imperial = P.compute({
    standard, power: String(power), awg: String(awg), unit: 'ft', length: String(roundHalfAway(lengthM / 0.3048, 4))
  });
  assert.ok(Math.abs(imperial.pdVoltage - metric.pdVoltage) < 0.02, `${standard}: same device voltage in feet`);
  assert.ok(Math.abs(imperial.drop - metric.drop) < 0.02, `${standard}: same drop in feet`);
  assert.ok(Math.abs(imperial.loopResistance - metric.loopResistance) < 0.02, `${standard}: same loop in feet`);
  assert.ok(Math.abs(imperial.maxRun * 0.3048 - metric.maxRun) < 0.3, `${standard}: same maximum run in feet`);
}

// --- Notes. ---
const longRun = P.compute({ length: '200' });
assert.ok(longRun.warnings.some((line) => line.includes('channel limit')), 'long-run note');
const weak = P.compute({ standard: 'af', voltage: '44', power: '12.95', awg: '26', length: '200' });
assert.equal(weak.verdict, 'fail');
assert.ok(weak.margin < 0, 'a thin long run ends below the class floor');
assert.ok(weak.warnings.some((line) => line.includes('below the 37 V')), 'below-floor note');
const hungry = P.compute({ standard: 'af', power: '20', voltage: '48', length: '10' });
assert.ok(hungry.warnings.some((line) => line.includes('guarantees')), 'load above the class note');
const thin = P.compute({ standard: 'af', power: '12.95', voltage: '44', awg: '26', length: '150' });
assert.ok(thin.warnings.some((line) => line.includes('channel limit')), 'channel note on the thin run');

// --- Page contract. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'), 'live status region');
for (const id of ['standard', 'voltage', 'power', 'awg', 'unit', 'length', 'calculate', 'reset', 'ps-status',
  'headline-out', 'drop-out', 'current-out', 'loop-out', 'loss-out', 'eff-out', 'margin-out', 'maxrun-out',
  'copy', 'notes']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or output ${id}`);
}
assert.ok(/<form id="ps-form" novalidate>/.test(html), 'form contract');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(/<option value="at" selected>/.test(html), '802.3at selected by default');
assert.ok(/id="voltage" type="text" inputmode="decimal" autocomplete="off" value="54"/.test(html), 'default voltage');
assert.ok(/id="length" type="text" inputmode="decimal" autocomplete="off" value="100"/.test(html), 'default length');
assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(html), 'no raw HTML sinks');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'no browser storage');
assert.ok(!/https?:\/\//.test(html.replace(/<meta name="description"[^>]*>/, '')), 'no external requests in the page');
assert.ok(!/\bfetch\(|XMLHttpRequest/.test(html), 'no network calls');

console.log(`${slug}: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed; ` +
  `${sweeps} independent recomputations, the AWG table, monotonic runs, pair arithmetic, feet equivalence and the notes agreed`);
