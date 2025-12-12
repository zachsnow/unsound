#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check for fswatch
command -v fswatch >/dev/null 2>&1 || { echo "Error: fswatch is required but not installed. Install with: brew install fswatch"; exit 1; }

# Initial build
./build.sh

# Start server in background (0.0.0.0 binds to all interfaces)
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "")
echo "Starting server at http://localhost:8000"
[ -n "$TAILSCALE_IP" ] && echo "                   http://$TAILSCALE_IP:8000"
cd dist
bun -e "
Bun.serve({
  hostname: '0.0.0.0',
  port: 8000,
  async fetch(req) {
    const url = new URL(req.url);
    let path = '.' + url.pathname;
    if (path.endsWith('/')) path += 'index.html';
    const file = Bun.file(path);
    if (await file.exists()) return new Response(file);
    // Redirect to trailing slash if directory exists (like GitHub Pages)
    const indexFile = Bun.file(path + '/index.html');
    if (await indexFile.exists()) {
      return Response.redirect(url.pathname + '/', 301);
    }
    return new Response('Not found', { status: 404 });
  }
});
" &
SERVER_PID=$!
cd ..

# Cleanup on exit
trap "kill $SERVER_PID 2>/dev/null" EXIT

# Watch for changes
echo "Watching src/ for changes..."
fswatch -o src | xargs -n1 ./build.sh
