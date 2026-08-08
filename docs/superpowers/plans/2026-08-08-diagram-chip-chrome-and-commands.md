# Diagram Chip Chrome and Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A selected diagram shows a full-size labeled chip toolbar (Edit source, zoom, float, Delete) and every action is an application-level command an agent can call; the invisible hover chrome is removed, and resize/float extend to all diagram blocks.

**Architecture:** Document-state verbs (float, width, delete) are ProseMirror transactions over the selected diagram node — implementable on `MilkdownEditor` without touching a NodeView. View-state verbs (edit source, zoom) reach the live `DiagramNodeView` through a registry the NodeViews maintain (register on construct keyed by `getPos`, deregister on destroy). A single `DiagramController` on `MilkdownEditor` implements all verbs; the chips inside `DiagramNodeView` and the command registry both call it — one behavior surface, two callers. Command ids join `application/commands.ts` (data only) and route through `runCommand` in `bootstrap.ts` like every other editor command.

**Tech Stack:** TypeScript, Milkdown/ProseMirror, Playwright (behavior lives in the browser), vitest for the registry table.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-08-diagram-chip-chrome-and-commands-design.md`. §2 chip table, §3 resize/float-everywhere precedence, §4 verb signatures are normative.
- The hover `.edit-source` button and hover `.diagram-zoom` cluster are REMOVED; the chips are the only figure chrome, the right-click menu stays as the twin. The source sheet flow (Done button, Escape, drag) is untouched.
- `math` blocks: Edit source + Delete chips only; no zoom, no float, no grip. Verbs return `false` for the unsupported combinations.
- Baseline at branch point `0843921` (includes #138): vitest 81 files / 732 tests green; editor-harness 45 tests; diagram-frame 5 tests.
- Existing tests that click the hover Edit source or `.diagram-zoom` must be migrated to select-first chips — sweep `tests/` for `Edit source`, `edit-source`, `diagram-zoom` (hits today: editor-harness.spec.ts, diagram-frame.spec.ts, project-tanoa-showcase.spec.ts).
- **Playwright port hazard:** prefix every Playwright command with `SIMPLEMARK_TEST_PORT=5397`. Known flakes (platform-smoke in vitest; reload-heavy specs): isolate + rerun before chasing. Skip full vitest while iterating; run it once per task before commit.
- ADR-0001 direction holds: `commands.ts` stays data; behavior lives in the editor adapter; `bootstrap.ts` only routes.

---

### Task 1: The DiagramController and the app API

**Files:**
- Modify: `src/adapters/editor/milkdown-editor.ts` (controller + NodeView registry wiring)
- Modify: `src/adapters/editor/diagram-node-view.ts` (register/deregister; expose `editSource()`/`zoom` entry points; constructor gains a registry handle)
- Modify: `src/application/commands.ts` (id vocabulary + menu entries)
- Modify: `src/app/bootstrap.ts` (routing + `diagram` on the returned app object + command enablement)
- Test: `tests/ui/editor-harness.spec.ts` (API-level tests), `tests/domain` none.

**Interfaces:**
- Produces (Tasks 2-4 call these; signatures are §4-normative):
  - On `MilkdownEditor`: `readonly diagram: DiagramController` where
    `interface DiagramController { setWidth(px: number | null): boolean; setFloat(side: 'left' | 'right' | null): boolean; delete(): boolean; editSource(): boolean; zoomIn(): boolean; zoomOut(): boolean; zoomReset(): boolean; kind(): 'svg' | 'generated' | 'math' | null }`
  - `kind()` returns null when the selection is not a diagram block; 'generated' for mermaid/dot/vega-lite.
  - New `DocumentCommandId` members: `diagramEditSource`, `diagramFloatLeft`, `diagramFloatRight`, `diagramFloatInline`, `diagramDelete`, `diagramZoomIn`, `diagramZoomOut`, `diagramZoomReset` — grouped in a `Format → Diagram` submenu, target `'editor'`, no accelerators.
  - On the app object: `diagram: DiagramController` (delegating to the editor; every verb returns false before the editor mounts).

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/editor-harness.spec.ts` (helpers `pasteAtEnd`, `caretAtEnd`, `editor`, `BARE_MERMAID`, `SMALL_SVG` all exist):

```ts
// §4 of the chip-chrome spec: every block action is a command an agent can
// call; the chips are buttons over the same verbs.
test('diagram verbs act on the selected block and refuse elsewhere', async ({ page }) => {
  await pasteAtEnd(page, SMALL_SVG)
  await expect(page.locator('.diagram')).toHaveCount(2)

  await caretAtEnd(page)
  expect(await page.evaluate(() => window.simplemark!.diagram.setFloat('left'))).toBe(false)

  await page.locator('.diagram').last().locator('.diagram-render').click()
  await expect(page.locator('.diagram.is-selected')).toHaveCount(1)

  expect(await page.evaluate(() => window.simplemark!.diagram.setFloat('left'))).toBe(true)
  await expect(page.locator('.diagram').last()).toHaveClass(/diagram--float-left/)
  expect(await page.evaluate(() => window.simplemark!.diagram.setWidth(160))).toBe(true)
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toMatch(/```svg[^\n]*width=160/)
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toMatch(/```svg[^\n]*float=left/)

  expect(await page.evaluate(() => window.simplemark!.diagram.delete())).toBe(true)
  await expect(page.locator('.diagram')).toHaveCount(1)
})

test('zoom verbs drive a generated diagram and refuse on svg', async ({ page }) => {
  await pasteAtEnd(page, BARE_MERMAID)
  await expect(page.locator('.diagram')).toHaveCount(2)
  const figure = page.locator('.diagram').last()
  await figure.locator('.diagram-render').click()

  const before = (await figure.locator('.diagram-render svg').boundingBox())!.width
  expect(await page.evaluate(() => window.simplemark!.diagram.zoomIn())).toBe(true)
  await expect.poll(async () => (await figure.locator('.diagram-render svg').boundingBox())!.width)
    .toBeGreaterThan(before * 1.1)
  expect(await page.evaluate(() => window.simplemark!.diagram.zoomReset())).toBe(true)

  await pasteAtEnd(page, SMALL_SVG)
  await expect(page.locator('.diagram')).toHaveCount(3)
  await page.locator('.diagram').last().locator('.diagram-render').click()
  expect(await page.evaluate(() => window.simplemark!.diagram.zoomIn())).toBe(false)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `SIMPLEMARK_TEST_PORT=5397 npx playwright test tests/ui/editor-harness.spec.ts -g "diagram verbs|zoom verbs" --reporter=list`
Expected: FAIL — `window.simplemark.diagram` is undefined.

- [ ] **Step 3: Implement**

3a. In `src/adapters/editor/diagram-node-view.ts`:
- Export an interface near the top:

```ts
/** Live NodeView handles, so view-state verbs (edit source, zoom) can reach
 * the instance that owns the sheet and the transient zoom. Keyed by getPos. */
export interface DiagramViewRegistry {
  register(view: DiagramNodeView): void
  deregister(view: DiagramNodeView): void
}
```

- Constructor gains a fifth parameter `private readonly registry: DiagramViewRegistry | undefined` (optional, default undefined, so existing construction keeps working); call `registry?.register(this)` at the end of the constructor and `this.registry?.deregister(this)` in `destroy()`.
- Add public entry points that wrap the existing private machinery (names exact — Task 2's chips and the controller both call them):

```ts
  /** The block's position, for registry lookups. */
  blockPos(): number | undefined {
    return this.getPos()
  }

  language(): string {
    return ((this.#node.attrs['language'] as string | undefined) ?? '')
  }

  openSource(): void {
    this.#setShowingSource(true)
  }

  zoomBy(step: 'in' | 'out' | 'reset'): boolean {
    if (!DiagramNodeView.#ZOOMABLE.has(this.language())) return false
    if (step === 'reset') this.#setZoom(1)
    else if (step === 'in') this.#setZoom(this.#zoom * DiagramNodeView.#ZOOM_STEP)
    else this.#setZoom(this.#zoom / DiagramNodeView.#ZOOM_STEP)
    return true
  }
```

3b. In `src/adapters/editor/milkdown-editor.ts`:
- Maintain the registry: a `Map<DiagramNodeView, true>` (a Set) held by `MilkdownEditor`; pass a `DiagramViewRegistry` into every `new DiagramNodeView(...)` construction site (the codeBlockView closure and the mathView closure).
- Implement the controller as a class field on `MilkdownEditor` (exact semantics):

```ts
  /** §4 of the chip-chrome spec: the one behavior surface under chips, menu
   * items, and (later, gated) agents. Doc-state verbs are transactions; view
   * verbs go through the live NodeView registry. */
  readonly diagram = {
    kind: (): 'svg' | 'generated' | 'math' | null => {
      const found = this.#selectedDiagram()
      if (found === null) return null
      const language = (found.node.attrs['language'] as string | undefined) ?? ''
      if (language === 'svg') return 'svg'
      if (found.node.type.name === 'math_block' || language === 'math') return 'math'
      return 'generated'
    },
    setWidth: (px: number | null): boolean => this.#layoutKey('width', px === null ? null : String(Math.round(px))),
    setFloat: (side: 'left' | 'right' | null): boolean => {
      if (this.diagram.kind() === 'math') return false
      return this.#layoutKey('float', side)
    },
    delete: (): boolean => {
      const found = this.#selectedDiagram()
      if (found === null) return false
      const view = this.#view()
      view.dispatch(view.state.tr.delete(found.pos, found.pos + found.node.nodeSize))
      view.focus()
      return true
    },
    editSource: (): boolean => {
      const nodeView = this.#selectedDiagramView()
      if (nodeView === undefined) return false
      nodeView.openSource()
      return true
    },
    zoomIn: (): boolean => this.#selectedDiagramView()?.zoomBy('in') ?? false,
    zoomOut: (): boolean => this.#selectedDiagramView()?.zoomBy('out') ?? false,
    zoomReset: (): boolean => this.#selectedDiagramView()?.zoomBy('reset') ?? false,
  }
```

- Private helpers (adapt to the class's existing way of reaching the EditorView — it already has one for `contextSelection`/`convertBlockToDiagram`; reuse that accessor, do not invent a new one):

```ts
  #selectedDiagram(): { pos: number; node: ProseNode } | null {
    const view = this.#view()
    const { selection } = view.state
    if (!(selection instanceof NodeSelection)) return null
    const node = selection.node
    if (node.type.name !== 'code_block' && node.type.name !== 'math_block') return null
    if (node.type.name === 'code_block') {
      const language = (node.attrs['language'] as string | undefined) ?? ''
      if (!this.renderLanguages.has(language)) return null
    }
    return { pos: selection.from, node }
  }

  #selectedDiagramView(): DiagramNodeView | undefined {
    const found = this.#selectedDiagram()
    if (found === null) return undefined
    for (const nodeView of this.#diagramViews) {
      if (nodeView.blockPos() === found.pos) return nodeView
    }
    return undefined
  }

  #layoutKey(key: string, value: string | null): boolean {
    const found = this.#selectedDiagram()
    if (found === null || found.node.type.name !== 'code_block') return false
    const view = this.#view()
    const meta = withFenceMetaKey((found.node.attrs['meta'] as string | undefined) ?? '', key, value)
    view.dispatch(view.state.tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, meta }))
    return true
  }
```

`renderLanguages` = the set of languages the renderer claims (the same list the codeBlockView closure consults via `options.renderer.languages`) — store it on the class at mount. Import `NodeSelection` and `withFenceMetaKey` where missing.

3c. In `src/application/commands.ts`: add the eight ids to `DocumentCommandId` and entries to `COMMANDS` with `target: 'editor'`, labels (`Edit source`, `Float left`, `Float right`, `Inline`, `Delete diagram`, `Zoom in`, `Zoom out`, `Reset zoom`), grouped under a `Format → Diagram` submenu following the file's existing menu-structure conventions (mirror how an existing submenu is declared).

3d. In `src/app/bootstrap.ts`:
- `commandState` for the eight ids: enabled iff `editor?.diagram.kind()` is non-null, refined: float ids also require `kind() !== 'math'`; zoom ids require `kind() === 'generated'`.
- `runCommand` routing: map each id to the corresponding `editor.diagram.*` call (a simple switch beside the existing editor cases).
- The app object returned by `createApp` gains `diagram` delegating to the editor, safe pre-mount:

```ts
    diagram: {
      kind: () => editor?.diagram.kind() ?? null,
      setWidth: (px: number | null) => editor?.diagram.setWidth(px) ?? false,
      setFloat: (side: 'left' | 'right' | null) => editor?.diagram.setFloat(side) ?? false,
      delete: () => editor?.diagram.delete() ?? false,
      editSource: () => editor?.diagram.editSource() ?? false,
      zoomIn: () => editor?.diagram.zoomIn() ?? false,
      zoomOut: () => editor?.diagram.zoomOut() ?? false,
      zoomReset: () => editor?.diagram.zoomReset() ?? false,
    },
```

Also add `diagram` to the app's TypeScript surface type (wherever the window.simplemark type is declared — grep `simplemark` in `src/app/` type declarations and extend it).

- [ ] **Step 4: Run to verify they pass**

Run: `SIMPLEMark_TEST_PORT=5397 npx playwright test tests/ui/editor-harness.spec.ts -g "diagram verbs|zoom verbs" --reporter=list` (fix the env-var casing — `SIMPLEMARK_TEST_PORT=5397`)
Expected: PASS.

- [ ] **Step 5: Whole harness file + typecheck + vitest**

Run: `SIMPLEMARK_TEST_PORT=5397 npx playwright test tests/ui/editor-harness.spec.ts --reporter=list && npx tsc --noEmit && npx vitest run`
Expected: all green (47 harness tests; vitest 81/732 — commands.ts is data, existing command tests may count the registry: if a vitest test pins the command-id list, update it as part of this task).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(diagram): every block action is a command — setWidth, setFloat, delete, editSource, zoom"
```

---

### Task 2: The chip toolbar replaces the hover chrome

**Files:**
- Modify: `src/adapters/editor/diagram-node-view.ts`
- Modify: `src/app/styles/app.css`
- Modify: `tests/ui/editor-harness.spec.ts`, `tests/ui/diagram-frame.spec.ts`, `tests/ui/project-tanoa-showcase.spec.ts` (migrate hover-chrome interactions)

**Interfaces:**
- Consumes: `DiagramController` semantics via the NodeView's own machinery — chips call the SAME verbs: layout chips via `#commitLayout`, delete via the existing delete path, source via `#setShowingSource(true)`, zoom via `#setZoom`. (The controller and chips share these underlying methods; no duplicate logic.)
- Produces: `.diagram-chips` toolbar shown while `is-selected`; the hover `.edit-source` button and `.diagram-zoom` cluster REMOVED (elements, listeners, and their CSS).

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/editor-harness.spec.ts`:

```ts
// §2 of the chip-chrome spec: selection is the mode switch. No chrome while
// reading; every action full-size once the block is selected.
test('chips appear on selection with the right set per language', async ({ page }) => {
  await pasteAtEnd(page, BARE_MERMAID)
  await expect(page.locator('.diagram')).toHaveCount(2)
  const figure = page.locator('.diagram').last()

  await expect(figure.locator('.diagram-chips')).toHaveCount(0)

  await figure.locator('.diagram-render').click()
  const chips = figure.locator('.diagram-chips')
  await expect(chips).toBeVisible()
  await expect(chips.getByRole('button', { name: 'Edit source' })).toBeVisible()
  await expect(chips.getByRole('button', { name: 'Zoom in' })).toBeVisible()
  await expect(chips.getByRole('button', { name: 'Float left' })).toBeVisible()
  await expect(chips.getByRole('button', { name: 'Delete diagram' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(figure.locator('.diagram-chips')).toHaveCount(0)
})

test('svg chips omit zoom; Delete chip removes the block and undo restores it', async ({ page }) => {
  await pasteAtEnd(page, SMALL_SVG)
  await expect(page.locator('.diagram')).toHaveCount(2)
  const figure = page.locator('.diagram').last()
  await figure.locator('.diagram-render').click()

  const chips = figure.locator('.diagram-chips')
  await expect(chips.getByRole('button', { name: 'Zoom in' })).toHaveCount(0)
  await chips.getByRole('button', { name: 'Delete diagram' }).click()
  await expect(page.locator('.diagram')).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.diagram')).toHaveCount(2)
})
```

- [ ] **Step 2: Run to verify they fail** (`-g "chips appear|svg chips"`) — `.diagram-chips` does not exist.

- [ ] **Step 3: Implement**

In `diagram-node-view.ts`:
- Build the chip toolbar in a private method; append/remove it in `selectNode()` / `deselectNode()` (and remove in `destroy()`); structure:

```ts
  #buildChips(): HTMLElement {
    const chips = document.createElement('div')
    chips.className = 'diagram-chips'
    const language = this.language()
    const generated = DiagramNodeView.#ZOOMABLE.has(language)
    const math = !generated && language !== 'svg'

    const chip = (label: string, icon: string, run: () => void, extra?: string): HTMLButtonElement => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `diagram-chip${extra === undefined ? '' : ` ${extra}`}`
      button.setAttribute('aria-label', label)
      button.innerHTML = icon
      button.addEventListener('click', (event) => {
        event.preventDefault()
        run()
      })
      return button
    }
    // ...Edit source chip (icon + visible label span), zoom pill (generated
    // only, reusing #setZoom and a shared % readout element), float segment
    // (not math; three buttons, active one carries `is-active`, disabled past
    // the 60% float-proof gate via #columnWidth), Delete chip.
    return chips
  }
```

The elided chip bodies are the implementer's to write following §2's table exactly: labels `Edit source`, `Zoom out`, `Zoom in` (readout button labeled `Reset zoom`), `Float left`, `Inline`, `Float right`, `Delete diagram`. Icons are inline SVG paths already used nowhere — use text glyphs instead: `−`, `+`, the readout `NN%`, and text labels for Edit source/Delete; float segment uses the glyphs `⇤`, `▭`, `⇥`. No icon font exists in this app — keep to text/glyphs, matching the app's existing button style.
- Float/zoom/delete/source chips call the SAME private methods the controller reaches (`#commitLayout('float', …)`, `#setZoom(…)`, the delete transaction, `#setShowingSource(true)`), so chips and commands cannot drift.
- The zoom readout element: reuse `#zoomLevel` (move it into the chips; `#setZoom` keeps updating it).
- REMOVE: the `#toggle` hover button construction/appends and the `#buildZoomControls`/`#zoomControls` cluster; `stopEvent` drops their clauses and gains `(this.#chips !== undefined && event.target instanceof Node && this.#chips.contains(event.target))`; the click-to-select handler excludes `.diagram-chips` instead of the zoom cluster. The source sheet keeps its own close button (it already has one; the sheet toggle no longer lives on the figure).
- `update()` refreshes chip state (active float segment, readout) when it already refreshes the render.

In `app.css`:
- Remove the `.edit-source` and `.diagram-zoom*` rule blocks; add:

```css
/* §2 chip-chrome: selection is the mode switch — no chrome while reading. */
.diagram-chips {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  animation: diagram-chips-in 0.12s ease-out;
}

@keyframes diagram-chips-in {
  from { opacity: 0; transform: translateY(-3px); }
  to { opacity: 1; transform: none; }
}

.diagram-chip {
  height: 30px;
  padding: 0 10px;
  font-size: 13px;
  border: 0.5px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink);
}

.diagram-chip:hover {
  background: var(--accent);
  color: #fff;
}

.diagram-chip.is-active {
  background: var(--accent-soft);
}

.diagram-chip.diagram-chip-danger:hover {
  background: var(--accent);
}
```

(Adapt variable names to the file's actual tokens — `--paper`, `--ink`, `--line`, `--accent`, `--accent-soft` all exist; verify before use and match neighbors. The danger hover may use an existing danger token if one exists; otherwise keep accent.)

**Test migration sweep (same task):** update every test that clicked the hover chrome: in `editor-harness.spec.ts` the Mermaid source-toggle tests and #138 zoom tests now click the figure first and use the chips (`Edit source` via chips; zoom via chips); `diagram-frame.spec.ts` sheet tests likewise; `project-tanoa-showcase.spec.ts` — inspect what it asserts about `.edit-source` and update to the chip equivalent. Semantics of the tests stay identical: same behaviors, new affordance.

- [ ] **Step 4: Run the migrated files**

`SIMPLEMARK_TEST_PORT=5397 npx playwright test tests/ui/editor-harness.spec.ts tests/ui/diagram-frame.spec.ts tests/ui/project-tanoa-showcase.spec.ts --reporter=list`
Expected: PASS.

- [ ] **Step 5: typecheck + vitest once** — green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(diagram): the selected block grows a chip toolbar, and the hover chrome retires"
```

---

### Task 3: Float and resize everywhere

**Files:**
- Modify: `src/adapters/editor/diagram-node-view.ts`
- Modify: `tests/ui/editor-harness.spec.ts`

**Interfaces:**
- Consumes: chips (Task 2), `#commitLayout`, `#columnWidth`, `parseFenceLayout`.
- Produces: grip on all non-math diagram blocks; `width=` honored by generated languages (`base = metaWidth ?? min(available, FILL_CAP)`, zoom multiplies base); float segment live on generated blocks; the right-click menu's float items un-gate from svg to all non-math.

- [ ] **Step 1: Failing tests**

```ts
// §3 of the chip-chrome spec: layout is universal — width= and float= mean
// the same thing on a generated diagram as on a pasted chart.
test('a mermaid diagram resizes by grip and the width persists', async ({ page }) => {
  await pasteAtEnd(page, BARE_MERMAID)
  const figure = page.locator('.diagram').last()
  await figure.locator('.diagram-render').click()

  const grip = figure.locator('.diagram-resize-grip')
  await expect(grip).toBeVisible()
  const box = (await grip.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2, { steps: 6 })
  await page.mouse.up()

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toMatch(/```mermaid[^\n]*width=\d+/)

  const svg = figure.locator('.diagram-render svg')
  const width = (await svg.boundingBox())!.width
  expect(width).toBeLessThan(560)
})

test('zoom multiplies a resized mermaid from its meta base', async ({ page }) => {
  await pasteAtEnd(page, BARE_MERMAID)
  const figure = page.locator('.diagram').last()
  await figure.locator('.diagram-render').click()
  await page.evaluate(() => window.simplemark!.diagram.setWidth(400))
  await expect.poll(async () => (await figure.locator('.diagram-render svg').boundingBox())!.width)
    .toBeLessThan(430)
  await page.evaluate(() => window.simplemark!.diagram.zoomIn())
  await expect.poll(async () => (await figure.locator('.diagram-render svg').boundingBox())!.width)
    .toBeGreaterThan(470)
})

test('float works on a generated diagram via chips', async ({ page }) => {
  await pasteAtEnd(page, 'flowchart TB\n  A --> B')
  const figure = page.locator('.diagram').last()
  await figure.locator('.diagram-render').click()
  await figure.locator('.diagram-chips').getByRole('button', { name: 'Float left' }).click()
  await expect(figure).toHaveClass(/diagram--float-left/)
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toMatch(/```mermaid[^\n]*float=left/)
})
```

- [ ] **Step 2: Run to verify they fail** (`-g "resizes by grip|meta base|generated diagram via chips"`).

- [ ] **Step 3: Implement**

In `diagram-node-view.ts`:
- Grip construction: change the gate from `language === 'svg'` to `language !== '' && !math` (i.e. any renderer-claimed code_block; the math NodeView keeps no grip — math_block has no `language` attr, so gate on the node type the constructor already distinguishes, matching how zoom gates today).
- `#fitDiagram` generated branch: fold meta width into the base —

```ts
    const layout = parseFenceLayout((this.#node.attrs['meta'] as string | undefined) ?? '')
    const base = layout.width !== undefined
      ? Math.max(layout.width, DiagramNodeView.#MIN_WIDTH)
      : Math.min(available, DiagramNodeView.#FILL_CAP)
    if (this.#zoom !== 1 && DiagramNodeView.#ZOOMABLE.has(language)) {
      const scaled = base * this.#zoom
      this.#render.classList.toggle('is-wide', scaled > available)
      svg.style.width = `${scaled}px`
      return
    }
    if (layout.width !== undefined) {
      const chosen = layout.float !== undefined ? base : Math.min(base, available)
      this.#render.classList.toggle('is-wide', false)
      svg.style.width = `${chosen}px`
      return
    }
```

then the existing wide/fill tail runs unchanged for the no-meta case. Keep the svg branch exactly as shipped.
- Float: the chip segment (Task 2) and the context menu items both un-gate from `language === 'svg'` to all non-math diagram blocks; `#applyFloat` already reads meta language-blind.

- [ ] **Step 4: Run the three new tests, then the whole harness file.**
- [ ] **Step 5: typecheck + vitest once.** Green.
- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(diagram): width and float are universal — every chart drags, every chart floats"
```

---

### Task 4: Narrow collapse, menubar submenu, polish

**Files:**
- Modify: `src/adapters/editor/diagram-node-view.ts`, `src/app/styles/app.css`
- Modify: `src/app/bootstrap.ts` / `src/application/commands.ts` only if Task 1 left submenu wiring incomplete
- Test: `tests/ui/editor-harness.spec.ts`

**Interfaces:** consumes everything prior; produces the `is-narrow` chip mode and the Format → Diagram menu assertions.

- [ ] **Step 1: Failing test**

```ts
test('narrow figures collapse chip labels to icons and stay operable', async ({ page }) => {
  await pasteAtEnd(page, SMALL_SVG)
  const figure = page.locator('.diagram').last()
  await page.evaluate(() => window.simplemark!.diagram.kind())
  await figure.locator('.diagram-render').click()
  await page.evaluate(() => window.simplemark!.diagram.setWidth(180))
  await expect(figure.locator('.diagram-chips.is-narrow')).toHaveCount(1)
  await figure.locator('.diagram-chips').getByRole('button', { name: 'Delete diagram' }).click()
  await expect(page.locator('.diagram')).toHaveCount(1)
})
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** — a ResizeObserver already watches `#render`; toggle `is-narrow` on the chips when the figure box is under 420px; CSS hides `.diagram-chip .chip-label` spans under `is-narrow` (labels must be spans from Task 2; aria-labels carry the names either way). Verify the Format → Diagram submenu ids resolve in `commandState` (a Playwright assertion via `window.simplemark` if the app exposes command state; otherwise leave menu coverage to the existing command-routing tests and note it in the report).
- [ ] **Step 4: Run the new test + the whole harness file.**
- [ ] **Step 5: Full gate readiness: `npx vitest run` + full Playwright once.**
- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(diagram): chips collapse to icons on narrow charts, and the menubar learns Diagram"
```

---

## Verification

```bash
bash scripts/simplemark_ci.sh > /tmp/chrome-gate.log 2>&1; echo "GATE EXIT: $?"; tail -8 /tmp/chrome-gate.log
```

Then by hand in the built app: click a mermaid chart → chips appear full-size; zoom, float left, drag the grip; Escape → clean page; `window.simplemark.diagram.setFloat('right')` from the console flips it.
