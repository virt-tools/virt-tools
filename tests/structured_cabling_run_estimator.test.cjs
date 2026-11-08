/* Regression checks for the structured cabling run estimator: its arithmetic,
   catalogue cases and the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'structured-cabling-run-estimator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* structured-cabling-run-estimator-core:start */');
const end = html.indexOf('/* structured-cabling-run-estimator-core:end */');
assert.ok(start > -1 && end > start, 'cabling core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CablingRunCore;', sandbox);
const C = sandbox.module.exports;

const FOOT = 0.3048;
const closeTo = (actual, expected, label, epsilon) => assert.ok(
  Math.abs(actual - expected) < (epsilon === undefined ? 1e-9 : epsilon),
  label + ': ' + actual + ' vs ' + expected);

const base = { drops: '24', run: '25', rise: '0', slack: '10', box: '304.8', cords: '2' };

function run(input) {
  return C.analyze(input);
}

function failure(input) {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
}

// Independent transcription of the documented method.
const BOX_TABLE = { '304.8': 304.8, '152.4': 152.4, '500': 500 };

function oracle(input) {
  const drops = parseInt(String(input.drops).trim(), 10);
  const num = (value) => Number(String(value).trim().replace(',', '.'));
  const running = num(input.run);
  const riser = num(input.rise);
  const slack = num(input.slack);
  const box = BOX_TABLE[String(input.box).trim()];
  const cords = parseInt(String(input.cords).trim(), 10);
  const perDrop = (running + riser) * (1 + slack / 100);
  const total = perDrop * drops;
  const boxes = Math.ceil(total / box - 1e-9);
  const ordered = boxes * box;
  return {
    drops, run: running, rise: riser, slack, cords, boxMetres: box, perDrop,
    totalMetres: total,
    totalFeet: total / FOOT,
    boxes,
    orderedMetres: ordered,
    spareMetres: ordered - total,
    utilisation: total / ordered * 100,
    patchCords: drops * cords,
  };
}

// Documented surface.
assert.deepEqual([...C.LIMITS.drops], [1, 1000]);
assert.deepEqual([...C.LIMITS.run], [0.5, 150]);
assert.deepEqual([...C.LIMITS.rise], [0, 100]);
assert.deepEqual([...C.LIMITS.slack], [0, 50]);
assert.deepEqual([...C.LIMITS.cords], [0, 4]);
assert.deepEqual(Object.keys(C.BOXES).sort(), ['152.4', '304.8', '500']);
assert.equal(C.BOXES['304.8'].metres, 304.8);
assert.equal(C.BOXES['152.4'].metres, 152.4);
assert.equal(C.BOXES['500'].metres, 500);
assert.equal(C.METRES_PER_FOOT, FOOT);
assert.match(C.MESSAGES.estimate, /site walk/);
assert.match(C.MESSAGES.spareBox, /more than half a box spare/);
assert.match(C.MESSAGES.lowSlack, /under 5 percent/);
assert.match(C.MESSAGES.highSlack, /25 percent or more/);
assert.match(C.MESSAGES.noCords, /No patch cords/);
assert.match(C.MESSAGES.large, /Large job/);

// Golden: the default 24-drop office floor.
const sized = run(base);
assert.equal(sized.drops, 24);
assert.equal(sized.box, '304.8');
assert.equal(sized.boxLabel, '1000 ft box (305 m)');
closeTo(sized.perDrop, 27.5, 'default cable per drop');
closeTo(sized.totalMetres, 660, 'default total metres');
closeTo(sized.totalFeet, 2165.354331, 'default total feet', 1e-6);
assert.equal(sized.boxes, 3, 'default boxes');
closeTo(sized.orderedMetres, 914.4, 'default ordered metres');
closeTo(sized.spareMetres, 254.4, 'default spare');
closeTo(sized.utilisation, 72.178478, 'default utilisation', 1e-6);
assert.equal(sized.patchCords, 48);

// A riser and more slack raise the total; a bigger box lowers the count.
const twoFloors = run({ drops: '30', run: '22', rise: '6', slack: '15', box: '304.8', cords: '2' });
closeTo(twoFloors.perDrop, 32.2, 'riser per drop');
closeTo(twoFloors.totalMetres, 966, 'riser total');
assert.equal(twoFloors.boxes, 4, 'riser boxes');
closeTo(twoFloors.spareMetres, 253.2, 'riser spare');

// A total that lands exactly on a whole box is not rounded up again.
const exact = run({ drops: '4', run: '76.2', rise: '0', slack: '0', box: '304.8', cords: '0' });
closeTo(exact.totalMetres, 304.8, 'exact total');
assert.equal(exact.boxes, 1, 'exact total uses one box');
closeTo(exact.spareMetres, 0, 'exact total has no spare');
closeTo(exact.utilisation, 100, 'exact total is fully used');
assert.equal(exact.patchCords, 0);

// The 500 ft box doubles the count on the same total.
const small = run({ drops: '4', run: '76.2', rise: '0', slack: '0', box: '152.4', cords: '0' });
assert.equal(small.boxes, 2, '500 ft boxes');

// Decimal commas are accepted in every numeric field.
const comma = run({ drops: '8', run: '12,5', rise: '2,5', slack: '7,5', box: '152.4', cords: '2' });
closeTo(comma.perDrop, 16.125, 'comma per drop');
closeTo(comma.totalMetres, 129, 'comma total');
assert.equal(comma.boxes, 1, 'comma boxes');

// Boundaries are inclusive at both ends.
closeTo(run({ drops: '1', run: '0.5', rise: '0', slack: '0', box: '152.4', cords: '0' }).totalMetres,
  0.5, 'smallest job');
const largest = run({ drops: '1000', run: '150', rise: '100', slack: '50', box: '500', cords: '4' });
closeTo(largest.totalMetres, 375000, 'largest job');
assert.equal(largest.boxes, 750, 'largest job boxes');
assert.equal(largest.patchCords, 4000, 'largest patch cords');
closeTo(run({ drops: '2', run: '10', rise: '0', slack: '50', box: '304.8', cords: '2' }).perDrop,
  15, 'slack cap');
closeTo(run({ drops: '2', run: '10', rise: '10', slack: '0', box: '304.8', cords: '2' }).perDrop,
  20, 'riser cap');

// Invariants over a grid of drops, runs, slacks, boxes and cords.
let checked = 0;
for (const drops of ['1', '7', '24', '250']) {
  for (const running of ['0.5', '12.5', '40', '150']) {
    for (const slack of ['0', '10', '33.3', '50']) {
      for (const box of Object.keys(BOX_TABLE)) {
        for (const cords of ['0', '2', '4']) {
          const input = { drops, run: running, rise: '3.5', slack, box, cords };
          const result = run(input);
          const expected = oracle(input);
          for (const key of ['drops', 'run', 'rise', 'slack', 'cords', 'boxMetres', 'perDrop',
            'totalMetres', 'totalFeet', 'boxes', 'orderedMetres', 'spareMetres', 'utilisation',
            'patchCords']) {
            closeTo(result[key], expected[key],
              drops + '/' + running + '/' + slack + '/' + box + '/' + cords + ' ' + key, 1e-9);
          }
          closeTo(result.perDrop, (Number(running) + 3.5) * (1 + Number(slack) / 100),
            'per drop definition');
          assert.ok(result.boxes >= 1, 'at least one box');
          assert.ok(result.orderedMetres >= result.totalMetres, 'ordered covers the total');
          assert.ok(result.spareMetres < result.boxMetres + 1e-9, 'spare is less than a box');
          assert.equal(result.patchCords, result.drops * result.cords, 'patch cords');
          checked += 1;
        }
      }
    }
  }
}

// Refusals name the field in the order it appears on the page.
assert.equal(failure({ drops: '', run: '', rise: '', slack: '', box: '', cords: '' }),
  'Enter the number of drops.');
assert.equal(failure({ drops: '12.5', run: 'x', rise: '-1', slack: '99', box: '9', cords: '9' }),
  'The number of drops must be a whole number.');
assert.equal(failure({ drops: '0', run: '', rise: '', slack: '', box: '', cords: '' }),
  'The number of drops must be between 1 and 1000 drops.');
assert.equal(failure({ drops: '1001', run: '', rise: '', slack: '', box: '', cords: '' }),
  'The number of drops must be between 1 and 1000 drops.');
assert.equal(failure({ drops: '4', run: '', rise: '', slack: '', box: '', cords: '' }),
  'Enter the average run per drop.');
assert.equal(failure({ drops: '4', run: '25m', rise: '', slack: '', box: '', cords: '' }),
  'The average run per drop must be a number.');
assert.equal(failure({ drops: '4', run: '0.4', rise: '', slack: '', box: '', cords: '' }),
  'The average run per drop must be between 0.5 and 150 metres.');
assert.equal(failure({ drops: '4', run: '151', rise: '', slack: '', box: '', cords: '' }),
  'The average run per drop must be between 0.5 and 150 metres.');
assert.equal(failure({ drops: '4', run: '25', rise: '-1', slack: '', box: '', cords: '' }),
  'The riser run per drop must be between 0 and 100 metres.');
assert.equal(failure({ drops: '4', run: '25', rise: '101', slack: '', box: '', cords: '' }),
  'The riser run per drop must be between 0 and 100 metres.');
assert.equal(failure({ drops: '4', run: '25', rise: '1', slack: '', box: '', cords: '' }),
  'Enter the slack allowance.');
assert.equal(failure({ drops: '4', run: '25', rise: '1', slack: '51', box: '', cords: '' }),
  'The slack allowance must be between 0 and 50 percent.');
assert.equal(failure({ drops: '4', run: '25', rise: '1', slack: '10', box: '', cords: '' }),
  'Choose a cable box size from the list.');
assert.equal(failure({ drops: '4', run: '25', rise: '1', slack: '10', box: '1000', cords: '' }),
  'Choose a cable box size from the list.');
assert.equal(failure({ drops: '4', run: '25', rise: '1', slack: '10', box: '304.8', cords: '' }),
  'Enter the patch cords per drop.');
assert.equal(failure({ drops: '4', run: '25', rise: '1', slack: '10', box: '304.8', cords: '1.5' }),
  'The patch cords per drop must be a whole number.');
assert.equal(failure({ drops: '4', run: '25', rise: '1', slack: '10', box: '304.8', cords: '5' }),
  'The patch cords per drop must be between 0 and 4 cords.');

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'IT & Networking');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.deepEqual([...new Set(entry.tags)].sort(), entry.tags.slice().sort(), 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.testCases.length >= 24, 'expected at least twenty-four catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = run(testCase.input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      if (typeof value === 'string') assert.equal(result[key], value, testCase.name + ' ' + key);
      else if (typeof value === 'boolean') assert.equal(result[key], value, testCase.name + ' ' + key);
      else closeTo(result[key], value, testCase.name + ' ' + key, 1e-6);
    }
  }
}

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="cabling-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('aria-describedby'), 'fields must reference their help text');
for (const id of ['drops', 'run', 'rise', 'slack', 'box', 'cords']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label ' + id + ' missing');
}
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');

// The documented defaults and box choices are the ones the page ships.
assert.ok(html.includes('id="drops"') && html.includes('value="24"'), 'default drop count');
assert.ok(html.includes('value="304.8" selected'), 'default box');
const boxOptions = [...html.matchAll(/<option value="([0-9.]+)"[^>]*>/g)].map((match) => match[1]);
assert.deepEqual(boxOptions, ['304.8', '152.4', '500']);

console.log('structured cabling run estimator: ' + entry.testCases.length
  + ' catalog cases, ' + checked + ' grid rows and invariants passed');
