/* Regression checks for the headphone amp power core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'headphone-amp-power-calculator';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* hp-amp-core:start */');
const end = html.indexOf('/* hp-amp-core:end */');
assert.ok(start > -1 && end > start, 'hp amp core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '\nmodule.exports = HeadphoneAmp;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Audio');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.icon, '\u{1F3A7}');
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 10, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 3, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 800, 'method documented');
assert.equal(catalog.tools.length, 2282, 'catalog total');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Audio').length, 45, 'Audio count');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');
const aliases = catalog.tools.flatMap((tool) => (tool.slug === slug ? [] : tool.aliases || []))
  .map((alias) => alias.toLowerCase());
for (const alias of entry.aliases) {
  assert.ok(!aliases.includes(alias.toLowerCase()), `alias ${alias} is already used`);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug &&
  /headphone|earphone|in-ear|amp power|drive power/i
    .test([tool.name, ...(tool.aliases || []), ...(tool.tags || [])].join(' '))), 'no other headphone tool');

const failure = (input) => {
  try {
    C.compute(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
const close = (left, right, label, tolerance = 1e-9) => {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  assert.ok(Math.abs(Number(left) - Number(right)) <= tolerance * scale, `${label}: ${left} != ${right}`);
};

// --- Constants, conventions and formatting. ---
assert.equal(C.BOUNDS.ohms.min, 1);
assert.equal(C.BOUNDS.ohms.max, 2000);
assert.deepEqual([C.BOUNDS.dbm.min, C.BOUNDS.dbm.max], [70, 140]);
assert.deepEqual([C.BOUNDS.dbv.min, C.BOUNDS.dbv.max], [90, 145]);
assert.deepEqual([C.BOUNDS.target.min, C.BOUNDS.target.max], [60, 130]);
assert.deepEqual([C.BOUNDS.headroom.min, C.BOUNDS.headroom.max], [0, 24]);
assert.equal(C.PHONE_V, 0.5);
assert.equal(C.DONGLE_V, 2);
assert.equal(C.DESKTOP_V, 7);
assert.equal(C.LOUD_SPL, 105);
assert.deepEqual(Array.from(C.LEVEL_ROWS), [90, 100, 110, 120]);
assert.equal(C.classify(0.5).key, 'phone');
assert.equal(C.classify(0.5001).key, 'dongle');
assert.equal(C.classify(2).key, 'dongle');
assert.equal(C.classify(2.0001).key, 'desktop');
assert.equal(C.classify(7).key, 'desktop');
assert.equal(C.classify(7.0001).key, 'high-voltage');
close(C.sensPerVolt(108, 32), 108 + 10 * Math.log10(1000 / 32), 'per volt conversion');
close(C.sensPerVolt(0, 1000), 0, 'a thousand ohms leaves the per-milliwatt figure alone');
assert.equal(C.sig(1.23456), '1.23');
assert.equal(C.sig(19.9512), '20.0');
assert.equal(C.sig(0.0316227), '0.0316');
assert.equal(C.sig(1240), '1240');
assert.equal(C.powerText(2511.886), '2.51 W');
assert.equal(C.powerText(39.8107), '39.8 mW');
assert.equal(C.powerText(0.158489), '0.158 mW');
assert.equal(C.powerText(0.0001), '0.100 µW');
assert.equal(C.powerText(1e-8), '0.0100 nW');
assert.equal(C.voltageText(3.15478), '3.15 V');
assert.equal(C.voltageText(0.283514), '284 mV');
assert.equal(C.voltageText(0.004), '4.00 mV');
assert.equal(C.currentText(0.0126191), '12.6 mA');
assert.equal(C.currentText(0.00025), '250 µA');

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
  assert.equal(result.ohms, expected.ohms, `${testCase.name}: impedance echoed`);
  close(result.perMilliwatt, expected.perMilliwatt, `${testCase.name}: dB/mW`);
  close(result.perVolt, expected.perVolt, `${testCase.name}: dB/V`);
  close(result.milliwatts, expected.milliwatts, `${testCase.name}: power`);
  close(result.volts, expected.volts, `${testCase.name}: voltage`);
  close(result.amperes, expected.amperes, `${testCase.name}: current`);
  close(result.peakVolts, expected.peakVolts, `${testCase.name}: peak voltage`);
  assert.equal(result.verdict.key, expected.verdict, `${testCase.name}: verdict`);
  assert.equal(result.levels.length, expected.levels.length, `${testCase.name}: table rows`);
  for (let index = 0; index < expected.levels.length; index += 1) {
    const row = result.levels[index];
    const want = expected.levels[index];
    assert.equal(row.level, want.level, `${testCase.name}: row ${index} level`);
    close(row.milliwatts, want.milliwatts, `${testCase.name}: row ${index} power`);
    close(row.volts, want.volts, `${testCase.name}: row ${index} voltage`);
  }
}
assert.equal(goldenCount, 6, 'expected six golden cases');
assert.equal(boundaryCount, 6, 'expected six boundary cases');
assert.equal(validationCount, 11, 'expected eleven validation cases');

// --- Three hundred generated configurations against the algebra. ---
let seed = 20261114n;
const MOD = 2147483648n;
const random = () => {
  seed = (seed * 1103515245n + 12345n) % MOD;
  return Number(seed) / 2147483648;
};
const pick = (min, max) => min + random() * (max - min);
let sweeps = 0;
for (let index = 0; index < 300; index += 1) {
  const unit = random() < 0.5 ? 'dbm' : 'dbv';
  const ohms = Number(pick(1, 2000).toFixed(2));
  const sens = unit === 'dbm' ? Number(pick(70, 140).toFixed(2)) : Number(pick(90, 145).toFixed(2));
  const target = Number(pick(60, 130).toFixed(1));
  const headroom = Number(pick(0, 24).toFixed(1));
  const result = C.compute({
    impedance: String(ohms), sensitivity: String(sens), sensUnit: unit,
    target: String(target), headroom: String(headroom)
  });

  // The two sensitivity conventions differ by exactly the load term.
  close(result.perVolt - result.perMilliwatt, 10 * Math.log10(1000 / result.ohms), 'convention gap');
  close(result.milliwatts, (result.volts * result.amperes) * 1000, 'power from volts and amps');
  close(result.volts, Math.sqrt((result.milliwatts / 1000) * result.ohms), 'voltage from power');
  close(result.amperes, result.volts / result.ohms, 'current from voltage');
  close(result.peakVolts, result.volts * Math.SQRT2, 'peak voltage');
  close(result.peakMilliwatts, result.milliwatts * 2, 'peak power');
  close(result.milliwatts, Math.pow(10, (result.target - result.perMilliwatt + result.headroom) / 10),
    'power from the per-milliwatt spec');
  assert.equal(result.verdict.key, C.classify(result.volts).key, 'verdict follows the voltage');
  assert.ok(/^(0|[1-9]\d*)(\.\d+)? (W|mW|µW|nW)$/.test(C.powerText(result.milliwatts)), 'power text form');
  assert.ok(/^(0|[1-9]\d*)(\.\d+)? (V|mV)$/.test(C.voltageText(result.volts)), 'voltage text form');
  assert.ok(/^(0|[1-9]\d*)(\.\d+)? (mA|µA)$/.test(C.currentText(result.amperes)), 'current text form');

  // The table covers the four fixed levels plus the chosen one, in order.
  const levels = Array.from(result.levels, (row) => row.level);
  const wanted = Array.from(new Set([90, 100, 110, 120, result.target])).sort((left, right) => left - right);
  assert.deepEqual(levels, wanted, 'table levels');
  assert.equal(result.levels.filter((row) => row.isTarget).length, 1, 'one highlighted row');
  for (let row = 1; row < result.levels.length; row += 1) {
    const step = result.levels[row].level - result.levels[row - 1].level;
    close(result.levels[row].milliwatts / result.levels[row - 1].milliwatts, Math.pow(10, step / 10),
      'ten decibels is ten times the power');
  }
  // Headroom lifts the requirement by exactly its own factor.
  const bare = C.compute({
    impedance: String(ohms), sensitivity: String(sens), sensUnit: unit,
    target: String(target), headroom: '0'
  });
  close(result.milliwatts / bare.milliwatts, Math.pow(10, headroom / 10), 'headroom power factor');
  close(result.volts / bare.volts, Math.pow(10, headroom / 20), 'headroom voltage factor');

  assert.equal(result.notes.length, 6 + result.warnings.length, 'notes plus warnings');
  assert.equal(result.warnings.length, Number(target > 105) + Number(result.milliwatts > 2000), 'warning rows');
  assert.ok(result.notes.some((line) => line.includes('dB/mW') && line.includes('dB/V')), 'convention note');
  sweeps += 1;
}
assert.equal(sweeps, 300, 'three hundred generated configurations');

// --- Behaviour the sweep cannot reach reliably. ---
const iem = C.compute({ impedance: '32', sensitivity: '108', sensUnit: 'dbm', target: '100', headroom: '12' });
close(iem.milliwatts, 2.5118864315095797, '32 ohm at 108 dB/mW needs 2.51 mW');
assert.equal(iem.verdict.key, 'phone');
assert.equal(iem.sensUnitName, 'dB SPL per 1 mW');
assert.equal(iem.levels.length, 4, 'four rows when the level is already listed');
assert.equal(C.powerText(iem.milliwatts), '2.51 mW');
assert.equal(C.voltageText(iem.volts), '284 mV');

const planar = C.compute({ impedance: '300', sensitivity: '100', sensUnit: 'dbv', target: '110', headroom: '0' });
close(planar.volts, Math.pow(10, 0.5), 'ten decibels above the per-volt spec is 3.16 V');
close(planar.milliwatts, (planar.volts * planar.volts) / 300 * 1000, 'power follows the voltage');
assert.equal(planar.levels.length, 4, 'a level already in the table adds no row');
assert.equal(planar.levels[2].level, 110, 'the 110 dB row sits third');
assert.equal(planar.levels[2].isTarget, true);
assert.equal(planar.levels[3].isTarget, false);

const offList = C.compute({ impedance: '300', sensitivity: '100', sensUnit: 'dbv', target: '95', headroom: '0' });
assert.equal(offList.levels.length, 5, 'an unlisted level adds a row');
assert.deepEqual(Array.from(offList.levels, (row) => row.level), [90, 95, 100, 110, 120]);
assert.equal(offList.levels[1].isTarget, true, 'the added row is highlighted');
close(offList.volts, Math.pow(10, (95 - 100) / 20), 'a level below the spec needs less than a volt');

const loud = C.compute({ impedance: '600', sensitivity: '88', sensUnit: 'dbm', target: '112', headroom: '12' });
assert.equal(loud.warnings.length, 2, 'a loud, power-hungry pair warns twice');
assert.ok(loud.warnings[0].startsWith('Above 105 dB SPL'), 'the warning names the threshold');
assert.ok(loud.warnings[1].includes('most headphone amplifiers'), 'the second names the power');

const quiet = C.compute({ impedance: '16', sensitivity: '120', sensUnit: 'dbm', target: '80', headroom: '0' });
assert.equal(quiet.warnings.length, 0, 'nothing to warn about');
assert.equal(quiet.milliwatts, 0.0001, 'sensitive IEMs need a tenth of a microwatt');
assert.equal(C.powerText(quiet.milliwatts), '0.100 µW');

const absurd = C.compute({ impedance: '2000', sensitivity: '70', sensUnit: 'dbm', target: '130', headroom: '24' });
assert.equal(absurd.warnings.length, 2, 'an impossible power at a loud level warns twice');
assert.ok(absurd.warnings[1].includes('most headphone amplifiers'), 'the warning names the cause');
assert.equal(C.powerText(absurd.milliwatts), '251000 W');

const defaults = C.DEFAULTS;
assert.deepEqual(Object.keys(defaults).sort(), ['headroom', 'impedance', 'sensUnit', 'sensitivity', 'target']);

// --- Page contract. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'), 'live status region');
for (const id of ['impedance', 'sensitivity', 'sens-unit', 'target', 'headroom', 'calculate', 'reset',
  'amp-status', 'level-body', 'notes', 'amp-note', 'mode-cap', 'level-cap', 'power-out', 'power-sub',
  'stat-voltage', 'stat-current', 'stat-peak', 'stat-sens-mw', 'stat-sens-v', 'stat-load',
  'verdict-title', 'verdict-text', 'copy', 'copy-status']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or output ${id}`);
}
assert.ok(/<form id="amp-form" novalidate>/.test(html), 'form contract');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(/<option value="dbm" selected>/.test(html), 'per-milliwatt selected by default');
assert.ok(/id="copy"[^>]*disabled/.test(html), 'copy starts disabled');
assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(html), 'no raw HTML sinks');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'no browser storage');
assert.ok(!/https?:\/\//.test(html.replace(/<meta name="description"[^>]*>/, '')), 'no external requests');
assert.ok(!/\bfetch\(|XMLHttpRequest/.test(html), 'no network calls');
assert.ok(!/\beval\s*\(|new Function\s*\(/.test(html), 'no runtime compilation');
assert.ok(!/\son[a-z]+\s*=/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no inline handlers');

console.log(`${slug}: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed; ` +
  `${sweeps} generated configurations agreed on the two sensitivity conventions, the headroom factors, the ` +
  'decade table, the verdict thresholds, the unit-scaled output text and the page contract');
