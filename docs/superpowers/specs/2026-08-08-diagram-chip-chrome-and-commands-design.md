# Diagram chip chrome, and commands an agent can call — design

- **Status:** Approved design, ready for planning.
- **Date:** 2026-08-08
- **Scope:** How a diagram block's controls look, and what programmable surface sits under them.
- **Companion to:** [`DESIGN.md`](../../DESIGN.md) §10 (rendered blocks), the chart-size spec (#138)
- **Supersedes:** the hover-reveal `Edit source` button and the hover zoom cluster from #138.

## 1. What this is

User verdict on the shipped chrome: "the zoom is small and hard to see —
you'd never know it was there," and the Edit source button has the same
fault. The approved redesign: **selection is the mode switch.** Clicking a
diagram (which already takes a `NodeSelection`) reveals a chip toolbar with
every block action, full-size and labeled. Reading shows no chrome at all.

Second ruling: the controls become **commands, not private handlers** — the
chips are thin buttons over an application-level surface an AI agent can call
too. Persistent layout already lives in the fence meta, so agents can edit it
by editing markdown; the commands add the live-session verbs.

## 2. The chip toolbar

Appears when the block is selected (`selectNode`), disappears on deselect.
Positioned inside the figure, top-right, 8px inset, one row, 6px gaps,
~120ms fade-slide entry. Chips are 30px tall, 13px labels, 15–16px icons,
`.note-context-menu`-family styling (surface, 0.5px strong border, 8px radius).

| Chip | Languages | Action |
|---|---|---|
| `Edit source` (labeled, code icon) | all | opens the existing source sheet |
| Zoom pill: − / % readout / + | `mermaid`, `dot`, `vega-lite` | existing transient zoom; readout click resets |
| Float segment: left / inline / right (three icon buttons, active one tinted) | all diagram blocks | writes `float=` meta; segment disabled (not hidden) past the 60% effective-width gate, measured float-proof |
| Delete (trash icon) | all | deletes the block; danger tint on hover only |

Rules:

- The old hover-reveal `.edit-source` button and hover `.diagram-zoom`
  cluster are **removed** — the chips are the single home. The source
  sheet's own Done/close flow is untouched.
- The right-click context menu stays, as the discoverability twin: same
  actions, same commands underneath. Its float items extend from `svg`-only
  to all diagram blocks, matching the segment.
- Figures narrower than 420px collapse chip labels to icons (one row,
  28px squares): Edit source loses its label; the zoom pill keeps −, the %
  readout, and +; float and delete are already icons.
- `math` blocks keep the chrome minimal: `Edit source` and Delete only —
  no zoom, no float, no grip.
- Escape or clicking prose deselects; chrome vanishes. Backspace/Delete on
  the selection still delete with no chrome involved.

## 3. Resize everywhere

The #138 grip extends from `svg` blocks to **every diagram block** (not
math): dragging writes `width=` into the fence meta exactly as it does for
svg today. Render precedence:

- `svg`: unchanged — meta width → natural → fill.
- Generated (`mermaid`, `dot`, `vega-lite`): the fill base becomes
  `metaWidth ?? min(column, 720)`; transient zoom multiplies that base; the
  too-wide scroll rail engages past the column as today.

The grip is 18×18px, accent-colored, bottom-right, visible while selected.

## 4. The command surface

New application-level verbs, routed like every other command id
(`application/commands.ts` names them; the composition root routes them to
the editor). All act on the currently selected diagram block and return
`false` when the selection is not a diagram:

| Verb | Signature (on the app API) | Command id (menubar) |
|---|---|---|
| set width | `diagram.setWidth(px: number \| null): boolean` | — (takes an argument; gesture/API only) |
| float | `diagram.setFloat(side: 'left' \| 'right' \| null): boolean` | `diagramFloatLeft`, `diagramFloatRight`, `diagramFloatInline` |
| delete | `diagram.delete(): boolean` | `diagramDelete` |
| edit source | `diagram.editSource(): boolean` | `diagramEditSource` |
| zoom | `diagram.zoomIn() / zoomOut() / zoomReset(): boolean` | `diagramZoomIn`, `diagramZoomOut`, `diagramZoomReset` |

- The verbs live on the `window.simplemark` app object (the surface the
  tests and future agent participation already use), implemented in the
  editor adapter, wired through the same routing as `bold` — a chip click
  and an API call run identical code.
- Menubar: a **Format → Diagram** submenu lists the id-bearing commands,
  enabled only while a diagram block is selected — the menubar stays the
  complete command surface (native-first rule in `application/commands.ts`).
- Layout verbs write fence meta through one transaction each (undo-friendly),
  reusing `#commitLayout`. Zoom verbs touch the NodeView's transient state.
- Agent participation itself stays gated (ADR-0005); this spec only ensures
  the verbs exist as first-class, callable things.

## 5. Deliberately not in scope

Persistent zoom, keyboard shortcuts for the new commands, touch/iOS chrome,
image blocks, and any change to what the fence meta grammar allows.

## 6. Testing

**Playwright (editor-harness + diagram-frame).**
- Chips absent while unselected; click → all expected chips for the
  language (zoom present on mermaid, absent on svg and math; float absent on
  math); Escape hides them.
- Delete chip removes the block; undo restores it.
- Float segment on a small mermaid writes `float=left` into the snapshot and
  the active segment tints; the segment is disabled on a chart past 60%.
- Grip on a mermaid drags to a persisted `width=` and the render honors it
  with zoom compounding (zoom in after resize scales from the meta base).
- Narrow figure: labels collapse, all actions still reachable.
- API: `window.simplemark.diagram.setFloat('left')` on a selected chart
  updates meta + classes; `setWidth(300)` renders 300px and survives
  serialise; both return false with prose selected.
- Existing suites that clicked the hover `Edit source` button are updated to
  select-first (sweep `tests/` for `Edit source`, `edit-source`,
  `diagram-zoom`).

**vitest.** Command-id table additions parse; no domain changes expected.

## 7. Sequencing

1. Command surface (§4) — verbs + routing + app API, tested through the API.
2. Chip toolbar (§2) shell — chips over the commands; old hover chrome removed;
   existing tests migrated.
3. Float-everywhere + resize-everywhere (§3) + menu parity.
4. Narrow collapse + polish + menubar submenu.
