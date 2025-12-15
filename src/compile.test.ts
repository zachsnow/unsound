// Tests for the minimal Unsound compiler (IR-based)


import { compile, compileToString, compileToClosure } from "./compile-helpers.ts";
import { build$compile, CoreCompileOps } from './compile.ts';
import { emitString } from './emit.ts';
import { parse } from './parse.ts';
import type { Expr } from './ast.ts';
import { ir } from "./ir.ts";
import { fix } from "./util.ts";
import { CompileOps } from "./types.ts";

// Helper to compile source to IR, then to string body
function compileBody(source: string): string {
  const ast = parse(source);
  const irNode = compile(ast);
  return emitString(irNode);
}

// === Literal tests ===

console.log('Testing literal compilation...');

let result = compileBody('42');
if (result !== '$.number(42)') {
  throw new Error(`Expected $.number(42), got: ${result}`);
}

result = compileBody('"hello"');
if (result !== '$.string("hello")') {
  throw new Error(`Expected $.string("hello"), got: ${result}`);
}

result = compileBody('true');
if (result !== '$.boolean(true)') {
  throw new Error(`Expected $.boolean(true), got: ${result}`);
}

result = compileBody('false');
if (result !== '$.boolean(false)') {
  throw new Error(`Expected $.boolean(false), got: ${result}`);
}

// === Identifier tests ===

console.log('Testing identifier compilation...');

result = compileBody('x');
if (result !== '$.lookup("x")') {
  throw new Error(`Expected $.lookup("x"), got: ${result}`);
}

result = compileBody('foo');
if (result !== '$.lookup("foo")') {
  throw new Error(`Expected $.lookup("foo"), got: ${result}`);
}

// === Lambda tests ===

console.log('Testing lambda compilation...');

result = compileBody('() => 1');
if (result !== '$.lambda([], ($) => $.number(1))') {
  throw new Error(`Expected $.lambda(...), got: ${result}`);
}

result = compileBody('(x) => x');
if (result !== '$.lambda(["x"], ($) => $.lookup("x"))') {
  throw new Error(`Expected $.lambda(...), got: ${result}`);
}

result = compileBody('(x, y) => x');
if (result !== '$.lambda(["x", "y"], ($) => $.lookup("x"))') {
  throw new Error(`Expected $.lambda(...), got: ${result}`);
}

// === Let tests ===

console.log('Testing let compilation...');

result = compileBody('let x = 1 in x');
if (result !== '$.let("x", ($) => $.number(1), ($) => $.lookup("x"))') {
  throw new Error(`Expected $.let(...), got: ${result}`);
}

result = compileBody('let x = 1 in let y = 2 in x');
const expected = '$.let("x", ($) => $.number(1), ($) => $.let("y", ($) => $.number(2), ($) => $.lookup("x")))';
if (result !== expected) {
  throw new Error(`Expected ${expected}, got: ${result}`);
}

// === If tests ===

console.log('Testing if compilation...');

result = compileBody('if true then 1 else 2');
if (result !== '$.if($.boolean(true), ($) => $.number(1), ($) => $.number(2))') {
  throw new Error(`Expected $.if(...), got: ${result}`);
}

// === Application tests ===

console.log('Testing application compilation...');

result = compileBody('f()');
if (result !== '$.call($.lookup("f"), [])') {
  throw new Error(`Expected $.call(...), got: ${result}`);
}

result = compileBody('f(1)');
if (result !== '$.call($.lookup("f"), [$.number(1)])') {
  throw new Error(`Expected $.call(...), got: ${result}`);
}

result = compileBody('f(1, 2)');
if (result !== '$.call($.lookup("f"), [$.number(1), $.number(2)])') {
  throw new Error(`Expected $.call(...), got: ${result}`);
}

// === Member access tests (now unified as Index) ===

console.log('Testing member access compilation...');

result = compileBody('x.y');
if (result !== '$.index($.lookup("x"), $.string("y"))') {
  throw new Error(`Expected $.index(...), got: ${result}`);
}

result = compileBody('x.y.z');
if (result !== '$.index($.index($.lookup("x"), $.string("y")), $.string("z"))') {
  throw new Error(`Expected nested $.index(...), got: ${result}`);
}

// === Object tests ===

console.log('Testing object compilation...');

result = compileBody('{}');
if (result !== '$.object({  })') {
  throw new Error(`Expected $.object({}), got: ${result}`);
}

result = compileBody('{ x: 1 }');
if (result !== '$.object({ ["x"]: $.number(1) })') {
  throw new Error(`Expected $.object({...}), got: ${result}`);
}

result = compileBody('{ x: 1, y: 2 }');
if (result !== '$.object({ ["x"]: $.number(1), ["y"]: $.number(2) })') {
  throw new Error(`Expected $.object({...}), got: ${result}`);
}

// === Full program string test ===

console.log('Testing full program compilation to string...');

const fullSource = 'let add = (x, y) => x in add(1, 2)';
const fullResult = compileToString(parse(fullSource));
if (!fullResult.startsWith('export default async ($) => {')) {
  throw new Error(`Expected module wrapper, got: ${fullResult}`);
}
if (!fullResult.includes('$.let')) {
  throw new Error(`Expected $.let in output, got: ${fullResult}`);
}

// === IR structure test ===

console.log('Testing IR structure...');

const irNode = compile(parse('let x = 1 in x'));
if (irNode.tag !== 'call') {
  throw new Error(`Expected call node, got: ${irNode.tag}`);
}
if ((irNode.fn as any).field !== 'let') {
  throw new Error(`Expected $.let call`);
}

// === Extension test ===

console.log('Testing compiler extension...');

// Add compilation for 'DynExpr' node type (mutation style)
function dynCompilerExtension($: CoreCompileOps): void {
  const baseCompileExpr = $.compileExpr;

  $.compileExpr = (expr: Expr) => {
    if ((expr as any).type === 'DynExpr') {
      return ($ as any).compileDyn(expr);
    }
    return baseCompileExpr(expr);
  };

  ($ as any).compileDyn = (expr: any) => {
    return ir.$('dyn',
      ir.lit(expr.name),
      $.compileExpr(expr.value),
      ir.arrow([], $.compileExpr(expr.body))
    );
  };
}

// Compose base + extension
const $compileWithDyn = fix(($: CoreCompileOps) => {
  build$compile($ as any);
  dynCompilerExtension($);
});

// Test with a fake DynExpr AST node
const dynAst = {
  type: 'DynExpr',
  name: 'x',
  value: { type: 'LiteralExpr', value: 42 },
  body: { type: 'IdentifierExpr', name: 'x' }
};

const dynIR = $compileWithDyn.compileExpr(dynAst as any);
const dynResult = emitString(dynIR);
if (dynResult !== '$.dyn("x", $.number(42), () => $.lookup("x"))') {
  throw new Error(`Expected $.dyn(...), got: ${dynResult}`);
}

// Regular expressions still work
const letAst = parse('let x = 1 in x');
const letIR = $compileWithDyn.compileExpr(letAst);
const letResult = emitString(letIR);
if (!letResult.includes('$.let')) {
  throw new Error(`Extension broke regular let compilation`);
}

// === Closure emission test ===

console.log('Testing closure emission...');

// Create a simple $eval for testing
// This implements non-recursive let semantics
const createEval = (env: Record<string, any> = {}): any => {
  const $: any = {
    number: (n: number) => n,
    string: (s: string) => s,
    boolean: (b: boolean) => b,
    lookup: (name: string) => env[name],
    let: (name: string, valueFn: ($: any) => any, bodyFn: ($: any) => any) => {
      // Non-recursive: value thunk gets current env (no self-reference)
      const value = valueFn($);
      // Body thunk gets new env with binding
      const $body = createEval({ ...env, [name]: value });
      return bodyFn($body);
    },
    lambda: (params: string[], bodyFn: ($: any) => any) => {
      // Return a closure that binds args to params and calls body
      return (...args: any[]) => {
        const newEnv = { ...env };
        params.forEach((p, i) => { newEnv[p] = args[i]; });
        const $body = createEval(newEnv);
        return bodyFn($body);
      };
    },
    call: (fn: Function, args: any[]) => fn(...args),
    if: (cond: any, thenFn: ($: any) => any, elseFn: ($: any) => any) =>
      cond ? thenFn($) : elseFn($),
    object: (o: any) => o,
    index: (obj: any, key: string) => obj[key],
  };
  return $;
};

const $eval = createEval();

const closureFn = compileToClosure(parse('let x = 42 in x'));
const closureResult = await closureFn($eval);
if (closureResult !== 42) {
  throw new Error(`Expected 42, got: ${closureResult}`);
}

const closureFn2 = compileToClosure(parse('let add = (a, b) => a in add(1, 2)'));
const closureResult2 = await closureFn2($eval);
if (closureResult2 !== 1) {
  throw new Error(`Expected 1, got: ${closureResult2}`);
}

console.log('All tests passed!');
