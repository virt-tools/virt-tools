(function (root) {
  "use strict";

  var FUNCTIONS = Object.freeze({
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2,
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
    sign: Math.sign, min: Math.min, max: Math.max, pow: Math.pow, hypot: Math.hypot
  });
  var CONSTANTS = Object.freeze({ pi: Math.PI, PI: Math.PI, e: Math.E, E: Math.E, tau: 2 * Math.PI });
  var IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
  var TOKEN = /((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([+\-*/%^(),])/y;
  var owns = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };

  function compile(source, variableNames) {
    if (typeof source !== "string" || !source.trim()) throw new Error("Enter an expression.");
    if (source.length > 500) throw new Error("Expression is too long (500 character limit).");
    source = source.replace(/\bMath\s*\./g, "").replace(/\*\*/g, "^");

    var allowed = new Set(variableNames || []);
    allowed.forEach(function (name) {
      if (!IDENTIFIER.test(name)) throw new Error("Invalid variable name '" + name + "'.");
    });

    var tokens = [], position = 0;
    while (position < source.length) {
      if (/\s/.test(source[position])) { position++; continue; }
      TOKEN.lastIndex = position;
      var match = TOKEN.exec(source);
      if (!match) throw new Error("Unexpected character '" + source[position] + "'.");
      position = TOKEN.lastIndex;
      var value = match[1] !== undefined ? Number(match[1]) : match[2] || match[3];
      if (match[1] !== undefined && !Number.isFinite(value)) throw new Error("Numeric literal is outside the finite range.");
      tokens.push({ kind: match[1] ? "number" : match[2] ? "name" : "symbol", value: value });
      if (tokens.length > 256) throw new Error("Expression has too many tokens (256 token limit).");
    }

    var at = 0;
    function peek(value) { return tokens[at] && tokens[at].value === value; }
    function take(value) { if (!peek(value)) throw new Error("Expected '" + value + "'."); at++; }
    function sum() {
      var node = product();
      while (peek("+") || peek("-")) { var operator = tokens[at++].value; node = { op: operator, left: node, right: product() }; }
      return node;
    }
    function product() {
      var node = unary();
      while (peek("*") || peek("/") || peek("%")) { var operator = tokens[at++].value; node = { op: operator, left: node, right: unary() }; }
      return node;
    }
    function unary() {
      if (peek("+") || peek("-")) return { op: "u" + tokens[at++].value, value: unary() };
      return power();
    }
    function power() {
      var node = primary();
      if (peek("^")) { at++; node = { op: "^", left: node, right: unary() }; }
      return node;
    }
    function primary() {
      var token = tokens[at++];
      if (!token) throw new Error("Unexpected end of expression.");
      if (token.kind === "number") return { number: token.value };
      if (token.value === "(") { var grouped = sum(); take(")"); return grouped; }
      if (token.kind !== "name") throw new Error("Unexpected token '" + token.value + "'.");
      if (peek("(")) {
        at++;
        var args = [];
        if (!peek(")")) {
          while (true) {
            if (args.length >= 16) throw new Error("Function calls are limited to 16 arguments.");
            args.push(sum());
            if (!peek(",")) break;
            at++;
          }
        }
        take(")");
        if (!owns(FUNCTIONS, token.value)) throw new Error("Unknown function '" + token.value + "'.");
        return { call: token.value, args: args };
      }
      if (allowed.has(token.value)) return { name: token.value };
      if (owns(CONSTANTS, token.value)) return { constant: token.value };
      throw new Error("Unknown identifier '" + token.value + "'.");
    }

    var ast = sum();
    if (at !== tokens.length) throw new Error("Unexpected token '" + tokens[at].value + "'.");

    function evaluate(node, scope) {
      if (owns(node, "number")) return node.number;
      if (node.name !== undefined) return Number(scope[node.name]);
      if (node.constant !== undefined) return CONSTANTS[node.constant];
      if (node.call !== undefined) return FUNCTIONS[node.call].apply(null, node.args.map(function (arg) { return evaluate(arg, scope); }));
      if (node.op === "u+") return evaluate(node.value, scope);
      if (node.op === "u-") return -evaluate(node.value, scope);
      var left = evaluate(node.left, scope), right = evaluate(node.right, scope);
      if (node.op === "+") return left + right;
      if (node.op === "-") return left - right;
      if (node.op === "*") return left * right;
      if (node.op === "/") return left / right;
      if (node.op === "%") return left % right;
      return Math.pow(left, right);
    }

    return function (scope) { return evaluate(ast, scope || Object.create(null)); };
  }

  root.VTMathExpression = Object.freeze({ compile: compile });
})(typeof window === "object" ? window : globalThis);
