/* Hop bitterness: the published Tinseth utilisation equation, its utilisation
   table, the worked examples, linearity and inverse-volume behaviour, the
   validation paths, the catalog test cases and the page contract. The expected
   numbers in the catalog were produced by a separate Python implementation of
   the same published equation; this suite also re-derives random cases from
   its own formula so the page core is never compared with itself. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'hop-bitterness-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* hop-bitterness-core:start */';
const endMarker = '/* hop-bitterness-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = HopBitternessCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ': ' + actual + ' is not within ' + tolerance + ' of ' + expected);
};
const failure = (run) => {
  try { run(); } catch (error) { return error.message; }
  return null;
};

// ---- An independent implementation of the same published equation.
const reference = {
  bigness: (sg) => 1.65 * (0.000125 ** (sg - 1)),
  time: (minutes) => (1 - Math.exp(-0.04 * minutes)) / 4.15,
  utilisation(sg, minutes) { return this.bigness(sg) * this.time(minutes); },
  ibu(grams, alpha, sg, minutes, litres) {
    return (alpha / 100) * grams * 1000 * this.utilisation(sg, minutes) / litres;
  }
};

// ---- Limits stay inside what a kettle will accept.
assert.equal(C.MIN_VOLUME, 0.5);
assert.equal(C.MAX_VOLUME, 10000);
assert.equal(C.MIN_GRAVITY, 1);
assert.equal(C.MAX_GRAVITY, 1.2);
assert.equal(C.MAX_WEIGHT, 100000);
assert.equal(C.MAX_ALPHA, 100);
assert.equal(C.MAX_MINUTES, 240);
assert.equal(C.MAX_ADDITIONS, 8);

// ---- The published utilisation table (boil gravity by boil time).
const TABLE = [
  [1.030, 6, 0.065], [1.030, 30, 0.212],
  [1.050, 6, 0.054], [1.050, 15, 0.114], [1.050, 30, 0.177], [1.050, 60, 0.231],
  [1.080, 30, 0.135], [1.080, 60, 0.176],
  [1.130, 30, 0.086],
];
for (const [gravity, minutes, expected] of TABLE) {
  close(C.utilization(gravity, minutes), expected, 0.0006,
    'utilisation at SG ' + gravity + ' for ' + minutes + ' minutes');
}
assert.equal(C.utilization(1.05, 0), 0, 'no time, no isomerisation');

// ---- Utilisation rises with time and falls with gravity.
let previous = -1;
for (let minutes = 0; minutes <= 240; minutes += 5) {
  const value = C.utilization(1.05, minutes);
  assert.ok(value > previous, 'utilisation rises at ' + minutes + ' minutes');
  previous = value;
}
let denser = Infinity;
for (let points = 0; points <= 200; points += 5) {
  const value = C.utilization(1 + points / 1000, 60);
  assert.ok(value < denser, 'utilisation falls at SG 1.' + points);
  denser = value;
}

// ---- The published worked example: 28 g of 10% alpha, 60 min, 20 L, 1.050.
const example = plain(C.estimate({
  volume: '20', gravity: '1.050',
  additions: [{ weight: '28', alpha: '10', minutes: '60' }]
}));
close(example.totalIbu, 32.293, 0.001, 'the worked example');
close(example.rows[0].utilization, 0.23066, 0.00001, 'worked example utilisation');
close(example.rows[0].ibu, 32.293, 0.001, 'worked example addition');
close(example.totalAlphaMgL, 140, 0.001, '140 mg/L of alpha acids');

// ---- The five-gallon American IPA from the model description.
const ipa = plain(C.estimate({
  volume: '18.927', gravity: '1.050',
  additions: [
    { weight: '28.35', alpha: '12', minutes: '60' },
    { weight: '28.35', alpha: '5.5', minutes: '15' },
    { weight: '28.35', alpha: '5.5', minutes: '5' }
  ]
}));
close(ipa.totalIbu, 54.678, 0.001, 'the IPA total');
assert.deepEqual(ipa.rows.map((row) => row.minutes), [60, 15, 5]);
close(ipa.rows[0].ibu, 41.460, 0.001, 'the bittering charge');
close(ipa.rows[1].ibu, 9.429, 0.001, 'the flavour charge');
close(ipa.rows[2].ibu, 3.788, 0.001, 'the aroma charge');
assert.equal(ipa.rows.length, 3);

// ---- Bitterness is linear in weight and alpha acid, and inverse in volume.
for (const [gravity, minutes] of [[1.030, 15], [1.050, 60], [1.090, 120]]) {
  const base = C.ibu(20, 8, gravity, minutes, 25);
  close(C.ibu(40, 8, gravity, minutes, 25), base * 2, 1e-9, 'twice the weight');
  close(C.ibu(20, 16, gravity, minutes, 25), base * 2, 1e-9, 'twice the alpha acid');
  close(C.ibu(20, 8, gravity, minutes, 50), base / 2, 1e-9, 'twice the volume');
  close(C.ibu(0, 8, gravity, minutes, 25), 0, 1e-12, 'no hops, no bitterness');
  close(C.ibu(20, 0, gravity, minutes, 25), 0, 1e-12, 'no alpha acid, no bitterness');
}

// ---- A zero-minute addition contributes nothing, but still adds alpha acids.
const flameout = plain(C.estimate({
  volume: '20', gravity: '1.050',
  additions: [{ weight: '28', alpha: '10', minutes: '0' }]
}));
assert.equal(flameout.totalIbu, 0);
assert.equal(flameout.rows[0].ibu, 0);
close(flameout.rows[0].alphaMgL, 140, 0.001, 'alpha acids at flame-out');

// ---- Seeded random cases agree with the independent implementation.
let seed = 20261115;
const random = (limit) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % limit;
};
for (let round = 0; round < 300; round += 1) {
  const volume = 1 + random(2000) / 10;
  const gravity = 1 + random(180) / 1000;
  const minutes = random(241);
  const weight = random(50000) / 100;
  const alpha = random(2000) / 100;
  const actual = C.estimate({
    volume: String(volume), gravity: gravity.toFixed(3),
    additions: [{ weight: String(weight), alpha: String(alpha), minutes: String(minutes) }]
  });
  const expected = reference.ibu(weight, alpha, Number(gravity.toFixed(3)), minutes, volume);
  close(actual.totalIbu, expected, 1e-9, 'random case ' + round);
}

// ---- Blank additions are skipped; the rest still add up.
const skipped = plain(C.estimate({
  volume: '20', gravity: '1.050',
  additions: [
    { weight: '28', alpha: '12', minutes: '60' },
    { weight: '', alpha: '', minutes: '' },
    { weight: '28', alpha: '5.5', minutes: '15' }
  ]
}));
assert.equal(skipped.rows.length, 2);
assert.deepEqual(skipped.rows.map((row) => row.index), [1, 3]);
close(skipped.totalIbu, 47.565, 0.001, 'the blank row changes nothing');

// ---- The default page state, used by the browser probe.
const defaults = plain(C.estimate({
  volume: '20', gravity: '1.050',
  additions: [
    { weight: '28', alpha: '12', minutes: '60' },
    { weight: '28', alpha: '5.5', minutes: '15' }
  ]
}));
close(defaults.totalIbu, 47.565, 0.001, 'the default page total');
close(defaults.rows[0].ibu, 38.752, 0.001, 'the default first addition');
close(defaults.rows[1].ibu, 8.813, 0.001, 'the default second addition');

// ---- Refusals, one per failure path.
const one = (weight, alpha, minutes) => [{ weight, alpha, minutes }];
assert.equal(failure(() => C.estimate({ volume: '', gravity: '1.050', additions: one('28', '10', '60') })),
  'Enter the post-boil volume in litres.');
assert.equal(failure(() => C.estimate({ volume: 'twenty', gravity: '1.050', additions: one('28', '10', '60') })),
  'Enter the volume as a number of litres, such as 20.');
assert.equal(failure(() => C.estimate({ volume: '0.2', gravity: '1.050', additions: one('28', '10', '60') })),
  'Enter a post-boil volume from 0.5 to 10,000 litres.');
assert.equal(failure(() => C.estimate({ volume: '20', gravity: '', additions: one('28', '10', '60') })),
  'Enter the average boil gravity.');
assert.equal(failure(() => C.estimate({ volume: '20', gravity: '1.25', additions: one('28', '10', '60') })),
  'Enter a boil gravity from 1.000 to 1.200.');
assert.equal(failure(() => C.estimate({ volume: '20', gravity: '1050', additions: one('28', '10', '60') })),
  'Enter a boil gravity from 1.000 to 1.200.');
assert.equal(failure(() => C.estimate({ volume: '20', gravity: '1.050', additions: one('', '10', '60') })),
  'Enter the hop weight in grams for addition 1.');
assert.equal(failure(() => C.estimate({ volume: '20', gravity: '1.050', additions: one('-5', '10', '60') })),
  'Enter the hop weight for addition 1 as a number of grams, such as 28.');
assert.equal(failure(() => C.estimate({ volume: '20', gravity: '1.050', additions: one('28', '120', '60') })),
  'Enter an alpha acid percentage from 0 to 100 for addition 1.');
assert.equal(failure(() => C.estimate({ volume: '20', gravity: '1.050', additions: one('28', '10', '300') })),
  'Enter a boil time from 0 to 240 minutes for addition 1.');
assert.equal(failure(() => C.estimate({ volume: '20', gravity: '1.050', additions: [] })),
  'Add at least one hop addition.');
assert.equal(failure(() => C.estimate({ volume: '20', gravity: '1.050', additions: one('', '', '') })),
  'Add at least one hop addition with a weight, alpha acid percentage and boil time.');
assert.equal(failure(() => C.estimate({
  volume: '20', gravity: '1.050',
  additions: new Array(9).fill({ weight: '28', alpha: '10', minutes: '60' })
})), 'This page takes at most 8 hop additions.');
assert.equal(failure(() => C.estimate({ volume: '20', gravity: '1.050', additions: one('28', '10', '60m') })),
  'Enter the boil time for addition 1 as a number of minutes, such as 60.');

// ---- The catalog record and every test case it carries.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(record.name, 'Hop Bitterness (IBU) Calculator');
assert.equal(record.category, 'Food');
assert.equal(record.subcategory, 'Estimation & Calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.sources.length, 2);
record.sources.forEach((source) => assert.match(source.url, /^https:\/\//));
assert.ok(record.method && record.method.length > 400, 'the method explains the model');
assert.equal(record.testCases.length, 22);
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(() => C.estimate(testCase.input)), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = plain(C.estimate(testCase.input));
  close(actual.totalIbu, testCase.expected.totalIbu, 0.002, testCase.name + ' total');
  close(actual.totalAlphaMgL, testCase.expected.totalAlphaMgL, 0.002, testCase.name + ' alpha acids');
  assert.equal(actual.rows.length, testCase.expected.rows.length, testCase.name + ' row count');
  actual.rows.forEach((row, index) => {
    const want = testCase.expected.rows[index];
    close(row.ibu, want.ibu, 0.002, testCase.name + ' row ' + index + ' IBU');
    close(row.utilization, want.utilization, 0.00001, testCase.name + ' row ' + index + ' utilisation');
    close(row.alphaMgL, want.alphaMgL, 0.002, testCase.name + ' row ' + index + ' mg/L');
  });
}
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2229, 'public tools');

// ---- Page contract: shared shell, labelled controls, one hash-pinnable script.
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.match(html, /\/assets\/style\.css/);
assert.match(html, /<h1>Hop Bitterness Calculator<\/h1>/);
assert.match(html, /<meta name="description" content="[^"]+">/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /role="alert"/);
assert.match(html, /role="group"/);
assert.match(html, /min-height:44px/);
assert.match(html, /inputmode="decimal"/);
assert.equal(/<a\b[^>]*href="http/.test(html), false, 'no off-site links in the page');
assert.equal(/fetch\(|XMLHttpRequest|localStorage|sessionStorage|innerHTML/.test(html), false,
  'no network, storage or innerHTML');
const formIds = ['volume', 'gravity'];
formIds.forEach((id) => assert.ok(html.includes('for="' + id + '"'), 'label for ' + id));
formIds.forEach((id) => assert.ok(html.includes('id="' + id + '"'), 'control ' + id));
['add-row', 'example', 'ibu-err', 'ibu-out', 'additions'].forEach((id) =>
  assert.ok(html.includes('id="' + id + '"'), 'element ' + id));
assert.equal((html.match(/<button\b[^>]*>/g) || []).every((tag) => /type="(button|submit)"/.test(tag)), true,
  'every button has a type');
assert.equal((html.match(/<script[^>]*src=/g) || []).length, 2, 'theme-init and app.js only');
assert.match(html, /hop-bitterness-core:start/);

console.log('hop bitterness calculator: passed');
