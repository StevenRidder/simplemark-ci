# SimpleMark — Renderers

**Two classes of rich content, one rule for choosing between them, and the v1 set.**

- **Status:** Draft 1
- **Date:** 2026-08-01
- **Companion to:** [`TECH-SPEC.md`](TECH-SPEC.md) (recognition + acquisition), [`AGENT-WORKSPACE.md`](AGENT-WORKSPACE.md)

---

## 1. The distinction that decides everything

| | **Renderer** | **Embedded editor** |
|---|---|---|
| Truth lives in | The note, as text | A sidecar file, as structured JSON |
| You edit by | Editing source; the view follows | Manipulating a canvas directly |
| An agent can author it | **Yes, natively** — it is just text | Only by writing JSON it cannot see |
| Merge behavior | Line-based, diffs cleanly | Opaque blob, conflicts are total |
| Cost to add | ~100 lines | A whole application |
| Portability | Renders or degrades to readable source | Broken embed elsewhere |

**The rule: default to renderers. An embedded editor must earn its place by being something you genuinely cannot describe in text.**

You can describe a flowchart. You cannot describe a sketch.

This is not asceticism — it is what keeps [`AGENT-WORKSPACE.md`](AGENT-WORKSPACE.md) possible. Every renderer is a format an agent can write fluently and you can read in a diff. Every embedded editor is a hole in that property.

---

## 2. The v1 set

Six renderers. Together they cover most technical thinking without turning the app into a dozen mini-applications.

| Content | Library | Stored as | Bundle | Tier | Agent-authorable |
|---|---|---|---|---|---|
| **Document** | remark / ProseMirror | the `.md` itself | — | core | ✓ |
| **Diagrams** | [Mermaid 11](https://mermaid.js.org/) | ` ```mermaid ` source | ~1.2 MB | core | ✓✓ |
| **Graphs** | [`@hpcc-js/wasm`](https://github.com/hpcc-systems/hpcc-js-wasm) (Graphviz) | ` ```dot ` source | ~1.5 MB wasm | verified | ✓✓ |
| **Math** | [KaTeX](https://katex.org/) | `$$…$$` / `$…$` | ~280 KB | core | ✓✓ |
| **Code** | [Shiki](https://shiki.style/) | fenced code + lang | ~400 KB lazy | core | ✓ |
| **Charts** | [Vega-Lite](https://vega.github.io/vega-lite/) | ` ```vega-lite ` JSON spec | ~1.1 MB | verified | ✓✓ |
| **Mind maps** | [Markmap](https://markmap.js.org/) | the note's own headings | ~180 KB | verified | ✓ (implicit) |

Everything in this table stores **human- and agent-editable source in the note**, renders live, and degrades to legible text in any other Markdown reader.

### 2.1 Why Vega-Lite is the standout

An agent writes forty lines of declarative JSON with the data inline. You get an interactive chart. The spec stays diffable, reviewable, and version-controlled — and the agent can amend it surgically with `patch_note` rather than regenerating an image.

````markdown
```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "description": "Warm pool hit rate by slot, week of Jul 28",
  "data": {"values": [
    {"slot": 1, "hit": 0.94}, {"slot": 2, "hit": 0.91},
    {"slot": 3, "hit": 0.88}, {"slot": 4, "hit": 0.72}
  ]},
  "mark": {"type": "bar", "cornerRadiusEnd": 3},
  "encoding": {
    "x": {"field": "slot", "type": "ordinal", "title": "Pool slot"},
    "y": {"field": "hit", "type": "quantitative", "title": "Cache hit rate"}
  }
}
```
````

Compare that with an agent producing a PNG: you cannot diff it, cannot amend it, cannot see what data it claims. The spec is the artifact.

**Constraint:** inline data only, capped at 256 KB. `"data": {"url": …}` is stripped — a note must never fetch from the network (`TECH-SPEC.md` §5). Larger datasets reference a CSV attachment, loaded by the host and injected as values.

### 2.2 Why Markmap is unusual and worth it

Markmap doesn't render *new* content — it renders **the note you are already in**. Headings and lists become a mind map. There is no new syntax and nothing for an agent to learn; structure you already wrote becomes a second view of itself.

Two modes:

- **Command:** "Mind map this note" opens the current document's outline as a map in a side panel. Nothing is stored.
- **Block:** a ` ```markmap ` fence renders its own nested list as an embedded map, for a map that is part of the document rather than a view of it.

### 2.3 Why Graphviz alongside Mermaid

They fail differently. Mermaid is better at sequence, state, and journey diagrams and has friendlier syntax. Graphviz's layout engine is dramatically better on dense directed graphs — dependency trees, call graphs, the 39-asset topology in a real plant. Both are one text fence and neither is large. Having both means you never fight a layout engine.

---

## 3. The renderer contract

Every renderer in the table above implements exactly this and nothing more:

```ts
export interface Renderer {
  id: string                      // catalog id, e.g. 'vega-lite@5'
  kinds: string[]                 // recognition kinds it handles
  /** Parse-validate without rendering. Used by the L1 sniffer. */
  validate(source: string): boolean
  /** Render to a self-contained result. Runs in-process (core) or sandboxed. */
  render(source: string, opts: RenderOpts): Promise<RenderResult>
  /** Markdown written to disk for this block. Must be portable. */
  serialize(source: string): string
}

export interface RenderOpts { theme: 'light' | 'dark'; maxWidth: number }
export type RenderResult =
  | { kind: 'svg';    svg: string; height: number }
  | { kind: 'dom';    html: string; height: number }
  | { kind: 'raster'; blob: Blob; width: number; height: number }
```

Four rules, applying to all of them:

1. **`validate` is the sniffer.** L1 recognition (`TECH-SPEC.md` §3) calls it. If it returns true and `render` then fails, that is a bug, not a user-facing ambiguity.
2. **`serialize` round-trips.** `serialize(source)` parses back to the same source. Enforced by test.
3. **Theme-aware.** Every renderer takes `theme` and produces output legible on both grounds. A diagram that is black-on-black in dark mode is a defect.
4. **Click reveals source.** Universal interaction, no exceptions. The rendered thing is a view; the source is one click beneath it.

---

## 4. Storage rules per class

**Renderers** — source in the note, portable everywhere:

````markdown
```mermaid
flowchart TB
  A --> B
```
````

**Embedded editors** — sidecar plus a raster fallback plus an invisible pointer, per `DESIGN.md` §5:

```markdown
![Sketch: warm pool invalidation](attachments/9f3a2b.png)
<!-- simplemark:embed kind=excalidraw src=attachments/9f3a2b.excalidraw.json -->
```

In Bear, Obsidian, or GitHub that is a picture with a caption. In SimpleMark it is a live editor. The sidecar is JSON, so an agent can read and even modify it — awkwardly, but not opaquely.

---

## 5. Later: the second tier

Deferred, in rough order of likely value.

| Content | Library | Class | Why it waits |
|---|---|---|---|
| **Drawings** | [Excalidraw](https://docs.excalidraw.com/) | Embedded editor | **The sanctioned exception** — see §6 |
| **Spreadsheets** | AG Grid / Handsontable | Renderer (CSV) → editor | CSV renders as a table in v1; editing is the increment. Easy to bloat: no formulas, no pivot tables, no charts-in-cells. |
| **Maps** | MapLibre GL | Renderer (GeoJSON) | GeoJSON already recognised at L1; interactive map is a verified renderer. Needs offline tiles or it violates no-network. |
| **Freeform canvas** | [tldraw](https://tldraw.dev/) | Embedded editor | Overlaps Excalidraw. Pick one; do not ship both. |
| **Flowchart canvas** | React Flow | Embedded editor | Mermaid already covers the content. This is visual authoring of the same thing — nice, not necessary. |
| **3D** | Three.js | Renderer (glTF ref) | Expensive, narrow, heavy. Only if a real need appears. |
| **Handwriting + OCR** | custom | Embedded editor | Waits on the public plugin API (`DESIGN.md` D5) |

### 5.1 The explicit no-list

- **No generic public plugin system before the renderers are proven.** Each renderer is a small local feature with one storage format and the click-to-edit rule. The API generalizes from four working examples, not from speculation.
- **No renderer that needs the network at render time.** Non-negotiable (`TECH-SPEC.md` §5).
- **No two renderers for the same job.** Excalidraw or tldraw, not both.

---

## 6. Excalidraw: the right kind of exception

If you find yourself drawing rather than describing, add exactly one canvas.

Excalidraw qualifies because it satisfies the conditions an embedded editor must meet:

| Condition | Excalidraw |
|---|---|
| Content genuinely cannot be text | A sketch has no source form |
| Structured, documented file format | `.excalidraw.json` — an agent can read and write it |
| Renders to a portable raster | PNG export, so other apps show the drawing |
| Self-contained, no network | Fully local |
| One clear storage format | One sidecar, one pointer comment |

Note what it does *not* get: it is not a precedent. The next canvas has to make the same case from scratch.

---

## 7. Bundle budget

| | Bundled | On demand |
|---|---|---|
| Core (remark, ProseMirror, Mermaid, KaTeX, Shiki) | ~2.4 MB | — |
| Graphviz wasm | — | 1.5 MB |
| Vega-Lite + Vega | — | 1.1 MB |
| Markmap | — | 180 KB |
| Excalidraw (later) | — | ~1.8 MB |

App binary target: **under 40 MB** including the Tauri shell. Everything past core is fetched once, hash-verified, cached, and works offline thereafter (`TECH-SPEC.md` §4.2).

---

## 8. Build order

| Phase | Renderers |
|---|---|
| **1** | Markdown + Mermaid (the vertical slice) |
| **2** | Shiki, KaTeX, images, CSV → table, JSON/YAML tree — all core, all offline |
| **3** | Catalog + sandbox proven with Graphviz as the first verified renderer |
| **4** | Vega-Lite, Markmap |
| **5** | Converters: pptx, docx, pdf → raster |
| **7+** | Excalidraw, then spreadsheets or maps if the need is real |

By end of Phase 4 the v1 set is complete: **Markdown, Mermaid, DOT, KaTeX, Shiki, Vega-Lite, Markmap.** That is the set worth building, and it is small enough to build well.
