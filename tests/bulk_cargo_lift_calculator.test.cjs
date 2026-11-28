/* Regression checks for the bulk cargo lift core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'bulk-cargo-lift-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* cargo-core:start */');
const end = html.indexOf('/* cargo-core:end */');
assert.ok(start > -1 && end > start, 'cargo core markers missing');
const core = html.slice(start, end + '/* cargo-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CargoCore;', sandbox);
const T = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const lift = (input) => plain(T.lift(input));
const failure = (input) => {
  try {
    lift(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
const D = { capacity: '70000', deadweight: '55000', factor: '1.4' };
const withInput = (overrides) => Object.assign({}, D, overrides);
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} is not within ${tolerance} of ${expected}`);
};

// Documented surface.
assert.equal(T.MIN_CAPACITY, 1);
assert.equal(T.MAX_CAPACITY, 2000000);
assert.equal(T.MIN_DEADWEIGHT, 1);
assert.equal(T.MAX_DEADWEIGHT, 1000000);
assert.equal(T.MIN_FACTOR, 0.05);
assert.equal(T.MAX_FACTOR, 20);

// Defaults: 70,000 m3 of hold at 1.4 m3/t fills before the 55,000 t deadweight.
const base = lift(D);
assert.equal(base.capacityM3, 70000);
assert.equal(base.deadweightTonnes, 55000);
assert.equal(base.stowageFactor, 1.4);
assert.equal(base.holdLimitTonnes, 50000);
assert.equal(base.liftTonnes, 50000);
assert.equal(base.cargoVolumeM3, 70000);
assert.equal(base.utilizationPercent, 100);
assert.equal(base.unusedDeadweightTonnes, 5000);
assert.equal(base.unusedCapacityM3, 0);
assert.equal(base.limit, 'space');
assert.equal(base.rows.length, 4, 'the cargo row is dropped when it repeats coal');
assert.equal(base.rows.some((row) => row.mine), false);
assert.deepEqual(base.rows.map((row) => row.label), ['Iron ore', 'Grain', 'Coal', 'Woodchips']);

// The reference worked examples: phosphate loads to deadweight, barley to the holds.
const phosphate = lift({ capacity: '70000', deadweight: '55000', factor: '0.9' });
assert.equal(phosphate.limit, 'weight');
assert.equal(phosphate.liftTonnes, 55000);
assert.equal(phosphate.cargoVolumeM3, 49500);
assert.equal(phosphate.unusedCapacityM3, 20500);
assert.equal(phosphate.unusedDeadweightTonnes, 0);
assert.equal(phosphate.rows.length, 5);
assert.equal(phosphate.rows[4].label, 'Your cargo');
assert.equal(phosphate.rows[4].liftTonnes, 55000);
const barley = lift({ capacity: '70000', deadweight: '55000', factor: '1.47' });
assert.equal(barley.limit, 'space');
assert.equal(barley.liftTonnes, 47619);
assert.equal(barley.unusedDeadweightTonnes, 7381);
assert.equal(barley.utilizationPercent, 100);

// When the two limits meet exactly the result is neither space nor weight limited.
const even = lift({ capacity: '50000', deadweight: '40000', factor: '1.25' });
assert.equal(even.limit, 'even');
assert.equal(even.liftTonnes, 40000);
assert.equal(even.cargoVolumeM3, 50000);
assert.equal(even.unusedDeadweightTonnes, 0);
assert.equal(even.unusedCapacityM3, 0);
assert.equal(even.utilizationPercent, 100);

// Every reference row obeys the same rule and never gains lift as the factor rises.
const rowsByFactor = base.rows.slice().sort((a, b) => a.factor - b.factor);
for (let index = 0; index < rowsByFactor.length; index++) {
  const row = rowsByFactor[index];
  close(row.liftTonnes, Math.min(70000 / row.factor, 55000), 0.06, 'reference row ' + row.label);
  if (index > 0) {
    assert.ok(row.liftTonnes <= rowsByFactor[index - 1].liftTonnes,
      'a higher stowage factor cannot lift more: ' + row.label);
  }
}

// A wide sweep: the lift is the lower limit, the volume and the leftovers agree.
let sweep = 0;
const capacities = ['1', '50', '500', '3200', '12500.5', '70000', '90000', '250000', '2000000'];
const deadweights = ['1', '400', '2800', '30000', '55000', '60000', '250000', '1000000'];
const factors = ['0.05', '0.4', '0.75', '1', '1.3', '1.4', '1.47', '2.5', '5', '12', '20'];
for (const capacity of capacities) {
  for (const deadweight of deadweights) {
    for (const factor of factors) {
      const result = lift({ capacity, deadweight, factor });
      const cap = Number(capacity);
      const dwt = Number(deadweight);
      const fac = Number(factor);
      const holdLimit = cap / fac;
      const expectedLift = Math.min(holdLimit, dwt);
      close(result.holdLimitTonnes, holdLimit, 0.06, 'hold limit ' + capacity + '/' + factor);
      close(result.liftTonnes, expectedLift, 0.06, 'lift ' + capacity + '/' + deadweight + '/' + factor);
      close(result.cargoVolumeM3, expectedLift * fac, 0.11, 'cargo volume');
      close(result.utilizationPercent, 100 * expectedLift * fac / cap, 0.06, 'utilization');
      close(result.liftTonnes + result.unusedDeadweightTonnes, dwt, 0.11, 'deadweight split');
      close(result.cargoVolumeM3 + result.unusedCapacityM3, cap, 0.11, 'volume split');
      if (Math.abs(holdLimit - dwt) > 1e-6 * dwt) {
        assert.equal(result.limit, holdLimit < dwt ? 'space' : 'weight',
          'limit word ' + capacity + '/' + deadweight + '/' + factor);
      }
      assert.ok(result.rows.length === 4 || result.rows.length === 5, 'row count');
      for (const row of result.rows) {
        const rowFactor = row.mine ? fac : row.factor;
        close(row.liftTonnes, Math.min(cap / rowFactor, dwt), 0.11, 'row lift ' + row.label);
      }
      assert.ok(result.utilizationPercent <= 100.1, 'hold use never passes full at ' + capacity);
      assert.ok(result.unusedDeadweightTonnes >= 0, 'deadweight left over is never negative');
      assert.ok(result.unusedCapacityM3 >= 0, 'hold space left over is never negative');
      sweep += 1;
    }
  }
}
assert.equal(sweep, capacities.length * deadweights.length * factors.length);

// Numbers and numeric strings give the same plan, including float noise.
assert.deepEqual(lift({ capacity: 70000, deadweight: 55000, factor: 1.4 }), base);
const noisy = lift({ capacity: 70000.00000000001, deadweight: 55000, factor: 1.4 });
assert.equal(noisy.liftTonnes, 50000);

// A duplicate detection tolerance: 1.4000001 is the coal row's factor.
const nearCoal = lift({ capacity: '70000', deadweight: '55000', factor: '1.4' });
assert.equal(nearCoal.rows.length, 4);
const oddball = lift({ capacity: '70000', deadweight: '55000', factor: '1.42' });
assert.equal(oddball.rows.length, 5);
assert.equal(oddball.rows[4].factor, 1.42);

// Refusals name the field and the rule, in field order.
assert.equal(failure(withInput({ capacity: '' })), 'Grain capacity is required.');
assert.equal(failure(withInput({ capacity: '0' })), 'Grain capacity must be a number from 1 to 2000000.');
assert.equal(failure(withInput({ capacity: '2000001' })), 'Grain capacity must be a number from 1 to 2000000.');
assert.equal(failure(withInput({ capacity: 'abc' })), 'Grain capacity must be a number from 1 to 2000000.');
assert.equal(failure(withInput({ deadweight: '' })), 'Deadweight cargo capacity is required.');
assert.equal(failure(withInput({ deadweight: '0' })),
  'Deadweight cargo capacity must be a number from 1 to 1000000.');
assert.equal(failure(withInput({ deadweight: '1000001' })),
  'Deadweight cargo capacity must be a number from 1 to 1000000.');
assert.equal(failure(withInput({ factor: '' })), 'Stowage factor is required.');
assert.equal(failure(withInput({ factor: '0.04' })), 'Stowage factor must be a number from 0.05 to 20.');
assert.equal(failure(withInput({ factor: '20.001' })), 'Stowage factor must be a number from 0.05 to 20.');
// The capacity is checked before the stowage factor.
assert.equal(failure({ capacity: '0', deadweight: '0', factor: '0.01' }),
  'Grain capacity must be a number from 1 to 2000000.');

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="cargo-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/type="button" id="reset"/.test(html), 'page has an explicit reset button');
assert.ok(/role="alert"/.test(html), 'errors are announced as alerts');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<table class="tbl" aria-labelledby="cargoes-heading">/.test(html), 'table is labelled by its heading');
for (const control of ['capacity', 'deadweight', 'factor']) {
  assert.ok(new RegExp(`<label for="${control}">`).test(html), `${control} is labelled`);
  assert.ok(new RegExp(`id="${control}"[^>]*aria-describedby=`).test(html), `${control} has a help text`);
}
assert.ok(/min-height:44px/.test(html), 'controls keep a 44 px target');
assert.ok(/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(html), 'fields pair two per row');
assert.ok(/@media \(max-width:560px\)/.test(html), 'the page stacks on a narrow screen');
assert.ok(/<html lang=/.test(html) && /name="viewport"/.test(html), 'page has language and viewport');
assert.ok(/<h1>Bulk Cargo Lift Calculator<\/h1>/.test(html), 'page has its heading');
assert.ok(/name="description"/.test(html), 'page has a description');
assert.ok(/<\/html>\s*$/.test(html), 'page is complete');
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'the page has no duplicate ids');

// Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Bulk Cargo Lift Calculator');
assert.equal(record.category, 'Oil, Gas & Marine Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.tags.includes('stowage-factor') && record.tags.includes('deadweight'), 'record tags');
assert.ok(record.aliases.some((alias) => /Stowage Factor Calculator/.test(alias)), 'record alias');
assert.ok(/grain capacity divided by the stowage factor/.test(record.method), 'method states the rule');
assert.ok(/planning estimate, not a loading instruction/.test(record.method), 'method states the limits');
assert.ok(/no storage, uploads or network access/.test(record.method), 'method documents local limits');
assert.equal(record.sources.length, 1, 'one source');
assert.ok(/^https:\/\/en\.wikipedia\.org\/wiki\/Stowage_factor$/.test(record.sources[0].url), 'source URL');
assert.ok(record.sources[0].title.length > 40, 'source title describes the page');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 26, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 8, 'eight boundary cases');
assert.equal(kinds('validation'), 10, 'ten validation cases');

let checked = 0;
let caseRows = 0;
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = lift(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (key === 'rows') {
      assert.equal(actual.rows.length, value.length, testCase.name + '.rows length');
      value.forEach((want, index) => {
        for (const field of Object.keys(want)) {
          assert.equal(actual.rows[index][field], want[field], `${testCase.name}.rows[${index}].${field}`);
          caseRows += 1;
        }
      });
      continue;
    }
    assert.equal(actual[key], value, `${testCase.name}.${key}`);
    checked += 1;
  }
}

// The catalog keeps growing and this tool is one of its public pages.
assert.equal(catalog.tools.length, 2516, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2255, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === record.category).length, 57, 'category count');

console.log('bulk-cargo-lift-calculator: all checks passed (' + record.testCases.length + ' catalog cases, '
  + checked + ' expected fields, ' + caseRows + ' row fields, ' + sweep + ' sweep plans)');
