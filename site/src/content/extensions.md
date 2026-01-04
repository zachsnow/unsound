# Extensions

In addition to implementing "whole languages", Unsound can be used to develop language extensions that
can extend arbitrary languages.

## Dynamic scope

The `dyn` extension adds dynamic variable binding to any language built on core.

```
//usc -x core -x meso -x dyn

dyn x = 42 in f()
```

Unlike `let` (lexical scoping), `dyn` binds dynamically — the binding is visible to any code called
from the body, even functions defined elsewhere:

```
let f = () => x in    // x is not in lexical scope here
dyn x = 10 in f()     // but f() sees x = 10 via dynamic scope
```

This is useful for implicit context like the current user, transaction, or logging configuration
that would otherwise need to be threaded through every function call.

The extension is implemented in Unsound itself (`dyn.us`), demonstrating that language extensions
can be written in the language they extend.

## Lazy function arguments

The `lazy` extension adds lazy (call-by-name) parameters to lambda functions.

```
//usc -x core -x meso -x lazy

let cond = (test, ~a, ~b) =>
  if test then
    a()
  else
    b()
in
cond(true, 1, null.explode)   // returns 1, doesn't evaluate null.explode
```

A tilde (`~`) before a parameter name marks it as lazy. When calling a function, all arguments
are wrapped in thunks. Eager parameters are forced immediately upon function entry, while lazy
parameters remain as thunks until explicitly called.

To use a lazy parameter's value, call it as a function: `x()`. This allows the function author
to control exactly when (and whether) each argument is evaluated.

```
let orElse = (a, ~b) => if a then a else b() in
orElse(true, expensiveComputation())   // skips the expensive computation
```

This enables patterns like short-circuit evaluation, conditional computation, and infinite data
structures that would be impossible with strict (eager) evaluation.
