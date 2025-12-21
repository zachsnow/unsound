#!/usr/bin/env bash
# Install Unsound VS Code extension to ~/.vscode/extensions
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

DEST="$HOME/.vscode/extensions/unsound"

# Build
bun install --frozen-lockfile
bun run build

# Install
rm -rf "$DEST"
mkdir -p "$DEST"
cp package.json language-configuration.json "$DEST/"
cp -r syntaxes dist "$DEST/"

echo "Installed to $DEST"
echo "Reload VS Code to activate"
