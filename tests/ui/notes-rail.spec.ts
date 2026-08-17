import { expect, test } from '@playwright/test'

/**
 * NOTES-8 / NOTES-13: the rail is absent until a note is unresolved.
 *
 * An unmatched open thread is an orphan: it keeps the original quote, tints
 * nowhere, and offers Reattach / Keep as note / Delete. A matched open thread
 * offers Resolve. Resolve removes the decoration and writes nothing to the
 * document (ADR-0007). An in-session edit that destroys a match turns that
 * row into an orphan without waiting for a later close (NOTES-9).
 */

const MATCHED_QUOTE = 'This document is the demo'

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
  await expect(rail.locator('[data-action="reattach"]')).toHaveCount(1)
  await expect(rail.locator('[data-action="detach"]')).toHaveCount(1)
  await expect(rail.locator('[data-action="remove"]')).toHaveCount(1)
  await expect(rail.locator('[data-action="resolve"]')).toHaveCount(0)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
})

test('resolving removes the note from the rail and writes nothing', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'done with this',
      anchor: { quote, prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
  ]), MATCHED_QUOTE)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
  const before = await page.evaluate(() => window.simplemark!.editor.serialize())

  await page.locator('.sm-note-rail [data-action="resolve"]').first().click()

  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
  await expect(page.locator('.sm-note-rail')).toHaveCount(0)
  const after = await page.evaluate(() => window.simplemark!.editor.serialize())
  expect(after).toBe(before)
})

test('an edit that destroys a match turns the row into an orphan', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'still relevant?',
      anchor: { quote, prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
  ]), MATCHED_QUOTE)

  const rail = page.locator('.sm-note-rail')
  await expect(rail.locator('[data-orphan="false"]')).toHaveCount(1)
  await expect(rail.locator('[data-action="resolve"]')).toHaveCount(1)

  await page.locator('.milkdown .ProseMirror').getByText(MATCHED_QUOTE).click({ clickCount: 3 })
  await page.keyboard.type('gone')
  await page.evaluate(() => window.simplemark!.flushPendingChanges())

  await expect(rail.locator('[data-orphan="true"]')).toHaveCount(1)
  await expect(rail.locator('[data-action="reattach"]')).toHaveCount(1)
  await expect(rail.locator('[data-action="detach"]')).toHaveCount(1)
  await expect(rail.locator('[data-action="remove"]')).toHaveCount(1)
  await expect(rail.locator('[data-action="resolve"]')).toHaveCount(0)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
})
