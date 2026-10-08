#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";


const root = path.resolve(process.argv[2] || ".");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "formula-workbenches.json"), "utf8"),
);
let formulaCount = 0;
let goldenCount = 0;

function closeEnough(actual, expected) {
  return Math.abs(actual - expected) <=
    Math.max(1e-9, Math.abs(expected) * 1e-9);
}

for (const workbench of manifest.workbenches) {
  const filename = path.join(
    root,
    "frontend",
    "assets",
    "formula-workbenches",
    `${workbench.slug}.js`,
  );
  const source = fs.readFileSync(filename, "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename, timeout: 1_000 });
  const functions = sandbox.window.VT_FORMULA_FUNCTIONS;
  assert.ok(functions && typeof functions === "object", `${workbench.slug}: functions missing`);
  assert.equal(Object.isFrozen(functions), true, `${workbench.slug}: function registry is mutable`);
  assert.equal(sandbox.safeCeil, undefined, `${workbench.slug}: helper leaked globally`);

  const expectedSlugs = workbench.formulas.map((formula) => formula.slug).sort();
  assert.deepEqual(Object.keys(functions).sort(), expectedSlugs, `${workbench.slug}: function coverage drift`);

  for (const formula of workbench.formulas) {
    formulaCount += 1;
    const calculate = functions[formula.slug];
    const example = Object.fromEntries(
      formula.fields.map((field) => [field.id, field.example]),
    );
    const exampleOutput = calculate(example);
    assert.equal(exampleOutput.length, formula.outputs.length, `${formula.slug}: example output count`);
    assert.ok(exampleOutput.every(Number.isFinite), `${formula.slug}: non-finite JS example output`);

    for (const test of formula.tests) {
      goldenCount += 1;
      const actual = calculate(test.input);
      assert.equal(actual.length, test.expected.length, `${formula.slug}/${test.name}: output count`);
      actual.forEach((value, index) => {
        assert.ok(Number.isFinite(value), `${formula.slug}/${test.name}: output ${index} is non-finite`);
        assert.ok(
          closeEnough(value, test.expected[index]),
          `${formula.slug}/${test.name}: output ${index}: ${value} != ${test.expected[index]}`,
        );
      });
    }
  }

  if (workbench.slug === "construction-materials-workbench") {
    const ceilThroughFormula = functions["concrete-bag-count"];
    const vectors = [
      [1e-20, 1],
      [1.0000000000000002, 1],
      [1.00000000000001, 2],
      [699.9999999999999, 700],
    ];
    for (const [value, expected] of vectors) {
      assert.equal(
        ceilThroughFormula({ vol: value, y: 1 })[0],
        expected,
        `safeCeil JS parity failed for ${value}`,
      );
    }
  }
}

assert.equal(formulaCount, 160, "retained formula count drift");
assert.ok(goldenCount >= 9, "each workbench family needs golden coverage");
console.log(
  `Executed ${formulaCount} generated formula functions and ${goldenCount} golden vectors in isolated VM contexts`,
);
