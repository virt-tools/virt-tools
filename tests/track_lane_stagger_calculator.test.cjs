/* Regression checks for the track lane stagger core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/track-lane-stagger-calculator/index.html'), 'utf8');
const start = html.indexOf('/* track-stagger-core:start */');
const end = html.indexOf('/* track-stagger-core:end */');
assert.ok(start > -1 && end > start, 'track stagger core markers missing');
const core = html.slice(start, end + '/* track-stagger-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TrackStaggerCore;', sandbox);
const C = sandbox.module.exports;

// Values created inside the vm context have foreign prototypes, so compare by value.
const same = (actual, expected, label) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), label);
const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const sameNumbers = (actual, expected, label) => {
  assert.equal(actual.length, expected.length, `${label}: count`);
  expected.forEach((value, index) => near(actual[index], value, `${label} [${index}]`));
};
const analyse = (options) => C.analyse(options);

// A standard 400 m eight-lane track reproduces the published staggers.
const standard = analyse({});
assert.equal(standard.lanes, 8);
assert.equal(standard.rows.length, 8);
near(standard.laneWidth, 1.22, 'lane width');
near(standard.straight, 84.39, 'straight length');
near(standard.lane1Offset, 0.3, 'lane 1 offset');
near(standard.measurementRadius, 36.799805941708, 'lane 1 measurement radius');
near(standard.innerRadius, 36.499805941708, 'inner radius');
near(standard.outerRadius, 46.259805941708, 'outer radius');
near(standard.overallWidth, 92.519611883416, 'overall width');
near(standard.surfaceArea, 4184.863409779173, 'surface area');
sameNumbers(standard.stagger400, [
  0,
  7.037167544041,
  14.7026536188,
  22.368139693559,
  30.033625768318,
  37.699111843078,
  45.364597917837,
  53.030083992596
], 'default 400 m staggers');
sameNumbers(standard.stagger200, [
  0,
  3.518583772021,
  7.3513268094,
  11.18406984678,
  15.016812884159,
  18.849555921539,
  22.682298958918,
  26.515041996298
], 'default 200 m staggers');
sameNumbers(standard.lengths, [
  400,
  407.037167544041,
  414.7026536188,
  422.368139693559,
  430.033625768318,
  437.699111843078,
  445.364597917837,
  453.030083992596
], 'default lap lengths');
near(standard.maxStagger400, 53.030083992596, 'outermost 400 m stagger');
near(standard.maxStagger200, 26.515041996298, 'outermost 200 m stagger');

// Lane 1 measured from a painted line removes the 10 cm kerb correction.
const painted = analyse({ lane1Offset: '0.2' });
near(painted.innerRadius, 36.599805941708, 'painted inner radius');
near(painted.maxStagger400, 53.658402523314, 'painted outermost stagger');
near(painted.rows[1].stagger400, 7.665486074759, 'painted lane 2 stagger');
near(painted.surfaceArea, 4190.995798638979, 'painted surface area');

// Fewer lanes shorten the outer radius and shrink the surface.
const four = analyse({ lanes: '4' });
assert.equal(four.rows.length, 4);
near(four.outerRadius, 41.379805941708, 'four-lane outer radius');
near(four.overallWidth, 82.759611883416, 'four-lane overall width');
near(four.surfaceArea, 2017.616560799939, 'four-lane surface area');
near(four.maxStagger400, 22.368139693559, 'four-lane outermost stagger');

// Narrower lanes and shorter straights change both the bends and the staggers.
const custom = analyse({ lanes: '6', laneWidth: '1', straight: '80' });
near(custom.measurementRadius, 38.197186342055, 'custom measurement radius');
near(custom.rows[1].stagger400, 5.654866776462, 'custom lane 2 stagger');
near(custom.maxStagger400, 30.78760800518, 'custom outermost stagger');
near(custom.surfaceArea, 2501.78760197631, 'custom surface area');

// The minimum lane count still reports a two-row table.
const two = analyse({ lanes: '2', laneWidth: '1.22', straight: '84.39' });
assert.equal(two.rows.length, 2);
near(two.maxStagger400, 7.037167544041, 'two-lane outermost stagger');
near(two.surfaceArea, 990.104494377557, 'two-lane surface area');

// Parsing and validation rejections.
assert.throws(() => analyse({ lanes: '' }), /Number of lanes is required\./);
assert.throws(() => analyse({ lanes: '1' }), /Number of lanes must be a whole number from 2 to 10\./);
assert.throws(() => analyse({ lanes: '11' }), /Number of lanes must be a whole number from 2 to 10\./);
assert.throws(() => analyse({ lanes: '2.5' }), /Number of lanes must be a whole number from 2 to 10\./);
assert.throws(() => analyse({ lanes: 'eight' }), /Number of lanes must be a whole number from 2 to 10\./);
assert.throws(() => analyse({ laneWidth: '' }), /Lane width is required\./);
assert.throws(() => analyse({ laneWidth: 'abc' }), /Lane width must be a number between 0\.9 and 1\.5 m\./);
assert.throws(() => analyse({ laneWidth: '0.5' }), /Lane width must be between 0\.9 and 1\.5 m\./);
assert.throws(() => analyse({ laneWidth: '1.8' }), /Lane width must be between 0\.9 and 1\.5 m\./);
assert.throws(() => analyse({ straight: '' }), /Straight length is required\./);
assert.throws(() => analyse({ straight: 'long' }), /Straight length must be a number between 40 and 120 m\./);
assert.throws(() => analyse({ straight: '30' }), /Straight length must be between 40 and 120 m\./);
assert.throws(() => analyse({ straight: '130' }), /Straight length must be between 40 and 120 m\./);
assert.throws(() => analyse({ lane1Offset: '0.25' }), /Lane 1 offset must be 0\.3 m from a kerb or 0\.2 m from a painted line\./);
assert.throws(() => analyse({ lane1Offset: 'kerb' }), /Lane 1 offset must be 0\.3 m from a kerb or 0\.2 m from a painted line\./);

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'track-lane-stagger-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.risk, 'low');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 14, 'catalog has the full test case set');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => analyse(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  const result = analyse(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (Array.isArray(value)) {
      assert.equal(result[key].length, value.length, `${testCase.name} ${key} length`);
      value.forEach((item, index) => {
        if (typeof item === 'number') near(result[key][index], item, `${testCase.name} ${key}[${index}]`);
        else assert.equal(result[key][index], item, `${testCase.name} ${key}[${index}]`);
      });
    } else if (value && typeof value === 'object') {
      same(result[key], value, `${testCase.name} ${key}`);
    } else if (typeof value === 'number') {
      near(result[key], value, `${testCase.name} ${key}`);
    } else {
      assert.equal(result[key], value, `${testCase.name} ${key}`);
    }
  }
}

console.log('track-lane-stagger-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
