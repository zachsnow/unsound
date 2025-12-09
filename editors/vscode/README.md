# Unsound VS Code Extension

Full language support for the Unsound programming language.

## Installation

```bash
./install.sh
```

Then reload VS Code (Cmd+Shift+P > "Developer: Reload Window").

## Features

- **Syntax highlighting** - TextMate grammar for `.us` files
- **Diagnostics** - Parse errors and undefined variable warnings
- **Go to Definition** - Jump to where a symbol is defined (F12)
- **Hover** - See symbol information on hover
- **Completions** - Symbol and keyword completions
- **Bracket matching** and auto-closing
- **Comment toggling** (Cmd/Ctrl + /)

## Requirements

- [Bun](https://bun.sh/) must be installed and available in PATH
- The extension runs the language server using `bun`

## Development

After making changes:
1. Rebuild: `bun run build`
2. Run `./install.sh` to copy to VS Code extensions
3. Reload VS Code (Cmd+Shift+P > "Developer: Reload Window")
