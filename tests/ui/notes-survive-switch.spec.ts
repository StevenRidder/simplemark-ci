import { expect, test } from '@playwright/test'

/**
 * BUG-15: a note taken on a passage is still tinted and still actionable
 * after switching to another note and back — the remount path people actually
 * use, distinct from the page reload notes-lifecycle already covers. Field
 * report was exactly this loss; the switch path must stay pinned.
 */
test('note tint and Ask agent survive switching away and back', async ({ page }) => {
  // Direct application is the mode these specs describe (ADR-0013 default is propose).
  await page.addInitScript(() => window.localStorage.setItem('simplemark.agent-connection', JSON.stringify({ editMode: 'direct' })))
  await page.goto('/?fixture=legacy')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator('.milkdown .ProseMirror')).toBeVisible()

  const names = await page.locator('.note-select').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? ''))
  const [first, second] = names
  await page.getByRole('button', { name: first!, exact: true }).click()
  await page.waitForTimeout(400)

  // A unique passage in whatever doc this is: type one, then note it.
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('A very unique probe passage.')
  await page.evaluate(() => window.simplemark!.flushPendingChanges())
  await page.evaluate(() => window.simplemark!.notes.selectTextForTest('A very unique probe passage.'))
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('act on this later')
  await page.keyboard.press('Enter')
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
  await expect(page.locator('.sm-note-rail [data-action="ask-agent"]')).toHaveCount(1)

  // Switch away and back — the remount path, the one people actually use.
  await page.getByRole('button', { name: second!, exact: true }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: first!, exact: true }).click()
  await page.waitForTimeout(1200)

  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
  await expect(page.locator('.sm-note-rail [data-action="ask-agent"]')).toHaveCount(1)
  await expect(page.locator('.sm-note-rail')).toContainText('act on this later')
})
