## Architecture

Unsound is at its core a framework for implementing programming languages whose *syntax* and *semantics
are *extensible*. Its design is one in which multiple language *extensions* are composed to produce a
more or less traditional (though simplified) compiler pipeline: one that first *parses* a language to an
abstract syntax tree (AST), then *compiles* that AST to an intermediate representation (IR), then *emits*
that IR to a target language. Extensions can extend each step in that pipeline.

Beyond allowing the extension of the compiler, Unsound allows extending the *runtime semantics* of programs.
The style of code that compilers developed with Unsound output is one in which the evaluation of the compiled program
is parameterized by a "semantics" that defines what evaluation actually "is". In the usual evaluation semantics
this is essentially the identity

### Phases

The core built-in compilation phases are:

* `$pre`: takes a filename of the program to be compiled; generally returns `string`.
* `$parse`: takes a string to parse; generally returns an AST.
* `$compile`: takes an AST; generally returns an IR.
* `$emit`: takes an IR; generally returns a `string` of code in the target language (that is -- JS).
* `$post`: takes a string of target language code and a filename; writes it to file.

The result is a JS file that is "parameterized" by a *semantics* that can be applied to the output to produce
an *interpretation*. The standard interpretation is `$eval`, a "concrete interpretation" of the program in the
universe of JS values.

One case also provide other interpretations; for instance `$type` can implement an *abstract* interpretation
in a universe of simple nominal types.

### Extension System

Extensions provide hooks for each phase, allowing the phase to be extended with additional functionality.
The key idea allowing extension is to implement the various phases (parsing, compilation, evaluation) with
a similar "open-recursive" approach.


Extensions have the following form:

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

All hooks mutate `$`, adding functionality extension by extension (and initially starting with the "empty"
language's implementation -- generally `() => {}`). To see how this plays out, consider parsing. The framework
expects that, after all extensions have been loaded, the `$parse` phase will result in an object `$` that
exports a function `$.parse` that takes the result of the `$pre` phase and outputs a value that the next phase,
`$compile`, will understand. A simple language might implement `$.parse` as, for example, parsing a simple
numeric expression:

```javascript
{
  $parse: ($) => {
    $.parse = (s) => {
    };

    $.term = (s) => {
    };

    $.addend = (s) => {

    };

    $.number = (s) => {

    };
  }
}
```

A subsequent extension can override `$parse`, say, add exponentiation:

```javascript
{
  $parse: ($) => {
    let baseParse = $.parse;

  };

  $.exponentiation = (s) => {

  };
}
```



## Languages

The Unsound framework comes with several language extensions, all building on the lowest level "empty" language
extension, which does nothing and returns nothing.  That's not very useful, so Unsound also comes with the
`core` language extension, written in Typescript, which actually implements a simple, untyped, expression-based
programming language:

- Literals: `42`, `"hello"`, `true`, `false`
- Let bindings: `let x = 1 in x`
- Lambdas: `(x, y) => x`
- Application: `f(1, 2)`
- If/then/else: `if cond then a else b`
- Objects: `{ x: 1, y: 2 }`
- Index access: `obj.field`, `obj[key]`
- Assignment: `obj.field = value`, `obj[key] = value`

Other extensions are provided that build on `core`. For fun, these extensions form a bootstrappable "tower" -- each
extension is written in a simpler language. So e.g. the `meso` extension adds infix, prefix, and postfix
operators, providing a more usable "layer" over `core`:

- Numerical operators: `42 * 21`
- Boolean operators: `a && !b`

Then `thermo` adds an imperative layer over `meso`:

Finally, `exo` adds a type annotation syntax, along with a typechecking semantics:

- Let binding annotations: `let f: Number = 42; f * f`

In addition, example extensions show how other programming features can be composed atop an existing language
arbitrarily. For instance, `const` adds the classic `const x = y;` syntax, raising a parsing error for subsequent
assignments to `x`. And `dyn` implements *dynamic scoping* for a language; note that `dyn` actually extends
the *evaluation* semantics as well as the parsing and compilation phases.


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
