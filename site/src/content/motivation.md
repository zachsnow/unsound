# Motivation

> Have you ever found yourself writing an elaborate TypeScript type, 3 conditionals deep and 2 mapped types to the wind,
> and thought "I sure wish I could write this in plain old TypeScript?" This is for you. And you is me. This is for me.

## TypeScript terms as TypeScript types

I wanted to write types in something more like JavaScript, not in an ad hoc, pure, functional type sublanguage.TypeScript's type system is expressive, but it's a completely separate language:

- Value: `if (cond) a else b` vs Type: `Cond extends true ? A : B`
- Value: `items.map(f)` vs Type: `{ [K in keyof T]: F<T[K]> }`
- Value: `str.split('.')` vs Type: ``S extends `${infer H}.${infer T}` ``

Sure, you get nice things intuitive (well) and powerful inference. But what else can try?

## Implementing types in the language

More than just writing types in the value language, I wanted to *implement* typing rules in the language, too.
How does member access work at the type level? How does function application propagate types? I wanted
to define that behavior in the language itself.

And extend it! What if objects could have a `type()` method, and the type of the object would be the result of
calling that method rather than the usual inferred structural type? What would that even mean? What's an
effective way to implement it?

## Extensible semantics

I explored a number of strategies, frequently revisiting an interesting observation: *evaluation and typechecking
share a lot of structure*. I found myself reimplementing similar folds over abstract syntax trees, etc. Eventually
I arrived at compiling to something like the following, code parameterized over a semantics object `$`, so that
I could implement evaluation and typing separately:

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

Claude kindly pointed out the similarity to Oleg Kiselyov's **tagless final** style. A visit to Oleg's website
[okmij.org](http://okmij.org/ftp/tagless-final/) -- a treasure trove of type theory made explicit in the form
of functional programming -- explores this topic in depth, and was elucidating.

<aside>

* To make binding more customizable, we only make partial use of higher-order abstract syntax (HOAS).
* We aren't trying to achieve type safety in the target language via type safety in the meta-language (TypeScript),
  so that hasn't been a focus of the implementaiton. Many of the type-safe extensibility techniques Oleg describes
  don't translate well to TypeScript, anyway.

</aside>

## Extensible syntax

Parameterized semantics gives us extensible interpretation, one that can power both evaluation *and* type checking or
inference... but once you have extensible semantics, you want extensible parsing! What good is adding a new typing
rule if you can't add the syntax for it?

So I built an open recursive pipeline: parsing, compilation, and code emission, all extensible via the same mechanism.


## Therefore &there4;

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

## What Unsound is

Unsound is an experiment in building extensible programming languages. It provides an extensible compiler pipeline,
designed for compiling languages to a tagless final representation, so that programs can be interpreted in a variety
of ways. It also includes a number of prebuilt [language extensions](/languages/):

1. A base language (`core`) with simple expression-oriented syntax
2. Extension layers (`meso`, `thermo`, `exo`) that add operators, blocks, imperative features, and type annotations
3. Additional extensions to `exo` implementing dynamic scoping, `const` bindings, and more.

The name "Unsound" reflects the philosophy: expressiveness and extensibility at all levels, over all else.

[How It Works →](/overview/)
