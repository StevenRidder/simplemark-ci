import { expect, test } from '@playwright/test'

/**
 * Add Note has a button on the styles bar, the one command surface a phone
 * keyboard offers. It is enabled only with a selection and opens the same
 * composer as ⌘⇧M.
 */
const QUOTE = 'This document is the demo.'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([]))
})

test('the styles bar offers Add Note, disabled until something is selected', async ({ page }) => {
  const button = page.locator('.styles-bar .styles-note')
  await expect(button).toHaveCount(1)
  await expect(button).toHaveAttribute('aria-label', 'Add Note')
  await page.locator('.milkdown .ProseMirror').click()
  await page.keyboard.press('End')
  await expect(button).toBeDisabled()
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), QUOTE)
  await expect(button).toBeEnabled()
})

test('tapping Add Note opens the composer on the selection and saves a note', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), QUOTE)
  await page.locator('.styles-bar .styles-note').click()
  await expect(page.locator('.sm-note-composer textarea')).toBeFocused()
  await page.keyboard.type('from the styles bar')
  await page.keyboard.press('Enter')
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
  await expect(page.locator('.sm-note-rail')).toContainText('from the styles bar')
})

test('the More menu carries Add Note too', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), QUOTE)
  await page.locator('.styles-bar .styles-menu-trigger[aria-label="More"]').click()
  await expect(page.locator('.styles-bar .styles-overflow-menu-item', { hasText: 'Add Note' })).toBeVisible()
})

/**
 * A touch handle drag (long-press-to-select on iOS) changes the *DOM*
 * selection, not ProseMirror's transaction stream. `selectTextForTest`
 * above dispatches a PM transaction directly and so never exercised the
 * path a real touch selection takes: DOMObserver folding a browser
 * `selectionchange` into `view.state` on a deferred flush. Setting the
 * selection through `document.getSelection()`, as the OS touch handles do,
 * is what actually exercises that path.
 */
test('Add Note enables from a DOM-originated selection, not just a PM one', async ({ page }) => {
  await page.locator('.milkdown .ProseMirror').click()
  await page.evaluate((quote) => {
    const walker = document.createTreeWalker(document.querySelector('.milkdown .ProseMirror')!, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const index = node.textContent!.indexOf(quote)
      if (index >= 0) {
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + quote.length)
        const selection = getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
        return
      }
    }
    throw new Error('quote not found')
  }, 'This document is the demo')
  await expect(page.locator('.styles-bar .styles-note')).toBeEnabled()
})

/**
 * The pill is a fixed width sized for its children. Add Note is a new direct
 * child ahead of the trailing "Aa" format trigger, and a too-narrow pill
 * would let that trigger poke past the pill's own border — invisible to the
 * per-button geometry assertion in styles-bar.spec.ts, which checks each
 * button's own rect but never the row against the pill.
 */
test('the trailing format trigger fits inside the pill, at the desktop viewport styles-bar.spec.ts uses', async ({ page }) => {
  const bar = page.locator('.styles-bar')
  const overflow = await bar.evaluate((element) => {
    const barRight = element.getBoundingClientRect().right
    const last = element.querySelector<HTMLElement>('.styles-reader-settings-trigger')!
    return {
      lastRight: last.getBoundingClientRect().right,
      barRight,
    }
  })
  expect(overflow.lastRight).toBeLessThanOrEqual(overflow.barRight)
})
