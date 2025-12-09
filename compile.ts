/**
 * Core compiler.
 */
import type { Expr, LetExpr, LambdaExpr, AppExpr, IfExpr, ObjectExpr, ArrayExpr, IndexExpr, AssignIndex, LiteralExpr, IdentExpr } from './ast.ts';
import { ir, type IR } from './ir.ts';
import { fix } from './util.ts';

// Compiler operations interface - all methods can be overridden by extensions
export interface CompilerOps {
  // Main entry point
  compileProgram: (expr: Expr) => IR;

  // Expression compilation (the extensible part)
  compileExpr: (expr: Expr) => IR;
  compileLet: (expr: LetExpr) => IR;
  compileLambda: (expr: LambdaExpr) => IR;
  compileApp: (expr: AppExpr) => IR;
  compileIf: (expr: IfExpr) => IR;
  compileObject: (expr: ObjectExpr) => IR;
  compileArray: (expr: ArrayExpr) => IR;
  compileIndex: (expr: IndexExpr) => IR;
  compileSetIndex: (expr: AssignIndex) => IR;
  compileLiteral: (expr: LiteralExpr) => IR;
  compileIdent: (expr: IdentExpr) => IR;

  // IR constructors (for extensions)
  ir: typeof ir;

  // Error reporting (throws CompileError)
  error: (message: string) => never;

  // Helpers
  escapeIdent: (s: string) => string;
}

// Compile-time error
export class CompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompileError';
  }
}

// JS reserved words that need escaping
const JS_RESERVED = new Set([
  'break', 'case', 'catch', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'finally', 'for', 'function', 'if', 'in', 'instanceof',
  'new', 'return', 'switch', 'this', 'throw', 'try', 'typeof', 'var',
  'void', 'while', 'with', 'class', 'const', 'enum', 'export', 'extends',
  'import', 'super', 'implements', 'interface', 'let', 'package', 'private',
  'protected', 'public', 'static', 'yield', 'await', 'async'
]);

// Base compiler builder - mutates $ to add all compiler operations
export function build$compile($: CompilerOps): void {
  // Expose IR constructors for extensions
  $.ir = ir;

  // Main entry point: just compile the expression
  // The program wrapper is handled by emit functions
  $.compileProgram = (expr) => $.compileExpr(expr);

  // Dispatch to specific compilers based on type
  $.compileExpr = (expr) => {
    switch (expr.type) {
      case 'LetExpr': return $.compileLet(expr);
      case 'Lambda': return $.compileLambda(expr);
      case 'App': return $.compileApp(expr);
      case 'IfExpr': return $.compileIf(expr);
      case 'ObjectExpr': return $.compileObject(expr);
      case 'ArrayExpr': return $.compileArray(expr);
      case 'Index': return $.compileIndex(expr);
      case 'SetIndex': return $.compileSetIndex(expr);
      case 'Literal': return $.compileLiteral(expr);
      case 'Ident': return $.compileIdent(expr);
      default:
        // For extensions that add new node types
        return ir.lit(`/* unknown: ${(expr as any).type} */`);
    }
  };

  // let x = v in body
  // Compiles to: $.let($env, "x", ($env) => <v>, ($env) => <body>)
  // Both thunks receive $env - the child environment with the binding
  $.compileLet = (expr) => {
    return ir.$('let',
      ir.var('$env'),
      ir.lit(expr.name),
      ir.arrow(['$env'], $.compileExpr(expr.value)),
      ir.arrow(['$env'], $.compileExpr(expr.body))
    );
  };

  // (x, y) => body
  // Compiles to: $.lambda($env, ["x", "y"], ($env) => <body>)
  // Captures $env for lexical scoping; body gets child $env with params bound
  $.compileLambda = (expr) => {
    return ir.$('lambda',
      ir.var('$env'),
      ir.array(...expr.params.map(p => ir.lit(p))),
      ir.arrow(['$env'], $.compileExpr(expr.body))
    );
  };

  // f(a, b)
  // Compiles to: $.call(<f>, [<a>, <b>])
  $.compileApp = (expr) => {
    return ir.$('call',
      $.compileExpr(expr.fn),
      ir.array(...expr.args.map(a => $.compileExpr(a)))
    );
  };

  // if c then a else b
  // Compiles to: $.if(<c>, ($env) => <a>, ($env) => <b>, $env)
  // Both branches receive current $env for any lookups inside
  $.compileIf = (expr) => {
    return ir.$('if',
      $.compileExpr(expr.cond),
      ir.arrow(['$env'], $.compileExpr(expr.then)),
      ir.arrow(['$env'], $.compileExpr(expr.else)),
      ir.var('$env')
    );
  };

  // { a: 1, b: 2 }
  // Compiles to: $.object({ a: <1>, b: <2> })
  $.compileObject = (expr) => {
    return ir.$('object',
      ir.object(expr.properties.map(p => ir.prop(p.key, $.compileExpr(p.value))))
    );
  };

  // [1, 2, 3]
  // Compiles to: $.array([<1>, <2>, <3>])
  $.compileArray = (expr) => {
    return ir.$('array',
      ir.array(...expr.elements.map(e => $.compileExpr(e)))
    );
  };

  // obj[key] (also handles obj.field which parses as Index with string literal key)
  // Compiles to: $.index(<obj>, <key>)
  $.compileIndex = (expr) => {
    return ir.$('index',
      $.compileExpr(expr.object),
      $.compileExpr(expr.key)
    );
  };

  // obj[key] = value
  // Compiles to: $.setIndex(<obj>, <key>, <value>)
  $.compileSetIndex = (expr) => {
    return ir.$('setIndex',
      $.compileExpr(expr.object),
      $.compileExpr(expr.key),
      $.compileExpr(expr.value)
    );
  };

  // 42, "hello", true, false
  // Compiles to: $.number(42), $.string("hello"), $.boolean(true/false)
  $.compileLiteral = (expr) => {
    if (typeof expr.value === 'number') {
      return ir.$('number', ir.lit(expr.value));
    }
    if (typeof expr.value === 'string') {
      return ir.$('string', ir.lit(expr.value));
    }
    if (typeof expr.value === 'boolean') {
      return ir.$('boolean', ir.lit(expr.value));
    }
    if (expr.value === null) {
      return ir.$('null');
    }
    return ir.lit(null);
  };

  // x
  // Compiles to: $.lookup($env, "x")
  // Looks up name in current $env
  $.compileIdent = (expr) => {
    return ir.$('lookup', ir.var('$env'), ir.lit(expr.name));
  };

  // Escape an identifier for use as a JS variable name
  $.escapeIdent = (s) => {
    if (JS_RESERVED.has(s)) {
      return `_${s}`;
    }
    return s.replace(/[^a-zA-Z0-9_$]/g, '_');
  };

  // Error reporting - throws CompileError
  $.error = (message: string): never => {
    throw new CompileError(message);
  };
}

// Create the base compiler
export const $compile: CompilerOps = fix(build$compile);