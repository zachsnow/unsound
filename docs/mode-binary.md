# --mode binary Implementation Notes

## Current Status

`--mode binary` works when running from source:
```bash
echo '42' | bun cli.ts -m binary -o myprogram -
./myprogram  # outputs: 42
```

It does NOT yet work from a compiled `usc` binary:
```bash
echo '42' | ./dist/usc -m binary -o myprogram -  # fails
```

## How --mode binary Works

1. `generateStandalone()` creates JS that imports from `extension.ts` and bundles the interpreter
2. `generateBinary()` writes that JS to a temp file
3. `bun build --compile` is called on the temp file to produce a native executable
4. The resulting binary is self-contained with the Bun runtime embedded

## The Problem

When `usc` itself is compiled with `bun build --compile`:
- `import.meta.dirname` becomes `/$bunfs/root/` (Bun's virtual filesystem)
- `generateStandalone()` embeds this path: `import { ... } from '/$bunfs/root/extension.ts'`
- When `bun build --compile` runs on the generated code, it cannot resolve `/$bunfs/root/extension.ts` because that path only exists inside the parent binary's virtual filesystem

## Attempted Solutions

### 1. Extract embedded sources at runtime

Tried using `import ... with { type: "file" }` to embed source files:

```typescript
// embedded-sources.ts
import extensionPath from "./extension.ts" with { type: "file" };
export const embeddedSources = { 'extension.ts': extensionPath };
```

**Problem**: When the same `.ts` file is imported both as a module AND with `{ type: "file" }`, Bun's bundler gets confused and reports missing exports:
```
error: No matching export in "ast.ts" for import "posToLineCol"
```

### 2. Use Bun.embeddedFiles

Tried accessing embedded files via `Bun.embeddedFiles` at runtime.

**Problem**: Bun explicitly excludes bundled source code (`.ts`, `.js`) from `Bun.embeddedFiles` to protect application source code.

### 3. Dynamic import of embedded-sources.ts

Tried dynamically importing the embedded sources module only when needed.

**Problem**: Bun still analyzes the module at bundle time, causing the same conflicts.

## Possible Solutions

### A. Copy sources with different extension

During build:
1. Copy all `.ts` files to `.src` extension
2. Import those with `{ type: "file" }`
3. At runtime, extract and rename back to `.ts`

### B. Serialize sources to JSON

Create a build step that:
1. Reads all source files
2. Writes them to a JSON file: `{ "extension.ts": "...", "parse.ts": "..." }`
3. Bundle the JSON file
4. At runtime, extract from JSON to temp directory

### C. Require USC_SOURCE_DIR environment variable

When running from compiled binary:
```bash
USC_SOURCE_DIR=/path/to/unsound ./dist/usc -m binary -o out program.us
```

This is the simplest solution but requires users to have the source repo available.

### D. Use BUN_BE_BUN with source directory

The compiled `usc` binary includes Bun itself (via `BUN_BE_BUN=1`). Could potentially:
1. Ship `usc` alongside the source directory
2. Use `BUN_BE_BUN=1` to invoke bun operations that need real filesystem access

## Related Bun Issues

- [#14320: build --compile: include embedded filesystem in module resolution](https://github.com/oven-sh/bun/issues/14320) - Closed as "not planned"
- [#5445: Include complete node_modules dir in binary](https://github.com/oven-sh/bun/issues/5445)

## Key Insight

The fundamental tension is:
- Bun bundles imported modules INTO the executable (not as separate files)
- Source code is intentionally excluded from `Bun.embeddedFiles`
- `bun build --compile` runs as a separate process that cannot access the parent binary's virtual filesystem

For `--mode binary` to work from a compiled `usc`, we need to make the source files available on the real filesystem at compile time.
