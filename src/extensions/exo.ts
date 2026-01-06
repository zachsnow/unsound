/**
 * Exo Extension
 *
 * A JS-like language layer built directly on core.ts.
 * Adds: operators, statements, blocks, assignment, type annotations.
 */
import { Expr, IfExpr, Name, Span, SpanExpr } from "../ast";
import { CoreCompileOps } from "../compile";
import { CoreInterpretOps, createEnv } from "../interpret";
import { ir, IR } from "../ir";
import { CoreParseOps, ParseResult, Parser } from "../parse";
import { Extension } from "../types";
import { UnhandledCaseError } from "../util";

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

interface OperatorDeclaration extends SpanExpr {
  type: "OperatorDeclaration";
  op: string;
  kind: "prefix" | "postfix" | "infix";
  prec: number;
  assoc?: "left" | "right";
}

interface ImportDeclaration extends SpanExpr {
  type: "ImportDeclaration";
  name: Name;
  path: string;
}

type Declaration = OperatorDeclaration | ImportDeclaration;

type Program = {
  type: "Program";
  declarations: Declaration[];
  body: EExpr[];
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
  | AssignExpr;

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
  stmtsToExpr: (stmts: EExpr[]) => EExpr;
  letStmt: () => Parser<LetStmtExpr>;

  // Blocks
  block: () => Parser<EExpr>;

  // Assignment
  varAssign: () => Parser<EExpr>;

  // Declarations.
  declarations: () => Parser<Declaration[]>;
  declaration: () => Parser<Declaration>;
  operatorDeclaration: () => Parser<OperatorDeclaration>;
  importDeclaration: () => Parser<ImportDeclaration>;
  importKeyword: () => Parser<string>;
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

  // Override appExpr to use operators.
  $.appExpr = (() => $.varAssign()) as () => Parser<Expr>;

  // Helper: parse optional type annotation `: type`
  const typeAnnotation = (): Parser<EExpr> => (input, pos) => {
    const colon = $.token(":")(input, pos);
    if (!colon.ok) return colon;
    return $.atom()(input, colon.pos);
  };

  $.letStmt = () =>
    $.map(
      $.seq(
        $.letKeyword(),
        $.letBinding(),
        $.opt(typeAnnotation()),
        $.letInitializer()
      ),
      ([_kw, name, annotation, value]): LetStmtExpr => ({
        type: "LetStmtExpr",
        name,
        annotation,
        value: value as EExpr,
      })
    );

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

  // Helper: parse operator symbol (one or more operator characters)
  const operatorSymbol = (): Parser<string> => (input, pos) => {
    const ws = $.ws()(input, pos);
    const p = ws.pos;
    const opChars = /^[!@#$%^&*\-+=<>?/|~:]+/.exec(input.slice(p));
    if (!opChars) {
      return { ok: false, expected: "operator symbol", pos: p };
    }
    return { ok: true, value: opChars[0], pos: p + opChars[0].length };
  };

  // Helper: parse operator kind
  const operatorKind = (): Parser<"prefix" | "postfix" | "infix"> =>
    $.alt(
      $.map($.keyword("prefix"), (): "prefix" => "prefix"),
      $.map($.keyword("postfix"), (): "postfix" => "postfix"),
      $.map($.keyword("infix"), (): "infix" => "infix")
    );

  // Helper: parse associativity
  const operatorAssoc = (): Parser<"left" | "right"> =>
    $.alt(
      $.map($.keyword("left"), (): "left" => "left"),
      $.map($.keyword("right"), (): "right" => "right")
    );

  // Operator declarations: operator <op> prefix|postfix|infix [<prec>] [left|right];
  $.operatorDeclaration = () =>
    $.map(
      $.seq(
        $.keyword("operator"),
        operatorSymbol(),
        operatorKind(),
        $.opt($.numberLit()),
        $.opt(operatorAssoc())
      ),
      ([_kw, op, kind, precOpt, assocOpt]): OperatorDeclaration => {
        const prec = precOpt ?? getDefaultPrec();
        const assoc = kind === "infix" ? assocOpt ?? undefined : undefined;

        // Register the operator (method name is "op" + operator symbol)
        if (kind === "prefix") {
          $.operators.prefix[op] = { prec, method: `op${op}` };
        } else if (kind === "postfix") {
          $.operators.postfix[op] = { prec, method: `op${op}` };
        } else {
          // Use "none" for non-associative operators (will cause parse error on chaining)
          $.operators.binary[op] = { prec, assoc: assoc || "none", method: `op${op}` };
        }

        return { type: "OperatorDeclaration", op, kind, prec, assoc };
      }
    );

  // Import declarations: import <name> from "<path>";
  $.importDeclaration = () =>
    $.map(
      $.seq(
        $.keyword("import"),
        $.letBinding(),
        $.keyword("from"),
        $.stringLit()
      ),
      ([_import, name, _from, path]): ImportDeclaration => ({
        type: "ImportDeclaration",
        name,
        path,
      })
    );

  $.importKeyword = () => $.keyword("import");

  $.declaration = (): Parser<Declaration> =>
    $.alt(
      $.lazy(() => $.importDeclaration() as Parser<Declaration>),
      $.lazy(() => $.operatorDeclaration()),
    );

  // Parse zero or more declarations, each optionally followed by semicolon
  $.declarations = () => (input, pos) => {
    const decls: Declaration[] = [];
    let p = pos;

    while (true) {
      const ws = $.ws()(input, p);
      const decl = $.declaration()(input, ws.pos);
      if (!decl.ok) break;

      decls.push(decl.value);
      p = decl.pos;

      // Optional semicolon after declaration
      const ws2 = $.ws()(input, p);
      const semi = $.token(";")(input, ws2.pos);
      if (semi.ok) {
        p = semi.pos;
      }
    }

    return { ok: true, value: decls, pos: p };
  };

  $.statement = () =>
    $.alt(
      $.lazy(() => $.letStmt() as Parser<EExpr>),
      $.lazy(() => $.expr())
    );

  // Helper to convert statement list to expression
  $.stmtsToExpr = (stmts) => {
    if (stmts.length === 0) return { type: "LiteralExpr", value: undefined };
    if (stmts.length === 1) return stmts[0];
    return { type: "BlockExpr", stmts };
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

  // Helper: parse else clause
  const elseClause = (): Parser<Expr> => (input, pos) => {
    const kw = $.elseKeyword()(input, pos);
    if (!kw.ok) return kw;
    return $.elseBranch()(input, kw.pos);
  };

  $.ifExpr = () =>
    $.map(
      $.seq(
        $.ifKeyword(),
        $.lazy(() => $.ifCondition()),
        $.thenKeyword(),
        $.lazy(() => $.thenBranch()),
        $.opt(elseClause())
      ),
      ([_if, cond, _then, thenExpr, elseExpr]): IfExpr => ({
        type: "IfExpr",
        cond,
        then: thenExpr,
        else: elseExpr ?? { type: "LiteralExpr", value: undefined },
      })
    );

  const exoProgram = () => (input: string, pos: number) => {
    // Parse declarations first
    const decls = $.declarations()(input, pos);
    if (!decls.ok) return decls;

    // Parse statements (expressions separated by semicolons)
    const stmts: EExpr[] = [];
    let p = decls.pos;

    while (true) {
      const ws = $.ws()(input, p);
      const eof = $.eof()(input, ws.pos);
      if (eof.ok) {
        // Build Program AST
        return {
          ok: true,
          value: {
            type: "Program",
            declarations: decls.value,
            body: stmts,
          } as Program,
          pos: ws.pos,
        };
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
          return {
            ok: true,
            value: {
              type: "Program",
              declarations: decls.value,
              body: stmts,
            } as Program,
            pos: ws3.pos,
          };
        }
        return { ok: false, expected: "; or EOF", pos: ws2.pos };
      }
    }
  };
  $.program = exoProgram as () => Parser<Expr>;
};

interface CompileOps {
  compileProgram: (expr: Program | EExpr) => IR;
  compileDeclaration: (decl: Declaration) => IR;
  compileExpr: (expr: EExpr) => IR;
  compileBlock: (stmts: EExpr[], idx: number) => IR;
}

type ExoCompileOps = CoreCompileOps & CompileOps;

const build$compile = (in$: CoreCompileOps): void => {
  const $ = in$ as unknown as ExoCompileOps;

  const baseCompileExpr = $.compileExpr;

  // Override compileProgram to handle Program AST with declarations
  $.compileProgram = (expr: Program | EExpr): IR => {
    // Handle Program AST node
    if ((expr as any).type === "Program") {
      const prog = expr as Program;

      // Compile imports (only imports need runtime code)
      const imports: IR[] = [];
      for (const decl of prog.declarations) {
        if (decl.type === "ImportDeclaration") {
          // Just the $.import call, no await wrapper - program level handles awaiting
          imports.push(ir.$("import", ir.var("$env"), ir.lit(decl.name.name), ir.lit(decl.path)));
        }
        // OperatorDeclaration has no runtime code
      }

      // Compile body statements
      const body = $.compileBlock(prog.body, 0);

      // If no imports, just return the body
      if (imports.length === 0) {
        return body;
      }

      // Return program node with imports and body
      return ir.program(imports, body);
    }

    // Legacy: non-Program AST (e.g., single expression)
    return $.compileExpr(expr as EExpr);
  };

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

  $.compileDeclaration = (decl: Declaration): IR => {
    switch (decl.type) {
      case "OperatorDeclaration":
        // No runtime code needed for operator declarations
        return ir.lit(undefined);

      case "ImportDeclaration":
        // Compile to $.import($env, name, path) - async import
        return ir.$("import", ir.var("$env"), ir.lit(decl.name.name), ir.lit(decl.path));

      default:
        throw new UnhandledCaseError("declaration", decl);
    }
  };

  $.compileExpr = (expr: EExpr): IR => {
    switch (expr.type) {
      case "BlockExpr":
        // Wrap in $.block to create child scope, then compile statements with seq
        return ir.$(
          "block",
          ir.var("$env"),
          ir.arrow(["$env"], $.compileBlock(expr.stmts, 0))
        );

      case "LetStmtExpr":
        // Compile to $.letBind which binds in current scope
        // Annotation is thunked so it doesn't evaluate unless needed (by type checker)
        return ir.$(
          "letBind",
          ir.var("$env"),
          ir.lit(expr.name.name),
          $.compileExpr(expr.value),
          expr.annotation
            ? ir.arrow([], $.compileExpr(expr.annotation))
            : ir.lit(null)
        );

      case "AssignExpr":
        return ir.$("assign", ir.var("$env"), ir.lit(expr.name.name), $.compileExpr(expr.value));

      case "BinaryExpr": {
        const opDef = operators.binary[expr.op];
        const left = $.compileExpr(expr.left);

        // Short-circuit operators: right side must be thunked
        if (expr.op === "&&") {
          return ir.$("and", left, ir.arrow([], $.compileExpr(expr.right)));
        }
        if (expr.op === "||") {
          return ir.$("or", left, ir.arrow([], $.compileExpr(expr.right)));
        }

        const right = $.compileExpr(expr.right);

        if (opDef.prim) {
          // Primitive operation (like strictEq)
          return ir.$(opDef.prim, left, right);
        }

        // Method call: $.index(left, "op+")(right)
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
  // annotationThunk is ignored by interpreter; used by type checker
  letBind: ($env: unknown, name: string, value: unknown, annotationThunk: (() => unknown) | null) => unknown;
  block: ($env: unknown, bodyFn: ($env: unknown) => unknown) => unknown;
}

const build$interpret = (in$: CoreInterpretOps): void => {
  const $ = in$ as unknown as ExoInterpretOps;

  $.assign = ($env: any, name: string, value: unknown) => {
    $env.mutate(name, value);
    return value;
  };

  // Bind a new variable in the current scope (for statement-style let)
  // annotationThunk is ignored by interpreter; used by type checker
  $.letBind = ($env: any, name: string, value: unknown, _annotationThunk: (() => unknown) | null) => {
    $env.bind(name, value);
    return undefined;
  };

  // Create a child scope for a block
  $.block = ($env: any, bodyFn: ($env: unknown) => unknown) => {
    const child = $env.extend({});
    return bodyFn(child);
  };

  // Short-circuit logical operators
  $.and = (a: unknown, bThunk: () => unknown) => a ? bThunk() : a;
  $.or = (a: unknown, bThunk: () => unknown) => a ? a : bThunk();
};

// ---------------------------------------------------------------------------
// Type Semantics ($type)
// ---------------------------------------------------------------------------
// Types are values. The type checker is an alternative interpreter that
// computes types instead of runtime values.

interface ExoTypeOps extends CoreInterpretOps {
  assign: ($env: unknown, name: string, value: unknown) => unknown;
  letBind: ($env: unknown, name: string, value: unknown, annotationThunk: (() => unknown) | null) => unknown;
  block: ($env: unknown, bodyFn: ($env: unknown) => unknown) => unknown;
}

const build$type = (in$: CoreInterpretOps): void => {
  const $ = in$ as unknown as ExoTypeOps;

  // ==========================================================================
  // TYPE SYSTEM INFRASTRUCTURE
  // ==========================================================================
  //
  // Types are objects with a $type tag. Dependent types have a known `value`.
  // SetType wraps multiple types and forwards operations to each.
  // AnyType is an escape hatch for interop.
  //
  // Type hierarchy:
  //   NumberType(value?) - number, optionally with known value
  //   StringType(value?) - string, optionally with known value
  //   BooleanType(value?) - boolean, optionally with known value
  //   NullType, UndefinedType - singleton types
  //   ArrayType(elements | elementType) - tuple or array
  //   ObjectType(props | valueType) - object with known props or record
  //   FunctionType(fn, isUnsound) - tagged function type
  //   SetType(types[]) - union type
  //   AnyType - escape hatch
  // ==========================================================================

  const TYPE_TAG = Symbol("$type");

  // Type constructors
  interface Type {
    [TYPE_TAG]: string;
    value?: unknown;
  }

  const isType = (t: unknown): t is Type =>
    typeof t === "object" && t !== null && TYPE_TAG in t;

  // Tag for type-safe functions (Unsound lambdas and operator methods)
  const UNSOUND_FN_TAG = Symbol("unsound-fn");
  const tagFn = <T extends Function>(fn: T): T => {
    (fn as any)[UNSOUND_FN_TAG] = true;
    return fn;
  };
  const isUnsoundFunction = (fn: unknown): boolean =>
    typeof fn === "function" && (fn as any)[UNSOUND_FN_TAG] === true;

  // --- Operator Helpers ---
  // Factory that creates operator methods bound to a type instance
  const ops = (t: Type) => ({
    // Binary numeric op: Number × Number → Number
    num: (op: (a: number, b: number) => number) =>
      tagFn((other: unknown) => {
        if (!isType(other) || other[TYPE_TAG] !== "Number") {
          throw new Error(`Type error: expected Number, got ${showType(other)}`);
        }
        if (t.value !== undefined && other.value !== undefined) {
          return makeNumberType(op(t.value as number, other.value as number));
        }
        return NumberType;
      }),

    // Binary string op: String × String → String
    str: (op: (a: string, b: string) => string) =>
      tagFn((other: unknown) => {
        if (!isType(other) || other[TYPE_TAG] !== "String") {
          throw new Error(`Type error: expected String, got ${showType(other)}`);
        }
        if (t.value !== undefined && other.value !== undefined) {
          return makeStringType(op(t.value as string, other.value as string));
        }
        return StringType;
      }),

    // Comparison: T × T → Boolean (op optional for type-check-only)
    cmp: (expectedType: string, op?: (a: any, b: any) => boolean) =>
      tagFn((other: unknown) => {
        if (!isType(other) || other[TYPE_TAG] !== expectedType) {
          throw new Error(`Type error: expected ${expectedType}, got ${showType(other)}`);
        }
        if (op && t.value !== undefined && other.value !== undefined) {
          return makeBooleanType(op(t.value, other.value));
        }
        return BooleanType;
      }),
  });

  // --- Primitive Types ---
  const makeNumberType = (value?: number): Type & Record<string, unknown> => {
    const t: Type & Record<string, unknown> = { [TYPE_TAG]: "Number" };
    if (value !== undefined) t.value = value;
    t.toJSON = () => value !== undefined ? { type: "Number", value } : { type: "Number" };
    const { num, cmp } = ops(t);

    t["op+"] = num((a, b) => a + b);
    t["op-"] = num((a, b) => a - b);
    t["op*"] = num((a, b) => a * b);
    t["op/"] = num((a, b) => a / b);
    t["op%"] = num((a, b) => a % b);
    t["opNeg"] = tagFn(() => t.value !== undefined ? makeNumberType(-(t.value as number)) : NumberType);

    t["op=="] = cmp("Number", (a, b) => a === b);
    t["op!="] = cmp("Number", (a, b) => a !== b);
    t["op<"] = cmp("Number", (a, b) => a < b);
    t["op>"] = cmp("Number", (a, b) => a > b);
    t["op<="] = cmp("Number", (a, b) => a <= b);
    t["op>="] = cmp("Number", (a, b) => a >= b);

    return t;
  };

  const makeStringType = (value?: string): Type & Record<string, unknown> => {
    const t: Type & Record<string, unknown> = { [TYPE_TAG]: "String" };
    if (value !== undefined) t.value = value;
    t.toJSON = () => value !== undefined ? { type: "String", value } : { type: "String" };
    const { str, cmp } = ops(t);

    t["op+"] = str((a, b) => a + b);
    t["op=="] = cmp("String", (a, b) => a === b);
    t["op!="] = cmp("String", (a, b) => a !== b);
    t["op<"] = cmp("String", (a, b) => a < b);
    t["op>"] = cmp("String", (a, b) => a > b);
    t["op<="] = cmp("String", (a, b) => a <= b);
    t["op>="] = cmp("String", (a, b) => a >= b);

    t["length"] = value !== undefined ? makeNumberType(value.length) : NumberType;
    return t;
  };

  const makeBooleanType = (value?: boolean): Type & Record<string, unknown> => {
    const t: Type & Record<string, unknown> = { [TYPE_TAG]: "Boolean" };
    if (value !== undefined) t.value = value;
    t.toJSON = () => value !== undefined ? { type: "Boolean", value } : { type: "Boolean" };
    const { cmp } = ops(t);

    t["op!"] = tagFn(() => t.value !== undefined ? makeBooleanType(!t.value) : BooleanType);
    t["op&&"] = cmp("Boolean");
    t["op||"] = cmp("Boolean");
    t["op=="] = cmp("Boolean");
    t["op!="] = cmp("Boolean");

    return t;
  };

  // Singleton types (with toJSON for test serialization)
  const NullType: Type & { toJSON: () => unknown } = { [TYPE_TAG]: "null", toJSON: () => ({ type: "null" }) };
  const UndefinedType: Type & { toJSON: () => unknown } = { [TYPE_TAG]: "undefined", toJSON: () => ({ type: "undefined" }) };
  const AnyType: Type & Record<string, unknown> = { [TYPE_TAG]: "Any", toJSON: () => ({ type: "Any" }) };

  // AnyType returns itself for any operation
  const anyHandler = {
    get(_target: any, prop: string | symbol | number) {
      if (prop === TYPE_TAG) return "Any";
      if (prop === "toJSON") return () => ({ type: "Any" });
      // Any operation on Any returns Any
      return (..._args: unknown[]) => AnyType;
    }
  };
  const AnyTypeProxy = new Proxy(AnyType, anyHandler);

  // Generic (non-dependent) types
  const NumberType = makeNumberType();
  const StringType = makeStringType();
  const BooleanType = makeBooleanType();

  // --- SetType ---
  // Union of multiple types, forwards operations to each member
  const makeSetType = (types: Type[]): Type => {
    // Flatten nested SetTypes
    const flatTypes: Type[] = [];
    for (const t of types) {
      if (isType(t) && t[TYPE_TAG] === "Set") {
        flatTypes.push(...(t as any).types);
      } else {
        flatTypes.push(t);
      }
    }
    // Deduplicate (simple reference equality for now)
    const uniqueTypes = [...new Set(flatTypes)];
    // If only one type, return it directly
    if (uniqueTypes.length === 1) return uniqueTypes[0];
    // If any is AnyType, return AnyType
    if (uniqueTypes.some(t => isType(t) && t[TYPE_TAG] === "Any")) return AnyTypeProxy;

    const setType: Type & { types: Type[] } & Record<string, unknown> = {
      [TYPE_TAG]: "Set",
      types: uniqueTypes,
    };

    // Forward property access to all types
    return new Proxy(setType, {
      get(target, prop) {
        if (prop === TYPE_TAG) return "Set";
        if (prop === "types") return target.types;
        if (prop === "value") return undefined; // SetTypes don't have a single value
        if (prop === "toJSON") return () => ({
          type: "Set",
          types: target.types.map(t => (t as any).toJSON ? (t as any).toJSON() : t)
        });
        // Forward to each type and collect results
        const results: Type[] = [];
        for (const t of target.types) {
          const val = (t as any)[prop];
          if (val !== undefined) {
            if (typeof val === "function") {
              // Wrap function to forward calls
              results.push(val);
            } else {
              results.push(val);
            }
          }
        }
        if (results.length === 0) return undefined;
        // If all results are functions, return a function that calls each
        if (results.every(r => typeof r === "function")) {
          return (...args: unknown[]) => {
            const callResults = results.map(fn => (fn as Function)(...args));
            return makeSetType(callResults as Type[]);
          };
        }
        return makeSetType(results as Type[]);
      }
    });
  };

  // --- Array Types ---
  // Tuple: known elements, Array: shared element type
  const makeArrayType = (elementsOrType: Type[] | Type): Type & Record<string, unknown> => {
    const isTuple = Array.isArray(elementsOrType);
    const t: Type & Record<string, unknown> = {
      [TYPE_TAG]: "Array",
      elements: isTuple ? elementsOrType : undefined,
      elementType: isTuple ? undefined : elementsOrType,
    };
    t.toJSON = () => isTuple
      ? { type: "Array", elements: elementsOrType.map(e => (e as any).toJSON ? (e as any).toJSON() : e) }
      : { type: "Array", elementType: (elementsOrType as any).toJSON ? (elementsOrType as any).toJSON() : elementsOrType };
    // Length is dependent for tuples
    t["length"] = isTuple
      ? makeNumberType(elementsOrType.length)
      : NumberType;
    return t;
  };

  // --- Object Types ---
  // Object with known props, or record with shared value type
  const makeObjectType = (propsOrValueType: Record<string, Type> | Type, knownProps = true): Type & Record<string, unknown> => {
    const t: Type & Record<string, unknown> = {
      [TYPE_TAG]: "Object",
      props: knownProps ? propsOrValueType as Record<string, Type> : undefined,
      valueType: knownProps ? undefined : propsOrValueType as Type,
    };
    t.toJSON = () => {
      if (knownProps) {
        const props = propsOrValueType as Record<string, Type>;
        const jsonProps: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(props)) {
          jsonProps[k] = (v as any).toJSON ? (v as any).toJSON() : v;
        }
        return { type: "Object", props: jsonProps };
      }
      const vt = propsOrValueType as Type;
      return { type: "Object", valueType: (vt as any).toJSON ? (vt as any).toJSON() : vt };
    };
    return t;
  };

  // --- Type Display ---
  const showType = (t: unknown): string => {
    if (t === null) return "null";
    if (typeof t === "function") return "<function>";
    if (!isType(t)) return String(t);
    const tag = t[TYPE_TAG];
    if (tag === "Set") {
      return `(${(t as any).types.map(showType).join(" | ")})`;
    }
    if (t.value !== undefined) {
      return `${tag}(${JSON.stringify(t.value)})`;
    }
    return tag;
  };

  // --- Type Compatibility ---
  const typeCompatible = (actual: Type, expected: Type): boolean => {
    if (actual === expected) return true;
    if (!isType(actual) || !isType(expected)) return false;
    // AnyType is compatible with anything
    if (actual[TYPE_TAG] === "Any" || expected[TYPE_TAG] === "Any") return true;
    // Same base type
    if (actual[TYPE_TAG] === expected[TYPE_TAG]) {
      // If expected has no value constraint, any value is ok
      if (expected.value === undefined) return true;
      // If expected has value, actual must match
      return actual.value === expected.value;
    }
    // SetType: check if all types in set are compatible
    if (actual[TYPE_TAG] === "Set") {
      return (actual as any).types.every((t: Type) => typeCompatible(t, expected));
    }
    return false;
  };

  // ==========================================================================
  // INTERPRETER OPERATIONS
  // ==========================================================================

  // === Environment ===
  $.env = () => createEnv({
    Number: NumberType,
    String: StringType,
    Boolean: BooleanType,
    Null: NullType,
    Undefined: UndefinedType,
    Any: AnyTypeProxy,
  });

  // === Literals (return dependent types with known values) ===
  $.number = (n: number) => makeNumberType(n);
  $.string = (s: string) => makeStringType(s);
  $.boolean = (b: boolean) => makeBooleanType(b);
  ($ as any).null = () => NullType;
  ($ as any).undefined = () => UndefinedType;

  // === Bindings ===
  $.lookup = ($env: any, name: string) => $env.lookup(name);

  $.let = ($env: any, name: string, valueFn: ($env: any) => unknown, bodyFn: ($env: any) => unknown) => {
    const child = $env.extend({ [name]: undefined });
    const valueType = valueFn(child);
    child.bind(name, valueType);
    return bodyFn(child);
  };

  // === Functions ===
  // Functions are tagged Unsound functions that compute return types from arg types
  $.lambda = ($env: any, params: string[], bodyFn: ($env: any) => unknown) => {
    return tagFn((...argTypes: unknown[]) => {
      const bindings: Record<string, unknown> = {};
      params.forEach((p, i) => { bindings[p] = argTypes[i] ?? AnyTypeProxy; });
      const child = $env.extend(bindings);
      return bodyFn(child);
    });
  };

  $.call = (fn: unknown, args: unknown[]) => {
    if (typeof fn === "function") {
      // Only call tagged functions (Unsound lambdas and operator methods)
      // Raw JS functions (from imports) would fail with type objects as args
      if (!isUnsoundFunction(fn)) {
        return AnyTypeProxy;
      }
      return fn(...args);
    }
    throw new Error(`Type error: cannot call non-function type ${showType(fn as Type)}`);
  };

  // === Control ===
  $.if = (cond: unknown, thenFn: ($env: any) => unknown, elseFn: ($env: any) => unknown, $env: any) => {
    // Condition must be boolean-compatible
    if (isType(cond) && cond[TYPE_TAG] !== "Boolean" && cond[TYPE_TAG] !== "Any") {
      throw new Error(`Type error: condition must be Boolean, got ${showType(cond)}`);
    }
    // If condition is a dependent boolean with known value, only return relevant branch
    if (isType(cond) && cond[TYPE_TAG] === "Boolean" && cond.value !== undefined) {
      return cond.value ? thenFn($env) : elseFn($env);
    }
    // Otherwise return SetType of both branches
    const thenType = thenFn($env);
    const elseType = elseFn($env);
    return makeSetType([thenType as Type, elseType as Type]);
  };

  // === Objects ===
  $.object = (props: Record<string, unknown>) => {
    const typeProps: Record<string, Type> = {};
    for (const [k, v] of Object.entries(props)) {
      typeProps[k] = v as Type;
    }
    return makeObjectType(typeProps);
  };

  // === Arrays ===
  $.array = (elems: unknown[]) => {
    return makeArrayType(elems as Type[]);
  };

  // === Indexing ===
  $.index = (obj: unknown, key: unknown) => {
    if (!isType(obj)) return AnyTypeProxy;

    // Handle AnyType
    if (obj[TYPE_TAG] === "Any") return AnyTypeProxy;

    // Handle Object types
    if (obj[TYPE_TAG] === "Object") {
      const objType = obj as Type & { props?: Record<string, Type>; valueType?: Type };
      if (objType.props) {
        // Known props: use dependent string key if available
        if (isType(key) && key[TYPE_TAG] === "String" && key.value !== undefined) {
          const prop = objType.props[key.value as string];
          if (prop !== undefined) return prop;
          // Unknown key returns SetType including UndefinedType
          return makeSetType([...Object.values(objType.props), UndefinedType]);
        }
        // Non-dependent key: return SetType of all possible values + Undefined
        return makeSetType([...Object.values(objType.props), UndefinedType]);
      }
      // Record type: return valueType or Undefined
      if (objType.valueType) {
        return makeSetType([objType.valueType, UndefinedType]);
      }
    }

    // Handle Array types
    if (obj[TYPE_TAG] === "Array") {
      const arrType = obj as Type & { elements?: Type[]; elementType?: Type };
      if (arrType.elements) {
        // Tuple: use dependent number key if available
        if (isType(key) && key[TYPE_TAG] === "Number" && key.value !== undefined) {
          const idx = key.value as number;
          if (idx >= 0 && idx < arrType.elements.length) {
            return arrType.elements[idx];
          }
          return UndefinedType;
        }
        // Non-dependent key: return SetType of all elements + Undefined
        return makeSetType([...arrType.elements, UndefinedType]);
      }
      // Array type: return element type or Undefined
      if (arrType.elementType) {
        return makeSetType([arrType.elementType, UndefinedType]);
      }
    }

    // Handle SetType: forward to each type
    if (obj[TYPE_TAG] === "Set") {
      const setType = obj as Type & { types: Type[] };
      const results = setType.types.map(t => $.index(t, key));
      return makeSetType(results as Type[]);
    }

    // Direct property access (for operators, etc.)
    // Extract string value from key if it's a StringType
    const keyStr = isType(key) && key[TYPE_TAG] === "String" && key.value !== undefined
      ? key.value as string
      : String(key);
    const val = (obj as any)[keyStr];
    if (val !== undefined) return val;

    return UndefinedType;
  };

  $.assignIndex = (obj: unknown, key: unknown, value: unknown) => {
    // TODO: track mutations to object types
    return value;
  };

  // === Strict equality (works on any types) ===
  ($ as any).strictEq = () => BooleanType;
  ($ as any).strictNeq = () => BooleanType;

  // === Exo extensions ===
  $.assign = ($env: any, name: string, value: unknown) => {
    const current = $env.lookup(name);
    if (current !== undefined && isType(current) && isType(value as Type)) {
      // Merge types via SetType
      $env.mutate(name, makeSetType([current, value as Type]));
    } else {
      $env.mutate(name, value);
    }
    return value;
  };

  $.letBind = ($env: any, name: string, valueType: unknown, annotationThunk: (() => unknown) | null) => {
    if (annotationThunk) {
      const annotationType = annotationThunk() as Type;
      if (!typeCompatible(valueType as Type, annotationType)) {
        throw new Error(`Type error: expected ${showType(annotationType)}, got ${showType(valueType)}`);
      }
      $env.bind(name, annotationType);
    } else {
      $env.bind(name, valueType);
    }
    return UndefinedType;
  };

  $.block = ($env: any, bodyFn: ($env: unknown) => unknown) => {
    const child = $env.extend({});
    return bodyFn(child);
  };

  // Short-circuit operators: evaluate both, return SetType of possible results
  $.and = (a: unknown, bThunk: () => unknown) => {
    const b = bThunk();
    // && can return either operand depending on truthiness
    return makeSetType([a as Type, b as Type]);
  };
  $.or = (a: unknown, bThunk: () => unknown) => {
    const b = bThunk();
    // || can return either operand depending on truthiness
    return makeSetType([a as Type, b as Type]);
  };

  // === Import returns AnyType ===
  $.import = async ($env: any, name: string, _modulePath: string) => {
    $env.bind(name, AnyTypeProxy);
    return AnyTypeProxy;
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
  $type: build$type,
};

export default exoExtension;
