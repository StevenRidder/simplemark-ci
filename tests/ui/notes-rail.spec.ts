import { expect, test } from '@playwright/test'

/**
 * NOTES-8: the rail is absent until a note is unresolved.
 *
 * An unmatched open thread is an orphan: it keeps the original quote, tints
 * nowhere, and offers resolve / detach / reattach. Resolve removes the
 * decoration and writes nothing to the document (ADR-0007).
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
})

test('no open notes, no rail', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([]))
  await expect(page.locator('.sm-note-rail')).toHaveCount(0)
})

test('an unmatched note is listed as an orphan with its original quote', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'still relevant?',
      anchor: { quote: 'A SENTENCE THAT IS GONE', prefix: '', suffix: '', blockIndex: 0 },
      state: 'open' },
  ]))

  const rail = page.locator('.sm-note-rail')
  await expect(rail).toBeVisible()
  await expect(rail).toContainText('A SENTENCE THAT IS GONE')
  await expect(rail.locator('[data-orphan="true"]')).toHaveCount(1)
  // It must not be tinted anywhere in the document.
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
})

test('resolving removes the note from the rail and the document', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'done with this',
      anchor: { quote: 'This document is the demo', prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
  ]))
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)

  await page.locator('.sm-note-rail [data-action="resolve"]').first().click()

  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
  await expect(page.locator('.sm-note-rail')).toHaveCount(0)
})
