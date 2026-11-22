/* Tide height: the rule of twelfths re-derived from the 1-2-3-3-2-1 increments,
   the hourly curve, validation messages, the catalog record and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'tide-height-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* thc-core:start */';
const endMarker = '/* thc-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ThcCore;', sandbox);
const C = sandbox.module.exports;

const failure = (fn) => {
  try { fn(); } catch (error) { return error.message; }
  return null;
};
const near = (got, expected, label, tolerance = 1e-9) =>
  assert.ok(Math.abs(got - expected) <= tolerance, label + ': got ' + got + ', expected ' + expected);
const run = (input) => C.compute(input);

// ---- Independent oracle: build the cumulative twelfths by adding the published
// 1, 2, 3, 3, 2, 1 increments one hour at a time instead of reading a fraction table,
// then walk a fraction of the way through the step that covers the requested time.
const INCREMENTS = [1, 2, 3, 3, 2, 1];
const twelfthsByStepping = (hours) => {
  let total = 0;
  let left = hours;
  for (const step of INCREMENTS) {
    if (left <= 0) break;
    const used = Math.min(left, 1);
    total += step * used;
    left -= used;
  }
  return total;
};
const heightByStepping = (hours, high, low, phase) => {
  const fraction = twelfthsByStepping(hours) / 12;
  return phase === 'high' ? high - (high - low) * fraction : low + (high - low) * fraction;
};
const elapsedHours = (text) => {
  if (text.includes(':')) {
    const [hours, minutes] = text.split(':').map(Number);
    return hours + minutes / 60;
  }
  return Number(text);
};

// ---- Constants.
assert.equal(C.MAX_HOURS, 6);
assert.equal(C.MAX_HEIGHT, 20);
assert.deepEqual(Array.from(C.HOUR_TWELFTHS), [0, 1, 3, 6, 9, 11, 12]);
for (const hour of [0, 1, 2, 3, 4, 5, 6]) {
  near(C.twelfthsAt(hour), twelfthsByStepping(hour), 'step oracle at hour ' + hour);
}

// ---- Golden and boundary cases, each re-derived from the step oracle.
const cases = [
  ['default two hours after high water', { high: '4.2', low: '0.6', phase: 'high', elapsed: '2:00' }, 3.3],
  ['two and a half hours after high water', { high: '4.2', low: '0.6', phase: 'high', elapsed: '2.5' }, 2.85],
  ['half height three hours into a rise', { high: '1.8', low: '0.2', phase: 'low', elapsed: '3' }, 1.0],
  ['three quarters of the fall at four hours', { high: '5.6', low: '0.2', phase: 'high', elapsed: '4' }, 1.55],
  ['ninety minutes into a rise', { high: '4.2', low: '0.6', phase: 'low', elapsed: '1:30' }, 1.2],
  ['six hours into a rise from a negative low', { high: '3', low: '-0.4', phase: 'low', elapsed: '6' }, 3.0],
  ['at high water', { high: '4.2', low: '0.6', phase: 'high', elapsed: '0' }, 4.2],
  ['at low water after the fall', { high: '4.2', low: '0.6', phase: 'high', elapsed: '6' }, 0.6],
  ['at low water before the rise', { high: '4.2', low: '0.6', phase: 'low', elapsed: '0' }, 0.6],
  ['two centimetre range', { high: '1.02', low: '1.0', phase: 'high', elapsed: '3' }, 1.01],
  ['eleven twelfths after high water', { high: '4.2', low: '0.6', phase: 'high', elapsed: '5' }, 0.9],
  ['negative heights on both sides', { high: '-0.2', low: '-1.4', phase: 'low', elapsed: '2' }, -1.1],
];
for (const [label, input, expected] of cases) {
  const got = run(input);
  const high = Number(input.high);
  const low = Number(input.low);
  near(got.height, expected, label + ' height', 1e-9);
  near(got.height, heightByStepping(elapsedHours(input.elapsed), high, low, input.phase), label + ' from the step oracle', 0.005);
  near(got.range, high - low, label + ' range');
  near(got.changeSoFar, Math.abs(got.height - (input.phase === 'high' ? high : low)), label + ' change so far', 0.005);
  near(got.changeSoFar + got.remaining, got.range, label + ' change plus remaining is the range', 0.005);
  near(got.fraction, got.twelfths / 12, label + ' fraction is twelfths over twelve');
  assert.equal(got.hourly.length, 7, label + ' seven hourly rows');
  assert.equal(got.hourly[0].hour, 0, label + ' first row is the reference water');
  assert.equal(got.hourly[6].hour, 6, label + ' last row is the other water');
  near(got.hourly[0].height, input.phase === 'high' ? high : low, label + ' first row height', 1e-9);
  near(got.hourly[6].height, input.phase === 'high' ? low : high, label + ' last row height', 1e-9);
  for (let index = 0; index < got.hourly.length; index += 1) {
    near(got.hourly[index].height, heightByStepping(index, high, low, input.phase), label + ' row ' + index, 0.005);
    if (index > 0) {
      const delta = got.hourly[index].height - got.hourly[index - 1].height;
      if (input.phase === 'high') assert.ok(delta <= 0, label + ' the fall is monotone');
      else assert.ok(delta >= 0, label + ' the rise is monotone');
    }
  }
}

// ---- Invariants across the range: the height stays inside the two waters, the
// hourly steps add up to the range, and in-between times stay inside their hour.
for (let index = 0; index <= 24; index += 1) {
  const elapsed = index / 4;
  for (const phase of ['high', 'low']) {
    const got = run({ high: '3.75', low: '-0.25', phase, elapsed: String(elapsed) });
    assert.ok(got.height >= -0.25 - 1e-9 && got.height <= 3.75 + 1e-9, 'height stays between the waters at ' + elapsed);
    assert.ok(got.twelfths >= 0 && got.twelfths <= 12, 'twelfths stay within the tide at ' + elapsed);
    const sum = got.hourly.reduce((acc, row, position) => (position === 0 ? 0 : acc + (row.height - got.hourly[position - 1].height)), 0);
    near(sum, phase === 'high' ? -4 : 4, 'the hourly steps cover the whole range for ' + phase, 1e-6);
    const whole = Math.floor(elapsed);
    if (whole < 6) {
      const before = got.hourly[whole].height;
      const after = got.hourly[whole + 1].height;
      const lowEdge = Math.min(before, after) - 1e-9;
      const highEdge = Math.max(before, after) + 1e-9;
      assert.ok(got.height >= lowEdge && got.height <= highEdge, 'an in-between time stays inside its hour at ' + elapsed);
    } else {
      near(got.height, got.hourly[6].height, 'six hours lands on the last row');
    }
  }
}

// ---- Validation: each message names the field that failed.
assert.equal(failure(() => run({ high: '', low: '0.6', phase: 'high', elapsed: '2' })),
  'Enter the high water height.');
assert.equal(failure(() => run({ high: '4.2', low: '  ', phase: 'high', elapsed: '2' })),
  'Enter the low water height.');
assert.equal(failure(() => run({ high: 'abc', low: '0.6', phase: 'high', elapsed: '2' })),
  'The high water height must be a number in metres with at most two decimal places, such as 4.2 or -0.35.');
assert.equal(failure(() => run({ high: '4.234', low: '0.6', phase: 'high', elapsed: '2' })),
  'The high water height must be a number in metres with at most two decimal places, such as 4.2 or -0.35.');
assert.equal(failure(() => run({ high: '.5', low: '0.1', phase: 'high', elapsed: '2' })),
  'The high water height must be a number in metres with at most two decimal places, such as 4.2 or -0.35.');
assert.equal(failure(() => run({ high: '25', low: '0.6', phase: 'high', elapsed: '2' })),
  'The high water height must be between -20 and 20 metres.');
assert.equal(failure(() => run({ high: '4.2', low: '-21', phase: 'high', elapsed: '2' })),
  'The low water height must be between -20 and 20 metres.');
assert.equal(failure(() => run({ high: '2.0', low: '2.0', phase: 'high', elapsed: '2' })),
  'High water must be higher than low water.');
assert.equal(failure(() => run({ high: '1.0', low: '2.0', phase: 'high', elapsed: '2' })),
  'High water must be higher than low water.');
assert.equal(failure(() => run({ high: '4.2', low: '0.6', phase: 'high', elapsed: '' })),
  'Enter the time since that water.');
assert.equal(failure(() => run({ high: '4.2', low: '0.6', phase: 'high', elapsed: '6:30' })),
  'The time since that water must be 6 hours or less.');
assert.equal(failure(() => run({ high: '4.2', low: '0.6', phase: 'high', elapsed: '6.5' })),
  'The time since that water must be 6 hours or less.');
assert.equal(failure(() => run({ high: '4.2', low: '0.6', phase: 'high', elapsed: 'abc' })),
  'Enter the time as hours with at most two decimals, or as h:mm such as 2:30.');
assert.equal(failure(() => run({ high: '4.2', low: '0.6', phase: 'high', elapsed: '2:75' })),
  'Enter the time as hours with at most two decimals, or as h:mm such as 2:30.');
assert.equal(failure(() => run({ high: '4.2', low: '0.6', phase: 'mid', elapsed: '2' })),
  'Choose whether the time is measured from high water or low water.');
assert.equal(failure(() => run({})), 'Enter the high water height.');
assert.equal(failure(() => run({ high: '4.2', low: '0.6', phase: 'high', elapsed: '2', junk: 1 })), null,
  'extra keys are ignored');

// ---- A comma decimal separator and h:mm are both accepted.
assert.equal(run({ high: '4,2', low: '0,6', phase: 'high', elapsed: '0:30' }).height, 4.05);
assert.equal(run({ high: '4.2', low: '0.6', phase: 'high', elapsed: '00:45' }).height, 3.98);

// ---- Catalog record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(record.name, 'Tide Height Calculator');
assert.equal(record.category, 'Geography');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'moderate');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.guidance && record.guidance.length > 80, 'the planning guidance is recorded');
assert.ok(record.tags.includes('tide'), 'the tide tag');
assert.ok(record.tags.includes('rule-of-twelfths'), 'the rule tag');
assert.ok(record.aliases.some((alias) => /rule of twelfths/i.test(alias)), 'the rule alias');
assert.ok(Array.isArray(record.sources) && record.sources.length === 1, 'the rule has one source');
assert.equal(record.sources[0].url, 'https://en.wikipedia.org/wiki/Rule_of_twelfths');
assert.ok(/1:2:3:3:2:1/.test(record.sources[0].title), 'the citation names the part used');
assert.ok(record.method.includes('1/12'), 'method states the cumulative twelfths');
assert.ok(record.method.includes('range minus'), 'method states the remaining change');
assert.ok(record.description.length > 80 && record.description.endsWith('browser.'),
  'the description says the page runs locally');
assert.ok(record.testCases.length >= 20, 'the catalog carries the test cases');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug is unique');
assert.equal(catalog.tools.filter((tool) => tool.name === record.name).length, 1, 'the name is unique');
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  for (const alias of record.aliases) {
    assert.ok(!(tool.aliases || []).includes(alias), 'alias is not taken: ' + alias);
  }
  assert.notEqual(tool.name.toLowerCase(), record.name.toLowerCase(), 'the name is not taken');
  for (const tag of ['tide', 'tides', 'tidal', 'rule-of-twelfths', 'harbour']) {
    assert.ok(!(tool.tags || []).includes(tag), 'tag is not already taken: ' + tag + ' on ' + tool.slug);
  }
}
assert.equal(catalog.tools.filter((tool) => tool.category === 'Geography').length, 53, 'Geography count');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2183, 'public tools');

// ---- Replay every case stored in the record.
for (const item of record.testCases) {
  if (item.kind === 'validation') {
    assert.equal(failure(() => run(item.input)), item.expected.error, 'replay ' + item.name);
    continue;
  }
  const got = run(item.input);
  for (const field of ['height', 'range', 'changeSoFar', 'remaining', 'twelfths']) {
    if (item.expected[field] !== undefined) {
      near(got[field], item.expected[field], 'replay ' + item.name + ' ' + field, 1e-9);
    }
  }
}

// ---- Page contract.
assert.ok(html.includes('<div id="site-header"></div>'), 'the shared header mount is present');
assert.ok(html.includes('/assets/app.js'), 'the shared shell script is loaded');
assert.ok(html.includes('/assets/style.css'), 'the shared stylesheet is loaded');
assert.ok(!/https?:\/\//.test(html), 'the page makes no third-party request');
assert.ok(!html.includes('\u0000'), 'no NUL bytes');
assert.ok(html.includes('<h1>Tide Height Calculator</h1>'), 'the page heading');
assert.ok(/nothing is uploaded/i.test(html), 'the note stays local');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(core), 'the core touches no storage or network');
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'ids are unique');
for (const control of ['high', 'low', 'phase', 'elapsed']) {
  assert.ok(new RegExp('<label\\b[^>]*\\bfor="' + control + '"').test(html), 'label for ' + control);
  assert.ok(ids.includes(control), 'control id ' + control);
}
for (const id of ['thc-form', 'err', 'out', 'facts', 'curve', 'curve-table']) {
  assert.ok(ids.includes(id), 'element id ' + id);
}
const options = [...html.matchAll(/<option value="(\w+)"/g)].map((match) => match[1]);
assert.deepEqual(options, ['high', 'low'], 'both reference waters are offered');
assert.ok(html.includes('aria-live="polite"'), 'the result is announced');
assert.equal((html.match(/inputmode=/g) || []).length, 3, 'numeric keyboards on the three text fields');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no external script');

console.log('tide height calculator: all checks passed');
