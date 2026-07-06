// Safe expression parser/evaluator for the Function Plotter.
// Grammar (recursive descent):
//   expr   := term (('+'|'-') term)*
//   term   := unary (('*'|'/') unary)*
//   unary  := ('-'|'+') unary | factor          // unary binds looser than ^
//   factor := primary ('^' factor)?             // right-associative, tighter than unary
//   primary:= NUMBER | NAME ('(' expr ')')? | '(' expr ')'
// NAME resolves to: a function (if followed by '('), a constant (pi, e), or the variable x.
// Exposes window.Expr.compile(s) -> function(x). Throws Error on bad syntax or unknown names.

(function () {
  var FUNCTIONS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    sqrt: Math.sqrt, cbrt: Math.cbrt, exp: Math.exp,
    ln: Math.log, log: Math.log10, log2: Math.log2, log10: Math.log10,
    abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
    sign: Math.sign
  };
  var CONSTANTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

  function tokenize(s) {
    var tokens = [];
    var i = 0, n = s.length;
    while (i < n) {
      var ch = s[i];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i++; continue; }
      if ("+-*/^(),".indexOf(ch) >= 0) { tokens.push({ t: "op", v: ch }); i++; continue; }
      if ((ch >= "0" && ch <= "9") || ch === ".") {
        var j = i;
        while (j < n && ((s[j] >= "0" && s[j] <= "9") || s[j] === ".")) j++;
        // optional exponent
        if (j < n && (s[j] === "e" || s[j] === "E")) {
          j++;
          if (j < n && (s[j] === "+" || s[j] === "-")) j++;
          while (j < n && s[j] >= "0" && s[j] <= "9") j++;
        }
        var numStr = s.slice(i, j);
        var num = parseFloat(numStr);
        if (!isFinite(num)) throw new Error("bad number '" + numStr + "'");
        tokens.push({ t: "num", v: num });
        i = j;
        continue;
      }
      if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
        var k = i;
        while (k < n && ((s[k] >= "a" && s[k] <= "z") || (s[k] >= "A" && s[k] <= "Z") || (s[k] >= "0" && s[k] <= "9") || s[k] === "_")) k++;
        tokens.push({ t: "name", v: s.slice(i, k) });
        i = k;
        continue;
      }
      throw new Error("unexpected character '" + ch + "'");
    }
    tokens.push({ t: "eof" });
    return tokens;
  }

  function Parser(tokens) {
    this.toks = tokens;
    this.pos = 0;
  }
  Parser.prototype.peek = function () { return this.toks[this.pos]; };
  Parser.prototype.next = function () { return this.toks[this.pos++]; };
  Parser.prototype.expect = function (op) {
    var tk = this.peek();
    if (tk.t === "op" && tk.v === op) { this.pos++; return; }
    throw new Error("expected '" + op + "'");
  };

  // Compile each node into a closure (x) => number for speed during sampling.
  Parser.prototype.parseExpr = function () {
    var node = this.parseTerm();
    while (true) {
      var tk = this.peek();
      if (tk.t === "op" && (tk.v === "+" || tk.v === "-")) {
        this.next();
        var rhs = this.parseTerm();
        var op = tk.v;
        var a = node;
        node = (function (a, b, op) {
          return function (x) { return op === "+" ? a(x) + b(x) : a(x) - b(x); };
        })(a, rhs, op);
      } else break;
    }
    return node;
  };

  Parser.prototype.parseTerm = function () {
    var node = this.parseUnary();
    while (true) {
      var tk = this.peek();
      if (tk.t === "op" && (tk.v === "*" || tk.v === "/")) {
        this.next();
        var rhs = this.parseUnary();
        var op = tk.v;
        var a = node;
        node = (function (a, b, op) {
          return function (x) { return op === "*" ? a(x) * b(x) : a(x) / b(x); };
        })(a, rhs, op);
      } else break;
    }
    return node;
  };

  Parser.prototype.parseUnary = function () {
    var tk = this.peek();
    if (tk.t === "op" && (tk.v === "-" || tk.v === "+")) {
      this.next();
      var inner = this.parseUnary();
      if (tk.v === "-") return (function (a) { return function (x) { return -a(x); }; })(inner);
      return inner;
    }
    return this.parseFactor();
  };

  Parser.prototype.parseFactor = function () {
    // base (primary) then optional '^' with a unary exponent (right-associative).
    var base = this.parsePrimary();
    var tk = this.peek();
    if (tk.t === "op" && tk.v === "^") {
      this.next();
      var exp = this.parseUnary(); // unary so 2^-3 works; right-assoc via unary->factor
      var a = base;
      return (function (a, b) { return function (x) { return Math.pow(a(x), b(x)); }; })(a, exp);
    }
    return base;
  };

  Parser.prototype.parsePrimary = function () {
    var tk = this.next();
    if (tk.t === "num") { var v = tk.v; return function () { return v; }; }
    if (tk.t === "op" && tk.v === "(") {
      var inner = this.parseExpr();
      this.expect(")");
      return inner;
    }
    if (tk.t === "name") {
      var name = tk.v;
      var nxt = this.peek();
      if (nxt.t === "op" && nxt.v === "(") {
        // function call
        if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, name)) throw new Error("unknown function '" + name + "'");
        this.next(); // consume '('
        var arg = this.parseExpr();
        this.expect(")");
        var fn = FUNCTIONS[name];
        return (function (fn, arg) { return function (x) { return fn(arg(x)); }; })(fn, arg);
      }
      // constant or variable
      if (name === "x") return function (x) { return x; };
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) { var c = CONSTANTS[name]; return function () { return c; }; }
      throw new Error("unknown variable '" + name + "' (only x is allowed)");
    }
    if (tk.t === "eof") throw new Error("unexpected end of expression");
    throw new Error("unexpected token");
  };

  function compile(s) {
    if (typeof s !== "string" || s.trim() === "") throw new Error("empty expression");
    var tokens = tokenize(s);
    var p = new Parser(tokens);
    var node = p.parseExpr();
    if (p.peek().t !== "eof") throw new Error("unexpected trailing input near '" + p.peek().v + "'");
    return node;
  }

  window.Expr = { compile: compile };
})();