# Motivation

> Have you ever found yourself writing an elaborate TypeScript type, 3 conditionals deep and 2 mapped types to the wind,
> and thought "I sure wish I could write this in plain old TypeScript?" This is for you. And you is me. This is for me.

## TL;DR

Unsound compiles source code to a representation parameterized by a semantics object `$`. Different `$` implementations give different meanings to the same compiled code.

**Source:**
```unsound
let add1 = (x) => x + 1;
add1(42)
```

**Compiled** (simplified):
```javascript
($) => {
  let $env = $.env();
  $.letBind($env, "add1",
    $.lambda($env, ["x"], ($env) =>
      $.call($.index($.lookup($env, "x"), "op+"), [$.number(1)])));
  return $.call($.lookup($env, "add1"), [$.number(42)]);
}
```

**$interpret** (evaluation):
```javascript
$.env = () => createEnv();           // create empty environment
$.number = (n) => n;                 // numbers are just numbers
$.letBind = ($env, name, value) => $env.bind(name, value);
$.lookup = ($env, name) => $env.lookup(name);
$.lambda = ($env, params, body) => (...args) => {
  const bindings = Object.fromEntries(params.map((p, i) => [p, args[i]]));
  return body($env.extend(bindings));
};
$.call = (fn, args) => fn(...args);
$.index = (obj, key) => obj[key];    // "op+" looks up the JS method
// Result: 43
```

**$type** (type checking):
```javascript
$.env = () => createEnv({ Number: NumberType, ... });
$.number = (n) => NumberType;        // literals have type Number
$.letBind = ($env, name, value) => $env.bind(name, value);
$.lookup = ($env, name) => $env.lookup(name);
$.lambda = ($env, params, body) => (...argTypes) => {
  const bindings = Object.fromEntries(params.map((p, i) => [p, argTypes[i]]));
  return body($env.extend(bindings));
};
$.call = (fn, argTypes) => fn(...argTypes);
$.index = (obj, key) => obj[key];    // NumberType["op+"] is a type-level function
// Result: NumberType
```

The type checker literally calls your function with types as arguments. Types are values with operator methods. Read more about [programmable types](/types/).

---

## Background

TypeScript's type system is expressive, but it's a completely separate language:

- Value: `if (cond) a else b` vs Type: `Cond extends true ? A : B`
- Value: `items.map(f)` vs Type: `{ [K in keyof T]: F<T[K]> }`
- Value: `str.split('.')` vs Type: `` S extends `${infer H}.${infer T}`  ``

I wanted to write types in the value language, and to _implement_ typing rules in the language too.

Evaluation and typechecking share a lot of structure. I found myself reimplementing similar folds over ASTs. Eventually I arrived at compiling to code parameterized over `$` -- the [tagless final](http://okmij.org/ftp/tagless-final/) style.

Once you have extensible semantics, you want extensible parsing. So I built an open recursive pipeline: parsing, compilation, and emission, all extensible via the same mechanism.

## What Unsound Is

Unsound is an experiment in programming languages that can define, implement, and extend their own type system.
It's also an experiment in building extensible programming languages. It provides an extensible compiler pipeline designed for compiling to tagless final representation. It includes prebuilt [language extensions](/languages/):

1. A base language (`core`) with simple expression-oriented syntax
2. Extension layers (`meso`, `thermo`, `exo`) adding operators, blocks, imperative features, and type annotations
3. Additional extensions implementing dynamic scoping, `const` bindings, and more

The name "Unsound" reflects the philosophy: expressiveness and extensibility over all else.

[How It Works →](/overview/)
