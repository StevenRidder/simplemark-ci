import { expect, test } from '@playwright/test'

/**
 * The whole promise in one test: a note taken on a passage is still on that
 * passage after a reload, and resolving it removes it for good.
 *
 * The welcome document repeats "SimpleMark". matchAnchor refuses a tie, so
 * the quote must occur once.
 */
const MATCHED_QUOTE = 'This document is the demo.'

test('a note survives a reload and can then be resolved', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator('.milkdown .ProseMirror')).toBeVisible()

  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), MATCHED_QUOTE)
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('does this survive?')
  await page.keyboard.press('Enter')
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)

  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
  await expect(page.locator('.sm-note-rail')).toContainText('does this survive?')

  await page.locator('.sm-note-rail [data-action="resolve"]').first().click()
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)

  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
  await expect(page.locator('.sm-note-rail')).toHaveCount(0)
})
