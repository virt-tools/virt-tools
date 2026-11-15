/* Regression checks for the four-bar linkage core.
 * The Grashof condition, the classification and the toggle positions follow the
 * four-bar linkage references cited in the catalog record, and the position
 * solution is the standard closed-loop construction of two circles.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const pagePath = path.join(root, 'frontend/tools/four-bar-linkage-calculator/index.html');
const html = fs.readFileSync(pagePath, 'utf8');
const startMarker = '/* four-bar-core:start */';
const endMarker = '/* four-bar-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'four-bar core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = FourBarCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'four-bar-linkage-calculator');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function close(actual, expected, label, tolerance) {
  const limit = tolerance || 1e-11;
  if (expected === 0) {
    assert.ok(Math.abs(actual) <= 1e-12, label + ': expected 0, got ' + actual);
    return;
  }
  const relative = Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(relative <= limit, label + ': ' + actual + ' vs ' + expected + ' (' + relative + ')');
}

// 1. The catalog record exists and stays a conservative, listed, documented tool.
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Four-Bar Linkage Calculator');
assert.equal(record.category, 'Mechanical & Structural Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 80, 'description is too thin');
assert.ok(record.method.includes('Grashof condition'), 'method states the condition');
assert.ok(record.method.includes('transmission angle'), 'method names the transmission angle');
assert.ok(record.tags.includes('four-bar-linkage') && record.tags.includes('grashof'), 'tags name the domain');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique inside the record');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique inside the record');
assert.equal(record.sources.length, 3, 'all three references are cited');
for (const source of record.sources) {
  assert.ok(source.title && /^https:\/\//.test(source.url), 'source has a title and an https URL');
}

// 2. Every documented case replays through the core.
assert.ok(record.testCases.length >= 25, 'the record documents a useful number of cases');
let goldens = 0;
let refusals = 0;
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.throws(() => C.calculate(testCase.input), (error) => {
      assert.equal(error.message, testCase.expectedError, 'message for ' + testCase.name);
      return true;
    }, testCase.name);
    refusals += 1;
    continue;
  }
  const result = plain(C.calculate(testCase.input));
  assert.deepEqual(Object.keys(result).sort(), Object.keys(testCase.expected).sort(),
    'result fields for ' + testCase.name);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') {
      close(result[key], expected, testCase.name + ' / ' + key);
    } else {
      assert.deepEqual(result[key], expected, testCase.name + ' / ' + key);
    }
  }
  goldens += 1;
}
assert.ok(goldens >= 12 && refusals >= 12, 'golden and refusal cases are both present');

// 3. The documented defaults load on the page and reproduce the header numbers.
const defaults = C.calculate({});
close(defaults.upperRockerDeg, 82.69072288766812, 'default rocker angle');
close(defaults.upperCouplerDeg, 24.78067414394842, 'default coupler angle');
close(defaults.upperTransmissionDeg, 57.9100487437197, 'default transmission angle');
close(defaults.rockerSwingDeg, 64.01079221996815, 'default rocker swing');
assert.equal(defaults.mechanism, 'crank-rocker');
assert.equal(defaults.shortestLink, 'input');
assert.equal(defaults.inputRotatesFully, true);
for (const [key, value] of Object.entries(C.DEFAULTS)) {
  assert.equal(typeof value, 'string', 'default ' + key + ' is a string');
}
assert.deepEqual(plain(C.DEFAULTS), { ground: '4', input: '1.5', coupler: '4', output: '3', angle: '60' });

// 4. Formatting reads like an engineering drawing.
assert.equal(C.formatAngle(82.69072288766812), '82.7\u00b0');
assert.equal(C.formatAngle(180), '180\u00b0');
assert.equal(C.formatAngle(-173.01000000000002), '-173\u00b0');
assert.equal(C.formatAngle(0), '0\u00b0');
assert.equal(C.formatAngle(null), '\u2014');
assert.equal(C.formatLength(1.5), '1.5');
assert.equal(C.formatLength(100000), '100,000');
assert.equal(C.formatLength(0.0015), '0.0015');
assert.equal(C.formatLength(null), '\u2014');
assert.equal(C.threeSig(1000), '1,000');
assert.equal(C.threeSig(64.01079221996815), '64');
assert.equal(C.threeSig(999999), '999,999');

// 5. Link ratios decide the geometry: scaling the whole linkage changes no angle.
const scaled = [
  C.calculate({ ground: '4', input: '1.5', coupler: '4', output: '3', angle: '60' }),
  C.calculate({ ground: '4000', input: '1500', coupler: '4000', output: '3000', angle: '60' }),
  C.calculate({ ground: '0.004', input: '0.0015', coupler: '0.004', output: '0.003', angle: '60' })
];
for (const result of scaled.slice(1)) {
  close(result.upperRockerDeg, scaled[0].upperRockerDeg, 'scaled rocker angle');
  close(result.upperCouplerDeg, scaled[0].upperCouplerDeg, 'scaled coupler angle');
  close(result.upperTransmissionDeg, scaled[0].upperTransmissionDeg, 'scaled transmission angle');
  close(result.rockerSwingMinDeg, scaled[0].rockerSwingMinDeg, 'scaled swing minimum');
  assert.equal(result.mechanism, scaled[0].mechanism, 'scaled mechanism');
}

// 6. A fully stretched linkage puts the two assemblies on top of each other.
const stretched = C.calculate({ ground: '10', input: '2', coupler: '5', output: '3', angle: '0' });
assert.equal(stretched.branchesCoincide, true, 'the assemblies coincide at full stretch');
assert.ok(Math.abs(Math.abs(stretched.upperRockerDeg) - 180) < 1e-6, 'the rocker lies along the ground line');
assert.ok(Math.abs(stretched.upperTransmissionDeg) < 1e-6, 'the coupler and rocker are in line');
assert.equal(stretched.mechanism, 'triple-rocker');

// 7. Seeded sweep: the invariants of a four-bar hold for every case.
let seed = 20261115;
function next() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
let rounds = 0;
let refusedRounds = 0;
let swingRounds = 0;
for (let round = 0; round < 260; round += 1) {
  const ground = Number((0.5 + next() * 9).toFixed(4));
  const crank = Number(((0.5 + next() * 9) * 0.55).toFixed(4));
  const coupler = Number((0.5 + next() * 9).toFixed(4));
  const output = Number((0.5 + next() * 9).toFixed(4));
  const angle = Number((next() * 360).toFixed(4));
  let result;
  try {
    result = C.calculate({ ground: String(ground), input: String(crank), coupler: String(coupler), output: String(output), angle: String(angle) });
  } catch (error) {
    assert.equal(error.message, C.ERRORS.noAssembly, 'only an unreachable angle is refused');
    refusedRounds += 1;
    continue;
  }
  rounds += 1;
  // reflection leaves the transmission angle the same in both assembly modes
  close(result.upperTransmissionDeg, result.lowerTransmissionDeg, 'transmission angle is shared');
  assert.ok(result.upperTransmissionDeg >= 0 && result.upperTransmissionDeg <= 90, 'transmission angle in range');
  // the two branches are distinct joints unless the linkage is stretched
  if (!result.branchesCoincide) {
    assert.ok(Math.abs(result.upperRockerDeg - result.lowerRockerDeg) > 1e-6, 'distinct assemblies');
  }
  // the classification follows the two sums
  const sumsGrashof = result.shortLongSum < result.middleSum - 1e-9 * Math.max(1, result.middleSum);
  const sumsEqual = Math.abs(result.shortLongSum - result.middleSum) <= 1e-9 * Math.max(1, result.middleSum);
  if (sumsEqual) {
    assert.equal(result.mechanism, 'change-point', 'equal sums are a change point');
    assert.equal(result.rockerSwingDeg, null, 'a change point documents no swing');
  } else if (!sumsGrashof) {
    assert.equal(result.mechanism, 'triple-rocker', 'a larger sum is a triple rocker');
    assert.equal(result.rockerSwingDeg, null, 'a triple rocker documents no swing');
  } else {
    assert.ok(['crank-rocker', 'double-crank', 'double-rocker'].includes(result.mechanism), 'Grashof type');
    if (result.mechanism === 'double-crank') {
      assert.equal(result.shortestLink, 'ground', 'a double crank has the shortest ground link');
      assert.equal(result.inputRotatesFully, true);
    }
    if (result.mechanism === 'double-rocker') {
      assert.equal(result.shortestLink, 'coupler', 'a double rocker has the shortest coupler');
    }
  }
  if (result.rockerSwingDeg !== null) {
    swingRounds += 1;
    close(result.rockerSwingDeg, result.rockerSwingMaxDeg - result.rockerSwingMinDeg, 'swing is the range width', 1e-9);
    assert.ok(result.rockerSwingMaxDeg >= result.rockerSwingMinDeg, 'the range is ordered');
    assert.equal(result.inputRotatesFully, true, 'a swing needs a crank input');
    assert.ok(result.upperRockerDeg >= result.rockerSwingMinDeg - 1e-6
      && result.upperRockerDeg <= result.rockerSwingMaxDeg + 1e-6, 'the rocker stays inside its range');
  }
}
assert.equal(rounds + refusedRounds, 260);
assert.ok(rounds > 120, 'the sweep exercised the solution, got ' + rounds);
assert.ok(swingRounds > 40, 'the sweep exercised the swing, got ' + swingRounds);

// 8. Determinism and decimal commas.
const twice = [plain(C.calculate({ ground: '4,0', input: '1,5', coupler: '4,0', output: '3,0', angle: '60' })),
  plain(C.calculate({ ground: '4,0', input: '1,5', coupler: '4,0', output: '3,0', angle: '60' }))];
assert.deepEqual(twice[0], twice[1], 'the core is deterministic');
close(twice[0].upperRockerDeg, defaults.upperRockerDeg, 'decimal comma rocker angle');

// 9. Refusals name the field and the range, and never accept a hidden fallback.
const cases = [
  [{ ground: '' }, C.ERRORS.groundMissing],
  [{ input: '' }, C.ERRORS.inputMissing],
  [{ coupler: '' }, C.ERRORS.couplerMissing],
  [{ output: '' }, C.ERRORS.outputMissing],
  [{ angle: '' }, C.ERRORS.angleMissing],
  [{ ground: 'wide' }, C.ERRORS.ground],
  [{ input: '1e0' }, C.ERRORS.input],
  [{ coupler: '0' }, C.ERRORS.coupler],
  [{ output: '.0' }, C.ERRORS.output],
  [{ ground: '100001' }, C.ERRORS.ground],
  [{ angle: '360.5' }, C.ERRORS.angle],
  [{ angle: '-1' }, C.ERRORS.angle],
  [{ angle: 'sixty' }, C.ERRORS.angle],
  [{ ground: '4', input: '2', coupler: '5', output: '2', angle: '0' }, C.ERRORS.noAssembly],
  [{ ground: '1', input: '2', coupler: '1', output: '6', angle: '90' }, C.ERRORS.noAssembly]
];
for (const [override, message] of cases) {
  assert.throws(() => C.calculate(Object.assign({}, override)), (error) => {
    assert.equal(error.message, message, JSON.stringify(override));
    return true;
  }, JSON.stringify(override));
}

// 10. The page wires the same constants the core documents.
assert.equal(C.MAX_LENGTH, 100000);
assert.equal(C.MAX_ANGLE, 360);
assert.equal(C.MIN_TRANSMISSION_DEG, 40);
assert.deepEqual(plain(C.LINKS), ['ground', 'input', 'coupler', 'output']);
assert.ok(html.includes('<h1>Four-Bar Linkage Calculator</h1>'));
assert.ok(html.includes('/assets/app.js'), 'the shared shell runs on the page');
assert.ok(!/https?:\/\//.test(html.replace(/<p class="note">[\s\S]*?<\/p>/, '')),
  'the page itself loads nothing from another origin');
assert.ok(html.includes('id="warn"') && html.includes('aria-live="polite"'), 'the result is announced');

console.log('four-bar linkage: all checks passed, ' + goldens + ' golden, ' + refusals
  + ' refusal, ' + rounds + ' solved rounds (' + swingRounds + ' with a swing, ' + refusedRounds + ' refused)');
