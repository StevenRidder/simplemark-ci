import { expect, test } from '@playwright/test'

/**
 * Capture is layout and focus, so it is tested in a browser.
 *
 * The welcome document repeats the word "SimpleMark". matchAnchor refuses a
 * tie, so these threads use a quote that occurs once.
 */
const MATCHED_QUOTE = 'This document is the demo.'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator('.milkdown .ProseMirror')).toBeVisible()
})

test('capture needs a selection and says so when there is none', async ({ page }) => {
  await page.keyboard.press('Meta+Shift+M')
  await expect(page.locator('.sm-note-composer')).toHaveCount(0)
  await expect(page.getByText('Select the text this note is about')).toBeVisible()
})

test('selecting then pressing the key opens a focused composer on that passage', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), MATCHED_QUOTE)
  await page.keyboard.press('Meta+Shift+M')

  const composer = page.locator('.sm-note-composer')
  await expect(composer).toBeVisible()
  await expect(composer.locator('textarea')).toBeFocused()
  await expect(composer).toContainText(MATCHED_QUOTE)
})

test('Escape discards without creating a note', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), MATCHED_QUOTE)
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('this should vanish')
  await page.keyboard.press('Escape')

  await expect(page.locator('.sm-note-composer')).toHaveCount(0)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
})

test('closing an empty composer without Return removes the draft', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), MATCHED_QUOTE)
  await page.keyboard.press('Meta+Shift+M')
  await expect(page.locator('.sm-note-composer')).toBeVisible()
  await expect(page.locator('.sm-note-rail')).toBeVisible()

  await page.locator('.titlebar').click()

  await expect(page.locator('.sm-note-composer')).toHaveCount(0)
  await expect(page.locator('.sm-note-rail')).toHaveCount(0)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
})

test('Return saves and the passage tints immediately', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), MATCHED_QUOTE)
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('split by region?')
  await page.keyboard.press('Enter')

  await expect(page.locator('.sm-note-composer')).toHaveCount(0)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
})
