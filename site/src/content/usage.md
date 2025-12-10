# Usage

## Running Programs

```bash
# Run a program
usc program.us

# With extensions
usc -x full.ts program.us
usc -x extensions/meso.us program.us

# Chain extensions (applied in order)
usc -x ext1.us -x ext2.us program.us
```

## Interpreters

By default, programs are evaluated using the `$interpret` semantics. You can select a different interpreter:

```bash
# Select interpreter (default: interpret)
usc -x simply-typed.us --interpret type program.us
```

## Output Modes

```bash
# Output modes
usc -m module -o out.js program.us      # Export function
usc -m standalone -o app.js program.us  # Self-contained
```

## Debugging

```bash
# Debug output
usc --ast --ir --js program.us

# Environment variables
usc -e 'x=42' program.us
```

## The Language Layers

Unsound provides several language extensions that build on each other:

### Core

The base language - a simple expression-oriented language:

```unsound
let x = 42 in x
let f = (a, b) => a in f(1, 2)
if true then "yes" else "no"
{ x: 1, y: 2 }.x
```

### Meso

Adds infix and prefix operators with precedence:

```unsound
1 + 2 * 3
x > 0 && x < 10
!done || count == 0
```

### Thermo

Adds imperative features - blocks, semicolons, assignment:

```unsound
let x = 1;
let y = 2;
{
  x = x + y;
  x * 2
}
```
