/* DWDM / CWDM grid: the ITU anchor and spacings, the band edges, the
   frequency-to-wavelength arithmetic, parsing, snapping and its offsets,
   refusals, the neighbour table, catalog replay, uniqueness and the page
   contract. The anchor 193.10 THz = 1552.52 nm and the eighteen CWDM channels
   from 1271 to 1611 nm are transcribed from ITU-T G.694.1 and G.694.2, so a
   changed constant or spacing fails here. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'dwdm-cwdm-channel-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* dwdm-cwdm-core:start */';
const endMarker = '/* dwdm-cwdm-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = DwdmCwdmCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (grid, value, unit) => plain(C.solve(grid, value, unit));
const failure = (grid, value, unit) => {
  try { run(grid, value, unit); } catch (error) { return error.message; }
  return null;
};
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);

// ---- The published constants.
assert.equal(C.C_THZ_NM, 299792.458, 'speed of light in nm times THz');
assert.equal(C.ANCHOR_THZ, 193.1, 'the ITU frequency anchor');
assert.equal(C.MIN_THZ, 186, 'bottom of the covered DWDM range');
assert.equal(C.MAX_THZ, 200, 'top of the covered DWDM range');
assert.equal(C.CWDM_START_NM, 1271, 'first CWDM channel in the 2003 revision');
assert.equal(C.CWDM_END_NM, 1611, 'last CWDM channel');
assert.equal(C.CWDM_STEP_NM, 20, 'CWDM spacing');
assert.equal(C.CWDM_CHANNELS, 18, 'eighteen coarse channels');

assert.equal(C.GRIDS.length, 3);
assert.deepEqual(plain(C.GRIDS.map((grid) => grid.id)), ['dwdm100', 'dwdm50', 'cwdm']);
assert.deepEqual(plain(C.GRIDS.map((grid) => grid.kind)), ['dwdm', 'dwdm', 'cwdm']);
assert.deepEqual(plain(C.GRIDS.map((grid) => grid.spacing)), [0.1, 0.05, 20]);

// ---- ITU band edges, lower bound inclusive.
const BANDS = [['O', 1260, 1360], ['E', 1360, 1460], ['S', 1460, 1530], ['C', 1530, 1565], ['L', 1565, 1625], ['U', 1625, 1675]];
assert.equal(C.BANDS.length, 6);
for (let index = 0; index < BANDS.length; index += 1) {
  assert.equal(C.BANDS[index].letter, BANDS[index][0]);
  assert.equal(C.BANDS[index].low, BANDS[index][1]);
  assert.equal(C.BANDS[index].high, BANDS[index][2]);
  assert.equal(C.bandOf(BANDS[index][1]).letter, BANDS[index][0], 'lower edge ' + BANDS[index][0]);
  assert.equal(C.bandText(C.bandOf(BANDS[index][1])), BANDS[index][0] + ' band (' + BANDS[index][1] + '\u2013' + BANDS[index][2] + ' nm)');
}
assert.equal(C.bandOf(1359.99).letter, 'O', 'just below the E edge');
assert.equal(C.bandOf(1564.99).letter, 'C', 'just below the L edge');
assert.equal(C.bandOf(1625).letter, 'U');
assert.equal(C.bandOf(1259), null);
assert.equal(C.bandOf(1675), null);
assert.equal(C.bandText(null), 'outside the O to U bands');
assert.equal(C.bandLetter(1550), 'C band');

// ---- Anchor and the vendor channels around 1550 nm, independent arithmetic.
assert.equal(C.fmtWavelength(299792.458 / 193.1), '1552.52');
assert.equal(C.fmtFrequency(193.1), '193.1000');
const anchor = run('dwdm100', '193.1', 'thz');
assert.equal(anchor.bigText, '1552.52 nm');
assert.equal(anchor.subText, 'n = 0 on the 100 GHz grid, 193.1000 THz, C band');
assert.equal(anchor.index, 0);
assert.equal(anchor.rows[4].v, 'C band (1530\u20131565 nm)');
assert.equal(anchor.rows[5].v, 'on grid');

for (const index of [-71, -40, -14, 0, 3, 30, 69]) {
  const thz = 193.1 + index * 0.1;
  const result = run('dwdm100', String(Number(thz.toFixed(2))), 'thz');
  assert.equal(result.index, index, 'index for ' + index);
  assert.equal(result.bigText, C.fmtWavelength(299792.458 / thz) + ' nm', 'wavelength for ' + index);
  assert.equal(result.rows[2].v, C.fmtFrequency(thz) + ' THz', 'frequency for ' + index);
  assert.ok(Math.abs(result.frequency - thz) < 1e-9, 'channel frequency for ' + index);
}
const c34 = run('dwdm100', '193.4', 'thz');
assert.equal(c34.bigText, '1550.12 nm');
assert.equal(c34.subText, 'n = +3 on the 100 GHz grid, 193.4000 THz, C band');
const c17 = run('dwdm100', '191.7', 'thz');
assert.equal(c17.bigText, '1563.86 nm');
assert.equal(c17.subText, 'n = \u221214 on the 100 GHz grid, 191.7000 THz, C band');

// ---- The 50 GHz plan inserts half channels at the same anchor.
const half = run('dwdm50', '193.15', 'thz');
assert.equal(half.index, 1);
assert.equal(half.bigText, '1552.12 nm');
assert.equal(half.subText, 'n = +1 on the 50 GHz grid, 193.1500 THz, C band');
assert.equal(run('dwdm50', '193.1', 'thz').bigText, '1552.52 nm', 'the anchor is shared');
assert.equal(C.fmtWavelength(299792.458 / 193.15), '1552.12');

// ---- Every coarse channel, from 1271 to 1611 nm in 20 nm steps.
for (let channel = 1; channel <= 18; channel += 1) {
  const nm = 1271 + (channel - 1) * 20;
  const result = run('cwdm', String(nm), 'nm');
  assert.equal(result.index, channel, 'CWDM channel ' + channel);
  assert.equal(result.bigText, nm.toFixed(2) + ' nm');
  assert.equal(result.rows[1].v, 'Channel ' + channel + ' of 18');
  assert.ok(Math.abs(result.frequency - 299792.458 / nm) < 1e-9, 'frequency for ' + nm);
}
assert.equal(run('cwdm', '1551', 'nm').rows[3].v, '193.2898 THz');
assert.equal(run('cwdm', '1271', 'nm').rows[4].v, 'O band (1260\u20131360 nm)');
assert.equal(run('cwdm', '1611', 'nm').rows[4].v, 'L band (1565\u20131625 nm)');

// ---- Snapping and the reported offset.
const offGrid = run('dwdm100', '193.14', 'thz');
assert.equal(offGrid.index, 0);
assert.equal(offGrid.rows[5].v, '+40.00 GHz (\u22120.32 nm)');
assert.equal(offGrid.notice,
  'The reading sits +40.00 GHz (\u22120.32 nm) from n = 0; the grid has no channel at the value you entered, so the neighbouring channel is shown.');
const coarse = run('cwdm', '1550.12', 'nm');
assert.equal(coarse.index, 15);
assert.equal(coarse.rows[5].v, '+109.73 GHz (\u22120.88 nm)');
assert.equal(coarse.notice,
  'The reading sits +109.73 GHz (\u22120.88 nm) from channel 15 (1551.00 nm); the coarse grid has no channel at the value you entered, so the nearest one is shown.');
// A reading within the display resolution of the channel counts as on grid.
assert.equal(run('cwdm', '235.8713', 'thz').rows[5].v, 'on grid');
assert.equal(run('cwdm', '235.8713', 'thz').notice, '');
assert.equal(C.offsetText(0.04, 0), 'on grid');
assert.equal(C.offsetText(0.4, 0), '+0.40 GHz');
assert.equal(C.offsetText(-12.5, 0.1), '\u221212.50 GHz (+0.10 nm)');

// ---- Parsing: decimal comma, unit words, a suffix that overrides the selector.
assert.deepEqual(plain(C.parseValue('193.1', 'thz')), {value: 193.1, unit: 'thz'});
assert.deepEqual(plain(C.parseValue(' 193,1 THz ', 'nm')), {value: 193.1, unit: 'thz'});
assert.deepEqual(plain(C.parseValue('1552.52 nm', 'thz')), {value: 1552.52, unit: 'nm'});
assert.deepEqual(plain(C.parseValue('1552,52 NM', 'thz')), {value: 1552.52, unit: 'nm'});
assert.deepEqual(plain(C.parseValue('1552.52 nanometres', 'thz')), {value: 1552.52, unit: 'nm'});
assert.deepEqual(plain(C.parseValue('193.1 terahertz', 'nm')), {value: 193.1, unit: 'thz'});
assert.deepEqual(plain(C.parseValue('1552.52', 'nm')), {value: 1552.52, unit: 'nm'});
assert.equal(run('dwdm100', '193.1 thz', 'nm').bigText, '1552.52 nm', 'the suffix wins');

// ---- Formatting helpers.
assert.equal(C.fmtWavelength(1552.524381), '1552.52');
assert.equal(C.fmtFrequency(193.40000000000003), '193.4000');
assert.equal(C.signedFixed(0, 2), '0.00');
assert.equal(C.signedFixed(3, 2), '+3.00');
assert.equal(C.signedFixed(-3.456, 2), '\u22123.46');
assert.equal(C.signedInteger(0), '0');
assert.equal(C.signedInteger(7), '+7');
assert.equal(C.signedInteger(-71), '\u221271');

// ---- Neighbour table: five rows in the middle, clamped at the edges.
const middle = plain(C.neighbours('dwdm100', 3));
assert.equal(middle.length, 5);
assert.deepEqual(middle.map((row) => row.indexText), ['n = +1', 'n = +2', 'n = +3', 'n = +4', 'n = +5']);
assert.deepEqual(middle[2], {indexText: 'n = +3', wavelengthText: '1550.12', frequencyText: '193.4000', selected: true});
assert.equal(middle.filter((row) => row.selected).length, 1);
assert.equal(plain(C.neighbours('dwdm100', -71)).length, 3, 'the range stops the lower neighbours');
assert.equal(plain(C.neighbours('dwdm100', 69)).length, 3, 'the range stops the upper neighbours');
const coarseMiddle = plain(C.neighbours('cwdm', 15));
assert.equal(coarseMiddle.length, 5);
assert.deepEqual(coarseMiddle.map((row) => row.indexText), ['Channel 13', 'Channel 14', 'Channel 15', 'Channel 16', 'Channel 17']);
assert.equal(plain(C.neighbours('cwdm', 1)).length, 3);
assert.equal(plain(C.neighbours('cwdm', 18)).length, 3);
assert.equal(plain(C.neighbours('cwdm', 18))[2].selected, true);
assert.deepEqual(plain(C.neighbours('nope', 1)), []);

// ---- Refusals and their exact wording.
assert.equal(failure('dwdm100', '', 'thz'), 'Enter a frequency in THz or a wavelength in nm.');
assert.equal(failure('dwdm100', 'abc', 'thz'), 'Enter the value as a number, such as 193.1 THz or 1552.52 nm.');
assert.equal(failure('dwdm100', '0', 'thz'), 'Enter a positive frequency or wavelength.');
assert.equal(failure('dwdm100', '-5', 'thz'), 'Enter a positive frequency or wavelength.');
assert.equal(failure('dwdm100', '185.9', 'thz'),
  'DWDM channels run from 186 to 200 THz, which is 1499 to 1612 nm. Enter a frequency or wavelength inside that range.');
assert.equal(failure('dwdm100', '200.1', 'thz'),
  'DWDM channels run from 186 to 200 THz, which is 1499 to 1612 nm. Enter a frequency or wavelength inside that range.');
assert.equal(failure('dwdm100', '1490', 'nm'),
  'DWDM channels run from 186 to 200 THz, which is 1499 to 1612 nm. Enter a frequency or wavelength inside that range.');
assert.equal(failure('cwdm', '1270.9', 'nm'),
  'The CWDM grid runs from 1271 to 1611 nm in 20 nm steps, about 186.1 to 235.9 THz. Enter a wavelength inside that range.');
assert.equal(failure('cwdm', '1611.1', 'nm'),
  'The CWDM grid runs from 1271 to 1611 nm in 20 nm steps, about 186.1 to 235.9 THz. Enter a wavelength inside that range.');
assert.equal(failure('cwdm', '1500', 'thz'),
  'The CWDM grid runs from 1271 to 1611 nm in 20 nm steps, about 186.1 to 235.9 THz. Enter a wavelength inside that range.');
assert.equal(failure('xwdm', '193.1', 'thz'), 'Choose a grid.');
assert.equal(failure('', '193.1', 'thz'), 'Choose a grid.');

// ---- Catalog record.
assert.ok(record, 'catalog record exists');
assert.equal(record.name, 'DWDM & CWDM Channel Calculator');
assert.equal(record.category, 'IT & Networking');
assert.equal(record.subcategory, 'Reference');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(record.added), 'added is a UTC timestamp');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.method.length > 800, 'method explains the arithmetic');
assert.ok(record.tags.includes('dwdm') && record.tags.includes('cwdm') && record.tags.includes('itu'));
assert.ok(record.sources.length >= 3, 'sources are cited');
const urls = record.sources.filter((source) => source.url);
assert.ok(urls.length >= 3, 'three sources carry a URL');
for (const source of urls) assert.ok(/^https:\/\//.test(source.url), 'source URL is https');
assert.equal(record.sources.filter((source) => /itu\.int\/rec\/T-REC-G\.694\.1/.test(source.url || '')).length, 1);
assert.equal(record.sources.filter((source) => /itu\.int\/rec\/T-REC-G\.694\.2/.test(source.url || '')).length, 1);
assert.equal(record.sources.filter((source) => /lfiber\.com\//.test(source.url || '')).length, 1);

// ---- Replay every catalog case against the core.
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 21, 'catalog case count');
assert.equal(kinds('golden'), 9, 'nine golden cases');
assert.equal(kinds('boundary'), 3, 'three boundary cases');
assert.equal(kinds('validation'), 9, 'nine validation cases');
for (const testCase of record.testCases) {
  const { grid, value, unit } = testCase.input;
  if (testCase.expectedError) {
    assert.equal(failure(grid, value, unit), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(grid, value, unit);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], expected, testCase.name + ': ' + key);
  }
}

// ---- No duplicate: slug, name and aliases are unique across the catalog.
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1);
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1, 'name is unique');
const aliasOwners = new Map();
for (const tool of catalog.tools) {
  for (const alias of tool.aliases || []) {
    const key = alias.toLowerCase();
    if (!aliasOwners.has(key)) aliasOwners.set(key, []);
    aliasOwners.get(key).push(tool.slug);
  }
}
for (const alias of record.aliases) {
  assert.deepEqual([...new Set(aliasOwners.get(alias.toLowerCase()))], [slug], 'alias is unique: ' + alias);
}
assert.equal(catalog.tools.filter((tool) => /dwdm|cwdm/.test(tool.slug)).length, 1, 'no other dense or coarse grid tool');
assert.equal(catalog.tools.filter((tool) => /\bDWDM\b|\bCWDM\b/i.test(tool.name)).length, 1, 'no other dense or coarse grid name');
assert.equal(catalog.tools.filter((tool) => /ITU (wavelength|frequency) grid/i.test(tool.name)).length, 0);

// ---- Page contract.
assert.ok(html.includes('<html lang="en">'));
assert.ok(/<title>DWDM &amp; CWDM Channel Calculator &mdash; Virtual Tools<\/title>/.test(html));
assert.ok(/<meta name="description" content="[^"]{80,}">/.test(html));
assert.ok(html.includes('<script src="/assets/theme-init.js"></script>'));
assert.ok(html.includes('<link rel="stylesheet" href="/assets/style.css">'));
assert.ok(html.includes('<script src="/assets/app.js"></script>'));
assert.ok(html.includes('<div id="site-header"></div>'));
assert.ok(/<h1>DWDM &amp; CWDM Channel Calculator<\/h1>/.test(html));
assert.ok(/<label for="grid">Grid<\/label>/.test(html));
assert.ok(/<label for="value">Frequency or wavelength<\/label>/.test(html));
assert.ok(/<label for="unit">Unit<\/label>/.test(html));
assert.ok(/<button type="submit">Find channel<\/button>/.test(html));
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('@media (max-width:560px)'));
assert.ok(html.includes('autocomplete="off"'));
assert.ok(!/https?:\/\//.test(html), 'the page fetches nothing from the network');
assert.ok(!/\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), 'no fetch or storage');
assert.ok(/Everything runs in your browser/.test(html));
