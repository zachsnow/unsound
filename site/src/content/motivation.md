# Motivation

## The Problem: Type-Level Sublanguages

Have you ever written TypeScript and found yourself in type-level hell? Consider a simple task: you want a type function that takes a union type and filters it based on some condition. In a normal programming language, you'd write:

```typescript
function filter(items, predicate) {
  return items.filter(predicate);
}
```

But in TypeScript's type system, you write something like:

```typescript
type FilterByKind<T, K> = T extends { kind: K } ? T : never;
```

This is a *conditional type* - TypeScript's type-level `if`. It uses the `extends` keyword (overloaded to mean something completely different from class extension), a ternary-style `? :` syntax, and the magic `never` type to filter. Want to do something more complex? You'll need mapped types, template literal types, recursive conditional types, and a dozen other specialized constructs.

**Why can't I just write an `if` statement?**

The same pattern appears everywhere. Type-level programming uses a completely different sublanguage than value-level programming:

- Value: `if (cond) a else b` vs Type: `Cond extends true ? A : B`
- Value: `items.map(f)` vs Type: `{ [K in keyof T]: F<T[K]> }`
- Value: `str.split('.')` vs Type: `S extends \`${infer H}.${infer T}\` ? ... : ...`

You already know how to program. Why should you learn a second, weirder language just to work with types?

## The Insight: Parameterized Semantics

The key insight behind Unsound came from separating *compilation* from *interpretation*. Consider a simple expression: `42 + 1`.

A traditional interpreter walks an AST and computes directly:

```javascript
function evaluate(expr) {
  if (expr.type === 'number') return expr.value;
  if (expr.type === 'add') return evaluate(expr.left) + evaluate(expr.right);
}
```

A traditional compiler emits target code - the semantics are baked in:

```asm
mov eax, 42
add eax, 1
```

But what if we compiled to code that *calls methods on a semantics object* `$`?

```javascript
($) => $.add($.number(42), $.number(1))
```

This compiled function doesn't *do* anything yet - it just describes the structure of the computation. The "meaning" comes from the `$` we pass in:

```javascript
// Evaluation: actually compute the result
const $eval = {
  number: (n) => n,
  add: (a, b) => a + b,
};
program($eval);  // => 43

// Pretty-printing: produce a string representation
const $print = {
  number: (n) => String(n),
  add: (a, b) => `(${a} + ${b})`,
};
program($print);  // => "(42 + 1)"

// Type-checking: compute types instead of values
const $type = {
  number: (n) => "Number",
  add: (a, b) => (a === "Number" && b === "Number") ? "Number" : "Error",
};
program($type);  // => "Number"
```

The same compiled code, interpreted three different ways by swapping out the semantics object.

## The Payoff: Types in the Language

This brings us back to the original goal. With the `exo` extension, Unsound supports type annotations:

```unsound
let x : Num = 42;
let f : Arrow(Num, Num) = (x) => x + 1;
```

But here's the key: **type expressions are just regular Unsound code**. When the type checker sees `Arrow(Num, Num)`, it doesn't parse it with special type-level syntax - it *evaluates* it using the standard `$interpret` semantics. `Arrow` is just a function, `Num` is just a value:

```unsound
let Num = { kind: "num" };
let Arrow = (param, ret) => { kind: "arrow", param: param, ret: ret };
```

This means you can write type-level functions using normal programming constructs:

```unsound
// A type function - just a regular function!
let Pair = (a, b) => Record({ fst: a, snd: b });

// Use it in a type annotation
let p : Pair(Num, Str) = { fst: 42, snd: "hello" };
```

No conditional types. No mapped types. No template literal types. Just functions.

## Tagless Final: It's Been Done Before

This approach isn't new - it's essentially the *tagless final* style of interpreter implementation, developed by Oleg Kiselyov and others. The idea is to represent programs not as tagged AST nodes, but as applications of an abstract interface. The "final" comes from the fact that you work directly with the final result type rather than an intermediate representation.

Oleg's website ([okmij.org](http://okmij.org/ftp/tagless-final/)) is a treasure trove of papers and implementations exploring this idea in depth. Unsound takes this theoretical foundation and applies it practically to building extensible languages.

## Extending Beyond Evaluation

Having achieved the goal of writing "type functions" in the same language as regular functions (by parameterizing the semantics), a natural question arose: could the same approach work for *parsing* and *compilation*?

It turns out the answer is yes, though the mechanism is somewhat different. Rather than parameterizing a fixed pipeline, Unsound uses:

- **Parser combinators** with open recursion - parsers can be extended by overriding individual parsing functions
- **AST visitors** with open recursion - compilers and emitters can be extended by overriding how specific node types are handled
- **Interpretation hooks** - semantics objects can be extended with new operations

The result is a framework where every phase of the language pipeline is extensible: you can add new syntax, new compilation strategies, and new interpretations without modifying the core implementation.

## What Unsound Is

Unsound is an **experiment** in building extensible programming languages. It provides:

1. A base language (`core`) with simple expression-oriented syntax
2. Extension layers (`meso`, `thermo`) that add operators, blocks, and imperative features
3. A framework for defining your own extensions
4. Multiple interpretation modes (evaluation, typing, tracing, etc.)

The name "Unsound" reflects the philosophy: we prioritize expressiveness and extensibility over formal guarantees. The type system (when used) is deliberately unsound - it's a tool for catching obvious errors, not a proof system.
