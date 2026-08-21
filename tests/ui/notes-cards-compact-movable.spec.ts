import { expect, test, type Page } from '@playwright/test'

/**
 * BUG-26. A margin card holding a long agent reply was clamped at 540px and
 * shoved the next card below the window; and no card could be moved. Cards
 * are compact now — long turns scroll inside — and every card accepts a
 * drag, leaves its column, and stays where the hand put it across repaints.
 */

const editor = '.milkdown .ProseMirror'
const cards = '.sm-note-rail article[data-thread]'

const LONG_REPLY = 'Here, I can help you edit the open Markdown note. For example, I can:\n\n' + [
  'Rewrite, clarify, shorten, or expand sections', 'Fix formatting, grammar, and structure',
  'Add headings, lists, tables, or summaries', 'Remove duplicated or unwanted content',
  'Turn rough notes into polished prose', 'Search for related notes in the adopted folder',
  'Find specific text across notes', 'Insert new content or replace existing content',
].map((line) => `- ${line}`).join('\n') + "\n\nI won't change anything unless you give me an editing instruction."

async function twoNotesLongReply(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1900, height: 900 })
  await page.addInitScript(() => window.localStorage.setItem('simplemark.agent-connection', JSON.stringify({ editMode: 'direct' })))
  await page.goto('/?fixture=legacy')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  const paragraphs = page.locator(`${editor} p`)
  const first = (await paragraphs.nth(0).innerText()).trim()
  const second = (await paragraphs.nth(1).innerText()).trim()
  expect(await page.evaluate((q) => window.simplemark!.notes.selectTextForTest(q), first)).toBe(true)
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('help me understand what we can do here')
  await page.keyboard.press('Enter')
  expect(await page.evaluate((q) => window.simplemark!.notes.selectTextForTest(q), second)).toBe(true)
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('yo')
  await page.keyboard.press('Enter')
  await expect(page.locator(cards)).toHaveCount(2)
  await page.evaluate((reply) => {
    window.simplemark!.agent.setProviderForTest({ async complete() { return { kind: 'text', text: reply } } })
  }, LONG_REPLY)
  await page.locator(cards).first().locator('[data-action="ask-agent"]').click()
  await expect(page.locator(cards).first()).toContainText('editing instruction')
  await page.waitForTimeout(300)
}

const boxes = (page: Page) =>
  page.locator(cards).evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, top: r.top, bottom: r.bottom, height: r.height, scrollHeight: el.scrollHeight }
  }))

test('a long reply stays inside a compact card, and the next card stays inside the window', async ({ page }) => {
  await twoNotesLongReply(page)
  const [first, second] = await boxes(page)
  expect(first!.height).toBeLessThanOrEqual(320)
  expect(first!.scrollHeight).toBeGreaterThan(first!.height) // it scrolls inside, nothing is hidden
  expect(second!.top).toBeGreaterThanOrEqual(first!.bottom)
  expect(second!.bottom).toBeLessThanOrEqual(900)
})

test('a card can be dragged aside, over the document, and stays there across a repaint', async ({ page }) => {
  await twoNotesLongReply(page)
  const [before, secondBefore] = await boxes(page)
  const grip = (await page.locator(cards).first().locator('.sm-drag-grip').boundingBox())!
  const gx = grip.x + grip.width / 2
  const gy = grip.y + grip.height / 2
  await page.mouse.move(gx, gy)
  await page.mouse.down()
  await page.mouse.move(gx - 200, gy + 20, { steps: 6 })
  await page.mouse.move(gx - 400, gy + 40, { steps: 6 })
  await page.mouse.up()
  await expect(page.locator(cards).first()).toHaveAttribute('data-moved', 'true')
  const [moved, secondNow] = await boxes(page)
  expect(moved!.x).toBeLessThan(before!.x - 300)
  // The card it was pushing rises to its own passage at once, not at the next repaint.
  await page.waitForTimeout(200)
  expect(secondNow!.top).toBeLessThanOrEqual(secondBefore!.top + 1)
  // The drag did not double as a click: the document did not jump.
  // A repaint (the store re-lists and paints) keeps the card where it was put.
  await page.evaluate(() => window.simplemark!.notes.reload())
  await page.waitForTimeout(400)
  const [after, secondAfter] = await boxes(page)
  expect(Math.abs(after!.x - moved!.x)).toBeLessThan(2)
  expect(Math.abs(after!.top - moved!.top)).toBeLessThan(2)
  // The other card is no longer pushed by the moved one: it can only rise.
  expect(secondAfter!.top).toBeLessThanOrEqual(secondBefore!.top + 1)
})
