#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Initial build
./build.sh

# Start server in background (0.0.0.0 binds to all interfaces)
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "")
echo "Starting server at http://localhost:8000"
[ -n "$TAILSCALE_IP" ] && echo "                   http://$TAILSCALE_IP:8000"

# Server + watcher in one Bun process
bun -e "
import { watch } from 'fs';
import { spawn } from 'child_process';

// Start server
Bun.serve({
  hostname: '0.0.0.0',
  port: 8000,
  async fetch(req) {
    const url = new URL(req.url);
    let path = './dist' + url.pathname;
    if (path.endsWith('/')) path += 'index.html';
    const file = Bun.file(path);
    if (await file.exists()) return new Response(file);
    const indexFile = Bun.file(path + '/index.html');
    if (await indexFile.exists()) {
      return Response.redirect(url.pathname + '/', 301);
    }
    return new Response('Not found', { status: 404 });
  }
});

// Watch src/ for changes
console.log('Watching src/ for changes...');
let building = false;
let pending = false;

const rebuild = () => {
  if (building) { pending = true; return; }
  building = true;
  const proc = spawn('./build.sh', [], { stdio: 'inherit' });
  proc.on('close', () => {
    building = false;
    if (pending) { pending = false; rebuild(); }
  });
};

watch('src', { recursive: true }, (event, filename) => {
  console.log('Changed:', filename);
  rebuild();
});
"
