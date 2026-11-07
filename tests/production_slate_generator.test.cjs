/* Regression checks for the production slate generator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(
  path.join(root, 'frontend/tools/production-slate-generator/index.html'),
  'utf8'
);
const startMarker = '/* production-slate-core:start */';
const endMarker = '/* production-slate-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'production slate core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = ProductionSlateCore;', sandbox);
const C = sandbox.module.exports;

const base = {
  production: 'Northbound',
  scene: '12A',
  take: '3',
  roll: 'A001',
  director: 'Ada Lovelace',
  camera: 'Grace Hopper',
  date: '2026-11-07',
  fps: '24',
  sound: 'SYNC'
};

{
  const slate = C.createSlate(base);
  assert.equal(slate.production, 'Northbound');
  assert.equal(slate.scene, '12A');
  assert.equal(slate.take, '3');
  assert.equal(C.plainText(slate), [
    'PRODUCTION: Northbound',
    'SCENE: 12A',
    'TAKE: 3',
    'ROLL: A001',
    'DIRECTOR: Ada Lovelace',
    'CAMERA: Grace Hopper',
    'DATE: 2026-11-07',
    'FRAME RATE: 24 fps',
    'SOUND: SYNC'
  ].join('\n'));
}

{
  const slate = C.createSlate({
    ...base,
    production: 'A <B> & "C"',
    director: "D'Angelo & <script>alert(1)</script>"
  });
  const svg = C.svgText(slate);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"'));
  assert.ok(svg.includes('A &lt;B&gt; &amp; &quot;C&quot;'));
  assert.ok(svg.includes('D&apos;Angelo &amp; &lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('SCENE'));
  assert.ok(svg.includes('12A'));
}

{
  const normalized = C.createSlate({...base, production: '  North\n  bound  ', take: '003', director: '', camera: ''});
  assert.equal(normalized.production, 'North bound');
  assert.equal(normalized.take, '3');
  assert.ok(C.plainText(normalized).includes('DIRECTOR: —\nCAMERA: —'));
  const invalid = [
    [{production: ' '}, 'Production is required.'],
    [{scene: ''}, 'Scene is required.'],
    [{take: '0'}, 'Take must be a whole number from 1 to 999.'],
    [{take: '1.5'}, 'Take must be a whole number from 1 to 999.'],
    [{take: '1000'}, 'Take must be a whole number from 1 to 999.'],
    [{production: 'x'.repeat(81)}, 'Production must be at most 80 characters.'],
    [{director: 'bad\u0000name'}, 'Director contains an unsupported control character.'],
    [{date: '2026-02-30'}, 'Shoot date must be a valid date in YYYY-MM-DD format.'],
    [{fps: '23.97'}, 'Choose a supported frame rate.'],
    [{sound: 'Stereo'}, 'Sound must be SYNC or MOS.']
  ];
  for (const [override, message] of invalid) {
    assert.throws(() => C.createSlate({...base, ...override}), (error) => error.message === message);
  }
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'production-slate-generator');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Video');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 8, 'catalog has generation and validation cases');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(
      () => C.createSlate(testCase.input),
      (error) => error.message === testCase.expected.error,
      testCase.name
    );
    continue;
  }
  const slate = C.createSlate(testCase.input);
  const text = C.plainText(slate);
  const svg = C.svgText(slate);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (key === 'plainText') assert.equal(text, expected, testCase.name);
    else if (key === 'svgIncludes') for (const value of expected) assert.ok(svg.includes(value), `${testCase.name}: ${value}`);
    else if (key === 'svgExcludes') for (const value of expected) assert.ok(!svg.includes(value), `${testCase.name}: ${value}`);
    else assert.equal(slate[key], expected, `${testCase.name}: ${key}`);
  }
}

console.log(`production-slate-generator: all checks passed (${record.testCases.length} catalog cases)`);
