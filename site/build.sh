#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

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
echo "Copying CSS..."
cp "${INPUT_DIRECTORY}/css/style.css" "${OUTPUT_DIRECTORY}/css/"

echo "Copying JS..."
cp "${INPUT_DIRECTORY}/js/app.js" "${OUTPUT_DIRECTORY}/js/"
cp "${INPUT_DIRECTORY}"/js/lib/* "${OUTPUT_DIRECTORY}/js/lib/"

# Build index page
echo "Building index..."
bunx saladplate "${INPUT_DIRECTORY}/index.html" --directory "${OUTPUT_DIRECTORY}"
bunx commonmark "${INPUT_DIRECTORY}/content/pitch.md" > "/tmp/pitch.html"

# Build each content page
echo "Building pages..."
PAGES="overview building usage lsp testing languages"
for page in $PAGES; do
    mkdir -p "${OUTPUT_DIRECTORY}/${page}"
    # Generate content from markdown to temp file
    bunx saladplate "${INPUT_DIRECTORY}/pages/${page}.html" > "/tmp/${page}_content.html"
    # Inject into layout
    bun -e "
      const layout = await Bun.file('${INPUT_DIRECTORY}/layout.html').text();
      const content = await Bun.file('/tmp/${page}_content.html').text();
      const pitch = await Bun.file('/tmp/pitch.html').text();
      console.log(layout.replace('{{CONTENT}}', content).replace('{{PITCH}}', pitch));
    " > "${OUTPUT_DIRECTORY}/${page}/index.html"
done

echo "Done."
echo ""
echo "To deploy:"
echo "  cd dist && git add -A && git commit -m 'Deploy' && git push origin gh-pages"
