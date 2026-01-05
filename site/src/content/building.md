# Building and installing

Bun and Typescript are the only dependencies for the core compiler. Once `bun` is available:

```bash
bun install
```

This will:

1. Build and install `usc`.
2. Build and install `usc-language-server`.
3. Build and install the VS Code extension.

## Development

When developing locally you can run the TypeScript directly instead of recompiling `usc` every time:

```bash
bun run usc         # Run usc from source
```

Other scripts include:

```bash
bun run types       # Type check only
bun run test        # Run tests only
bun run build       # Type check and run tests; builds the binary `dist/usc`
```

## Language Server

The Unsound language server provides IDE support for VS Code and other editors. To install:

```bash
cd editors/vscode && bun install && ./install.sh
```

This installs the VS Code extension from `editors/vscode/`.
