/* Regression checks for the Mercator scale-factor core, its catalog cases and
   the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'mercator-scale-factor-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* mercator-scale-core:start */');
const end = html.indexOf('/* mercator-scale-core:end */');
assert.ok(start > -1 && end > start, 'mercator scale core markers missing');
const core = html.slice(start, end + '/* mercator-scale-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MercatorScaleCore;', sandbox);
const T = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(T.analyze(input));
const closeTo = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9,
  label + ': ' + actual + ' vs ' + expected);
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance,
  label + ': ' + actual + ' vs ' + expected);

// Documented surface.
assert.equal(T.EARTH_RADIUS, 6378137);
assert.equal(T.LIMITS.latitude, 85.0511287798066);
assert.deepEqual(plain(T.LIMITS.scale), [100, 1000000000]);
assert.deepEqual(plain(T.LIMITS.target), [1.01, 100]);
assert.match(T.MESSAGES.true, /equator .* true to scale/);
assert.match(T.MESSAGES.near, /under one percent/);
assert.match(T.MESSAGES.moderate, /areas inflate/);
assert.match(T.MESSAGES.strong, /severe/);

const base = { latitude: '45', scale: '50000', target: '2' };

// Textbook values from the projection: sec phi at 0, 30, 45, 60 and the limit.
const equator = run({ latitude: '0', scale: '50000', target: '2' });
assert.equal(equator.factor, 1);
assert.equal(equator.scaleError, 0);
assert.equal(equator.area, 1);
assert.equal(equator.localDenominator, 50000);
assert.equal(equator.northingKm, 0);
assert.equal(equator.hemisphere, 'N');
assert.equal(equator.verdict, 'true');

const thirty = run({ latitude: '30', scale: '24000', target: '2' });
near(thirty.factor, 1.1547005383792515, 1e-12, 'sec 30');
near(thirty.area, 4 / 3, 1e-12, 'area at 30');
near(thirty.localDenominator, 24000 / thirty.factor, 1e-6, 'local scale at 30');

const fortyFive = run(base);
near(fortyFive.factor, Math.SQRT2, 1e-15, 'sec 45');
near(fortyFive.scaleError, (Math.SQRT2 - 1) * 100, 1e-13, 'scale error at 45');
near(fortyFive.area, 2, 1e-15, 'area at 45');
near(fortyFive.localDenominator, 50000 / Math.SQRT2, 1e-9, 'local scale at 45');
near(fortyFive.northingKm, 5621.521486192066, 1e-9, 'northing at 45');
assert.equal(fortyFive.targetLatitude.toFixed(9), '60.000000000');
assert.equal(fortyFive.targetBeyondLimit, false);
assert.equal(fortyFive.verdict, 'moderate');

const sixty = run({ latitude: '60', scale: '50000', target: '2' });
near(sixty.factor, 2, 1e-12, 'sec 60');
near(sixty.scaleError, 100, 1e-12, 'scale error at 60');
near(sixty.area, 4, 1e-12, 'area at 60');
near(sixty.localDenominator, 25000, 1e-9, 'local scale at 60');
near(sixty.northingKm, 8399.737889818356, 1e-9, 'northing at 60');
assert.equal(sixty.verdict, 'moderate');

const limit = run({ latitude: '85.0511287798066', scale: '1000000', target: '11.6' });
near(limit.factor, 11.591953275521561, 1e-12, 'factor at the limit');
near(limit.northingKm, 20037.508342789242, 1e-9, 'northing at the limit');
near(limit.area, 134.37338074187505, 1e-9, 'area at the limit');
assert.equal(limit.verdict, 'strong');
assert.equal(limit.targetBeyondLimit, true);

// The northing is the integral of the secant, so asinh(tan phi) must agree.
for (const latitude of [1, 12.25, 30, 45, 62.5, 78, 85.0511287798066]) {
  const row = run({ latitude: String(latitude), scale: '50000', target: '2' });
  const phi = Math.abs(latitude) * Math.PI / 180;
  near(row.factor * Math.cos(phi), 1, 1e-15, 'sec times cos at ' + latitude);
  near(row.area, row.factor * row.factor, 1e-9, 'area identity at ' + latitude);
  near(row.localDenominator * row.factor, 50000, 1e-6, 'local scale identity at ' + latitude);
  near(row.northingKm, T.EARTH_RADIUS * Math.asinh(Math.tan(phi)) / 1000, 1e-9,
    'northing identity at ' + latitude);
  near(row.scaleError, (row.factor - 1) * 100, 1e-12, 'scale error identity at ' + latitude);
}

// Both halves of the sphere behave the same; only the hemisphere changes.
for (const latitude of [0.5, 33.8688, 60, 85.0511287798066]) {
  const north = run({ latitude: String(latitude), scale: '50000', target: '2' });
  const south = run({ latitude: String(-latitude), scale: '50000', target: '2' });
  assert.equal(north.factor, south.factor, 'factor symmetry at ' + latitude);
  assert.equal(north.area, south.area, 'area symmetry at ' + latitude);
  assert.equal(north.northingKm, south.northingKm, 'northing symmetry at ' + latitude);
  assert.equal(north.hemisphere, 'N');
  assert.equal(south.hemisphere, 'S');
  assert.equal(south.latitude, -latitude);
}

// Scale factor and northing both grow monotonically away from the equator.
let previousFactor = 0;
let previousNorthing = -1;
for (const latitude of [0, 10, 20, 30, 40, 50, 60, 70, 80, 85, 85.0511287798066]) {
  const row = run({ latitude: String(latitude), scale: '50000', target: '2' });
  assert.ok(row.factor >= previousFactor, 'factor shrank at ' + latitude);
  assert.ok(row.northingKm >= previousNorthing, 'northing shrank at ' + latitude);
  previousFactor = row.factor;
  previousNorthing = row.northingKm;
}

// A larger nominal denominator scales the local denominator, not the factor.
const large = run({ latitude: '45', scale: '250000', target: '2' });
assert.equal(large.factor, fortyFive.factor);
near(large.localDenominator, 250000 / Math.SQRT2, 1e-9, 'local scale at 1:250,000');

// The verdict band changes at one percent, and only there.
const underOne = run({ latitude: '8.06', scale: '50000', target: '2' });
const overOne = run({ latitude: '8.10', scale: '50000', target: '2' });
assert.ok(underOne.scaleError < 1, '8.06 degrees is under one percent');
assert.ok(overOne.scaleError > 1, '8.10 degrees is over one percent');
assert.equal(underOne.verdict, 'near');
assert.equal(overOne.verdict, 'moderate');
assert.equal(run({ latitude: '-0.0001', scale: '50000', target: '2' }).verdict, 'near');
assert.equal(run({ latitude: '84.9', scale: '50000', target: '2' }).verdict, 'strong');

// The target latitude is arccos(1 / k) and is flagged beyond the tile limit.
for (const target of [1.01, 1.25, 2, 3, 4, 11.5905, 11.6, 100]) {
  const row = run({ latitude: '0', scale: '50000', target: String(target) });
  near(row.targetLatitude, Math.acos(1 / target) * 180 / Math.PI, 1e-9, 'target latitude ' + target);
  assert.equal(row.targetBeyondLimit, row.targetLatitude > T.LIMITS.latitude,
    'limit flag for target ' + target);
}
assert.equal(run({ latitude: '0', scale: '50000', target: '11.59' }).targetBeyondLimit, false);
assert.equal(run({ latitude: '0', scale: '50000', target: '11.6' }).targetBeyondLimit, true);

// Decimal commas and a leading plus are accepted; whitespace is trimmed.
near(run({ latitude: '45,5', scale: '50000', target: '2' }).latitude, 45.5, 1e-12, 'comma latitude');
near(run({ latitude: ' +45.5 ', scale: ' 50000 ', target: ' 2 ' }).latitude, 45.5, 1e-12, 'plus and spaces');
assert.equal(run({ latitude: '-0', scale: '50000', target: '2' }).hemisphere, 'N');

// Validation: each refusal names the problem, in field order.
const failure = (input) => {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
assert.equal(failure({ latitude: '', scale: '50000', target: '2' }), 'Enter the latitude.');
assert.equal(failure({ latitude: '   ', scale: '50000', target: '2' }), 'Enter the latitude.');
assert.equal(failure({ latitude: 'north', scale: '50000', target: '2' }), 'Latitude must be a number.');
assert.equal(failure({ latitude: '45.5.2', scale: '50000', target: '2' }), 'Latitude must be a number.');
assert.equal(failure({ latitude: '1e3', scale: '50000', target: '2' }), 'Latitude must be a number.');
assert.equal(failure({ latitude: '86', scale: '50000', target: '2' }),
  'Latitude must be between -85.0511287798066 and 85.0511287798066 degrees.');
assert.equal(failure({ latitude: '-85.0511288', scale: '50000', target: '2' }),
  'Latitude must be between -85.0511287798066 and 85.0511287798066 degrees.');
assert.equal(failure({ latitude: '45', scale: '', target: '2' }), 'Enter the nominal scale.');
assert.equal(failure({ latitude: '45', scale: '99', target: '2' }),
  'Nominal scale must be a whole number from 100 to 1000000000.');
assert.equal(failure({ latitude: '45', scale: '1000000001', target: '2' }),
  'Nominal scale must be a whole number from 100 to 1000000000.');
assert.equal(failure({ latitude: '45', scale: '50.5', target: '2' }),
  'Nominal scale must be a whole number from 100 to 1000000000.');
assert.equal(failure({ latitude: '45', scale: '5e4', target: '2' }),
  'Nominal scale must be a whole number from 100 to 1000000000.');
assert.equal(failure({ latitude: '45', scale: '50000', target: '' }), 'Enter the target scale factor.');
assert.equal(failure({ latitude: '45', scale: '50000', target: '1' }),
  'Target scale factor must be between 1.01 and 100.');
assert.equal(failure({ latitude: '45', scale: '50000', target: '0.99' }),
  'Target scale factor must be between 1.01 and 100.');
assert.equal(failure({ latitude: '45', scale: '50000', target: '100.5' }),
  'Target scale factor must be between 1.01 and 100.');
assert.equal(failure({ latitude: '45', scale: '50000', target: 'two' }),
  'Target scale factor must be a number.');
// A latitude refusal wins over a bad scale, and a bad scale over a bad target.
assert.equal(failure({ latitude: '90', scale: '5', target: '0' }),
  'Latitude must be between -85.0511287798066 and 85.0511287798066 degrees.');
assert.equal(failure({ latitude: '45', scale: '5', target: '0' }),
  'Nominal scale must be a whole number from 100 to 1000000000.');

// Both ends of every range are accepted.
assert.equal(run({ latitude: '85.0511287798066', scale: '100', target: '1.01' }).factor > 11.59, true);
assert.equal(run({ latitude: '-85.0511287798066', scale: '1000000000', target: '100' }).hemisphere, 'S');

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="mercator-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/type="button" id="reset"/.test(html), 'page has an explicit reset button');
assert.ok(/role="alert"/.test(html), 'errors are announced as alerts');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
for (const control of ['latitude', 'scale', 'target']) {
  assert.ok(new RegExp(`<label class="f" for="${control}">`).test(html), `${control} is labelled`);
  assert.ok(new RegExp(`id="${control}"[^>]*inputmode=`).test(html), `${control} has an input mode`);
}
assert.ok(/min-height:44px/.test(html), 'controls keep a 44 px target');
assert.ok(/<html lang=/.test(html) && /name="viewport"/.test(html), 'page has language and viewport');
assert.ok(/<h1>Mercator Scale Factor Calculator<\/h1>/.test(html), 'page has its heading');
assert.ok(/name="description"/.test(html), 'page has a description');
assert.ok(/<\/html>\s*$/.test(html), 'page is complete');

// Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Mercator Scale Factor Calculator');
assert.equal(record.category, 'Geography');
assert.equal(record.subcategory, 'Coordinates');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.tags.includes('mercator') && record.tags.includes('scale-factor'), 'record tags');
assert.ok(record.aliases.some((alias) => /Mercator Distortion Calculator/.test(alias)), 'record alias');
assert.ok(/sec phi/.test(record.method), 'method states the scale factor');
assert.ok(/no storage, uploads or network access/.test(record.method), 'method documents local limits');
assert.equal(record.sources.length, 2, 'two sources');
for (const source of record.sources) {
  assert.ok(source.title && /^https:\/\//.test(source.url), 'source has a title and URL');
}
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 20, 'catalog case count');
assert.equal(kinds('golden'), 5, 'five golden cases');
assert.equal(kinds('boundary'), 5, 'five boundary cases');
assert.equal(kinds('validation'), 10, 'ten validation cases');

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let checked = 0;
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') {
      const tolerance = Math.max(Math.abs(value) * 1e-9, 1e-9);
      assert.ok(Math.abs(actual[key] - value) <= tolerance,
        `${testCase.name}.${key}: ${actual[key]} vs ${value}`);
      checked += 1;
    } else {
      assert.equal(actual[key], value, `${testCase.name}.${key}`);
    }
  }
}

// The catalog test cases must cover every verdict and both hemispheres.
const covered = new Set(record.testCases.filter((testCase) => testCase.kind !== 'validation')
  .map((testCase) => T.analyze(testCase.input).verdict));
assert.ok(covered.has('true') && covered.has('near') && covered.has('moderate') && covered.has('strong'),
  'catalog cases cover every verdict');

console.log('mercator-scale-factor-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + checked + ' numeric fields)');
