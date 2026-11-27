/* Ladder setup geometry: the 4:1 set-back rule against a Decimal reference, the
   catalog cases, the identities that follow from the lean, and the page contract.
   No expected number comes from the page. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ladder-setup-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* laddercore:start */';
const endMarker = '/* laddercore:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = LadderCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, relative) => {
  const rel = relative === undefined ? 1e-9 : relative;
  assert.ok(Number.isFinite(actual), label + ': ' + actual + ' is not a finite number');
  assert.ok(Math.abs(actual - expected) <= rel * Math.max(1, Math.abs(expected)),
    label + ': ' + actual + ' is not within ' + rel + ' of ' + expected);
};
const failure = (input) => {
  try { C.analyze(input); } catch (error) { return error.message; }
  return null;
};
const base = { unit: 'm', height: '3.5', ladder: '4.6' };
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/ladder_setup_vectors.json'), 'utf8'));

// ---- The constants the model turns on.
assert.equal(C.FOOT, 0.3048);
assert.equal(C.EXTENSION, 0.9);
assert.equal(C.QUARTER, 0.25);
assert.equal(JSON.stringify(C.LIMITS.height), JSON.stringify([1, 15]));
assert.equal(JSON.stringify(C.LIMITS.ladder), JSON.stringify([1, 20]));

// ---- The independent reference: 224 vectors across both units.
for (const vector of fixture.vectors) {
  const result = C.analyze(vector.input);
  for (const [key, expected] of Object.entries(vector.expected)) {
    if (typeof expected === 'number') near(result[key], expected, vector.name + ' ' + key);
    else assert.equal(JSON.stringify(result[key]), JSON.stringify(expected), vector.name + ' ' + key);
  }
}

// ---- The catalog record, and the cases it stores.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Ladder Setup Calculator');
assert.equal(entry.category, 'Safety & Emergency');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'high');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(entry.icon, '\u{1FA9C}');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 1200, 'method must document the model, the limits and the exclusions');
assert.equal(entry.sources.length, 2, 'two cited sources');
assert.ok(entry.sources[0].url.endsWith('/1926/1926.1053'), 'the ladder standard is cited');
assert.ok(entry.sources[1].url.endsWith('OSHA3124.pdf'), 'the guide booklet is cited');
assert.equal(entry.testCases.length, 24, 'catalog case count');
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'golden').length, 9);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'boundary').length, 5);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'validation').length, 10);
assert.equal(JSON.stringify(entry.testCases), JSON.stringify(fixture.cases), 'the catalog cases are the fixture cases');

for (const testCase of entry.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.analyze(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') near(result[key], expected, testCase.name + ' ' + key);
    else assert.equal(JSON.stringify(result[key]), JSON.stringify(expected), testCase.name + ' ' + key);
  }
}

// ---- Identities that follow from the quarter set-back.
const r = C.analyze(base);
near(r.working, 4 * r.setback, 'the working length is four set-backs', 1e-12);
near(r.height * r.height, r.working * r.working - r.setback * r.setback,
  'the height, the set-back and the working length form a right triangle', 1e-9);
near(Math.cos(r.angle * Math.PI / 180), C.QUARTER, 'the lean angle has a cosine of one quarter', 1e-12);
near(r.angle, 75.52248781407008, 'a quarter set-back leans the ladder at 75.5 degrees', 1e-12);
near(r.angleFromVertical, 90 - r.angle, 'the two angle readings are complements', 1e-12);
near(r.railNeeded, r.working + C.EXTENSION, 'the rail length adds 0.9 m above the landing', 1e-12);
near(r.setback, 0.9036961141150639, 'the default 3.5 m climb sets the foot 0.90 m back', 1e-12);
near(r.working, 3.6147844564602556, 'the default climb uses 3.61 m of rail', 1e-12);
near(r.above, 0.9852155435397443, 'the default 4.6 m ladder stands 0.99 m above the landing', 1e-12);
assert.equal(r.status, 'ok');
assert.equal(r.warnings.length, 0, 'the default setup has nothing to warn about');
assert.equal(r.unit, 'm');

// Doubling the height doubles every length; the angle never moves.
const taller = C.analyze({ ...base, height: '7' });
near(taller.working, 2 * r.working, 'the working length scales with the height', 1e-12);
near(taller.setback, 2 * r.setback, 'the set-back scales with the height', 1e-12);
near(taller.angle, r.angle, 'the lean angle does not depend on the height', 1e-12);

// The same climb in feet is the same climb in metres.
const inFeet = C.analyze({ unit: 'ft', height: '11.482939632545932', ladder: '15.091863517060367' });
near(inFeet.height, 3.5, 'feet convert at 0.3048', 1e-12);
near(inFeet.working, r.working, 'the working length is unit-free', 1e-9);
near(inFeet.setback, r.setback, 'the set-back is unit-free', 1e-9);
near(inFeet.setbackFeet, r.setback / 0.3048, 'the reported feet agree with the metres', 1e-12);

// ---- The three verdicts, on the boundaries between them.
const exact = C.analyze({ ...base, ladder: (r.working + 0.000001).toFixed(6) });
assert.equal(exact.status, 'low', 'a ladder that only just reaches the support is low, not short');
near(exact.above, 0, 'a ladder cut to the working length has nothing above the landing', 1e-5);
const enough = C.analyze({ ...base, ladder: (r.working + C.EXTENSION + 0.000001).toFixed(6) });
assert.equal(enough.status, 'ok', 'the working length plus the extension is enough');
const shortLadder = C.analyze({ ...base, ladder: '3' });
assert.equal(shortLadder.status, 'short');
assert.ok(shortLadder.above < 0);
const lowLadder = C.analyze({ ...base, ladder: '4.0' });
assert.equal(lowLadder.status, 'low');

// ---- Warnings.
const longClimb = C.analyze({ ...base, height: '8.5', ladder: '10' });
assert.equal(longClimb.warnings.length, 1);
assert.ok(longClimb.warnings[0].startsWith('An 8 m climb or more'));
assert.equal(C.analyze({ ...base, height: '8', ladder: '9' }).warnings.length, 0, '8 m exactly is not warned');
const overlong = C.analyze({ ...base, height: '8.5', ladder: '15' });
assert.ok(overlong.warnings.some((line) => line.startsWith('More than 3 m of rail')));

// ---- Refusals and parsing.
assert.equal(failure({ ...base, height: '' }), 'Enter the height to the landing.');
assert.equal(failure({ ...base, ladder: '' }), 'Enter the ladder length.');
assert.equal(failure({ unit: 'yd', height: '3.5', ladder: '4.6' }), 'Choose metres or feet.');
assert.equal(failure({ ...base, height: '0.9' }),
  'The height must be a number from 1 to 15 metres (about 3.3 to 49 feet).');
assert.equal(failure({ ...base, ladder: '21' }),
  'The ladder length must be a number from 1 to 20 metres (about 3.3 to 66 feet).');
assert.equal(failure({ ...base, height: '3.5 m' }),
  'The height must be a number from 1 to 15 metres (about 3.3 to 49 feet).');
assert.equal(failure({ unit: null, height: '3.5', ladder: '4.6' }), null, 'an absent unit defaults to metres');
assert.equal(C.analyze({ unit: null, height: '3.5', ladder: '4.6' }).unit, 'm');
assert.equal(failure({ unit: 'M', height: '3,5', ladder: '4,6' }), null, 'an upper-case unit and decimal commas are accepted');
near(C.analyze({ unit: 'M', height: '3,5', ladder: '4,6' }).height, 3.5, 'a comma decimal is read as a point');
assert.equal(failure({ ...base, height: '+3.5' }), null, 'a leading plus is tolerated');
assert.equal(failure({ ...base, height: ' 3.5 ' }), null, 'surrounding spaces are tolerated');

// ---- Page contract: shared shell, accessible controls, no runtime foreign APIs.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html), 'network or storage API found');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'remote script');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'remote stylesheet');
assert.ok(!/on(?:click|input|change|submit)=/i.test(html), 'inline handler');
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html), 'unsafe script evaluation');
assert.ok(html.includes('<form id="ld-form" novalidate>'), 'form missing');
assert.ok(html.includes('type="submit"'), 'submit missing');
assert.ok(html.includes('role="alert"'), 'error announcement missing');
assert.ok(html.includes('aria-live="polite" aria-atomic="true"'), 'result region missing');
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'), 'shared shell assets missing');
assert.ok(html.includes('/assets/theme-init.js'), 'theme bootstrap missing');
for (const id of ['unit', 'height', 'ladder']) {
  assert.ok(html.includes('for="' + id + '"'), 'missing label for ' + id);
  assert.ok(html.includes('id="' + id + '"'), 'missing control ' + id);
}
for (const id of ['ld-form', 'ld-err', 'ld-out', 'note', 'reset', 'submit']) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}
assert.ok(html.includes('class="u"'), 'the unit suffix span missing');
assert.ok(html.includes('min-height:44px'), 'controls must stay at a 44 px touch target');
assert.ok(/@media \(max-width:360px\)/.test(html), 'small-screen rule missing');
assert.ok(!/style="[^"]*width:\s*\d{3,}px/.test(html), 'fixed wide inline styles');

const publicCount = catalog.tools.filter((tool) => tool.listed).length;
assert.equal(publicCount, 2241, 'the catalog keeps growing: ' + publicCount);
assert.equal(catalog.tools.filter((tool) => tool.category === 'Safety & Emergency').length, 51,
  'Safety & Emergency count');

console.log('ladder-setup-calculator: 24 catalog cases, ' + fixture.vectors.length +
  ' reference vectors, identities and page contracts passed');
