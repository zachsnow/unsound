// Tests for the combinator-based parser

import { parse, build$parse, type ParserOps } from './parse.ts';
import { Expr } from './ast.ts';
import { fix } from './util.ts';

// Helper to check parse results
function expectParse(input: string, expected: Expr) {
  const result = parse(input);
  if (JSON.stringify(result) !== JSON.stringify(expected)) {
    console.error('Input:', input);
    console.error('Expected:', JSON.stringify(expected, null, 2));
    console.error('Got:', JSON.stringify(result, null, 2));
    throw new Error('Parse mismatch');
  }
}

function expectFail(input: string) {
  try {
    parse(input);
    throw new Error(`Expected parse to fail for: ${input}`);
  } catch (e) {
    if ((e as Error).message.startsWith('Expected parse to fail')) throw e;
    // Good - it failed as expected
  }
}

// === Literal tests ===

console.log('Testing literals...');

expectParse('42', { type: 'Literal', value: 42 });
expectParse('  42  ', { type: 'Literal', value: 42 });
expectParse('"hello"', { type: 'Literal', value: 'hello' });
expectParse('"hello\\nworld"', { type: 'Literal', value: 'hello\nworld' });
expectParse('true', { type: 'Literal', value: true });
expectParse('false', { type: 'Literal', value: false });

// === Identifier tests ===

console.log('Testing identifiers...');

expectParse('x', { type: 'Ident', name: 'x' });
expectParse('foo', { type: 'Ident', name: 'foo' });
expectParse('_bar', { type: 'Ident', name: '_bar' });
expectParse('$baz', { type: 'Ident', name: '$baz' });
expectParse('foo123', { type: 'Ident', name: 'foo123' });

// Keywords should not parse as identifiers
expectFail('let');
expectFail('in');
expectFail('if');

// === Lambda tests ===

console.log('Testing lambdas...');

expectParse('() => 1', {
  type: 'Lambda',
  params: [],
  body: { type: 'Literal', value: 1 }
});

expectParse('(x) => x', {
  type: 'Lambda',
  params: ['x'],
  body: { type: 'Ident', name: 'x' }
});

expectParse('(x, y) => x', {
  type: 'Lambda',
  params: ['x', 'y'],
  body: { type: 'Ident', name: 'x' }
});

// === Let tests ===

console.log('Testing let expressions...');

expectParse('let x = 1 in x', {
  type: 'LetExpr',
  name: 'x',
  value: { type: 'Literal', value: 1 },
  body: { type: 'Ident', name: 'x' }
});

expectParse('let x = 1 in let y = 2 in x', {
  type: 'LetExpr',
  name: 'x',
  value: { type: 'Literal', value: 1 },
  body: {
    type: 'LetExpr',
    name: 'y',
    value: { type: 'Literal', value: 2 },
    body: { type: 'Ident', name: 'x' }
  }
});

// === If tests ===

console.log('Testing if expressions...');

expectParse('if true then 1 else 2', {
  type: 'IfExpr',
  cond: { type: 'Literal', value: true },
  then: { type: 'Literal', value: 1 },
  else: { type: 'Literal', value: 2 }
});

// === Application tests ===

console.log('Testing function application...');

expectParse('f()', {
  type: 'App',
  fn: { type: 'Ident', name: 'f' },
  args: []
});

expectParse('f(1)', {
  type: 'App',
  fn: { type: 'Ident', name: 'f' },
  args: [{ type: 'Literal', value: 1 }]
});

expectParse('f(1, 2)', {
  type: 'App',
  fn: { type: 'Ident', name: 'f' },
  args: [
    { type: 'Literal', value: 1 },
    { type: 'Literal', value: 2 }
  ]
});

// Chained application
expectParse('f(1)(2)', {
  type: 'App',
  fn: {
    type: 'App',
    fn: { type: 'Ident', name: 'f' },
    args: [{ type: 'Literal', value: 1 }]
  },
  args: [{ type: 'Literal', value: 2 }]
});

// === Member access tests (now unified as Index with Literal key) ===

console.log('Testing member access...');

expectParse('x.y', {
  type: 'Index',
  object: { type: 'Ident', name: 'x' },
  key: { type: 'Literal', value: 'y' }
});

expectParse('x.y.z', {
  type: 'Index',
  object: {
    type: 'Index',
    object: { type: 'Ident', name: 'x' },
    key: { type: 'Literal', value: 'y' }
  },
  key: { type: 'Literal', value: 'z' }
});

// Mixed application and member access
expectParse('x.f(1)', {
  type: 'App',
  fn: {
    type: 'Index',
    object: { type: 'Ident', name: 'x' },
    key: { type: 'Literal', value: 'f' }
  },
  args: [{ type: 'Literal', value: 1 }]
});

// === Object tests ===

console.log('Testing objects...');

expectParse('{}', {
  type: 'ObjectExpr',
  properties: []
});

expectParse('{ x: 1 }', {
  type: 'ObjectExpr',
  properties: [{ key: 'x', value: { type: 'Literal', value: 1 } }]
});

expectParse('{ x: 1, y: 2 }', {
  type: 'ObjectExpr',
  properties: [
    { key: 'x', value: { type: 'Literal', value: 1 } },
    { key: 'y', value: { type: 'Literal', value: 2 } }
  ]
});

// Shorthand property
expectParse('{ x }', {
  type: 'ObjectExpr',
  properties: [{ key: 'x', value: { type: 'Ident', name: 'x' } }]
});

// === Extension test ===

console.log('Testing parser extension...');

// Add a 'dyn' expression form (mutation style)
function dynParserExtension($: ParserOps): void {
  const baseExpr = $.expr;

  // Extend expr to try dyn first
  $.expr = () => $.alt(
    $.lazy(() => ($ as any).dynExpr()),
    baseExpr()
  );

  // New parser for dyn expressions
  ($ as any).dynExpr = () => $.map(
    $.seq(
      $.keyword('dyn'),
      $.lazy(() => $.ident()),
      $.token('='),
      $.lazy(() => $.expr()),
      $.keyword('in'),
      $.lazy(() => $.expr())
    ),
    ([_, name, _eq, value, _in, body]) => ({
      type: 'DynExpr',
      name,
      value,
      body
    })
  );
}

// Compose base + extension
const $parseWithDyn = fix(($: ParserOps) => {
  build$parse($);
  dynParserExtension($);
});

const dynResult = $parseWithDyn.program()('dyn x = 1 in x', 0);
if (!dynResult.ok) {
  throw new Error('Failed to parse dyn expression');
}
if ((dynResult.value as any).type !== 'DynExpr') {
  throw new Error('Expected DynExpr');
}

// Regular expressions still work
const letResult = $parseWithDyn.program()('let x = 1 in x', 0);
if (!letResult.ok || letResult.value.type !== 'LetExpr') {
  throw new Error('Extension broke regular let expressions');
}

console.log('All tests passed!');
