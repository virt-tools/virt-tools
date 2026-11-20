/* Throwing sector marking: the World Athletics sector angles, the sine-of-half-angle
   geometry checked against a law-of-cosines model, the javelin arc offset, the 0.1 degree
   tolerance, a 200-plan sweep with the table grids, refusals, the catalog replay and the
   page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'throwing-sector-marking-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* throwing-core:start */';
const endMarker = '/* throwing-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ThrowingSectorCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.analyse(input || {}));
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};

// ---- An independent model: the law of cosines instead of sine of half the angle.
const MODEL_ANGLE = { shot: 34.92, discus: 34.92, hammer: 34.92, javelin: 28.96 };
const model = (event, units, distance) => {
  const perMetre = units === 'ft' ? 1 / 0.3048 : 1;
  const offset = event === 'javelin' ? 8 * perMetre : 0;
  const radius = distance + offset;
  const theta = MODEL_ANGLE[event] * Math.PI / 180;
  const cross = (angle) => Math.sqrt(2 * radius * radius - 2 * radius * radius * Math.cos(angle));
  return {
    radius,
    cross: cross(theta),
    wider: cross(theta + 0.1 * Math.PI / 180) - cross(theta),
    arc: radius * theta,
    area: 0.5 * radius * radius * theta,
  };
};
const close = (actual, expected, label) => {
  assert.ok(Math.abs(actual - expected) <= 1e-5, label + ': ' + actual + ' vs ' + expected);
};

// ---- Constants and the shipped event table.
assert.equal(C.toleranceDeg, 0.1, 'the sector tolerance is a tenth of a degree');
assert.equal(C.events.shot.angleDeg, 34.92);
assert.equal(C.events.discus.angleDeg, 34.92);
assert.equal(C.events.hammer.angleDeg, 34.92);
assert.equal(C.events.javelin.angleDeg, 28.96);
assert.equal(C.events.shot.circleM, 2.135);
assert.equal(C.events.discus.circleM, 2.5);
assert.equal(C.events.hammer.circleM, 2.135);
assert.equal(C.events.javelin.arcRadiusM, 8);
assert.equal(C.events.javelin.circleM, null);
assert.equal(C.units.m.perMetre, 1);
assert.ok(Math.abs(C.units.ft.perMetre - 3.280839895013123) < 1e-12, 'a foot is 0.3048 m');

// ---- The rule-book shortcut: 0.60 of the line for the circle events, 0.50 for the javelin.
assert.ok(Math.abs(2 * Math.sin(17.46 * Math.PI / 180) - 0.6) < 2e-4, '34.92 degrees is the 0.60 sector');
assert.ok(Math.abs(2 * Math.sin(14.48 * Math.PI / 180) - 0.5) < 2e-4, '28.96 degrees is the 0.50 sector');
const twenty = run({});
assert.equal(Number(twenty.cross.toFixed(2)), 12, '20 m out is 12.00 m across');
assert.equal(Number(run({ distance: '80' }).cross.toFixed(2)), 48.01, '80 m out is 48.01 m across');
assert.equal(Number(run({ distance: '100' }).cross.toFixed(2)), 60.01, '100 m out is 60.01 m across');
const jav92 = run({ event: 'javelin', distance: '92' });
assert.equal(jav92.radial, 100, 'the javelin arc centre is 8 m behind the arc');
assert.equal(Number(jav92.cross.toFixed(2)), 50.01, '100 m from the arc centre is 50.01 m across');

// ---- The javelin radial distance and the circle reference diameters.
const jav = run({ event: 'javelin', distance: '30' });
assert.equal(jav.radial, 38, 'a 30 m javelin mark is 38 m from the arc centre');
assert.equal(jav.offset, 8);
assert.equal(jav.arcRadius, 8);
assert.equal(jav.circleDiameter, null);
assert.equal(run({ event: 'discus' }).circleDiameter, 2.5);
assert.equal(run({ units: 'ft' }).circleDiameter, 7.00459, '2.135 m is 7.00459 ft');

// ---- The 0.1 degree tolerance is 2 inches on a 100 ft cross distance.
const hundredFeet = run({ distance: '100', units: 'ft' });
assert.equal(hundredFeet.tolerance, 0.16647);
assert.ok(Math.abs(hundredFeet.tolerance * 12 - 2.0) < 0.01, 'the published tolerance table agrees');

// ---- Units scale the lengths and leave the angles alone.
const metres = run({ distance: '60' });
const feet = run({ distance: '60', units: 'ft' });
assert.equal(feet.cross, metres.cross, 'the same numeric distance scales identically');
assert.equal(feet.angleDeg, metres.angleDeg);
assert.equal(feet.unitLabel, 'ft');
assert.equal(metres.unitLabel, 'm');
assert.equal(feet.grid.length, 10);
assert.equal(feet.grid[0].distance, 25, 'the feet table steps by 25');
assert.equal(feet.grid[9].distance, 250);

// ---- The table is consistent with the selected distance.
assert.equal(twenty.grid.length, 10);
assert.equal(twenty.grid[0].distance, 10);
assert.equal(twenty.grid[9].distance, 100);
assert.deepEqual(twenty.grid[1], { distance: 20, cross: 12.0016, halfCross: 6.0008, area: 121.89379 });

// ---- A 200-plan sweep against the law-of-cosines model, plus every table row.
const events = ['shot', 'discus', 'hammer', 'javelin'];
const units = ['m', 'ft'];
let rows = 0;
const sweepFailures = [];
for (let plan = 0; plan < 200; plan += 1) {
  const event = events[plan % 4];
  const unit = units[(plan >> 2) % 2];
  const raw = unit === 'm' ? 1 + ((plan * 37) % 1190) / 10 : 3 + ((plan * 53) % 397);
  const distance = Number(raw.toFixed(1));
  const actual = run({ event, units: unit, distance: String(distance) });
  const ref = model(event, unit, distance);
  try {
    close(actual.radial, ref.radius, plan + ' radial');
    close(actual.cross, ref.cross, plan + ' cross');
    close(actual.halfCross, ref.cross / 2, plan + ' half cross');
    close(actual.arc, ref.arc, plan + ' arc');
    close(actual.area, ref.area, plan + ' area');
    close(actual.tolerance, ref.wider, plan + ' tolerance');
    close(actual.ratio, ref.cross / ref.radius, plan + ' ratio');
    const shortcut = event === 'javelin' ? 0.5 : 0.6;
    if (Math.abs(actual.ratio - shortcut) > 2e-4) throw new Error(plan + ' shortcut ' + actual.ratio);
    if (actual.grid.length !== 10) throw new Error(plan + ' grid rows ' + actual.grid.length);
    for (const point of actual.grid) {
      const cell = model(event, unit, point.distance);
      close(point.cross, cell.cross, plan + ' grid cross ' + point.distance);
      close(point.halfCross, cell.cross / 2, plan + ' grid half ' + point.distance);
      close(point.area, cell.area, plan + ' grid area ' + point.distance);
      rows += 1;
    }
  } catch (error) {
    sweepFailures.push(String(error.message));
  }
}
assert.equal(sweepFailures.length, 0, sweepFailures.slice(0, 4).join(' | '));
assert.equal(rows, 2000, 'every sweep plan checks its ten table rows');

// ---- Refusals carry the page's own wording.
assert.equal(failure({ distance: '' }), 'Distance is required.');
assert.equal(failure({ distance: '  ' }), 'Distance is required.');
assert.equal(failure({ distance: 'twenty' }), 'Distance must be a number from 1 to 120 m.');
assert.equal(failure({ distance: '20 m' }), 'Distance must be a number from 1 to 120 m.');
assert.equal(failure({ distance: '1,5' }), 'Distance must be a number from 1 to 120 m.');
assert.equal(failure({ distance: '-20' }), 'Distance must be a number from 1 to 120 m.');
assert.equal(failure({ distance: '0' }), 'Distance must be between 1 and 120 m.');
assert.equal(failure({ distance: '120.5' }), 'Distance must be between 1 and 120 m.');
assert.equal(failure({ distance: '2', units: 'ft' }), 'Distance must be between 3 and 400 ft.');
assert.equal(failure({ distance: '401', units: 'ft' }), 'Distance must be between 3 and 400 ft.');
assert.equal(failure({ event: 'weight' }), 'Event must be shot put, discus, hammer or javelin.');
assert.equal(failure({ event: '' }), 'Event must be shot put, discus, hammer or javelin.');
assert.equal(failure({ units: 'yards' }), 'Units must be metres (m) or feet (ft).');

// ---- Accepted shapes: trims, a number, and the defaults.
assert.equal(run({ distance: ' 30 ' }).distance, 30);
assert.equal(run({ distance: 45 }).cross, 27.00359);
assert.equal(run({ event: 'Javelin', units: 'FT' }).event, 'javelin');
assert.equal(run({}).distance, 20, 'the metres default is 20 m');
assert.equal(run({ units: 'ft' }).distance, 60, 'the feet default is 60 ft');
assert.equal(run({ event: 'discus', distance: '10' }).distance, 10);
assert.equal(run({ distance: '1' }).tolerance, 0.00166);

// ---- The catalog record and its cases agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Throwing Sector Marking Calculator');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.added, '2026-11-19T05:30:00Z');
assert.ok(record.description.includes('landing area'));
assert.ok(record.method.includes('34.92'), 'method names the circle sector angle');
assert.ok(record.method.includes('28.96'), 'method names the javelin sector angle');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('marking arithmetic only'), 'method states the limit');
assert.equal(record.sources.length, 2, 'two sources are cited');
assert.ok(record.sources.every((source) => /^https:\/\//.test(source.url)), 'sources carry fetched URLs');
assert.ok(record.sources.some((source) => source.url.includes('pntf.org')), 'the sector-angle guide is cited');
assert.ok(record.sources.some((source) => source.url.includes('cits.wa.gov.au')), 'the dimensions guide is cited');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-meta', slug + '.json'), 'utf8'));
assert.equal(meta.slug, slug);
assert.equal(meta.category, 'Sports & Outdoors');
assert.equal(meta.testCaseCount, 28, 'the tool-meta record carries the case count');
assert.ok(meta.related.length >= 3, 'related tools are generated');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 28, 'catalog case count');
assert.equal(kinds('golden'), 10, 'ten golden cases');
assert.equal(kinds('boundary'), 7, 'seven boundary cases');
assert.equal(kinds('validation'), 11, 'eleven validation cases');

let checked = 0;
for (const testCase of record.testCases) {
  const input = testCase.input;
  if (testCase.kind === 'validation') {
    assert.equal(failure(input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = run(input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(actual[key], expected, testCase.name + ' ' + key);
    checked += 1;
  }
  const ref = model(input.event || 'shot', input.units || 'm',
    actual.distance);
  close(actual.cross, ref.cross, testCase.name + ' against the model');
}

// The new record's slug, name and aliases must not collide with any other record.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');
for (const tag of ['athletics', 'throws', 'landing-sector', 'field-marking']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}
assert.equal(catalog.tools.length, 2431, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2170, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Sports & Outdoors').length, 53, 'Sports count');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(markupIds).size, markupIds.length, 'no duplicate element ids');
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 6, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.includes(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label class="f" for="in-event">/.test(html), 'the event select has a label');
assert.ok(/<label class="f" for="in-distance">/.test(html), 'the distance field has a label');
assert.ok(/<label class="f" for="in-units">/.test(html), 'the units select has a label');
assert.ok(/<select id="in-event">/.test(html) && /<select id="in-units">/.test(html), 'both selects exist');
assert.ok(/inputmode="decimal"/.test(html), 'the distance opens a numeric keyboard');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/aria-labelledby="grid-title"/.test(html) && /<th scope="col">/.test(html), 'the table is described');
assert.ok(/data-label/.test(html) && /td::before/.test(html), 'stacked cells keep their column name');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/34\.92&deg;/.test(html) && /28\.96&deg;/.test(html), 'the rule-book angles are stated');
assert.equal((html.match(/<form/g) || []).length, 1, 'one form');
assert.equal((html.match(/<table/g) || []).length, 1, 'one table');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('throwing sector marking: ' + record.testCases.length + ' catalog cases, ' + checked
  + ' replayed values, a 200-plan law-of-cosines sweep (' + rows + ' table rows) and the page contract pass');
