# Chart Size, Resize, Float, and Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pasted `svg` charts render at their author's size with drag-resize and float controls persisted in the fence meta; generated diagrams keep filling the column and gain transient zoom controls.

**Architecture:** All sizing decisions stay in `DiagramNodeView#fitDiagram`, which already owns the fill/too-wide ruling. Persistence rides a `meta` attr added to the `code_block` schema via `codeBlockSchema.extendSchema` — the remark `code` node already carries `meta`; Milkdown just drops it today. The meta grammar (`width=N float=left|right`, unknown tokens preserved) is a pure domain module in `src/domain/source/`. Zoom is deliberately NOT persisted: it is transient reader state like folding.

**Tech Stack:** TypeScript, Milkdown/ProseMirror, vitest (domain), Playwright (real-browser editor tests).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-08-chart-size-resize-float-zoom-design.md`. Sizing ruling (§2): `svg` blocks render at `min(natural, column)`, never stretched up; `svg` with no discoverable size fills (unchanged); `mermaid`/`dot`/`vega-lite` keep fill-the-column + `is-wide`, plus zoom.
- D7: an untouched block round-trips byte-identically. Only user gestures (drag, menu) write layout keys; unknown meta tokens are preserved verbatim and in order.
- Domain is pure: no DOM, no I/O, no imports from `adapters` (ADR-0001).
- Baseline at branch point `0f3dd8f`: vitest 69 files / 646 tests green. Every task ends with the suites it touched green.
- Known full-suite flakes under load (platform-smoke-collection in vitest; reload-heavy UI specs in Playwright): rerun the failing file in isolation before treating a failure as real; never pipe the gate to `tail`.
- `math` blocks share `DiagramNodeView` but get NONE of this: no natural-size branch, no zoom, no resize, no float.

---

### Task 1: Natural size for `svg` blocks

**Files:**
- Modify: `src/adapters/editor/diagram-node-view.ts` (`#fitDiagram`, ~line 396)
- Modify: `src/app/styles/app.css` (comment on the `.diagram-render svg` rule, ~line 2775)
- Test: `tests/ui/editor-harness.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `#fitDiagram` gains a per-language width decision that Tasks 2 and 5 extend. After this task it reads: compute `available` and `natural`; if the block's language is `svg` and `natural` is known and the block is not too wide, set `svg.style.width = min(natural, available)px`; the too-wide branch and the fill fallback are unchanged.

- [ ] **Step 1: Write the failing test**

Append to `tests/ui/editor-harness.spec.ts` (helpers `pasteAtEnd`, `caretAtEnd` and the `editor` selector already exist in the file):

```ts
// §2 of the chart-size spec: a pasted SVG has an author-chosen size, so the
// frame must not inflate it to the column the way it sizes a Mermaid render.
const SMALL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" viewBox="0 0 200 80"><rect width="120" height="40"/></svg>'

test('a pasted SVG renders at its natural width, not the column width', async ({ page }) => {
  await pasteAtEnd(page, SMALL_SVG)
  await expect(page.locator('.diagram')).toHaveCount(2)

  const svg = page.locator('.diagram').last().locator('.diagram-render svg')
  await expect(svg).toBeVisible()
  const box = await svg.boundingBox()
  expect(box!.width).toBeGreaterThan(150)
  expect(box!.width).toBeLessThan(260)
})

test('a pasted SVG with no discoverable size still fills the column', async ({ page }) => {
  await pasteAtEnd(page, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="40" height="20"/></svg>')
  await expect(page.locator('.diagram')).toHaveCount(2)

  const svg = page.locator('.diagram').last().locator('.diagram-render svg')
  await expect(svg).toBeVisible()
  const box = await svg.boundingBox()
  expect(box!.width).toBeGreaterThan(400)
})
```

- [ ] **Step 2: Run tests to verify the first fails**

Run: `npx playwright test tests/ui/editor-harness.spec.ts -g "natural width|no discoverable size" --reporter=list`
Expected: "natural width" FAILS (the svg is stretched to the column, width far above 260); "no discoverable size" PASSES (it is today's behavior — it exists as the pinned regression guard).

- [ ] **Step 3: Implement the width decision in `#fitDiagram`**

In `src/adapters/editor/diagram-node-view.ts`, replace the tail of `#fitDiagram` (everything from `const wide = …` through the end of the method) with:

```ts
    const wide = natural > available * DiagramNodeView.#WIDEST_SQUEEZE
    this.#render.classList.toggle('is-wide', wide)

    if (wide) {
      // Legibility beats fitting: the drawing keeps its own size and the
      // figure scrolls. Unchanged for every language.
      svg.style.width = `${natural}px`
      return
    }

    const language = (this.#node.attrs['language'] as string | undefined) ?? ''
    if (language === 'svg') {
      // §2: a pasted SVG has an author-chosen size. Cap at the column, but
      // never inflate — inflating is for renders whose size the engine
      // invented, not for a drawing that arrived with one.
      svg.style.width = `${Math.min(natural, available)}px`
      return
    }

    // Generated diagrams (mermaid, dot, vega-lite) fill the measure; the
    // stylesheet's `width: 100%` does that once no explicit width remains.
    svg.style.removeProperty('width')
```

Then update the stylesheet comment above `.diagram-render svg` (~line 2775) — append one sentence to the existing comment block:

```
 * `svg` blocks are the exception: DiagramNodeView writes an explicit width
 * (the author's own size, capped at the column), which beats the 100% here.
```

- [ ] **Step 4: Run the tests again**

Run: `npx playwright test tests/ui/editor-harness.spec.ts -g "natural width|no discoverable size" --reporter=list`
Expected: both PASS.

- [ ] **Step 5: Run the whole harness file**

Run: `npx playwright test tests/ui/editor-harness.spec.ts --reporter=list`
Expected: PASS — in particular the existing Mermaid sizing tests, which must be unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/editor/diagram-node-view.ts src/app/styles/app.css tests/ui/editor-harness.spec.ts
git commit -m "fix(diagram): a pasted SVG keeps its author's size instead of filling the column"
```

---

### Task 2: Zoom controls on generated diagrams

**Files:**
- Modify: `src/adapters/editor/diagram-node-view.ts`
- Modify: `src/app/styles/app.css` (beside `.edit-source`, ~line 2742)
- Test: `tests/ui/editor-harness.spec.ts`

**Interfaces:**
- Consumes: Task 1's `#fitDiagram` shape.
- Produces: `#zoom: number` field (transient, default 1) consulted by `#fitDiagram`; `.diagram-zoom` controls markup.

- [ ] **Step 1: Write the failing test**

Append to `tests/ui/editor-harness.spec.ts` (`BARE_MERMAID` already exists in the file):

```ts
// §6 of the chart-size spec: zoom is transient reader state on generated
// diagrams. Pasted SVGs get resize instead — no zoom controls there.
test('zoom controls scale a Mermaid diagram and reset to 100%', async ({ page }) => {
  await pasteAtEnd(page, BARE_MERMAID)
  await expect(page.locator('.diagram')).toHaveCount(2)

  const figure = page.locator('.diagram').last()
  const svg = figure.locator('.diagram-render svg')
  await expect(svg).toBeVisible()
  const before = (await svg.boundingBox())!.width

  await figure.locator('.diagram-zoom').getByRole('button', { name: 'Zoom in' }).click()
  await expect(figure.locator('.diagram-zoom-level')).toHaveText('125%')
  const zoomed = (await svg.boundingBox())!.width
  expect(zoomed).toBeGreaterThan(before * 1.1)

  await figure.locator('.diagram-zoom-level').click()
  await expect(figure.locator('.diagram-zoom-level')).toHaveText('100%')
})

test('zooming past the column engages the scroll rail', async ({ page }) => {
  await pasteAtEnd(page, BARE_MERMAID)
  const figure = page.locator('.diagram').last()
  const zoomIn = figure.locator('.diagram-zoom').getByRole('button', { name: 'Zoom in' })
  for (let i = 0; i < 6; i += 1) await zoomIn.click()
  await expect(figure.locator('.diagram-render.is-wide')).toHaveCount(1)
})

test('a pasted SVG block has no zoom controls', async ({ page }) => {
  await pasteAtEnd(page, SMALL_SVG)
  await expect(page.locator('.diagram').last().locator('.diagram-zoom')).toHaveCount(0)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx playwright test tests/ui/editor-harness.spec.ts -g "zoom" --reporter=list`
Expected: first two FAIL (`.diagram-zoom` does not exist); third PASSES trivially — it pins the svg exclusion.

- [ ] **Step 3: Implement zoom in the NodeView**

In `src/adapters/editor/diagram-node-view.ts`:

Add beside the other static members:

```ts
  /** §6: zoom lives on generated renders only. Pasted SVGs resize instead. */
  static readonly #ZOOMABLE = new Set(['mermaid', 'dot', 'vega-lite'])
  static readonly #ZOOM_STEP = 1.25
  static readonly #ZOOM_MIN = 0.5
  static readonly #ZOOM_MAX = 4
```

Add fields:

```ts
  /** Transient reader state, like folding — never written to the document. */
  #zoom = 1
  #zoomLevel: HTMLButtonElement | undefined
```

In the constructor, after `this.dom.append(label, this.#toggle, this.#render, this.#error)`, add:

```ts
    const language = (node.attrs['language'] as string | undefined) ?? ''
    if (DiagramNodeView.#ZOOMABLE.has(language)) {
      this.dom.append(this.#buildZoomControls())
    }
```

Add the methods:

```ts
  #buildZoomControls(): HTMLElement {
    const zoom = document.createElement('div')
    zoom.className = 'diagram-zoom'

    const button = (label: string, text: string, run: () => void): HTMLButtonElement => {
      const el = document.createElement('button')
      el.type = 'button'
      el.setAttribute('aria-label', label)
      el.textContent = text
      el.addEventListener('click', (event) => {
        event.preventDefault()
        run()
      })
      return el
    }

    this.#zoomLevel = button('Reset zoom', '100%', () => this.#setZoom(1))
    this.#zoomLevel.className = 'diagram-zoom-level'
    zoom.append(
      button('Zoom out', '−', () => this.#setZoom(this.#zoom / DiagramNodeView.#ZOOM_STEP)),
      this.#zoomLevel,
      button('Zoom in', '+', () => this.#setZoom(this.#zoom * DiagramNodeView.#ZOOM_STEP)),
    )
    return zoom
  }

  #setZoom(next: number): void {
    this.#zoom = Math.min(
      DiagramNodeView.#ZOOM_MAX,
      Math.max(DiagramNodeView.#ZOOM_MIN, next),
    )
    if (this.#zoomLevel !== undefined) {
      this.#zoomLevel.textContent = `${Math.round(this.#zoom * 100)}%`
    }
    this.#fitDiagram()
  }
```

In `#fitDiagram`, extend the generated-diagram tail (the final branch from Task 1) so zoom scales the filled width:

```ts
    // Generated diagrams (mermaid, dot, vega-lite) fill the measure; the
    // stylesheet's `width: 100%` does that once no explicit width remains.
    // Zoom multiplies that base and hands overflow to the scroll rail.
    if (this.#zoom !== 1 && DiagramNodeView.#ZOOMABLE.has(language)) {
      const scaled = Math.min(natural, available) * this.#zoom
      this.#render.classList.toggle('is-wide', scaled > available)
      svg.style.width = `${scaled}px`
      return
    }
    svg.style.removeProperty('width')
```

Two integration points, both required:

1. The Task 5 (#121) click-to-select handler must not treat zoom clicks as figure clicks — extend its guard clauses with `if ((event.target as HTMLElement).closest('.diagram-zoom') !== null) return`.
2. `stopEvent` must claim zoom-control events so ProseMirror ignores them: extend the return to `event.target === this.#toggle || this.#sheet.contains(event.target as Node) || (event.target instanceof Node && this.dom.querySelector('.diagram-zoom')?.contains(event.target) === true)`.

In `src/app/styles/app.css`, after the `.edit-source` rule (~line 2742):

```css
/*
 * Zoom sits with Edit source in the figure's hover chrome: invisible until
 * the reader is over the block, so a document of diagrams doesn't read as a
 * toolbar. Transient state — nothing here writes to the note.
 */
.diagram-zoom {
  position: absolute;
  top: 8px;
  right: 86px;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
}

.diagram:hover .diagram-zoom,
.diagram:focus-within .diagram-zoom {
  opacity: 1;
}

.diagram-zoom button {
  border: 0;
  background: transparent;
  color: var(--ink-3);
  font-size: 10px;
  padding: 4px 5px;
  border-radius: 5px;
}

.diagram-zoom button:hover {
  color: var(--ink);
}
```

- [ ] **Step 4: Run the zoom tests**

Run: `npx playwright test tests/ui/editor-harness.spec.ts -g "zoom" --reporter=list`
Expected: PASS, all three.

- [ ] **Step 5: Run the whole harness file**

Run: `npx playwright test tests/ui/editor-harness.spec.ts --reporter=list`
Expected: PASS — the Edit source toggle and diagram click-select tests are the guards that the new chrome broke nothing.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/editor/diagram-node-view.ts src/app/styles/app.css tests/ui/editor-harness.spec.ts
git commit -m "feat(diagram): zoom controls on generated diagrams"
```

---

### Task 3: The fence-meta grammar (domain)

**Files:**
- Create: `src/domain/source/fence-meta.ts`
- Modify: `src/domain/index.ts` (export beside the other `./source/` exports, lines 9-10)
- Test: `tests/domain/fence-meta.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces (exact signatures Tasks 5 and 6 call):
  - `parseFenceLayout(meta: string): { width: number | undefined; float: 'left' | 'right' | undefined }`
  - `withFenceMetaKey(meta: string, key: string, value: string | null): string`

- [ ] **Step 1: Write the failing test**

Create `tests/domain/fence-meta.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { parseFenceLayout, withFenceMetaKey } from '../../src/domain/index.js'

/**
 * The fence info tail is the user's bytes (D7). Layout edits rewrite only
 * their own key; everything else survives verbatim and in order.
 */
describe('parseFenceLayout', () => {
  it('reads width and float', () => {
    expect(parseFenceLayout('width=320 float=left')).toEqual({ width: 320, float: 'left' })
  })
  it('ignores unknown tokens and junk values', () => {
    expect(parseFenceLayout('twoslash width=abc float=up title=x')).toEqual({
      width: undefined,
      float: undefined,
    })
  })
  it('is empty for an empty meta', () => {
    expect(parseFenceLayout('')).toEqual({ width: undefined, float: undefined })
  })
})

describe('withFenceMetaKey', () => {
  it('appends a new key', () => {
    expect(withFenceMetaKey('', 'width', '320')).toBe('width=320')
  })
  it('replaces an existing key in place', () => {
    expect(withFenceMetaKey('twoslash width=200 title=x', 'width', '320')).toBe(
      'twoslash width=320 title=x',
    )
  })
  it('removes a key with null', () => {
    expect(withFenceMetaKey('width=200 float=left', 'width', null)).toBe('float=left')
  })
  it('removing an absent key is identity', () => {
    expect(withFenceMetaKey('twoslash', 'width', null)).toBe('twoslash')
  })
  it('preserves unknown tokens verbatim and in order', () => {
    expect(withFenceMetaKey('a=1 b c=3', 'float', 'right')).toBe('a=1 b c=3 float=right')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/domain/fence-meta.test.ts`
Expected: FAIL — `parseFenceLayout` is not exported.

- [ ] **Step 3: Implement**

Create `src/domain/source/fence-meta.ts`:

```ts
/**
 * The fence info tail — everything after the language in ```` ```svg width=320 ````.
 *
 * D7 makes these the user's bytes: an untouched block round-trips
 * byte-identically, so layout edits may rewrite only their own `key=value`
 * token and must carry every other token through verbatim, in order.
 * Separators normalise to a single space; token content is never altered.
 */

export interface FenceLayout {
  readonly width: number | undefined
  readonly float: 'left' | 'right' | undefined
}

function tokens(meta: string): string[] {
  return meta.trim() === '' ? [] : meta.trim().split(/\s+/)
}

export function parseFenceLayout(meta: string): FenceLayout {
  let width: number | undefined
  let float: 'left' | 'right' | undefined
  for (const token of tokens(meta)) {
    const widthMatch = /^width=(\d+)$/.exec(token)
    if (widthMatch !== null) {
      const value = Number(widthMatch[1])
      if (Number.isInteger(value) && value > 0) width = value
      continue
    }
    const floatMatch = /^float=(left|right)$/.exec(token)
    if (floatMatch !== null) float = floatMatch[1] as 'left' | 'right'
  }
  return { width, float }
}

export function withFenceMetaKey(meta: string, key: string, value: string | null): string {
  const prefix = `${key}=`
  const kept = tokens(meta).filter((token) => !token.startsWith(prefix))
  const replaced = tokens(meta).map((token) =>
    token.startsWith(prefix) && value !== null ? `${prefix}${value}` : token,
  )
  if (value === null) return kept.join(' ')
  if (tokens(meta).some((token) => token.startsWith(prefix))) {
    // Drop duplicate occurrences beyond the first, which now carries the value.
    let seen = false
    return replaced
      .filter((token) => {
        if (!token.startsWith(prefix)) return true
        if (seen) return false
        seen = true
        return true
      })
      .join(' ')
  }
  return [...kept, `${prefix}${value}`].join(' ')
}
```

Add to `src/domain/index.ts` beside the other `./source/` exports:

```ts
export { parseFenceLayout, withFenceMetaKey } from './source/fence-meta.js'
export type { FenceLayout } from './source/fence-meta.js'
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/domain/fence-meta.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Full vitest**

Run: `npx vitest run`
Expected: PASS (70 files / 654 tests).

- [ ] **Step 6: Commit**

```bash
git add src/domain/source/fence-meta.ts src/domain/index.ts tests/domain/fence-meta.test.ts
git commit -m "feat(source): fence-meta grammar — layout keys beside the user's own tokens"
```

---

### Task 4: The `code_block` schema round-trips fence meta

**Files:**
- Create: `src/adapters/editor/code-fence-meta.ts`
- Modify: `src/adapters/editor/milkdown-editor.ts` (`.use` beside `codeBlockView`, ~line 297)
- Modify: `docs/DESIGN.md` (one D7 clause; find the round-trip fidelity section and add the sentence in Step 3)
- Test: `tests/ui/editor-harness.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: every `code_block` node carries `attrs.meta: string` (default `""`), parsed from and serialised back to the fence info tail. Tasks 5 and 6 read and write it.

- [ ] **Step 1: Write the failing test**

Append to `tests/ui/editor-harness.spec.ts`:

```ts
// D7: the fence info tail is part of the user's bytes. Milkdown drops it by
// default; the schema extension is what carries it through a serialise.
test('fence meta survives an edit-elsewhere round trip', async ({ page }) => {
  await pasteAtEnd(page, '```svg width=320 twoslash\n<svg viewBox="0 0 4 4"><rect/></svg>\n```')

  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Unrelated edit.')

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('```svg width=320 twoslash')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test tests/ui/editor-harness.spec.ts -g "fence meta survives" --reporter=list`
Expected: FAIL — the snapshot contains ```` ```svg ```` with the tail stripped.

- [ ] **Step 3: Implement the schema extension**

Create `src/adapters/editor/code-fence-meta.ts`:

```ts
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'

/**
 * Carry the fence info tail through the editor.
 *
 * Milkdown's code_block keeps only the language token: ```` ```svg width=320 ````
 * parses to `language: "svg"` and the tail is dropped on the next serialise —
 * a D7 violation for any fence carrying meta, and the reason chart layout
 * (width=, float=) could not persist. The remark `code` node already has a
 * `meta` field on both sides; this extension just stops losing it.
 */
export const codeBlockMetaSchema = codeBlockSchema.extendSchema((prev) => {
  return (ctx) => {
    const base = prev(ctx)
    return {
      ...base,
      attrs: { ...base.attrs, meta: { default: '', validate: 'string' } },
      parseMarkdown: {
        match: ({ type }) => type === 'code',
        runner: (state, node, type) => {
          state.openNode(type, {
            language: (node.lang as string | null) ?? '',
            meta: (node.meta as string | null) ?? '',
          })
          if (node.value) state.addText(node.value as string)
          state.closeNode()
        },
      },
      toMarkdown: {
        match: (node) => node.type.name === 'code_block',
        runner: (state, node) => {
          state.addNode('code', undefined, node.content.firstChild?.text ?? '', {
            lang: node.attrs['language'],
            meta: node.attrs['meta'] === '' ? undefined : node.attrs['meta'],
          })
        },
      },
    }
  }
})
```

In `src/adapters/editor/milkdown-editor.ts`: import `codeBlockMetaSchema` from `'./code-fence-meta.js'`, and register it in the same `.use(...)` chain that registers `codeBlockView` (~line 297) — it must come after the commonmark preset so the extended schema replaces the stock one:

```ts
      .use(codeBlockMetaSchema)
```

If the extension does not take effect (the Step 4 test still fails with the tail stripped), the registration point is before the preset — move the `.use` after the preset line and rerun. Import path note: if `'@milkdown/kit/preset/commonmark'` does not export `codeBlockSchema`, import it exactly the way `milkdown-editor.ts:6` already does and reuse that path.

In `docs/DESIGN.md`, find the D7 round-trip fidelity wording and append one sentence to its paragraph or ruling list:

```markdown
The fence info tail (```` ```svg width=320 ````) is part of those bytes: the
editor's `code_block` schema carries it as a `meta` attribute and serialises
it back verbatim.
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx playwright test tests/ui/editor-harness.spec.ts -g "fence meta survives" --reporter=list`
Expected: PASS.

- [ ] **Step 5: Full harness file + full vitest**

Run: `npx playwright test tests/ui/editor-harness.spec.ts --reporter=list && npx vitest run`
Expected: both green — the diagram render tests confirm the schema swap did not break NodeView wiring.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/editor/code-fence-meta.ts src/adapters/editor/milkdown-editor.ts docs/DESIGN.md tests/ui/editor-harness.spec.ts
git commit -m "fix(editor): code fences keep their info tail through a round trip"
```

---

### Task 5: Drag to resize an `svg` block

**Files:**
- Modify: `src/adapters/editor/diagram-node-view.ts`
- Modify: `src/app/styles/app.css` (beside `.diagram.is-selected`, ~line 2727)
- Test: `tests/ui/editor-harness.spec.ts`

**Interfaces:**
- Consumes: `parseFenceLayout` / `withFenceMetaKey` (Task 3, from `'../../domain/index.js'`); `attrs.meta` (Task 4); `#fitDiagram`'s svg branch (Task 1).
- Produces: `width=` meta drives the render; a `.diagram-resize-grip` appears on selected `svg` figures.

- [ ] **Step 1: Write the failing test**

Append to `tests/ui/editor-harness.spec.ts`:

```ts
// §4 of the chart-size spec: dragging the grip persists width= into the
// fence meta — the document, not the DOM, is where layout lives.
test('dragging the resize grip persists width= and the render honors it', async ({ page }) => {
  await pasteAtEnd(page, SMALL_SVG)
  const figure = page.locator('.diagram').last()
  await figure.locator('.diagram-render').click()
  await expect(page.locator('.diagram.is-selected')).toHaveCount(1)

  const grip = figure.locator('.diagram-resize-grip')
  await expect(grip).toBeVisible()
  const gripBox = (await grip.boundingBox())!
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(gripBox.x + gripBox.width / 2 + 120, gripBox.y + gripBox.height / 2, { steps: 6 })
  await page.mouse.up()

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toMatch(/```svg width=3\d\d/)

  const svg = figure.locator('.diagram-render svg')
  const box = (await svg.boundingBox())!
  expect(box.width).toBeGreaterThan(290)
  expect(box.width).toBeLessThan(360)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test tests/ui/editor-harness.spec.ts -g "resize grip" --reporter=list`
Expected: FAIL — `.diagram-resize-grip` does not exist.

- [ ] **Step 3: Implement**

In `src/adapters/editor/diagram-node-view.ts`:

Extend the domain import (the file has none yet — add beside the other imports):

```ts
import { parseFenceLayout, withFenceMetaKey } from '../../domain/index.js'
```

Add a constant beside the other statics, a field, and construction. Constructor, after the zoom-controls block from Task 2:

```ts
    if (language === 'svg') {
      this.#grip = document.createElement('div')
      this.#grip.className = 'diagram-resize-grip'
      this.#grip.setAttribute('aria-label', 'Resize chart')
      this.#grip.addEventListener('pointerdown', this.#beginResize)
      this.dom.append(this.#grip)
    }
```

Field and statics:

```ts
  #grip: HTMLElement | undefined
  static readonly #MIN_WIDTH = 120
```

Methods:

```ts
  /**
   * §4: the drag writes width= into the fence meta on release — one
   * transaction, one undo step. Dragging to the column edge clears the key,
   * which reads as "back to natural".
   */
  readonly #beginResize = (event: PointerEvent): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const svg = this.#render.querySelector('svg')
    if (svg === null) return
    const startWidth = svg.getBoundingClientRect().width
    const startX = event.clientX
    const available = this.#render.clientWidth

    const width = (moveEvent: PointerEvent): number =>
      Math.min(
        available,
        Math.max(DiagramNodeView.#MIN_WIDTH, Math.round(startWidth + (moveEvent.clientX - startX))),
      )

    const move = (moveEvent: PointerEvent): void => {
      svg.style.width = `${width(moveEvent)}px`
    }
    const stop = (stopEvent: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      const final = width(stopEvent)
      this.#commitLayout('width', final >= available - 4 ? null : String(final))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
  }

  /** Rewrites one layout key in the fence meta through the editor. */
  #commitLayout(key: string, value: string | null): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const { state } = this.view
    const node = state.doc.nodeAt(pos)
    if (node === null) return
    const meta = withFenceMetaKey((node.attrs['meta'] as string | undefined) ?? '', key, value)
    this.view.dispatch(
      state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, meta }),
    )
  }
```

In `#fitDiagram`, make the svg branch (Task 1) honor the meta first:

```ts
    if (language === 'svg') {
      const layout = parseFenceLayout((this.#node.attrs['meta'] as string | undefined) ?? '')
      const chosen =
        layout.width !== undefined
          ? Math.min(Math.max(layout.width, DiagramNodeView.#MIN_WIDTH), available)
          : Math.min(natural, available)
      svg.style.width = `${chosen}px`
      return
    }
```

`stopEvent` must claim grip events: extend it with `|| (this.#grip !== undefined && event.target instanceof Node && this.#grip.contains(event.target))`. The click-to-select handler needs no change — the grip only shows when the block is already selected.

In `src/app/styles/app.css`, after `.diagram.is-selected`:

```css
/*
 * The grip appears only on a selected svg figure: selection is the mode in
 * which the block is an object rather than a drawing. Bottom-right, the
 * macOS-native corner.
 */
.diagram-resize-grip {
  display: none;
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 14px;
  height: 14px;
  cursor: ew-resize;
  border-right: 2px solid var(--accent);
  border-bottom: 2px solid var(--accent);
  border-bottom-right-radius: 4px;
}

.diagram.is-selected .diagram-resize-grip {
  display: block;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx playwright test tests/ui/editor-harness.spec.ts -g "resize grip" --reporter=list`
Expected: PASS.

- [ ] **Step 5: Full harness file**

Run: `npx playwright test tests/ui/editor-harness.spec.ts --reporter=list`
Expected: PASS — including Task 1's natural-size tests (no `width=` present → natural path unchanged) and the select/delete tests.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/editor/diagram-node-view.ts src/app/styles/app.css tests/ui/editor-harness.spec.ts
git commit -m "feat(diagram): drag a selected chart to resize it, persisted in the fence meta"
```

---

### Task 6: Float a chart, and let the text wrap

**Files:**
- Modify: `src/adapters/editor/diagram-node-view.ts` (`#openMenu`, ~line 288; `update`)
- Modify: `src/app/styles/app.css`
- Test: `tests/ui/editor-harness.spec.ts`

**Interfaces:**
- Consumes: `#commitLayout` (Task 5), `parseFenceLayout` (Task 3), `attrs.meta` (Task 4), the context menu (#121).
- Produces: `float=left|right` meta drives `diagram--float-left/right` classes.

- [ ] **Step 1: Write the failing test**

Append to `tests/ui/editor-harness.spec.ts`:

```ts
// §5 of the chart-size spec: float is a menu action on svg figures, persisted
// as float= in the meta, and narrow viewports ignore it entirely.
test('Float left wraps prose around a small chart; Inline undoes it', async ({ page }) => {
  await pasteAtEnd(page, SMALL_SVG)
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Prose that should wrap beside the floated chart.')

  const figure = page.locator('.diagram').last()
  await figure.locator('.diagram-render').click({ button: 'right' })
  await page.locator('.diagram-context-menu').getByRole('button', { name: 'Float left' }).click()

  await expect(figure).toHaveClass(/diagram--float-left/)
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('float=left')
  expect(await figure.evaluate((el) => getComputedStyle(el).float)).toBe('left')

  await figure.locator('.diagram-render').click({ button: 'right' })
  await page.locator('.diagram-context-menu').getByRole('button', { name: 'Inline' }).click()
  await expect(figure).not.toHaveClass(/diagram--float-left/)
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .not.toContain('float=')
})

test('a narrow viewport ignores float', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 })
  await pasteAtEnd(page, SMALL_SVG)
  const figure = page.locator('.diagram').last()
  await figure.locator('.diagram-render').click({ button: 'right' })
  await page.locator('.diagram-context-menu').getByRole('button', { name: 'Float left' }).click()
  await expect(figure).toHaveClass(/diagram--float-left/)
  expect(await figure.evaluate((el) => getComputedStyle(el).float)).toBe('none')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test tests/ui/editor-harness.spec.ts -g "Float left|narrow viewport" --reporter=list`
Expected: FAIL — the menu has no Float items.

- [ ] **Step 3: Implement**

In `src/adapters/editor/diagram-node-view.ts`:

In `#openMenu`, after the existing two `item(...)` appends (~line 312), add — reusing the `item` helper already defined in that method:

```ts
    const language = (this.#node.attrs['language'] as string | undefined) ?? ''
    if (language === 'svg') {
      const separator = document.createElement('hr')
      const svg = this.#render.querySelector('svg')
      const effective = svg?.getBoundingClientRect().width ?? 0
      // §5: wrapping a sliver of text beside a wide chart reads as a bug, so
      // float is only offered while the chart leaves the prose real room.
      const roomToWrap = effective > 0 && effective <= this.#render.clientWidth * 0.6
      const floatItem = (text: string, value: string | null): HTMLButtonElement => {
        const button = item(text, () => this.#commitLayout('float', value))
        button.className = 'note-context-row'
        if (value !== null && !roomToWrap) button.disabled = true
        return button
      }
      menu.append(
        separator,
        floatItem('Float left', 'left'),
        floatItem('Float right', 'right'),
        floatItem('Inline', null),
      )
    }
```

(If the `item` helper in `#openMenu` already sets `note-context-row`, drop the redundant assignment — match what is there.)

Add a method and call it from both the constructor (after the grip block) and `update()` (after `this.#node = node`):

```ts
  /** float= drives layout classes; the stylesheet does the rest. */
  #applyFloat(): void {
    const layout = parseFenceLayout((this.#node.attrs['meta'] as string | undefined) ?? '')
    this.dom.classList.toggle('diagram--float-left', layout.float === 'left')
    this.dom.classList.toggle('diagram--float-right', layout.float === 'right')
  }
```

Also amend `#fitDiagram`'s svg branch (Task 5's version): a floated figure's
`#render.clientWidth` is derived from the figure's own fit-content width, so
capping at `available` would feed back and ratchet the chart smaller on every
ResizeObserver tick. When float is active, size from the meta/natural width
directly and let the stylesheet's `max-width: 60%` do the clamping:

```ts
    if (language === 'svg') {
      const layout = parseFenceLayout((this.#node.attrs['meta'] as string | undefined) ?? '')
      const wanted = layout.width !== undefined ? Math.max(layout.width, DiagramNodeView.#MIN_WIDTH) : natural
      // Floated figures self-size (fit-content): capping at the container
      // would chase our own shadow. The stylesheet clamps to 60% instead.
      const chosen = layout.float !== undefined ? wanted : Math.min(wanted, available)
      svg.style.width = `${chosen}px`
      return
    }
```

In `src/app/styles/app.css`, after the `.diagram-resize-grip` rules:

```css
/*
 * A floated chart shares the measure with prose. Width comes from the meta
 * (or natural size) via the inline svg width; the figure shrinks to it.
 * Narrow viewports ignore float — squeezed wrap columns are worse than a
 * stacked chart (§5 of the chart-size spec).
 */
.diagram.diagram--float-left,
.diagram.diagram--float-right {
  width: fit-content;
  max-width: 60%;
}

.diagram.diagram--float-left {
  float: left;
  margin: 4px 18px 10px 0;
}

.diagram.diagram--float-right {
  float: right;
  margin: 4px 0 10px 18px;
}

/* Never let a document-final float overhang the page. */
.milkdown .ProseMirror::after {
  content: '';
  display: block;
  clear: both;
}

@media (max-width: 480px) {
  .diagram.diagram--float-left,
  .diagram.diagram--float-right {
    float: none;
    max-width: 100%;
    margin: 0;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx playwright test tests/ui/editor-harness.spec.ts -g "Float left|narrow viewport" --reporter=list`
Expected: PASS, both.

- [ ] **Step 5: Full suites**

Run: `npx vitest run && npx playwright test --reporter=list`
Expected: both green (isolation-rerun any known flake per Global Constraints before investigating).

- [ ] **Step 6: Commit**

```bash
git add src/adapters/editor/diagram-node-view.ts src/app/styles/app.css tests/ui/editor-harness.spec.ts
git commit -m "feat(diagram): float a chart left or right, and the prose wraps"
```

---

## Verification

Before claiming done, run the canonical gate and paste the real output (never pipe it to `tail` — redirect and echo `$?`):

```bash
bash scripts/simplemark_ci.sh > /tmp/gate.log 2>&1; echo "GATE EXIT: $?"; tail -8 /tmp/gate.log
```

Then the by-hand pass in the built app: paste a real report (chart lands at its
own size), drag it wider, float it left, zoom a Mermaid diagram, and confirm a
reopened note keeps width and float but resets zoom.
