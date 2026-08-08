# Faithful Paste and Diagram Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pasted document keeps all of itself — prose, marks, links, lists, tables and inline charts — and a rendered diagram block can be selected, deleted, and right-clicked.

**Architecture:** Two pure domain predicates decide the paste triage; the existing `handlePaste` in `paste-sniffers.ts` acts on them. Nothing new renders the HTML — ProseMirror's own `DOMParser.fromSchema` does, after inline `<svg>` is rewritten into an `svg` code fence so the chart survives in place. The diagram fix is entirely local to `DiagramNodeView`: taking a `NodeSelection` on click is what makes Backspace work, because ProseMirror deletes a node selection by default.

**Tech Stack:** TypeScript, ProseMirror via Milkdown, vitest (domain + adapters), Playwright (real-browser editor tests).

## Global Constraints

- Domain is pure: no DOM, no I/O, no imports from `adapters` (ADR-0001).
- Adapters never import one another.
- `DESIGN.md` §4.4 rule 2 — **never lose the source** — is the acceptance bar for every paste task.
- BUG-1 must not regress: a `text/plain` paste of Markdown source is parsed as Markdown, never inserted verbatim.
- Existing test suite is green at baseline: 67 files, 627 tests. Every task ends green.
- Base branch: `origin/main` at `e3aa3a4`.

---

### Task 1: The document-structure predicate

**Files:**
- Modify: `src/domain/paste/exhaust.ts` (add beside `looksLikeDocument`)
- Modify: `src/domain/index.ts` (export it)
- Test: `tests/domain/paste-html-structure.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `htmlCarriesDocumentStructure(html: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/domain/paste-html-structure.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { htmlCarriesDocumentStructure } from '../../src/domain/index.js'

/**
 * The triage that decides whether a paste keeps its formatting.
 *
 * True means "use the HTML flavour" — real headings, marks and tables. False
 * means the Markdown path on text/plain, which is what BUG-1 requires for a
 * pasted Markdown source document.
 */
describe('htmlCarriesDocumentStructure', () => {
  it('is true for a heading', () => {
    expect(htmlCarriesDocumentStructure('<h2>A heading</h2>')).toBe(true)
  })
  it('is true for a table', () => {
    expect(htmlCarriesDocumentStructure('<table><tr><td>a</td></tr></table>')).toBe(true)
  })
  it('is true for a list', () => {
    expect(htmlCarriesDocumentStructure('<ul><li>one</li></ul>')).toBe(true)
  })
  it('is true for bold, italic and links', () => {
    expect(htmlCarriesDocumentStructure('<p>a <strong>b</strong></p>')).toBe(true)
    expect(htmlCarriesDocumentStructure('<p>a <em>b</em></p>')).toBe(true)
    expect(htmlCarriesDocumentStructure('<p>a <a href="https://x.test">b</a></p>')).toBe(true)
  })
  it('is true for more than one paragraph', () => {
    expect(htmlCarriesDocumentStructure('<p>one</p><p>two</p>')).toBe(true)
  })

  // The reason the predicate is narrow. A plain-text copy from a browser or an
  // editor arrives with this wrapper, and it must keep taking the Markdown
  // path or BUG-1 comes back.
  it('is false for the wrapper a plain-text copy carries', () => {
    expect(
      htmlCarriesDocumentStructure('<meta charset="utf-8"><span style="font-family: monospace">## not a heading</span>'),
    ).toBe(false)
  })
  it('is false for a single unstyled paragraph', () => {
    expect(htmlCarriesDocumentStructure('<p>just one line</p>')).toBe(false)
  })
  it('is false for empty or absent HTML', () => {
    expect(htmlCarriesDocumentStructure('')).toBe(false)
    expect(htmlCarriesDocumentStructure('   ')).toBe(false)
  })
  it('is false for HTML that is only an SVG — svg-in-html still owns that', () => {
    expect(htmlCarriesDocumentStructure('<meta charset="utf-8"><svg viewBox="0 0 4 4"><rect/></svg>')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/paste-html-structure.test.ts`
Expected: FAIL — `htmlCarriesDocumentStructure` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/domain/paste/exhaust.ts`, directly below `looksLikeDocument`:

```ts
/**
 * Does the `text/html` flavour carry document structure worth keeping?
 *
 * The §4.2 ruling used to be "pasted-from-browser HTML is not treated as a
 * document", so every paste was flattened to text/plain and arrived without
 * bold, links, lists or tables. This predicate is what reverses it.
 *
 * Deliberately narrow. A plain-text copy still arrives with a `<meta charset>`
 * and a styled `<span>` wrapper, and that paste must keep taking the Markdown
 * path — otherwise pasted Markdown source stops being parsed as Markdown
 * (BUG-1). So a wrapper alone is not structure: a block element, a mark, or
 * more than one paragraph is.
 */
const HTML_STRUCTURE: readonly RegExp[] = [
  /<(h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|pre)[\s>]/i,
  /<(strong|b|em|i|a|code|del|s)[\s>]/i,
]

export function htmlCarriesDocumentStructure(html: string): boolean {
  if (html.trim() === '') return false
  if (HTML_STRUCTURE.some((pattern) => pattern.test(html))) return true
  // Two or more paragraphs is a document even with no marks in it.
  return (html.match(/<p[\s>]/gi) ?? []).length > 1
}
```

Add to the `./paste/exhaust.js` export block in `src/domain/index.ts`:

```ts
  htmlCarriesDocumentStructure,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/paste-html-structure.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/paste/exhaust.ts src/domain/index.ts tests/domain/paste-html-structure.test.ts
git commit -m "feat(paste): recognise HTML that carries document structure"
```

---

### Task 2: Rewriting inline SVG into an svg code fence

**Files:**
- Modify: `src/domain/paste/recognition.ts`
- Modify: `src/domain/index.ts`
- Test: `tests/domain/paste-svg-rewrite.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `svgToCodeFenceHtml(html: string): string`

- [ ] **Step 1: Write the failing test**

Create `tests/domain/paste-svg-rewrite.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { svgToCodeFenceHtml } from '../../src/domain/index.js'

const SVG = '<svg viewBox="0 0 4 4"><rect width="2"/></svg>'

/**
 * ProseMirror's clipboard parse drops <svg> on the floor. Rewriting it to the
 * fenced form the renderer already understands is what keeps a pasted chart in
 * place, between the prose that surrounded it.
 */
describe('svgToCodeFenceHtml', () => {
  it('rewrites a single inline SVG into an svg code fence', () => {
    const out = svgToCodeFenceHtml(`<p>before</p><figure>${SVG}</figure><p>after</p>`)
    expect(out).toContain('<pre><code class="language-svg">')
    expect(out).toContain('<p>before</p>')
    expect(out).toContain('<p>after</p>')
    expect(out).not.toContain('<svg')
  })

  it('escapes the source so it lands as text, not as markup', () => {
    const out = svgToCodeFenceHtml(SVG)
    expect(out).toContain('&lt;svg viewBox="0 0 4 4"&gt;')
    expect(out).toContain('&lt;rect width="2"/&gt;')
  })

  it('rewrites every SVG, not just the first', () => {
    const out = svgToCodeFenceHtml(`${SVG}<p>middle</p>${SVG}`)
    expect(out.match(/<pre><code class="language-svg">/g)).toHaveLength(2)
  })

  it('leaves SVG-free HTML byte-identical', () => {
    const html = '<h2>Title</h2><p>No pictures here.</p>'
    expect(svgToCodeFenceHtml(html)).toBe(html)
  })

  it('handles an SVG carrying a namespace and nested markup', () => {
    const nested = '<svg xmlns="http://www.w3.org/2000/svg"><g><circle r="1"/></g></svg>'
    const out = svgToCodeFenceHtml(`<div>${nested}</div>`)
    expect(out).not.toContain('<circle')
    expect(out).toContain('&lt;circle r="1"/&gt;')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/paste-svg-rewrite.test.ts`
Expected: FAIL — `svgToCodeFenceHtml` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/domain/paste/recognition.ts`:

```ts
/** The five characters that would otherwise reopen the HTML parser. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Rewrites every inline `<svg>` in an HTML clipboard flavour into the fenced
 * form the renderer already draws.
 *
 * ProseMirror's clipboard parse has no rule for `<svg>`, so a pasted chart
 * simply vanishes — measured on a report where the prose, table and headings
 * all survived and the picture did not. Turning it into
 * ```` ```svg ```` before the parse runs keeps it *where it was*, rather than
 * appending it or dropping it.
 *
 * String rewriting rather than DOM surgery keeps this in `domain`, and the
 * source is escaped because it is untrusted markup on the way to a text node.
 * Sanitisation still happens later, at render (§7) — this only decides where
 * the bytes land.
 */
export function svgToCodeFenceHtml(html: string): string {
  return html.replace(
    /<svg[\s>][\s\S]*?<\/svg\s*>/gi,
    (svg) => `<pre><code class="language-svg">${escapeHtml(svg)}</code></pre>`,
  )
}
```

Add to the `./paste/recognition.js` export block in `src/domain/index.ts`:

```ts
  svgToCodeFenceHtml,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/paste-svg-rewrite.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/paste/recognition.ts src/domain/index.ts tests/domain/paste-svg-rewrite.test.ts
git commit -m "feat(paste): rewrite inline SVG into an svg code fence"
```

---

### Task 3: The svg-in-html sniffer stops eating documents

**Files:**
- Modify: `src/adapters/editor/paste-sniffers.ts` (the `svg-in-html` sniffer, ~line 65)
- Test: `tests/adapters/paste-sniffer-chain.test.ts`

**Interfaces:**
- Consumes: `htmlCarriesDocumentStructure` from Task 1.
- Produces: no new exports. `claimPaste(text, html)` returns `null` for a document.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('paste sniffer chain', …)` in `tests/adapters/paste-sniffer-chain.test.ts`:

```ts
  const SVG = '<svg viewBox="0 0 4 4"><rect/></svg>'

  // The reported bug. svg-in-html matched an <svg> anywhere in the HTML, so a
  // whole report — headings, prose, a table — was replaced by its one chart.
  // DESIGN.md §4.4 rule 2: never lose the source.
  it('declines a document that merely contains an SVG', () => {
    const html = `<h1>Report</h1><p>Prose.</p><figure>${SVG}</figure><table><tr><td>1</td></tr></table>`
    expect(claimPaste('Report\nProse.\n1', html)).toBeNull()
  })

  it('still claims HTML that is only a wrapped SVG', () => {
    expect(claimPaste('irrelevant plain text', `<meta charset="utf-8"><div>${SVG}</div>`)).toEqual({
      language: 'svg',
      source: SVG,
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/paste-sniffer-chain.test.ts`
Expected: FAIL — "declines a document" returns `{language: 'svg', …}` instead of `null`.

- [ ] **Step 3: Write minimal implementation**

In `src/adapters/editor/paste-sniffers.ts`, add `htmlCarriesDocumentStructure` to the existing import from `'../../domain/index.js'`, then replace the `svg-in-html` sniffer:

```ts
  {
    id: 'svg-in-html',
    priority: 30,
    claim: (_text: string, html: string) => {
      // A document that contains a chart is not a chart. Claiming it replaced
      // the whole paste with its one <svg> and threw the rest away — the same
      // fault BUG-5 fixed in the exhaust tier, which this sniffer never got.
      if (htmlCarriesDocumentStructure(html)) return null
      const svg = svgInHtml(html)
      return svg === null ? null : { language: 'svg', source: svg }
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/paste-sniffer-chain.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/editor/paste-sniffers.ts tests/adapters/paste-sniffer-chain.test.ts
git commit -m "fix(paste): stop svg-in-html swallowing a document that contains a chart"
```

---

### Task 4: The HTML path, so a pasted document keeps its formatting

**Files:**
- Modify: `src/adapters/editor/paste-sniffers.ts` (`handlePaste`, ~lines 202-253)
- Modify: `docs/DESIGN.md` (the §4.2 ruling table)
- Test: `tests/ui/editor-harness.spec.ts`

**Interfaces:**
- Consumes: `htmlCarriesDocumentStructure` (Task 1), `svgToCodeFenceHtml` (Task 2).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `tests/ui/editor-harness.spec.ts`. `pasteAtEnd` and `editor` already exist in that file.

```ts
const PASTED_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect width="20" height="30"/></svg>'

const RICH_HTML = `<meta charset="utf-8">
<h2>A pasted heading</h2>
<p>Some <strong>bold text</strong> and a <a href="https://example.test/">real link</a>.</p>
<ul><li>first bullet</li><li>second bullet</li></ul>
<table><thead><tr><th>Alert</th><th>Pad</th></tr></thead><tbody><tr><td>#854</td><td>GM A Pad</td></tr></tbody></table>
<p>Closing prose.</p>`

// What a browser actually puts in text/plain: no Markdown markers at all.
const RICH_TEXT = 'A pasted heading\nSome bold text and a real link.\nfirst bullet\nsecond bullet\nAlert\tPad\n#854\tGM A Pad\nClosing prose.'

test('a pasted document keeps its formatting (§4.2, HTML path)', async ({ page }) => {
  await pasteAtEnd(page, RICH_TEXT, RICH_HTML)

  await expect(page.locator(`${editor} h2`, { hasText: 'A pasted heading' })).toBeVisible()
  await expect(page.locator(`${editor} strong`, { hasText: 'bold text' })).toBeVisible()
  await expect(page.locator(`${editor} a[href="https://example.test/"]`)).toBeVisible()
  await expect(page.locator(`${editor} li`, { hasText: 'first bullet' })).toBeVisible()
  await expect(page.locator(`${editor} table`)).toHaveCount(1)
  await expect(page.locator(editor)).toContainText('Closing prose.')
})

// The reported bug, end to end: the chart arrived and everything else did not.
test('a pasted document containing a chart keeps both (§4.4 never lose the source)', async ({ page }) => {
  const html = RICH_HTML.replace('<p>Closing prose.</p>', `<figure>${PASTED_SVG}</figure><p>Closing prose.</p>`)
  await pasteAtEnd(page, RICH_TEXT, html)

  await expect(page.locator(`${editor} h2`, { hasText: 'A pasted heading' })).toBeVisible()
  await expect(page.locator(`${editor} table`)).toHaveCount(1)
  await expect(page.locator(editor)).toContainText('Closing prose.')
  // The chart survives in place, as the block the renderer already draws.
  await expect(page.locator('.diagram')).toHaveCount(2)
  await expect(page.locator('.diagram').last().locator('.diagram-render svg rect')).toHaveCount(1)
})

// BUG-1 regression guard: a plain-text copy of Markdown source is still parsed
// as Markdown, not inserted verbatim and escaped on the way out.
test('a plain-text Markdown paste still takes the Markdown path', async ({ page }) => {
  await pasteAtEnd(page, '## Plain markdown heading\n\nWith **bold** in it.')

  await expect(page.locator(`${editor} h2`, { hasText: 'Plain markdown heading' })).toBeVisible()
  await expect(page.locator(`${editor} strong`, { hasText: 'bold' })).toBeVisible()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/ui/editor-harness.spec.ts -g "pasted document" --reporter=list`
Expected: FAIL — no `h2`, `strong`, `a[href]`, `li` or `table` from the paste; everything arrives as flat text.

- [ ] **Step 3: Write minimal implementation**

In `src/adapters/editor/paste-sniffers.ts`, add this import beside the existing ProseMirror imports:

```ts
import { DOMParser as ProseDOMParser, Slice } from '@milkdown/kit/prose/model'
```

(`Slice` is already imported; extend that line rather than duplicating it.)

Add this helper inside the `$prose((ctx: Ctx) => {` body, beside `insertMarkdown`:

```ts
    /**
     * §4.2 step 3, HTML flavour: a paste that is a document keeps being one.
     *
     * The old ruling flattened every paste to text/plain, so a report pasted
     * from a browser arrived with no bold, no links, no lists and no tables.
     * ProseMirror's own parser produces all of them; nothing here reimplements
     * it. The one thing it has no rule for is `<svg>`, which is why the source
     * is rewritten to a fence first — that is what keeps a chart in place
     * instead of dropping it.
     */
    const insertHtml = (view: EditorView, html: string): void => {
      const dom = new window.DOMParser().parseFromString(svgToCodeFenceHtml(html), 'text/html')
      const slice = ProseDOMParser.fromSchema(view.state.schema).parseSlice(dom.body)
      view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView())
    }
```

Then, in `handlePaste`, replace the `if (claimed === null) { … }` block's tail so the HTML path is tried before the text path:

```ts
          if (claimed === null) {
            // The Excel/Sheets clipboard is TSV in text/plain. It becomes a
            // real GFM table — content, not a card — so it goes through the
            // Markdown path rather than a renderer.
            if (standalone && looksLikeTsv(text)) {
              insertMarkdown(view, tsvToMarkdownTable(text))
              return true
            }
            // §4.2, revised: HTML that carries document structure is a
            // document. Flattening it to text/plain was what lost every mark,
            // link, list and table in a paste from a browser.
            if (htmlCarriesDocumentStructure(html)) {
              insertHtml(view, html)
              return true
            }
            if (text.trim() === '') return false
            // No structure to keep: text/plain, parsed as Markdown (BUG-1).
            insertMarkdown(view, text)
            return true
          }
```

Note the `if (text.trim() === '')` guard moves **below** the HTML branch, so an HTML-only clipboard is now handled rather than declined.

Finally, in `docs/DESIGN.md`, replace this row of the §4.2 ruling table:

```markdown
| Clipboard has both `text/html` and `text/plain`, no SVG | Markdown path on `text/plain` — pasted-from-browser HTML is not treated as a document. |
```

with:

```markdown
| Clipboard `text/html` carries document structure (a heading, list, table, or any mark) | **HTML path.** Real headings, marks, lists and tables. An inline `<svg>` becomes an `svg` block in place. |
| Clipboard `text/html` is only a wrapper, or absent | Markdown path on `text/plain`. A plain-text copy of Markdown source must still parse as Markdown (BUG-1). |
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/ui/editor-harness.spec.ts --reporter=list`
Expected: PASS, including the pre-existing `svg-in-html wins over the text flavour (§4.2 priority 30)` and `a multi-block paste takes the Markdown path` tests.

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run`
Expected: PASS. The `fidelity-corpus` and `clipboard-formats` suites are the ones most likely to notice a triage change.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/editor/paste-sniffers.ts docs/DESIGN.md tests/ui/editor-harness.spec.ts
git commit -m "fix(paste): keep a pasted document's formatting, and its charts"
```

---

### Task 5: Selecting a diagram block, so it can be deleted

**Files:**
- Modify: `src/adapters/editor/diagram-node-view.ts`
- Modify: `src/app/styles/app.css` (one rule, beside the existing `.diagram` rules ~line 2566)
- Test: `tests/ui/editor-harness.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — independent of Tasks 1-4.
- Produces: `DiagramNodeView` now implements `selectNode()` and `deselectNode()`.

- [ ] **Step 1: Write the failing test**

Append to `tests/ui/editor-harness.spec.ts`:

```ts
test('a rendered diagram can be selected and deleted', async ({ page }) => {
  await pasteAtEnd(page, BARE_MERMAID)
  await expect(page.locator('.diagram')).toHaveCount(2)

  await page.locator('.diagram').last().locator('.diagram-render').click()
  await expect(page.locator('.diagram.is-selected')).toHaveCount(1)

  await page.keyboard.press('Backspace')
  await expect(page.locator('.diagram')).toHaveCount(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/ui/editor-harness.spec.ts -g "selected and deleted" --reporter=list`
Expected: FAIL — no `.diagram.is-selected` appears; clicking puts the selection outside the block entirely.

- [ ] **Step 3: Write minimal implementation**

In `src/adapters/editor/diagram-node-view.ts`, extend the ProseMirror state import:

```ts
import { NodeSelection, Selection } from '@milkdown/kit/prose/state'
```

Add this method to the class:

```ts
  /**
   * Puts a real selection on the block.
   *
   * Without it there was no way to remove a diagram at all: the NodeView has
   * no `contentDOM`, so a click landed outside the editor content and
   * Backspace had nothing to act on. A `NodeSelection` is the whole fix —
   * ProseMirror deletes one on Backspace and Delete with no keymap of ours.
   */
  readonly #selectBlock = (): boolean => {
    const pos = this.getPos()
    if (pos === undefined) return false
    const { state } = this.view
    if (state.doc.nodeAt(pos) === null) return false
    this.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
    this.view.focus()
    return true
  }
```

In the constructor, after `this.dom.append(label, this.#toggle, this.#render, this.#error)`:

```ts
    // A click anywhere on the figure selects the block. The Edit-source button
    // and the source sheet are excluded — `stopEvent` already treats those as
    // ours, and selecting the block from them would fight the textarea.
    this.dom.addEventListener('click', (event) => {
      if (this.#toggle.contains(event.target as Node)) return
      if (this.#sheet.contains(event.target as Node)) return
      this.#selectBlock()
    })
```

Add the two NodeView selection hooks beside `stopEvent`:

```ts
  /** ProseMirror tells us when the block is the selection; show it. */
  selectNode(): void {
    this.dom.classList.add('is-selected')
  }

  deselectNode(): void {
    this.dom.classList.remove('is-selected')
  }
```

In `src/app/styles/app.css`, after the `.diagram { … }` rule:

```css
/*
 * A selected diagram has to look selected. The block is deletable the moment
 * it takes a NodeSelection, and without a visible outline that reads as the
 * click having done nothing at all.
 */
.diagram.is-selected {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/ui/editor-harness.spec.ts -g "selected and deleted" --reporter=list`
Expected: PASS.

- [ ] **Step 5: Check the source editor still works**

Run: `npx playwright test tests/ui/editor-harness.spec.ts --reporter=list`
Expected: PASS. The existing Mermaid render/source-toggle tests are the guard that the new click handler did not break `Edit source`.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/editor/diagram-node-view.ts src/app/styles/app.css tests/ui/editor-harness.spec.ts
git commit -m "feat(diagram): select a rendered block, so Backspace can delete it"
```

---

### Task 6: Right-click a diagram

**Files:**
- Modify: `src/adapters/editor/diagram-node-view.ts`
- Test: `tests/ui/editor-harness.spec.ts`

**Interfaces:**
- Consumes: `#selectBlock()` from Task 5.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `tests/ui/editor-harness.spec.ts`:

```ts
test('right-clicking a diagram offers Delete', async ({ page }) => {
  await pasteAtEnd(page, BARE_MERMAID)
  await expect(page.locator('.diagram')).toHaveCount(2)

  await page.locator('.diagram').last().locator('.diagram-render').click({ button: 'right' })

  const menu = page.locator('.diagram-context-menu')
  await expect(menu).toBeVisible()
  await menu.getByRole('button', { name: 'Delete' }).click()

  await expect(page.locator('.diagram')).toHaveCount(1)
  await expect(menu).toHaveCount(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/ui/editor-harness.spec.ts -g "right-clicking a diagram" --reporter=list`
Expected: FAIL — `.diagram-context-menu` never appears.

- [ ] **Step 3: Write minimal implementation**

In `src/adapters/editor/diagram-node-view.ts`, add a field and the menu. The menu lives on `<body>` for the same reason the source sheet does — a figure with `overflow: hidden` would clip it.

Add to the class fields:

```ts
  #menu: HTMLElement | undefined
```

Add the methods:

```ts
  /**
   * The block's own context menu.
   *
   * `.note-context-menu` is the sidebar's menu styling, reused so this looks
   * like the rest of the app rather than a second kind of menu. Both actions
   * already exist — this is an affordance for them, not new behaviour.
   */
  readonly #openMenu = (event: MouseEvent): void => {
    if (this.#sheet.contains(event.target as Node)) return
    event.preventDefault()
    if (!this.#selectBlock()) return
    this.#closeMenu()

    const menu = document.createElement('div')
    menu.className = 'note-context-menu diagram-context-menu'
    menu.style.position = 'fixed'
    menu.style.left = `${event.clientX}px`
    menu.style.top = `${event.clientY}px`

    const item = (text: string, run: () => void): HTMLButtonElement => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = text
      button.addEventListener('click', () => {
        this.#closeMenu()
        run()
      })
      return button
    }

    menu.append(
      item('Edit source', () => this.#setShowingSource(true)),
      item('Delete', () => this.#deleteBlock()),
    )
    document.body.append(menu)
    this.#menu = menu

    // Any click or Escape outside dismisses it. Deferred by a tick so the
    // right-click that opened it does not immediately close it.
    setTimeout(() => {
      document.addEventListener('pointerdown', this.#closeMenu, { once: true })
      document.addEventListener('keydown', this.#onMenuEscape)
    }, 0)
  }

  readonly #closeMenu = (): void => {
    this.#menu?.remove()
    this.#menu = undefined
    document.removeEventListener('keydown', this.#onMenuEscape)
  }

  readonly #onMenuEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.#closeMenu()
  }

  /** Selects the block, then removes it. */
  #deleteBlock(): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const { state } = this.view
    const node = state.doc.nodeAt(pos)
    if (node === null) return
    this.view.dispatch(state.tr.delete(pos, pos + node.nodeSize))
    this.view.focus()
  }
```

Register the listener in the constructor, beside the click handler from Task 5:

```ts
    this.dom.addEventListener('contextmenu', this.#openMenu)
```

Extend `destroy()` — the menu lives on `<body>`, so it would outlive its block:

```ts
    this.#closeMenu()
    this.dom.removeEventListener('contextmenu', this.#openMenu)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/ui/editor-harness.spec.ts -g "right-clicking a diagram" --reporter=list`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run && npx playwright test --reporter=list`
Expected: PASS, both suites.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/editor/diagram-node-view.ts tests/ui/editor-harness.spec.ts
git commit -m "feat(diagram): right-click a rendered block to edit or delete it"
```

---

## Verification

Before claiming done, run all of it and paste the real output:

```bash
npx vitest run && npx playwright test --reporter=list
```

The paste behaviour must then be checked by hand in the running app, because
the reported bug came from a real browser clipboard and no fixture fully
stands in for one: copy a rendered page containing a heading, a table and a
chart, paste it into a note, and confirm all three arrive.
