import { expect, test, type Page } from '@playwright/test'

/**
 * APP-48: a card folds to its opening lines. A huge agent reply used to run
 * down the column and bury the cards below; folded, the card keeps the first
 * two lines, says how much it holds back, and the cards below rise.
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
    return { top: r.top, height: r.height }
  }))

test('folding a card keeps its opening lines, counts the rest, and lets the next card rise', async ({ page }) => {
  await twoNotesLongReply(page)
  const [first, second] = await boxes(page)
  const card = page.locator(cards).first()
  await card.locator('[data-action="collapse-note"]').click()
  await expect(card).toHaveAttribute('data-collapsed', 'true')
  await expect(card.locator('.sm-note-rail-more')).toHaveText('1 more')
  await expect(card.locator('.sm-note-rail-body[data-turn="first"]')).toContainText('help me understand')
  await expect(card.locator('.sm-note-rail-body[data-turn="later"]')).toBeHidden()
  // Every control row in the card (the note's and the composer's) is hidden.
  await expect(card.locator('.sm-note-rail-actions').first()).toBeHidden()
  await expect(card.locator('.sm-note-rail-actions').last()).toBeHidden()
  await expect.poll(async () => (await boxes(page))[0]!.height).toBeLessThan(first!.height / 2)
  await expect.poll(async () => (await boxes(page))[1]!.top).toBeLessThan(second!.top)
  // The fold is not a jump: the document did not scroll to the passage.
  // Unfold restores everything.
  await card.locator('[data-action="collapse-note"]').click()
  await expect(card).toHaveAttribute('data-collapsed', 'false')
  await expect(card.locator('.sm-note-rail-more')).toHaveCount(0)
  await expect(card.locator('.sm-note-rail-body[data-turn="later"]')).toBeVisible()
  await expect.poll(async () => (await boxes(page))[0]!.height).toBeGreaterThan(first!.height - 2)
})

test('a fold survives a repaint while the document is open', async ({ page }) => {
  await twoNotesLongReply(page)
  const card = page.locator(cards).first()
  await card.locator('[data-action="collapse-note"]').click()
  await expect(card).toHaveAttribute('data-collapsed', 'true')
  await page.evaluate(() => window.simplemark!.notes.reload())
  await page.waitForTimeout(300)
  await expect(page.locator(cards).first()).toHaveAttribute('data-collapsed', 'true')
  await expect(page.locator(cards).first().locator('.sm-note-rail-more')).toHaveText('1 more')
})
