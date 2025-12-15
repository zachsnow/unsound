/**
 * AST
 *
 * Represents the core format for communication between the parser and compiler.
 */

/**
 * Start and end offsets in the source text.
 */
export interface Span {
  start: number;  // byte offset of first character
  end: number;    // byte offset after last character
}

/**
 * All nodes have an optional source location (Span).
 */
export interface SpanExpr {
  loc?: Span;  // Source location (optional for backwards compat)
}

/**
 * All expression types.
 */
export type Expr =
  | LetExpr
  | LambdaExpr
  | AppExpr
  | IfExpr
  | ObjectExpr
  | ArrayExpr
  | IndexExpr
  | AssignIndexExpr
  | LiteralExpr
  | IdentifierExpr

/**
 * Represents `let name = value in body`.
 */
export interface LetExpr extends SpanExpr {
  type: 'LetExpr';
  name: string;
  nameLoc?: Span;  // Location of the binding name
  value: Expr;
  body: Expr;
}

/**
 * Represents `(param, ...) => body`.
 */
export interface LambdaExpr extends SpanExpr {
  type: 'LambdaExpr';
  params: Param[];
  body: Expr;
}

export interface Param extends SpanExpr {
  name: string;
}

/**
 * Represents `fn(arg, ...)`.
 */
export interface AppExpr extends SpanExpr {
  type: 'AppExpr';
  fn: Expr;
  args: Expr[];
}

/**
 * Represents `if cond then then else else`.
 */
export interface IfExpr extends SpanExpr {
  type: 'IfExpr';
  cond: Expr;
  then: Expr;
  else: Expr;
}

/**
 * Represents `{ key: value, ... }`.
 */
export interface ObjectExpr extends SpanExpr {
  type: 'ObjectExpr';
  properties: { key: string; keyLoc?: Span; value: Expr }[];
}

/**
 * Represents `[elem, ...]`.
 */
export interface ArrayExpr extends SpanExpr {
  type: 'ArrayExpr';
  elements: Expr[];
}

/**
 * Represents `object[key]`.
 */
export interface IndexExpr extends SpanExpr {
  type: 'IndexExpr';
  object: Expr;
  key: Expr;
}

/**
 * Represents `object[key] = value`.
 */
export interface AssignIndexExpr extends SpanExpr {
  type: 'AssignIndexExpr';
  object: Expr;
  key: Expr;
  value: Expr;
}

/**
 * Represents e.g. `42`, `"hello"`, `true`, `null`.
 */
export interface LiteralExpr extends SpanExpr {
  type: 'LiteralExpr';
  value: number | string | boolean | null;
}

/**
 * Represents an identifier, e.g. `foo`.
 */
export interface IdentifierExpr extends SpanExpr {
  type: 'IdentifierExpr';
  name: string;
}
