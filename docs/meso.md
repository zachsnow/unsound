# Meso - Operators

Meso adds infix and prefix operators with precedence.

## Binary Operators

Arithmetic:
```
1 + 2       // 3
10 - 3      // 7
4 * 5       // 20
10 / 3      // 3.333...
10 % 3      // 1
```

Comparison:
```
1 < 2       // true
2 > 1       // true
1 <= 1      // true
2 >= 2      // true
```

Equality:
```
1 == 1      // true (method dispatch)
1 != 2      // true
1 === 1     // true (primitive strict equality)
1 !== 2     // true
```

Logical:
```
true && false   // false
true || false   // true
```

## Prefix Operators

```
!true       // false
-5          // -5
```

## Precedence

From lowest to highest:
1. `||`
2. `&&`
3. `==`, `!=`, `===`, `!==`
4. `<`, `>`, `<=`, `>=`
5. `+`, `-`
6. `*`, `/`, `%`
7. prefix `!`, `-`

Parentheses override precedence:
```
1 + 2 * 3       // 7
(1 + 2) * 3     // 9
```

## Implementation

Meso extends the parser with a precedence-climbing algorithm.

**Operator Table**

Operators are defined in a table with precedence and associativity:
```
binary: {
  "+":  { prec: 5, assoc: "left", method: "op+" },
  "===": { prec: 3, assoc: "left", prim: "strictEq" },
  ...
}
```

**Method Dispatch**

Most operators compile to method calls. `a + b` becomes:
```
a["op+"](b)
```

This lets types define their own operator behavior. Numbers, strings, and booleans have built-in operator methods.

**Primitive Dispatch**

`===` and `!==` use primitive dispatch instead - they call interpreter primitives directly. This handles `null === null` correctly since null has no methods.

**Parser Extension**

Meso overrides `$.appExpr` to use precedence climbing:
1. Try prefix operator
2. Parse atom via base parser
3. Apply postfix operators
4. Loop on binary operators respecting precedence
