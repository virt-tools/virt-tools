/* Spur gear geometry: catalog fixtures, a published contact-ratio anchor, geometry identities,
   scale and monotonicity checks, and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'spur-gear-geometry-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* spur-gear-core:start */';
const endMarker = '/* spur-gear-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = SpurGearCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one spur gear geometry record');
const record = records[0];
assert.equal(record.name, 'Spur Gear Geometry Calculator');
assert.equal(record.category, 'Mechanical & Structural Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.ok(record.description.length > 150, 'description names the inputs and the outputs');
assert.ok(record.method.length > 900, 'method documents the model, the limits and the exclusions');
assert.match(record.method, /does not check bending or pitting strength/, 'method refuses a strength rating');
assert.equal(record.sources.length, 4);
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'source uses https');
  assert.ok(source.title.length > 60, 'source title names the document and the part used');
}
assert.equal(record.testCases.length, 25);
assert.equal(record.testCases.filter((test) => test.kind === 'golden').length, 8);
assert.equal(record.testCases.filter((test) => test.kind === 'boundary').length, 7);
assert.equal(record.testCases.filter((test) => test.kind === 'validation').length, 10);
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
for (const tag of record.tags) assert.equal(tag, tag.toLowerCase(), 'tags are lowercase');
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  const own = [record.slug, record.name.toLowerCase(), ...record.aliases.map((a) => a.toLowerCase())];
  const theirs = [other.slug, other.name.toLowerCase(), ...(other.aliases || []).map((a) => a.toLowerCase())];
  for (const value of own) {
    assert.equal(theirs.includes(value), false, 'name, alias or slug already used: ' + value);
  }
}

const closeTo = (actual, expected, relative, label) => {
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * relative + 1e-12,
    label + ': got ' + actual + ', expected ' + expected);
};

function pick(result, key) {
  switch (key) {
    case 'centreDistance': return result.centreDistance;
    case 'ratio': return result.ratio;
    case 'ratioText': return result.ratioText;
    case 'circularPitch': return result.circularPitch;
    case 'basePitch': return result.basePitch;
    case 'pathOfContact': return result.pathOfContact;
    case 'contactRatio': return result.contactRatio;
    case 'minTeeth': return result.undercutLimit;
    case 'doubleShare': return result.doubleShare;
    case 'undercut': return result.undercut;
    case 'pinionPitch': return result.pinion.pitchDiameter;
    case 'pinionTip': return result.pinion.tipDiameter;
    case 'pinionRoot': return result.pinion.rootDiameter;
    case 'pinionBase': return result.pinion.baseDiameter;
    case 'gearPitch': return result.gear.pitchDiameter;
    case 'gearTip': return result.gear.tipDiameter;
    case 'gearRoot': return result.gear.rootDiameter;
    case 'gearBase': return result.gear.baseDiameter;
    default: throw new Error('unmapped expectation ' + key);
  }
}

function failure(input) {
  try { C.analyze(input); } catch (error) { return error.userMessage || error.message; }
  return null;
}

let replayed = 0;
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    replayed += 1;
    continue;
  }
  const result = C.analyze(testCase.input);
  for (const [key, want] of Object.entries(testCase.expected)) {
    const actual = pick(result, key);
    if (typeof want === 'number') {
      closeTo(actual, want, 2e-5, testCase.name + ': ' + key);
    } else if (want === null) {
      assert.equal(actual, null, testCase.name + ': ' + key + ' should be not applicable');
    } else {
      assert.equal(actual, want, testCase.name + ': ' + key);
    }
  }
  replayed += 1;
}
assert.equal(replayed, 25);

// Published anchor: an independent contact-ratio calculator for module 2 mm, 20 and 40 teeth at 20 degrees
// states 1.635185964. The page is built from the same standard geometry and must land on that number.
const anchor = C.analyze({module: '2', pinionTeeth: '20', gearTeeth: '40', pressureAngle: '20'});
closeTo(anchor.contactRatio, 1.635185964, 1e-5, 'published contact ratio for 20/40 teeth at 20 degrees');
closeTo(anchor.centreDistance, 60, 1e-12, 'the KHK worked example centre distance');
closeTo(anchor.pinion.pitchDiameter, 40, 1e-12, 'the KHK worked example pinion diameter');
closeTo(anchor.pinion.baseDiameter, 40 * Math.cos(20 * Math.PI / 180), 1e-12, 'base diameter is d cos alpha');

// Geometry identities on a spread of inputs: every diameter follows from the module and the tooth count.
const IDENTITIES = [
  {module: '2', pinionTeeth: '20', gearTeeth: '40', pressureAngle: '20'},
  {module: '3.25', pinionTeeth: '13', gearTeeth: '71', pressureAngle: '17.5'},
  {module: '0.5', pinionTeeth: '48', gearTeeth: '9', pressureAngle: '25'},
  {module: '12', pinionTeeth: '120', gearTeeth: '360', pressureAngle: '14.5'}
];
for (const input of IDENTITIES) {
  const r = C.analyze(input);
  const m = Number(input.module);
  const alpha = Number(input.pressureAngle) * Math.PI / 180;
  for (const wheel of [r.pinion, r.gear]) {
    closeTo(wheel.pitchDiameter, m * wheel.teeth, 1e-12, 'pitch diameter = m z');
    closeTo(wheel.tipDiameter, wheel.pitchDiameter + 2 * m, 1e-12, 'tip diameter = d + 2m');
    closeTo(wheel.rootDiameter, wheel.pitchDiameter - 2.5 * m, 1e-12, 'root diameter = d - 2.5m');
    closeTo(wheel.baseDiameter, wheel.pitchDiameter * Math.cos(alpha), 1e-12, 'base diameter = d cos alpha');
  }
  closeTo(r.centreDistance, (r.pinion.pitchDiameter + r.gear.pitchDiameter) / 2, 1e-12, 'centre distance is half the sum of the diameters');
  closeTo(r.contactRatio, r.pathOfContact / r.basePitch, 1e-12, 'contact ratio is the path of contact over the base pitch');
  closeTo(r.basePitch, Math.PI * m * Math.cos(alpha), 1e-12, 'base pitch = pi m cos alpha');
  const pathFromRadii = Math.sqrt(Math.pow(r.pinion.tipDiameter / 2, 2) - Math.pow(r.pinion.baseDiameter / 2, 2)) +
    Math.sqrt(Math.pow(r.gear.tipDiameter / 2, 2) - Math.pow(r.gear.baseDiameter / 2, 2)) -
    r.centreDistance * Math.sin(alpha);
  closeTo(r.pathOfContact, pathFromRadii, 1e-12, 'path of contact from the tip and base radii');
  closeTo(r.addendum, m, 1e-12, 'addendum = m');
  closeTo(r.wholeDepth, 2.25 * m, 1e-12, 'whole depth = 2.25m');
  assert.ok(r.pinion.rootDiameter > 0, 'the root diameter stays positive across the accepted range');
  assert.ok(r.contactRatio > 0 && Number.isFinite(r.contactRatio), 'the contact ratio is finite');
  if (r.doubleShare !== null) closeTo(r.doubleShare, r.contactRatio - 1, 1e-12, 'the two-pair share is the fractional contact ratio');
}

// Scaling the module scales every diameter and leaves the dimensionless contact ratio unchanged.
const base = C.analyze({module: '2', pinionTeeth: '20', gearTeeth: '40', pressureAngle: '20'});
const scaled = C.analyze({module: '8', pinionTeeth: '20', gearTeeth: '40', pressureAngle: '20'});
closeTo(scaled.centreDistance / base.centreDistance, 4, 1e-12, 'centre distance scales with the module');
closeTo(scaled.pinion.tipDiameter / base.pinion.tipDiameter, 4, 1e-12, 'tip diameter scales with the module');
closeTo(scaled.contactRatio, base.contactRatio, 1e-12, 'contact ratio is independent of the module');

// A smaller pressure angle lengthens the path of contact and raises the contact ratio.
const shallow = C.analyze({module: '2', pinionTeeth: '20', gearTeeth: '40', pressureAngle: '14.5'});
const steep = C.analyze({module: '2', pinionTeeth: '20', gearTeeth: '40', pressureAngle: '25'});
assert.ok(shallow.contactRatio > base.contactRatio && base.contactRatio > steep.contactRatio,
  'contact ratio falls as the pressure angle rises');

// More teeth at the same module and angle mean a higher contact ratio.
const few = C.analyze({module: '2', pinionTeeth: '12', gearTeeth: '24', pressureAngle: '20'});
const many = C.analyze({module: '2', pinionTeeth: '30', gearTeeth: '60', pressureAngle: '20'});
assert.ok(many.contactRatio > base.contactRatio && base.contactRatio > few.contactRatio,
  'contact ratio rises with the tooth count');

// The undercut limit follows 2 / sin^2(alpha): 17.1 teeth at 20 degrees, 31.9 at 14.5, 8 at 30.
closeTo(base.undercutLimit, 2 / Math.pow(Math.sin(20 * Math.PI / 180), 2), 1e-12, 'undercut limit at 20 degrees');
closeTo(shallow.undercutLimit, 2 / Math.pow(Math.sin(14.5 * Math.PI / 180), 2), 1e-12, 'undercut limit at 14.5 degrees');
assert.equal(C.analyze({module: '2', pinionTeeth: '17', gearTeeth: '40', pressureAngle: '20'}).undercut, true,
  '17 teeth sit below the 17.1-tooth limit');
assert.equal(C.analyze({module: '2', pinionTeeth: '18', gearTeeth: '40', pressureAngle: '20'}).undercut, false,
  '18 teeth clear the limit');
assert.equal(C.analyze({module: '2', pinionTeeth: '20', gearTeeth: '40', pressureAngle: '20'}).doubleShare,
  C.analyze({module: '2', pinionTeeth: '20', gearTeeth: '40', pressureAngle: '20'}).contactRatio - 1,
  'a contact ratio between 1 and 2 exposes the two-pair share');
assert.equal(C.analyze({module: '2', pinionTeeth: '20', gearTeeth: '40', pressureAngle: '30'}).doubleShare === null, false,
  'a normal pair still reports the two-pair share');
const aboveTwo = C.analyze({module: '0.1', pinionTeeth: '20', gearTeeth: '40', pressureAngle: '12'});
assert.ok(aboveTwo.contactRatio > 2 && aboveTwo.doubleShare === null,
  'a contact ratio above 2 does not invent a two-pair share');

// A ratio is reported as a reduced integer pair with the gear first, even when the pinion is larger.
assert.equal(C.analyze({module: '2', pinionTeeth: '30', gearTeeth: '90', pressureAngle: '20'}).ratioText, '3:1');
assert.equal(C.analyze({module: '2', pinionTeeth: '90', gearTeeth: '30', pressureAngle: '20'}).ratioText, '1:3');
assert.equal(C.analyze({module: '2', pinionTeeth: '21', gearTeeth: '49', pressureAngle: '20'}).ratioText, '7:3');

// Refusals that are not catalog cases.
assert.throws(() => C.analyze({module: '2', pinionTeeth: '-20', gearTeeth: '40', pressureAngle: '20'}), /pinion/);
assert.throws(() => C.analyze({module: '2', pinionTeeth: '20', gearTeeth: '', pressureAngle: '20'}), /gear/);
assert.throws(() => C.analyze({module: '2', pinionTeeth: '20', gearTeeth: '40', pressureAngle: 'twenty'}), /pressure angle/);
assert.throws(() => C.analyze({module: '2', pinionTeeth: '20', gearTeeth: '40', pressureAngle: ''}), /pressure angle/);
assert.throws(() => C.analyze({module: '  ', pinionTeeth: '20', gearTeeth: '40', pressureAngle: '20'}), /module/);

// Page contract: shared shell, keyboard-submittable form, accessible output, no foreign runtime.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html));
assert.ok(!/<script[^>]+src="https?:/i.test(html));
assert.ok(!/<link[^>]+href="https?:/i.test(html));
assert.ok(!/on(?:click|input|change|submit)=/i.test(html));
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html));
assert.ok(html.includes('<form id="sg-form" novalidate>'));
assert.ok(html.includes('type="submit"'));
assert.ok(html.includes('role="alert"'));
assert.ok(html.includes('role="status" aria-live="polite"'));
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.equal((html.match(/<h1>/g) || []).length, 1);
for (const id of html.matchAll(/\bid="([a-z0-9-]+)"/g)) {
  assert.equal((html.match(new RegExp('id="' + id[1] + '"', 'g')) || []).length, 1, 'duplicate id ' + id[1]);
}
for (const match of html.matchAll(/\$\('([a-z0-9-]+)'\)/g)) assert.ok(html.includes('id="' + match[1] + '"'), 'missing id ' + match[1]);
for (const id of ['sg-module', 'sg-pinion', 'sg-gear', 'sg-angle']) assert.ok(html.includes('for="' + id + '"'), 'missing label ' + id);
assert.ok(html.includes('data-label'), 'stacked cells keep their header label');
assert.ok(html.includes('id="sg-module" type="text" inputmode="decimal" value="2"'), 'the module is prefilled');
assert.ok(!/back\b[^>]*href/i.test(html), 'the shared shell owns navigation');

console.log('spur-gear-geometry-calculator: 25 catalog cases, the published 1.635185964 anchor, ' +
  IDENTITIES.length + ' geometry identity checks, scaling, monotonicity and the page contract passed');
