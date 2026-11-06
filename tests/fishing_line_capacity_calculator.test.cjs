/* Regression checks for the fishing line capacity calculator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/fishing-line-capacity-calculator/index.html'), 'utf8');
const start = html.indexOf('/* fishing-line-core:start */');
const end = html.indexOf('/* fishing-line-core:end */');
assert.ok(start > -1 && end > start, 'fishing line core markers missing');
const core = html.slice(start, end + '/* fishing-line-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = FishingLineCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
};
const base = {
  arbor: 30, lip: 46, width: 20, gap: 1, line: 0.30,
  packing: 85, braid: 0.20, topshotLine: 0.30, topshot: 60
};
const build = (overrides = {}) => C.plan({ ...base, ...overrides });
const rejects = (overrides, pattern) => {
  assert.throws(() => C.normalise({ ...base, ...overrides }), pattern);
};

// A 30 mm arbor inside a 46 mm lip, 20 mm wide, filled with 0.30 mm line at 85% density.
const a = build();
near(a.effectiveLip, 44, 'effective lip');
near(a.capacityM, 151.088615, 'capacity metres', 1e-5);
near(a.capacityYd, 165.232519, 'capacity yards', 1e-5);
assert.equal(a.layers, 23);
near(a.turnsPerLayer, 56.666667, 'turns per layer', 1e-5);
near(a.woundDepthMm, 6.9, 'wound depth');
near(a.fillDepthMm, 7, 'fill depth');
near(a.maxTopshotM, 151.088615, 'max topshot', 1e-5);

// The plan puts 191.8 m of 0.20 mm braid under a 60 m topshot and finishes at the fill line.
assert.equal(a.fits, true);
near(a.interfaceMm, 38.6, 'interface diameter', 1e-6);
near(a.braidM, 191.784807, 'braid metres', 1e-5);
near(a.braidYd, 209.738415, 'braid yards', 1e-5);
assert.equal(a.braidLayers, 21);
assert.equal(a.monoLayers, 9);
near(a.fillPercent, 100, 'fill percent', 1e-6);
near(a.clearanceMm, 0, 'clearance', 1e-6);

// A smaller spool holds 83.3 m of 0.20 mm line and needs 222.5 m of 0.10 mm backing.
const b = build({ arbor: 22, lip: 32, width: 12, line: 0.20, braid: 0.10, topshotLine: 0.20, topshot: 25 });
near(b.capacityM, 83.315037, 'small capacity', 1e-5);
assert.equal(b.layers, 20);
near(b.turnsPerLayer, 51, 'small turns', 1e-6);
near(b.braidM, 222.515238, 'small braid', 1e-5);
assert.equal(b.monoLayers, 6);
assert.equal(b.braidLayers, 28);

// A shallow 36-44 mm spool holds only 43.8 m of 0.28 mm line, so a 50 m topshot cannot fit.
const c = build({ arbor: 36, lip: 44, width: 15, gap: 1.5, line: 0.28, braid: 0.15, topshotLine: 0.28, topshot: 50 });
near(c.effectiveLip, 41, 'shallow effective lip');
near(c.capacityM, 43.763283, 'shallow capacity', 1e-5);
assert.equal(c.layers, 8);
near(c.turnsPerLayer, 45.535714, 'shallow turns', 1e-6);
assert.equal(c.fits, false);
near(c.maxTopshotM, 43.763283, 'shallow max topshot', 1e-5);
assert.equal(c.braidMm, undefined);

// Density changes the estimate in proportion: 70% and 100% bracket the 85% figure.
const loose = build({ packing: 70 });
const full = build({ packing: 100 });
near(loose.capacityM, 124.425919, 'loose capacity', 1e-5);
near(full.capacityM, 177.751312, 'full capacity', 1e-5);
near(loose.braidM, 133.002467, 'loose braid', 1e-5);
near(full.braidM, 262.385818, 'full braid', 1e-5);
near(loose.capacityM / a.capacityM, 70 / 85, 'density scales capacity', 1e-9);

// A shorter topshot leaves more room for backing.
const shortTop = build({ topshot: 30 });
const longTop = build({ topshot: 90 });
assert.ok(shortTop.braidM > longTop.braidM, 'shorter topshot needs more backing');
assert.equal(shortTop.fits, true);
assert.equal(longTop.fits, true);

// A topshot at the spool's limit needs essentially no backing.
const atLimit = build({ topshot: 151 });
assert.equal(atLimit.fits, true);
assert.ok(atLimit.braidM < 1, `expected almost no backing, got ${atLimit.braidM}`);

// A topshot just over the limit is reported instead of being planned.
const over = build({ topshot: 151.5 });
assert.equal(over.fits, false);
assert.equal(over.braidM, undefined);

// Form strings normalise to the same numbers.
const fromForm = C.plan({
  arbor: '30', lip: '46', width: '20', gap: '1', line: '0.30',
  packing: '85', braid: '0.20', topshotLine: '0.30', topshot: '60'
});
near(fromForm.capacityM, a.capacityM, 'form capacity', 1e-9);
near(fromForm.braidM, a.braidM, 'form braid', 1e-9);
assert.equal(C.normalise({ ...base, packing: ' 85 ' }).packing, 85);

// The fill gap is radial, so it removes twice its value from the lip diameter.
const noGap = build({ gap: 0 });
near(noGap.effectiveLip, 46, 'no-gap lip');
assert.ok(noGap.capacityM > a.capacityM, 'a smaller gap holds more line');

// Rejections: ranges, types, impossible spools and missing values.
rejects({ arbor: 4 }, /Arbor diameter must be from 5 to 200 mm/);
rejects({ arbor: 201 }, /Arbor diameter must be from 5 to 200 mm/);
rejects({ arbor: 'abc' }, /Arbor diameter must be a number/);
rejects({ arbor: '-30' }, /Arbor diameter must be a number/);
rejects({ arbor: '' }, /Arbor diameter must be a number/);
rejects({ lip: 9 }, /Spool lip diameter must be from 10 to 300 mm/);
rejects({ width: 4 }, /Spool width must be from 5 to 200 mm/);
rejects({ width: 201 }, /Spool width must be from 5 to 200 mm/);
rejects({ gap: 21 }, /Fill gap must be from 0 to 20 mm/);
rejects({ line: 0.04 }, /Line diameter must be from 0.05 to 3 mm/);
rejects({ braid: 3.1 }, /Braid diameter must be from 0.05 to 3 mm/);
rejects({ topshotLine: 0 }, /Topshot diameter must be from 0.05 to 3 mm/);
rejects({ packing: 49 }, /Winding density must be from 50 to 100 %/);
rejects({ packing: 101 }, /Winding density must be from 50 to 100 %/);
rejects({ topshot: 0 }, /Topshot length must be from 1 to 1000 m/);
rejects({ topshot: 1001 }, /Topshot length must be from 1 to 1000 m/);
rejects({ arbor: 30, lip: 30.2, gap: 0 }, /spool lip must be wider than the arbor/);
rejects({ arbor: 46, lip: 30 }, /spool lip must be wider than the arbor/);
rejects({ arbor: 30, lip: 31, gap: 0, line: 0.6 }, /too shallow for a 0.6 mm line/);

console.log('fishing line capacity calculator: all assertions passed');
