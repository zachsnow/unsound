#!/usr/bin/env bash
set -euo pipefail

INPUT_DIRECTORY="./src"
OUTPUT_DIRECTORY="./dist"
mkdir -p "${OUTPUT_DIRECTORY}"
rm -rf "${OUTPUT_DIRECTORY}"/*
mkdir -p "${OUTPUT_DIRECTORY}/css"
mkdir -p "${OUTPUT_DIRECTORY}/js/lib"

echo "Building..."

# Configuration files.
echo "Copying configuration files..."
cp "src/CNAME" "${OUTPUT_DIRECTORY}"
if [ -f "src/favicon.ico" ]; then
    cp "src/favicon.ico" "${OUTPUT_DIRECTORY}"
fi

# Static files.
echo "Building SCSS..."
pnpm exec sass "${INPUT_DIRECTORY}/css/style.scss" "${OUTPUT_DIRECTORY}/css/style.css"

echo "Copying JS..."
cp ${INPUT_DIRECTORY}/js/app.js "${OUTPUT_DIRECTORY}/js/"
cp ${INPUT_DIRECTORY}/js/lib/* "${OUTPUT_DIRECTORY}/js/lib/"

# Compile Markdown and render template.
echo "Templating..."
pnpm exec saladplate "${INPUT_DIRECTORY}/index.html" --directory "${OUTPUT_DIRECTORY}"

echo "Done."
echo ""
echo "To deploy:"
echo "  cd dist && git add -A && git commit -m 'Deploy' && git push origin gh-pages"
