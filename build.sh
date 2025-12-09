#!/bin/bash
set -e

echo "=== TypeScript check ==="
bun run types

echo ""
echo "=== Run tests ==="
bun run test
