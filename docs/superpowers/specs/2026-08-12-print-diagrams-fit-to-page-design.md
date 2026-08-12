# Print diagrams fit to page — design

- **Status:** Approved design, ready for implementation plan.
- **Date:** 2026-08-12
- **Scope:** Make Mermaid (and other SVG diagram) blocks print/PDF correctly when using File → Print / Cmd+P.
- **Builds on:** Paper / APP-21 (`src/app/styles/print.css`), figure chrome (`.diagram-expand`, `.diagram-chips`), wide-figure scroll (`.diagram-render.is-wide`).

## 1. Problem

Printing a note with wide Mermaid gantt charts (e.g. via Save as PDF) produces blank figure regions and still shows the **Open figure** corner button. Tables and prose print fine.

Root cause (two print gaps, not bad Mermaid source):

1. `print.css` hides `.diagram-chips` but not `.diagram-expand` / `.diagram-resize-grip`, so the corner affordance reaches paper.
2. On screen, figures wider than ~1.6× the column become `.diagram-render.is-wide` (`overflow-x: auto`, fade mask, SVG `width: auto`). Print never unwraps that path, so the OS print snapshot keeps a clipped scroll viewport and the drawing mostly disappears.

## 2. Ruling

1. **Print is still a stylesheet.** No `beforeprint` DOM mutation, no raster swap, no change to figure-viewer “Print figure”. APP-21 stands: `@media print` in `print.css` is the entire definition of what reaches paper.
2. **Fit to page.** On paper, every diagram SVG shrinks to the sheet width (`width` / `max-width: 100%`, `height: auto`), including figures that were `.is-wide` on screen. Dense charts may get smaller labels; that is the accepted tradeoff versus clipping.
3. **On-screen behavior unchanged.** Wide scroll, fade mask, Open figure, and resize grip stay as they are for interactive reading.
4. **Colors print.** Mermaid bar fills must not wash out under WebKit’s default print color stripping — use `print-color-adjust: exact` (and `-webkit-print-color-adjust: exact`) on `.diagram-render`.

## 3. Changes

### `src/app/styles/print.css` (inside the existing `@media print` block)

Add / extend rules so that:

| Concern | Print rule |
| --- | --- |
| Reader chrome | Also `display: none` for `.diagram-expand` and `.diagram-resize-grip` (alongside existing `.diagram-chips` / `.diagram-label`) |
| Clip / scroll | `.diagram` and `.diagram-render` → `overflow: visible` (and clear any print-time need for `overflow-x: auto` on `.is-wide`) |
| Fade mask | `.diagram-render.is-wide` → `-webkit-mask-image: none; mask-image: none` |
| Fit SVG | `.diagram-render svg` and `.diagram-render.is-wide svg` → `width: 100%; max-width: 100%; height: auto` (must beat the screen `.is-wide svg { width: auto; max-width: none }` rule) |
| Fills | `.diagram-render` → `print-color-adjust: exact; -webkit-print-color-adjust: exact` |

Keep existing break-inside / max-width helpers; do not invent a separate print layout engine.

### `tests/ui/print.spec.ts`

Under `page.emulateMedia({ media: 'print' })`, cover a note that contains a wide Mermaid (or any SVG diagram that lands `.is-wide` on screen):

- `.diagram-expand` is not visible / `display: none`
- `.diagram-render` (wide) has `overflow` visible (or not clipping via `overflow-x: auto`)
- computed mask is none
- diagram `svg` has `max-width` of `100%` (fit-to-page)

Existing print chrome / continuous-flow tests stay.

## 4. Out of scope

- Rasterizing figures for print
- `beforeprint` / `afterprint` JS width rewriting
- Multi-figure batch export / dedicated PDF export pipeline
- Changes to figure-viewer “Print figure” (`body.is-printing-figure`)
- Changing on-screen `#WIDEST_SQUEEZE` or fill-cap behavior

## 5. Success criteria

- File → Print → PDF of a note with wide Mermaid gantt charts shows the full charts scaled to page width, with no **Open figure** control on the sheet.
- Narrow diagrams and non-diagram content keep today’s print quality.
- Playwright print media assertions above pass.
