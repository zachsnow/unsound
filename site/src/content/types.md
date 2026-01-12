# Exo Types

Exo introduces a type system where **types are values** and **type checking is interpretation**.
Rather than a separate static analysis pass, type checking runs your program with a different
interpreter (`$type`) that computes types instead of values.

## Types as Values

In Exo, types like `Number`, `String`, and `Boolean` are ordinary values in the environment:

```unsound
Number        // The type of all numbers
String        // The type of all strings
Boolean       // The type of all booleans
Any           // Escape hatch: compatible with everything
```

Type annotations are expressions that get evaluated:

```unsound
let x: Number = 42;    // Number is evaluated, then 42's type is checked against it
let y: String = "hi";
```

## Dependent Types

Types can carry their concrete values. When the `$type` interpreter evaluates `42`, it produces
`Number(42)` — a number type that knows its value is `42`:

```unsound
// Under $type semantics:
42              // => Number(42)
"hello"         // => String("hello")
true            // => Boolean(true)
```

This enables **compile-time computation**:

```unsound
2 + 3           // => Number(5)
"a" + "b"       // => String("ab")
5 > 3           // => Boolean(true)
```

## Branch Pruning

When `if` has a dependent boolean condition, only the taken branch is evaluated:

```unsound
if true then 1 else null.explode    // => Number(1), else branch not evaluated
if 5 > 3 then "yes" else "no"       // => String("yes")
```

This enables type-level assertions:

```unsound
let safeDiv = (a, b) =>
  if b == 0 then Error("division by zero")
  else a / b;

safeDiv(10, 2)   // => Number(5)
safeDiv(10, 0)   // Type error: division by zero
```

## The `$=` Operator

The `$=` operator checks type compatibility: `expected $= actual` returns true if `actual` is assignable to `expected`:

```unsound
Number $= 5           // => Boolean(true)
Number $= "hello"     // => Boolean(false)
5 $= 5                // => Boolean(true)  - exact value match
5 $= 10               // => Boolean(false) - value mismatch
```

This is the operator used internally for type annotations. Each type implements `op$=` to define its
compatibility rules.

## SetType (Union Types)

When a variable can hold multiple types (e.g., through assignment), it becomes a `SetType`:

```unsound
let x = 1;
x = "hello";
x                     // => Set(Number(1) | String("hello"))
```

`SetType` forwards operations to all members:

```unsound
let x = 1; x = 2;
x + 10                // => Set(Number(11) | Number(12))
```

For compatibility, all members must be compatible:

```unsound
let t = 1; t = 2;
Number $= t           // => Boolean(true) - both are Numbers

let t = 1; t = "x";
Number $= t           // => Boolean(false) - String not compatible
```

## Type-Level Assertions

The `Error(message)` function throws a type error with a custom message. Combined with branch pruning, this enables compile-time constraints:

```unsound
let requirePositive = (n) =>
  if n > 0 then n
  else Error("expected positive number");

requirePositive(5)    // => Number(5)
requirePositive(-1)   // Type error: expected positive number
```

## Example: Length-Checked Zip

A `zip` function that rejects arrays of different lengths at type-check time:

```unsound
let SameLen = (a, b) =>
  if a.length == b.length then true
  else Error("zip requires same-length arrays");

let zip = (a, b) => {
  SameLen(a, b);  // assertion
  let result = [];
  let go = (i) =>
    if i >= a.length then result
    else { result.push([a[i], b[i]]); go(i + 1) };
  go(0)
};

zip([1, 2, 3], ["a", "b", "c"])  // OK
zip([1, 2], ["a", "b", "c"])     // Type error: zip requires same-length arrays
```

## Example: Matrix Dimensions

Check matrix multiplication dimensions at type level:

```unsound
let matmul = (a, b) =>
  if a[0].length == b.length then "valid"
  else Error("matrix inner dimensions must match");

matmul([[1,2,3], [4,5,6]], [[1], [2], [3]])  // OK: 2x3 * 3x1
matmul([[1,2], [3,4]], [[1], [2], [3]])      // Type error: 2x2 * 3x1
```

## Custom Types

Since types are values with methods, you can create custom types by defining objects with `op$=`:

```unsound
let PositiveNumber = {
  "op$=": (actual) =>
    if Number $= actual then
      if actual > 0 then true
      else false
    else false
};

let x: PositiveNumber = 5;   // OK
let y: PositiveNumber = -1;  // Type error
```

## Recursive Functions

Dependent types enable type-level recursion:

```unsound
let fib = (n) => if n <= 1 then n else fib(n-1) + fib(n-2);
fib(10)  // => Number(55)

let isPrime = (n) => {
  let check = (d) =>
    if d * d > n then true
    else if n % d == 0 then false
    else check(d + 1);
  if n < 2 then false else check(2)
};
isPrime(17)  // => Boolean(true)
```

Note: Non-dependent inputs cause infinite recursion. Use function annotations to bound return types:

```unsound
let fact: (n) => Number = (n) => if n <= 1 then 1 else n * fact(n - 1);
let x: Number = 5;  // erases dependent value
fact(x)             // => Number (not infinite recursion)
```
