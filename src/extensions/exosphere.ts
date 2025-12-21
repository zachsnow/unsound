/**
 * Exosphere Extension
 *
 * A JS-like language layer built directly on core.ts.
 * Adds: operators, statements, blocks, assignment, type annotations.
 */
import { Expr, Span, SpanExpr } from "../ast";
import { CoreCompileOps } from "../compile";
import { CoreInterpretOps } from "../interpret";
import { ir, IR } from "../ir";
import { CoreParseOps, ParseResult, Parser } from "../parse";
import { Extension } from "../types";

// =============================================================================
// AST Types
// =============================================================================

interface BinaryExpr extends SpanExpr {
  type: "BinaryExpr";
  op: string;
  left: EExpr;
  right: EExpr;
}

interface UnaryExpr extends SpanExpr {
  type: "UnaryExpr";
  op: string;
  operand: EExpr;
}

interface BlockExpr extends SpanExpr {
  type: "BlockExpr";
  stmts: EExpr[];
}

interface LetStmtExpr extends SpanExpr {
  type: "LetStmtExpr";
  name: string;
  nameLoc?: Span;
  annotation: EExpr | null;
  value: EExpr;
}

interface AssignExpr extends SpanExpr {
  type: "AssignExpr";
  name: string;
  nameLoc?: Span;
  value: EExpr;
}

interface VoidExpr extends SpanExpr {
  type: "VoidExpr";
}

type EExpr =
  | Expr
  | BinaryExpr
  | UnaryExpr
  | BlockExpr
  | LetStmtExpr
  | AssignExpr
  | VoidExpr;

// =============================================================================
// Operator Table
// =============================================================================

interface BinaryOpDef {
  prec: number;
  assoc: "left" | "right";
  method?: string;
  prim?: string;
}

interface UnaryOpDef {
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
    "!": { method: "op!" },
    "-": { method: "opNeg" },
  } as Record<string, UnaryOpDef>,
};

// =============================================================================
// Parse Phase
// =============================================================================

interface ExoParseOps extends CoreParseOps {
  operators: typeof operators;

  // Operators
  binaryOp: () => Parser<{ op: string; start: number }>;
  prefixOp: () => Parser<{ op: string; start: number }>;
  binaryExpr: (minPrec: number) => Parser<EExpr>;
  unaryExpr: () => Parser<EExpr>;

  // Statements
  statement: () => Parser<EExpr>;
  statements: (isEnd: (pos: number) => ParseResult<unknown>) => (pos: number, acc: EExpr[]) => ParseResult<EExpr[]>;
  stmtsToExpr: (stmts: EExpr[]) => EExpr;
  letStmt: () => Parser<LetStmtExpr>;

  // Blocks
  block: () => Parser<EExpr>;

  // Assignment
  varAssign: () => Parser<EExpr>;
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

  // Unary expression: prefix operator or appExpr
  const baseAppExpr = $.appExpr;
  $.unaryExpr = () => (input, pos) => {
    const prefix = $.prefixOp()(input, pos);
    if (prefix.ok) {
      const operand = $.unaryExpr()(input, prefix.pos);
      if (!operand.ok) return operand;
      return {
        ok: true,
        value: { type: "UnaryExpr", op: prefix.value.op, operand: operand.value } as UnaryExpr,
        pos: operand.pos,
      };
    }
    return baseAppExpr()(input, pos);
  };

  // Binary expression with precedence climbing
  $.binaryExpr = (minPrec: number) => (input, pos) => {
    let left = $.unaryExpr()(input, pos);
    if (!left.ok) return left;

    while (true) {
      const opResult = $.binaryOp()(input, left.pos);
      if (!opResult.ok) break;

      const opDef = $.operators.binary[opResult.value.op];
      if (!opDef || opDef.prec < minPrec) break;

      const nextMinPrec = opDef.assoc === "left" ? opDef.prec + 1 : opDef.prec;
      const right = $.binaryExpr(nextMinPrec)(input, opResult.pos);
      if (!right.ok) return right;

      left = {
        ok: true,
        value: { type: "BinaryExpr", op: opResult.value.op, left: left.value, right: right.value } as BinaryExpr,
        pos: right.pos,
      };
    }

    return left;
  };

  // ---------------------------------------------------------------------------
  // Assignment Parsing
  // ---------------------------------------------------------------------------

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
            name: result.value.name,
            nameLoc: result.value.loc,
            value: rhs.value,
          } as AssignExpr,
          pos: rhs.pos,
        };
      }
    }
    return result;
  };

  // Override appExpr to use operators
  $.appExpr = (() => $.varAssign()) as unknown as typeof $.appExpr;

  // ---------------------------------------------------------------------------
  // Statement Parsing
  // ---------------------------------------------------------------------------

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
      annotation = typeExpr.value as EExpr;
      afterAnnotation = typeExpr.pos;
    }

    const init = $.letInitializer()(input, afterAnnotation);
    if (!init.ok) return init;

    return {
      ok: true,
      value: {
        type: "LetStmtExpr",
        name: binding.value.name,
        nameLoc: binding.value.nameLoc,
        annotation,
        value: init.value as EExpr,
      } as LetStmtExpr,
      pos: init.pos,
    };
  };

  // Disable let...in expression syntax
  $.letExpr = () => () => ({ ok: false, expected: "expression", pos: 0 });

  $.statement = () => (input, pos) => {
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

  // ---------------------------------------------------------------------------
  // Block Parsing
  // ---------------------------------------------------------------------------

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
  $.atom = exoAtom as unknown as typeof $.atom;

  // ---------------------------------------------------------------------------
  // If Without Else
  // ---------------------------------------------------------------------------

  const baseIfExpr = $.ifExpr;
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

  // ---------------------------------------------------------------------------
  // Program (top-level statements)
  // ---------------------------------------------------------------------------

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

// =============================================================================
// Compile Phase
// =============================================================================

interface ExoCompileOps extends CoreCompileOps {
  compileExpr: (expr: EExpr) => IR;
  compileBlock: (stmts: EExpr[], idx: number) => IR;
}

const build$compile = (in$: CoreCompileOps): void => {
  const $ = in$ as unknown as ExoCompileOps;

  const baseCompileExpr = $.compileExpr;

  // Compile a block: each LetStmtExpr scopes over the rest
  $.compileBlock = (stmts, idx) => {
    if (idx >= stmts.length) return ir.lit(undefined);

    const stmt = stmts[idx];
    const isLast = idx === stmts.length - 1;

    if (stmt.type === "LetStmtExpr") {
      // let x = v; rest -> $.let($env, "x", value, rest)
      return ir.$(
        "let",
        ir.var("$env"),
        ir.lit(stmt.name),
        ir.arrow(["$env"], $.compileExpr(stmt.value)),
        ir.arrow(["$env"], $.compileBlock(stmts, idx + 1))
      );
    }

    if (isLast) {
      return $.compileExpr(stmt);
    }

    return ir.seq($.compileExpr(stmt), $.compileBlock(stmts, idx + 1));
  };

  $.compileExpr = (expr: EExpr): IR => {
    switch (expr.type) {
      case "VoidExpr":
        return ir.lit(undefined);

      case "BlockExpr":
        return $.compileBlock(expr.stmts, 0);

      case "LetStmtExpr":
        // Standalone let - bind and return undefined
        return ir.$(
          "let",
          ir.var("$env"),
          ir.lit(expr.name),
          ir.arrow(["$env"], $.compileExpr(expr.value)),
          ir.arrow(["$env"], ir.lit(undefined))
        );

      case "AssignExpr":
        return ir.$("assign", ir.var("$env"), ir.lit(expr.name), $.compileExpr(expr.value));

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

      case "UnaryExpr": {
        const opDef = operators.prefix[expr.op];
        const operand = $.compileExpr(expr.operand);
        // Method call: $.index(operand, "op!")() - use $.index for primitive member access
        return ir.$("call", ir.$("index", operand, ir.lit(opDef.method)), ir.array());
      }

      default:
        return baseCompileExpr(expr as Expr);
    }
  };
};

// =============================================================================
// Interpret Phase
// =============================================================================

interface ExoInterpretOps extends CoreInterpretOps {
  assign: ($env: unknown, name: string, value: unknown) => unknown;
}

const build$interpret = (in$: CoreInterpretOps): void => {
  const $ = in$ as unknown as ExoInterpretOps;

  $.assign = ($env: any, name: string, value: unknown) => {
    $env.mutate(name, value);
    return value;
  };
};

// =============================================================================
// Extension Export
// =============================================================================

export const exosphereExtension: Extension = {
  name: "exosphere",
  version: "1.0.0",
  description: "JS-like language with operators, statements, blocks, and type annotations",
  requires: "core",
  $parse: build$parse,
  $compile: build$compile,
  $interpret: build$interpret,
};

export default exosphereExtension;
