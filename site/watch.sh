#!/usr/bin/env bash
set -euo pipefail

# Initial build
./build.sh

# Start server in background
echo "Starting server at http://localhost:8000..."
cd dist
bun -e "Bun.serve({ port: 8000, fetch(req) { return new Response(Bun.file('.' + new URL(req.url).pathname.replace(/\/$/, '/index.html'))) } }); console.log('Serving on http://localhost:8000')" &
SERVER_PID=$!
cd ..

# Cleanup on exit
trap "kill $SERVER_PID 2>/dev/null" EXIT

# Watch for changes
echo "Watching src/ for changes..."
fswatch -o src ../OVERVIEW.md | xargs -n1 ./build.sh
