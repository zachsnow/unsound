First make sure you've [installed](/building/) the Unsound binary `usc` in your path; if you don't want
to do that, you can always run Unsound via bun; replace `usc` with `bun run usc` in the following to run
the TypeScript source directly.

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

Unsound supports several output modes. These are:

* `run`: compile and then immediately interpret
* `module`: compile to a JS module exporting a function `($) => { ... }`
* `standalone`: compile to standalone JS program
* `binary`: produce a standlone binary program from the standalone JS program

```bash
# Output modes
usc -m run -o app.js program.us           # Run immediately
usc -m module -o mod.js program.us        # Module exporting function
usc -m standalone -o prog.js program.us   # Self-contained JS program
usc -m binary -o prog program.us          # Standalone binary
```

Currently the `binary` option produces an executable using the bun `--compile` option,
which bundles the entire bun runtime. This makes for quite large binaries.

## Debugging

Unsound supports printing the values produced by the various phases:

```bash
# Debug output
usc --ast --ir --js program.us
```

