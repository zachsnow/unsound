/**
 * Exo Extension
 *
 * A JS-like language layer built directly on core.ts.
 * Adds: operators, statements, blocks, assignment, type annotations.
 */
import { Expr, IfExpr, Name, Span, SpanExpr } from "../ast";
import { CoreCompileOps } from "../compile";
import { CoreInterpretOps } from "../interpret";
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

interface VoidExpr extends SpanExpr {
  type: "VoidExpr";
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
  | AssignExpr
  | VoidExpr;

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
        const assoc = kind === "infix" ? assocOpt : undefined;

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

  $.declaration = () => (input, pos) => {
    const importDecl = $.importDeclaration()(input, pos);
    if (importDecl.ok) return importDecl;
    const opDecl = $.operatorDeclaration()(input, pos);
    if (opDecl.ok) return opDecl;
    return { ok: false, expected: "declaration", pos };
  };

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

  $.statement = () => (input, pos) => {
    // Try let statement first, then expression
    const letResult = $.letStmt()(input, pos);
    if (letResult.ok) return letResult;
    return $.expr()(input, pos);
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
  $.ifExpr = exoIfExpr as () => Parser<IfExpr>;

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
      case "VoidExpr":
        return ir.lit(undefined);

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
