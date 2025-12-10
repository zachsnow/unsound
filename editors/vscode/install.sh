#!/bin/bash
# Install Unsound VS Code extension
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEST="$HOME/.vscode/extensions/unsound"

# Check if usc-language-server is installed
if ! command -v usc-language-server &> /dev/null; then
  if [ ! -f "$HOME/.local/bin/usc-language-server" ]; then
    echo "usc-language-server not found. Running root install.sh first..."
    "$PROJECT_ROOT/install.sh"
  fi
fi

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

echo ""
echo "Installed Unsound extension to $DEST"
echo "Reload VS Code to activate (Cmd+Shift+P > Developer: Reload Window)"
