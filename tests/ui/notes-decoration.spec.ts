import { expect, test } from '@playwright/test'

/**
 * Decoration behaviour is layout, so it is tested in a browser.
 *
 * In Node every element measures zero and every DecorationSet is invisible,
 * which is exactly how two diagram defects survived a green suite on
 * 2026-08-05.
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

test('a matched anchor tints its passage, an unmatched one tints nothing', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'a',
      anchor: { quote, prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
    { id: 't2', noteKey: 'n', author: 'local', createdAt: '', body: 'b',
      anchor: { quote: 'NOT IN THIS DOCUMENT', prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
  ]), MATCHED_QUOTE)

  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
  await expect(page.locator('.sm-note-anchor').first()).toContainText(MATCHED_QUOTE)
})

test('two notes on one passage tint once and count', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'a',
      anchor: { quote, prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
    { id: 't2', noteKey: 'n', author: 'local', createdAt: '', body: 'b',
      anchor: { quote, prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
  ]), MATCHED_QUOTE)

  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
  await expect(page.locator('.sm-note-anchor').first()).toHaveAttribute('data-count', '2')
})

test('a resolved note tints nothing', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'a',
      anchor: { quote, prefix: '', suffix: '', blockIndex: 0 }, state: 'resolved' },
  ]), MATCHED_QUOTE)

  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
})

test('setThreadsForTest notifies onThreadsForTest when that hook exists', async ({ page }) => {
  const received = await page.evaluate((quote) => {
    let count = 0
    window.simplemark!.notes.onThreadsForTest = (threads) => {
      count = threads.length
    }
    window.simplemark!.notes.setThreadsForTest([
      { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'a',
        anchor: { quote, prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
    ])
    return count
  }, MATCHED_QUOTE)

  expect(received).toBe(1)
})
