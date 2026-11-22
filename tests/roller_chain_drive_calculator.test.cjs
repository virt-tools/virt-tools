/* Roller chain drive calculator: the published pitch-diameter table, the
   chain-length and centre-distance formulas, a sweep of round-trip invariants,
   the refusals, the catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'roller-chain-drive-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* chain-drive-core:start */';
const endMarker = '/* chain-drive-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = ChainDriveCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');

const twelveB = { pitch: 19.05, driverTeeth: 19, drivenTeeth: 38, centre: 500, speed: 1450 };
const run = (overrides) => C.calculate(Object.assign({}, twelveB, overrides || {}));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};

// ---- Pitch diameters against the published 25.4 mm pitch table.
const published = {
  10: 82.20, 11: 90.16, 12: 98.14, 13: 106.14, 15: 122.17, 19: 154.32, 23: 186.54,
  30: 243.00, 40: 323.74, 50: 404.52, 60: 485.33, 70: 566.15, 80: 646.97, 90: 727.80,
  100: 808.64, 110: 889.48, 114: 921.81, 120: 970.32, 129: 1043.08
};
for (const [teeth, expected] of Object.entries(published)) {
  const count = Number(teeth);
  const centres = 5 * 25.4 / Math.sin(Math.PI / count);
  const result = C.calculate({ pitch: 25.4, driverTeeth: count, drivenTeeth: count, centre: centres, speed: 100 });
  assert.ok(Math.abs(result.driverDiameter - expected) < 0.02,
    'pitch diameter for ' + teeth + ' teeth: ' + result.driverDiameter + ' vs ' + expected);
}

// ---- The worked 12B example, step by step.
const first = run();
assert.equal(first.ratio, 2);
assert.equal(first.driverDiameter, 115.739);
assert.equal(first.drivenDiameter, 230.687);
assert.equal(first.length, 81.342);
assert.equal(first.links, 82);
assert.equal(first.exactCentre, 506.31);
assert.equal(first.adjustment, 6.31);
assert.equal(first.chainLengthMetres, 1.562);
assert.equal(first.chainSpeed, 8.747);
assert.equal(first.wrap, 166.964);
assert.equal(first.drivenSpeed, 725);
assert.equal(first.headline, '82 pitches');
assert.equal(first.summary, '19 \u2192 38 teeth at 506.3 mm centres, 8.75 m/s.');
assert.equal(first.warnings.length, 0);

// ---- The link count always exceeds the required length by less than two pitches,
//      and the centres it gives feed the length formula back to the same count.
let checked = 0;
for (const pitch of [3, 6.35, 9.525, 12.7, 19.05, 25.4, 50.8, 200]) {
  for (const driverTeeth of [8, 11, 17, 19, 23, 30]) {
    for (const drivenTeeth of [8, 19, 38, 45, 76, 114, 150, 200]) {
      for (const speed of [0, 900, 3600]) {
        const tangent = (pitch / Math.sin(Math.PI / driverTeeth) + pitch / Math.sin(Math.PI / drivenTeeth)) / 2;
        for (const centre of [tangent, tangent * 1.4, tangent * 4, 3000]) {
          if (centre < tangent) { continue; }
          const result = C.calculate({ pitch, driverTeeth, drivenTeeth, centre, speed });
          const required = 2 * centre / pitch + (driverTeeth + drivenTeeth) / 2 +
            Math.pow((drivenTeeth - driverTeeth) / (2 * Math.PI), 2) * pitch / centre;
          assert.equal(result.links % 2, 0, 'a whole number of double pitches');
          assert.ok(result.links >= required - 1e-9, 'the count covers the required length');
          assert.ok(result.links - required < 2 + 1e-9, 'the count is the next even number');
          assert.equal(result.length, Math.round(required * 1000) / 1000, 'the required length is reported');
          assert.ok(result.exactCentre >= centre - 1e-3, 'the bought count never shortens the centres');
          const back = 2 * result.exactCentre / pitch + (driverTeeth + drivenTeeth) / 2 +
            Math.pow((drivenTeeth - driverTeeth) / (2 * Math.PI), 2) * pitch / result.exactCentre;
          assert.ok(Math.abs(back - result.links) < 0.01, 'centres round trip to the link count');
          assert.ok(result.wrap > 0 && result.wrap <= 180, 'wrap stays a real arc');
          assert.ok(result.driverDiameter > 0 && result.drivenDiameter > 0);
          assert.ok(Math.abs(result.chainLengthMetres - result.links * pitch / 1000) < 0.00051,
            'the chain length in metres follows the link count');
          assert.ok(Math.abs(result.drivenSpeed - speed * driverTeeth / drivenTeeth) < 0.00051,
            'the driven speed follows the tooth ratio');
          assert.ok(Math.abs(result.chainSpeed - pitch * driverTeeth * speed / 60000) < 0.00051,
            'the chain speed follows the pitch line');
          checked += 1;
        }
      }
    }
  }
}

// ---- Geometry behaves: a bigger driven sprocket narrows the wrap, equal sprockets
//      wrap half the chain, and a longer centre distance needs more chain.
assert.equal(run({ driverTeeth: 19, drivenTeeth: 19 }).wrap, 180);
assert.ok(run({ drivenTeeth: 76 }).wrap < run({ drivenTeeth: 38 }).wrap);
assert.ok(run({ centre: 900 }).links > run({ centre: 500 }).links);
assert.equal(run({ speed: 0 }).chainSpeed, 0);
assert.equal(run({ speed: 0 }).drivenSpeed, 0);
assert.equal(run({ speed: 2900 }).chainSpeed - run().chainSpeed * 2 < 0.002, true);

// ---- Warning thresholds sit where the page says they do.
assert.equal(run({ driverTeeth: 18 }).warnings.length, 1);
assert.equal(run({ driverTeeth: 19 }).warnings.length, 0);
assert.equal(run({ drivenTeeth: 114, centre: 900 }).warnings.length, 0);
assert.equal(run({ driverTeeth: 23, drivenTeeth: 115, centre: 900 }).warnings.length, 1);
assert.equal(run({ driverTeeth: 19, drivenTeeth: 113, centre: 900 }).warnings.length, 0);
assert.equal(run({ driverTeeth: 19, drivenTeeth: 115, centre: 900 }).warnings
  .filter((text) => text.indexOf('6:1') > -1).length, 1);

// ---- Numeric strings behave like numbers.
const strings = C.calculate({ pitch: '19.05', driverTeeth: '19', drivenTeeth: '38', centre: '500', speed: '1450' });
assert.deepEqual(strings, first);

// ---- Refusals.
assert.equal(failure({ pitch: '' }), 'The chain pitch must be a number in millimetres.');
assert.equal(failure({ pitch: '19mm' }), 'The chain pitch must be a number in millimetres.');
assert.equal(failure({ pitch: 201 }), 'The chain pitch must be between 3 and 200 mm.');
assert.equal(failure({ driverTeeth: 7 }), 'Each sprocket needs between 8 and 200 teeth.');
assert.equal(failure({ drivenTeeth: 201 }), 'Each sprocket needs between 8 and 200 teeth.');
assert.equal(failure({ drivenTeeth: 38.5 }), 'The tooth counts must be whole numbers.');
assert.equal(failure({ centre: 100 }), 'The sprockets would overlap: the centre distance must be at least 173.213 mm.');
assert.equal(failure({ centre: 100001 }), 'The centre distance must be a number in millimetres.');
assert.equal(failure({ speed: 20001 }), 'The driver speed must be between 0 and 20000 rpm.');
assert.equal(failure({ speed: 'fast' }), 'The driver speed must be a number in rpm.');
assert.equal(C.MIN_PITCH, 3);
assert.equal(C.MAX_TEETH, 200);

// ---- Catalog record: counts, cases and metadata.
assert.equal(catalog.tools.length, 2450, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2189, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Mechanical & Structural Engineering').length, 54,
  'Mechanical & Structural Engineering count');
assert.equal(record.category, 'Mechanical & Structural Engineering');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.length > 600);
assert.equal(record.sources.length, 1);
assert.equal(record.sources[0].url, 'https://roymech.org/Useful_Tables/Drive/Roller_chain.html');
assert.ok(record.tags.length === new Set(record.tags).size, 'tags are internally unique');

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

// ---- Page contract.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Roller Chain Drive Calculator<\/h1>/);
assert.match(html, /<form id="chain-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label for="/g) || []).length, 5, 'every control is labelled');
assert.equal((html.match(/<input/g) || []).length, 5);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.equal((html.match(/data-example="/g) || []).length, 2);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function|localStorage|sessionStorage/.test(html),
  'no network calls, no eval, no storage');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored and nothing is sent/i, 'the privacy note stays on the page');
assert.match(html, /min-height:46px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* chain-drive-core:start \*\//g) || []).length, 1);
assert.equal((html.match(/\/\* chain-drive-core:end \*\//g) || []).length, 1);

// Every id the script reaches for exists in the markup.
const ids = ['chain-form', 'pitch', 'driverTeeth', 'drivenTeeth', 'centre', 'speed', 'err', 'out'];
for (const id of ids) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}

console.log('roller chain drive calculator OK: ' + checked + ' sweep cases, ' + record.testCases.length +
  ' catalog cases, the published pitch-diameter table, invariants, refusals, uniqueness and page contract OK');
