/* IPF GL points: the published coefficient tables, the IPF's own worked examples,
   half-up rounding at the sixth decimal, the body weight floors, refusals, an
   independent decimal model, the catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ipf-gl-points-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* gl-core:start */';
const endMarker = '/* gl-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {}, BigInt: BigInt };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = GlCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));

// ---- The published table, typed again from the IPF document rather than read from the page.
const PUBLISHED = {
  'male-classic-powerlifting': [1199.72839, 1025.18162, 0.00921],
  'male-equipped-powerlifting': [1236.25115, 1449.21864, 0.01644],
  'male-classic-bench': [320.98041, 281.40258, 0.01008],
  'male-equipped-bench': [381.22073, 733.79378, 0.02398],
  'female-classic-powerlifting': [610.32796, 1045.59282, 0.03048],
  'female-equipped-powerlifting': [758.63878, 949.31382, 0.02435],
  'female-classic-bench': [142.40398, 442.52671, 0.04724],
  'female-equipped-bench': [221.82209, 357.00377, 0.02937],
};
assert.deepEqual(Object.keys(C.TABLE).sort(), Object.keys(PUBLISHED).sort(), 'eight combinations');
for (const key of Object.keys(PUBLISHED)) {
  const [A, B, Cc] = PUBLISHED[key];
  assert.equal(C.TABLE[key].A, A, key + ' A');
  assert.equal(C.TABLE[key].B, B, key + ' B');
  assert.equal(C.TABLE[key].C, Cc, key + ' C');
}
assert.equal(C.TABLE['male-classic-powerlifting'].minBw, 40);
assert.equal(C.TABLE['female-classic-powerlifting'].minBw, 35);
assert.deepEqual(plain(C.TARGETS), [50, 75, 100, 125]);

// ---- An independent decimal model: integer coefficient millionths, product by
// long multiplication on digit strings, round half up by dropping digits.
const mulDigits = (a, b) => {
  const out = new Array(a.length + b.length).fill(0);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const prod = Number(a[i]) * Number(b[j]) + out[i + j + 1];
      out[i + j + 1] = prod % 10;
      out[i + j] += Math.floor(prod / 10);
    }
  }
  return out.join('').replace(/^0+(?=\d)/, '');
};
const addOne = (digits) => {
  const chars = digits.split('');
  let at = chars.length - 1;
  while (at >= 0) {
    if (chars[at] === '9') { chars[at] = '0'; at -= 1; } else { chars[at] = String(Number(chars[at]) + 1); break; }
  }
  return (at < 0 ? '1' : '') + chars.join('');
};
const roundShift = (digits, scale) => {
  if (scale === 0) return digits;
  const padded = digits.padStart(scale + 1, '0');
  const cut = padded.length - scale;
  const whole = padded.slice(0, cut);
  return padded[cut] >= '5' ? addOne(whole) : whole;
};
const scaleOf = (text) => (text.includes('.') ? text.split('.')[1].length : 0);
const digitsOf = (text) => text.replace('.', '');
const coefficientOf = (key, bw) => {
  const [A, B, Cc] = PUBLISHED[key];
  const denom = A - B * Math.exp(-Cc * bw);
  return Math.round((100 / denom) * 1e6);
};
const model = (key, bwText, resultText) => {
  const bw = Number(bwText.replace(',', '.'));
  const micro = coefficientOf(key, bw);
  const scaled = mulDigits(String(micro), digitsOf(resultText.replace(',', '.')));
  const pointsMicro = Number(roundShift(scaled, scaleOf(resultText.replace(',', '.'))));
  const denom = PUBLISHED[key][0] - PUBLISHED[key][1] * Math.exp(-PUBLISHED[key][2] * bw);
  return {coefficientMicro: micro, pointsMicro: pointsMicro,
    total100: Math.floor(denom * 10 + 0.5) / 10};
};

// ---- The IPF's two worked examples, printed to six decimals in its document.
const officialOne = C.compute({sex: 'male', equipment: 'equipped', event: 'powerlifting',
  bodyweight: '92.04', result: '1035'});
assert.equal(officialOne.coefficient, 0.109039, 'coefficient 0.109039');
assert.equal(officialOne.points, 112.855365, 'points 112.855365');
assert.equal(officialOne.points3, '112.855');
assert.equal(officialOne.headline, '112.855 IPF GL points');
const officialTwo = C.compute({sex: 'female', equipment: 'classic', event: 'bench',
  bodyweight: '70.50', result: '122.5'});
assert.equal(officialTwo.coefficient, 0.790069, 'coefficient 0.790069');
assert.equal(officialTwo.points, 96.783453, '0.790069 x 122.5 is 96.7834525, which rounds up');
assert.equal(officialTwo.points3, '96.783');
assert.equal(officialTwo.points6, '96.783453');

// ---- Every table at a spread of body weights and results, against the independent model.
let compared = 0;
for (const key of Object.keys(PUBLISHED)) {
  const [sex, equipment, event] = [key.split('-')[0], key.split('-')[1], key.split('-')[2]];
  for (const bw of [35, 40, 50, 70, 90, 120, 150, 200]) {
    if (bw < C.TABLE[key].minBw) continue;
    for (const result of ['0', '0.5', '137.5', '400', '1000']) {
      const got = C.compute({sex: sex, equipment: equipment,
        event: event === 'bench' ? 'bench' : 'powerlifting',
        bodyweight: String(bw), result: result});
      const want = model(key, String(bw), result);
      assert.equal(got.coefficientMicro, want.coefficientMicro, key + ' ' + bw + ' kg coefficient');
      assert.equal(got.pointsMicro, want.pointsMicro, key + ' ' + bw + ' kg x ' + result + ' points');
      assert.equal(got.total100, want.total100, key + ' ' + bw + ' kg total for 100');
      compared += 3;
    }
  }
}
assert.ok(compared >= 600, 'the sweep covers every table');

// ---- Points text keeps its zeros and rounds half up on the seventh decimal.
assert.equal(C.pointsText(112855365, 3), '112.855');
assert.equal(C.pointsText(112855365, 6), '112.855365');
assert.equal(C.pointsText(0, 3), '0.000');
assert.equal(C.pointsText(0, 6), '0.000000');
assert.equal(C.pointsText(266650, 3), '0.267');
assert.equal(C.pointsText(266650, 6), '0.266650');
assert.equal(C.pointsText(100000000, 3), '100.000');
assert.equal(C.pointsText(999500, 3), '1.000', 'a half at the fourth decimal rounds up');

// ---- A zero result scores zero; the coefficient is still reported.
const zero = C.compute({sex: 'female', equipment: 'classic', event: 'powerlifting',
  bodyweight: '48', result: '0'});
assert.equal(zero.points, 0);
assert.equal(zero.headline, '0.000 IPF GL points');
assert.equal(zero.coefficient, 0.271562);
assert.ok(zero.noteText.includes('A result of zero scores zero'), 'the zero rule is stated');

// ---- Body weight floors, spelling and presentation.
const comma = C.compute({sex: 'male', equipment: 'equipped', event: 'powerlifting',
  bodyweight: '92,04', result: '1035'});
assert.equal(comma.pointsMicro, officialOne.pointsMicro, 'a comma decimal separator is the same value');
assert.equal(comma.subline, officialOne.subline, 'the comma is normalised in the subline');
assert.equal(officialOne.subline, 'Men, equipped powerlifting, 92.04 kg body weight, 1035 kg result');
assert.equal(officialOne.total100, 917.1);
assert.equal(officialOne.targets.length, 4);
assert.equal(officialOne.targets[2].score, 100);
assert.equal(officialOne.targets[2].total, 917.1, '125 points is not the same as 100');
assert.equal(officialOne.targets[3].total, 1146.4);
for (let i = 1; i < officialOne.targets.length; i += 1) {
  assert.ok(officialOne.targets[i].total > officialOne.targets[i - 1].total, 'targets increase');
}
assert.equal(C.formatKg(709), '709 kg');
assert.equal(C.formatKg(763.2), '763.2 kg');
assert.equal(C.formatKg(0), '0 kg');
assert.equal(C.formatKgText('092.04'), '92.04');
assert.equal(C.formatKgText('1035.0'), '1035');
assert.equal(C.formatKgText('1035'), '1035');
assert.equal(C.formatKgText('92,04'), '92.04');

// ---- Refusals.
const failure = (input) => {
  try { C.compute(input); } catch (error) { return error.message; }
  return null;
};
const base = {sex: 'male', equipment: 'classic', event: 'powerlifting',
  bodyweight: '80', result: '400'};
const reject = (patch, expected) => {
  const got = failure(Object.assign({}, base, patch));
  assert.equal(got, expected, JSON.stringify(patch));
};
reject({bodyweight: ''}, 'Enter body weight in kilograms.');
reject({result: ''}, 'Enter the result in kilograms.');
reject({bodyweight: 'abc'},
  'Enter body weight as a number of kilograms, such as 82.5; "abc" is not one.');
reject({bodyweight: '-80'},
  'Enter body weight as a number of kilograms, such as 82.5; "-80" is not one.');
reject({bodyweight: '8 0'},
  'Enter body weight as a number of kilograms, such as 82.5; "8 0" is not one.');
reject({bodyweight: '82,5.0'},
  'Use one decimal separator in body weight; it has both a comma and a point.');
reject({bodyweight: '82.1234567'}, 'Keep body weight to at most six decimals.');
reject({bodyweight: '39.99'},
  'The IPF GL table for men, classic powerlifting starts at 40 kg of body weight; 39.99 kg is below that.');
reject({sex: 'female', bodyweight: '34.9'},
  'The IPF GL table for women, classic powerlifting starts at 35 kg of body weight; 34.9 kg is below that.');
reject({bodyweight: '400.5'},
  'A body weight above 400 kg is outside the range these coefficients are used for.');
reject({result: '2000.5'},
  'A result above 2000 kg is outside the range these coefficients are used for.');
reject({sex: 'other'}, 'Choose men or women.');
reject({equipment: 'suited'}, 'Choose classic or equipped.');
reject({event: 'squat'}, 'Choose powerlifting or bench press only.');

// ---- The catalog record and every case in it.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(record.name, 'IPF GL Points Calculator');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.listed, true);
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 80 && record.description.length < 260, 'description length');
assert.ok(record.tags.includes('powerlifting') && record.tags.includes('ipf'));
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.equal(record.sources.length, 2, 'two sources');
for (const source of record.sources) {
  assert.ok(/^https:\/\//.test(source.url), 'source urls are https');
  assert.ok(source.title.length > 30 && source.title.includes('IPF'), 'source titles name the IPF');
}
assert.equal(record.testCases.length, 29, '29 catalog cases');
assert.equal(record.testCases.filter((c) => c.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((c) => c.kind === 'boundary').length, 8);
assert.equal(record.testCases.filter((c) => c.kind === 'validation').length, 11);

for (const testCase of record.testCases) {
  const input = testCase.input;
  if (testCase.expectedError){
    const got = failure(input);
    assert.equal(got, testCase.expectedError, testCase.name);
    continue;
  }
  const got = C.compute(input);
  const want = testCase.expected;
  assert.equal(got.coefficient, want.coefficient, testCase.name + ' coefficient');
  assert.equal(got.points, want.points, testCase.name + ' points');
  assert.equal(got.points3, want.points3, testCase.name + ' three decimals');
  assert.equal(got.points6, want.points6, testCase.name + ' six decimals');
  assert.equal(got.total100, want.total100, testCase.name + ' total for 100');
  const bw = Number(String(input.bodyweight).replace(',', '.'));
  assert.equal(got.bodyweight, bw, testCase.name + ' body weight');
  assert.equal(got.result, Number(String(input.result).replace(',', '.')), testCase.name + ' result');
}

// ---- The generated surfaces list the page and the catalog stays consistent.
const toolsJs = fs.readFileSync(path.join(root, 'frontend/assets/tools.js'), 'utf8');
assert.ok(toolsJs.includes(slug), 'tools.js lists the slug');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2238, 'public tools');
assert.equal(catalog.tools.length, 2499, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Sports & Outdoors').length, 57,
  'Sports & Outdoors count');

// ---- The page contract.
assert.ok(html.includes('/assets/theme-init.js') && html.includes('/assets/style.css')
  && html.includes('/assets/app.js'), 'shared head and shell assets');
assert.ok(!/https?:\/\//.test(html), 'no outbound url in the page');
assert.ok(!/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/.test(html),
  'nothing is sent or stored');
assert.ok(html.includes('id="gl-form"') && html.includes('id="out"'), 'form and output hooks');
for (const id of ['sex', 'equipment', 'event', 'bodyweight', 'result']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id);
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id);
}
assert.equal((html.match(/<button/g) || []).length, 1, 'one action button');
assert.ok(html.includes('type="submit"'), 'the button submits the form');
assert.ok(html.includes('aria-live="polite"'), 'the result is announced');
assert.ok(html.includes('role="alert"'), 'errors are announced');
assert.ok(html.includes('IPF GL coefficient') && html.includes('Total that scores 100'),
  'the detail table names its rows');
assert.ok(/IPF GL Points Calculator/.test(html), 'heading and title');
console.log('ipf gl points: all checks passed');
