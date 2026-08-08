import { expect, test } from '@playwright/test'

import {
  BROWSER_CHAT_DIAGRAM_ANSWER_COPY,
  BROWSER_CHAT_RICH_ANSWER_COPY,
  type ClipboardPayload,
} from '../support/clipboard-payloads.js'

/**
 * What the HTML path actually costs, measured rather than assumed.
 *
 * When an assistant answer is copied out of a browser chat UI the clipboard
 * carries two complete descriptions of the same message: the authored Markdown
 * in `text/plain`, and a rendering of it in `text/html`. DESIGN.md §4.2 rules
 * that structured HTML wins, and `tests/adapters/paste-source-routing.test.ts`
 * pins that routing — with the reservation that the round trip
 * (HTML → ProseMirror schema → Markdown on save) is lossy in principle and
 * that nobody had measured it. This file is that measurement.
 *
 * Every test pastes the same recorded payload twice:
 *
 * - **A**, both flavours, which is what a person gets today; and
 * - **B**, `text/plain` alone — the desktop Copy-button clipboard, and exactly
 *   what would land if the Markdown source were parsed instead.
 *
 * Both run through the real editor, because the answer is produced by the real
 * schema and the real serialiser and cannot be simulated. The assertions are
 * characterization, not aspiration: they record today's answer, so a change to
 * the paste pipeline shows up here as a diff instead of as a surprise in
 * someone's document. Where the answer is a loss it is pinned as a loss.
 *
 * Nothing here argues for changing the routing rule. Two of these losses are
 * the price of a rule that also rescues `BROWSER_CHAT_SELECTION_COPY`, whose
 * `text/plain` is stripped prose with no Markdown in it at all.
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

test('the HTML path keeps marks, links, nesting, the table and each fence language', async ({
  page,
}, testInfo) => {
  const html = await pasteAndSerialize(page, BROWSER_CHAT_RICH_ANSWER_COPY, RICH_MARKER)
  await testInfo.attach('html-path.md', { body: html, contentType: 'text/markdown' })

  // Marks and links survive the round trip intact.
  expect(html).toContain('**Python**')
  expect(html).toContain('*numerically unstable*')
  expect(html).toContain('`count`')
  expect(html).toContain('[original paper](https://example.test/welford)')

  // Headings keep their level.
  expect(html).toContain('## Welford')
  expect(html).toContain('### Steps')

  // An unordered list nested inside an ordered one keeps both its kinds and
  // its depth. (The bullet marker is the serialiser's `*`, not the source `-`,
  // on both paths — see the loss test below for what is a real difference.)
  expect(html).toMatch(/^1\. Seed the accumulators\./m)
  expect(html).toMatch(/^ {2,}\* `count` starts at zero$/m)
  expect(html).toMatch(/^ {2,}1\. update the count$/m)

  // The table arrives as a table, marks inside the cells included.
  expect(html).toMatch(/\|\s*\*Welford\*\s*\|\s*1\s*\|\s*\*\*yes\*\*\s*\|/)

  // The load-bearing one: `<pre><code class="language-x">` reaches the schema
  // as a fence that still names its language, so the block is highlightable
  // and a renderer can still claim it. A bare fence here would be silent.
  expect(html).toContain('```python')
  expect(html).toContain('```ts')
  expect(html).toContain('def welford(samples):')
  expect(html).toContain('xs.reduce((a, b) => a + b, 0)')
})

test('the HTML path loses the math and the task-list state the source would have kept', async ({
  page,
}, testInfo) => {
  const html = await pasteAndSerialize(page, BROWSER_CHAT_RICH_ANSWER_COPY, RICH_MARKER)
  const markdown = await pasteAndSerialize(
    page,
    sourceOnly(BROWSER_CHAT_RICH_ANSWER_COPY),
    RICH_MARKER,
  )
  await testInfo.attach('html-path.md', { body: html, contentType: 'text/markdown' })
  await testInfo.attach('markdown-path.md', { body: markdown, contentType: 'text/markdown' })

  // Math. KaTeX publishes three descriptions of one formula — a MathML branch,
  // the `\annotation` carrying the original TeX, and the visible glyph spans —
  // and the schema parse has a rule for none of them, so all three land as
  // text, concatenated. The `$$` block does not survive in any form.
  expect(html).not.toContain('$$')
  expect(html).not.toContain('$O(n \\log n)$')
  expect(html).toContain('O(nlogn)') // the glyph spans, flattened
  expect(html).toContain('O(n \\log n)') // ...and the TeX beside them, as prose
  expect(html).toContain('\\sqrt{\\frac{1}{N}') // the display formula, likewise

  // Worse than flattened: KaTeX draws a stretchy radical with an inline
  // `<svg>`, and §4.2's svg-in-place rule turns that glyph into an `svg` fence
  // in the middle of the sentence it came from.
  expect(html).toContain('```svg')
  // And a KaTeX spacing character becomes a paragraph of its own.
  expect(html.split('\n').some((line) => line.trim() === '​')).toBe(true)

  // The Markdown source would have kept every one of those as source.
  expect(markdown).toContain('$O(n \\log n)$')
  expect(markdown).toContain('$$')
  expect(markdown).toContain('\\sigma = \\sqrt{\\frac{1}{N}')
  expect(markdown).not.toContain('```svg')
  expect(markdown).not.toContain('O(nlogn)')

  // Task lists. `<input type="checkbox">` has no schema rule either, so the
  // items arrive as ordinary bullets and the checked/unchecked state is gone.
  expect(html).toContain('Handles streaming input')
  expect(html).not.toMatch(/\[[ x]\]/)
  expect(markdown).toContain('[x] Handles streaming input')
  expect(markdown).toContain('[ ] Handles removing a sample')
})

test('a rendered diagram lands as its picture, and the Mermaid source is gone', async ({
  page,
}, testInfo) => {
  const html = await pasteAndSerialize(page, BROWSER_CHAT_DIAGRAM_ANSWER_COPY, DIAGRAM_MARKER)
  const markdown = await pasteAndSerialize(
    page,
    sourceOnly(BROWSER_CHAT_DIAGRAM_ANSWER_COPY),
    DIAGRAM_MARKER,
  )
  await testInfo.attach('html-path.md', { body: html, contentType: 'text/markdown' })
  await testInfo.attach('markdown-path.md', { body: markdown, contentType: 'text/markdown' })

  // The prose around the diagram is fine on both paths.
  expect(html).toContain('The routing is **one** decision')
  expect(markdown).toContain('The routing is **one** decision')

  // The picture is kept, faithfully — that is what `svgToCodeFenceHtml` is for,
  // and it is the right answer for an `<svg>` with no source behind it.
  expect(html).toContain('```svg')
  expect(html).toContain('<svg')

  // But this `<svg>` did have source behind it, in the other flavour, and none
  // of it is in the document: not the fence, not the diagram language, not a
  // line of the four-line graph. The block is no longer editable as a diagram.
  expect(html).not.toContain('```mermaid')
  expect(html).not.toContain('flowchart TD')
  expect(html).not.toContain('A[Clipboard]')

  // The Markdown source would have landed as the fence it was.
  expect(markdown).toContain('```mermaid')
  expect(markdown).toContain('flowchart TD')
  expect(markdown).toContain('B -- yes --> C[HTML path]')

  // The size of the trade, in the bytes that reach the file: a laid-out SVG
  // with mermaid's theme stylesheet inlined, in place of four lines of source.
  expect(html.length).toBeGreaterThan(markdown.length * 30)
})
