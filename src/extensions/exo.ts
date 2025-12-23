/**
 * Exo Extension
 *
 * A JS-like language layer built directly on core.ts.
 * Adds: operators, statements, blocks, assignment, type annotations.
 */
import { Expr, Name, Span, SpanExpr } from "../ast";
import { CoreCompileOps } from "../compile";
import { CoreInterpretOps } from "../interpret";
import { ir, IR } from "../ir";
import { CoreParseOps, ParseResult, Parser } from "../parse";
import { Extension } from "../types";

interface BinaryExpr extends SpanExpr {
  type: "BinaryExpr";
  op: string;
  left: EExpr;
  right: EExpr;
}

interface PrefixExpr extends SpanExpr {
  type: "PrefixExpr";
  op: string;
  operand: EExpr;
}

interface BlockExpr extends SpanExpr {
  type: "BlockExpr";
  stmts: EExpr[];
}

interface LetStmtExpr extends SpanExpr {
  type: "LetStmtExpr";
  name: Name;
  annotation: EExpr | null;
  value: EExpr;
}

interface AssignExpr extends SpanExpr {
  type: "AssignExpr";
  name: Name;
  value: EExpr;
}

interface VoidExpr extends SpanExpr {
  type: "VoidExpr";
}

interface OperatorDeclExpr extends SpanExpr {
  type: "OperatorDeclExpr";
  op: string;
  kind: "prefix" | "postfix" | "infix";
  prec: number;
  assoc?: "left" | "right";
}

interface ImportExpr extends SpanExpr {
  type: "ImportExpr";
  name: Name;
  path: string;
}

/**
 * Extended AST for Exo
 *
 * Note that this is not technically correct as what we'd *like*
 * is for all nested instances of `Expr` within `EExpr` (including
 * those in `Expr` itself) to also be `EExpr`. However, this is difficult to
 * express in TypeScript, so we settle for this simpler definition and then
 * cast in the implementation when necessary.
 */
type EExpr =
  | Expr
  | BinaryExpr
  | PrefixExpr
  | PostfixExpr
  | BlockExpr
  | LetStmtExpr
  | AssignExpr
  | VoidExpr
  | OperatorDeclExpr
  | ImportExpr;

interface BinaryOpDef {
  prec: number;
  assoc: "left" | "right" | "none";
  method?: string;
  prim?: string;
}

interface UnaryOpDef {
  prec: number;
  method: string;
}

const operators = {
  binary: {
    "||": { prec: 1, assoc: "left", method: "op||" },
    "&&": { prec: 2, assoc: "left", method: "op&&" },
    "===": { prec: 3, assoc: "left", prim: "strictEq" },
    "!==": { prec: 3, assoc: "left", prim: "strictNeq" },
    "==": { prec: 3, assoc: "left", method: "op==" },
    "!=": { prec: 3, assoc: "left", method: "op!=" },
    "<": { prec: 4, assoc: "left", method: "op<" },
    ">": { prec: 4, assoc: "left", method: "op>" },
    "<=": { prec: 4, assoc: "left", method: "op<=" },
    ">=": { prec: 4, assoc: "left", method: "op>=" },
    "+": { prec: 5, assoc: "left", method: "op+" },
    "-": { prec: 5, assoc: "left", method: "op-" },
    "*": { prec: 6, assoc: "left", method: "op*" },
    "/": { prec: 6, assoc: "left", method: "op/" },
    "%": { prec: 6, assoc: "left", method: "op%" },
  } as Record<string, BinaryOpDef>,
  prefix: {
    "!": { prec: 7, method: "op!" },
    "-": { prec: 7, method: "opNeg" },
  } as Record<string, UnaryOpDef>,
  postfix: {
    "!": { prec: 8, method: "call" },  // foo! is same as foo()
  } as Record<string, UnaryOpDef>
};

interface PostfixExpr extends SpanExpr {
  type: "PostfixExpr";
  op: string;
  operand: EExpr;
}

interface ExoParseOps extends CoreParseOps {
  operators: typeof operators;

  // Operators
  binaryOp: () => Parser<{ op: string; start: number }>;
  prefixOp: () => Parser<{ op: string; start: number }>;
  postfixOp: () => Parser<{ op: string; start: number }>;
  binaryExpr: (minPrec: number) => Parser<EExpr>;
  prefixExpr: () => Parser<EExpr>;
  postfixExpr: () => Parser<EExpr>;

  // Statements
  statement: () => Parser<EExpr>;
  statements: (isEnd: (pos: number) => ParseResult<unknown>) => (pos: number, acc: EExpr[]) => ParseResult<EExpr[]>;
  stmtsToExpr: (stmts: EExpr[]) => EExpr;
  letStmt: () => Parser<LetStmtExpr>;

  // Blocks
  block: () => Parser<EExpr>;

  // Assignment
  varAssign: () => Parser<EExpr>;

  // Operator declarations
  operatorDecl: () => Parser<OperatorDeclExpr>;

  // Import declarations
  importDecl: () => Parser<ImportExpr>;
}

const build$parse = (in$: CoreParseOps): void => {
  const $ = in$ as unknown as ExoParseOps;

  $.operators = operators;

  // ---------------------------------------------------------------------------
  // Operator Parsing
  // ---------------------------------------------------------------------------

  // Try to parse an N-char binary operator
  const tryBinaryN = (input: string, p: number, n: number): ParseResult<{ op: string; start: number }> => {
    const chars = input.slice(p, p + n);
    const def = $.operators.binary[chars];
    if (def) {
      return { ok: true, value: { op: chars, start: p }, pos: p + n };
    }
    return { ok: false, expected: "binary operator", pos: p };
  };

  $.binaryOp = () => (input, pos) => {
    const ws = $.ws()(input, pos);
    const p = ws.pos;
    // Try 3-char, then 2-char, then 1-char
    const r3 = tryBinaryN(input, p, 3);
    if (r3.ok) return r3;
    const r2 = tryBinaryN(input, p, 2);
    if (r2.ok) return r2;
    return tryBinaryN(input, p, 1);
  };

  $.prefixOp = () => (input, pos) => {
    const ws = $.ws()(input, pos);
    const p = ws.pos;
    const ch = input[p];
    if ($.operators.prefix[ch]) {
      return { ok: true, value: { op: ch, start: p }, pos: p + 1 };
    }
    return { ok: false, expected: "prefix operator", pos: p };
  };

  $.postfixOp = () => (input, pos) => {
    const ws = $.ws()(input, pos);
    const p = ws.pos;
    const ch = input[p];
    if ($.operators.postfix[ch]) {
      // Don't match ! if followed by = (that's != or !==)
      if (ch === "!" && input[p + 1] === "=") {
        return { ok: false, expected: "postfix operator", pos: p };
      }
      return { ok: true, value: { op: ch, start: p }, pos: p + 1 };
    }
    return { ok: false, expected: "postfix operator", pos: p };
  };

  // Pratt parser: unified handling of prefix, postfix, and binary operators
  const baseAppExpr = $.appExpr;

  // Unified Pratt parser
  $.binaryExpr = (minPrec: number) => (input, pos) => {
    let left: ParseResult<EExpr>;

    // 1. Try prefix operator
    const prefix = $.prefixOp()(input, pos);
    if (prefix.ok) {
      const opDef = $.operators.prefix[prefix.value.op];
      const operand = $.binaryExpr(opDef.prec)(input, prefix.pos);
      if (!operand.ok) return operand;
      left = {
        ok: true,
        value: { type: "PrefixExpr", op: prefix.value.op, operand: operand.value } as PrefixExpr,
        pos: operand.pos,
      };
    } else {
      // 2. No prefix - parse atom (baseAppExpr handles (), ., [])
      const base = baseAppExpr()(input, pos);
      if (!base.ok) return base as ParseResult<EExpr>;
      left = { ok: true, value: base.value, pos: base.pos };
    }

    // 3. Loop: binary and postfix operators
    while (true) {
      // Try binary operator
      const binOp = $.binaryOp()(input, left.pos);
      if (binOp.ok) {
        const opDef = $.operators.binary[binOp.value.op];
        if (opDef && opDef.prec >= minPrec) {
          // For non-associative, use prec + 1 (like left) to prevent same-precedence chaining
          const nextPrec = opDef.assoc === "right" ? opDef.prec : opDef.prec + 1;
          const right = $.binaryExpr(nextPrec)(input, binOp.pos);
          if (!right.ok) return right;
          left = {
            ok: true,
            value: { type: "BinaryExpr", op: binOp.value.op, left: left.value, right: right.value } as BinaryExpr,
            pos: right.pos,
          };
          // For non-associative operators, check if the same operator appears again
          if (opDef.assoc === "none") {
            const nextOp = $.binaryOp()(input, left.pos);
            if (nextOp.ok && nextOp.value.op === binOp.value.op) {
              return { ok: false, expected: `operator '${binOp.value.op}' is non-associative`, pos: nextOp.value.start };
            }
          }
          continue;
        }
      }

      // Try postfix operator
      const postfix = $.postfixOp()(input, left.pos);
      if (postfix.ok) {
        const opDef = $.operators.postfix[postfix.value.op];
        if (opDef.prec >= minPrec) {
          left = {
            ok: true,
            value: { type: "PostfixExpr", op: postfix.value.op, operand: left.value } as PostfixExpr,
            pos: postfix.pos,
          };
          continue;
        }
      }

      break;
    }

    return left;
  };

  // Keep prefixExpr and postfixExpr as aliases for compatibility
  $.prefixExpr = () => $.binaryExpr(0);
  $.postfixExpr = () => $.binaryExpr(0);

  $.varAssign = () => (input, pos) => {
    const result = $.binaryExpr(0)(input, pos);
    if (!result.ok) return result;

    // Check if it's an identifier followed by =
    if (result.value.type === "IdentifierExpr") {
      const ws = $.ws()(input, result.pos);
      const ch1 = input[ws.pos];
      const ch2 = input[ws.pos + 1];
      if (ch1 === "=" && ch2 !== "=") {
        const rhs = $.expr()(input, ws.pos + 1);
        if (!rhs.ok) return rhs;
        return {
          ok: true,
          value: {
            type: "AssignExpr",
            name: { name: result.value.name, loc: result.value.loc },
            value: rhs.value,
          },
          pos: rhs.pos,
        };
      }
    }
    return result;
  };

  // Override appExpr to use operators
  $.appExpr = (() => $.varAssign()) as unknown as typeof $.appExpr;

  $.letStmt = () => (input, pos) => {
    const kw = $.letKeyword()(input, pos);
    if (!kw.ok) return { ok: false, expected: "let", pos };

    const binding = $.letBinding()(input, kw.pos);
    if (!binding.ok) return { ok: false, expected: "identifier", pos: kw.pos };

    // Optional type annotation: `: expr`
    let annotation: EExpr | null = null;
    let afterAnnotation = binding.pos;
    const ws1 = $.ws()(input, binding.pos);
    if (input[ws1.pos] === ":") {
      const typeExpr = $.atom()(input, ws1.pos + 1);
      if (!typeExpr.ok) return { ok: false, expected: "type expression", pos: ws1.pos + 1 };
      annotation = typeExpr.value;
      afterAnnotation = typeExpr.pos;
    }

    const init = $.letInitializer()(input, afterAnnotation);
    if (!init.ok) return init;

    return {
      ok: true,
      value: {
        type: "LetStmtExpr",
        name: binding.value,
        annotation,
        value: init.value as EExpr,
      } as LetStmtExpr,
      pos: init.pos,
    };
  };

  // Disable let...in expression syntax
  $.letExpr = () => () => ({ ok: false, expected: "expression", pos: 0 });

  // Compute default precedence (one higher than current max)
  const getDefaultPrec = (): number => {
    let max = 0;
    for (const op in $.operators.binary) max = Math.max(max, $.operators.binary[op].prec);
    for (const op in $.operators.prefix) max = Math.max(max, $.operators.prefix[op].prec);
    for (const op in $.operators.postfix) max = Math.max(max, $.operators.postfix[op].prec);
    return max + 1;
  };

  // Operator declarations: operator <op> prefix|postfix|infix [<prec>] [left|right];
  $.operatorDecl = () => (input, pos) => {
    const ws = $.ws()(input, pos);
    const p = ws.pos;

    // Check for "operator" keyword
    if (input.slice(p, p + 8) !== "operator" || /\w/.test(input[p + 8] || "")) {
      return { ok: false, expected: "operator", pos: p };
    }
    let cur = p + 8;

    // Parse the operator symbol (one or more operator characters)
    const ws1 = $.ws()(input, cur);
    cur = ws1.pos;
    const opChars = /^[!@#$%^&*\-+=<>?/|~:]+/.exec(input.slice(cur));
    if (!opChars) {
      return { ok: false, expected: "operator symbol", pos: cur };
    }
    const op = opChars[0];
    cur += op.length;

    // Parse the kind: prefix, postfix, or infix
    const ws2 = $.ws()(input, cur);
    cur = ws2.pos;
    let kind: "prefix" | "postfix" | "infix";
    if (input.slice(cur, cur + 6) === "prefix" && !/\w/.test(input[cur + 6] || "")) {
      kind = "prefix";
      cur += 6;
    } else if (input.slice(cur, cur + 7) === "postfix" && !/\w/.test(input[cur + 7] || "")) {
      kind = "postfix";
      cur += 7;
    } else if (input.slice(cur, cur + 5) === "infix" && !/\w/.test(input[cur + 5] || "")) {
      kind = "infix";
      cur += 5;
    } else {
      return { ok: false, expected: "prefix, postfix, or infix", pos: cur };
    }

    // Optionally parse the precedence (a number)
    const ws3 = $.ws()(input, cur);
    let prec: number;
    const precMatch = /^\d+/.exec(input.slice(ws3.pos));
    if (precMatch) {
      prec = parseInt(precMatch[0], 10);
      cur = ws3.pos + precMatch[0].length;
    } else {
      prec = getDefaultPrec();
    }

    // For infix, optionally parse associativity (left or right, no default)
    let assoc: "left" | "right" | undefined;
    if (kind === "infix") {
      const ws4 = $.ws()(input, cur);
      if (input.slice(ws4.pos, ws4.pos + 4) === "left" && !/\w/.test(input[ws4.pos + 4] || "")) {
        assoc = "left";
        cur = ws4.pos + 4;
      } else if (input.slice(ws4.pos, ws4.pos + 5) === "right" && !/\w/.test(input[ws4.pos + 5] || "")) {
        assoc = "right";
        cur = ws4.pos + 5;
      }
      // No default - assoc remains undefined for non-associative
    }

    // Register the operator (method name is "op" + operator symbol)
    if (kind === "prefix") {
      $.operators.prefix[op] = { prec, method: `op${op}` };
    } else if (kind === "postfix") {
      $.operators.postfix[op] = { prec, method: `op${op}` };
    } else {
      // Use "none" for non-associative operators (will cause parse error on chaining)
      $.operators.binary[op] = { prec, assoc: assoc || "none", method: `op${op}` };
    }

    return {
      ok: true,
      value: { type: "OperatorDeclExpr", op, kind, prec, assoc } as OperatorDeclExpr,
      pos: cur,
    };
  };

  // Import declarations: import <name> from "<path>";
  $.importDecl = () => (input, pos) => {
    const ws = $.ws()(input, pos);
    const p = ws.pos;

    // Check for "import" keyword
    if (input.slice(p, p + 6) !== "import" || /\w/.test(input[p + 6] || "")) {
      return { ok: false, expected: "import", pos: p };
    }
    let cur = p + 6;

    // Parse the binding name
    const ws1 = $.ws()(input, cur);
    cur = ws1.pos;
    const nameMatch = /^[a-zA-Z_$][a-zA-Z0-9_$]*/.exec(input.slice(cur));
    if (!nameMatch) {
      return { ok: false, expected: "identifier", pos: cur };
    }
    const name = nameMatch[0];
    cur += name.length;

    // Check for "from" keyword
    const ws2 = $.ws()(input, cur);
    cur = ws2.pos;
    if (input.slice(cur, cur + 4) !== "from" || /\w/.test(input[cur + 4] || "")) {
      return { ok: false, expected: "from", pos: cur };
    }
    cur += 4;

    // Parse the path string
    const ws3 = $.ws()(input, cur);
    cur = ws3.pos;
    const quote = input[cur];
    if (quote !== '"' && quote !== "'") {
      return { ok: false, expected: "string", pos: cur };
    }
    cur++;
    let path = "";
    while (cur < input.length && input[cur] !== quote) {
      if (input[cur] === "\\") {
        cur++;
        if (cur < input.length) {
          path += input[cur];
          cur++;
        }
      } else {
        path += input[cur];
        cur++;
      }
    }
    if (input[cur] !== quote) {
      return { ok: false, expected: "closing quote", pos: cur };
    }
    cur++;

    return {
      ok: true,
      value: {
        type: "ImportExpr",
        name: { name, loc: { start: ws1.pos, end: ws1.pos + name.length } },
        path,
      } as ImportExpr,
      pos: cur,
    };
  };

  $.statement = () => (input, pos) => {
    const importDecl = $.importDecl()(input, pos);
    if (importDecl.ok) return importDecl;
    const opDecl = $.operatorDecl()(input, pos);
    if (opDecl.ok) return opDecl;
    const letResult = $.letStmt()(input, pos);
    if (letResult.ok) return letResult;
    return $.expr()(input, pos);
  };

  $.statements = (isEnd) => (pos, acc) => {
    const loop = (p: number, acc: EExpr[]): ParseResult<EExpr[]> => {
      const ws = $.ws()("", 0); // dummy - we need input
      // This needs access to input - let's restructure
      return { ok: true, value: acc, pos: p };
    };
    return loop(pos, acc);
  };

  // Helper to convert statement list to expression
  $.stmtsToExpr = (stmts) => {
    if (stmts.length === 0) return { type: "VoidExpr" } as VoidExpr;
    if (stmts.length === 1) return stmts[0];
    return { type: "BlockExpr", stmts } as BlockExpr;
  };

  const baseAtom = $.atom;
  $.block = () => (input, pos) => {
    const open = $.token("{")(input, pos);
    if (!open.ok) return { ok: false, expected: "{", pos };

    const stmts: EExpr[] = [];
    let p = open.pos;

    while (true) {
      const ws = $.ws()(input, p);
      const close = $.token("}")(input, ws.pos);
      if (close.ok) {
        return { ok: true, value: $.stmtsToExpr(stmts), pos: close.pos };
      }

      const stmt = $.statement()(input, ws.pos);
      if (!stmt.ok) {
        // Check if it's an empty block (object literal)
        if (stmts.length === 0) return { ok: false, expected: "statement", pos };
        return stmt;
      }

      stmts.push(stmt.value as EExpr);
      p = stmt.pos;

      const ws2 = $.ws()(input, p);
      const semi = $.token(";")(input, ws2.pos);
      if (semi.ok) {
        p = semi.pos;
      } else {
        // No semicolon - must be last statement
        const ws3 = $.ws()(input, ws2.pos);
        const close2 = $.token("}")(input, ws3.pos);
        if (close2.ok) {
          return { ok: true, value: $.stmtsToExpr(stmts), pos: close2.pos };
        }
        return { ok: false, expected: "; or }", pos: ws2.pos };
      }
    }
  };

  // Override atom to try block first
  const exoAtom = () => (input: string, pos: number) => {
    // Try block, but not empty {} (that's an object)
    const ws = $.ws()(input, pos);
    if (input[ws.pos] === "{") {
      const ws2 = $.ws()(input, ws.pos + 1);
      if (input[ws2.pos] === "}") {
        // Empty braces - let baseAtom handle as object
        return baseAtom()(input, pos);
      }
      // Check if first thing is a statement (not key:value)
      const firstStmt = $.statement()(input, ws2.pos);
      if (firstStmt.ok) {
        const ws3 = $.ws()(input, firstStmt.pos);
        // If followed by ; or }, it's a block
        if (input[ws3.pos] === ";" || input[ws3.pos] === "}") {
          return $.block()(input, pos);
        }
      }
    }
    return baseAtom()(input, pos);
  };
  $.atom = exoAtom as () => Parser<Expr>;

  const exoIfExpr = () => (input: string, pos: number) => {
    const kw = $.ifKeyword()(input, pos);
    if (!kw.ok) return { ok: false, expected: "if", pos };

    const cond = $.ifCondition()(input, kw.pos);
    if (!cond.ok) return cond;

    const thenKw = $.thenKeyword()(input, cond.pos);
    if (!thenKw.ok) return { ok: false, expected: "then", pos: cond.pos };

    const thenExpr = $.thenBranch()(input, thenKw.pos);
    if (!thenExpr.ok) return thenExpr;

    const elseKw = $.elseKeyword()(input, thenExpr.pos);
    if (elseKw.ok) {
      const elseExpr = $.elseBranch()(input, elseKw.pos);
      if (!elseExpr.ok) return elseExpr;
      return {
        ok: true,
        value: { type: "IfExpr", cond: cond.value, then: thenExpr.value, else: elseExpr.value },
        pos: elseExpr.pos,
      };
    }

    // No else - use VoidExpr
    return {
      ok: true,
      value: { type: "IfExpr", cond: cond.value, then: thenExpr.value, else: { type: "VoidExpr" } },
      pos: thenExpr.pos,
    };
  };
  $.ifExpr = exoIfExpr as unknown as typeof $.ifExpr;

  const exoProgram = () => (input: string, pos: number) => {
    const stmts: EExpr[] = [];
    let p = pos;

    while (true) {
      const ws = $.ws()(input, p);
      const eof = $.eof()(input, ws.pos);
      if (eof.ok) {
        return { ok: true, value: $.stmtsToExpr(stmts), pos: ws.pos };
      }

      const stmt = $.statement()(input, ws.pos);
      if (!stmt.ok) return stmt;
      stmts.push(stmt.value as EExpr);
      p = stmt.pos;

      const ws2 = $.ws()(input, p);
      const semi = $.token(";")(input, ws2.pos);
      if (semi.ok) {
        p = semi.pos;
      } else {
        // No semicolon - check for EOF
        const ws3 = $.ws()(input, ws2.pos);
        const eof2 = $.eof()(input, ws3.pos);
        if (eof2.ok) {
          return { ok: true, value: $.stmtsToExpr(stmts), pos: ws3.pos };
        }
        return { ok: false, expected: "; or EOF", pos: ws2.pos };
      }
    }
  };
  $.program = exoProgram as unknown as typeof $.program;
};

interface CompileOps {
  compileExpr: (expr: EExpr) => IR;
  compileBlock: (stmts: EExpr[], idx: number) => IR;
}

type ExoCompileOps = CoreCompileOps & CompileOps;

const build$compile = (in$: CoreCompileOps): void => {
  const $ = in$ as unknown as ExoCompileOps;

  const baseCompileExpr = $.compileExpr;

  // Compile statements to a sequence of ir.seq
  $.compileBlock = (stmts, idx) => {
    if (idx >= stmts.length) return ir.lit(undefined);

    const stmt = stmts[idx];
    const isLast = idx === stmts.length - 1;
    const compiledStmt = $.compileExpr(stmt);

    if (isLast) {
      return compiledStmt;
    }

    return ir.seq(compiledStmt, $.compileBlock(stmts, idx + 1));
  };

  $.compileExpr = (expr: EExpr): IR => {
    switch (expr.type) {
      case "VoidExpr":
      case "OperatorDeclExpr":
        // Operator declarations have no runtime effect
        return ir.lit(undefined);

      case "ImportExpr":
        // Compile to ir.import which will be hoisted by emit
        return ir.import(expr.name.name, expr.path);

      case "BlockExpr":
        // Wrap in $.block to create child scope, then compile statements with seq
        return ir.$(
          "block",
          ir.var("$env"),
          ir.arrow(["$env"], $.compileBlock(expr.stmts, 0))
        );

      case "LetStmtExpr":
        // Compile to $.letBind which binds in current scope
        return ir.$(
          "letBind",
          ir.var("$env"),
          ir.lit(expr.name.name),
          $.compileExpr(expr.value)
        );

      case "AssignExpr":
        return ir.$("assign", ir.var("$env"), ir.lit(expr.name.name), $.compileExpr(expr.value));

      case "BinaryExpr": {
        const opDef = operators.binary[expr.op];
        const left = $.compileExpr(expr.left);
        const right = $.compileExpr(expr.right);

        if (opDef.prim) {
          // Primitive operation (like strictEq)
          return ir.$(opDef.prim, left, right);
        }

        // Method call: $.index(left, "op+")(right) - use $.index for primitive member access
        return ir.$("call", ir.$("index", left, ir.lit(opDef.method!)), ir.array(right));
      }

      case "PrefixExpr": {
        const opDef = operators.prefix[expr.op];
        const operand = $.compileExpr(expr.operand);
        // Method call: $.index(operand, "op!")() - use $.index for primitive member access
        return ir.$("call", ir.$("index", operand, ir.lit(opDef.method)), ir.array());
      }

      case "PostfixExpr": {
        // foo! compiles the same as foo()
        const operand = $.compileExpr(expr.operand);
        return ir.$("call", operand, ir.array());
      }

      default:
        return baseCompileExpr(expr as Expr);
    }
  };
};

interface ExoInterpretOps extends CoreInterpretOps {
  assign: ($env: unknown, name: string, value: unknown) => unknown;
  letBind: ($env: unknown, name: string, value: unknown) => unknown;
  block: ($env: unknown, bodyFn: ($env: unknown) => unknown) => unknown;
}

const build$interpret = (in$: CoreInterpretOps): void => {
  const $ = in$ as unknown as ExoInterpretOps;

  $.assign = ($env: any, name: string, value: unknown) => {
    $env.mutate(name, value);
    return value;
  };

  // Bind a new variable in the current scope (for statement-style let)
  $.letBind = ($env: any, name: string, value: unknown) => {
    $env.bind(name, value);
    return undefined;
  };

  // Create a child scope for a block
  $.block = ($env: any, bodyFn: ($env: unknown) => unknown) => {
    const child = $env.extend({});
    return bodyFn(child);
  };
};

export const exoExtension: Extension = {
  name: "exo",
  version: "1.0.0",
  description: "JS-like language with operators, statements, blocks, and type annotations",
  requires: "core",
  $parse: build$parse,
  $compile: build$compile,
  $interpret: build$interpret,
};

export default exoExtension;
