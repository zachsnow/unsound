# Unsound

Extensible language with open recursion via `$` threading.

## Architecture

### Core Language

Minimal expression language:
- Literals: `42`, `"hello"`, `true`, `false`
- Let bindings: `let x = 1 in x`
- Lambdas: `(x, y) => x`
- Application: `f(1, 2)`
- If/then/else: `if cond then a else b`
- Objects: `{ x: 1, y: 2 }`
- Index access: `obj.field`, `obj[key]`
- Assignment: `obj.field = value`, `obj[key] = value`

### Extension System

Extensions provide hooks for each phase:

```javascript
{
  $parse: ($) => { /* extend parser */ },
  $compile: ($) => { /* extend compiler */ },
  $emit: ($) => { /* extend emitter */ },
  $interpret: ($) => { /* extend default interpreter */ },
  $type: ($) => { /* add type checker */ },
  // ... any $-prefixed key for additional interpreters
}
```

All hooks mutate `$` (open recursion pattern).

### Files

- `types.ts` - AST types (Expr, LetExpr, Lambda, etc.)
- `parser.ts` - Combinator parser, exports `$parse`
- `compiler.ts` - AST to IR compiler, exports `$compile`
- `ir.ts` - JavaScript IR builders and emitters
- `interpret.ts` - Base interpreter with primitives, exports `createInterpret`
- `extension.ts` - Extension composition, `createLanguage`, `applyExtension`, `run`
- `eval.ts` - Default `$eval` interpreter
- `cli.ts` - Command-line interface
- `test.ts` - Test runner

### Extensions

Located in `extensions/`:

- `core.ts` - Base implementations for all phases (parser, compiler, emitter, interpreter)
- `meso.us` - Infix operators with precedence (the "middle layer")
- `thermo.us` - JS-like imperative features (assignment with body)
- `const.us` - Constant bindings with compile-time checking
- `trace.ts` - Tracing/debugging extension
- `identity.us` - No-op extension (test)

## CLI Usage

```bash
# Run a program
usc program.us

# With extensions
usc -x full.ts program.us
usc -x extensions/meso.us program.us

# Chain extensions (applied in order)
usc -x ext1.us -x ext2.us program.us

# Select interpreter (default: interpret)
usc -x simply-typed.us --interpret type program.us

# Output modes
usc -m module -o out.js program.us      # Export function
usc -m standalone -o app.js program.us  # Self-contained

# Debug
usc --ast --ir --js program.us

# Environment variables
usc -e 'x=42' program.us
```

## Test Format

```
# File-level extensions
@ext full.ts

--- test name
input (source, AST JSON, or IR JSON based on first phase)
=== phase: $impl[, phase: $impl, ...]
expected output

--- parse test
let x = 1 in x
=== parse: $parse
{"type":"LetExpr",...}

--- compile test (input is AST JSON)
{"type":"Literal","value":42}
=== compile: $compile, emit: $emit
$.number(42)

--- eval test
1 + 2
=== parse: $parse, compile: $compile, interpret: $interpret
3

--- error test
let let = 1
=== parse: $parse
error: identifier
```

## Key Concepts

### Open Recursion via $

All phases thread `$` through thunks:
```javascript
// Compiled output
$.let("x", ($) => $.number(1), ($) => $.lookup("x"))
```

Extensions override methods on `$`:
```javascript
function myExtension($) {
  const baseNumber = $.number;
  $.number = (n) => { console.log(n); return baseNumber(n); };
}
```

### Multiple Interpreters

Extensions can provide multiple interpreter keys:
```javascript
{
  $interpret: ($) => { /* evaluation */ },
  $type: ($) => { /* type checking */ }
}
```

Select with `--interpret <key>`:
```bash
usc -x simply-typed.us --interpret type program.us
```

### Primitives

`$operators` global provides operator functions for bootstrapping:
```
let is = $operators["op==="] in
let add = $operators["op+"] in
...
```

### meso.us

The "middle layer" - adds infix operators:
- Precedence: `||` < `&&` < `==`/`!=` < `<`/`>`/`<=`/`>=` < `+`/`-` < `*`/`/`/`%`
- Left-associative
- Operators compile to method calls: `a + b` → `a["op+"](b)`
- Parser stores `$.operators` table with prec/assoc/method

## IR Structure

JavaScript IR tags:
- `literal` - JSON value
- `var` - Variable reference
- `call` - Function call
- `member` - Property access ($.foo)
- `index` - Computed access (x[y])
- `arrow` - Arrow function
- `object` - Object literal
- `array` - Array literal
- `ternary` - Conditional

## Building

```bash
bun run build      # Type check and run tests
bun run test       # Run tests only
bun run types      # Type check only
bun cli.ts --help  # CLI help
```
