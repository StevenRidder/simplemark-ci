import { expect, test, type Page } from '@playwright/test'

/**
 * APP-53: a card and the agent panel can be sized by hand from a corner
 * handle. A card's new size holds through repaints while the document is
 * open and the cards below follow; a moved panel sizes freely.
 */

const editor = '.milkdown .ProseMirror'
const cards = '.sm-note-rail article[data-thread]'

async function twoNotes(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1900, height: 1000 })
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
  await page.keyboard.type('first note')
  await page.keyboard.press('Enter')
  expect(await page.evaluate((q) => window.simplemark!.notes.selectTextForTest(q), second)).toBe(true)
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('second note')
  await page.keyboard.press('Enter')
  await expect(page.locator(cards)).toHaveCount(2)
  await page.waitForTimeout(250)
}

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!

/** Drags a CSS resize handle: the bottom-right corner of the element. */
async function dragCorner(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const b = await box(page, selector)
  const x = b.x + b.width - 5
  const y = b.y + b.height - 5
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 6 })
  await page.mouse.move(x + dx, y + dy, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(250)
}

test('a card grows from its corner, keeps the size across a repaint, and the card below follows', async ({ page }) => {
  await twoNotes(page)
  const before = await box(page, cards)
  const secondBefore = (await page.locator(cards).nth(1).boundingBox())!
  await dragCorner(page, cards, 60, 140)
  await expect(page.locator(cards).first()).toHaveAttribute('data-resized', 'true')
  const after = await box(page, cards)
  expect(after.height).toBeGreaterThan(before.height + 100)
  expect(after.width).toBeGreaterThan(before.width + 40)
  const secondAfter = (await page.locator(cards).nth(1).boundingBox())!
  expect(secondAfter.y).toBeGreaterThanOrEqual(after.y + after.height)
  expect(secondAfter.y).toBeGreaterThan(secondBefore.y)
  // Survives a repaint while the document is open.
  await page.evaluate(() => window.simplemark!.notes.reload())
  await page.waitForTimeout(300)
  const again = await box(page, cards)
  expect(Math.abs(again.height - after.height)).toBeLessThan(2)
  expect(Math.abs(again.width - after.width)).toBeLessThan(2)
})

test('a moved panel can be sized from its corner', async ({ page }) => {
  await twoNotes(page)
  await page.evaluate(() => window.simplemark!.agent.toggle())
  await expect(page.locator('.sm-agent-panel')).toBeVisible()
  const grip = (await page.locator('.sm-agent-panel .sm-drag-grip').boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x - 400, grip.y + 60, { steps: 8 })
  await page.mouse.move(grip.x - 700, grip.y + 120, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('.sm-agent-panel')).toHaveAttribute('data-moved', 'true')
  const before = await box(page, '.sm-agent-panel')
  await dragCorner(page, '.sm-agent-panel', 120, -80)
  const after = await box(page, '.sm-agent-panel')
  expect(after.width).toBeGreaterThan(before.width + 80)
  expect(after.height).toBeLessThan(before.height - 40)
  await expect(page.locator('.sm-agent-panel')).toHaveAttribute('data-resized', 'true')
})
