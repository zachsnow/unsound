# Language Server

Unsound includes a language server that provides IDE support for VS Code and other LSP-compatible editors.

## Features

- Syntax highlighting
- Go to definition
- Hover information
- Completion suggestions
- Diagnostic errors

## Installation

```bash
bun run install
```

This installs the VS Code extension from `editors/vscode/`. The extension automatically starts the language server when you open `.us` files.

## Configuration

The language server reads project configuration from `unsound.json` if present:

```json
{
  "extensions": ["meso", "thermo"]
}
```

This tells the language server which extensions to load for parsing and analysis.
