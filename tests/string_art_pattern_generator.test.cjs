/* Regression checks for the modular string art pattern generator. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/string-art-pattern-generator/index.html'), 'utf8');
const startMarker = '/* string-art-core:start */';
const endMarker = '/* string-art-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'string art core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = StringArtCore;', sandbox);
const C = sandbox.module.exports;

const standard = C.generate({});
assert.equal(standard.nails, 72);
assert.equal(standard.multiplier, 2);
assert.equal(standard.diameter, 200);
assert.equal(standard.color, '#E76F51');
assert.equal(standard.labels, 'major');
assert.equal(standard.points.length, 72);
assert.deepEqual({ ...standard.points[0] }, { number: 1, x: 112, y: 12 });
assert.equal(standard.segments.length, 70);
assert.equal(standard.segmentCount, 70);
assert.equal(standard.omittedLoops, 1);
assert.equal(standard.omittedDuplicates, 1);
assert.deepEqual({ ...standard.segments[0] }, { from: 2, to: 3 });
assert.deepEqual({ ...standard.segments.at(-1) }, { from: 72, to: 71 });
assert.equal(standard.nailSpacing, 8.723877);
const keys = new Set();
for (const segment of standard.segments) {
  assert.notEqual(segment.from, segment.to);
  const key = [segment.from, segment.to].sort((a, b) => a - b).join('-');
  assert.ok(!keys.has(key), `duplicate segment ${key}`);
  keys.add(key);
}

const minimum = C.generate({ nails: '12', multiplier: '2', diameter: '80', color: '#aabbcc', labels: 'all' });
assert.equal(minimum.segmentCount, 10);
assert.equal(minimum.size, 104);
assert.equal(minimum.color, '#AABBCC');
assert.equal(minimum.nailSpacing, 20.705524);
assert.deepEqual({ ...minimum.points[0] }, { number: 1, x: 52, y: 12 });

const maximum = C.generate({ nails: 120, multiplier: 24, diameter: 500, labels: 'none' });
assert.equal(maximum.segmentCount, 117);
assert.equal(maximum.size, 524);
assert.equal(maximum.nailSpacing, 13.088474);
const repeated = C.generate({ nails: 24, multiplier: 5 });
assert.equal(repeated.segmentCount, 10);
assert.equal(repeated.omittedLoops, 4);
assert.equal(repeated.omittedDuplicates, 10);

assert.equal(C.summary(standard), '72 nails · multiplier 2 · 70 unique segments · Ø 200 mm');
const guide = C.guide(standard);
assert.match(guide, /String art pattern/);
assert.match(guide, /Nail circle: 200 mm diameter/);
assert.match(guide, /Nails: 72 · Multiplier: 2/);
assert.match(guide, /Nail 1 is at the top; number clockwise/);
assert.match(guide, /1\. 2 → 3/);
assert.match(guide, /70\. 72 → 71/);
assert.equal(guide.split('\n').filter((line) => /^\d+\./.test(line)).length, 70);

const svg = C.svgText(standard);
assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="224mm" height="224mm" viewBox="0 0 224 224"'));
assert.ok(svg.includes('<title>Circular string art: 72 nails, multiplier 2</title>'));
assert.ok(svg.includes('stroke="#E76F51"'));
assert.equal((svg.match(/<path class="threads"/g) || []).length, 1);
assert.equal((svg.match(/<circle class="nail"/g) || []).length, 72);
assert.ok((svg.match(/<text/g) || []).length > 0);
assert.equal((C.svgText(maximum).match(/<text/g) || []).length, 0);
assert.equal((C.svgText(minimum).match(/<text/g) || []).length, 12);
assert.ok(!/<script|on\w+=|(?:href|src)=/i.test(svg));
assert.ok(svg.endsWith('</svg>'));

const invalid = [
  [{ nails: '' }, 'Nail count is required.'],
  [{ nails: '11' }, 'Nail count must be a whole number from 12 to 120.'],
  [{ nails: '121' }, 'Nail count must be a whole number from 12 to 120.'],
  [{ nails: '2.5' }, 'Nail count must be a whole number from 12 to 120.'],
  [{ nails: '1e2' }, 'Nail count must be a whole number from 12 to 120.'],
  [{ multiplier: '' }, 'Multiplier is required.'],
  [{ multiplier: '1' }, 'Multiplier must be a whole number from 2 to 24.'],
  [{ multiplier: '25' }, 'Multiplier must be a whole number from 2 to 24.'],
  [{ multiplier: '2.5' }, 'Multiplier must be a whole number from 2 to 24.'],
  [{ nails: '12', multiplier: '12' }, 'Multiplier must not be a multiple of the nail count.'],
  [{ nails: '24', multiplier: '24' }, 'Multiplier must not be a multiple of the nail count.'],
  [{ diameter: '' }, 'Nail circle diameter is required.'],
  [{ diameter: '79.9' }, 'Nail circle diameter must be a number from 80 to 500 mm.'],
  [{ diameter: '500.1' }, 'Nail circle diameter must be a number from 80 to 500 mm.'],
  [{ diameter: 'wide' }, 'Nail circle diameter must be a number from 80 to 500 mm.'],
  [{ diameter: '1e2' }, 'Nail circle diameter must be a number from 80 to 500 mm.'],
  [{ color: '' }, 'Thread color must be a six-digit hex color such as #E76F51.'],
  [{ color: 'red' }, 'Thread color must be a six-digit hex color such as #E76F51.'],
  [{ color: '#12345' }, 'Thread color must be a six-digit hex color such as #E76F51.'],
  [{ labels: 'random' }, 'Choose no numbers, key nails or every nail for preview labels.']
];
for (const [override, message] of invalid) {
  assert.throws(() => C.generate({ ...override }), (error) => error.message === message, message);
}

let invariantCases = 0;
for (let nails = 12; nails <= 120; nails += 1) {
  for (let multiplier = 2; multiplier <= 24; multiplier += 1) {
    if (multiplier % nails === 0) continue;
    const result = C.generate({ nails, multiplier });
    const independent = new Set();
    let loops = 0;
    for (let from = 0; from < nails; from += 1) {
      const to = from * multiplier % nails;
      if (from === to) { loops += 1; continue; }
      independent.add([Math.min(from, to), Math.max(from, to)].join('-'));
      const point = result.points[from];
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      assert.ok(point.x >= 0 && point.x <= result.size);
      assert.ok(point.y >= 0 && point.y <= result.size);
      const radius = Math.hypot(point.x - result.center, point.y - result.center);
      assert.ok(Math.abs(radius - result.radius) < 0.00001);
    }
    assert.equal(result.points.length, nails);
    assert.equal(result.segmentCount, independent.size);
    assert.equal(result.omittedLoops, loops);
    assert.equal(result.omittedDuplicates, nails - loops - independent.size);
    assert.equal(result.omittedLoops + result.omittedDuplicates + result.segmentCount, nails);
    const emitted = new Set();
    for (const segment of result.segments) {
      assert.equal((segment.from - 1) * multiplier % nails + 1, segment.to);
      emitted.add([Math.min(segment.from - 1, segment.to - 1), Math.max(segment.from - 1, segment.to - 1)].join('-'));
    }
    assert.equal(emitted.size, independent.size);
    assert.ok(C.svgText(result).includes(`<title>Circular string art: ${nails} nails, multiplier ${multiplier}</title>`));
    invariantCases += 1;
  }
}
assert.equal(invariantCases, 2493);

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'string-art-pattern-generator');
assert.equal(records.length, 1, 'catalog must contain exactly one string art pattern generator');
const record = records[0];
assert.equal(record.name, 'String Art Pattern Generator');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Generation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 18, 'catalog carries golden, boundary and validation checks');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.generate(testCase.input), (error) => error.message === testCase.expected.error, testCase.name);
    continue;
  }
  const result = C.generate(testCase.input);
  const svgText = C.svgText(result);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (key === 'summary') assert.equal(C.summary(result), expected, testCase.name);
    else if (key === 'svgIncludes') for (const value of expected) assert.ok(svgText.includes(value), `${testCase.name}: ${value}`);
    else if (key === 'guideIncludes') for (const value of expected) assert.ok(C.guide(result).includes(value), `${testCase.name}: ${value}`);
    else assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
}

console.log(`string-art-pattern-generator: ${record.testCases.length} catalog cases and ${invariantCases} invariant cases passed`);
