# Thermo - Imperative Features

Thermo makes Unsound more JavaScript-like with assignment, blocks, and statement sequences.

## Let with Semicolons

Instead of `let x = v in body`, use semicolons:

```
let x = 1; x + 1        // 2
let x = 1; let y = 2; x + y   // 3
```

The body of a let extends to the end of the current sequence:
```
let x = 1; let y = 2; x + y
// parses as: Let(x, 1, Let(y, 2, x + y))
```

## Blocks

Curly braces group statements. The block evaluates to its last expression:

```
{ 1; 2; 3 }             // 3
{ let x = 1; x + 1 }    // 2
```

Empty braces are still objects:
```
{}                      // empty object
{ x: 1 }                // object with property
{ 1; 2 }                // block, evaluates to 2
```

The parser distinguishes blocks from objects by looking for `;`.

## Variable Assignment

Mutate existing bindings:

```
let x = 1; { x = 42; x }    // 42
```

Assignment returns the assigned value:
```
let a = 0; let b = 0; a = b = 5   // both are 5
```

Only works for variables, not new bindings. This errors:
```
y = 1   // error: y not defined
```

## If Without Else

The else branch is optional:

```
if true then 42         // 42
if false then 42        // undefined
```

Useful with assignment:
```
let x = 0;
if condition then x = 10;
x
```

## Top-Level Sequences

Programs can have multiple expressions at the top level:

```
1 + 2;
3 + 4;
5 + 6
```

Evaluates to the last expression (11).

## Implementation

Thermo extends meso with parser and compiler changes.

**Parser Changes**

1. Override `$.letExpr` to parse `let name = value` without requiring a body. Returns a LetExpr with `body: null`.

2. Override `$.program` and add `parseBlock` to handle semicolon sequences. When a LetExpr with null body is followed by `;`, the rest of the sequence becomes its body.

3. Override `$.atom` to try parsing blocks before falling back to the base parser.

4. Override `$.appExpr` to detect assignment (`x = v`) after parsing identifiers.

5. Override `$.ifExpr` to make the else branch optional.

**Body Filling**

When parsing `let x = 1; let y = 2; z`:
1. Parse `let x = 1` → LetExpr with body: null
2. See `;`, parse rest
3. Parse `let y = 2` → LetExpr with body: null
4. See `;`, parse rest
5. Parse `z`
6. Fill in bodies bottom-up via mutation

The mutation approach (`e.body = body`) preserves any extra properties on the AST node.

**Compiler Changes**

- Compile `Block` nodes using the comma operator
- Compile `Assign` nodes to mutate the environment
- Compile `Void` to undefined
