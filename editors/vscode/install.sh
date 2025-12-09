#!/bin/bash
# Install Unsound VS Code extension

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEST="$HOME/.vscode/extensions/unsound"

# Install extension dependencies
echo "Installing extension dependencies..."
cd "$SCRIPT_DIR"
bun install

# Build extension
echo "Building extension..."
bun run build

# Remove old installation if exists
rm -rf "$DEST"

# Copy extension
mkdir -p "$DEST"
cp -r "$SCRIPT_DIR/package.json" "$DEST/"
cp -r "$SCRIPT_DIR/language-configuration.json" "$DEST/"
cp -r "$SCRIPT_DIR/syntaxes" "$DEST/"
cp -r "$SCRIPT_DIR/out" "$DEST/"
cp -r "$SCRIPT_DIR/node_modules" "$DEST/" 2>/dev/null || true

# Compile semantics
echo "Compiling semantics..."
cd "$PROJECT_ROOT"
bun run usc semantics/analyze.us -w

# Also copy the LSP server and its dependencies
mkdir -p "$DEST/lsp"
mkdir -p "$DEST/semantics"
cp "$PROJECT_ROOT/lsp/server.ts" "$DEST/lsp/"
cp "$PROJECT_ROOT/parser.ts" "$DEST/"
cp "$PROJECT_ROOT/compiler.ts" "$DEST/"
cp "$PROJECT_ROOT/compile.ts" "$DEST/"
cp "$PROJECT_ROOT/ast.ts" "$DEST/"
cp "$PROJECT_ROOT/runtime.ts" "$DEST/"
cp "$PROJECT_ROOT/primitives.ts" "$DEST/"
cp "$PROJECT_ROOT/types.ts" "$DEST/"
cp "$PROJECT_ROOT/grammar.ohm" "$DEST/"
cp "$PROJECT_ROOT/semantics/analyze.us.js" "$DEST/semantics/"
cp -r "$PROJECT_ROOT/node_modules" "$DEST/" 2>/dev/null || true

echo "Installed Unsound extension to $DEST"
echo "Reload VS Code to activate (Cmd+Shift+P > Developer: Reload Window)"
