# Unsound Website Plan

A motivation/documentation website hosted on GitHub Pages.

## Goals

1. Explain the original motivation: writing type functions *in* the language
2. Explain the `$.call`, `$.member` insight (extensible evaluation)
3. Show direct style and string output style
4. Credit tagless final / Oleg Kiselyov
5. Show how this extends to parsing and compilation
6. Document extensibility via parser combinators, AST recursion, open recursion

## Structure

Single-page site at `/` with sections pulled from Markdown files:

```
site/
├── src/
│   ├── index.html              # Template: header, nav, sections, footer
│   ├── content/
│   │   ├── motivation.md       # Why unsound exists
│   │   ├── overview.md         # Or $<< ../OVERVIEW.md >> from root
│   │   ├── building.md         # Build/install instructions
│   │   ├── usage.md            # CLI usage
│   │   ├── lsp.md              # Language server / editor support
│   │   └── testing.md          # Test format docs
│   ├── css/
│   │   ├── style.scss          # Main styles
│   │   └── codemirror.scss     # CM-specific styles
│   └── js/
│       ├── app.js              # CodeMirror setup, unsound mode
│       └── lib/
│           └── codemirror.min.js
├── dist/                       # Built output (worktree → gh-pages)
├── build.sh
└── deploy.sh
```

## Page Order

1. Motivation (the "why" story)
2. Overview (architecture, phases, extensions)
3. Building (install, build, scripts)
4. Usage (CLI examples)
5. LSP (editor integration)
6. Testing (test file format)

## Dependencies

- `saladplate` - templating (`$<< file >>`, `$(( cmd ))`)
- `commonmark` - Markdown → HTML
- `sass` - SCSS → CSS

No other dependencies.

## CodeMirror Language Mode

Create a simple `unsound` mode recognizing:

**Keywords** (from parse.ts + extensions):
- Core: `let`, `in`, `if`, `then`, `else`, `true`, `false`, `null`
- Thermo: `do`, `return` (if added)
- LSP list: `undefined`, `this`, `import`, `from`

**Literals**:
- Numbers: `42`, `3.14`
- Strings: `"hello"`
- Booleans: `true`, `false`

**Operators** (from meso.us):
- Binary: `||`, `&&`, `===`, `!==`, `==`, `!=`, `<`, `>`, `<=`, `>=`, `+`, `-`, `*`, `/`, `%`
- Prefix: `!`, `-`
- Arrow: `=>`

**Special**:
- Comments: `//`
- Dollar identifiers: `$parse`, `$compile`, `$interpret`, etc.

Mode will be imperfect (no semantic awareness of core vs meso vs thermo) but good enough for docs.

## Build Process

`build.sh`:
```bash
#!/bin/bash
set -e

# Create output dirs
mkdir -p dist/css dist/js/lib

# Copy static assets
cp src/CNAME dist/ 2>/dev/null || true
cp src/favicon.ico dist/ 2>/dev/null || true

# Compile SCSS
pnpm exec sass src/css/style.scss dist/css/style.css

# Copy JS
cp src/js/app.js dist/js/
cp src/js/lib/* dist/js/lib/

# Template index.html → dist/index.html
pnpm exec saladplate -d dist -s .html src/index.html
```

## Deployment (Worktree Approach)

One-time setup:
```bash
# Create orphan gh-pages branch if it doesn't exist
git checkout --orphan gh-pages
git reset --hard
git commit --allow-empty -m "Initial gh-pages"
git checkout main

# Add worktree
git worktree add site/dist gh-pages
```

`deploy.sh`:
```bash
#!/bin/bash
set -e

cd site

# Build
./build.sh

# Commit and push
cd dist
git add -A
git commit -m "Deploy site"
git push origin gh-pages
```

Package.json scripts (in site/package.json):
```json
{
  "scripts": {
    "build": "./build.sh",
    "watch": "fswatch -o src | xargs -n1 ./build.sh",
    "deploy": "./deploy.sh"
  }
}
```

## Template Structure

`src/index.html`:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Unsound</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header>
    <h1>Unsound</h1>
    <p>An extensible and unsound programming languages framework</p>
  </header>

  <nav>
    <a href="#motivation">Motivation</a>
    <a href="#overview">Overview</a>
    <a href="#building">Building</a>
    <a href="#usage">Usage</a>
    <a href="#lsp">LSP</a>
    <a href="#testing">Testing</a>
  </nav>

  <main>
    <section id="motivation">
      $(( pnpm exec commonmark src/content/motivation.md ))
    </section>

    <section id="overview">
      $(( pnpm exec commonmark src/content/overview.md ))
    </section>

    <section id="building">
      $(( pnpm exec commonmark src/content/building.md ))
    </section>

    <section id="usage">
      $(( pnpm exec commonmark src/content/usage.md ))
    </section>

    <section id="lsp">
      $(( pnpm exec commonmark src/content/lsp.md ))
    </section>

    <section id="testing">
      $(( pnpm exec commonmark src/content/testing.md ))
    </section>
  </main>

  <footer>
    <a href="https://github.com/zachsnow/unsound">GitHub</a>
  </footer>

  <script src="js/lib/codemirror.min.js"></script>
  <script src="js/app.js"></script>
</body>
</html>
```

## Content Files

Can either:
1. Write fresh content in `site/src/content/*.md`
2. Include existing docs via `$<< ../../docs/core.md >>` (but then need to handle headers)

Recommend: write fresh motivation.md, copy/adapt from existing OVERVIEW.md and README.md for the rest.

## Future: Browser Compiler

Later phases can add:
1. Editable CodeMirror textarea
2. Bundle unsound compiler for browser (Bun can do this)
3. "Run" button that parses, compiles, evaluates in-browser
4. Output panel showing result

This is orthogonal to the static site structure - just add more JS.

## Open Questions

1. CNAME / custom domain? Or just `zachsnow.github.io/unsound`?
2. Should overview.md literally include `../../OVERVIEW.md` or be a curated version?
3. Color scheme / design - match patrim-site style or different?

## Next Steps

1. Create `site/` directory structure
2. Set up `package.json` with deps (saladplate, commonmark, sass)
3. Create basic `index.html` template
4. Write `motivation.md` content
5. Adapt existing docs into content files
6. Create CodeMirror unsound mode
7. Style it
8. Set up gh-pages worktree
9. Deploy
