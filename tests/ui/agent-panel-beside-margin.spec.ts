import { expect, test, type Page } from '@playwright/test'

/**
 * BUG-25. The agent panel and the notes share the document's right edge. The
 * panel used to land on top of the margin cards — a person with two annotated
 * passages and the conversation open saw no cards at all — and the document
 * was padded for both surfaces at once. Docked, the panel takes the outer
 * strip and the notes sit between the document and it; moved by hand, it is a
 * floating window and the column comes back. It also never runs past the
 * window, whatever its containing block measures.
 */

const editor = '.milkdown .ProseMirror'
const card = '.sm-note-rail article[data-thread]'

async function openWithNote(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height })
  await page.goto('/?fixture=legacy')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  const quote = (await page.locator(`${editor} p`).first().innerText()).trim()
  expect(await page.evaluate((q) => window.simplemark!.notes.selectTextForTest(q), quote)).toBe(true)
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('a note to keep visible')
  await page.keyboard.press('Enter')
  await expect(page.locator(card)).toHaveCount(1)
}

/** What the pointer would hit at the card's top-centre: the card, or whatever covers it. */
const hitOnCard = (page: Page): Promise<string> =>
  page.evaluate((selector) => {
    const el = document.querySelector(selector) as HTMLElement | null
    if (el === null) return 'no-card'
    const r = el.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + 8)
    if (top === null) return 'nothing'
    return el.contains(top) ? 'card' : (top.closest('.sm-agent-panel') !== null ? 'agent-panel' : top.className)
  }, card)

const openPanel = async (page: Page): Promise<void> => {
  await page.evaluate(() => window.simplemark!.agent.toggle())
  await expect(page.locator('.sm-agent-panel')).toBeVisible()
  await page.waitForTimeout(250)
}

test('docked beside a margin card, never on top of it, with a readable column', async ({ page }) => {
  await openWithNote(page, 1700, 1000)
  await expect(page.locator('.document-surface')).toHaveAttribute('data-notes-margin', 'true')
  await openPanel(page)

  expect(await hitOnCard(page)).toBe('card')
  const cardBox = (await page.locator(card).boundingBox())!
  const panelBox = (await page.locator('.sm-agent-panel').boundingBox())!
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(panelBox.x + 1)
  // Still beside its passage, not stacked at the column's origin.
  const tint = (await page.locator('.sm-note-anchor').first().boundingBox())!
  expect(Math.abs(cardBox.y - tint.y)).toBeLessThan(40)
  // The document keeps the larger surface (ADR-0012 §3): with the margin and
  // the panel both docked, the reading column is still wider than the panel —
  // which it was not while the panel's strip was yielded twice.
  const column = await page.locator('.document-surface .editor:not(.ProseMirror)').evaluate((el) => el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) - parseFloat(getComputedStyle(el).paddingRight))
  expect(column).toBeGreaterThan(panelBox.width)
  // And the panel ends inside the window.
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(1000 - 8 + 1)
})

test('when the room is gone the notes stack in the rail, still beside the panel, not under it', async ({ page }) => {
  await openWithNote(page, 1200, 900)
  await openPanel(page)
  await expect(page.locator('.document-surface')).toHaveAttribute('data-notes-margin', 'false')
  expect(await hitOnCard(page)).toBe('card')
  const rail = (await page.locator('.sm-note-rail').boundingBox())!
  const panelBox = (await page.locator('.sm-agent-panel').boundingBox())!
  expect(rail.x + rail.width).toBeLessThanOrEqual(panelBox.x + 1)
})

test('the panel can be moved, and a moved panel gives the column back', async ({ page }) => {
  await openWithNote(page, 1700, 1000)
  await openPanel(page)
  const before = (await page.locator('.sm-agent-panel').boundingBox())!
  const paddingDocked = await page.locator('.document-surface .editor:not(.ProseMirror)').evaluate((el) => getComputedStyle(el).paddingRight)

  const grip = (await page.locator('.sm-agent-panel .sm-drag-grip').boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2 - 150, grip.y + grip.height / 2 + 60, { steps: 8 })
  await page.mouse.move(grip.x + grip.width / 2 - 300, grip.y + grip.height / 2 + 120, { steps: 8 })
  await page.mouse.up()

  await expect(page.locator('.sm-agent-panel')).toHaveAttribute('data-moved', 'true')
  const after = (await page.locator('.sm-agent-panel').boundingBox())!
  expect(after.x).toBeLessThan(before.x - 200)
  expect(after.y).toBeGreaterThan(before.y + 80)
  // A floating panel no longer takes the strip: the column returns.
  const paddingMoved = await page.locator('.document-surface .editor:not(.ProseMirror)').evaluate((el) => getComputedStyle(el).paddingRight)
  expect(parseFloat(paddingMoved)).toBeLessThan(parseFloat(paddingDocked))
  // Typing in the composer still types; a drag never starts there.
  await page.locator('.sm-agent-panel textarea').first().click()
  await page.keyboard.type('still a textarea')
  await expect(page.locator('.sm-agent-panel textarea').first()).toHaveValue(/still a textarea/)
})
