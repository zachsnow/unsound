# Building and installing

Bun and TypeScript are the only dependencies. Once `bun` is available:

```bash
bun install
```

Now you can run the Unsound compiler directly, build a binary, or
install the language server:

```bash
bun run usc         # Run the compiler directly
bun run build       # Build a usc binary
bun run install     # Build and install the language server and extension
```

## Development

When developing locally you can run the TypeScript directly instead of recompiling `usc` every time:

```bash
bun run usc         # Run the compiler directly
bun run types       # Check types
```

Run TypeScript

## Language Server

The Unsound language server provides IDE support for VS Code and other editors. To install:

```bash
bun run install
```

This installs the VS Code extension from `editors/vscode/`.
