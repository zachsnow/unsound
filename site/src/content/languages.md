Unsound provides several language extensions that build on each other:

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

## Exo

Exo adds type annotation syntax, along with typechecking semantics:

```unsound
let x : Num = 42;
```
