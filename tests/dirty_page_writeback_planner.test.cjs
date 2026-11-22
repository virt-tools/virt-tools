/* Regression checks for the Dirty Page Writeback Planner: catalog cases, an
   independent byte/centisecond implementation over random inputs, notation
   handling and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'dirty-page-writeback-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* dpw-core:start */');
const end = html.indexOf('/* dpw-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + '/* dpw-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = DirtyWritebackCore;', sandbox);
const C = sandbox.module.exports;

const record = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'))
  .tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.listed, true, 'the new tool is listed');
assert.equal(record.category, 'System', 'filed under System');
assert.equal(record.risk, 'low', 'low risk');
assert.ok(Array.isArray(record.sources) && record.sources.length >= 2, 'two sources recorded');
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'source has an https URL');
  assert.ok(source.title.length > 40, 'source title is specific');
}

const run = (input) => C.plan(input);
const failure = (input) => {
  try {
    C.plan(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

const kinds = { golden: 0, boundary: 0, validation: 0 };
for (const testCase of record.testCases) {
  kinds[testCase.kind] = (kinds[testCase.kind] || 0) + 1;
  if (testCase.kind === 'validation') {
    const message = failure(testCase.input);
    assert.ok(message, `${testCase.name}: expected a refusal`);
    assert.ok(
      message.includes(testCase.expectedError),
      `${testCase.name}: "${message}" does not mention "${testCase.expectedError}"`
    );
    continue;
  }
  const result = run(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], expected, `${testCase.name}: ${key}`);
  }
  assert.ok(result.backgroundMib > 0 && result.dirtyMib > result.backgroundMib, `${testCase.name}: ordered thresholds`);
  assert.ok(result.warnings.every((warning) => typeof warning === 'string' && warning.length > 20), `${testCase.name}: clean warnings`);
}
assert.equal(kinds.golden, 10, 'ten golden cases');
assert.equal(kinds.boundary, 4, 'four boundary cases');
assert.equal(kinds.validation, 15, 'fifteen validation cases');
assert.equal(record.testCases.length, 29, 'twenty-nine catalog cases');

// ---- Independent implementation: whole bytes and centiseconds, integer arithmetic. ----
const round2 = (value) => {
  const scaled = value * 100;
  const rounded = scaled >= 0 ? Math.floor(scaled + 0.5) : -Math.floor(-scaled + 0.5);
  return Object.is(rounded / 100, -0) ? 0 : rounded / 100;
};

function reference(input) {
  const ramMib = Number(input.ramMib);
  const background = Number(input.backgroundPercent);
  const dirty = Number(input.dirtyPercent);
  const rateC = Math.round(Number(input.writeRate) * 100); // hundredths of a MiB/s
  const deviceC = Math.round(Number(input.deviceRate) * 100);
  const wakeCs = Number(input.wakeCs);
  const ramBytes = ramMib * 1048576;
  const backgroundMib = round2(Math.floor(ramBytes * background / 100 / 1048576 + 0.5));
  const dirtyMib = round2(Math.floor(ramBytes * dirty / 100 / 1048576 + 0.5));
  const keeps = rateC <= deviceC;
  const excessC = Math.max(0, rateC - deviceC);
  const centi = (numerator, denominator) => Math.floor((2 * numerator + denominator) / (2 * denominator)) / 100;
  return {
    backgroundMib,
    dirtyMib,
    headroomMib: dirtyMib - backgroundMib,
    wakeMib: Math.floor((rateC * wakeCs + 50) / 100) / 100,
    excessMibPerSec: excessC / 100,
    ageAtBackgroundSeconds: rateC === 0 ? null : centi(backgroundMib * 10000, rateC),
    timeToBackgroundSeconds: keeps ? null : centi(backgroundMib * 10000, excessC),
    timeToThrottleSeconds: keeps ? null : centi(dirtyMib * 10000, excessC),
    status: keeps ? 'keeps-up' : 'throttles'
  };
}

let seed = 20261122;
const random = () => {
  seed = (seed * 48271) % 2147483647;
  return seed / 2147483647;
};
const randomInt = (min, max) => min + Math.floor(random() * (max - min + 1));

let randomCases = 0;
for (let round = 0; round < 240; round++) {
  const ramMib = 100 * randomInt(2, 100000); // thresholds land on whole MiB, no tie ambiguity
  const background = randomInt(1, 98);
  const dirty = randomInt(background + 1, 100);
  const rateC = randomInt(0, 400000);
  const deviceC = randomInt(1, 800000);
  const input = {
    ramMib: String(ramMib),
    backgroundPercent: String(background),
    dirtyPercent: String(dirty),
    writeRate: (rateC / 100).toFixed(2),
    deviceRate: (deviceC / 100).toFixed(2),
    wakeCs: String(randomInt(1, 60000)),
    expireCs: String(randomInt(1, 600000))
  };
  const actual = run(input);
  const expected = reference(input);
  for (const key of ['backgroundMib', 'dirtyMib', 'headroomMib', 'wakeMib', 'excessMibPerSec',
    'ageAtBackgroundSeconds', 'timeToBackgroundSeconds', 'timeToThrottleSeconds']) {
    if (expected[key] === null) {
      assert.equal(actual[key], null, `${JSON.stringify(input)} ${key} should be null`);
      continue;
    }
    assert.ok(
      Math.abs(actual[key] - expected[key]) <= 1e-9,
      `${JSON.stringify(input)} ${key}: ${actual[key]} vs ${expected[key]}`
    );
  }
  assert.equal(actual.status, expected.status, `${JSON.stringify(input)} status`);
  assert.equal(actual.warnings.length, expected.status === 'throttles' ? 1 : 0, `${JSON.stringify(input)} warnings`);
  randomCases++;
}
assert.equal(randomCases, 240);

// ---- Notation, defaults and the number branch ----
const base = { ramMib: '16384', backgroundPercent: '10', dirtyPercent: '20', writeRate: '40', deviceRate: '250', wakeCs: '500', expireCs: '3000' };
assert.deepEqual(run({}), run(base), 'empty input takes the documented defaults');
assert.deepEqual(run({ ramMib: 16384, backgroundPercent: 10, dirtyPercent: 20, writeRate: 40, deviceRate: 250, wakeCs: 500, expireCs: 3000 }), run(base), 'integer numbers equal their strings');
assert.equal(run({ ...base, writeRate: '4,5' }).wakeMib, run({ ...base, writeRate: '4.5' }).wakeMib, 'decimal comma');
assert.equal(run({ ...base, writeRate: '4.5e1' }).wakeMib, 225, 'exponent notation');
assert.equal(run({ ...base, dirtyPercent: '20', backgroundPercent: ' 10 ' }).backgroundMib, 1638, 'spaces are trimmed');
assert.ok(failure({ ...base, writeRate: '\u221240' }).includes('between 0 and 1,000,000 MiB/s'), 'unicode minus is read as a sign, not as text');
assert.equal(run({ ...base, writeRate: '0' }).ageAtBackgroundSeconds, null, 'no writes means no age');
const throttled = run({ ...base, writeRate: '100', deviceRate: '60' });
assert.equal(throttled.status, 'throttles');
assert.equal(throttled.warnings.length, 1, 'a throttling plan carries one warning');
assert.ok(throttled.warnings[0].includes('exceed the device'), 'warning names the cause');
assert.equal(run(base).warnings.length, 0, 'a keeping-up plan carries no warning');

// ---- Page contract ----
assert.ok(html.includes('<html lang="en">'));
assert.equal((html.match(/<script/g) || []).length, 3, 'one inline script plus theme-init and app.js');
assert.equal((html.match(/<script(?![^>]*\bsrc=)/g) || []).length, 1, 'exactly one inline script');
assert.ok(!/(?:src|href)="https?:\/\//.test(html), 'no external assets');
for (const forbidden of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'WebSocket', 'indexedDB', 'navigator.sendBeacon']) {
  assert.ok(!html.includes(forbidden), `offline page does not use ${forbidden}`);
}
assert.equal((html.match(/<input\b/g) || []).length, 7, 'seven number fields');
assert.equal((html.match(/<select\b/g) || []).length, 0, 'no select elements');
for (const id of ['ram', 'background', 'dirty', 'rate', 'device', 'wake', 'expire']) {
  assert.ok(html.includes(`<label for="${id}">`), `label for ${id}`);
  assert.ok(html.includes(`id="${id}"`), `input ${id}`);
}
for (const [id, value] of [['ram', '16384'], ['background', '10'], ['dirty', '20'], ['rate', '40'], ['device', '250'], ['wake', '500'], ['expire', '3000']]) {
  assert.ok(html.includes(`id="${id}" type="number"`) && html.includes(`value="${value}"`), `default for ${id}`);
}
assert.ok(/role="status" aria-live="polite"/.test(html), 'live status region');
assert.ok(/id="plan"/.test(html) && /<button type="submit"/.test(html), 'submit button');
assert.ok(html.includes('dirty_background_bytes') && html.includes('dirty_bytes'), 'page names the bytes alternatives');
assert.ok(html.includes('reclaimable pages') && html.includes('upper bound'), 'page states the available-memory caveat');
assert.ok(html.includes('cgroup') && html.includes('does not model'), 'page states what it does not model');
assert.ok(!/←\s*(?:All tools|Back to all tools)/.test(html), 'no page-level back link');

console.log(`${slug}: ${record.testCases.length} catalog cases, ${randomCases} random plans match the independent byte model, notation and page contract green`);
