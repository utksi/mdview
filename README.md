# mdview

A browser-only markdown viewer with side-by-side editing and preview,
synchronized scrolling, selection mirroring, math (KaTeX), code
highlighting, mermaid diagrams, and a responsive layout that works
on tiled windows and mobile.

**Live demo:** `https://<user>.github.io/mdview/` (after enabling Pages — see below)

## Features

- **Four view modes** — side-by-side, stacked, source-only, preview-only
- **Synchronized scrolling** between editor and preview, both directions
- **Selection mirroring** — selecting text in either pane highlights the
  matching region in the other
- **Math** — inline `$…$` and block `$$…$$` rendered with KaTeX
- **Code** — fenced blocks with `highlight.js` (auto-detect or explicit language)
- **Diagrams** — fenced ` ```mermaid ` blocks rendered with Mermaid (loaded lazily)
- **GFM extras** — task lists, tables, footnotes-style references, `<details>`,
  `<mark>` highlights, autolinks
- **File I/O** — open via picker, drag-and-drop, or paste from clipboard;
  save as `.md`, export as standalone `.html`, or print to PDF
- **Themes** — light, dark, and auto (follows OS); persists across reloads
- **Persistence** — your last edit is restored automatically (localStorage,
  with safe in-memory fallback)
- **Keyboard shortcuts** — press `?` to see the full list
- **Accessible** — semantic markup, keyboard nav, `prefers-reduced-motion`,
  `prefers-contrast`, ARIA roles
- **Mobile-friendly** — tab strip for narrow widths, touch-friendly splitter,
  safe-area-inset support
- **Security** — all rendered HTML passes through DOMPurify; external links
  get `rel="noopener noreferrer"`

## Local use

This is a static site with no build step:

```bash
# any static server works
python3 -m http.server 8000
# then open http://localhost:8000/
```

Or just open `index.html` directly (some browsers restrict `fetch()` on
`file://` — the welcome doc falls back to an inline string in that case).

## Deploy on GitHub Pages

1. Push to a branch that GitHub Pages serves from (typically `main`).
2. In the repo settings → Pages, choose **GitHub Actions** as the source.
   The workflow at `.github/workflows/pages.yml` will build and deploy on
   every push to `main`.
3. Wait for the action to finish; the URL appears in the workflow summary.

Alternative: set Pages source to "Deploy from a branch" → `main` / `/` (root).
The `.nojekyll` file disables Jekyll processing so paths beginning with `_`
work correctly.

## Project layout

```
.
├── index.html              # app shell, vendor + app scripts
├── css/styles.css          # responsive, themed, print-ready
├── js/
│   ├── storage.js          # localStorage with in-memory fallback
│   ├── markdown.js         # markdown-it + KaTeX + mermaid + DOMPurify
│   ├── editor.js           # CodeMirror wrapper + markdown shortcuts
│   ├── sync.js             # synchronized scroll + selection mirroring
│   ├── files.js            # open / save / drag-drop / paste / export
│   ├── shortcuts.js        # global keyboard shortcuts
│   └── app.js              # entry: wires everything together
├── examples/welcome.md     # the default document
├── .github/workflows/pages.yml
├── .nojekyll
└── README.md
```

## Vendor libraries (loaded from CDN)

| Library      | Purpose                                  |
|--------------|------------------------------------------|
| CodeMirror 5 | source editor (markdown mode)            |
| markdown-it  | markdown parser                          |
| KaTeX        | LaTeX math rendering                     |
| highlight.js | code block syntax highlighting           |
| Mermaid 10   | diagrams (loaded only when a `mermaid` fence appears) |
| DOMPurify    | HTML sanitization before injection       |

Total cold-start payload is roughly 350 KB gzipped; Mermaid (~600 KB) is
loaded only if needed.

## Privacy

Everything happens client-side. No file is uploaded anywhere. The only
network requests the page makes are for the static vendor libraries on
first load (which your browser then caches).

## License

MIT — see [LICENSE](LICENSE).
