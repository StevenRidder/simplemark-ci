import { expect, test } from '@playwright/test'

/**
 * DESIGN.md §4.2 condition 1, the half nobody tested: **pasting into the middle
 * of a sentence.**
 *
 * Every other paste spec puts the caret at a block boundary, which is the case
 * the sniffer chain is about. The ordinary case — caret between two words, ⌘V —
 * had no coverage at all, and two different insert paths reach it:
 *
 * - `insertMarkdown`, for `text/plain` and for HTML that carries no structure
 * - `insertHtml`, for HTML that does (a mark, a block, two paragraphs)
 *
 * The required behaviour is one sentence long: inline content pasted into a
 * sentence yields inline marks, not a paragraph split. The tests below fix the
 * caret in the same place every time — `before| after` — so a split is visible
 * as an extra paragraph rather than as a subtle diff.
 */

const editor = '.milkdown .ProseMirror'

/**
 * Caret between the two words of a fresh `before after` paragraph.
 *
 * A fresh paragraph rather than the fixture's own prose: the assertion is about
 * what surrounds the paste, so the surroundings have to be exactly known. The
 * caret sits after `before`, with a real word on each side, so
 * `$from.parentOffset` is neither 0 nor the end of the block.
 *
 * Placed through the editor's own selection API, not with six ArrowLefts
 * (BUG-19). A native caret move reaches ProseMirror through the browser's
 * asynchronous `selectionchange` event, and prosemirror-view's focus handler
 * schedules a 20ms check that restores its own selection over any DOM
 * selection it has not read yet. A key burst that starts right after
 * `focusEnd()` — impossible for a person, routine for a harness — ran into
 * that check about once in seventy runs and lost a move, so the paste landed
 * one character off. A dispatched selection is consistent in the state and the
 * DOM at once; neither race exists for it.
 */
async function caretMidSentence(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await expect(page.locator(editor)).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.type('before after')
  const placed = await page.evaluate(() =>
    window.simplemark!.editor.placeCaretInQuote('before after', 'before'.length),
  )
  expect(placed, 'the typed sentence must be unique in the document').toBe(true)
}

/** A real clipboard, both flavours when given. A synthetic event is untrusted. */
async function paste(
  page: import('@playwright/test').Page,
  text: string,
  html?: string,
): Promise<void> {
  await page.evaluate(
    async ({ t, h }) => {
      if (h === undefined) {
        await navigator.clipboard.writeText(t)
        return
      }
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([t], { type: 'text/plain' }),
          'text/html': new Blob([h], { type: 'text/html' }),
        }),
      ])
    },
    { t: text, h: html },
  )
  await page.keyboard.press('ControlOrMeta+v')
}

const serialize = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.simplemark!.editor.serialize())

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  // Chromium exposes explicit clipboard permissions to Playwright; WebKit does
  // not recognise those names and gates the focused page's clipboard directly.
  if (page.context().browser()?.browserType().name() === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  }
  await page.bringToFront()
  await expect(page.locator(editor)).toBeVisible()
})

// ── insertMarkdown: text/plain ───────────────────────────────────────────────

test('plain text pasted mid-sentence stays in the sentence', async ({ page }) => {
  await caretMidSentence(page)
  const paragraphs = await page.locator(`${editor} p`).count()

  await paste(page, 'MIDDLE')

  await expect.poll(async () => serialize(page)).toContain('beforeMIDDLE after')
  // The failure this catches: `before` / `MIDDLE` / ` after` as three blocks.
  // A leading space that survives serialisation comes back as `&#x20;`, which
  // is the fingerprint of the split.
  const markdown = await serialize(page)
  expect(markdown).not.toContain('&#x20;after')
  await expect(page.locator(`${editor} p`)).toHaveCount(paragraphs)
})

test('Markdown source pasted mid-sentence becomes inline marks, not new blocks', async ({
  page,
}) => {
  await caretMidSentence(page)
  const paragraphs = await page.locator(`${editor} p`).count()

  await paste(page, '**bold md** and `code`')

  await expect.poll(async () => serialize(page)).toContain('before**bold md** and `code` after')
  await expect(page.locator(`${editor} p`)).toHaveCount(paragraphs)
  await expect(page.locator(`${editor} strong`, { hasText: 'bold md' })).toHaveCount(1)
})

// The `text/html` an ordinary plain-text copy carries: a charset meta and a
// styled span, no structure. §4.2 rules it back to the Markdown path (BUG-1),
// so it lands on `insertMarkdown` and must behave the same as text/plain.
test('a span-wrapped plain copy takes the text path and stays in the sentence', async ({
  page,
}) => {
  await caretMidSentence(page)
  const paragraphs = await page.locator(`${editor} p`).count()

  await paste(page, 'plainish', '<meta charset="utf-8"><span style="color:#111">plainish</span>')

  await expect.poll(async () => serialize(page)).toContain('beforeplainish after')
  await expect(page.locator(`${editor} p`)).toHaveCount(paragraphs)
})

// ── insertHtml: HTML that carries structure ──────────────────────────────────

test('a bold phrase copied from a browser lands as an inline mark', async ({ page }) => {
  await caretMidSentence(page)
  const paragraphs = await page.locator(`${editor} p`).count()

  await paste(page, 'bolded', '<meta charset="utf-8"><b>bolded</b>')

  await expect.poll(async () => serialize(page)).toContain('before**bolded** after')
  await expect(page.locator(`${editor} p`)).toHaveCount(paragraphs)
  await expect(page.locator(`${editor} strong`, { hasText: 'bolded' })).toHaveCount(1)
})

test('a link copied from a browser lands as an inline link', async ({ page }) => {
  await caretMidSentence(page)
  const paragraphs = await page.locator(`${editor} p`).count()

  await paste(page, 'Example', '<meta charset="utf-8"><a href="https://example.com">Example</a>')

  await expect.poll(async () => serialize(page)).toMatch(/before\[Example]\(https:\/\/example\.com\/?\) after/)
  await expect(page.locator(`${editor} p`)).toHaveCount(paragraphs)
  await expect(page.locator(`${editor} a`, { hasText: 'Example' })).toHaveCount(1)
})

/**
 * A list is block content, so it cannot stay inline and must not pretend to.
 *
 * ProseMirror's own fitting rule applies: the first item joins the sentence it
 * was dropped into and the rest become real list items. That is what a browser
 * paste does everywhere else, and the property worth pinning is the §4.4 one —
 * nothing on either side of the caret is lost.
 */
test('a short list copied from a browser lands as a list without losing the sentence', async ({
  page,
}) => {
  await caretMidSentence(page)

  await paste(page, 'one\ntwo', '<meta charset="utf-8"><ul><li>one</li><li>two</li></ul>')

  await expect.poll(async () => serialize(page)).toContain('beforeone')
  const markdown = await serialize(page)
  expect(markdown).toMatch(/^\s*[*-]\s+two after$/m)
  await expect(page.locator(`${editor} li`, { hasText: 'two after' })).toHaveCount(1)
})

// ── §4.2 condition 1 itself ──────────────────────────────────────────────────

test('bare Mermaid pasted mid-sentence stays text and never converts', async ({ page }) => {
  const diagrams = await page.locator('.diagram').count()
  await caretMidSentence(page)

  await paste(page, 'flowchart LR\n  A --> B')

  await expect.poll(async () => serialize(page)).toContain('flowchart LR')
  await expect(page.locator('.diagram')).toHaveCount(diagrams)
  expect(await serialize(page)).not.toContain('```mermaid\nflowchart LR\n  A --> B')
})

// ── The caret the reader sees ────────────────────────────────────────────────

/**
 * BUG-19. ProseMirror learns where a caret went from the browser's
 * `selectionchange` event, which arrives a task later — in practice at the
 * next rendering frame. A paste handled inside that gap used to land at the
 * caret's *previous* position; `handlePaste` now pulls the live DOM selection
 * into the state first, the rule #196 gave toolbar and menu commands.
 *
 * The gap is reproduced by construction rather than by luck: the DOM caret is
 * moved and the paste event dispatched in the same task, so no
 * `selectionchange` can run in between. A synthetic event is untrusted and is
 * never used for the flavour tests above; here it is the only way to be inside
 * the gap on purpose.
 */
test('a paste that arrives before ProseMirror has read a caret move lands at the visible caret', async ({
  page,
}) => {
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await expect(page.locator(editor)).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.type('before after')
  const paragraphs = await page.locator(`${editor} p`).count()

  await page.evaluate((selector) => {
    const selection = document.getSelection()
    const host = selection?.anchorNode ?? null
    if (
      selection === null
      || host === null
      || host.nodeType !== Node.TEXT_NODE
      || host.textContent !== 'before after'
    ) {
      throw new Error(
        `the caret is not in the typed paragraph: ${host?.nodeName} ${JSON.stringify(host?.textContent)}`,
      )
    }
    selection.collapse(host, 'before'.length)
    const data = new DataTransfer()
    data.setData('text/plain', 'MIDDLE')
    document.querySelector(selector)!.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )
  }, editor)

  await expect.poll(async () => serialize(page)).toContain('beforeMIDDLE after')
  await expect(page.locator(`${editor} p`)).toHaveCount(paragraphs)
})
