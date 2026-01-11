# Unsound Site

Static site for Unsound documentation.

## Structure

```
src/
  layout.html       # Main page template with nav, header, footer
  index.html        # Home page (injects into layout)
  pages/*.html      # Content pages (inject into layout)
  content/*.md      # Markdown content
  css/              # Stylesheets
  js/               # Client-side JavaScript
dist/               # Built output (separate git repo on gh-pages branch)
```

## Templating

Uses [saladplate](https://github.com/nicklockwood/saladplate) for templating:

- `$(( command ))` - Execute command and insert output
- `$^(( command ))` - Execute command, insert output at `^^` marker
- `^^` - Injection point for parent template content

Example page structure:
```html
<!-- pages/overview.html -->
$^(( bunx saladplate ../layout.html ))
$(( bunx commonmark ../content/overview.md ))
```

This injects the markdown-rendered content into `layout.html` at the `^^` marker.

## Deployment

The `dist/` directory is a separate git repository tracking the `gh-pages` branch.
GitHub Pages serves from this branch.

## Commands

```bash
bun run watch   # Watch for changes and rebuild
bun run build   # Build site to dist/
bun run deploy  # Build and push to gh-pages
```
