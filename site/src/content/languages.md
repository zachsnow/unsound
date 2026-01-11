Unsound provides language extensions that build on each other.

# Layers

## Core

A minimal functional language. Everything is an expression:

```unsound
let x = 42 in x
let f = (a, b) => a in f(1, 2)
if true then "yes" else "no"
[1, 2, 3][0]
{ x: 1, y: 2 }.x
```

Primitives: numbers, strings, booleans, `null`. Compound values: arrays and objects. Functions are lambdas with implicit return.

## Meso

Adds infix and prefix operators using precedence climbing. Precedence (low to high): `||`, `&&`, equality, comparison, `+`/`-`, `*`/`/`/`%`, prefix `!`/`-`.

```unsound
1 + 2 * 3
x > 0 && x < 10
!done || count == 0
```

Operators compile to method calls: `a + b` becomes `a["op+"](b)`. This lets values define their own operator behavior. The exceptions are `===`/`!==`, which use primitive dispatch to handle `null` comparisons.

## Thermo

Adds imperative features. Semicolons sequence expressions; in a sequence, `let` bindings scope over subsequent expressions:

```unsound
let x = 1;
let y = 2;
x + y
```

Blocks group statements and evaluate to their last expression. Assignment mutates existing bindings:

```unsound
let x = 1;
{
  x = x + 10;
  x * 2
}
```

# Programmable Types

Exo adds type annotation syntax, along with typechecking semantics.

```unsound
let x : Number = 42;
let f: (n: Number) => Number = (n) => n + 1;
f(x)
```

<aside>

In the interest of not spending more time building space elevator, Exo is
implemented in TS directly on Core.

</aside>

The interesting thing about Exo is _how_ types and typechecking are implemented. Specifically,
each type annotation is an Exo _expression_ -- a value -- that is itself evaluated before performing
type checking.

In addition, when interpreting a binding's value

```unsound
let x: T = value;
```

We first evaluate `T` using the default `$interpret` semantics to determine the type. Then we evaluate `value`
using the `$type` semantics, and compare the results using `op==` on `T` to determine whether `value` is assignable
to `x`.

---

For more on writing your own languages, see [Authoring Languages and Extensions](/authoring/).
