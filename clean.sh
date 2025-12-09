#!/bin/bash

echo "=== Cleaning build artifacts ==="

echo "  Removing dist/"
rm -rf dist/

echo "  Removing *.us.js files"
find . -name "*.us.js" -type f -delete

echo "Done"
