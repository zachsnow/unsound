# Testing

Most of the tests for Unsound amount to testing the result of parsing, compiling, emitting, and interpreting languages composed of various extensions. To this end tests can be defined in custom `*.test` files that allow easily specifying which language extensions to use, and which phases to run.

## Test File Format

Each file is comprised of a `usc`-directive indicating how to invoke `usc`, usually specifying the extensions needed to run the tests.

```
# usc -x meso -x thermo
```

Then there are several tests, each consisting of a title, input, and multiple expected outputs. For each output we define which phases of the framework should be executed, using the extensions defined in the `usc`-comment.

```
--- test name
input (source, AST JSON, or IR JSON based on first phase)
=== phase: $impl[, phase: $impl, ...]
expected output
```

## Multiple Pipelines

You can define multiple `===` blocks, each with their own pipeline:

```
# usc -x meso.ts

--- parse test
let x = 1 in x
=== parse: $parse
{"type":"LetExpr",...}
=== parse: $parse, compile: $compile, interpret: $interpret
1

--- compile test (input is AST JSON)
{"type":"Literal","value":42}
=== compile: $compile, emit: $emit
$.number(42)

--- eval test
1 + 2
=== parse: $parse, compile: $compile, interpret: $interpret
3
```

## Error Tests

You can additionally define a pipeline followed by `error`; this means that the pipeline should fail with the error described in the block:

```
--- error test
let let = 1
=== parse: $parse
error: identifier
```

## Running Tests

```bash
bun run test
```

This runs all `*.test` files in the project.
