/* Regression checks for the soil texture core and its catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/soil-texture-classifier/index.html'), 'utf8');
const start = html.indexOf('/* soil-texture-core:start */');
const end = html.indexOf('/* soil-texture-core:end */');
assert.ok(start > -1 && end > start, 'soil texture core markers missing');
const core = html.slice(start, end + '/* soil-texture-core:end */'.length);
assert.ok(!/document\.|window\.|fetch\(|localStorage|XMLHttpRequest/.test(core), 'the core stays free of DOM, storage and network access');

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SoilTextureCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'soil-texture-classifier');
assert.ok(entry, 'catalog entry missing');
assert.equal(catalog.tools.length, 2522, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2261, 'public tools');
assert.equal(entry.category, 'Home & Garden', 'category');
assert.equal(entry.risk, 'low', 'risk');
assert.equal(entry.listed, true, 'listed');
assert.ok(entry.sources.length >= 2, 'the class definitions are cited');
for (const source of entry.sources) {
  assert.match(source.url, /^https:\/\/[^ ]+$/, `source URL ${source.url}`);
}
assert.ok(entry.testCases.length >= 30, `expected at least 30 cases, found ${entry.testCases.length}`);
assert.ok(entry.testCases.some((testCase) => testCase.kind === 'validation'), 'refusals are pinned');
assert.ok(entry.testCases.some((testCase) => testCase.kind === 'golden'), 'goldens are pinned');
assert.ok(/^https:\/\/www\.nrcs\.usda\.gov\//.test(entry.sources[0].url), 'the Soil Survey Manual is the first source');
assert.equal(catalog.tools.filter((tool) => tool.name === entry.name).length, 1, 'the name is unique');
assert.equal(catalog.tools.filter((tool) => tool.slug === entry.slug).length, 1, 'the slug is unique');

const close = (actual, expected, message) => {
  assert.ok(Number.isFinite(actual), `${message}: not a finite number`);
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} vs ${expected}`);
};

for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(
      () => C.compute(testCase.input),
      (error) => {
        assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
        return true;
      },
      `${label}: expected a refusal`
    );
    continue;
  }
  const result = C.compute(testCase.input);
  const want = testCase.expected;
  assert.equal(result.textureKey, want.textureKey, `${label}: texture key`);
  assert.equal(result.textureName, want.textureName, `${label}: texture name`);
  close(result.sandDisplay, want.sand, `${label}: sand`);
  close(result.siltDisplay, want.silt, `${label}: silt`);
  close(result.clayDisplay, want.clay, `${label}: clay`);
  assert.equal(Boolean(result.nearBoundaryKey), want.nearBoundary, `${label}: boundary flag`);
  close(result.sand + result.silt + result.clay, 100, `${label}: shares add to 100`);
  assert.ok(result.sand >= 0 && result.silt >= 0 && result.clay >= 0, `${label}: non-negative shares`);
  if (result.mode !== 'percent') assert.ok(result.totalMm >= C.MIN_TOTAL_MM, `${label}: depth in millimetres`);
}

// An independent Python model of the same manual text generated this fixture.
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/soil_texture_vectors.json'), 'utf8'));
assert.ok(fixture.vectors.length >= 1400, `expected a dense fixture, found ${fixture.vectors.length}`);
const covered = new Set();
for (const vector of fixture.vectors) {
  const label = `${vector.sand}/${vector.silt}/${vector.clay}`;
  assert.equal(C.classify(vector.sand, vector.silt, vector.clay), vector.textureKey, `${label}: class`);
  assert.equal(C.nearBoundary(vector.sand, vector.silt, vector.clay), vector.nearBoundaryKey, `${label}: boundary`);
  covered.add(vector.textureKey);
}
assert.equal(covered.size, 12, 'the fixture exercises all twelve classes');

// Every whole-percent point of the triangle belongs to exactly one class.
const seen = new Set();
for (let clay = 0; clay <= 100; clay += 1) {
  for (let sand = 0; sand <= 100 - clay; sand += 1) {
    const silt = 100 - sand - clay;
    const key = C.classify(sand, silt, clay);
    assert.ok(key, `uncovered point ${sand}/${silt}/${clay}`);
    assert.equal(typeof C.CLASSES[key], 'string', `unknown class ${key}`);
    seen.add(key);
  }
}
assert.equal(seen.size, 12, 'the whole triangle is covered by the twelve classes');

// The shares are unit-free: inches and millimetres of the same sample agree.
for (const [sand, silt, clay] of [[45, 35, 20], [60, 30, 10], [10, 30, 60], [0, 40, 60]]) {
  const mm = C.compute({ mode: 'mm', sand: String(sand), silt: String(silt), clay: String(clay) });
  const inches = C.compute({
    mode: 'in',
    sand: String(sand / C.MM_PER_INCH),
    silt: String(silt / C.MM_PER_INCH),
    clay: String(clay / C.MM_PER_INCH)
  });
  assert.equal(inches.textureKey, mm.textureKey, `inch/mm class at ${sand}/${silt}/${clay}`);
  close(inches.sand, mm.sand, `inch/mm sand at ${sand}/${silt}/${clay}`);
  close(inches.silt, mm.silt, `inch/mm silt at ${sand}/${silt}/${clay}`);
  close(inches.clay, mm.clay, `inch/mm clay at ${sand}/${silt}/${clay}`);
}

// A percentage total inside the half-point tolerance is normalised, not refused.
const normalised = C.compute({ mode: 'percent', sand: '40', silt: '40', clay: '19.8' });
close(normalised.sand, 40 / 99.8 * 100, 'normalised sand');
close(normalised.silt, 40 / 99.8 * 100, 'normalised silt');
close(normalised.clay, 19.8 / 99.8 * 100, 'normalised clay');
assert.equal(normalised.textureKey, 'loam', 'normalised class');

// The example on the page is a loam and sits clear of a boundary.
const example = C.compute({ mode: 'mm', sand: '45', silt: '35', clay: '20' });
assert.equal(example.textureKey, 'loam', 'example class');
assert.equal(example.nearBoundaryKey, null, 'example is not a boundary case');
close(example.sandDisplay, 45, 'example sand');
close(example.siltDisplay, 35, 'example silt');
close(example.clayDisplay, 20, 'example clay');

// Boundary flags name a real class and only fire close to an edge.
for (const [sand, silt, clay] of [[50, 15, 35], [52, 28, 20], [35, 25, 40]]) {
  const key = C.nearBoundary(sand, silt, clay);
  assert.ok(key && C.CLASSES[key], `boundary flag at ${sand}/${silt}/${clay}`);
  assert.notEqual(key, C.classify(sand, silt, clay), 'the flag names a different class');
}
for (const [sand, silt, clay] of [[40, 40, 20], [45, 45, 10], [10, 30, 60]]) {
  assert.equal(C.nearBoundary(sand, silt, clay), null, `clear interior at ${sand}/${silt}/${clay}`);
}

console.log('soil texture checks passed:', entry.testCases.length, 'catalog cases,', fixture.vectors.length, 'vectors');
