// Tests for the combinator-based parser
import { parse, build$parse, CoreParseOps } from './parse.ts';
import { Expr } from './ast.ts';
import { fix } from './util.ts';
import { logger } from './logger.ts';

// Helper to check parse results
function expectParse(input: string, expected: Expr) {
  const result = parse(input);
  if (JSON.stringify(result) !== JSON.stringify(expected)) {
    logger.error('Input:', input);
    logger.error('Expected:', JSON.stringify(expected, null, 2));
    logger.error('Got:', JSON.stringify(result, null, 2));
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

logger.info('Testing literals...');

expectParse('42', { type: 'LiteralExpr', value: 42 });
expectParse('  42  ', { type: 'LiteralExpr', value: 42 });
expectParse('"hello"', { type: 'LiteralExpr', value: 'hello' });
expectParse('"hello\\nworld"', { type: 'LiteralExpr', value: 'hello\nworld' });
expectParse('true', { type: 'LiteralExpr', value: true });
expectParse('false', { type: 'LiteralExpr', value: false });

// === Identifier tests ===

logger.info('Testing identifiers...');

expectParse('x', { type: 'IdentifierExpr', name: 'x' });
expectParse('foo', { type: 'IdentifierExpr', name: 'foo' });
expectParse('_bar', { type: 'IdentifierExpr', name: '_bar' });
expectParse('$baz', { type: 'IdentifierExpr', name: '$baz' });
expectParse('foo123', { type: 'IdentifierExpr', name: 'foo123' });

// Keywords should not parse as identifiers
expectFail('let');
expectFail('in');
expectFail('if');

// === Lambda tests ===

logger.info('Testing lambdas...');

expectParse('() => 1', {
  type: 'LambdaExpr',
  params: [],
  body: { type: 'LiteralExpr', value: 1 }
});

expectParse('(x) => x', {
  type: 'LambdaExpr',
  params: [{ name: 'x' }],
  body: { type: 'IdentifierExpr', name: 'x' }
});

expectParse('(x, y) => x', {
  type: 'LambdaExpr',
  params: [{ name: 'x' }, { name: 'y' }],
  body: { type: 'IdentifierExpr', name: 'x' }
});

// === Let tests ===

logger.info('Testing let expressions...');

expectParse('let x = 1 in x', {
  type: 'LetExpr',
  name: { name: 'x' },
  value: { type: 'LiteralExpr', value: 1 },
  body: { type: 'IdentifierExpr', name: 'x' }
});

expectParse('let x = 1 in let y = 2 in x', {
  type: 'LetExpr',
  name: { name: 'x' },
  value: { type: 'LiteralExpr', value: 1 },
  body: {
    type: 'LetExpr',
    name: { name: 'y' },
    value: { type: 'LiteralExpr', value: 2 },
    body: { type: 'IdentifierExpr', name: 'x' }
  }
});

// === If tests ===

logger.info('Testing if expressions...');

expectParse('if true then 1 else 2', {
  type: 'IfExpr',
  cond: { type: 'LiteralExpr', value: true },
  then: { type: 'LiteralExpr', value: 1 },
  else: { type: 'LiteralExpr', value: 2 }
});

// === Application tests ===

logger.info('Testing function application...');

expectParse('f()', {
  type: 'AppExpr',
  fn: { type: 'IdentifierExpr', name: 'f' },
  args: []
});

expectParse('f(1)', {
  type: 'AppExpr',
  fn: { type: 'IdentifierExpr', name: 'f' },
  args: [{ type: 'LiteralExpr', value: 1 }]
});

expectParse('f(1, 2)', {
  type: 'AppExpr',
  fn: { type: 'IdentifierExpr', name: 'f' },
  args: [
    { type: 'LiteralExpr', value: 1 },
    { type: 'LiteralExpr', value: 2 }
  ]
});

// Chained application
expectParse('f(1)(2)', {
  type: 'AppExpr',
  fn: {
    type: 'AppExpr',
    fn: { type: 'IdentifierExpr', name: 'f' },
    args: [{ type: 'LiteralExpr', value: 1 }]
  },
  args: [{ type: 'LiteralExpr', value: 2 }]
});

// === Member access tests (now unified as Index with Literal key) ===

logger.info('Testing member access...');

expectParse('x.y', {
  type: 'IndexExpr',
  object: { type: 'IdentifierExpr', name: 'x' },
  key: { type: 'LiteralExpr', value: 'y' }
});

expectParse('x.y.z', {
  type: 'IndexExpr',
  object: {
    type: 'IndexExpr',
    object: { type: 'IdentifierExpr', name: 'x' },
    key: { type: 'LiteralExpr', value: 'y' }
  },
  key: { type: 'LiteralExpr', value: 'z' }
});

// Mixed application and member access
expectParse('x.f(1)', {
  type: 'AppExpr',
  fn: {
    type: 'IndexExpr',
    object: { type: 'IdentifierExpr', name: 'x' },
    key: { type: 'LiteralExpr', value: 'f' }
  },
  args: [{ type: 'LiteralExpr', value: 1 }]
});

// === Object tests ===

logger.info('Testing objects...');

expectParse('{}', {
  type: 'ObjectExpr',
  properties: []
});

expectParse('{ x: 1 }', {
  type: 'ObjectExpr',
  properties: [{ key: 'x', value: { type: 'LiteralExpr', value: 1 } }]
});

expectParse('{ x: 1, y: 2 }', {
  type: 'ObjectExpr',
  properties: [
    { key: 'x', value: { type: 'LiteralExpr', value: 1 } },
    { key: 'y', value: { type: 'LiteralExpr', value: 2 } }
  ]
});

// Shorthand property
expectParse('{ x }', {
  type: 'ObjectExpr',
  properties: [{ key: 'x', value: { type: 'IdentifierExpr', name: 'x' } }]
});

// === Extension test ===

logger.info('Testing parser extension...');

// Add a 'dyn' expression form (mutation style)
function dynParserExtension($: CoreParseOps): void {
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
const $parseWithDyn = fix(($: CoreParseOps) => {
  build$parse($ as any);
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

logger.info('All tests passed!');
