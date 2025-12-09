# Core Language

The base Unsound language is a small expression-oriented language.

## Literals

```
42          // number
3.14        // number
"hello"     // string
true        // boolean
false       // boolean
null        // null
```

## Objects

```
{}                      // empty object
{ x: 1, y: 2 }          // object with properties
{ name: "alice" }       // string keys
```

## Functions

Arrow functions with parenthesized parameters:

```
() => 42                // no params
(x) => x + 1            // one param
(a, b) => a + b         // multiple params
```

## Let Expressions

Bind a name to a value:

```
let x = 10 in x + 1     // 11
let f = (x) => x * 2 in f(5)  // 10
```

Lets are expressions - they evaluate to their body:

```
let a = 1 in let b = 2 in a + b   // 3
```

## If Expressions

```
if true then 1 else 2   // 1
if x > 0 then "positive" else "non-positive"
```

Both branches required in core.

## Member Access

```
obj.name                // dot notation
obj["name"]             // bracket notation
"hello".length          // works on primitives too
```

## Function Calls

```
f()                     // no args
f(1, 2, 3)              // multiple args
obj.method()            // method call
```

## Method Dispatch

Primitives have methods:

```
"hello".slice(0, 2)     // "he"
"hello".toUpperCase()   // "HELLO"
```

These delegate to JavaScript's underlying methods.
