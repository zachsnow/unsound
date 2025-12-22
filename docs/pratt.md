# Pratt Parser for Exo Operators

## Goal

Unify prefix, postfix, and binary operator parsing with configurable precedence for all three types.

## Current State

- **Binary operators**: Have precedence, parsed in `binaryExpr(minPrec)` loop
- **Prefix operators**: No precedence, always bind tighter than binary (parsed in `prefixExpr` before binary loop)
- **Postfix operators**: No precedence, always bind tighter than binary (parsed in `postfixExpr` before binary loop)
- **Application** (`()`, `.`, `[]`): Highest precedence, handled in `baseAppExpr`

## Problem

Cannot express:
- `!x + y` as `!(x + y)` (prefix with lower precedence than binary)
- `x + y!` as `(x + y)!` (postfix with lower precedence than binary)

## Solution: Pratt Parsing

Pratt parsing (aka "top-down operator precedence") handles all operator types uniformly:

1. **Prefix** operators have a precedence that determines the minimum precedence of their operand
2. **Postfix** operators have a precedence that determines if they capture the left operand
3. **Binary** operators have precedence + associativity as before

### Algorithm

```
parseExpr(minPrec):
  // 1. Parse prefix or atom
  if see prefix op:
    consume op
    operand = parseExpr(op.prec)  // operand binds at prefix's precedence
    left = PrefixExpr(op, operand)
  else:
    left = parseAtom()  // includes (), ., [] at highest precedence

  // 2. Loop: binary and postfix operators
  while true:
    if see binary op with op.prec >= minPrec:
      consume op
      rightPrec = op.assoc == "left" ? op.prec + 1 : op.prec
      right = parseExpr(rightPrec)
      left = BinaryExpr(op, left, right)
    else if see postfix op with op.prec >= minPrec:
      consume op
      left = PostfixExpr(op, left)
    else:
      break

  return left
```

### Examples

With precedences: `+` = 5, prefix `!` = 7, postfix `!` = 8

```
!x + y
  parseExpr(0):
    see prefix !, consume
    operand = parseExpr(7):
      parse x
      loop: see + (prec 5 < 7), stop
      return x
    left = !x
    loop: see + (prec 5 >= 0), consume
      right = parseExpr(6): parse y
      left = (!x) + y
    return (!x) + y
```

With precedences: `+` = 5, prefix `!` = 3

```
!x + y
  parseExpr(0):
    see prefix !, consume
    operand = parseExpr(3):
      parse x
      loop: see + (prec 5 >= 3), consume
        right = parseExpr(6): parse y
        left = x + y
      return x + y
    left = !(x + y)
    return !(x + y)
```

## Implementation Plan

### 1. Update Operator Definitions

Add `prec` to prefix and postfix operators:

```typescript
const operators = {
  binary: {
    "||": { prec: 1, assoc: "left", ... },
    "&&": { prec: 2, assoc: "left", ... },
    // ...
    "+":  { prec: 5, assoc: "left", ... },
    "*":  { prec: 6, assoc: "left", ... },
  },
  prefix: {
    "!": { prec: 7, method: "op!" },      // higher than binary: !x + y = (!x) + y
    "-": { prec: 7, method: "opNeg" },
  },
  postfix: {
    "!": { prec: 8, method: "call" },     // higher than binary: x + y! = x + (y!)
  },
};
```

### 2. Update Type Definitions

```typescript
interface PrefixOpDef {
  prec: number;
  method: string;
}

interface PostfixOpDef {
  prec: number;
  method: string;
}
```

### 3. Simplify Parser Structure

Remove `prefixExpr` and `postfixExpr`. Merge everything into `binaryExpr`:

```typescript
$.expr = () => $.binaryExpr(0);

$.binaryExpr = (minPrec: number) => (input, pos) => {
  let left: ParseResult<EExpr>;

  // 1. Try prefix operator
  const prefix = $.prefixOp()(input, pos);
  if (prefix.ok) {
    const opDef = operators.prefix[prefix.value.op];
    const operand = $.binaryExpr(opDef.prec)(input, prefix.pos);
    if (!operand.ok) return operand;
    left = {
      ok: true,
      value: { type: "PrefixExpr", op: prefix.value.op, operand: operand.value },
      pos: operand.pos,
    };
  } else {
    // 2. No prefix - parse atom (baseAppExpr handles (), ., [])
    left = baseAppExpr()(input, pos);
    if (!left.ok) return left;
  }

  // 3. Loop: binary and postfix operators
  while (true) {
    // Try binary
    const binOp = $.binaryOp()(input, left.pos);
    if (binOp.ok) {
      const opDef = operators.binary[binOp.value.op];
      if (opDef && opDef.prec >= minPrec) {
        const nextPrec = opDef.assoc === "left" ? opDef.prec + 1 : opDef.prec;
        const right = $.binaryExpr(nextPrec)(input, binOp.pos);
        if (!right.ok) return right;
        left = {
          ok: true,
          value: { type: "BinaryExpr", op: binOp.value.op, left: left.value, right: right.value },
          pos: right.pos,
        };
        continue;
      }
    }

    // Try postfix
    const postfix = $.postfixOp()(input, left.pos);
    if (postfix.ok) {
      const opDef = operators.postfix[postfix.value.op];
      if (opDef.prec >= minPrec) {
        left = {
          ok: true,
          value: { type: "PostfixExpr", op: postfix.value.op, operand: left.value },
          pos: postfix.pos,
        };
        continue;
      }
    }

    break;
  }

  return left;
};
```

### 4. Update ExoParseOps Interface

Remove `prefixExpr` and `postfixExpr` from the interface (or keep as aliases).

### 5. Update varAssign

`varAssign` currently calls `binaryExpr(0)`. This should continue to work.

## Testing

Add tests for:
- Prefix with higher precedence than binary: `!x + y` = `(!x) + y`
- Prefix with lower precedence than binary (if we add one)
- Postfix with higher precedence than binary: `x + y!` = `x + (y!)`
- Postfix with lower precedence than binary (if we add one)
- Mixed: `!x!` = `(!x)!` or `!(x!)` depending on precedences
- Chained: `!!x` = `!(!x)`, `x!!` = `(x!)!`

## Future: Mixfix Operators

Not in scope for this change. Mixfix operators (like ternary `? :`) would require additional infrastructure.
