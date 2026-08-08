# Chart size, resize, float, and zoom — design

- **Status:** Approved design, ready for planning.
- **Date:** 2026-08-08
- **Scope:** How diagram blocks are sized, and the user's control over it.
- **Companion to:** [`DESIGN.md`](../../DESIGN.md) §4 (paste), D7 (round-trip fidelity)
- **Follows:** the faithful-paste work (#121), which made pasted charts land as `svg` blocks

## 1. What this is

Pasted charts arrive huge. The diagram frame stretches every drawing to fill the
column (`width: 100%`, capped at 720px) — a rule written for Mermaid and
Graphviz, whose renderers invent their size, and wrong for a pasted `<svg>`
whose author already chose one.

The ruling, per the user: **pasted SVGs render at their real size and gain
resize and float controls; generated diagrams keep filling the column and gain
zoom controls instead.**

## 2. The sizing ruling

| Block language | Sizing |
|---|---|
| `svg` | **Natural size, capped at the column**: `width = min(naturalWidth, column)`. Never stretched up. |
| `svg` with no discoverable size | Fill the column — today's behavior, unchanged. |
| `mermaid`, `dot`, `vega-lite` | Unchanged: fill the column up to 720px; too-wide scrolls (`is-wide`). Zoom (§6) layers on top. |

`naturalWidth()` (width attribute in absolute units, else viewBox) is already
the source of truth for the too-wide decision; this extends it to decide the
render width of `svg` blocks. An explicit `width=` from §4 beats the natural
width.

## 3. Fence meta round-trips, and layout state lives there

Milkdown's `code_block` keeps only the language token of a fence info string:
```` ```svg width=320 ```` parses to `language: "svg"` and the tail is silently
dropped on the next serialise. That is a latent D7 violation for *any* pasted
fence carrying meta (```` ```ts twoslash ````), and it blocks persistence.

The schema is extended (app-side override of `codeBlockSchema`):

- `attrs` gain `meta: ""` alongside `language`.
- `parseMarkdown` captures the remark node's `meta` verbatim.
- `toMarkdown` emits `language` + `" "` + `meta` when meta is non-empty.

Layout params are space-separated `key=value` tokens inside that meta:
`width=<integer px>` and `float=left|right`. Rules:

- **Unknown tokens are preserved verbatim, in order.** The meta is the user's
  bytes; layout edits rewrite only their own keys.
- Only user gestures (drag §4, menu §5) ever write layout keys. An untouched
  block round-trips byte-identically (D7).
- Parsing and rewriting are pure domain functions —
  `parseFenceMeta(meta)` / `withFenceMetaKey(meta, key, value | null)` in
  `src/domain/` — so the grammar is testable without an editor.

## 4. Drag to resize (svg blocks)

- A resize grip appears on an `svg` figure when the block is selected (the
  click-select from #121). Dragging sets the render width live and, on
  release, writes `width=N` into the fence meta through one editor
  transaction — same commit pattern the source sheet uses, one undo step.
- Clamped to [120px, column width]. Dragging to the column edge clears the
  key (back to natural).
- Render precedence for `svg`: `width=` meta → natural → fill.

## 5. Float (svg blocks)

- The diagram context menu (from #121) gains **Float left**, **Float right**,
  **Inline** on `svg` figures only. Choosing one writes `float=left|right`
  into the meta, or removes the key for Inline.
- A floated figure gets CSS `float` with text-side margin; prose wraps around
  it. The menu disables the float items when the figure's effective width
  exceeds 60% of the column — wrapping a sliver of text reads as a bug.
- Narrow viewports (column ≤ 480px) ignore `float` via media query; the block
  falls back to inline so text is never squeezed.
- Floats and `is-wide` scrolling are mutually exclusive by construction: a
  floated figure is ≤ 60% of the column, so it can never be too wide.

## 6. Zoom (generated diagrams)

- `mermaid`, `dot` and `vega-lite` figures get hover controls beside
  `Edit source`: **−**, **percentage readout** (click to reset to 100%), **+**.
- Steps multiply by 1.25; clamp 50%–400%. Zoom scales the drawing's width;
  past the column, the existing `is-wide` scroll takes over.
- Zoom is **transient reader state**, like folding: it lives in the NodeView
  and resets when the note is reopened. It is deliberately not written to the
  document; a `zoom=` meta key can be added later if sticky zoom is wanted.
- `svg` blocks do not get zoom — they have resize (§4); two ways to scale one
  box is a bug report waiting to happen.

## 7. Deliberately not in scope

Pinch/trackpad zoom gestures, persistent zoom, float for generated diagrams,
per-note zoom memory, and any iOS layout work.

## 8. Testing

**Domain (vitest).** `parseFenceMeta` / `withFenceMetaKey`: parses width and
float, preserves unknown tokens verbatim and in order, removes a key cleanly,
round-trips untouched meta byte-identically.

**Editor (Playwright).**
- A pasted small SVG renders at its natural pixel width, not the column's.
- A pasted SVG with no width/viewBox still fills the column.
- Fence meta round-trip: a note containing ```` ```svg width=320 ```` keeps
  those bytes across edit-elsewhere + serialise (D7 guard), and renders 320px.
- Drag the grip → markdown snapshot gains `width=N`; reopening the note
  renders at N (state lives in the document, not the DOM — the remount rule).
- Float left via menu → computed `float: left`, prose wraps; Inline removes
  the key; narrow viewport ignores it.
- Zoom + on a Mermaid figure scales it; past the column `is-wide` engages;
  reset returns to 100%. Existing Mermaid sizing tests stay green unchanged.

## 9. Sequencing

1. **Natural size for `svg` blocks** (§2) — the reported pain, smallest piece.
2. **Zoom for generated diagrams** (§6) — independent of meta; ships second.
3. **Fence meta round-trip** (§3) — the D7 fix and the persistence substrate.
4. **Drag resize** (§4) — on top of 3.
5. **Float** (§5) — on top of 3, last because it is the most experimental.
