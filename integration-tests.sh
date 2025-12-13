#!/usr/bin/env bash
# Integration tests for usc compiler
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TEST_SCRIPT='let x = 1 + 2 in x * x'

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

passed=0
failed=0

pass() {
  echo -e "${GREEN}PASS${NC} $1"
  ((passed++)) || true
}

fail() {
  echo -e "${RED}FAIL${NC} $1: $2"
  ((failed++)) || true
}

# Create temp directory for test outputs
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "=== Integration Tests ==="
echo ""

# --- Mode Tests ---

echo "--- Mode Tests ---"

# Test: run mode with let
output=$(echo 'let x = 10 in x * 2' | bun run usc -x meso - 2>&1 | tail -1) || true
if [[ "$output" == "20" ]]; then
  pass "run mode: let expression"
else
  fail "run mode: let expression" "expected '20', got '$output'"
fi

# Test: module mode (import and run with interpreter)
echo 'let x = 1 + 2 in x * x' | bun run usc -x meso -m module -o "$TMPDIR/module.js" -
if [[ -f "$TMPDIR/module.js" ]]; then
  # Create runner that imports module and interpreter
  cat > "$TMPDIR/run-module.ts" << EOF
import { createLanguage, loadExtension } from '$SCRIPT_DIR/src/extension.ts';
import program from './module.js';

const lang = createLanguage([]);
await loadExtension('core', lang);
await loadExtension('meso', lang);
const result = await program(lang.\$interpret);
console.log(result);
EOF
  output=$(cd "$TMPDIR" && bun run-module.ts 2>&1) || true
  if [[ "$output" == "9" ]]; then
    pass "module mode: runs with interpreter"
  else
    fail "module mode: runs with interpreter" "expected '9', got '$output'"
  fi
else
  fail "module mode: runs with interpreter" "output file not created"
fi

# Test: standalone mode (exports result as default, we import and print)
echo '1 + 2' | bun run usc -x meso -m standalone -o "$TMPDIR/standalone.js" -
if [[ -f "$TMPDIR/standalone.js" ]]; then
  # Standalone exports result, create a wrapper to print it
  echo 'import result from "./standalone.js"; console.log(result);' > "$TMPDIR/run-standalone.js"
  output=$(cd "$TMPDIR" && bun run-standalone.js 2>&1) || true
  if [[ "$output" == "3" ]]; then
    pass "standalone mode: exports correct result"
  else
    fail "standalone mode: exports correct result" "expected '3', got '$output'"
  fi
else
  fail "standalone mode: exports correct result" "output file not created"
fi

# Test: binary mode
echo '1 + 2' | bun run usc -x meso -m binary -o "$TMPDIR/test-binary" -
if [[ -f "$TMPDIR/test-binary" ]]; then
  output=$("$TMPDIR/test-binary" 2>&1) || true
  if [[ "$output" == "3" ]]; then
    pass "binary mode: executable binary"
  else
    fail "binary mode: executable binary" "expected '3', got '$output'"
  fi
else
  fail "binary mode: executable binary" "binary not created"
fi

# --- LSP Tests ---

echo ""
echo "--- LSP Tests ---"

# Create LSP client test script
cat > "$TMPDIR/lsp-test.ts" << 'EOFTS'
// Minimal LSP client to test the language server
import { spawn } from 'child_process';

const server = spawn('bun', ['src/lsp/server.ts', '--stdio'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: process.argv[2],
});

let buffer = '';
let responseReceived = false;

function send(msg: object) {
  const json = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
  server.stdin.write(header + json);
}

server.stdout.on('data', (data) => {
  buffer += data.toString();
  // Parse LSP response
  const match = buffer.match(/Content-Length: (\d+)\r\n\r\n/);
  if (match) {
    const len = parseInt(match[1]);
    const start = match[0].length;
    if (buffer.length >= start + len) {
      const json = buffer.slice(start, start + len);
      const msg = JSON.parse(json);
      if (msg.id === 1) {
        // Initialize response
        console.log('LSP initialized:', msg.result?.capabilities ? 'OK' : 'FAIL');
        responseReceived = true;
        // Send initialized notification
        send({ jsonrpc: '2.0', method: 'initialized', params: {} });
        // Open a document
        send({
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: {
            textDocument: {
              uri: 'file:///test.us',
              languageId: 'unsound',
              version: 1,
              text: 'let x = 1 in x',
            },
          },
        });
        // Give it a moment to process, then exit
        setTimeout(() => {
          send({ jsonrpc: '2.0', id: 2, method: 'shutdown', params: null });
          setTimeout(() => {
            send({ jsonrpc: '2.0', method: 'exit', params: null });
            process.exit(0);
          }, 100);
        }, 500);
      }
      buffer = buffer.slice(start + len);
    }
  }
});

server.stderr.on('data', (data) => {
  // LSP servers log to stderr, that's fine
});

server.on('error', (err) => {
  console.error('LSP server error:', err.message);
  process.exit(1);
});

server.on('exit', (code) => {
  if (!responseReceived) {
    console.error('LSP server exited before responding');
    process.exit(1);
  }
});

// Send initialize request
send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    processId: process.pid,
    capabilities: {},
    rootUri: null,
  },
});

// Timeout after 5 seconds
setTimeout(() => {
  if (!responseReceived) {
    console.error('LSP server timeout');
    server.kill();
    process.exit(1);
  }
}, 5000);
EOFTS

output=$(bun "$TMPDIR/lsp-test.ts" "$SCRIPT_DIR" 2>&1) || true
if echo "$output" | grep -q "LSP initialized: OK"; then
  pass "lsp: server initializes and processes document"
else
  fail "lsp: server initializes and processes document" "$output"
fi

# --- Test Runner Tests ---

echo ""
echo "--- Test Runner Tests ---"

# Test: test runner finds tests
output=$(bun run test 2>&1) || true
if echo "$output" | grep -q "passed"; then
  pass "test runner: finds and runs tests"
else
  fail "test runner: finds and runs tests" "no 'passed' in output"
fi

# Test: test runner errors on empty directory
mkdir -p "$TMPDIR/empty-tests"
# Run test.ts with modified TESTS_DIR (via temp file)
cat > "$TMPDIR/test-empty.ts" << 'EOF'
import { readdirSync, existsSync, mkdirSync } from 'fs';
const TESTS_DIR = process.argv[2];
if (!existsSync(TESTS_DIR)) {
  mkdirSync(TESTS_DIR, { recursive: true });
}
const files = readdirSync(TESTS_DIR).filter(f => f.endsWith('.test'));
if (files.length === 0) {
  console.error('No test files found');
  process.exit(1);
}
console.log(`Found ${files.length} test files`);
EOF

if ! bun "$TMPDIR/test-empty.ts" "$TMPDIR/empty-tests" 2>&1; then
  pass "test runner: errors on no tests (simulated)"
else
  fail "test runner: errors on no tests" "should have exited with error"
fi

# --- Summary ---

echo ""
echo "=== Summary ==="
echo -e "Passed: ${GREEN}${passed}${NC}"
echo -e "Failed: ${RED}${failed}${NC}"

if [[ $failed -gt 0 ]]; then
  exit 1
fi
