/* Regression checks for the video-wall core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/video-wall-tile-planner/index.html'), 'utf8');
const start = html.indexOf('/* video-wall-core:start */');
const end = html.indexOf('/* video-wall-core:end */');
assert.ok(start > -1 && end > start, 'video wall core markers missing');
const core = html.slice(start, end + '/* video-wall-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = VideoWallCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};
const plan = (input) => C.plan(input);
const base = {
  tileWidth: '1920', tileHeight: '1080', across: '4', down: '2',
  diagonal: '55', bezelWidth: '3.5', bezelHeight: '3.5'
};
const at = (overrides) => plan({ ...base, ...overrides });

// A 4 x 2 grid of 1920 x 1080 tiles is 7680 x 2160, a 32:9 canvas.
const standard = plan(base);
assert.equal(standard.canvasWidth, 7680);
assert.equal(standard.canvasHeight, 2160);
assert.equal(standard.ratioLabel, '32:9');
assert.equal(standard.tiles, 8);
near(standard.megapixels, 16.5888, 'megapixels');
// A 55-inch 16:9 tile is 1217.59 mm wide and 684.89 mm tall.
near(standard.tileWidthMm, 1217.591025363, 'tile width mm');
near(standard.tileHeightMm, 684.894951767, 'tile height mm');
near(standard.tileWidthMm / standard.tileHeightMm, 16 / 9, 'tile keeps its aspect');
near(Math.hypot(standard.tileWidthMm, standard.tileHeightMm) / 25.4, 55, 'tile diagonal');
// Three vertical and one horizontal 3.5 mm seam are added to the wall size.
near(standard.wallWidthMm, 4 * standard.tileWidthMm + 3 * 3.5, 'wall width adds seams');
near(standard.wallHeightMm, 2 * standard.tileHeightMm + 1 * 3.5, 'wall height adds seams');
near(standard.wallDiagonalIn, 199.62128388, 'wall diagonal inches');
near(standard.pixelPitchMm, standard.tileWidthMm / 1920, 'pixel pitch');
near(standard.pixelsPerInch, 7680 / (standard.wallWidthMm / 25.4), 'pixel density');
near(standard.bezelShareWidth, (3 * 3.5) / standard.wallWidthMm, 'bezel share width');
near(standard.bezelShareHeight, (1 * 3.5) / standard.wallHeightMm, 'bezel share height');
assert.equal(standard.wideBezel, false);

// Canvas resolution is exactly the tile resolution times the grid for every grid.
for (const grid of [[1, 1], [2, 3], [3, 3], [6, 4]]) {
  const result = at({ across: String(grid[0]), down: String(grid[1]) });
  assert.equal(result.canvasWidth, 1920 * grid[0], 'canvas width ' + grid.join('x'));
  assert.equal(result.canvasHeight, 1080 * grid[1], 'canvas height ' + grid.join('x'));
  assert.equal(result.tiles, grid[0] * grid[1], 'tile count ' + grid.join('x'));
  assert.equal(result.pixelsPerInch, result.canvasWidth / (result.wallWidthMm / 25.4), 'density ' + grid.join('x'));
}

// A single tile measures exactly its own diagonal and has no seam share.
const single = at({ across: '1', down: '1', bezelWidth: '0', bezelHeight: '0' });
near(single.wallDiagonalIn, 55, 'single tile diagonal');
assert.equal(single.bezelShareWidth, 0);
assert.equal(single.bezelShareHeight, 0);
assert.equal(single.wallWidthMm, single.tileWidthMm);
assert.equal(single.wallHeightMm, single.tileHeightMm);

// Aspect labels reduce by the greatest common divisor.
assert.equal(C.ratioLabel(7680, 2160), '32:9');
assert.equal(C.ratioLabel(5760, 3240), '16:9');
assert.equal(C.ratioLabel(1920, 1200), '8:5');
assert.equal(C.ratioLabel(9600, 3600), '8:3');
assert.equal(C.ratioLabel(1920, 1080), '16:9');
assert.equal(C.ratioLabel(1000, 1000), '1:1');

// The reference table holds six ascending grids and includes the current one.
assert.equal(standard.grids.length, 6);
const firstGrid = standard.grids[0];
assert.equal(firstGrid.across, 2);
assert.equal(firstGrid.down, 2);
assert.equal(firstGrid.canvasWidth, 3840);
assert.equal(firstGrid.canvasHeight, 2160);
assert.equal(firstGrid.ratioLabel, '16:9');
near(firstGrid.canvasAspect, 16 / 9, 'grid aspect');
near(firstGrid.wallWidthM, (2 * standard.tileWidthMm + 3.5) / 1000, 'grid wall width');
near(firstGrid.wallHeightM, (2 * standard.tileHeightMm + 3.5) / 1000, 'grid wall height');
for (let i = 1; i < standard.grids.length; i += 1) {
  const previous = standard.grids[i - 1];
  const current = standard.grids[i];
  assert.ok(current.across * current.down > previous.across * previous.down, 'grids grow');
  assert.ok(current.wallWidthM >= previous.wallWidthM, 'wall width never shrinks');
  assert.ok(current.wallHeightM >= previous.wallHeightM, 'wall height never shrinks');
  near(current.wallWidthM * 1000, current.across * standard.tileWidthMm + (current.across - 1) * 3.5, 'grid wall width');
}

// The bezel warning starts above one percent in either direction.
assert.equal(at({ across: '4', down: '2', bezelWidth: '3.5', bezelHeight: '3.5' }).wideBezel, false);
const wide = at({ across: '6', down: '4', bezelWidth: '10', bezelHeight: '10' });
assert.equal(wide.wideBezel, true);
near(wide.bezelShareHeight, 30 / wide.wallHeightMm, 'wide bezel share');
assert.equal(at({ across: '1', down: '1', bezelWidth: '200', bezelHeight: '200' }).wideBezel, false);

// Zero bezels are valid and leave the wall at the sum of the tiles.
const seamless = at({ bezelWidth: '0', bezelHeight: '0' });
assert.equal(seamless.wallWidthMm, 4 * seamless.tileWidthMm);
assert.equal(seamless.wallHeightMm, 2 * seamless.tileHeightMm);

// Parsing: required, whole numbers where pixels or counts are meant, and bounded.
const rejects = (input, pattern) => assert.throws(() => plan({ ...base, ...input }), pattern);
rejects({ tileWidth: '' }, /Tile width is required\./);
rejects({ tileWidth: '  ' }, /Tile width is required\./);
rejects({ tileWidth: '1920.5' }, /Tile width must be a whole number\./);
rejects({ tileWidth: '-1920' }, /Tile width must be a whole number\./);
rejects({ tileWidth: '1e3' }, /Tile width must be a whole number\./);
rejects({ tileWidth: '32' }, /Tile width must be from 64 to 16384 px\./);
rejects({ tileWidth: '20000' }, /Tile width must be from 64 to 16384 px\./);
rejects({ tileHeight: '1080.5' }, /Tile height must be a whole number\./);
rejects({ tileHeight: '32' }, /Tile height must be from 64 to 16384 px\./);
rejects({ across: '0' }, /Tiles across must be from 1 to 32\./);
rejects({ across: '2.5' }, /Tiles across must be a whole number\./);
rejects({ down: '33' }, /Tiles down must be from 1 to 32\./);
rejects({ down: '' }, /Tiles down is required\./);
rejects({ diagonal: '' }, /Tile diagonal is required\./);
rejects({ diagonal: '-5' }, /Tile diagonal must be a number\./);
rejects({ diagonal: '4.9' }, /Tile diagonal must be from 5 to 300 in\./);
rejects({ diagonal: '301' }, /Tile diagonal must be from 5 to 300 in\./);
rejects({ bezelWidth: '' }, /Vertical bezel is required\./);
rejects({ bezelWidth: '-1' }, /Vertical bezel must be a number\./);
rejects({ bezelWidth: '201' }, /Vertical bezel must be from 0 to 200 mm\./);
rejects({ bezelHeight: 'abc' }, /Horizontal bezel must be a number\./);

// Missing options object is rejected rather than crashing.
assert.throws(() => C.plan(), /Tile width is required\./);

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'video-wall-tile-planner');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Video');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 18, 'catalog has the full test case set');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(
      () => plan({ ...base, ...testCase.input }),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = plan(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') near(result[key], value, testCase.name + ' ' + key);
    else assert.equal(result[key], value, testCase.name + ' ' + key);
  }
}

console.log('video-wall-tile-planner: all checks passed (' + record.testCases.length + ' catalog cases)');
