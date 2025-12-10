# Unsound

> An extensible and unsound programming languages framework

Unsound is a framework for building extensible programming languages. See the [overview](OVERVIEW.md)
for information about the motivation and design of the framework.

## Building and installing

Bun and Typescript are the only dependencies. Once `bun` is available:

```bash
bun install
```

The following scripts are available:

```bash
bun run build       # Type check and run tests; builds the binary `dist/usc`
bun run test        # Run tests only
bun run types       # Type check only
bun run usc --help  # CLI help
```

## Usage

```bash
# Run a program
usc program.us

# With extensions
usc -x full.ts program.us
usc -x extensions/meso.us program.us

# Chain extensions (applied in order)
usc -x ext1.us -x ext2.us program.us

# Select interpreter (default: interpret)
usc -x simply-typed.us --interpret type program.us

# Output modes
usc -m module -o out.js program.us      # Export function
usc -m standalone -o app.js program.us  # Self-contained

# Debug
usc --ast --ir --js program.us

# Environment variables
usc -e 'x=42' program.us
```

## Development

When developing locally you can run the Typescript directly instead of recompiling `usc` every time:

```bash
bun run usc
```

## Language server

## Testing

Most of the tests for Unsound amount to testing the result of parsing, compiling, emitting, and interpreting
languages composed of various extensions. To this end tests can be defined in custom `*.test` files that
allow easily specifying which language extensions to use, and which phases to run.

Each file is comprised of a `usc`-directive indicating how to invoke `usc`, usually specifying the extensions
needed to run the tests.

```
# usc -x meso -x thermo
```

Then there are several tests, each consisting of a title, input, and multiple expected outputs.
For each output we define which phases of the framework should be executed, using the extensions defined
in the `usc`-comment.

```
--- test name
input (source, AST JSON, or IR JSON based on first phase)
=== phase: $impl[, phase: $impl, ...]
expected output
```

You can define multiple
# usc -x meso.ts

--- test name
input (source, AST JSON, or IR JSON based on first phase)
=== phase: $impl[, phase: $impl, ...]
expected output

--- parse test
let x = 1 in x
=== parse: $parse
{"type":"LetExpr",...}

--- compile test (input is AST JSON)
{"type":"Literal","value":42}
=== compile: $compile, emit: $emit
$.number(42)

--- eval test
1 + 2
=== parse: $parse, compile: $compile, interpret: $interpret
3

--- error test
let let = 1
=== parse: $parse
error: identifier
```
