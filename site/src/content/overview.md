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
    // Parse addition: term (('+' | '-') term)*
    $.parse = (s) => {
      let result = $.term(s);
      while (s.peek() === '+' || s.peek() === '-') {
        let op = s.next();
        let right = $.term(s);
        result = { type: op === '+' ? 'Add' : 'Sub', left: result, right };
      }
      return result;
    };

    // Parse multiplication: number (('*' | '/') number)*
    $.term = (s) => {
      let result = $.number(s);
      while (s.peek() === '*' || s.peek() === '/') {
        let op = s.next();
        let right = $.number(s);
        result = { type: op === '*' ? 'Mul' : 'Div', left: result, right };
      }
      return result;
    };

    // Parse a number literal
    $.number = (s) => {
      let n = '';
      while (s.peek() >= '0' && s.peek() <= '9') n += s.next();
      return { type: 'Num', value: parseInt(n) };
    };
  }
}
```

A subsequent extension can override parsing to add exponentiation with higher precedence:

```javascript
{
  $parse: ($) => {
    // Save the base number parser
    let baseNumber = $.number;

    // Exponentiation: number ('^' exponent)*
    $.number = (s) => {
      let result = baseNumber(s);
      while (s.peek() === '^') {
        s.next();
        let right = baseNumber(s);
        result = { type: 'Exp', base: result, power: right };
      }
      return result;
    };
  }
}
```

Now `2^3*4+1` parses with the correct precedence: `((2^3)*4)+1`.



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
