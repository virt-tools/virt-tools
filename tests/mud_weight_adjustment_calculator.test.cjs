/* Mud weight adjustment calculator: the barite weight-up identity against the
   published 1,470 formula, the dilution identity, the closing mass balance, the
   volume change, the warnings, the refusals, the catalog cases and the page
   contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'mud-weight-adjustment-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* mud-weight-core:start */';
const endMarker = '/* mud-weight-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = MudWeightCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');

const base = { current: '10', target: '12', volume: '500', dilution: '8.33' };
const run = (overrides) => C.calculate(Object.assign({}, base, overrides || {}));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};

// ---- The barite weight-up identity against the published field formula.
// Barite 4.2 SG is 35.0 ppg, so sacks per 100 bbl = 1,470 (W2 - W1) / (35 - W2)
// and the total is that number times the volume in hundreds of barrels.
for (const current of [6, 8.5, 10, 12.4, 16, 22.5, 29.5]) {
  for (const target of [current + 0.1, current + 1, current + 3, 30]) {
    if (target > 30) continue;
    for (const volume of [0.5, 100, 500, 2000]) {
      const result = run({ current: String(current), target: String(target), volume: String(volume) });
      assert.equal(result.mode, 'up');
      const perHundred = 1470 * (target - current) / (35 - target);
      const sacks = perHundred * volume / 100;
      assert.equal(result.bariteSacks, Math.round(sacks * 10) / 10,
        'sacks follow the 1,470 formula: ' + current + ' -> ' + target + ', ' + volume + ' bbl');
      assert.ok(result.sacksToOrder >= Math.ceil(sacks - 1e-9), 'sacks are rounded up for ordering');
      assert.ok(result.sacksToOrder - sacks <= 1.000001, 'rounding up never adds more than one sack');
      // The volume the barite occupies is the sack count over 14.7 sacks per barrel.
      assert.ok(Math.abs(result.volumeGain - result.baritePounds / 1470) <= 0.06,
        'the volume gain is the barite volume');
      assert.ok(Math.abs(result.bariteKg - result.baritePounds * 0.45359237) <= 0.8, 'pounds to kilograms');
    }
  }
}

// ---- The mixed mud really lands on the target weight.
for (const [current, target, volume] of [[10, 12, 500], [9.5, 11.5, 200], [16, 18, 250], [6, 8, 1000]]) {
  const result = run({ current: String(current), target: String(target), volume: String(volume) });
  const gallons = volume * 42;
  const pounds = result.baritePounds;
  const finalGallons = gallons + pounds / 35;
  const mixed = (gallons * current + pounds) / finalGallons;
  assert.ok(Math.abs(mixed - target) < 0.001, 'mass balance closes to 0.001 ppg: ' + current + ' -> ' + target);
  assert.ok(Math.abs(finalGallons / 42 - result.finalVolume) <= 0.06, 'the final volume matches the barite added');
  assert.ok(Math.abs(result.finalVolume - volume - result.volumeGain) <= 0.11, 'final = start + gain');
  assert.ok(Math.abs(result.volumeGainPercent - 100 * result.volumeGain / volume) <= 0.1, 'percent gain');
  assert.ok(Math.abs(result.specificGravity - Math.round(target / 8.33 * 1000) / 1000) < 1e-9, 'specific gravity');
}

// ---- The dilution identity and its mass balance.
for (const [current, target, volume, light] of [[12, 11, 1000, 8.33], [14, 10, 200, 7.2], [13.8, 10, 200, 7.2], [9, 8.5, 400, 8.33]]) {
  const result = run({ current: String(current), target: String(target), volume: String(volume), dilution: String(light) });
  assert.equal(result.mode, 'down');
  const barrels = volume * (current - target) / (target - light);
  assert.ok(Math.abs(result.dilutionBarrels - barrels) <= 0.05, 'dilution follows V (W1 - W2) / (W2 - Dw)');
  assert.ok(Math.abs(result.dilutionGallons - barrels * 42) <= 2, 'barrels to US gallons');
  assert.ok(Math.abs((volume * current + barrels * light) / (volume + barrels) - target) < 1e-9, 'dilution mass balance closes');
  assert.ok(Math.abs(result.finalVolume - volume - barrels) <= 0.06, 'the final volume matches the fluid added');
  assert.equal(result.bariteSacks, 0, 'no barite in a dilution');
  assert.equal(result.dilutionDensity, Math.round(light * 100) / 100);
}

// ---- The identities agree with the closed forms at the extremes of the range.
const hundred = run({ current: '10', target: '12', volume: '500' });
assert.equal(hundred.bariteSacks, 639.1, '10 to 12 ppg in 500 bbl');
assert.equal(hundred.sacksToOrder, 640);
assert.equal(hundred.sacksPerHundred, 127.8, '127.8 sacks per 100 bbl');
const published = run({ current: '10', target: '13', volume: '500' });
assert.ok(Math.abs(published.bariteSacks - 1002.3) <= 0.05, 'the DrillingFormulas 10 to 13 ppg example');
assert.equal(published.sacksPerHundred, 200.5, 'their 201 sacks per 100 bbl, before rounding up');
const cut = run({ current: '12', target: '11', volume: '1000' });
assert.equal(cut.dilutionBarrels, 374.5, 'the worked 1,000 bbl dilution');

// ---- A target equal to the current weight asks for nothing.
for (const change of ['0', '0.001', '0.003']) {
  const result = run({ target: String(10 + Number(change)) });
  assert.equal(result.mode, 'hold');
  assert.equal(result.bariteSacks, 0);
  assert.equal(result.dilutionBarrels, 0);
  assert.equal(result.volumeGain, 0);
  assert.equal(result.warnings.length, 0);
}

// ---- Dilution grows as the light fluid approaches the target.
const wide = run({ current: '14', target: '12', volume: '500', dilution: '7' });
const narrow = run({ current: '14', target: '12', volume: '500', dilution: '11.5' });
assert.ok(narrow.dilutionBarrels > wide.dilutionBarrels, 'a heavier dilution fluid needs more barrels');

// ---- Warnings.
assert.equal(run({ current: '10', target: '12' }).warnings.length, 0);
assert.equal(run({ current: '20', target: '22' }).warnings[0],
  'Above 20 ppg the mud is heavily weighted; confirm the target against the drilling programme before mixing.');
assert.ok(run({ current: '10', target: '15' }).warnings.some((text) => /^The volume grows by 25 %/.test(text)),
  'a quarter more volume is called out');
assert.ok(run({ current: '12', target: '11.5', volume: '500', dilution: '11.2' }).warnings
  .some((text) => /within 0.5 ppg/.test(text)), 'a near-target dilution fluid is called out');
assert.ok(run({ current: '14', target: '10', volume: '200', dilution: '7.2' }).warnings
  .some((text) => /base oil rather than water/.test(text)), 'a base oil is identified');
assert.ok(run({ current: '8.6', target: '8.4', volume: '500' }).warnings
  .some((text) => /adds 285.7 % more volume/.test(text)), 'dilution volume growth is called out');
assert.equal(run({ current: '10', target: '12', volume: '500' }).warnings.length, 0, 'a routine job is quiet');

// ---- Refusals.
assert.equal(failure({ current: '' }), 'Enter the current mud weight in ppg.');
assert.equal(failure({ current: 'ten' }), 'Enter the current mud weight in ppg.');
assert.equal(failure({ current: '5.9' }), 'The current mud weight must be between 6 and 30 ppg.');
assert.equal(failure({ target: '30.1' }), 'The target mud weight must be between 6 and 30 ppg.');
assert.equal(failure({ target: '' }), 'Enter the target mud weight in ppg.');
assert.equal(failure({ volume: '0' }), 'The mud volume must be greater than 0 and at most 100000 bbl.');
assert.equal(failure({ volume: '100001' }), 'The mud volume must be greater than 0 and at most 100000 bbl.');
assert.equal(failure({ volume: 'lots' }), 'Enter the mud volume in barrels.');
assert.equal(failure({ current: '12', target: '11', dilution: '' }), 'Enter the dilution fluid density in ppg.');
assert.equal(failure({ current: '12', target: '11', dilution: '4.9' }), 'The dilution fluid density must be between 5 and 12 ppg.');
assert.equal(failure({ current: '12', target: '11', dilution: '12.1' }), 'The dilution fluid density must be between 5 and 12 ppg.');
assert.equal(failure({ current: '12', target: '10', dilution: '10' }), 'The dilution fluid must be lighter than the target mud weight.');
const nothing = (value) => {
  try {
    C.calculate(value);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};
assert.equal(nothing(null), 'Nothing to calculate.');
assert.equal(nothing('10 ppg'), 'Nothing to calculate.');
assert.equal(C.WATER_PPG, 8.33);
assert.equal(C.BARITE_PPG, 35);
assert.equal(C.MIN_WEIGHT, 6);
assert.equal(C.MAX_WEIGHT, 30);
assert.equal(C.MAX_VOLUME, 100000);

// ---- Catalog record: counts, cases and metadata.
assert.equal(catalog.tools.length, 2444, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2183, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Oil, Gas & Marine Engineering').length, 54,
  'Oil, Gas & Marine Engineering count');
assert.equal(record.category, 'Oil, Gas & Marine Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.method.length > 600);
assert.equal(record.sources.length, 3);
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'every source has a fetched https url');
  assert.ok(source.title.length > 40, 'the citation keeps its wording');
}
assert.ok(record.tags.includes('oil-gas-marine-engineering'));
assert.equal(record.tags.length, new Set(record.tags).size, 'tags are internally unique');

const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 6, validation: 7 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(JSON.stringify(actual[key]), JSON.stringify(expected), testCase.name + ': ' + key);
  }
}

// ---- Uniqueness across the catalog.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
for (const alias of record.aliases) {
  assert.equal(catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase())).length,
  1, 'alias is unique: ' + alias);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && /barite/.test(tool.slug)),
  'no other barite tool exists');
assert.deepEqual(
  catalog.tools.filter((tool) => /mud.?weight/.test(tool.slug) && tool.slug !== slug).map((tool) => tool.slug).sort(),
  ['kill-mud-weight-calculator', 'mud-weight-calculator'],
  'the other mud weight tools stay conversions, not adjustments');

// ---- Page contract.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Mud Weight Adjustment Calculator<\/h1>/);
assert.match(html, /<form id="mud-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label for="/g) || []).length, 4, 'every control is labelled');
assert.equal((html.match(/<input/g) || []).length, 4);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.equal((html.match(/data-example="/g) || []).length, 2);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function|localStorage|sessionStorage/.test(html),
  'no network calls, no eval, no storage');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored and nothing is sent/i, 'the privacy note stays on the page');
assert.match(html, /min-height:46px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* mud-weight-core:start \*\//g) || []).length, 1);
assert.equal((html.match(/\/\* mud-weight-core:end \*\//g) || []).length, 1);

// Every id the script reaches for exists in the markup.
const ids = ['mud-form', 'current', 'target', 'volume', 'dilution', 'err', 'out'];
for (const id of ids) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}

console.log('mud weight adjustment calculator OK: ' + record.testCases.length +
  ' catalog cases, the 1,470 weight-up identity, the dilution identity, the mass balance, ' +
  'warnings, refusals, uniqueness and page contract OK');
