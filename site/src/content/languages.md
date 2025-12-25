Unsound provides several language extensions that build on each other.

# Layers

## Core

The base language - a simple expression-oriented language:

```unsound
let x = 42 in x
let f = (a, b) => a in f(1, 2)
if true then "yes" else "no"
{ x: 1, y: 2 }.x
```

## Meso

Adds infix and prefix operators with precedence:

```unsound
1 + 2 * 3
x > 0 && x < 10
!done || count == 0
```

## Thermo

Adds imperative features - blocks, semicolons, assignment:

```unsound
let x = 1;
let y = 2;
{
  x = x + y;
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

In the interest of not spending time building space elevator, Exo is
implemented in TS directly on Core.

</aside>

The interesting thing about Exo is *how* types and typechecking are implemented. Specifically,
each type annotation is an Exo *expression* -- a value -- that is itself evaluated before performing
type checking.

In addition, when interpreting a binding's value

```unsound
let x: T = value;
```

We first evaluate `T` using the default `$interpret` semantics to determine the type. Then we evaluate `value`
using the `$type` semantics, and compare the results using `op==` on `T` to determine whether `value` is assignable
to `x`. In addition, when `$type` evaluates *any* expression it checks whether the type-leval