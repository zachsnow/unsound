#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Cleaning build artifacts ==="

echo "  Removing dist/"
rm -rf dist/ || true

echo "Done."
