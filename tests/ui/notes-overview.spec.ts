import { expect, test, type Page } from '@playwright/test'

/**
 * APP-43, SimpleMark Margins W3: the notes overview — every note on the
 * document with filters, search, and Jump to — and the keyboard walk between
 * passages. Opened deliberately; one side surface at a time.
 */

const editor = '.milkdown .ProseMirror'
const FIRST = 'Alpha holds the opening claim.'
const SECOND = 'Omega carries the closing point.'

async function twoNotes(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await page.getByRole('button', { name: 'New note' }).click()
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type(FIRST)
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press('Enter')
    await page.keyboard.type(`Filler paragraph ${i} keeps the passages apart.`)
  }
  await page.keyboard.press('Enter')
  await page.keyboard.type(SECOND)
  await page.evaluate(() => window.simplemark!.flushPendingChanges())
  for (const [quote, note] of [[FIRST, 'budget question'], [SECOND, 'closing tone']] as const) {
    await page.evaluate((q) => window.simplemark!.notes.selectTextForTest(q), quote)
    await page.keyboard.press('Meta+Shift+M')
    await page.keyboard.type(note)
    await page.keyboard.press('Enter')
  }
  await expect(page.locator('.sm-note-anchor')).toHaveCount(2)
}

test('the overview lists, filters and searches the document’s notes', async ({ page }) => {
  await twoNotes(page)
  await expect(page.locator('.sm-notes-overview')).toHaveCount(0)

  await page.evaluate(() => window.simplemark!.notes.toggleOverview())
  const panel = page.locator('.sm-notes-overview')
  await expect(panel).toBeVisible()
  await expect(panel.locator('.sm-overview-row')).toHaveCount(2)
  await expect(panel.locator('[data-filter="open"]')).toContainText('Open · 2')
  await expect(panel.locator('[data-filter="resolved"]')).toContainText('Resolved · 0')

  await panel.locator('.sm-overview-search').fill('closing')
  await expect(panel.locator('.sm-overview-row')).toHaveCount(1)
  await expect(panel.locator('.sm-overview-row')).toContainText('closing tone')

  // Resolve from the overview; it moves to the Resolved tab with a way back.
  await panel.locator('.sm-overview-search').fill('')
  await panel.locator('.sm-overview-row').filter({ hasText: 'budget question' }).locator('[data-action="resolve"]').click()
  await expect(panel.locator('[data-filter="resolved"]')).toContainText('Resolved · 1')
  await panel.locator('[data-filter="resolved"]').click()
  await expect(panel.locator('.sm-overview-row')).toContainText('budget question')
  await expect(panel.locator('.sm-overview-row [data-action="reopen"]')).toHaveCount(1)
})

test('Jump to lands on the passage and focuses its card; panels stay exclusive', async ({ page }) => {
  await twoNotes(page)
  await page.evaluate(() => window.simplemark!.agent.toggleActivity())
  await expect(page.locator('.sm-activity')).toHaveCount(1)

  await page.evaluate(() => window.simplemark!.notes.toggleOverview())
  await expect(page.locator('.sm-activity')).toHaveCount(0)
  const panel = page.locator('.sm-notes-overview')
  await panel.locator('.sm-overview-row').filter({ hasText: 'closing tone' }).locator('[data-action="jump-to"]').click()
  await expect(page.locator('.sm-note-card-focused')).toContainText('closing tone')
  await expect(page.locator('.sm-note-anchor-focused')).toHaveCount(1)
})

test('⌃⌘N and ⌃⌘P walk the passages in document order', async ({ page }) => {
  await twoNotes(page)
  await page.locator(editor).click()
  await page.keyboard.press('Control+Meta+n')
  await expect(page.locator('.sm-note-card-focused')).toContainText('budget question')
  await page.keyboard.press('Control+Meta+n')
  await expect(page.locator('.sm-note-card-focused')).toContainText('closing tone')
  await page.keyboard.press('Control+Meta+p')
  await expect(page.locator('.sm-note-card-focused')).toContainText('budget question')
})
