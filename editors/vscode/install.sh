#!/usr/bin/env bash
# Install Unsound VS Code extension
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
PROJECT_ROOT="$(cd "../.." && pwd)"
DEST="$HOME/.vscode/extensions/unsound"

# Check if VS Code is installed.
if ! command -v code &> /dev/null; then
  echo "error: 'code' command not found. Please install VS Code and ensure the 'code' command is available in your PATH."
  exit 1
fi

# Check if usc-language-server is installed.
if ! command -v usc-language-server &> /dev/null; then
  if [ ! -f "$HOME/.local/bin/usc-language-server" ]; then
    echo "error: usc-language-server not installed."
    exit 1
  fi
fi

# Install extension dependencies
echo "Installing extension dependencies..."
cd "$SCRIPT_DIR"
bun install

# Clean previous build
echo "Cleaning..."
bun run clean

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
cp -r "$SCRIPT_DIR/dist" "$DEST/"
cp -r "$SCRIPT_DIR/node_modules" "$DEST/" 2>/dev/null || true

echo ""
echo "Installed Unsound extension to $DEST"
echo "Reload VS Code to activate (Cmd+Shift+P > Developer: Reload Window)"
