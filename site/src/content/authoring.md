# Authoring Languages and Extensions

Writing Unsound languages to be easily extensible, and writing extensions to extend
many languages (as opposed to just one specific one), is not straightforward. Here
are a few techniques that make it easier.

## Overview

An extension is a module that exports builder functions for one or more compiler phases:

```javascript
export default {
  name: "myext",
  description: "My extension",
  requires: ["core"],

  $parse: ($) => {
    /* extend parsing */
  },
  $compile: ($) => {
    /* extend compilation */
  },
  $interpret: ($) => {
    /* extend interpretation */
  },

  // Less commonly extended:
  $emit: ($) => {
    /* extend emission */
  },
  $analyze: ($) => {
    /* extend analysis */
  },
};
```

Each builder receives `$`, an object containing the current phase operations. Your builder mutates `$` to add or override operations. Extensions are applied in order, so later extensions can override earlier ones.

## Parsing

The parser is built from small, composable pieces. When extending parsing, follow these principles:

### Break parsing into small pieces

Define separate parser functions for each syntactic element, and expose them on `$`:

```javascript
$parse: ($) => {
  // Bad: one big parser
  $.myExpr = () => /* parses everything */;

  // Good: composable pieces
  $.myKeyword = () => $.keyword("mykw");
  $.myParams = () => $.between($.token("("), $.sepBy($.ident(), $.token(",")), $.token(")"));
  $.myBody = () => $.expr();
  $.myExpr = () => $.seq($.myKeyword(), $.myParams(), $.myBody(), (kw, params, body) => ({
    type: "MyExpr",
    params,
    body
  }));
}
```

This allows subsequent extensions to override just `$.myParams` or `$.myBody` without reimplementing the whole expression.

### Expose constants on $

If your extension uses constants (keywords, operator precedences, etc.), expose them on `$` so other extensions can modify them:

```javascript
$parse: ($) => {
  // Expose configuration
  $.myKeywords = ["mykw", "myother"];
  $.myPrecedence = 5;

  // Use the configuration
  $.myExpr = () => {
    const kw = $.myKeywords[0];
    // ...
  };
};
```

Another extension can then do `$.myKeywords.push("extended")` or `$.myPrecedence = 10`.

### Extend existing parsers carefully

When overriding an existing parser like `$.expr`, save the original and call it as a fallback:

```javascript
$parse: ($) => {
  const baseExpr = $.expr;

  $.expr = () =>
    $.alt(
      $.lazy(() => $.myExpr()), // Try new syntax first
      baseExpr() // Fall back to base
    );
};
```

## Compilation

The compiler transforms AST nodes into IR. Follow these principles:

### Compile to existing IR when possible

Prefer compiling to IR constructs that `$emit` and `$interpret` already handle. This means your extension doesn't need to provide `$emit` or `$interpret` builders:

```javascript
$compile: ($) => {
  $.compileMyExpr = (expr) => {
    // Compile to existing $.let, $.lambda, $.call, etc.
    return ir.$(
      "let",
      ir.var("$env"),
      ir.lit(expr.name),
      $.compileExpr(expr.value),
      ir.arrow(["$env"], $.compileExpr(expr.body))
    );
  };
};
```

If you compile to a new IR operation like `ir.$("myOp", ...)`, you'll need to provide `$interpret` (and possibly `$emit`) to handle it.

### Handle extended expression types

When overriding `$.compileExpr`, your implementation may receive expression types from other extensions. Handle this by checking for your types and delegating others:

```javascript
$compile: ($) => {
  const baseCompileExpr = $.compileExpr;

  $.compileExpr = (expr) => {
    if (expr.type === "MyExpr") {
      return $.compileMyExpr(expr);
    }
    // Delegate unknown types to base
    return baseCompileExpr.call($, expr);
  };
};
```

### The Expr type limitation

TypeScript's `Expr` type is a union of known expression types. When you add a new expression type, TypeScript doesn't know about it. You'll often need casts:

```javascript
$compile: ($) => {
  const baseCompileExpr = $.compileExpr;

  $.compileExpr = (expr) => {
    // Cast to access your extended type
    const e = expr as MyExpr | Expr;
    if (e.type === "MyExpr") {
      return $.compileMyExpr(e);
    }
    return baseCompileExpr.call($, expr);
  };
}
```

This is unfortunate but necessary given TypeScript's type system. The recursive nature of `Expr` makes it difficult to properly extend.

### Extract helper functions

If your compilation logic is complex, extract helper functions and expose them on `$`:

```javascript
$compile: ($) => {
  $.compileMyParams = (params) => /* ... */;
  $.compileMyBody = (body) => /* ... */;

  $.compileMyExpr = (expr) => {
    const params = $.compileMyParams(expr.params);
    const body = $.compileMyBody(expr.body);
    // ...
  };
}
```

## Interpretation

The interpreter defines runtime semantics. When adding new operations:

### Provide operations for new IR

If your compiler emits new IR operations, provide interpreter implementations:

```javascript
$interpret: ($) => {
  $.myOp = ($env, arg1, arg2) => {
    // Implement runtime behavior
    return /* result */;
  };
};
```

### Match the signature expected by emit

The emitter generates code like `$.myOp($env, arg1, arg2)`. Your interpreter operation must match this signature.

### Consider the environment

Many operations receive `$env` as the first argument. Use `$env.lookup(name)` to read variables, `$env.extend(bindings)` to create child scopes, and `$env.mutate(name, value)` to update existing bindings.

## Testing

Write tests for your extension using the test file format:

```
# usc -x core -x myext

--- my feature works
myexpr(1, 2)
===
3

--- my feature handles errors
myexpr(null)
=== error
expected number
```

Test both successful cases and error cases. Test interaction with other extensions when relevant.
