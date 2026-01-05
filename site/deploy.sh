#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building site..."
bun run build

echo "Deploying to gh-pages..."
cd dist
git add -A
git commit -m "Deploy site" || echo "Nothing to commit"
git push origin gh-pages

echo "Deployed."
