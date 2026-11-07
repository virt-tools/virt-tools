/* Regression checks for the deterministic rhythm-reading exercise core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/rhythm-reading-exercise/index.html'), 'utf8');
const startMarker = '/* rhythm-reading-core:start */';
const endMarker = '/* rhythm-reading-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'rhythm-reading core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = RhythmReadingCore;', sandbox);
const C = sandbox.module.exports;

const standard = C.generate({});
assert.equal(standard.meter, '4/4');
assert.equal(standard.capacity, 16);
assert.equal(standard.measureCount, 2);
assert.equal(standard.eventCount, 12);
assert.equal(standard.restCount, 0);
assert.equal(standard.sequence, 'quarter note eighth note eighth note quarter note eighth note eighth note | eighth note quarter note eighth note quarter note eighth note eighth note');
assert.equal(C.generate({}).sequence, standard.sequence, 'defaults must be repeatable');
assert.equal(C.generate({seed: ' steady-beat '}).sequence, standard.sequence, 'seed is trimmed');
assert.notEqual(C.generate({seed: 'another-seed'}).sequence, standard.sequence);
assert.match(C.answerKey(standard), /Rhythm-reading exercise — 4\/4/);
assert.match(C.answerKey(standard), /Measure 1: quarter note \(1\), eighth note \(2\), eighth note \(&\)/);
assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(C.countAt), ['1', 'e', '&', 'a', '2', 'e', '&', 'a']);

// Independent accounting across every meter, level, rest mode and measure bound.
const capacities = {'4/4': 16, '3/4': 12, '2/4': 8};
const allowed = {
  'quarter-eighth': [4, 2],
  'half-notes': [8, 4, 2],
  'sixteenth-notes': [8, 4, 2, 1]
};
let enumerated = 0;
let eventsChecked = 0;
const sequences = new Set();
for (const meter of Object.keys(capacities)) {
  for (const level of Object.keys(allowed)) {
    for (const includeRests of [false, true]) {
      for (let measures = 1; measures <= 8; measures += 1) {
        for (let variant = 0; variant < 12; variant += 1) {
          const input = {meter, level, includeRests, measures: String(measures), seed: `case-${variant}`};
          const result = C.generate(input);
          assert.equal(result.capacity, capacities[meter]);
          assert.equal(result.numerator, Number(meter[0]));
          assert.equal(result.denominator, 4);
          assert.equal(result.measureCount, measures);
          assert.equal(result.bars.length, measures);
          assert.equal(result.events.length, result.eventCount);
          assert.equal(C.generate(input).sequence, result.sequence, 'same input must reproduce the rhythm');
          let eventIndex = 0;
          result.bars.forEach((bar, barIndex) => {
            let position = 0;
            bar.forEach((event) => {
              assert.ok(allowed[level].includes(event.units), `${level} produced ${event.units} units`);
              assert.equal(event.start, position, 'event onset must follow preceding durations');
              assert.equal(event.measure, barIndex + 1);
              assert.equal(event.count, C.countAt(position));
              assert.equal(event.kind, includeRests && event.kind === 'rest' ? 'rest' : 'note');
              assert.ok(event.name.startsWith({8: 'half', 4: 'quarter', 2: 'eighth', 1: 'sixteenth'}[event.units]));
              if (event.kind === 'rest') assert.ok(event.units <= 4, 'half rests are outside the supported scope');
              if (event.units === 8) assert.equal(position % 4, 0, 'half notes begin on a quarter-note beat');
              position += event.units;
              eventIndex += 1;
              eventsChecked += 1;
            });
            assert.equal(position, capacities[meter], 'every measure must fill exactly');
            assert.equal(result.events[eventIndex - 1], bar[bar.length - 1], 'flat and barred event views share data');
          });
          assert.equal(eventIndex, result.eventCount);
          const restCount = result.events.filter((event) => event.kind === 'rest').length;
          assert.equal(result.restCount, restCount);
          if (includeRests) assert.ok(restCount > 0, 'rest mode must include at least one rest');
          else assert.equal(restCount, 0);
          const independentSequence = result.bars.map((bar) => bar.map((event) => event.name).join(' ')).join(' | ');
          assert.equal(result.sequence, independentSequence);
          sequences.add(`${meter}|${level}|${includeRests}|${measures}|${result.sequence}`);
          assert.ok(C.answerKey(result).includes(`Seed: case-${variant}`));
          enumerated += 1;
        }
      }
    }
  }
}
assert.equal(enumerated, 1728);
assert.ok(sequences.size > 1000, 'seeds and settings must produce varied exercises');

// Strict validation, including object-prototype keys and numeric notation.
for (const meter of ['6/8', '', null, '__proto__', 'constructor']) {
  if (meter === null) continue; // null selects the documented default.
  assert.throws(() => C.generate({meter}), /Choose 2\/4, 3\/4 or 4\/4 time\./);
}
for (const level of ['dotted', '', '__proto__', 'constructor']) {
  assert.throws(() => C.generate({level}), /Choose a supported note-value set\./);
}
for (const value of [null, '', '   ']) {
  if (value === null) continue; // null selects the documented default of two measures.
  assert.throws(() => C.generate({measures: value}), /Measures is required\./);
}
for (const value of [0, -1, 1.2, '1.0', '1e2', '+4', '4 bars', 'NaN', Infinity, 9, '9007199254740992']) {
  assert.throws(() => C.generate({measures: value}), /must be a whole number from 1 to 8\./);
}
for (const seed of ['', '   ']) assert.throws(() => C.generate({seed}), /Seed is required\./);
assert.throws(() => C.generate({seed: 'x'.repeat(49)}), /48 characters or fewer/);
for (const includeRests of ['yes', 1, 0, null]) {
  if (includeRests === null) continue; // null selects the default false.
  assert.throws(() => C.generate({includeRests}), /must be true or false/);
}

// Replay every canonical catalog case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'rhythm-reading-exercise');
assert.equal(records.length, 1, 'catalog must contain exactly one rhythm-reading exercise');
const record = records[0];
assert.equal(record.name, 'Rhythm Reading Exercise Generator');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Practice');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('Rhythm Reading Practice'));
assert.ok(record.testCases.length >= 16, 'catalog carries golden and validation checks');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.generate(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  assert.equal(testCase.kind, 'golden', testCase.name);
  const result = C.generate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) assert.equal(result[key], expected, `${testCase.name}: ${key}`);
}

console.log(`rhythm-reading-exercise: all checks passed (${record.testCases.length} catalog cases, ${enumerated} exercises and ${eventsChecked} events)`);
