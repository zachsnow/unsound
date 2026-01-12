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
    "$=": { prec: 3, assoc: "left", method: "op$=" },  // type compatibility: expected $= actual
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

  // Helper: create a parser that matches operators from a table (longest first)
  const makeOpParser = (
    getTable: () => Record<string, unknown>,
    label: string
  ): (() => Parser<{ op: string; start: number }>) =>
    () => (input, pos) => {
      const ws = $.ws()(input, pos);
      const p = ws.pos;

      // Sort by length descending (table may be modified by operator declarations)
      const ops = Object.keys(getTable()).sort((a, b) => b.length - a.length);

      for (const op of ops) {
        if (input.startsWith(op, p)) {
          return { ok: true, value: { op, start: p }, pos: p + op.length };
        }
      }

      return { ok: false, expected: label, pos: p };
    };

  $.binaryOp = makeOpParser(() => $.operators.binary, "binary operator");
  $.prefixOp = makeOpParser(() => $.operators.prefix, "prefix operator");
  $.postfixOp = makeOpParser(() => $.operators.postfix, "postfix operator");

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

  // Override lambdaBody to support noAssign option (for type annotations)
  $.lambdaBody = ((opts?: { noAssign?: boolean }) =>
    opts?.noAssign ? $.binaryExpr(0) : $.lazy(() => $.expr())) as typeof $.lambdaBody;

  // Helper: parse optional type annotation `: type`
  // Uses lambda({ noAssign: true }) or binaryExpr to avoid consuming `=`
  const typeAnnotation = (): Parser<EExpr> => (input, pos) => {
    const colon = $.token(":")(input, pos);
    if (!colon.ok) return colon;
    // Try lambda with non-assignment body first
    const lambda = $.lambda({ noAssign: true })(input, colon.pos);
    if (lambda.ok) return lambda;
    // Fall back to binaryExpr for simple types like `Number`
    return $.binaryExpr(0)(input, colon.pos);
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

  // ---------------------------------------------------------------------------
  // Type Interface & Helpers
  // ---------------------------------------------------------------------------

  interface Type {
    [TYPE_TAG]: string;
    value?: unknown;
    toJSON?: () => unknown;
  }

  /** Check if value is a Type object */
  const isType = (t: unknown): t is Type =>
    typeof t === "object" && t !== null && TYPE_TAG in t;

  /** Check if value is a Type with specific tag */
  const hasTag = (t: unknown, tag: string): t is Type =>
    isType(t) && t[TYPE_TAG] === tag;

  /** Convert type to JSON, using toJSON if available */
  const typeToJSON = (t: unknown): unknown =>
    isType(t) && t.toJSON ? t.toJSON() : t;

  /** Extract string value from a dependent StringType, or null */
  const getStringValue = (t: unknown): string | null =>
    hasTag(t, "String") && t.value !== undefined ? t.value as string : null;

  /** Extract number value from a dependent NumberType, or null */
  const getNumberValue = (t: unknown): number | null =>
    hasTag(t, "Number") && t.value !== undefined ? t.value as number : null;

  // ---------------------------------------------------------------------------
  // Function Tagging
  // ---------------------------------------------------------------------------

  const UNSOUND_FN_TAG = Symbol("unsound-fn");

  /** Tag a function as an Unsound type-level function */
  const tagFn = <T extends Function>(fn: T): T => {
    (fn as any)[UNSOUND_FN_TAG] = true;
    return fn;
  };

  /** Check if function is tagged as Unsound */
  const isUnsoundFn = (fn: unknown): boolean =>
    typeof fn === "function" && (fn as any)[UNSOUND_FN_TAG] === true;

  // ---------------------------------------------------------------------------
  // Operator Method Factory
  // ---------------------------------------------------------------------------

  /**
   * Factory that creates operator methods bound to a type instance.
   * Used by primitive types to implement +, -, ==, <, etc.
   */
  const ops = (t: Type) => ({
    /** Binary numeric op: Number × Number → Number */
    num: (op: (a: number, b: number) => number) =>
      tagFn((other: unknown) => {
        if (!hasTag(other, "Number")) {
          throw new Error(`Type error: expected Number, got ${showType(other)}`);
        }
        if (t.value !== undefined && other.value !== undefined) {
          return makeNumberType(op(t.value as number, other.value as number));
        }
        return NumberType;
      }),

    /** Binary string op: String × String → String */
    str: (op: (a: string, b: string) => string) =>
      tagFn((other: unknown) => {
        if (!hasTag(other, "String")) {
          throw new Error(`Type error: expected String, got ${showType(other)}`);
        }
        if (t.value !== undefined && other.value !== undefined) {
          return makeStringType(op(t.value as string, other.value as string));
        }
        return StringType;
      }),

    /** Comparison op: T × T → Boolean (op computes value if both operands known) */
    cmp: (expectedTag: string, op?: (a: any, b: any) => boolean) =>
      tagFn((other: unknown) => {
        if (!hasTag(other, expectedTag)) {
          throw new Error(`Type error: expected ${expectedTag}, got ${showType(other)}`);
        }
        if (op && t.value !== undefined && other.value !== undefined) {
          return makeBooleanType(op(t.value, other.value));
        }
        return BooleanType;
      }),

    /** Type compatibility: this (expected) $= actual → Boolean
     *  Returns true if actual is assignable to this type.
     */
    compat: (expectedTag: string) =>
      tagFn((actual: unknown): Type => {
        // Any is compatible with everything
        if (hasTag(actual, "Any")) { return makeBooleanType(true); }

        // SetType: all members must be compatible with this
        if (hasTag(actual, "Set")) {
          const allCompat = (actual as SetType).types.every(member => {
            const result = (t["op$="] as Function)(member);
            return hasTag(result, "Boolean") && result.value === true;
          });
          return makeBooleanType(allCompat);
        }

        // Must be same type tag
        if (!hasTag(actual, expectedTag)) {
          return makeBooleanType(false);
        }

        // No value constraint on expected = any value is ok
        if (t.value === undefined) { return makeBooleanType(true); }

        // Value constraint must match exactly
        return makeBooleanType((actual as Type).value === t.value);
      }),
  });

  // ---------------------------------------------------------------------------
  // Primitive Types
  // ---------------------------------------------------------------------------

  const makeNumberType = (value?: number): Type & Record<string, unknown> => {
    const t: Type & Record<string, unknown> = { [TYPE_TAG]: "Number" };
    if (value !== undefined) { t.value = value; }
    t.toJSON = () => value !== undefined ? { type: "Number", value } : { type: "Number" };

    const { num, cmp, compat } = ops(t);
    t["op+"] = num((a, b) => a + b);
    t["op-"] = num((a, b) => a - b);
    t["op*"] = num((a, b) => a * b);
    t["op/"] = num((a, b) => a / b);
    t["op%"] = num((a, b) => a % b);
    t["opNeg"] = tagFn(() => value !== undefined ? makeNumberType(-value) : NumberType);
    t["op=="] = cmp("Number", (a, b) => a === b);
    t["op!="] = cmp("Number", (a, b) => a !== b);
    t["op<"] = cmp("Number", (a, b) => a < b);
    t["op>"] = cmp("Number", (a, b) => a > b);
    t["op<="] = cmp("Number", (a, b) => a <= b);
    t["op>="] = cmp("Number", (a, b) => a >= b);
    t["op$="] = compat("Number");
    return t;
  };

  const makeStringType = (value?: string): Type & Record<string, unknown> => {
    const t: Type & Record<string, unknown> = { [TYPE_TAG]: "String" };
    if (value !== undefined) { t.value = value; }
    t.toJSON = () => value !== undefined ? { type: "String", value } : { type: "String" };

    const { str, cmp, compat } = ops(t);
    t["op+"] = str((a, b) => a + b);
    t["op=="] = cmp("String", (a, b) => a === b);
    t["op!="] = cmp("String", (a, b) => a !== b);
    t["op<"] = cmp("String", (a, b) => a < b);
    t["op>"] = cmp("String", (a, b) => a > b);
    t["op<="] = cmp("String", (a, b) => a <= b);
    t["op>="] = cmp("String", (a, b) => a >= b);
    t["op$="] = compat("String");
    t["length"] = value !== undefined ? makeNumberType(value.length) : NumberType;
    return t;
  };

  const makeBooleanType = (value?: boolean): Type & Record<string, unknown> => {
    const t: Type & Record<string, unknown> = { [TYPE_TAG]: "Boolean" };
    if (value !== undefined) { t.value = value; }
    t.toJSON = () => value !== undefined ? { type: "Boolean", value } : { type: "Boolean" };

    const { cmp, compat } = ops(t);
    t["op!"] = tagFn(() => value !== undefined ? makeBooleanType(!value) : BooleanType);
    t["op&&"] = cmp("Boolean");
    t["op||"] = cmp("Boolean");
    t["op=="] = cmp("Boolean");
    t["op!="] = cmp("Boolean");
    t["op$="] = compat("Boolean");
    return t;
  };

  // Singleton types with compatibility
  const makeSingletonCompat = (tag: string) => tagFn((actual: unknown) => {
    if (hasTag(actual, "Any")) { return makeBooleanType(true); }
    if (hasTag(actual, "Set")) {
      const allCompat = (actual as SetType).types.every(member => hasTag(member, tag));
      return makeBooleanType(allCompat);
    }
    return makeBooleanType(hasTag(actual, tag));
  });

  const NullType: Type & Record<string, unknown> = {
    [TYPE_TAG]: "null",
    toJSON: () => ({ type: "null" }),
    "op$=": makeSingletonCompat("null"),
  };
  const UndefinedType: Type & Record<string, unknown> = {
    [TYPE_TAG]: "undefined",
    toJSON: () => ({ type: "undefined" }),
    "op$=": makeSingletonCompat("undefined"),
  };

  // Generic (non-dependent) primitive types
  const NumberType = makeNumberType();
  const StringType = makeStringType();
  const BooleanType = makeBooleanType();

  // ---------------------------------------------------------------------------
  // AnyType - Escape Hatch
  // ---------------------------------------------------------------------------
  // AnyType is a proxy that returns itself for any operation, allowing
  // interop with untyped JS code. It's like TypeScript's `any`.

  const AnyType: Type = { [TYPE_TAG]: "Any", toJSON: () => ({ type: "Any" }) };

  // Create proxy that returns itself for all operations
  // Note: Must not implement .then or JS will treat it as a thenable,
  // causing async functions to hang when returning AnyTypeProxy.
  const AnyTypeProxy: Type = new Proxy(AnyType, {
    get(target, prop) {
      if (prop === TYPE_TAG) return "Any";
      if (prop === "toJSON") return target.toJSON;
      if (prop === "then") return undefined;
      // Any operation returns the proxy itself
      return (..._args: unknown[]) => AnyTypeProxy;
    }
  });

  // ---------------------------------------------------------------------------
  // SetType - Union Types
  // ---------------------------------------------------------------------------
  // SetType represents a union of possible types. When you access a property
  // or call a method, it forwards to each member type and collects results.

  interface SetType extends Type {
    types: Type[];
  }

  const makeSetType = (types: Type[]): Type => {
    // Flatten nested SetTypes
    const flatTypes: Type[] = [];
    for (const t of types) {
      if (hasTag(t, "Set")) {
        flatTypes.push(...(t as SetType).types);
      } else {
        flatTypes.push(t);
      }
    }

    // Deduplicate by reference
    const uniqueTypes = [...new Set(flatTypes)];

    // Simplify: single type doesn't need wrapping
    if (uniqueTypes.length === 1) { return uniqueTypes[0]; }

    // Simplify: Any absorbs everything
    if (uniqueTypes.some(t => hasTag(t, "Any"))) { return AnyTypeProxy; }

    const setType: SetType = {
      [TYPE_TAG]: "Set",
      types: uniqueTypes,
      toJSON: () => ({ type: "Set", types: uniqueTypes.map(typeToJSON) }),
    };

    // Proxy forwards property access to all member types
    return new Proxy(setType, {
      get(target, prop) {
        // Direct properties
        if (prop === TYPE_TAG) { return "Set"; }
        if (prop === "types") { return target.types; }
        if (prop === "toJSON") { return target.toJSON; }
        if (prop === "value") { return undefined; }

        // Collect property from each member type
        const results: unknown[] = [];
        for (const t of target.types) {
          const val = (t as any)[prop];
          if (val !== undefined) {
            results.push(val);
          }
        }
        if (results.length === 0) { return undefined; }

        // If all are functions, return wrapper that calls each
        if (results.every(r => typeof r === "function")) {
          return tagFn((...args: unknown[]) => {
            const callResults = results.map(fn => (fn as Function)(...args));
            return makeSetType(callResults as Type[]);
          });
        }

        return makeSetType(results as Type[]);
      }
    });
  };

  // ---------------------------------------------------------------------------
  // Compound Types: Array and Object
  // ---------------------------------------------------------------------------

  interface ArrayType extends Type {
    elements?: Type[];      // Tuple: known element types
    elementType?: Type;     // Array: shared element type
    length: Type;
  }

  const makeArrayType = (elementsOrType: Type[] | Type): ArrayType & Record<string, unknown> => {
    const isTuple = Array.isArray(elementsOrType);
    const elements = isTuple ? elementsOrType : undefined;
    const elementType = isTuple ? undefined : elementsOrType;

    const arr: ArrayType & Record<string, unknown> = {
      [TYPE_TAG]: "Array",
      elements,
      elementType,
      length: isTuple ? makeNumberType(elementsOrType.length) : NumberType,
      toJSON: () => isTuple
        ? { type: "Array", elements: elementsOrType.map(typeToJSON) }
        : { type: "Array", elementType: typeToJSON(elementsOrType) },
    };

    // Array methods - push returns the new length (Number)
    arr.push = tagFn((_elem: unknown) => NumberType);
    arr.pop = tagFn(() => isTuple && elements!.length > 0
      ? makeSetType([elements![elements!.length - 1], UndefinedType])
      : UndefinedType);
    arr.shift = tagFn(() => isTuple && elements!.length > 0
      ? makeSetType([elements![0], UndefinedType])
      : UndefinedType);
    arr.unshift = tagFn((_elem: unknown) => NumberType);
    arr.concat = tagFn((_other: unknown) => makeArrayType(AnyTypeProxy));
    arr.slice = tagFn(() => makeArrayType(isTuple ? makeSetType(elements!) : (elementType ?? AnyTypeProxy)));
    arr.map = tagFn((fn: unknown) => {
      if (typeof fn === "function" && isUnsoundFn(fn)) {
        // Apply fn to element type to get result type
        const resultType = isTuple
          ? makeSetType(elements!.map(e => fn(e) as Type))
          : fn(elementType ?? AnyTypeProxy) as Type;
        return makeArrayType(resultType);
      }
      return makeArrayType(AnyTypeProxy);
    });
    arr.filter = tagFn(() => makeArrayType(isTuple ? makeSetType(elements!) : (elementType ?? AnyTypeProxy)));
    arr.forEach = tagFn(() => UndefinedType);
    arr.join = tagFn(() => StringType);
    arr.indexOf = tagFn(() => NumberType);
    arr.includes = tagFn(() => BooleanType);

    return arr;
  };

  interface ObjectType extends Type {
    props?: Record<string, Type>;  // Object: known property types
    valueType?: Type;              // Record: shared value type
  }

  const makeObjectType = (props: Record<string, Type>): ObjectType => {
    const jsonProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      jsonProps[k] = typeToJSON(v);
    }
    return {
      [TYPE_TAG]: "Object",
      props,
      toJSON: () => ({ type: "Object", props: jsonProps }),
    };
  };

  // ---------------------------------------------------------------------------
  // Type Display & Compatibility
  // ---------------------------------------------------------------------------

  /** Format a type for error messages */
  const showType = (t: unknown): string => {
    if (t === null) { return "null"; }
    if (typeof t === "function") { return "<function>"; }
    if (!isType(t)) { return String(t); }

    const tag = t[TYPE_TAG];
    if (tag === "Set") {
      return `(${(t as SetType).types.map(showType).join(" | ")})`;
    }
    if (t.value !== undefined) {
      return `${tag}(${JSON.stringify(t.value)})`;
    }
    return tag;
  };

  // ==========================================================================
  // INTERPRETER OPERATIONS
  // ==========================================================================

  // === Environment ===
  // Error is a function that throws a type error with a custom message.
  // Use in unreachable branches: if valid then result else Error("why it's invalid")
  const errorFn = tagFn((msg: unknown) => {
    const msgStr = hasTag(msg, "String") && msg.value !== undefined
      ? msg.value as string
      : "type error";
    throw new Error(`Type error: ${msgStr}`);
  });

  $.env = () => createEnv({
    Number: NumberType,
    String: StringType,
    Boolean: BooleanType,
    Null: NullType,
    Undefined: UndefinedType,
    Any: AnyTypeProxy,
    Error: errorFn,
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
      // Only call Unsound-tagged functions; raw JS functions return Any
      if (!isUnsoundFn(fn)) { return AnyTypeProxy; }
      return fn(...args);
    }
    // AnyType is callable
    if (hasTag(fn, "Any")) { return AnyTypeProxy; }
    throw new Error(`Type error: cannot call non-function type ${showType(fn)}`);
  };

  // === Control ===
  $.if = (cond: unknown, thenFn: ($env: any) => unknown, elseFn: ($env: any) => unknown, $env: any) => {
    // Condition must be boolean (or Any)
    if (isType(cond) && !hasTag(cond, "Boolean") && !hasTag(cond, "Any")) {
      throw new Error(`Type error: condition must be Boolean, got ${showType(cond)}`);
    }
    // Dependent boolean: only evaluate relevant branch
    if (hasTag(cond, "Boolean") && cond.value !== undefined) {
      return cond.value ? thenFn($env) : elseFn($env);
    }
    // Non-dependent: return set of both branches
    return makeSetType([thenFn($env) as Type, elseFn($env) as Type]);
  };

  // === Data Structures ===
  $.object = (props: Record<string, unknown>) => makeObjectType(props as Record<string, Type>);
  $.array = (elems: unknown[]) => makeArrayType(elems as Type[]);

  // === Indexing ===
  $.index = (obj: unknown, key: unknown) => {
    if (!isType(obj)) { return AnyTypeProxy; }
    if (hasTag(obj, "Any")) { return AnyTypeProxy; }

    // Object: look up property by key
    if (hasTag(obj, "Object")) {
      const objType = obj as ObjectType;
      if (objType.props) {
        const keyStr = getStringValue(key);
        if (keyStr !== null) {
          const prop = objType.props[keyStr];
          if (prop !== undefined) { return prop; }
        }
        // Unknown or non-dependent key: could be any prop or undefined
        return makeSetType([...Object.values(objType.props), UndefinedType]);
      }
      if (objType.valueType) {
        return makeSetType([objType.valueType, UndefinedType]);
      }
    }

    // Array: property access or element indexing
    if (hasTag(obj, "Array")) {
      const arrType = obj as ArrayType;

      // Property access (e.g., .length)
      const keyStr = getStringValue(key);
      if (keyStr !== null) {
        const prop = (arrType as any)[keyStr];
        if (prop !== undefined) { return prop; }
      }

      // Element indexing
      if (arrType.elements) {
        const idx = getNumberValue(key);
        if (idx !== null) {
          if (idx >= 0 && idx < arrType.elements.length) {
            return arrType.elements[idx];
          }
          return UndefinedType;
        }
        // Non-dependent index: could be any element or undefined
        return makeSetType([...arrType.elements, UndefinedType]);
      }
      if (arrType.elementType) {
        return makeSetType([arrType.elementType, UndefinedType]);
      }
    }

    // SetType: forward to each member
    if (hasTag(obj, "Set")) {
      const results = (obj as SetType).types.map(t => $.index(t, key));
      // If all results are functions, wrap them
      if (results.every(r => typeof r === "function")) {
        return tagFn((...args: unknown[]) => {
          const callResults = results.map(fn => (fn as Function)(...args));
          return makeSetType(callResults as Type[]);
        });
      }
      return makeSetType(results as Type[]);
    }

    // Fallback: direct property access (for operators, etc.)
    const keyStr = getStringValue(key) ?? String(key);
    const val = (obj as any)[keyStr];
    if (val !== undefined) { return val; }

    return UndefinedType;
  };

  $.assignIndex = (_obj: unknown, _key: unknown, value: unknown) => {
    // TODO: track mutations to object types
    return value;
  };

  // === Operators ===
  ($ as any).strictEq = () => BooleanType;
  ($ as any).strictNeq = () => BooleanType;

  // Short-circuit: both paths evaluated, return union of possible results
  $.and = (a: unknown, bThunk: () => unknown) => makeSetType([a as Type, bThunk() as Type]);
  $.or = (a: unknown, bThunk: () => unknown) => makeSetType([a as Type, bThunk() as Type]);

  // === Exo Statement Extensions ===

  $.assign = ($env: any, name: string, value: unknown) => {
    const current = $env.lookup(name);
    // Merge with existing type if both are types
    if (current !== undefined && isType(current) && isType(value as Type)) {
      $env.mutate(name, makeSetType([current, value as Type]));
    } else {
      $env.mutate(name, value);
    }
    return value;
  };

  $.letBind = ($env: any, name: string, valueType: unknown, annotationThunk: (() => unknown) | null) => {
    if (annotationThunk) {
      const annotationType = annotationThunk() as Type;
      // Use op$= for type compatibility check
      const compatFn = (annotationType as Record<string, unknown>)["op$="];
      if (typeof compatFn === "function" && isUnsoundFn(compatFn)) {
        const result = compatFn(valueType);
        if (hasTag(result, "Boolean") && result.value === false) {
          throw new Error(`Type error: expected ${showType(annotationType)}, got ${showType(valueType)}`);
        }
        // If result is not Boolean(true), it might be Boolean (non-dependent), treat as ok
      } else {
        // No op$= method, fall back to Any-like behavior (accept everything)
      }
      $env.bind(name, annotationType);
    } else {
      $env.bind(name, valueType);
    }
    return UndefinedType;
  };

  $.block = ($env: any, bodyFn: ($env: unknown) => unknown) => {
    return bodyFn($env.extend({}));
  };

  // === Interop ===
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
