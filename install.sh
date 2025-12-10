#!/bin/bash
# Install usc and usc-language-server binaries
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Install location (defaults to ~/.local/bin)
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

# Extensions install location (defaults to ~/.config/usc/extensions)
EXTENSIONS_DIR="${EXTENSIONS_DIR:-$HOME/.config/usc/extensions}"

echo "Building usc compiler and language server..."

# Type check first
echo "Type checking..."
bun run types

# Generate embedded sources for binary mode
echo "Generating embedded sources..."
bun generate-embedded.ts

# Build binaries
echo "Building binaries..."
mkdir -p dist
bun build --compile --outfile dist/usc ./cli.ts
bun build --compile --outfile dist/usc-language-server ./lsp/server.ts

# Install binaries
echo "Installing to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
cp dist/usc "$INSTALL_DIR/"
cp dist/usc-language-server "$INSTALL_DIR/"

# Install extensions
echo "Installing extensions to $EXTENSIONS_DIR..."
mkdir -p "$EXTENSIONS_DIR"
cp -r extensions/* "$EXTENSIONS_DIR/"

echo ""
echo "Installation complete!"
echo "  usc: $INSTALL_DIR/usc"
echo "  usc-language-server: $INSTALL_DIR/usc-language-server"
echo "  extensions: $EXTENSIONS_DIR/"
echo ""
echo "Make sure $INSTALL_DIR is in your PATH."
