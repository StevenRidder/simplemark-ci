import { expect, test } from '@playwright/test'

import {
  BROWSER_CHAT_DIAGRAM_ANSWER_COPY,
  BROWSER_CHAT_RICH_ANSWER_COPY,
  type ClipboardPayload,
} from '../support/clipboard-payloads.js'

/**
 * The rich-paste fidelity gate, measured through the real editor.
 *
 * When an assistant answer is copied out of a browser chat UI the clipboard
 * carries two complete descriptions of the same message: the authored Markdown
 * in `text/plain`, and a rendering of it in `text/html`. DESIGN.md §4.2 lets
 * structured HTML keep its formatting only when its parsed readable text
 * matches the Markdown parse of `text/plain`. This file proves that ordinary
 * rich structure survives and that known lossy interpretations fall back.
 *
 * Every test pastes the same recorded payload twice:
 *
 * - **A**, both flavours, which is what a person gets today; and
 * - **B**, `text/plain` alone — the desktop Copy-button clipboard, and exactly
 *   what would land if the Markdown source were parsed instead.
 *
 * Both run through the real editor, because the answer is produced by the real
 * schema and the real serialiser and cannot be simulated. The assertions are
 * schema and the real serialiser and cannot be simulated. A complete HTML
 * interpretation may still win; an incomplete one must serialize identically
 * to the lossless text/plain path because that path is the fallback.
 */

const RICH_MARKER = 'original paper'
const DIAGRAM_MARKER = 'Both branches'

/**
 * Replaces the whole document with the paste, and returns what would be saved.
 *
 * Select-all first so the serialisation is the paste and nothing else — the
 * fixture note's own blocks would otherwise sit in every measurement. A
 * selection replacement still counts as a block boundary (§4.2 condition 1),
 * so this does not change which path the paste takes.
 */
async function pasteAndSerialize(
  page: import('@playwright/test').Page,
  payload: ClipboardPayload,
  marker: string,
): Promise<string> {
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  // Headless Chromium refuses the async clipboard on an unfocused document.
  await page.bringToFront()
  await page.evaluate(() => window.simplemark!.editor.focusEnd())

  await page.evaluate(
    async ({ text, html }) => {
      const item: Record<string, Blob> = {
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }
      // An empty HTML flavour is not an empty string on the clipboard: a
      // source that publishes no HTML publishes no HTML.
      if (html !== '') item['text/html'] = new Blob([html], { type: 'text/html' })
      await navigator.clipboard.write([new ClipboardItem(item)])
    },
    { text: payload.text, html: payload.html },
  )

  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ControlOrMeta+v')

  // Settled, not merely present. A NodeView that mounts after the insert can
  // still commit back into the document — a pasted formula serialises one way
  // the instant the paste lands and another once the math block has its node
  // — so measuring on first sight of the marker measures a half-built
  // document. Two identical readings a quarter-second apart is the document.
  let previous = ''
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.simplemark!.editor.serialize())
        const settled = current === previous && current.includes(marker)
        previous = current
        return settled
      },
      { timeout: 30_000, intervals: [250] },
    )
    .toBe(true)

  return previous
}

/** The same payload with its HTML flavour removed: the Markdown-source path. */
const sourceOnly = (payload: ClipboardPayload): ClipboardPayload => ({
  text: payload.text,
  html: '',
})

test('a two-flavour rich answer keeps marks, nesting, tables, fences and task state', async ({
  page,
}, testInfo) => {
  const bothFlavours = await pasteAndSerialize(page, BROWSER_CHAT_RICH_ANSWER_COPY, RICH_MARKER)
  const plainTextOnly = await pasteAndSerialize(
    page,
    sourceOnly(BROWSER_CHAT_RICH_ANSWER_COPY),
    RICH_MARKER,
  )
  await testInfo.attach('both-flavours.md', { body: bothFlavours, contentType: 'text/markdown' })
  await testInfo.attach('plain-text-only.md', { body: plainTextOnly, contentType: 'text/markdown' })

  // This recorded payload contains KaTeX output that cannot round-trip
  // faithfully, so its rich candidate is vetoed and the complete source wins.
  expect(bothFlavours).toBe(plainTextOnly)

  // Marks and links survive the round trip intact.
  expect(bothFlavours).toContain('**Python**')
  expect(bothFlavours).toContain('*numerically unstable*')
  expect(bothFlavours).toContain('`count`')
  expect(bothFlavours).toContain('[original paper](https://example.test/welford)')

  // Headings keep their level.
  expect(bothFlavours).toContain('## Welford')
  expect(bothFlavours).toContain('### Steps')

  // An unordered list nested inside an ordered one keeps both its kinds and
  // its depth. (The bullet marker is the serialiser's `*`, not the source `-`,
  // on both paths — see the loss test below for what is a real difference.)
  expect(bothFlavours).toMatch(/^1\. Seed the accumulators\./m)
  expect(bothFlavours).toMatch(/^ {2,}\* `count` starts at zero$/m)
  expect(bothFlavours).toMatch(/^ {2,}1\. update the count$/m)

  // The table arrives as a table, marks inside the cells included.
  expect(bothFlavours).toMatch(/\|\s*\*Welford\*\s*\|\s*1\s*\|\s*\*\*yes\*\*\s*\|/)

  // The load-bearing one: `<pre><code class="language-x">` reaches the schema
  // as a fence that still names its language, so the block is highlightable
  // and a renderer can still claim it. A bare fence here would be silent.
  expect(bothFlavours).toContain('```python')
  expect(bothFlavours).toContain('```ts')
  expect(bothFlavours).toContain('def welford(samples):')
  expect(bothFlavours).toContain('xs.reduce((a, b) => a + b, 0)')

  // Task lists. This row used to read "state lost": `<input type="checkbox">`
  // had no schema rule, so the items arrived as ordinary bullets with the ticks
  // discarded, and the assertion here was `not.toMatch(/\[[ x]\]/)`. It is now
  // lossless — `task-list-paste.ts` adds the missing `parseDOM` rule — so both
  // paths agree, and this is the pin that keeps them agreeing.
  expect(bothFlavours).toMatch(/^\* \[x] Handles streaming input$/m)
  expect(bothFlavours).toMatch(/^\* \[ ] Handles removing a sample$/m)
  expect(plainTextOnly).toContain('[x] Handles streaming input')
  expect(plainTextOnly).toContain('[ ] Handles removing a sample')
})

test('an incomplete rich parse falls back before it can flatten math', async ({
  page,
}, testInfo) => {
  const bothFlavours = await pasteAndSerialize(page, BROWSER_CHAT_RICH_ANSWER_COPY, RICH_MARKER)
  const plainTextOnly = await pasteAndSerialize(
    page,
    sourceOnly(BROWSER_CHAT_RICH_ANSWER_COPY),
    RICH_MARKER,
  )
  await testInfo.attach('both-flavours.md', { body: bothFlavours, contentType: 'text/markdown' })
  await testInfo.attach('plain-text-only.md', { body: plainTextOnly, contentType: 'text/markdown' })

  expect(bothFlavours).toBe(plainTextOnly)
  expect(bothFlavours).toContain('$O(n \\log n)$')
  expect(bothFlavours).toContain('$$')
  expect(bothFlavours).toContain('\\sigma = \\sqrt{\\frac{1}{N}')
  expect(bothFlavours).not.toContain('```svg')
  expect(bothFlavours).not.toContain('O(nlogn)')
})

test('an incomplete rendered diagram falls back to its editable Mermaid source', async ({
  page,
}, testInfo) => {
  const bothFlavours = await pasteAndSerialize(page, BROWSER_CHAT_DIAGRAM_ANSWER_COPY, DIAGRAM_MARKER)
  const plainTextOnly = await pasteAndSerialize(
    page,
    sourceOnly(BROWSER_CHAT_DIAGRAM_ANSWER_COPY),
    DIAGRAM_MARKER,
  )
  await testInfo.attach('both-flavours.md', { body: bothFlavours, contentType: 'text/markdown' })
  await testInfo.attach('plain-text-only.md', { body: plainTextOnly, contentType: 'text/markdown' })

  expect(bothFlavours).toBe(plainTextOnly)
  expect(bothFlavours).toContain('The routing is **one** decision')
  expect(bothFlavours).toContain('```mermaid')
  expect(bothFlavours).toContain('flowchart TD')
  expect(bothFlavours).toContain('A[Clipboard]')
  expect(bothFlavours).toContain('B -- yes --> C[HTML path]')
  expect(bothFlavours).not.toContain('```svg')
  expect(bothFlavours.length).toBeLessThan(plainTextOnly.length * 2)
})
