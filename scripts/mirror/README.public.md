# SimpleMark

**The calm, beautiful place to read what your agents make.**

SimpleMark opens a local Markdown file as a living document — not a source editor with a preview bolted on. Diagrams, maps, charts, math, code, tables, and technical evidence appear together on one composed page. Keep reading while another tool updates the file; click into the exact passage only when a small correction is needed.

**Always rendered. Always your file.** No vault, account, provider setup, workspace, or permanent Markdown-source view.

![Project Tanoa: a fictional Fulaga microgrid storm report rendering a weather map, reserve forecast, energy diagram, math, terminal evidence, and a source correction in one continuous take](docs/assets/project-tanoa-storm-atlas.gif)

*The 22-second flagship demo is [Project Tanoa: Storm Atlas](docs/showcase/project-tanoa-storm-atlas.md): a fictional commissioning decision in the latest SimpleMark UI. It moves from an approaching cyclone to the battery math, then corrects the live source and returns to the finished document. Regenerate it with `npm run showcase:tanoa:atlas` while the development app is running.*

SimpleMark is not an AI workspace or a cockpit for operating agents. Let Codex, Claude, or another writer create `plan.md`; SimpleMark makes that exact file a document worth judging. The filesystem is the first integration — source remains portable, inspectable, and yours.

## A document, not a preview

| What you need | How SimpleMark behaves |
|---|---|
| **Read the work** | One continuous rendered page. Markdown syntax stays out of the way until you ask for it. |
| **Trust the file** | An untouched save is byte-identical. Editing one block does not renumber lists, repad tables, or restyle another block. |
| **Make a correction** | Select the precise passage, figure, or structure; the source appears only there and saves back as portable Markdown. |
| **Stay current** | The native app watches an opened file and calmly collapses bursts of external writes into the newest document state. |

## Render the work, not the syntax

SimpleMark is built for the outputs an agent or technical team actually produces:

| Kind of evidence | Renders inline |
|---|---|
| **Diagrams and maps** | Mermaid, raw SVG, Graphviz/DOT, Vega-Lite charts and geographic displays |
| **Analysis** | KaTeX display and inline math, data tables, highlighted code, local chart data |
| **Working trail** | ANSI terminal captures, unified diffs, collapsible JSON, file trees, and stack traces |
| **Everyday Markdown** | GFM tables and tasks, images, links, callouts, footnotes, highlights, underline, wiki links, and document structure |

Raw source stays in the `.md`. A Mermaid fence remains a Mermaid fence; a Vega-Lite specification can be reviewed and edited; a raw SVG is sanitized and still travels with the document. Big tables render on a budget, and renderer failures stay visible with a useful diagnostic instead of a blank rectangle.

### Paste without a mode picker

Paste a diagram, formula, chart specification, TSV grid, terminal capture, diff, JSON object, file tree, or stack trace. SimpleMark recognizes bounded, verifiable signatures and gives it the right portable Markdown form. Paste a web article in the native app and it becomes readable Markdown with local images, provenance, and a lightweight trim control — not a fragile web embed.

### Figures behave like part of the page

Charts and diagrams can be selected, resized, floated beside prose, zoomed, or opened into a full-screen figure viewer with pan and zoom. The controls are contextual: a document remains a document until the reader reaches for detail.

## A calm surface over real files

- **Open files and folders directly.** No import step or proprietary database. Note-relative images, document links, and local chart data resolve from the file’s own location.
- **Browse a useful workspace.** Notes have extracted previews, pins, collections, remembered selection, and built-in samples instead of a dead welcome screen.
- **Keep the reader in control.** Find in document, print, reader navigation, whole-page zoom, and persistent typeface, size, leading, width, and theme preferences.
- **Use the platform without losing it.** The desktop shell preserves native menus, services, clipboard exports, Save As, rename, Show in Finder, and Move to Trash.

Two rich samples now ship with the app: [Welcome to SimpleMark](docs/showcase/welcome-to-simplemark.md) is a compact capability tour, while [Project Tanoa: Storm Atlas](docs/showcase/project-tanoa-storm-atlas.md) is the cinematic field report. They are useful documents first and renderer proof second.

## Status

**Pre-alpha, with a working native macOS app.** It opens files and folders from disk, renders the full document canvas, watches external changes, and saves with byte-preserving block fidelity. The same application core powers the browser composition; an iPhone prototype can open and read notes, but does not yet have desktop-grade conflict handling or cross-device change detection.

What is deliberately not the headline: hosted accounts, agent orchestration, and multi-person collaboration. Those remain evidence-gated follow-on work. SimpleMark must be worth installing when it is just you, your local `.md` files, and the things that write them.

## Download (pre-alpha, macOS)

**[Star SimpleMark on GitHub](https://github.com/StevenRidder/simplemark)** to follow the notarized macOS DMG — that build is the public install path and will land on [Releases](https://github.com/StevenRidder/simplemark/releases/latest).

Pre-alpha: expect sharp edges. Always rendered. Always your file. No account.

When the DMG is published, use **Download for macOS** on the latest Release. Until then, starring is the useful follow.

## Run it

    npm install
    npm run dev          # browser composition
    npm run dev:native   # native desktop shell

    npm test             # unit and round-trip suites
    npm run test:ui      # Playwright against the real composition
    npm run typecheck
    npm run check:boundaries
    npm run showcase:tanoa:atlas  # record the flagship GIF

## How it is built

    app → adapters → application → domain

    The domain owns fidelity, save safety, and paste decisions. Application use cases own the document session. Browser and Tauri are adapter sets over that same core — not two product forks. The boundary is mechanically checked with `npm run check:boundaries`.

## Read more

- [Getting started](docs/GETTING-STARTED.md) — install, run, test, and explore the repository
- [Renderer catalog](docs/RENDERERS.md) — the supported formats and their portable fallbacks
- [Storm Atlas](docs/showcase/project-tanoa-storm-atlas.md) — the source behind the demo above
- [Living handbook](docs/showcase/welcome-to-simplemark.md) — a tour of the rendered capabilities

## Licence

Copyright © 6th Element Labs. All rights reserved.

This source is published for reading and evaluation. It is not licensed for redistribution or derivative works. See [LICENSE](LICENSE).
