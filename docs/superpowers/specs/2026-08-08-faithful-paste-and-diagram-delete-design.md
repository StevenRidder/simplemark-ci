# Faithful paste, and a diagram you can delete — design

- **Status:** Approved design, ready for planning.
- **Date:** 2026-08-08
- **Scope:** Two independent defects in the paste and diagram-block path.
- **Companion to:** [`DESIGN.md`](../../DESIGN.md) §4 (paste pipeline), §4.3 (reversibility)
- **Changes:** one row of the `DESIGN.md` §4.2 ruling table (§2.4 below)

## 1. What this is

Two bugs reported from one paste. A rich report — headings, prose, a table, and
one inline chart — was pasted into a note, and **only the chart arrived**. The
report was gone. The chart that replaced it then could not be removed: clicking
it does nothing, Backspace does nothing, and it has no context menu.

They are unrelated faults that happened to surface together, and they are fixed
independently.

## 2. Bug 1 — a document that contains an SVG is destroyed by the paste

### 2.1 Root cause

[`svgInHtml()`](../../../src/domain/paste/recognition.ts) matches an `<svg>`
**anywhere** in the `text/html` flavour:

```ts
const match = /<svg[\s>][\s\S]*?<\/svg\s*>/i.exec(html)
```

So the priority-30 `svg-in-html` sniffer claims the entire paste, and
[`insertFence`](../../../src/adapters/editor/paste-sniffers.ts) replaces the
selection with only that SVG. Everything else on the clipboard is discarded.

Reproduced in a real browser: pasting a report whose HTML carried one `<svg>`
left the document with the diagram block and **not one word** of the prose,
headings or table.

This is exactly BUG-5, which added a `looksLikeDocument` veto to the exhaust
tier so that a document quoting a file tree is not swallowed by the `tree`
sniffer. That veto was never applied to the two SVG sniffers.

It also violates `DESIGN.md` §4.4 rule 2, *never lose the source*.

### 2.2 The second, larger finding

Vetoing the sniffer is not enough, because the fallback path is also lossy.
`handlePaste` always returns `true` and routes the paste through
`insertMarkdown(view, text)` on **`text/plain`**. Milkdown's clipboard plugin —
which parses `text/html` — never runs.

Measured on the same rich HTML with no SVG in it at all:

```
strong: 0   em: 0   links: []   li: []   tables: 0
```

Bold, italics, links, bullets, headings and tables are all lost today. Every
paste from a browser lands as flat text.

That is not an accident. It is the current `DESIGN.md` §4.2 ruling:

> Clipboard has both `text/html` and `text/plain`, no SVG → Markdown path on
> `text/plain` — pasted-from-browser HTML is not treated as a document.

### 2.3 The capability already exists

Forcing the same paste past the sniffer, so Milkdown's own HTML clipboard path
handled it, produced full fidelity with no new code:

```markdown
## A pasted heading

Some **bold text** and *italics* and a [real link](https://example.com/).

* first bullet
* second bullet

| Alert | Pad      |
| :---- | :------- |
| #854  | GM A Pad |

Closing prose.
```

The only thing it drops is the `<svg>`. So the fix is not to build an HTML
importer. It is to stop standing in front of the one that ships.

### 2.4 The ruling change

That §4.2 row is reversed, and `DESIGN.md` is edited to say so:

| Case | New ruling |
|---|---|
| Clipboard `text/html` carries document structure | **HTML path.** Real headings, marks, lists and tables. Inline `<svg>` becomes an `svg` block in place. |
| Clipboard `text/html` is a bare wrapper, or absent | Markdown path on `text/plain`, unchanged (this is what BUG-1 requires). |
| Clipboard `text/html` wraps *only* an `<svg>` | `svg-in-html` claims it, unchanged. |

"Carries document structure" is a new pure predicate,
`htmlCarriesDocumentStructure(html)`, living beside `looksLikeDocument` in
`src/domain/paste/`. It is true when the HTML contains a block-level or
mark-level element — `h1`–`h6`, `ul`, `ol`, `li`, `table`, `blockquote`, `pre`,
`strong`, `b`, `em`, `i`, `a`, or more than one `p`.

It must be **false** for the wrapper HTML that browsers attach to an ordinary
plain-text copy (`<meta charset>` plus a `<span style=…>`), because that paste
must keep taking the Markdown path. This is the whole reason the predicate is
narrow rather than "does it parse as HTML".

### 2.5 Keeping the chart

Milkdown's HTML path drops `<svg>`. Rather than delegate and lose it, the
sniffer plugin keeps ownership of the decision — as it does for every other
case — and parses the HTML itself:

1. Rewrite each `<svg>…</svg>` in the HTML into
   `<pre><code class="language-svg">…</code></pre>`, text-escaped.
2. Parse the rewritten HTML with ProseMirror's `DOMParser.fromSchema`.
3. `replaceSelection` with the resulting slice.

Step 1 is what makes the chart survive **in place**, between the prose that
surrounded it, as the same `svg` code block the renderer already draws. Steps 2
and 3 are what the clipboard plugin would have done anyway.

The rewrite is a pure string function in `domain` — `svgToCodeFenceHtml(html)` —
so the SVG-preservation rule is testable without a DOM.

### 2.6 Deliberately not in scope

LaTeX, Vega and Mermaid inside pasted HTML. There is no agreed source
representation for them in a browser clipboard, and SVG is the case that was
reported. The rewrite in §2.5 is a single function with one call site, so adding
a second recogniser later is additive.

## 3. Bug 2 — the rendered block cannot be deleted

### 3.1 Root cause

`DiagramNodeView` gives its `code_block` no `contentDOM` and no selection
handling. Measured: clicking the figure puts the DOM selection **outside** the
editor content entirely, so no node selection is ever taken, Backspace has no
target, and no `contextmenu` listener exists on `.diagram`.

This is not a regression. The affordance was never implemented.

### 3.2 The fix

Three additions to `DiagramNodeView`, all local to that class:

- **Click selects the block.** A click on the figure — excluding the existing
  `Edit source` button and the source sheet, which `stopEvent` already
  distinguishes — dispatches a `NodeSelection` at `getPos()`.
- **Selected state is visible.** `selectNode()` / `deselectNode()` toggle a
  class; one CSS rule draws the accent outline. Without this the block would be
  deletable but not visibly selected, which reads as broken.
- **Backspace and Delete then work with no keymap at all** — ProseMirror deletes
  a node selection by default. This is why selection is the fix rather than a
  new command.

### 3.3 The context menu

A `contextmenu` listener on the figure opens a menu at the pointer, reusing the
existing `.note-context-menu` styling from `window-chrome.ts` so it matches the
sidebar's menus rather than introducing a second look.

Two items, both of which already have working implementations behind them:

| Item | Action |
|---|---|
| **Edit source** | The existing `#setShowingSource(true)` |
| **Delete** | Select the node, then delete it |

Right-clicking also selects the block first, so the menu always acts on the
block under the pointer.

`destroy()` must remove the menu and its listeners. The source sheet is already
a precedent for this: it lives on `<body>` and is explicitly cleaned up.

## 4. Testing

Every claim above was measured, and each becomes a test.

**Domain (vitest, no DOM).** The new predicates get the same treatment
`paste-document-veto.test.ts` gives BUG-5 — both directions:

- `htmlCarriesDocumentStructure` is true for headings, tables, lists, marks;
  false for a `<meta>` + `<span>` plain-text wrapper and for empty HTML.
- The `svg-in-html` sniffer still claims HTML that is only an SVG, and now
  declines a document containing one. `svgInHtml` itself stays a pure
  extractor; the veto belongs to the sniffer, beside the priority it competes
  on.
- `svgToCodeFenceHtml` rewrites one SVG, rewrites several, escapes the source,
  and leaves SVG-free HTML untouched.

**Editor (Playwright, real browser).** In `editor-harness.spec.ts`:

- The reported paste — prose + table + inline SVG — keeps **all** of it: the
  prose is present, the table is a real table, and the chart is a `.diagram`.
- A rich paste with no SVG yields real `strong`, `a[href]`, `li` and `table`.
- A plain-text Markdown paste still takes the Markdown path (BUG-1 regression).
- The existing `svg-in-html wins over the text flavour` test still passes —
  a bare wrapped SVG is still claimed.
- Clicking a diagram selects it; Backspace deletes it.
- Right-clicking a diagram opens the menu; Delete removes the block.

## 5. Sequencing

Two independent pieces, in this order:

1. **Paste fidelity** (§2) — domain predicates first, then the adapter triage.
2. **Diagram delete** (§3) — selection first, then the context menu on top of it.

Bug 1 is the data-loss bug and ships first. Neither depends on the other.
