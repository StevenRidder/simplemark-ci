# SimpleMark

An open-source Bear clone with world-class typography that renders raw Markdown, Mermaid, SVG, and code the instant you paste it.

**The defining behavior:** paste raw Mermaid source or a raw `<svg>` tag — with no code fence — and it becomes a picture. No mode switch, no menu, no plugin install.

## Status

Design stage. No code yet.

- [`docs/DESIGN.md`](docs/DESIGN.md) — architecture, plugin API, paste pipeline, wireframe
- [`docs/wireframe.html`](docs/wireframe.html) — interactive interface wireframe (open in a browser)

## The bet

Every existing open-source notes app — Obsidian, Zettlr, Logseq, Joplin — made the same bet: files on disk are the truth and the editor is a viewer over text. That is why none of them render arbitrary rich blocks inline on one canvas.

SimpleMark keeps files as the truth but treats the editor as a real document canvas, so a plugin can own a rectangle of the page. Diagrams, SVG, highlighted code, and later handwriting all render in place, and everything still serializes back to portable Markdown.

| Decision | Choice |
|---|---|
| Editor core | Milkdown (MIT) — Markdown-AST-as-truth on ProseMirror |
| Truth | Plain `.md` files in a folder; SQLite is a rebuildable cache |
| Sync | Delegated to iCloud Drive / any synced folder — no server, no accounts |
| Canvas | Single unified view, no source/preview split |
| Typography | Bear-style: font, size, line height, theme in preferences |
| Extensibility | Real plugin API; Mermaid, SVG, code, wikilinks are built *on* it |
| License | Apache-2.0 or MIT — deliberately not GPL |

## First task

A round-trip spike: load a real, hostile document into a bare Milkdown instance, `parse → serialize`, and diff against the original. The entire files-as-truth architecture rests on that being lossless. One day of work that validates or kills the core decision before any app code exists.
