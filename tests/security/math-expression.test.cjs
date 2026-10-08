"use strict";

require("../../frontend/assets/math-expression.js");

const compile = globalThis.VTMathExpression.compile;
let assertions = 0;

function equal(expression, expected, scope, variables) {
  const actual = compile(expression, variables)(scope || Object.create(null));
  if (Math.abs(actual - expected) > 1e-12) {
    throw new Error(`${expression}: expected ${expected}, received ${actual}`);
  }
  assertions++;
}

function rejects(expression, variables) {
  let rejected = false;
  try { compile(expression, variables); }
  catch (_) { rejected = true; }
  if (!rejected) throw new Error(`Expected rejection: ${expression.slice(0, 80)}`);
  assertions++;
}

equal("2 + 3 * 4", 14);
equal("(2 + 3) * 4", 20);
equal("2^3^2", 512);
equal("-2^2", -4);
equal("2^-3", 0.125);
equal("1.25e2 + 5", 130);
equal("Math.sin(pi / 2) + max(2, 5, 3)", 6);
equal("pow(x, 2) + sqrt(abs(x))", 4 + Math.sqrt(2), { x: -2 }, ["x"]);

rejects("unknown + 1", ["x"]);
rejects("x.constructor.constructor('return 1')()", ["x"]);
rejects("globalThis.fetch('/api')", ["x"]);
rejects("document.cookie", ["x"]);
rejects("1; window.alert(1)", ["x"]);
rejects("1e999");
rejects("1".repeat(501));
rejects(Array(130).fill("1").join("+"));
rejects("min(" + Array(17).fill("1").join(",") + ")");
rejects("x", ["not-valid!"]);

console.log(`Math expression security tests passed (${assertions} assertions).`);
