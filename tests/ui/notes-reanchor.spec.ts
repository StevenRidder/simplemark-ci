import { expect, test } from '@playwright/test'

/**
 * NOTES-9: re-derive anchors from the live decoration after an in-app edit
 * (spec §5.3). Persist on close is NOTES-10; this file proves the derivation.
 *
 * The welcome document repeats "SimpleMark", so the quote is a sentence that
 * occurs once — the same reason notes-decoration.spec.ts avoids that word.
 */
const QUOTE = 'This document is the demo.'
const REWORDED = 'This document is the demo now.'

test('rewording the anchored sentence updates the anchor instead of orphaning it', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)

  await page.evaluate((quote) => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'q',
      anchor: { quote, prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
  ]), QUOTE)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)

  await page.evaluate(({ from, to }) => {
    window.simplemark!.notes.replaceTextForTest(from, to)
  }, { from: QUOTE, to: REWORDED })
  await page.evaluate(() => window.simplemark!.flushPendingChanges())

  const anchors = await page.evaluate(() => window.simplemark!.notes.currentAnchorsForTest())
  expect(anchors['t1']?.quote).toBe(REWORDED)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
  await expect(page.locator('.sm-note-rail [data-orphan="true"]')).toHaveCount(0)
})
