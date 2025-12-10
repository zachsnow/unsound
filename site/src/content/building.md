# Building and Installing

Bun and TypeScript are the only dependencies. Once `bun` is available:

```bash
bun install
```

The following scripts are available:

```bash
bun run build       # Type check and run tests; builds the binary dist/usc
bun run test        # Run tests only
bun run types       # Type check only
bun run usc --help  # CLI help
```

## Development

When developing locally you can run the TypeScript directly instead of recompiling `usc` every time:

```bash
bun run usc
```

## Language Server

The Unsound language server provides IDE support for VS Code and other editors. To install:

```bash
bun run install
```

This installs the VS Code extension from `editors/vscode/`.
