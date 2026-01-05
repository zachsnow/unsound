#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

./build.sh

echo "Starting server at http://localhost:8000"
bun bin/watch.js
