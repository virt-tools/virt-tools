/* Regression checks for the hiking time calculator core (Naismith's rule). */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/hiking-time-calculator/index.html'), 'utf8');
const start = html.indexOf('/* hiking-time-core:start */');
const end = html.indexOf('/* hiking-time-core:end */');
assert.ok(start > -1 && end > start, 'hiking time core markers missing');
const core = html.slice(start, end + '/* hiking-time-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = HikingTimeCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
};
const plan = (opts) => C.plan(opts);
const rejects = (opts, pattern) => {
  assert.throws(() => C.plan(opts), pattern);
};

// 15 km with 720 m of ascent at 5 km/h: 3.00 h flat + 1.20 h climbing = 4.20 h.
const base = plan({ distance: '15', ascent: '720', speed: '5' });
near(base.distanceKm, 15, 'distance km');
near(base.distanceMiles, 9.32056788356001, 'distance miles');
near(base.ascentM, 720, 'ascent m');
near(base.ascentFt, 2362.2047244094488, 'ascent ft');
near(base.flatSeconds, 10800, 'flat seconds');
near(base.ascentSeconds, 4320, 'ascent seconds');
near(base.totalSeconds, 15120, 'total seconds');
assert.equal(base.totalMinutes, 252);
near(base.paceSecPerKm, 1008, 'pace per km');
near(base.paceSecPerMi, 1622.218752, 'pace per mile');
assert.equal(base.steep, false);
assert.equal(base.longDay, false);
assert.equal(base.startMinutes, null);
assert.equal(base.arrivalMinutes, null);

// Imperial input is converted exactly: 8 mi and 1,500 ft at 4.5 km/h.
const imperial = plan({ distance: '8', distanceUnit: 'mi', ascent: '1500', ascentUnit: 'ft', speed: '4.5' });
near(imperial.distanceKm, 12.874752, 'imperial distance km');
near(imperial.distanceMiles, 8, 'imperial distance miles');
near(imperial.ascentM, 457.2, 'imperial ascent m');
near(imperial.ascentFt, 1500, 'imperial ascent ft');
near(imperial.flatSeconds, 10299.8016, 'imperial flat seconds');
near(imperial.ascentSeconds, 2743.2, 'imperial ascent seconds');
near(imperial.totalSeconds, 13043.0016, 'imperial total seconds');
assert.equal(imperial.totalMinutes, 217);

// A flat route is purely distance over speed, with no ascent allowance.
const flat = plan({ distance: '20', ascent: '0', speed: '5' });
near(flat.flatSeconds, 14400, 'flat route seconds');
assert.equal(flat.ascentSeconds, 0);
near(flat.totalSeconds, 14400, 'flat route total');
near(flat.paceSecPerKm, 720, 'flat route pace');

// Start times produce an arrival, rolling past midnight when needed.
const morning = plan({ distance: '15', ascent: '720', speed: '5', start: '08:30' });
assert.equal(morning.startMinutes, 510);
assert.equal(morning.arrivalMinutes, 762);
assert.equal(morning.arrivalNextDay, false);
const overnight = plan({ distance: '15', ascent: '720', speed: '5', start: '22:00' });
assert.equal(overnight.startMinutes, 1320);
assert.equal(overnight.arrivalMinutes, 132);
assert.equal(overnight.arrivalNextDay, true);
// A single-digit hour is accepted; a blank start is treated as absent.
assert.equal(plan({ distance: '5', ascent: '0', speed: '5', start: '8:30' }).startMinutes, 510);
assert.equal(plan({ distance: '5', ascent: '0', speed: '5', start: '  ' }).startMinutes, null);

// Steep ground: the ascent allowance exceeds the flat walking time.
const steep = plan({ distance: '5', ascent: '1200', speed: '5' });
near(steep.flatSeconds, 3600, 'steep flat seconds');
near(steep.ascentSeconds, 7200, 'steep ascent seconds');
near(steep.totalSeconds, 10800, 'steep total seconds');
assert.equal(steep.steep, true);
assert.equal(steep.longDay, false);

// A long day out is flagged above ten hours.
const long = plan({ distance: '40', ascent: '2000', speed: '4' });
near(long.totalSeconds, 48000, 'long total seconds');
assert.equal(long.steep, false);
assert.equal(long.longDay, true);

// Both ends of each range stay finite and are flagged appropriately.
const bounds = plan({ distance: '0.1', ascent: '10000', speed: '1' });
near(bounds.totalSeconds, 60360, 'bounds total seconds');
assert.equal(bounds.totalMinutes, 1006);
assert.equal(bounds.steep, true);
assert.equal(bounds.longDay, true);
const top = plan({ distance: '100', ascent: '10000', speed: '8' });
near(top.totalSeconds, 105000, 'top total seconds');
near(top.paceSecPerKm, 1050, 'top pace');

// Distance: required, numeric, unsigned, inside 0.1-100 km in the chosen unit.
rejects({ distance: '', ascent: '0', speed: '5' }, /Distance is required/);
rejects({ distance: '  ', ascent: '0', speed: '5' }, /Distance is required/);
rejects({ distance: 'ten', ascent: '0', speed: '5' }, /Distance must be a number/);
rejects({ distance: '-1', ascent: '0', speed: '5' }, /Distance must be a number/);
rejects({ distance: '1e1', ascent: '0', speed: '5' }, /Distance must be a number/);
rejects({ distance: '15km', ascent: '0', speed: '5' }, /Distance must be a number/);
rejects({ distance: '0', ascent: '0', speed: '5' }, /Distance must be from 0.1 to 100 km/);
rejects({ distance: '100.1', ascent: '0', speed: '5' }, /Distance must be from 0.1 to 100 km/);
rejects({ distance: '0.05', distanceUnit: 'mi', ascent: '0', speed: '5' }, /Distance must be from 0.1 to 100 km/);

// Ascent: required, numeric, inside 0-10,000 m in the chosen unit.
rejects({ distance: '10', ascent: '', speed: '5' }, /Ascent is required/);
rejects({ distance: '10', ascent: '-5', speed: '5' }, /Ascent must be a number/);
rejects({ distance: '10', ascent: '10001', speed: '5' }, /Ascent must be from 0 to 10,000 m/);
rejects({ distance: '10', ascent: '33000', ascentUnit: 'ft', speed: '5' }, /Ascent must be from 0 to 10,000 m/);

// Base speed: required and inside 1-8 km/h.
rejects({ distance: '10', ascent: '0', speed: '' }, /Base speed is required/);
rejects({ distance: '10', ascent: '0', speed: '0.5' }, /Base speed must be from 1 to 8 km\/h/);
rejects({ distance: '10', ascent: '0', speed: '9' }, /Base speed must be from 1 to 8 km\/h/);

// Start time: optional, but a 24-hour clock when present.
rejects({ distance: '10', ascent: '0', speed: '5', start: '24:00' }, /Start time must be 24-hour HH:MM/);
rejects({ distance: '10', ascent: '0', speed: '5', start: '08:60' }, /Start time must be 24-hour HH:MM/);
rejects({ distance: '10', ascent: '0', speed: '5', start: '8.30' }, /Start time must be 24-hour HH:MM/);

console.log('hiking-time-calculator: checks passed');
