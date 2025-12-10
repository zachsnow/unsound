# Unsound Website

Documentation website hosted at [unsound.vein.io](https://unsound.vein.io).

## Structure

```
site/
├── src/
│   ├── index.html              # Template with saladplate directives
│   ├── CNAME                   # unsound.vein.io
│   ├── content/
│   │   ├── motivation.md       # Why unsound exists
│   │   ├── overview.md         # Includes ../../OVERVIEW.md
│   │   ├── building.md         # Build/install instructions
│   │   ├── usage.md            # CLI usage
│   │   ├── lsp.md              # Language server docs
│   │   └── testing.md          # Test format docs
│   ├── css/
│   │   ├── style.scss          # Main styles
│   │   ├── _codemirror-custom.scss
│   │   └── lib/
│   │       ├── normalize.css
│   │       └── codemirror.css
│   └── js/
│       ├── app.js              # CodeMirror setup, unsound mode
│       └── lib/
│           └── codemirror.min.js
├── dist/                       # Built output (gh-pages worktree)
├── build.sh
├── deploy.sh
├── watch.sh
└── package.json
```

## Development

```bash
cd site
bun install
bun run build    # Build site to dist/
bun run watch    # Watch and rebuild on changes
```

## Deployment

The `dist/` directory is a git worktree pointing to the `gh-pages` branch.

```bash
cd site
bun run deploy   # Build and push to gh-pages
```

Or manually:
```bash
cd site
./build.sh
cd dist
git add -A && git commit -m "Deploy" && git push origin gh-pages
```

## Dependencies

- `saladplate` - templating (`$<< file >>` for includes, `$(( cmd ))` for shell commands)
- `commonmark` - Markdown to HTML conversion
- `sass` - SCSS to CSS compilation

## CodeMirror Mode

The `unsound` CodeMirror mode in `app.js` recognizes:

- Keywords: `let`, `in`, `if`, `then`, `else`, `true`, `false`, `null`, `do`, `return`, `import`, `from`
- Operators: `||`, `&&`, `===`, `!==`, `==`, `!=`, `<`, `>`, `<=`, `>=`, `+`, `-`, `*`, `/`, `%`, `=>`
- Dollar identifiers: `$parse`, `$compile`, `$interpret`, etc.
- Comments: `//`
- Strings and numbers

## Future

- Bundle unsound compiler for browser
- Interactive code examples with "Run" button
- Editable CodeMirror playground
