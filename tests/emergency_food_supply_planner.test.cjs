/* Regression checks for the emergency food supply core, its catalog cases and
   the arithmetic behind person-days, meal counts, the shortfall and packages. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const page = path.join(root, 'frontend/tools/emergency-food-supply-planner/index.html');
const html = fs.readFileSync(page, 'utf8');
const start = html.indexOf('/* emergency-food-core:start */');
const end = html.indexOf('/* emergency-food-core:end */');
assert.ok(start > -1 && end > start, 'emergency food core markers missing');
const core = html.slice(start, end + '/* emergency-food-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = EmergencyFoodCore;', sandbox);
const C = sandbox.module.exports;
const run = (input) => C.build(input);
const close = (actual, expected, label, eps = 1e-4) => {
  assert.ok(Math.abs(actual - expected) <= eps,
    `${label}: expected ${expected}, got ${actual}`);
};
const err = (input) => {
  try {
    C.build(input);
  } catch (error) {
    return error.message;
  }
  throw new Error('expected an error for ' + JSON.stringify(input));
};

// The worked default: 4 people for 3 days at 2,000 kcal and 3 meals.
const base = run({});
assert.equal(base.personDays, 12, 'person-days');
assert.equal(base.totalKcal, 24000, 'total calories');
assert.equal(base.totalMeals, 36, 'total meals');
close(base.kcalPerMeal, 2000 / 3, 'average calories per meal');
assert.equal(base.totalKcalText, '24,000 kcal');
assert.equal(base.kcalPerMealText, '667 kcal');
assert.equal(base.shortfallKcal, 24000);
assert.equal(base.shortfallDays, 3);
assert.equal(base.shortfallMeals, 36);
assert.equal(base.shortText, '36 meals');
assert.equal(base.statusKind, 'warning');
assert.equal(base.warnings.length, 1, 'the only warning is the empty store');
assert.equal(base.cases.length, 4);
const plain = (value) => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(base.cases.map((row) => [row.id, row.count, row.supplied, row.extra])),
  [['case6', 6, 36, 0], ['case12', 3, 36, 0], ['case24', 2, 48, 12], ['case48', 1, 48, 12]]);

// Nothing set aside: the whole requirement is outstanding, and a plan under
// three days also carries the several-day-supply warning.
const bare = run({ people: '1', days: '1' });
assert.equal(bare.warnings.length, 2, 'empty store and a short plan');
assert.match(bare.warnings[0], /^Nothing is set aside yet/);
assert.match(bare.warnings[1], /^This plan covers fewer than the several-day supply/);
assert.equal(bare.cases[0].count, 1, 'a single meal still needs one package');

// Food on hand reduces both the calories and the meal count by the same share.
const stored = run({ people: '2', days: '14', kcal: '2000', meals: '3', stored: '7' });
assert.equal(stored.storedPersonDays, 14);
assert.equal(stored.storedKcal, 28000);
assert.equal(stored.coveredDays, 7);
assert.equal(stored.shortfallKcal, 28000);
assert.equal(stored.shortfallDays, 7);
assert.equal(stored.shortfallMeals, 42);
assert.equal(stored.cases[0].count, 7, '42 meals is seven boxes of six');

// A surplus covers the plan, needs no packages and reports the extra days.
const surplus = run({ people: '8', days: '10', kcal: '3200', meals: '4', stored: '30' });
assert.equal(surplus.surplusKcal, 512000);
assert.equal(surplus.surplusDays, 20);
assert.equal(surplus.shortfallKcal, 0);
assert.equal(surplus.shortText, 'nothing outstanding');
assert.equal(surplus.gapText, '512,000 kcal');
assert.equal(surplus.statusKind, 'ok');
assert.ok(surplus.cases.every((row) => row.count === 0), 'no packages when covered');
assert.equal(surplus.warnings.length, 1, 'surplus warning only');

// Every reported figure follows from the inputs alone.
let referenceCases = 0;
for (let people = 1; people <= 12; people += 1) {
  for (let days = 1; days <= 30; days += 1) {
    for (const kcal of [1000, 1500, 2000, 2500, 3200, 4000]) {
      for (const meals of [2, 3, 4, 5]) {
        for (const store of ['0', '0.5', '3.5', '10', '30']) {
          const storedDays = Number(store);
          const result = run({
            people: String(people), days: String(days), kcal: String(kcal),
            meals: String(meals), stored: store
          });
          const label = `${people}/${days}/${kcal}/${meals}/${store}`;
          const personDays = people * days;
          const totalKcal = personDays * kcal;
          const totalMeals = personDays * meals;
          const perMeal = totalKcal / totalMeals;
          const storedKcal = storedDays * people * kcal;
          const shortfall = Math.max(0, totalKcal - storedKcal);
          assert.equal(result.personDays, personDays, label + ' person-days');
          close(result.totalKcal, totalKcal, label + ' calories');
          assert.equal(result.totalMeals, totalMeals, label + ' meals');
          close(result.kcalPerMeal, perMeal, label + ' calories per meal');
          close(result.storedKcal, storedKcal, label + ' stored calories');
          close(result.coveredDays, Math.min(storedDays, days), label + ' covered days');
          close(result.shortfallKcal, shortfall, label + ' shortfall');
          close(result.surplusKcal, Math.max(0, storedKcal - totalKcal), label + ' surplus');
          close(result.shortfallMeals, shortfall / perMeal, label + ' shortfall meals');
          assert.ok(result.totalKcalText.endsWith(' kcal'), label + ' calorie text');
          assert.equal(result.totalKcalText.replace(/[^0-9]/g, ''), String(Math.round(totalKcal)),
            label + ' grouped digits');
          for (const row of result.cases) {
            assert.ok(row.supplied >= shortfall / perMeal - 1e-6, label + ' ' + row.id + ' covers the meals');
            assert.ok(row.supplied - row.mealsPerPackage < shortfall / perMeal + 1e-6,
              label + ' ' + row.id + ' is the smallest whole count');
          }
          referenceCases += 1;
        }
      }
    }
  }
}
assert.ok(referenceCases > 3000, 'the sweep exercised ' + referenceCases + ' plans');

// Inclusive bounds at both ends of every accepted range.
assert.equal(run({ people: '1', days: '1', kcal: '1000', meals: '2', stored: '0' }).totalKcal, 1000);
assert.equal(run({ people: '12', days: '30', kcal: '4000', meals: '5', stored: '30' }).personDays, 360);
assert.equal(run({ people: '4', days: '3', kcal: '1000', meals: '2', stored: '0' }).kcalPerMeal, 500);
assert.equal(run({ people: '4', days: '3', kcal: '4000', meals: '5', stored: '0' }).kcalPerMeal, 800);
assert.equal(run({ stored: '0.5' }).storedDays, 0.5, 'half days are accepted');
assert.equal(run({ stored: '30' }).surplusDays, 27, 'thirty days on hand is accepted');
assert.equal(run({ stored: '02' }).storedDays, 2, 'leading zeros are accepted');

// Bad input fails with an actionable message, never a silent default.
assert.equal(err({ people: '' }), 'Enter the number of people as a whole number from 1 to 12.');
assert.equal(err({ people: '  ' }), 'Enter the number of people as a whole number from 1 to 12.');
assert.equal(err({ people: '0' }), 'The number of people must be from 1 to 12; 0 is outside that range.');
assert.equal(err({ people: '13' }), 'The number of people must be from 1 to 12; 13 is outside that range.');
assert.equal(err({ people: '2.5' }),
  'Enter the number of people as a whole number from 1 to 12; "2.5" is not a whole number.');
assert.equal(err({ days: '' }), 'Enter the number of days as a whole number from 1 to 30.');
assert.equal(err({ days: '31' }), 'The number of days must be from 1 to 30; 31 is outside that range.');
assert.equal(err({ days: 'ten' }),
  'Enter the number of days as a whole number from 1 to 30; "ten" is not a whole number.');
assert.equal(err({ kcal: '' }), 'Enter the calories per person per day as a whole number from 1000 to 4000.');
assert.equal(err({ kcal: '999' }),
  'The calories per person per day must be from 1000 to 4000; 999 is outside that range.');
assert.equal(err({ kcal: '4001' }),
  'The calories per person per day must be from 1000 to 4000; 4001 is outside that range.');
assert.equal(err({ kcal: '2000.5' }),
  'Enter the calories per person per day as a whole number from 1000 to 4000; "2000.5" is not a whole number.');
assert.equal(err({ meals: '' }), 'Enter the meals per person per day as a whole number from 2 to 5.');
assert.equal(err({ meals: '1' }), 'The meals per person per day must be from 2 to 5; 1 is outside that range.');
assert.equal(err({ meals: '6' }), 'The meals per person per day must be from 2 to 5; 6 is outside that range.');
assert.equal(err({ meals: '2.5' }),
  'Enter the meals per person per day as a whole number from 2 to 5; "2.5" is not a whole number.');
assert.equal(err({ stored: '' }), 'Enter the days of food on hand, or 0 if you have none set aside.');
assert.equal(err({ stored: '-1' }),
  'Enter the days of food on hand as a number such as 0 or 1.5; "-1" is not a number of days.');
assert.equal(err({ stored: '1.55' }),
  'Enter the days of food on hand as a number such as 0 or 1.5; "1.55" is not a number of days.');
assert.equal(err({ stored: '31' }), 'Days of food on hand must be at most 30; 31.0 is above that.');
// Missing options fall back to the documented defaults.
assert.equal(run({ people: null, days: null, kcal: null, meals: null, stored: null }).totalKcal, 24000,
  'nulls use defaults');

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="efs-form"/.test(html), 'page has a submittable form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
// The markup opens in the same state the core documents as its defaults.
for (const [id, value] of [['in-people', '4'], ['in-days', '3'], ['in-kcal', '2000'],
  ['in-meals', '3'], ['in-stored', '0']]) {
  assert.ok(new RegExp(`id="${id}"[^>]*value="${value}"`).test(html), `markup default for ${id}`);
}
// Every id the script looks up exists in the markup.
const script = html.slice(html.lastIndexOf('<script>'));
for (const match of script.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(html.includes(`id="${match[1]}"`), 'missing element #' + match[1]);
}
// The labels, the status regions and the result table are present and bound.
for (const id of ['in-people', 'in-days', 'in-kcal', 'in-meals', 'in-stored']) {
  assert.ok(new RegExp(`<label for="${id}">`).test(html), 'label for ' + id);
}
assert.ok(/'status'\)/.test(script) && /aria-live="polite"/.test(html), 'live status region');
assert.ok(/role="alert"/.test(html), 'error region');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'emergency-food-supply-planner');
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Emergency Food Supply Planner');
assert.equal(record.category, 'Safety & Emergency');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.sources.length, 2, 'two citations');
assert.equal(record.sources[0].url, 'https://www.ready.gov/food');
assert.equal(record.sources[1].url, 'https://www.fda.gov/food/nutrition-facts-label/calories-nutrition-facts-label');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.guidance.length > 200, 'guidance covers the limits');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10, 'ten golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 13, 'thirteen validation cases');
assert.equal(catalog.tools.length, 2447, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2186, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Safety & Emergency').length, 51,
  'Safety & Emergency count');
for (const other of catalog.tools) {
  if (other.slug === record.slug) continue;
  assert.notEqual(other.slug, record.slug, 'slug collides with ' + other.slug);
  const names = [other.slug.toLowerCase(), other.name.toLowerCase()].concat((other.aliases || []).map((a) => a.toLowerCase()));
  assert.ok(!names.includes(record.name.toLowerCase()), 'name collides with ' + other.slug);
  for (const alias of record.aliases) {
    assert.ok(!names.includes(alias.toLowerCase()), 'alias ' + alias + ' collides with ' + other.slug);
  }
}
for (const testCase of record.testCases) {
  const options = { ...C.DEFAULTS, ...testCase.input };
  if (testCase.expected && testCase.expected.error) {
    assert.equal(err(options), testCase.expected.error, testCase.name);
    continue;
  }
  const result = run(options);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (key === 'cases') {
      assert.deepEqual(plain(result.cases.map((row) => [row.id, row.count, row.supplied, row.extra])), value, testCase.name + ' cases');
    } else if (key === 'warnings') {
      assert.equal(result.warnings.length, value, testCase.name + ' warning count');
    } else if (typeof value === 'number') {
      close(result[key], value, testCase.name + ' ' + key);
    } else {
      assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

console.log('emergency-food-supply-planner: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + referenceCases + ' reference plans)');
