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

This installs the VS Code extension from `editors/vscode/`. The extension automatically starts the language server
when you open `.us` files. Unsound files should include `//usc`-directives so that the extension can load the
necessary extensions for the file. The `$analyze` semantics is applied to the file to gather information for
the language server, which means that extensions can extend the analysis to add more information for the editor.