/**
 * Core parser.
 */
import type {
  Expr,
  LetExpr,
  LambdaExpr,
  IfExpr,
  ObjectExpr,
  ArrayExpr,
  IndexExpr,
  AssignIndexExpr,
  LiteralExpr,
  IdentifierExpr,
  Span,
  Param,
} from "./ast.ts";
import { Builder, ParseOps } from "./types.ts";
import { fix, posToLineCol } from "./util.ts";

export type ParseResult<T> =
  | { ok: true; value: T; pos: number }
  | { ok: false; expected: string; pos: number };

export type Parser<T> = (input: string, pos: number) => ParseResult<T>;

export interface CoreParseOps extends ParseOps<string, Expr> {
  // === Primitive combinators ===
  char: (c: string) => Parser<string>;
  satisfy: (pred: (c: string) => boolean, name: string) => Parser<string>;
  str: (s: string) => Parser<string>;
  eof: () => Parser<null>;

  // === Higher-order combinators ===
  seq: <T extends unknown[]>(...parsers: { [K in keyof T]: Parser<T[K]> }) => Parser<T>;
  alt: <T>(...parsers: Parser<T>[]) => Parser<T>;
  many: <T>(p: Parser<T>) => Parser<T[]>;
  many1: <T>(p: Parser<T>) => Parser<T[]>;
  map: <A, B>(p: Parser<A>, fn: (a: A, loc: Span) => B) => Parser<B>;
  opt: <T>(p: Parser<T>) => Parser<T | null>;
  lazy: <T>(fn: () => Parser<T>) => Parser<T>;
  sepBy: <T, S>(p: Parser<T>, sep: Parser<S>) => Parser<T[]>;
  sepBy1: <T, S>(p: Parser<T>, sep: Parser<S>) => Parser<T[]>;
  between: <A, B, C>(open: Parser<A>, p: Parser<B>, close: Parser<C>) => Parser<B>;

  // Location tracking: wrap parser to return { value, loc }
  withLoc: <T>(p: Parser<T>) => Parser<{ value: T; loc: Span }>;

  // === Whitespace and tokens ===
  whitespace: () => Parser<string>;
  ws: () => Parser<null>;  // Skip whitespace, return null
  token: (s: string) => Parser<string>;

  keywords: string[];  // List of keywords in the language; used with $.ident to stop matching keywords.
  keyword: (s: string) => Parser<string>;  // keyword that's not part of identifier

  // === Lexemes ===
  digit: () => Parser<string>;
  letter: () => Parser<string>;
  identChar: () => Parser<string>;
  numberLit: () => Parser<number>;
  stringLit: () => Parser<string>;
  ident: () => Parser<string>;

  // === Grammar rules (the extensible part) ===
  // Each rule is broken into small semantic pieces for extension overriding

  // Program structure
  program: () => Parser<Expr>;
  expr: () => Parser<Expr>;

  // Let expressions - broken into pieces
  letExpr: () => Parser<LetExpr>;
  letKeyword: () => Parser<string>;              // "let"
  letBinding: () => Parser<{ name: string; nameLoc: Span }>;  // the "x" in "let x = ..."
  letInitializer: () => Parser<Expr>;            // "= expr"
  letInKeyword: () => Parser<string>;            // "in"
  letBody: () => Parser<Expr>;                   // body expression

  // Lambda expressions - broken into pieces
  lambda: () => Parser<LambdaExpr>;
  lambdaParams: () => Parser<Param[]>;  // (x, y, z)
  lambdaParam: () => Parser<Param>;     // single param
  lambdaArrow: () => Parser<string>;             // "=>"
  lambdaBody: () => Parser<Expr>;                // body expression

  // If expressions - broken into pieces
  ifExpr: () => Parser<IfExpr>;
  ifKeyword: () => Parser<string>;               // "if"
  ifCondition: () => Parser<Expr>;               // condition expression
  thenKeyword: () => Parser<string>;             // "then"
  thenBranch: () => Parser<Expr>;                // then expression
  elseKeyword: () => Parser<string>;             // "else"
  elseBranch: () => Parser<Expr>;                // else expression

  // Application and access - broken into pieces
  appExpr: () => Parser<Expr>;
  callSuffix: () => Parser<Expr[]>;              // (args) - returns args
  memberName: () => Parser<string>;              // field name (allows keywords after .)
  memberSuffix: () => Parser<{ value: string; loc: Span }>;  // .field
  indexSuffix: () => Parser<Expr>;               // [key]

  // Assignment (SetIndex)
  assignExpr: () => Parser<Expr>;

  // Atoms
  atom: () => Parser<Expr>;
  objectExpr: () => Parser<ObjectExpr>;
  arrayExpr: () => Parser<ArrayExpr>;
  literal: () => Parser<LiteralExpr>;
  identifierExpr: () => Parser<IdentifierExpr>;

  // Object properties
  property: () => Parser<{ key: string; keyLoc?: Span; value: Expr }>;
  propertyKey: () => Parser<{ value: string; loc: Span }>;

  // Function args and params (legacy, for compatibility)
  params: () => Parser<{ value: string; loc: Span }[]>;
  args: () => Parser<Expr[]>;
}

export class ParseError extends Error {
  pos: number;
  expected: string;

  constructor(pos: number, expected: string) {
    super(`Parse error at position ${pos}: expected ${expected}`);
    this.name = 'ParseError';
    this.pos = pos;
    this.expected = expected;
  }

  // Format with source context
  format(source: string): string {
    return formatParseError(source, this.pos, this.expected);
  }
}

// Format a parse error with source context
export function formatParseError(
  source: string,
  pos: number,
  expected: string
): string {
  const { line, col } = posToLineCol(source, pos);
  const lines = source.split('\n');

  // What did we actually find at this position?
  const found = pos >= source.length
    ? 'end of input'
    : source[pos] === '\n'
      ? 'newline'
      : `'${source.slice(pos, pos + 20).split('\n')[0]}${source.length - pos > 20 ? '...' : ''}'`;

  // Show context: 3 lines before and 2 lines after
  const contextBefore = 3;
  const contextAfter = 2;
  const startLine = Math.max(0, line - 1 - contextBefore);
  const endLine = Math.min(lines.length - 1, line - 1 + contextAfter);

  // Calculate line number width for alignment
  const maxLineNum = endLine + 1;
  const lineNumWidth = String(maxLineNum).length;

  const contextLines: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    const lineNum = String(i + 1).padStart(lineNumWidth, ' ');
    const marker = i === line - 1 ? '>' : ' ';
    contextLines.push(`${marker} ${lineNum} | ${lines[i]}`);

    // Add caret line for the error line
    if (i === line - 1) {
      const padding = ' '.repeat(lineNumWidth + 4); // "  NN | "
      const caret = ' '.repeat(col - 1) + '^';
      contextLines.push(`${padding}${caret}`);
    }
  }

  return [
    `Parse error at line ${line}, column ${col}`,
    `  expected: ${expected}`,
    `  found: ${found}`,
    '',
    ...contextLines
  ].join('\n');
}

// Base parser builder - mutates $ to add all parser operations
// All recursive calls go through $ for open recursion
export function build$parse(in$: ParseOps): void {
  const $ = in$ as CoreParseOps;

  // === Primitive combinators ===

  $.char = (c) => (input, pos) => {
    if (input[pos] === c) {
      return { ok: true, value: c, pos: pos + 1 };
    }
    return { ok: false, expected: `'${c}'`, pos };
  };

  $.satisfy = (pred, name) => (input, pos) => {
    if (pos < input.length && pred(input[pos])) {
      return { ok: true, value: input[pos], pos: pos + 1 };
    }
    return { ok: false, expected: name, pos };
  };

  $.str = (s) => (input, pos) => {
    if (input.slice(pos, pos + s.length) === s) {
      return { ok: true, value: s, pos: pos + s.length };
    }
    return { ok: false, expected: `"${s}"`, pos };
  };

  $.eof = () => (input, pos) => {
    if (pos >= input.length) {
      return { ok: true, value: null, pos };
    }
    return { ok: false, expected: "end of input", pos };
  };

  // === Higher-order combinators ===

  $.seq = (...parsers) => (input, pos) => {
    const results: unknown[] = [];
    let p = pos;
    for (const parser of parsers) {
      const r = parser(input, p);
      if (!r.ok) return r as ParseResult<any>;
      results.push(r.value);
      p = r.pos;
    }
    return { ok: true, value: results as any, pos: p };
  };

  $.alt = (...parsers) => (input, pos) => {
    let furthest: ParseResult<any> = {
      ok: false,
      expected: "alternative",
      pos,
    };
    for (const parser of parsers) {
      const r = parser(input, pos);
      if (r.ok) return r;
      if (r.pos > furthest.pos) furthest = r;
    }
    return furthest;
  };

  $.many = (p) => (input, pos) => {
    const results: any[] = [];
    let current = pos;
    while (true) {
      const r = p(input, current);
      if (!r.ok) break;
      results.push(r.value);
      current = r.pos;
    }
    return { ok: true, value: results, pos: current };
  };

  $.many1 = (p) => (input, pos) => {
    const first = p(input, pos);
    if (!first.ok) return first as ParseResult<any[]>;
    const rest = $.many(p)(input, first.pos);
    if (!rest.ok) return rest;
    return { ok: true, value: [first.value, ...rest.value], pos: rest.pos };
  };

  // Map with location: fn receives (value, loc) - loc can be ignored if not needed
  $.map = (p, fn) => (input, pos) => {
    const ws = $.ws()(input, pos);
    const start = ws.pos;
    const r = p(input, pos);
    if (!r.ok) return r as ParseResult<any>;
    return { ok: true, value: fn(r.value, { start, end: r.pos }), pos: r.pos };
  };

  $.opt = (p) => (input, pos) => {
    const r = p(input, pos);
    if (r.ok) return r;
    return { ok: true, value: null, pos };
  };

  $.lazy = (fn) => (input, pos) => fn()(input, pos);

  $.sepBy = (p, sep) => (input, pos) => {
    const first = p(input, pos);
    if (!first.ok) return { ok: true, value: [], pos };

    const results = [first.value];
    let current = first.pos;

    while (true) {
      const sepResult = sep(input, current);
      if (!sepResult.ok) break;
      const next = p(input, sepResult.pos);
      if (!next.ok) break;
      results.push(next.value);
      current = next.pos;
    }

    return { ok: true, value: results, pos: current };
  };

  $.sepBy1 = (p, sep) => (input, pos) => {
    const result = $.sepBy(p, sep)(input, pos);
    if (!result.ok) return result;
    if (result.value.length === 0) {
      return { ok: false, expected: "at least one element", pos };
    }
    return result;
  };

  $.between = (open, p, close) => (input, pos) => {
    const o = open(input, pos);
    if (!o.ok) return o as ParseResult<any>;
    const content = p(input, o.pos);
    if (!content.ok) return content;
    const c = close(input, content.pos);
    if (!c.ok) return c as ParseResult<any>;
    return { ok: true, value: content.value, pos: c.pos };
  };

  // Wrap a parser to return { value, loc } for capturing sub-part positions
  $.withLoc = (p) => (input, pos) => {
    const ws = $.ws()(input, pos);
    const start = ws.pos;
    const r = p(input, pos);
    if (!r.ok) return r as ParseResult<any>;
    return { ok: true, value: { value: r.value, loc: { start, end: r.pos } }, pos: r.pos };
  };

  // === Whitespace and tokens ===

  // Single whitespace character
  const wsChar = $.satisfy(
    (c) => c === " " || c === "\n" || c === "\t" || c === "\r",
    "whitespace"
  );

  // Line comment: // ... until end of line
  const lineComment = () => (input: string, pos: number) => {
    if (input.slice(pos, pos + 2) !== '//') {
      return { ok: false, expected: "comment", pos };
    }
    let end = pos + 2;
    while (end < input.length && input[end] !== '\n') {
      end++;
    }
    return { ok: true, value: "", pos: end };
  };

  // Block comment: /* ... */
  const blockComment = () => (input: string, pos: number) => {
    if (input.slice(pos, pos + 2) !== '/*') {
      return { ok: false, expected: "comment", pos };
    }
    let end = pos + 2;
    while (end < input.length - 1) {
      if (input.slice(end, end + 2) === '*/') {
        return { ok: true, value: "", pos: end + 2 };
      }
      end++;
    }
    return { ok: false, expected: "*/", pos: end };
  };

  $.whitespace = () => (input: string, pos: number) => {
    let current = pos;
    while (current < input.length) {
      // Try whitespace char
      const wsResult = wsChar(input, current);
      if (wsResult.ok) {
        current = wsResult.pos;
        continue;
      }
      // Try line comment
      const lineResult = lineComment()(input, current);
      if (lineResult.ok) {
        current = lineResult.pos;
        continue;
      }
      // Try block comment
      const blockResult = blockComment()(input, current);
      if (blockResult.ok) {
        current = blockResult.pos;
        continue;
      }
      break;
    }
    return { ok: true, value: "", pos: current };
  };

  // Note: can't use $.map here because $.map calls $.ws (would be circular)
  $.ws = () => (input, pos) => {
    const r = $.whitespace()(input, pos);
    return { ok: true, value: null, pos: r.pos };
  };

  $.token = (s) => (input, pos) => {
    const ws = $.ws()(input, pos);
    return $.str(s)(input, ws.pos);
  };

  $.keywords = ["let", "in", "if", "then", "else", "true", "false", "null"];

  $.keyword = (s) => (input, pos) => {
    const ws = $.ws()(input, pos);
    const kw = $.str(s)(input, ws.pos);
    if (!kw.ok) return kw;
    // Make sure keyword is not followed by identifier char
    if (kw.pos < input.length) {
      const next = input[kw.pos];
      if (
        (next >= "a" && next <= "z") ||
        (next >= "A" && next <= "Z") ||
        (next >= "0" && next <= "9") ||
        next === "_" ||
        next === "$"
      ) {
        return { ok: false, expected: `keyword "${s}"`, pos: ws.pos };
      }
    }
    return kw;
  };

  // === Lexemes ===

  $.digit = () => $.satisfy((c) => c >= "0" && c <= "9", "digit");

  $.letter = () =>
    $.satisfy(
      (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z"),
      "letter"
    );

  $.identChar = () =>
    $.satisfy(
      (c) =>
        (c >= "a" && c <= "z") ||
        (c >= "A" && c <= "Z") ||
        (c >= "0" && c <= "9") ||
        c === "_" ||
        c === "$",
      "identifier character"
    );

  $.numberLit = () => (input, pos) => {
    const ws = $.ws()(input, pos);
    const digits = $.many1($.digit())(input, ws.pos);
    if (!digits.ok) return { ok: false, expected: "number", pos: ws.pos };
    return {
      ok: true,
      value: parseInt(digits.value.join(""), 10),
      pos: digits.pos,
    };
  };

  $.stringLit = () => (input, pos) => {
    const ws = $.ws()(input, pos);
    const open = $.char('"')(input, ws.pos);
    if (!open.ok) return { ok: false, expected: "string", pos: ws.pos };

    let current = open.pos;
    let value = "";

    while (current < input.length && input[current] !== '"') {
      if (input[current] === "\\" && current + 1 < input.length) {
        const next = input[current + 1];
        switch (next) {
          case "n":
            value += "\n";
            break;
          case "t":
            value += "\t";
            break;
          case "r":
            value += "\r";
            break;
          case "\\":
            value += "\\";
            break;
          case '"':
            value += '"';
            break;
          default:
            value += next;
        }
        current += 2;
      } else {
        value += input[current];
        current++;
      }
    }

    if (current >= input.length) {
      return { ok: false, expected: 'closing "', pos: current };
    }

    return { ok: true, value, pos: current + 1 }; // Skip closing "
  };

  $.ident = () => (input, pos): ParseResult<string> => {
    const ws = $.ws()(input, pos);
    const first = $.alt($.letter(), $.char("_"), $.char("$"))(input, ws.pos);
    if (!first.ok) return { ok: false, expected: "identifier", pos: ws.pos };

    const rest = $.many($.identChar())(input, first.pos);

    // many() always succeeds, so we can safely access value
    const name =
      first.value +
      (rest as { ok: true; value: string[]; pos: number }).value.join("");
    const endPos = rest.pos;

    if ($.keywords.indexOf(name) !== -1) {
      return {
        ok: false,
        expected: "identifier (not a keyword)",
        pos: ws.pos,
      };
    }

    return { ok: true, value: name, pos: endPos };
  };

  // === Grammar rules ===

  $.program = () => (input, pos) => {
    const e = $.expr()(input, pos);
    if (!e.ok) return e;
    const end = $.seq($.ws(), $.eof())(input, e.pos);
    if (!end.ok) return end as ParseResult<any>;
    return e;
  };

  $.expr = () =>
    $.alt(
      $.lazy(() => $.letExpr()),
      $.lazy(() => $.lambda()),
      $.lazy(() => $.ifExpr()),
      $.lazy(() => $.assignExpr())
    );

  // Assignment: index = expr (low precedence, right-associative)
  $.assignExpr = () => (input, pos) => {
    // Skip whitespace to get true start for location tracking
    const wsStart = $.ws()(input, pos);
    const start = wsStart.pos;

    const left = $.appExpr()(input, pos);
    if (!left.ok) return left;

    // Check for = but not == (to avoid conflict with equality operator)
    const ws = $.ws()(input, left.pos);
    if (input[ws.pos] === '=' && input[ws.pos + 1] !== '=' && left.value.type === 'IndexExpr') {
      const value = $.expr()(input, ws.pos + 1);
      if (!value.ok) return value;
      return {
        ok: true,
        value: {
          type: 'AssignIndexExpr',
          object: (left.value as IndexExpr).object,
          key: (left.value as IndexExpr).key,
          value: value.value,
          loc: { start, end: value.pos },
        } satisfies AssignIndexExpr,
        pos: value.pos,
      };
    }

    return left;
  };

  // === Let expression pieces ===
  $.letKeyword = () => $.keyword("let");

  $.letBinding = () => $.map(
    $.withLoc($.ident()),
    (withLoc): { name: string; nameLoc: Span } => ({
      name: withLoc.value,
      nameLoc: withLoc.loc,
    })
  );

  $.letInitializer = () => (input, pos) => {
    const eq = $.token("=")(input, pos);
    if (!eq.ok) return eq as ParseResult<Expr>;
    return $.expr()(input, eq.pos);
  };

  $.letInKeyword = () => $.keyword("in");

  $.letBody = () => $.lazy(() => $.expr());

  $.letExpr = () => (input, pos) => {
    const ws = $.ws()(input, pos);
    const start = ws.pos;

    const kw = $.letKeyword()(input, pos);
    if (!kw.ok) return kw as ParseResult<LetExpr>;

    const binding = $.letBinding()(input, kw.pos);
    if (!binding.ok) return binding as ParseResult<LetExpr>;

    const value = $.letInitializer()(input, binding.pos);
    if (!value.ok) return value as ParseResult<LetExpr>;

    const inKw = $.letInKeyword()(input, value.pos);
    if (!inKw.ok) return inKw as ParseResult<LetExpr>;

    const body = $.letBody()(input, inKw.pos);
    if (!body.ok) return body as ParseResult<LetExpr>;

    return {
      ok: true,
      value: {
        type: "LetExpr",
        name: binding.value.name,
        nameLoc: binding.value.nameLoc,
        value: value.value,
        body: body.value,
        loc: { start, end: body.pos },
      },
      pos: body.pos,
    };
  };

  // === Lambda expression pieces ===
  $.lambdaParam = () => (input, pos) => {
    const ident = $.withLoc($.ident())(input, pos);
    if (!ident.ok) return ident as ParseResult<Param>;
    return {
      ok: true,
      value: {
        name: ident.value.value,
        loc: ident.value.loc,
      } satisfies Param,
      pos: ident.pos,
    };
  };

  $.lambdaParams = () => $.between(
    $.token("("),
    $.sepBy($.lazy(() => $.lambdaParam()), $.token(",")),
    $.token(")")
  );

  $.lambdaArrow = () => $.token("=>");

  $.lambdaBody = () => $.lazy(() => $.expr());

  $.lambda = () => (input, pos) => {
    const ws = $.ws()(input, pos);
    const start = ws.pos;

    const params = $.lambdaParams()(input, pos);
    if (!params.ok) return params as ParseResult<LambdaExpr>;

    const arrow = $.lambdaArrow()(input, params.pos);
    if (!arrow.ok) return arrow as ParseResult<LambdaExpr>;

    const body = $.lambdaBody()(input, arrow.pos);
    if (!body.ok) return body as ParseResult<LambdaExpr>;

    return {
      ok: true,
      value: {
        type: "LambdaExpr",
        params: params.value,
        body: body.value,
        loc: { start, end: body.pos },
      } satisfies LambdaExpr,
      pos: body.pos,
    };
  };

  // === If expression pieces ===
  $.ifKeyword = () => $.keyword("if");

  $.ifCondition = () => $.lazy(() => $.expr());

  $.thenKeyword = () => $.keyword("then");

  $.thenBranch = () => $.lazy(() => $.expr());

  $.elseKeyword = () => $.keyword("else");

  $.elseBranch = () => $.lazy(() => $.expr());

  $.ifExpr = () => (input, pos) => {
    const ws = $.ws()(input, pos);
    const start = ws.pos;

    const ifKw = $.ifKeyword()(input, pos);
    if (!ifKw.ok) return ifKw as ParseResult<IfExpr>;

    const cond = $.ifCondition()(input, ifKw.pos);
    if (!cond.ok) return cond as ParseResult<IfExpr>;

    const thenKw = $.thenKeyword()(input, cond.pos);
    if (!thenKw.ok) return thenKw as ParseResult<IfExpr>;

    const thenExpr = $.thenBranch()(input, thenKw.pos);
    if (!thenExpr.ok) return thenExpr as ParseResult<IfExpr>;

    const elseKw = $.elseKeyword()(input, thenExpr.pos);
    if (!elseKw.ok) return elseKw as ParseResult<IfExpr>;

    const elseExpr = $.elseBranch()(input, elseKw.pos);
    if (!elseExpr.ok) return elseExpr as ParseResult<IfExpr>;

    return {
      ok: true,
      value: {
        type: "IfExpr",
        cond: cond.value,
        then: thenExpr.value,
        else: elseExpr.value,
        loc: { start, end: elseExpr.pos },
      },
      pos: elseExpr.pos,
    };
  };

  // === Application and access pieces ===
  $.callSuffix = () => $.between(
    $.token("("),
    $.lazy(() => $.args()),
    $.token(")")
  );

  $.args = () =>
    $.sepBy(
      $.lazy(() => $.expr()),
      $.token(",")
    );

  // Member name allows identifiers OR keywords (e.g., obj.if is valid)
  $.memberName = () => (input, pos) => {
    const ws = $.ws()(input, pos);
    // Try identifier first
    const identResult = $.ident()(input, pos);
    if (identResult.ok) return identResult;
    // Try keywords - they're valid after a dot
    for (const kw of $.keywords) {
      const kwResult = $.str(kw)(input, ws.pos);
      if (kwResult.ok) {
        // Make sure it's not followed by identifier char (full keyword match)
        if (kwResult.pos < input.length) {
          const next = input[kwResult.pos];
          if ((next >= 'a' && next <= 'z') || (next >= 'A' && next <= 'Z') ||
            (next >= '0' && next <= '9') || next === '_' || next === '$') {
            continue; // Not a full keyword, try next
          }
        }
        return { ok: true, value: kw, pos: kwResult.pos };
      }
    }
    return { ok: false, expected: "member name", pos: ws.pos };
  };

  $.memberSuffix = () => (input, pos) => {
    const dot = $.token(".")(input, pos);
    if (!dot.ok) return dot as ParseResult<{ value: string; loc: Span }>;
    return $.withLoc($.memberName())(input, dot.pos);
  };

  $.indexSuffix = () => $.between(
    $.token("["),
    $.lazy(() => $.expr()),
    $.token("]")
  );

  // Application and index access - handles left recursion
  $.appExpr = () => (input, pos) => {
    // Skip whitespace to get true start for location tracking
    const ws = $.ws()(input, pos);
    const start = ws.pos;

    const atomResult = $.atom()(input, pos);
    if (!atomResult.ok) return atomResult;

    let current: ParseResult<Expr> = atomResult;

    while (true) {
      // Try function application: expr(args)
      const argsResult = $.callSuffix()(input, current.pos);

      if (argsResult.ok) {
        current = {
          ok: true,
          value: {
            type: "AppExpr",
            fn: current.value,
            args: argsResult.value,
            loc: { start, end: argsResult.pos },
          },
          pos: argsResult.pos,
        };
        continue;
      }

      // Try member access: expr.field -> Index with string literal key
      const memberResult = $.memberSuffix()(input, current.pos);

      if (memberResult.ok) {
        const fieldWithLoc = memberResult.value;
        current = {
          ok: true,
          value: {
            type: "IndexExpr",
            object: current.value,
            key: { type: "LiteralExpr", value: fieldWithLoc.value, loc: fieldWithLoc.loc } satisfies LiteralExpr,
            loc: { start, end: memberResult.pos },
          } satisfies IndexExpr,
          pos: memberResult.pos,
        };
        continue;
      }

      // Try index access: expr[key]
      const indexResult = $.indexSuffix()(input, current.pos);

      if (indexResult.ok) {
        current = {
          ok: true,
          value: {
            type: "IndexExpr",
            object: current.value,
            key: indexResult.value,
            loc: { start, end: indexResult.pos },
          } satisfies IndexExpr,
          pos: indexResult.pos,
        };
        continue;
      }

      break;
    }

    return current;
  };

  $.atom = () =>
    $.alt(
      $.lazy(() => $.objectExpr()),
      $.lazy(() => $.arrayExpr()),
      $.lazy(() => $.literal()),
      $.lazy(() => $.identifierExpr()),
      $.between(
        $.token("("),
        $.lazy(() => $.expr()),
        $.token(")")
      )
    );

  $.objectExpr = () =>
    $.map(
      $.between(
        $.token("{"),
        $.sepBy(
          $.lazy(() => $.property()),
          $.token(",")
        ),
        $.token("}")
      ),
      (properties, loc): ObjectExpr => ({
        type: "ObjectExpr",
        properties,
        loc,
      })
    );

  $.arrayExpr = () =>
    $.map(
      $.between(
        $.token("["),
        $.sepBy(
          $.lazy(() => $.expr()),
          $.token(",")
        ),
        $.token("]")
      ),
      (elements, loc): ArrayExpr => ({
        type: "ArrayExpr",
        elements,
        loc,
      })
    );

  $.literal = () =>
    $.alt<LiteralExpr>(
      $.map($.numberLit(), (value, loc): LiteralExpr => ({ type: "LiteralExpr", value, loc })),
      $.map($.stringLit(), (value, loc): LiteralExpr => ({ type: "LiteralExpr", value, loc })),
      $.map(
        $.keyword("true"),
        (_, loc): LiteralExpr => ({ type: "LiteralExpr", value: true, loc })
      ),
      $.map(
        $.keyword("false"),
        (_, loc): LiteralExpr => ({ type: "LiteralExpr", value: false, loc })
      ),
      $.map(
        $.keyword("null"),
        (_, loc): LiteralExpr => ({ type: "LiteralExpr", value: null, loc })
      )
    );

  $.identifierExpr = () => $.map($.ident(), (name, loc): IdentifierExpr => ({ type: "IdentifierExpr", name, loc }));

  // === Object property pieces ===
  $.propertyKey = () => $.withLoc($.alt($.ident(), $.stringLit()));

  $.property = () =>
    $.alt(
      // Full property: key: value (key can be identifier or string)
      $.map(
        $.seq(
          $.lazy(() => $.propertyKey()),
          $.token(":"),
          $.lazy(() => $.expr())
        ),
        ([keyWithLoc, _, value]) => {
          const k = keyWithLoc as { value: string; loc: Span };
          return { key: k.value, keyLoc: k.loc, value: value as Expr };
        }
      ),
      // Shorthand property: key (same as key: key) - only for identifiers
      $.map($.ident(), (key, loc) => ({
        key,
        keyLoc: loc,
        value: { type: "IdentifierExpr", name: key, loc } as IdentifierExpr,
      }))
    );
}

// Create the base parser
export const $parse = fix<CoreParseOps>(build$parse as Builder<CoreParseOps>);

// Convenience function
export function parse(input: string): Expr {
  const result = $parse.program()(input, 0);
  if (result.ok === true) {
    return result.value;
  }
  throw new Error(
    `Parse error at position ${result.pos}: expected ${result.expected}`
  );
}
