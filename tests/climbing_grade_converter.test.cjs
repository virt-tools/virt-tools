/* Regression checks for the climbing grade chart, parser, page contract and catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/climbing-grade-converter/index.html'), 'utf8');
const start = html.indexOf('/* climbing-grade-core:start */');
const end = html.indexOf('/* climbing-grade-core:end */');
assert.ok(start > -1 && end > start, 'climbing grade core markers missing');
const core = html.slice(start, end + '/* climbing-grade-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ClimbingGrades;', sandbox);
const C = sandbox.module.exports;

const verdict = (grade, discipline) => C.verdict(C.convert(grade, discipline));
const throwsWith = (grade, discipline, pattern) => assert.throws(
  () => C.convert(grade, discipline),
  (error) => {
    assert.match(error.message, pattern);
    return true;
  },
);

// The chart is ordered, complete and free of duplicate keys.
assert.equal(C.ROUTES.length, 30, 'route rows');
assert.equal(C.BOULDERS.length, 19, 'boulder rows');
assert.equal(C.ROUTES[0].fr, '3');
assert.equal(C.ROUTES[0].yds[0], '5.3');
assert.equal(C.ROUTES[C.ROUTES.length - 1].fr, '9c');
assert.equal(C.ROUTES[C.ROUTES.length - 1].yds[0], '5.15d');
assert.equal(C.ROUTES[C.ROUTES.length - 1].uiaa[0], 'XII+');
assert.equal(C.BOULDERS[0].v, 'VB');
assert.equal(C.BOULDERS[C.BOULDERS.length - 1].v, 'V17');
assert.equal(C.BOULDERS[C.BOULDERS.length - 1].font[0], '9A');
const french = C.ROUTES.map((row) => row.fr);
assert.equal(new Set(french).size, french.length, 'French grades are unique');
const yds = [].concat(...C.ROUTES.map((row) => row.yds));
assert.equal(new Set(yds).size, yds.length, 'YDS grades are unique');
assert.equal(yds.length, 31, 'YDS grades incl. the shared 6c pair');
const vGrades = C.BOULDERS.map((row) => row.v);
assert.equal(new Set(vGrades).size, vGrades.length, 'V grades are unique');
const fontGrades = [].concat(...C.BOULDERS.map((row) => row.font));
assert.equal(new Set(fontGrades).size, fontGrades.length, 'Font grades are unique');
assert.equal(fontGrades.length, 24, 'Font grades incl. the shared pairs');

// Each row is reachable from every system it lists.
for (const row of C.ROUTES) {
  assert.ok(C.convert(row.fr, 'routes').rows.includes(row), `French ${row.fr}`);
  for (const value of row.yds) assert.ok(C.convert(value, 'routes').rows.includes(row), `YDS ${value}`);
  for (const value of row.uiaa) assert.ok(C.convert(value, 'routes').rows.includes(row), `UIAA ${value}`);
}
for (const row of C.BOULDERS) {
  assert.ok(C.convert(row.v, 'boulders').rows.includes(row), `V ${row.v}`);
  for (const value of row.font) assert.ok(C.convert(value, 'boulders').rows.includes(row), `Font ${value}`);
}

// Every YDS grade and Font grade resolves to exactly one row, so the table is a total function.
for (const value of yds) assert.equal(C.convert(value, 'routes').rows.length, 1, `YDS ${value}`);
for (const value of fontGrades) assert.equal(C.convert(value, 'boulders').rows.length, 1, `Font ${value}`);

// Verdicts name the grades a climber reads and omit the system that was typed.
assert.equal(verdict('5.10a', 'routes'), '5.10a → French 6a · UIAA VI+');
assert.equal(verdict('6a+', 'routes'), '6a+ → YDS 5.10b · UIAA VII-');
assert.equal(verdict('VI+', 'routes'), 'UIAA VI+ → French 6a · YDS 5.10a');
assert.equal(verdict('5.3', 'routes'), '5.3 → French 3 · UIAA III');
assert.equal(verdict('9c', 'routes'), '9c → YDS 5.15d · UIAA XII+');
assert.equal(verdict('5.11b', 'routes'), '5.11b → French 6c · UIAA VIII-');
assert.equal(verdict('6c', 'routes'), '6c → YDS 5.11a / 5.11b · UIAA VIII-');
assert.equal(verdict('V5', 'boulders'), 'V5 → Font 6C / 6C+');
assert.equal(verdict('V0', 'boulders'), 'V0 → Font 4 / 4+');
assert.equal(verdict('6C', 'boulders'), 'Font 6C → V-scale V5');
assert.equal(verdict('7A', 'boulders'), 'Font 7A → V-scale V6');
assert.equal(verdict('VB', 'boulders'), 'VB → Font 3');
assert.equal(verdict('V17', 'boulders'), 'V17 → Font 9A');

// Coarse UIAA grades legitimately cover two adjacent rows.
assert.equal(verdict('VIII-', 'routes'), 'UIAA VIII- → 6c or 6c+ (2 rows)');
assert.equal(C.convert('VIII-', 'routes').rows.length, 2);
assert.equal(verdict('VIII+', 'routes'), 'UIAA VIII+ → 7a+ or 7b (2 rows)');
assert.equal(C.convert('VIII+', 'routes').rows.length, 2);
assert.equal(verdict('IX-', 'routes'), 'UIAA IX- → 7b or 7b+ (2 rows)');
assert.equal(C.convert('IX-', 'routes').rows.length, 2);
assert.equal(C.convert('IV+', 'routes').rows.length, 1, 'IV+ is only in the 4b row');
assert.equal(C.convert('V-', 'routes').rows.length, 1, 'V- is only in the 4b row');

// Input is trimmed and case-folded, and a typographic minus counts as a hyphen.
assert.equal(verdict('  5.10A  ', 'routes'), '5.10a → French 6a · UIAA VI+');
assert.equal(verdict('v5', 'boulders'), 'V5 → Font 6C / 6C+');
assert.equal(verdict('6c+', 'routes'), '6c+ → YDS 5.11c · UIAA VIII-');
assert.equal(verdict('vii\u2212', 'routes'), 'UIAA VII- → French 6a+ · YDS 5.10b');
assert.equal(verdict('ix +', 'routes'), 'UIAA IX+ → French 7c+ · YDS 5.13a');

// Anything outside the chart is refused with the specific reason.
throwsWith('5.18a', 'routes', /^"5\.18a" is not on the YDS route scale\.$/);
throwsWith('5.1', 'routes', /^"5\.1" is not on the YDS route scale\.$/);
throwsWith('2', 'routes', /^"2" is not on the French route scale\.$/);
throwsWith('XIII', 'routes', /is not a route grade/);
throwsWith('abc', 'routes', /^"abc" is not a route grade: use YDS \(5\.10a\), French \(6a\+\) or UIAA \(VI\+\)\.$/);
throwsWith('5.10a', 'boulders', /^"5\.10a" is not a boulder grade: use the V-scale \(V5\) or Font \(6C\+\)\.$/);
throwsWith('V20', 'boulders', /^"V20" is not on the V-scale \(VB–V17\)\.$/);
throwsWith('V0-', 'boulders', /^"V0-" is not on the V-scale \(VB–V17\)\.$/);
throwsWith('2', 'boulders', /^"2" is not on the Font boulder scale \(3–9C\)\.$/);
throwsWith('9C+', 'boulders', /^"9C\+" is not on the Font boulder scale \(3–9C\)\.$/);
throwsWith('', 'routes', /^Enter a route grade, such as 5\.10a, 6a\+ or VI\+\.$/);
throwsWith('   ', 'boulders', /^Enter a boulder grade, such as V5 or 6C\+\.$/);

// Route and boulder scales never cross over: a V grade is not a route grade and vice versa.
throwsWith('V5', 'routes', /is not a route grade/);
throwsWith('5.10a', 'boulders', /is not a boulder grade/);

// Page contract: inline core, shared assets, labelled controls, no third-party requests.
assert.match(html, /<html lang="en">/);
assert.match(html, /<title>Climbing Grade Converter — Virtual Tools<\/title>/);
assert.match(html, /<h1>Climbing Grade Converter<\/h1>/);
assert.match(html, /<script src="\/assets\/theme-init\.js"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style\.css">/);
assert.match(html, /<label for="grade">Grade<\/label>/);
assert.match(html, /<button type="submit">Convert<\/button>/);
assert.match(html, /id="verdict" aria-live="polite"/);
assert.doesNotMatch(html, /src="https?:/);
assert.doesNotMatch(html, /https?:\/\//, 'page links to no external origin');
assert.equal(C.SYSTEMS.routes.length, 3);
assert.equal(C.SYSTEMS.boulders.length, 2);

// Catalog integrity and recorded cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2271, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === 'climbing-grade-converter');
assert.ok(record, 'catalog record');
assert.equal(record.name, 'Climbing Grade Converter');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.tags.includes('climbing'));
assert.ok(record.tags.includes('bouldering'));
assert.ok(record.sources.some((source) => source.url === 'https://www.mountainproject.com/international-climbing-grades'));
assert.ok(record.method.length > 900);
assert.ok(record.testCases.length >= 14);
assert.equal(catalog.tools.filter((tool) => tool.category === record.category).length, 44, 'Sports & Outdoors count');

const names = new Map();
for (const tool of catalog.tools) {
  if (tool.slug === record.slug) continue;
  for (const value of [tool.slug, tool.name, ...(tool.aliases || [])]) {
    names.set(String(value).toLowerCase(), tool.slug);
  }
}
for (const value of [record.slug, record.name, ...record.aliases]) {
  assert.equal(names.get(String(value).toLowerCase()), undefined, `duplicate name or alias: ${value}`);
}
assert.ok(fs.existsSync(path.join(root, 'frontend/tools', record.slug, 'index.html')));

for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.throws(() => C.convert(testCase.input.grade, testCase.input.discipline), (error) => {
      assert.equal(error.message, testCase.expectedError, testCase.name);
      return true;
    });
    continue;
  }
  const result = C.convert(testCase.input.grade, testCase.input.discipline);
  assert.equal(result.system, testCase.expected.system, `${testCase.name}: system`);
  assert.equal(result.value, testCase.expected.value, `${testCase.name}: value`);
  assert.equal(result.rows.length, testCase.expected.rows, `${testCase.name}: rows`);
  assert.equal(C.verdict(result), testCase.expected.verdict, `${testCase.name}: verdict`);
}

console.log('climbing grade converter checks passed');
