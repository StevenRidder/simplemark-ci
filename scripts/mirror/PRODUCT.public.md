# SimpleMark

SimpleMark is a local-first Markdown reader and editor for people who want the work to feel like a document, not a source file with a preview attached.

## The product

Open a `.md` file and read it as one composed page. Mermaid, SVG, Graphviz, Vega-Lite, math, tables, code, terminal captures, diffs, JSON, images, links, callouts, and ordinary Markdown can live together in the same note. The source remains portable Markdown beside the rendered view.

SimpleMark is designed for the common handoff where another tool has already produced the file: a coding agent, terminal, script, or person. The reader can judge the result first and make a small, contextual correction only where needed.

## Current principles

- **Reader first.** The rendered document is the default surface.
- **Local files first.** Notes, links, images, and chart data remain inspectable on disk.
- **Portable output.** Every rich renderer has a Markdown fallback that remains useful elsewhere.
- **Quiet editing.** Source appears in context instead of taking over the whole experience.
- **Visible failure.** A renderer error is explained in the document rather than becoming an empty box.

## Current preview

The pre-alpha macOS app opens files and folders, renders the document canvas, watches external file updates, and saves with byte-preserving block fidelity. The browser composition uses the same application core. Mobile reading is an early prototype.

SimpleMark does not require a hosted account or proprietary document store. It is useful with the files you already have.
