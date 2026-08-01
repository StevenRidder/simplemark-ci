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
| Editor core | Milkdown / ProseMirror — **gated on the fidelity spike below** |
| Truth | Plain `.md` files in a folder; SQLite is a rebuildable cache |
| Fidelity | Untouched blocks are preserved byte-for-byte; only edited blocks re-serialize |
| Sync | Delegated to iCloud Drive / any synced folder — no server, no accounts |
| Canvas | Single unified view, no source/preview split |
| Typography | Bear-style: font, size, line height, theme in preferences |
| Extensibility | Internal extension points in v1, shaped to become the public plugin API |
| License | Apache-2.0 or MIT — permissive, so a hosted or proprietary layer stays possible |

## First task — a go/no-go spike

Open a hostile real-world document, save it without editing, and diff. Then edit one block and diff everything else.

The entire files-as-truth promise rests on untouched content never being rewritten — no renumbered lists, no repadded tables, no restyled fences. No off-the-shelf Markdown editor does this, because serializers normalize. So the spike answers one question: can Milkdown be extended to preserve source, or does the document model need to be built on ProseMirror with an explicit source map?

Ten acceptance fixtures are listed in [`docs/DESIGN.md` §12](docs/DESIGN.md). Nothing else starts until it resolves.
