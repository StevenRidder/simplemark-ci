import { expect, test } from '@playwright/test'

/**
 * NOTES-8 / NOTES-13: the rail is absent until a note is unresolved.
 *
 * An unmatched open thread is an orphan: it keeps the original quote, tints
 * nowhere, and offers Reattach / Keep as note / Delete. A matched open thread
 * offers Resolve. Resolve removes the decoration and writes nothing to the
 * document (ADR-0007). Deleting the mapped passage drops the decoration and
 * turns that row into an orphan. Rewording the passage updates the quote
 * (NOTES-9) instead of orphaning it.
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

test('resolving moves the note to the resolved history and writes nothing', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'done with this',
      anchor: { quote, prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
  ]), MATCHED_QUOTE)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
  const before = await page.evaluate(() => window.simplemark!.editor.serialize())

  await page.locator('.sm-note-rail [data-action="resolve"]').first().click()

  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
  // Not gone — resolved notes keep a way back (the reported data-loss was
  // exactly a Resolve with no Reopen). The open-note rows are gone; the
  // resolved history remains.
  await expect(page.locator('.sm-note-rail article')).toHaveCount(0)
  await expect(page.locator('.sm-note-rail-resolved')).toContainText('1 resolved note')
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
  await page.keyboard.press('Backspace')
  await page.evaluate(() => window.simplemark!.flushPendingChanges())

  await expect(rail.locator('[data-orphan="true"]')).toHaveCount(1)
  await expect(rail.locator('[data-action="reattach"]')).toHaveCount(1)
  await expect(rail.locator('[data-action="detach"]')).toHaveCount(1)
  await expect(rail.locator('[data-action="remove"]')).toHaveCount(1)
  await expect(rail.locator('[data-action="resolve"]')).toHaveCount(0)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
})

test('reattach waits for the next selection and binds the note there', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'still relevant?',
      anchor: { quote: 'A SENTENCE THAT IS GONE', prefix: '', suffix: '', blockIndex: 0 },
      state: 'open' },
  ]))

  const row = page.locator('.sm-note-rail [data-thread="t1"]')
  await row.locator('[data-action="reattach"]').click()
  await expect(row).toHaveAttribute('data-waiting', 'true')
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)

  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), MATCHED_QUOTE)

  await expect(row).toHaveAttribute('data-orphan', 'false')
  await expect(row).toHaveAttribute('data-waiting', 'false')
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
  await expect(page.locator('.sm-note-anchor').first()).toContainText(MATCHED_QUOTE)
})

test('Escape cancels reattach and leaves the note orphaned', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'still relevant?',
      anchor: { quote: 'A SENTENCE THAT IS GONE', prefix: '', suffix: '', blockIndex: 0 },
      state: 'open' },
  ]))

  const row = page.locator('.sm-note-rail [data-thread="t1"]')
  await row.locator('[data-action="reattach"]').click()
  await expect(row).toHaveAttribute('data-waiting', 'true')

  await page.keyboard.press('Escape')

  await expect(row).toHaveAttribute('data-waiting', 'false')
  await expect(row).toHaveAttribute('data-orphan', 'true')
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
})

test('clicking a stacked tint opens every note on that passage', async ({ page }) => {
  // The tint popup is the narrow layout's surface; wide surfaces focus the
  // margin card instead (APP-42).
  await page.setViewportSize({ width: 720, height: 800 })
  await page.evaluate((quote) => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'first stacked note',
      anchor: { quote, prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
    { id: 't2', noteKey: 'n', author: 'local', createdAt: '', body: 'second stacked note',
      anchor: { quote, prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
  ]), MATCHED_QUOTE)

  await page.locator('.sm-note-anchor').first().click()

  const stack = page.locator('.sm-note-stack')
  await expect(stack).toBeVisible()
  await expect(stack.locator('[data-thread]')).toHaveCount(2)
  await expect(stack).toContainText('first stacked note')
  await expect(stack).toContainText('second stacked note')
})

test('clicking a single tint shows that note', async ({ page }) => {
  // The tint popup is the narrow layout's surface; wide surfaces focus the
  // margin card instead (APP-42).
  await page.setViewportSize({ width: 720, height: 800 })
  await page.evaluate((quote) => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'only this note',
      anchor: { quote, prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
  ]), MATCHED_QUOTE)

  await page.locator('.sm-note-anchor').first().click()

  const stack = page.locator('.sm-note-stack')
  await expect(stack).toBeVisible()
  await expect(stack.locator('[data-thread]')).toHaveCount(1)
  await expect(stack).toContainText('only this note')
})
