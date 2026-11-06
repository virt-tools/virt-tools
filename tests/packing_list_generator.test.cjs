/* Regression checks for the packing list generator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/packing-list-generator/index.html'), 'utf8');
const start = html.indexOf('/* packing-core:start */');
const end = html.indexOf('/* packing-core:end */');
assert.ok(start > -1 && end > start, 'packing core markers missing');
const core = html.slice(start, end + '/* packing-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PackingCore;', sandbox);
const P = sandbox.module.exports;

const build = (input) => P.plan(P.normalise(input));
const list = (value, mapFn) => mapFn ? Array.from(value, mapFn) : Array.from(value);
const names = (plan) => Array.from(plan.items, (entry) => entry.name);
const item = (plan, name) => plan.items.find((entry) => entry.name === name);
const qty = (plan, name) => {
  const found = item(plan, name);
  assert.ok(found, `missing item: ${name}`);
  return found.qty;
};
const rejects = (input, pattern) => {
  assert.throws(() => P.normalise(input), pattern);
};

// Defaults: three mild days, no laundry, no activities.
const base = build({});
assert.equal(P.normalise({}).days, 3);
assert.equal(P.normalise({}).climate, 'mild');
assert.equal(P.normalise({}).laundry, false);
assert.deepEqual(list(P.normalise({}).activities), []);
assert.deepEqual(list(P.normalise({}).extras), []);
assert.equal(base.outfitDays, 3);
assert.equal(base.itemCount, 20);
assert.equal(base.pieceCount, 27);
assert.equal(base.groups.length, 3);
assert.deepEqual(list(base.groups, (group) => group.name), ['Documents & essentials', 'Clothing', 'Toiletries']);
assert.equal(qty(base, 'Tops'), 3);
assert.equal(qty(base, 'Bottoms'), 2);
assert.equal(qty(base, 'Underwear'), 3);
assert.equal(qty(base, 'Socks'), 3);
assert.equal(qty(base, 'Sleepwear'), 1);
assert.equal(qty(base, 'Light jacket'), 1);
assert.equal(item(base, 'Sun hat'), undefined);
assert.equal(item(base, 'Insulated coat'), undefined);
assert.equal(item(base, 'Water bottle'), undefined);

// Laundry reduces the number of outfit days but never below one.
assert.equal(P.outfitDays(10, false), 10);
assert.equal(P.outfitDays(10, true), 6);
assert.equal(P.outfitDays(3, true), 3);
assert.equal(P.outfitDays(1, true), 1);
assert.equal(P.outfitDays(30, true), 16);

// Hot beach week with laundry: fewer clothing days, beach extras, no cold gear.
const beach = build({days: 7, climate: 'hot', laundry: true, activities: ['beach']});
assert.equal(beach.outfitDays, 5);
assert.equal(beach.itemCount, 28);
assert.equal(beach.pieceCount, 43);
assert.equal(qty(beach, 'Tops'), 5);
assert.equal(qty(beach, 'Bottoms'), 3);
assert.equal(qty(beach, 'Underwear'), 5);
assert.equal(qty(beach, 'Swimsuit'), 2);
assert.equal(qty(beach, 'Flip-flops'), 1);
assert.equal(qty(beach, 'Sunscreen SPF 30+'), 1);
assert.equal(qty(beach, 'Insect repellent'), 1);
assert.equal(qty(beach, 'Beach towel'), 1);
assert.equal(qty(beach, 'Laundry bag'), 1);
assert.equal(item(beach, 'Insulated coat'), undefined);
assert.equal(item(beach, 'Scarf'), undefined);

// Cold hiking and business: layers, formal clothing, one shared water bottle.
const cold = build({days: 4, climate: 'cold', activities: ['hiking', 'business']});
assert.equal(cold.itemCount, 35);
assert.equal(cold.pieceCount, 49);
assert.equal(qty(cold, 'Thermal base layer'), 2);
assert.equal(qty(cold, 'Warm mid-layer'), 1);
assert.equal(qty(cold, 'Insulated coat'), 1);
assert.equal(qty(cold, 'Gloves'), 1);
assert.equal(qty(cold, 'Beanie'), 1);
assert.equal(qty(cold, 'Scarf'), 1);
assert.equal(qty(cold, 'Wool socks'), 2);
assert.equal(qty(cold, 'Hiking shoes'), 1);
assert.equal(qty(cold, 'Rain shell'), 1);
assert.equal(qty(cold, 'Blister plasters'), 1);
assert.equal(qty(cold, 'Daypack'), 1);
assert.equal(qty(cold, 'Blazer'), 1);
assert.equal(qty(cold, 'Dress shirt'), 3);
assert.equal(qty(cold, 'Dress shoes'), 1);
assert.equal(qty(cold, 'Belt'), 1);
assert.equal(qty(cold, 'Lip balm'), 1);
assert.equal(item(cold, 'Sunscreen SPF 30+'), undefined);
assert.equal(names(cold).filter((name) => name === 'Water bottle').length, 1);

// Long trip with laundry and gym: quantities scale with the reduced outfit days.
const long = build({days: 30, laundry: true, activities: ['gym']});
assert.equal(long.outfitDays, 16);
assert.equal(long.itemCount, 23);
assert.equal(long.pieceCount, 77);
assert.equal(qty(long, 'Tops'), 16);
assert.equal(qty(long, 'Bottoms'), 8);
assert.equal(qty(long, 'Underwear'), 16);
assert.equal(qty(long, 'Socks'), 16);
assert.equal(qty(long, 'Gym kit'), 3);
assert.equal(qty(long, 'Water bottle'), 1);
assert.equal(qty(long, 'Laundry bag'), 1);

// Custom items are trimmed, whitespace-collapsed and deduplicated case-insensitively.
const extras = build({days: 2, extras: 'Camera\ncamera\n  travel   pillow  \n\n'});
assert.deepEqual(list(P.normalise({extras: 'Camera\ncamera\n  travel   pillow  \n\n'}).extras), ['Camera', 'travel pillow']);
assert.equal(extras.itemCount, 22);
assert.equal(extras.groups[extras.groups.length - 1].name, 'Your extras');
assert.deepEqual(list(extras.groups[extras.groups.length - 1].items, (entry) => entry.name), ['Camera', 'travel pillow']);

// Every generated list stays deduplicated and keeps positive whole quantities.
for (const plan of [base, beach, cold, long, extras]) {
  assert.equal(new Set(names(plan)).size, plan.items.length, 'duplicate item names');
  for (const entry of plan.items) {
    assert.ok(P.GROUPS.includes(entry.group), `unknown group: ${entry.group}`);
    assert.ok(Number.isInteger(entry.qty) && entry.qty >= 1, `bad quantity for ${entry.name}`);
  }
  assert.equal(plan.groups.reduce((sum, group) => sum + group.items.length, 0), plan.itemCount);
  assert.equal(plan.items.reduce((sum, entry) => sum + entry.qty, 0), plan.pieceCount);
}

// Rejections: ranges, types, unknown choices and oversized custom lists.
rejects({days: 0}, /Trip length must be from 1 to 30/);
rejects({days: 31}, /Trip length must be from 1 to 30/);
rejects({days: 2.5}, /whole number/);
rejects({days: ''}, /whole number/);
rejects({climate: 'tropical'}, /hot, mild or cold/);
rejects({activities: ['skiing']}, /activities from the list/);
rejects({activities: 'beach'}, /must be a list/);
rejects({extras: 'x'.repeat(61)}, /60 characters or fewer/);
rejects({extras: Array.from({length: 13}, (_, i) => `item ${i}`).join('\n')}, /at most 12/);

console.log('packing list generator: all assertions passed');
