/* Regression checks for the dolly zoom planner core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'dolly-zoom-planner';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* dolly-core:start */');
const end = html.indexOf('/* dolly-core:end */');
assert.ok(start > -1 && end > start, 'dolly core markers missing');
const core = html.slice(start, end + '/* dolly-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = DollyCore;', sandbox);
const T = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const plan = (input) => plain(T.plan(input));
const failure = (input) => {
  try {
    plan(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
const D = { focal: '50', start: '3', end: '1.5', background: '20' };
const withInput = (overrides) => Object.assign({}, D, overrides);
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} is not within ${tolerance} of ${expected}`);
};

// Documented surface.
assert.equal(T.MIN_FOCAL, 4);
assert.equal(T.MAX_FOCAL, 1200);
assert.equal(T.MIN_DISTANCE, 0.2);
assert.equal(T.MAX_DISTANCE, 1000);
assert.equal(T.MIN_BACKGROUND, 0.5);
assert.equal(T.MAX_BACKGROUND, 5000);

// Defaults: 50 mm at 3 m matching 25 mm at 1.5 m.
const base = plan(D);
assert.equal(base.focalMm, 50);
assert.equal(base.endFocalMm, 25);
assert.equal(base.zoomRatio, 0.5);
assert.equal(base.dollyMetres, 1.5);
assert.equal(base.dollyDirection, 'in');
assert.equal(base.zoomDirection, 'out');
assert.equal(base.backgroundPercent, 49.94);
assert.equal(base.steps.length, 5);
assert.deepEqual(base.steps.map((step) => step.fraction), [0, 0.25, 0.5, 0.75, 1]);
assert.equal(base.steps[0].distanceMetres, 3);
assert.equal(base.steps[0].backgroundPercent, 100);
assert.equal(base.steps[4].focalMm, base.endFocalMm);

// The reversed move returns the original lens and the reciprocal background.
const back = plan({ focal: '25', start: '1.5', end: '3', background: '20' });
assert.equal(back.endFocalMm, 50);
assert.equal(back.zoomRatio, 2);
assert.equal(back.dollyDirection, 'out');
assert.equal(back.zoomDirection, 'in');
close(back.backgroundPercent, 10000 / base.backgroundPercent, 0.02, 'background reciprocal');

// A dolly out with a zoom in, and a very distant background.
const out = plan({ focal: '50', start: '2', end: '3', background: '20' });
assert.equal(out.endFocalMm, 75);
assert.equal(out.zoomRatio, 1.5);
assert.equal(out.dollyMetres, 1);
assert.equal(out.dollyDirection, 'out');
assert.equal(out.zoomDirection, 'in');
assert.equal(out.backgroundPercent, 150.19);
const far = plan({ focal: '50', start: '3', end: '1.5', background: '5000' });
assert.equal(far.backgroundPercent, 50);

// The background changes by the zoom ratio when it is far behind the subject.
const near = plan({ focal: '50', start: '3', end: '1.5', background: '6' });
assert.ok(near.backgroundPercent < base.backgroundPercent,
  'a nearer background shrinks more than a distant one');
assert.ok(near.backgroundPercent < 100, 'the background still shrinks on a dolly-in');

// A dense sweep: the end focal length is the start focal length times the
// distance ratio, and the subject's magnification is unchanged at both ends.
let sweep = 0;
const focals = ['4', '8', '12.5', '18', '24', '35', '50', '85', '135', '300', '800', '1200'];
const distances = ['0.25', '0.5', '1', '1.5', '2', '3', '4.5', '6', '8', '10', '15', '25', '50', '120', '500'];
for (const focal of focals) {
  for (const startDistance of distances) {
    for (const ratio of [0.25, 0.5, 0.75, 1.5, 2, 3]) {
      const endDistance = Number(startDistance) * ratio;
      if (endDistance < T.MIN_DISTANCE || endDistance > T.MAX_DISTANCE) continue;
      if (Number(focal) >= Number(startDistance) * 1000) continue;
      const background = Math.max(Number(startDistance), endDistance) * 2 + 0.5;
      if (background > T.MAX_BACKGROUND) continue;
      const result = plan({
        focal, start: startDistance, end: String(Number(endDistance.toFixed(3))), background: String(background)
      });
      const expectedFocal = Number(focal) * endDistance / Number(startDistance);
      close(result.endFocalMm, expectedFocal, 0.06, 'end focal length ' + focal + '/' + startDistance);
      close(result.zoomRatio, result.endFocalMm / result.focalMm, 0.005, 'zoom ratio');
      const m1 = Number(focal) / (Number(startDistance) * 1000 - Number(focal));
      const m2 = result.endFocalMm / (result.steps[4].distanceMetres * 1000 - result.endFocalMm);
      close(m2 / m1, 1, 0.01, 'constant subject magnification ' + focal + '/' + startDistance + '->' + result.steps[4].distanceMetres);
      close(result.dollyMetres, Math.abs(Number(result.steps[4].distanceMetres) - Number(startDistance)), 0.002,
        'dolly travel');
      assert.equal(result.dollyDirection, Number(result.steps[4].distanceMetres) < Number(startDistance) ? 'in' : 'out');
      sweep += 1;
    }
  }
}
assert.ok(sweep > 300, 'the sweep covers the grid, got ' + sweep);

// The step table walks the move monotonically and keeps the subject's framing.
const table = plan({ focal: '100', start: '6', end: '3', background: '25' });
assert.deepEqual(table.steps.map((step) => step.distanceMetres), [6, 5.25, 4.5, 3.75, 3]);
assert.deepEqual(table.steps.map((step) => step.focalMm), [100, 87.5, 75, 62.5, 50]);
const percent = table.steps.map((step) => step.backgroundPercent);
for (let index = 1; index < percent.length; index++) {
  assert.ok(percent[index] < percent[index - 1], 'background shrinks at step ' + index);
  assert.ok(table.steps[index].focalMm < table.steps[index - 1].focalMm, 'focal shortens at step ' + index);
  const magnification = table.steps[index].focalMm
    / (table.steps[index].distanceMetres * 1000 - table.steps[index].focalMm);
  close(magnification, table.steps[0].focalMm / (6000 - table.steps[0].focalMm), 1e-6,
    'step ' + index + ' framing');
}

// Round trips: reversing a planned move returns the original lens.
let trips = 0;
for (const focal of ['10', '20', '24', '35', '50', '85', '200']) {
  for (const pair of [['1', '2'], ['2', '1'], ['3', '1.5'], ['1.5', '3'], ['8', '4'], ['0.5', '0.25']]) {
    const [startDistance, endDistance] = pair;
    const forward = plan({ focal, start: startDistance, end: endDistance, background: '40' });
    const reverse = plan({
      focal: String(forward.endFocalMm), start: endDistance, end: startDistance, background: '40'
    });
    close(reverse.endFocalMm, Number(focal), 0.1, 'round trip ' + focal + ' ' + pair.join('->'));
    trips += 1;
  }
}

// Both numeric strings and plain numbers are accepted, including a float with
// binary noise from a sweep.
assert.deepEqual(plan({ focal: 50, start: 3, end: 1.5, background: 20 }), base);
const noisy = plan({ focal: 50, start: 3.0000000000000004, end: 1.5, background: 20 });
assert.equal(noisy.endFocalMm, 25);

// Refusals name the field and the rule.
assert.equal(failure(withInput({ focal: '' })), 'Focal length is required.');
assert.equal(failure(withInput({ focal: '3' })), 'Focal length must be a number from 4 to 1200.');
assert.equal(failure(withInput({ focal: '1201', start: '60', end: '30' })),
  'Focal length must be a number from 4 to 1200.');
assert.equal(failure(withInput({ focal: 'abc' })), 'Focal length must be a number from 4 to 1200.');
assert.equal(failure(withInput({ start: '' })), 'Start distance is required.');
assert.equal(failure(withInput({ start: '0.1' })), 'Start distance must be a number from 0.2 to 1000.');
assert.equal(failure(withInput({ start: '1001' })), 'Start distance must be a number from 0.2 to 1000.');
assert.equal(failure(withInput({ end: '0.1' })), 'End distance must be a number from 0.2 to 1000.');
assert.equal(failure(withInput({ end: '3' })),
  'End distance must differ from the start distance; a dolly zoom needs a camera move.');
assert.equal(failure(withInput({ focal: '300', start: '0.2', end: '0.4' })),
  'Focal length must be shorter than the start distance; move the camera farther away.');
assert.equal(failure(withInput({ background: '' })), 'Background distance is required.');
assert.equal(failure(withInput({ background: '0.4' })),
  'Background distance must be a number from 0.5 to 5000.');
assert.equal(failure(withInput({ background: '5001' })),
  'Background distance must be a number from 0.5 to 5000.');
assert.equal(failure(withInput({ background: '3' })),
  'Background distance must be beyond the subject at both ends of the move.');
assert.equal(failure(withInput({ background: '2', end: '2.5' })),
  'Background distance must be beyond the subject at both ends of the move.');
// The focal length is checked before the background distance.
assert.equal(failure(withInput({ focal: '300', start: '0.2', background: '0.1' })),
  'Focal length must be shorter than the start distance; move the camera farther away.');
// The distances are checked before the background distance.
assert.equal(failure(withInput({ start: '0.1', background: '0.1' })),
  'Start distance must be a number from 0.2 to 1000.');

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="dolly-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/type="button" id="reset"/.test(html), 'page has an explicit reset button');
assert.ok(/role="alert"/.test(html), 'errors are announced as alerts');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<table class="tbl" aria-labelledby="steps-heading">/.test(html), 'table is labelled by its heading');
for (const control of ['focal', 'start', 'end', 'background']) {
  assert.ok(new RegExp(`<label for="${control}">`).test(html), `${control} is labelled`);
  assert.ok(new RegExp(`id="${control}"[^>]*aria-describedby=`).test(html), `${control} has a help text`);
}
assert.ok(/min-height:44px/.test(html), 'controls keep a 44 px target');
assert.ok(/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(html), 'fields pair two per row');
assert.ok(/@media \(max-width:560px\)/.test(html), 'the page stacks on a narrow screen');
assert.ok(/<html lang=/.test(html) && /name="viewport"/.test(html), 'page has language and viewport');
assert.ok(/<h1>Dolly Zoom Planner<\/h1>/.test(html), 'page has its heading');
assert.ok(/name="description"/.test(html), 'page has a description');
assert.ok(/<\/html>\s*$/.test(html), 'page is complete');
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'the page has no duplicate ids');

// Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Dolly Zoom Planner');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.tags.includes('dolly-zoom') && record.tags.includes('focal-length'), 'record tags');
assert.ok(record.aliases.some((alias) => /Vertigo Effect Planner/.test(alias)), 'record alias');
assert.ok(/f2 = f1 x d2 \/ d1/.test(record.method), 'method states the relation');
assert.ok(/no storage, uploads or network access/.test(record.method), 'method documents local limits');
assert.equal(record.sources.length, 2, 'two sources');
for (const source of record.sources) {
  assert.ok(source.title && /^https:\/\//.test(source.url), 'source has a title and an https URL');
}
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 26, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 8, 'eight boundary cases');
assert.equal(kinds('validation'), 10, 'ten validation cases');

let checked = 0;
let caseSteps = 0;
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = plan(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (key === 'steps') {
      assert.equal(actual.steps.length, value.length, testCase.name + '.steps length');
      value.forEach((want, index) => {
        for (const field of Object.keys(want)) {
          assert.equal(actual.steps[index][field], want[field], `${testCase.name}.steps[${index}].${field}`);
          caseSteps += 1;
        }
      });
      continue;
    }
    assert.equal(actual[key], value, `${testCase.name}.${key}`);
    checked += 1;
  }
}

console.log('dolly-zoom-planner: all checks passed (' + record.testCases.length + ' catalog cases, '
  + checked + ' expected fields, ' + caseSteps + ' step fields, ' + sweep + ' sweep plans, '
  + trips + ' round trips)');
