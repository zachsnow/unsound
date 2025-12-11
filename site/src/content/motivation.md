# Motivation

## Types in JavaScript

I wanted to write types in JavaScript, not an ad hoc, pure, functional type sublanguage. TypeScript's type system is expressive, but it's a completely separate language:

- Value: `if (cond) a else b` vs Type: `Cond extends true ? A : B`
- Value: `items.map(f)` vs Type: `{ [K in keyof T]: F<T[K]> }`
- Value: `str.split('.')` vs Type: ``S extends `${infer H}.${infer T}` ``

I understand why TypeScript is designed this way - the separate sublanguage enables powerful inference. But I wanted to explore something different.

## Implementing Types in the Language

More than just writing type expressions in the value language, I wanted to *implement* typing rules in the language too. How does member access work at the type level? How does function application propagate types? I wanted to define that behavior in the language itself.

For example: what if objects could have a `type()` method, and the type of the object would be the result of calling that method rather than the usual inferred structural type? What would that even mean? What's an effective way to implement it?

## The Journey

I explored a number of strategies and eventually arrived at compiling to something like a tagless final representation - code parameterized over a semantics object `$`:

```javascript
// "42 + 1" compiles to:
($) => $.add($.number(42), $.number(1))
```

The meaning comes from which `$` we pass in:

```javascript
const $eval = { number: (n) => n, add: (a, b) => a + b };
program($eval);  // => 43

const $type = { number: (n) => "Num", add: (a, b) => checkAdd(a, b) };
program($type);  // => "Num"
```

Claude kindly pointed out the similarity to Oleg Kiselyov's tagless final style and helped me refine the approach. Oleg's website ([okmij.org](http://okmij.org/ftp/tagless-final/)) explores this idea in depth.

## Extensible Parsing

I could have stopped there - parameterized semantics gives us extensible interpretation. But once you have extensible semantics, you want extensible parsing. What good is adding a new typing rule if you can't add the syntax for it?

So I built an open recursive pipeline: parsing, compilation, and emission, all extensible via the same override mechanism.

A few notes on the implementation:

- To make binding more customizable, we only make partial use of higher-order abstract syntax (HOAS).
- We aren't trying to achieve type safety in the target via type safety in the meta language, so that hasn't been a focus. Many of the extensibility techniques Oleg describes don't translate well to TypeScript anyway.

## The Result

At long last we can answer what it means to implement types in the language itself - tightly integrated, without implementing multiple fixed interpretations. With the `exo` extension, Unsound supports type annotations:

```unsound
let x : Num = 42;
let f : Arrow(Num, Num) = (x) => x + 1;
```

Type expressions are regular Unsound code. `Arrow` is a function, `Num` is a value:

```unsound
let Num = { kind: "num" };
let Arrow = (param, ret) => { kind: "arrow", param: param, ret: ret };
```

Type-level functions are just functions:

```unsound
let Pair = (a, b) => Record({ fst: a, snd: b });
let p : Pair(Num, Str) = { fst: 42, snd: "hello" };
```

No conditional types, no mapped types, no template literal types - just functions.

## What Unsound Is

Unsound is an experiment in building extensible programming languages. It provides:

1. A base language (`core`) with simple expression-oriented syntax
2. Extension layers (`meso`, `thermo`, `exo`) that add operators, blocks, imperative features, and type annotations
3. A framework for defining your own extensions to parsing, compilation, and interpretation
4. Multiple interpretation modes (evaluation, typing, tracing, etc.)

The name "Unsound" reflects the philosophy: expressiveness and extensibility over formal guarantees. The type system is deliberately unsound - a tool for catching obvious errors, not a proof system.

[How It Works →](/overview/)
