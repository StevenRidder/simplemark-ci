# The figure viewer everywhere, and a figure you can take with you — design

- **Status:** Approved design, ready for implementation.
- **Date:** 2026-08-09
- **Scope:** Which blocks open full screen, and what the viewer lets you do with a figure once open.
- **Builds on:** the figure viewer (#144-era), the chip chrome (#145), viewer scroll/zoom (#148), tap-to-open on touch (98946c1).

## 1. Rulings

1. **Open figure is offered on every rendered block** — `mermaid`, `dot`,
   `graphviz`, `vega-lite`, `svg`, display math, and the text cards
   (`ansi`, `diff`, `json`, `tree`, `stacktrace`): always present in the
   selection chip toolbar with a tooltip, regardless of width — and, revised
   by field use (2026-08-09): the standalone corner button is universal too.
   The overflow-only gate matched "wide mermaid" and nothing else, so the
   visible affordance read as mermaid-only; the corner button now appears on
   every rendered block, and only the touch tap-to-open keeps its overflow
   gate. Plain editable fences (```yaml`,
   ```python`) get nothing — they are already text in the note.
2. **Text cards open as a reading overlay**: the same viewer shell, the
   card's rendered content at readable width, native two-axis scrolling.
   Zoom controls may be hidden for text cards if font scaling is not
   already free — scrolling is the point.
3. **The viewer toolbar grows four actions**, availability by kind:
   - `Copy source` — every kind; the fence's text through the clipboard port.
   - `Print figure` — every kind; while the viewer is open a body class plus
     viewer-scoped `@media print` rules hide everything else and
     `window.print()` prints just the figure content.
   - `Copy image` and `Save image` — SVG-rendered kinds only (not text
     cards): serialize the figure's **natural-size** render (never the
     viewer zoom or the block's `width=` — exports must not inherit how you
     happened to be looking at it), rasterize at 2× via canvas for PNG.
     `Save image` offers PNG (default) and, where the render is SVG, the raw
     SVG as the vector option, through the shell's save dialog. Prefer
     Vega's own export API for `vega-lite` figures.
4. **Packaged-app reality governs the clipboard and save paths**: image
   clipboard writes go through the shell (Rust) clipboard, following the
   deferred-table copy precedent — WKWebView's ClipboardItem support is not
   to be trusted, and this is the Graphviz class of packaged-only failure.
   The browser build degrades honestly: canvas→blob download for save;
   clipboard-image best-effort with a visible status message on refusal
   (§4.4 — never silently no-op).
5. **Everything is a verb.** `diagram.openFigure()`, and viewer-scoped
   `copySource` / `copyImage` / `saveImage` / `printFigure` are exposed on
   the app API; `diagramOpenFigure` joins the command registry and the
   Format → Diagram submenu (enabled whenever a diagram block is selected).
   The export verbs stay API+viewer-only (no menu ids yet).

## 2. Not in scope

Image export for text cards (HTML rasterization), copying a *zoomed* view,
PDF export, multi-figure export, and any change to touch gestures.

## 3. Testing

Playwright: the chip opens the viewer for one figure of each family
(vega-lite, mermaid, svg, math, and an ansi text card — the text card
scrolls); Copy source round-trips through the clipboard; Save image
produces a PNG whose natural dimensions match the drawing (browser download
path); Print toggles the body class and the viewer content is the only
printable subtree (assert computed `display` under the print class);
`window.simplemark.diagram.openFigure()` opens the viewer on a selected
block and returns false on prose. Packaged-only clipboard behavior is
documented for a manual check, not simulated.
