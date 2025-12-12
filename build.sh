#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Type check first
echo "Type checking..."
bun run types

# Generate embedded sources for binary mode
echo "Generating embedded sources..."
bun src/generate-embedded.ts

# Build binaries
echo "Building binaries..."
mkdir -p dist
bun build --compile --outfile dist/usc ./src/cli.ts
bun build --compile --outfile dist/usc-language-server ./src/lsp/server.ts
