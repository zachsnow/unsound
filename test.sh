#!/usr/bin/env bash
# Integration tests for usc compiler
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TEST_SCRIPT='let x = 1 + 2 in x * x'
TEST_OUTPUT='9'

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
echo "$TEST_SCRIPT" | bun run usc -x meso -m module -o "$TMPDIR/module.js" -
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
  if [[ "$output" == "$TEST_OUTPUT" ]]; then
    pass "module mode: runs with interpreter"
  else
    fail "module mode: runs with interpreter" "expected '9', got '$output'"
  fi
else
  fail "module mode: runs with interpreter" "output file not created"
fi

# Test: standalone mode (exports result as default, we import and print)
echo "$TEST_SCRIPT" | bun run usc -x meso -m standalone -o "$TMPDIR/standalone.js" -
if [[ -f "$TMPDIR/standalone.js" ]]; then
  # Standalone exports result, create a wrapper to print it
  echo 'import result from "./standalone.js"; console.log(result);' > "$TMPDIR/run-standalone.js"
  output=$(cd "$TMPDIR" && bun run-standalone.js 2>&1) || true
  if [[ "$output" == "$TEST_OUTPUT" ]]; then
    pass "standalone mode: exports correct result"
  else
    fail "standalone mode: exports correct result" "expected '$TEST_OUTPUT', got '$output'"
  fi
else
  fail "standalone mode: exports correct result" "output file not created"
fi

# Test: binary mode
echo "$TEST_SCRIPT" | bun run usc -x meso -m binary -o "$TMPDIR/test-binary" -
if [[ -f "$TMPDIR/test-binary" ]]; then
  output=$("$TMPDIR/test-binary" 2>&1) || true
  if [[ "$output" == "$TEST_OUTPUT" ]]; then
    pass "binary mode: executable binary"
  else
    fail "binary mode: executable binary" "expected '$TEST_OUTPUT', got '$output'"
  fi
else
  fail "binary mode: executable binary" "binary not created"
fi

# --- LSP Tests ---

echo ""
echo "--- LSP Tests ---"

output=$(bun src/lsp/server.test.ts 2>&1) || true
if echo "$output" | grep -q "LSP initialized: OK"; then
  pass "lsp: server initializes and processes document"
else
  fail "lsp: server initializes and processes document" "$output"
fi


# --- Summary ---

echo ""
echo "=== Summary ==="
echo -e "Passed: ${GREEN}${passed}${NC}"
echo -e "Failed: ${RED}${failed}${NC}"

if [[ $failed -gt 0 ]]; then
  exit 1
fi
