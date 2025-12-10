#!/usr/bin/env bash
set -euo pipefail

echo "Building site..."
./build.sh

echo "Deploying to gh-pages..."
cd dist
git add -A
git commit -m "Deploy site" || echo "Nothing to commit"
git push origin gh-pages

echo "Deployed."
