#!/usr/bin/env bash
set -euo pipefail

echo "Watching src/ for changes..."
fswatch -o src | xargs -n1 ./build.sh
