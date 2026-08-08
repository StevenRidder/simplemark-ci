# SimpleMark Living Handbook — design

**A beautiful ten-minute guided tour that teaches SimpleMark by being a real SimpleMark document.**

- **Status:** Approved design
- **Date:** 2026-08-08
- **Default set:** Living Handbook + Project Tanoa Storm Atlas
- **Product authority:** [`PRODUCT.md`](../../PRODUCT.md)
- **Renderer truth:** [`RENDERERS.md`](../../RENDERERS.md) and the current browser/Tauri compositions

## 1. Outcome

Ship two default sample documents in both SimpleMark shells:

1. **Welcome to SimpleMark** — a warm, practical ten-minute tour and durable capability reference.
2. **Project Tanoa: Storm Atlas** — the cinematic proof that the same ordinary Markdown can carry a
   high-stakes technical story.

The handbook is useful before it is impressive. It teaches reading, paste recognition, contextual
source correction, and file trust through the document itself. It then becomes a reference people
can keep nearby.

The two documents have distinct personalities. The handbook is bright, clear, and studio-like;
Project Tanoa remains atmospheric, place-driven, and urgent.

## 2. Product boundary

The default experience remains the rendered document. The handbook does not introduce a tutorial
wizard, feature dashboard, permanent source pane, chat surface, or hidden document library.

The samples are ordinary Markdown compiled into the application as session-local examples. They are
clearly labelled **Samples**. Editing them is safe and useful, but the edits reset when the app
restarts. SimpleMark does not silently copy sample files into the user's Documents folder.

Opening a real file leaves the sample experience and uses the existing local-file workflow. The
samples do not change document authority, persistence, or source-fidelity rules.

## 3. Canonical sources

The only authored sources are:

- `docs/showcase/welcome-to-simplemark.md`
- `docs/showcase/project-tanoa-storm-atlas.md`

App code imports those exact files as raw Markdown at build time. No TypeScript template literal may
duplicate their contents. A small shared sample catalogue supplies the same identifiers, titles,
previews, and Markdown bytes to the browser and Tauri entrypoints.

The catalogue contains exactly the two public samples. Existing small fixture notes may remain in
tests where they prove a focused behavior, but they no longer define the public first impression.

## 4. Handbook story

Working title and deck:

> # Welcome to SimpleMark
> *This document is the demo.*

The document moves through six chapters.

### 4.1 Start here

Explain the promise in under sixty seconds:

- open ordinary Markdown;
- read the rendered page immediately;
- click a rendered technical block to reveal only that block's source; and
- save an ordinary Markdown file.

The opening is calm and visual, not a wall of instructions.

### 4.2 Make ordinary Markdown beautiful

Demonstrate headings, emphasis, underline, links, images, blockquotes, callouts, lists, checklists,
tables, footnotes, wiki links, highlighted code, inline math, and display math in natural prose.
Every element must help explain the product; the chapter must not read like a syntax specimen.

### 4.3 Paste technical material like magic

Show the current recognition paths and the rendered result they produce:

| Pasted material | Result |
| --- | --- |
| Mermaid | diagram |
| raw SVG | sanitised illustration |
| Graphviz/DOT | dense directed graph |
| Vega-Lite | chart |
| display LaTeX | typeset math |
| JSON | collapsible tree |
| unified diff | review card |
| ANSI terminal capture | coloured terminal card |
| file tree | monospace tree card |
| stack trace | folded diagnostic card |
| spreadsheet cells | real GFM table |

Recognition is described as deterministic and validated. The guide never promises that arbitrary
text will be guessed correctly.

### 4.4 Change the picture by changing the source

Four yellow **Try it** callouts invite small, reversible corrections:

1. Rename a Mermaid node and watch the diagram update.
2. Change one Vega datum and watch the chart rebalance.
3. Change one SVG colour and watch the illustration update.
4. Change one number in a display equation and watch the typeset result refresh.

Instructions say what to click, the exact small value to change, and what visible result to expect.
The original and edited states must both be valid so no guided step produces a parser error.

### 4.5 Understand the trust model

Explain only the user-facing consequences:

- the file stays Markdown;
- rendered blocks keep readable portable source;
- failures are visible rather than blank;
- undo reverses the correction;
- untouched blocks retain their original bytes after a save; and
- desktop external-file refresh is distinct from authorship or automatic merge.

Do not expose internal authority, fencing, or adapter vocabulary unless it helps the reader act.

### 4.6 Keep this page nearby

End with:

- a compact keyboard and interaction card;
- a document-capability matrix;
- a paste-recognition matrix;
- an app-capability matrix with honest web/macOS distinctions; and
- a checklist of safe experiments to try in the sample or in a new local file.

## 5. Visual system

Use a bright studio palette: warm paper, deep ink, sea-glass green, coral, and amber. Preserve the
application's typography and house renderer theme rather than styling the Markdown with private
HTML or external CSS.

One major visual per screenful supplies rhythm. Prose stays short enough to read at publication
width. Tables are used for exact mappings; callouts are used for actions, cautions, and outcomes.

The principal visuals are:

- a self-contained SVG hero showing source becoming a living document;
- a Mermaid journey from AI output to human judgment;
- a Vega-Lite radial chart showing the anatomy of a strong AI document;
- a Vega-Lite heatmap mapping paste formats to rendered outcomes;
- a Graphviz recognition and rendering path;
- a small KaTeX composition equation; and
- a technical evidence wall containing code, JSON, diff, ANSI, tree, and stack trace blocks.

All example values are either facts about the document itself or plainly labelled illustrative
data. No raster screenshot stands in for a live capability. Charts use inline values and no sample
requires a network request or sidecar file.

## 6. Capability truth

The handbook documents current user-visible behavior, not the renderer roadmap. At design time the
compositions include Mermaid, sanitised SVG, Graphviz, KaTeX, Vega-Lite, and the ANSI/diff/JSON/tree/
stack-trace text cards. Markmap is documented elsewhere but not wired into the current composition,
so it is excluded.

The app reference covers the current reader and file surfaces: opening and saving local Markdown,
recent notes and folders, search and navigation, reader appearance, page and text zoom, document
statistics, print/PDF, contextual editing, and desktop external-file refresh. Platform labels must
come from current code and executable tests during implementation; the prose must not infer parity.

Planned collaboration, hosted persistence, automatic merge, universal writer attribution, release
distribution, or unsupported platforms are not presented as shipped capabilities.

## 7. Shell integration

A shared `SampleDocument` catalogue is the only new app-level concept. It contains static metadata
and the canonical raw Markdown strings; it does not parse content or own document behavior.

Both entrypoints continue to compose the existing `FixtureFilePort` around a selected sample. The
browser's current demo notes and Tauri's single welcome row are replaced by the same two-sample
catalogue. Selection rebuilds the normal composition exactly as it does today. Opening a user file
continues to replace the fixture port with the appropriate real file port.

The landing sample is **Welcome to SimpleMark**. **Project Tanoa: Storm Atlas** is the second visible
sample. Sample status copy states that changes are temporary. No native resource-copy command, app
data database, or user-directory write is added.

## 8. Failure behavior

- A renderer failure shows the existing visible error state; the sample must never leave a blank
  rectangle.
- Source remains available when a technical block cannot render.
- A malformed guided edit is prevented by giving exact known-valid replacements.
- Missing network access cannot break the samples because every required value and visual is inline.
- The canonical Markdown remains understandable in another Markdown reader even when its renderer
  is unavailable.

## 9. Verification

Implementation is accepted only when all of the following are true:

1. A source-contract test confirms that the handbook includes every promised renderer and rich
   document form, and includes no unsupported Markmap claim.
2. Catalogue tests confirm that web and Tauri expose the same two sample identifiers and exact
   canonical Markdown bytes.
3. The current composite renderer successfully renders every technical block in the handbook; no
   result is empty and every expected failure path remains visible.
4. Guided Mermaid, Vega-Lite, SVG, and KaTeX replacements are valid before and after the edit and
   produce observably different rendered output.
5. Opening and untouched-saving both sample documents preserves the original bytes.
6. Project Tanoa's existing document and GIF contracts continue to pass unchanged.
7. The full canonical gate passes, along with `git diff --check` and local Markdown-link checks.
8. A real browser review at the target publication width confirms visual rhythm, readable tables,
   source overlays, and the Samples labels. Native-specific first-run behavior receives a native
   smoke check before it is described as verified.

No animated GIF is part of this task. Motion for the handbook can be considered only after the
default document is approved in the actual app.

## 10. Out of scope

- a third default document;
- a tutorial wizard or completion state;
- new renderer libraries or renderer behavior;
- Markmap;
- remote sample data;
- copying examples into user-owned folders;
- changing Project Tanoa's story, source, or current animation; and
- marketing-site integration or a second GIF.
