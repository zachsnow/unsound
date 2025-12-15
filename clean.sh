#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Cleaning build artifacts ==="

echo "  Removing dist/"
rm -rf dist/ || true

echo "  Removing *.us.js files"
find . -name "*.us.js" -type f -delete 2>/dev/null || true

echo "Done."
