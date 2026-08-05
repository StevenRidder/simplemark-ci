# Vega-Lite renderer — design

- **Status:** Approved design, ready for planning
- **Date:** 2026-08-05
- **Phase:** RENDERERS.md §8 Phase 4 (first half; Markmap is the other)
- **Companion to:** [`RENDERERS.md`](../../RENDERERS.md), [`TECH-SPEC.md`](../../TECH-SPEC.md)

## 1. What this is

A sixth renderer. A ` ```vega-lite ` block holding a JSON spec becomes a chart,
and the source stays one click beneath it — the same deal Mermaid, DOT, KaTeX,
SVG and the paste-exhaust cards already offer.

Two data sources render, one does not:

| The spec says | Result |
|---|---|
| `"data": {"values": [...]}` — numbers inside the block | chart |
| `"data": {"url": "sales.csv"}` — relative path from the note | chart |
| `"data": {"url": "https://…"}` | error card |

Inline is the primary path: it is what an agent writes when asked for a chart of
your data, it travels with the document, and `patch_note` can amend three values
without regenerating anything. Relative files exist because a dataset large
enough to be worth charting is often too large to read as JSON in a note.

Remote data is a **separate, later increment** — see §8.

## 2. Architecture

`VegaLiteRenderer` implements the existing `DiagramRenderer` port
([`ports.ts:137`](../../../src/application/ports.ts)) and joins the
`CompositeRenderer` list at [`browser.ts:248`](../../../src/app/browser.ts).
It claims the language `vega-lite`.

```
```vega-lite block
  → CompositeRenderer routes on language
  → VegaLiteRenderer.render(language, source)
      → JSON.parse
      → vega-lite compile → vega spec
      → vega View (renderer: 'none') → view.toSVG()
  → { ok: true, markup: svg }
  → existing rendered-block frame (ADR-0003), click reveals source
```

No editor changes. No NodeView changes. The port is unchanged, so the other five
renderers are untouched.

### 2.1 Data files: constructor injection, not a port change

The renderer is constructed with a data reader:

```ts
export interface ChartDataReader {
  /** Resolve `href` relative to the open note and return its bytes as text. */
  read(href: string): Promise<string>
}

new VegaLiteRenderer(dataReader)
```

Wired at the composition root, where renderers are already assembled. The
function is handed to Vega as a custom loader, so **Vega parses CSV, TSV, JSON
and DSV itself**, including its own `data.format` options. We do not
re-implement any of that.

Two approaches were rejected:

- **Widening `render()` to carry the note's location.** Changes the seam all
  five renderers share to serve one of them.
- **Resolving the URL before render and inlining the values.** Keeps the port
  pure, but means hand-writing CSV/DSV/TopoJSON parsing that Vega already ships.

### 2.2 Path resolution matches document links exactly

The Tauri side gains one narrow command that reuses
`resolve_document_link` ([`lib.rs:237`](../../../src-tauri/src/lib.rs)) and
returns file contents instead of opening the file. That means, verbatim and
without addition:

- **Relative paths resolve against the note's folder and may traverse upward.**
  `data/sales.csv` and `../shared/sales.csv` both work. There is no containment
  check on document links today and none is added here.
- **Absolute paths and `file:` URLs are refused**, with the existing message:
  "Absolute file links are tied to one machine; use a relative Markdown path."
- **`http`/`https` are not fetched.** Where a link hands off to the system
  browser, a chart cannot — so these produce the error card in §4.

A new capability entry is required. It is a file-read scoped to relative
resolution from the open note, not general filesystem access, and
[`capabilities/default.json`](../../../src-tauri/capabilities/default.json)
must be amended to say so accurately.

In the browser build (no Tauri), the reader rejects every `url` with the §4
message. Charts with inline data work identically in both hosts.

## 3. The code-generation risk — resolve this first

**Vega compiles spec expressions with the `Function` constructor.** The packaged
CSP is `default-src 'self'` with no `'unsafe-eval'`
([`tauri.conf.json:28`](../../../src-tauri/tauri.conf.json)), which forbids that.

Vega ships an alternative: parse expressions to an AST and evaluate them with
`vega-interpreter` rather than generating code. This is the documented path for
CSP-restricted hosts and is expected to work here — but it is expected, not
verified.

**Implementation step one is a packaged-build spike**, before any feature work:
build the app, install it, render one chart with an expression in it, confirm it
draws. Nothing else starts until that passes.

This ordering is not caution for its own sake. Dev, vitest and Playwright do not
enforce the packaged CSP — that is exactly how Graphviz shipped broken. A green
test suite is not evidence for this particular question.

If the interpreter path fails, the options are: relax CSP for scripts (rejected
— it weakens the guarantee for every renderer), or drop the feature. We would
rather learn that on day one.

## 4. Failure behaviour

Every failure returns `{ ok: false, message }`. The renderer never throws, so a
bad chart shows an inline error card with its source still editable rather than
taking down the document. Messages:

| Cause | Message source |
|---|---|
| Not valid JSON | the parser's own message |
| Valid JSON, invalid Vega-Lite spec | Vega-Lite's own message |
| Empty source | "Chart source is empty" |
| `url` is `http`/`https` | "Remote data is not loaded. Put the values in the chart, or link a file next to your note." |
| `url` is absolute or `file:` | the existing document-link message |
| Relative file missing or unreadable | the resolver's message |

## 5. Theme

**Charts follow the same mechanism Mermaid already uses, verified working
against `white`, `tan` and `night`.** Do not invent a second theming path.

That mechanism is two parts:

1. The renderer picks its palette from `prefers-color-scheme`, exactly as
   `MermaidRenderer` selects between its `neutral` and `dark` themes
   ([`mermaid-renderer.ts:30`](../../../src/adapters/renderers/mermaid-renderer.ts)).
2. `DiagramNodeView` already listens for `prefers-color-scheme` changes and
   repaints every rendered block
   ([`diagram-node-view.ts:97`](../../../src/adapters/editor/diagram-node-view.ts)),
   because a rendered diagram bakes its colours into the SVG and cannot follow
   CSS. Vega charts inherit that repaint for free — they are rendered blocks
   like any other.

Concretely: axis, label, legend, title and grid colours come from the design
tokens for the active scheme, background stays transparent so the page shows
through, and mark colours are left to Vega-Lite's own scheme. A spec that sets
colours explicitly wins — the config is a floor, not an override.

This satisfies renderer contract rule 3 (RENDERERS.md §3): a chart that is
black-on-black is a defect.

## 6. Paste recognition

A pasted chart is claimed when **both** hold: the text parses as JSON, and its
`$schema` matches `vega-lite/v\d` (TECH-SPEC.md §3, L1 priority 84).

In the §4.2 paste chain it sits at **priority 9** — directly above generic
`json` (8), and below everything more specific. Anything that is both a chart
and JSON must render as a chart, never as a JSON tree.

Requiring `$schema` is deliberate. A spec without it pastes as ordinary JSON. We
do not sniff chart-shaped objects, because the cost of a wrong guess is a
document with a broken card in it (§4.4).

Storage is the ` ```vega-lite ` fence holding the spec verbatim — portable,
diffable, and legible as source in any other Markdown reader.

## 7. Bundle

Vega + Vega-Lite is ~1.1 MB, in the on-demand column of the RENDERERS.md §7
budget. It loads through a dynamic import in its own chunk, exactly as the
Graphviz wasm does, and is never preloaded. A note with no chart pays nothing
and reaches no external host.

## 8. Out of scope

- **Remote data with consent.** Allow / Ask / Block in preferences, click-to-
  approve per chart, fetch performed by the Rust side rather than the webview.
  This is the app's first network permission and deserves its own spec.
- **Interactivity.** `toSVG()` output is static: no tooltips, no pan, no zoom,
  no selections. A live Vega view would need the port to hand over a DOM element
  instead of markup.
- **Referencing a Markdown table elsewhere in the note.** Appealing — the data
  stays readable as a table — but it is not real Vega-Lite, so the block stops
  being portable (D1). Revisit if inline JSON proves annoying in practice.
- **Watching data files for changes.** A chart reads its file when it draws.
  Editing the CSV in another app updates the chart on reopen, not live.
- **Markmap**, the other half of Phase 4.

## 9. Testing

| Test | Catches |
|---|---|
| Unit: valid inline spec renders SVG | the happy path |
| Unit: each §4 failure returns `ok: false` with the right message | error contract |
| Unit: renderer refuses a language it does not claim | port contract |
| Unit: theme config for `white`, `tan`, `night` | contract rule 3 |
| Unit: reader-theme change re-renders | the "changes with it" requirement |
| Round-trip: spec saves back byte-identical | contract rule 2 |
| Data reader: relative resolves, absolute refused, `https` refused | §2.2 |
| UI: chartless note never fetches the Vega chunk | the bundle promise |
| **Packaged build: a chart with an expression renders in the installed app** | **§3 — the only test that catches the real risk** |

The last row cannot run in vitest or Playwright. It requires building,
installing, and looking.
