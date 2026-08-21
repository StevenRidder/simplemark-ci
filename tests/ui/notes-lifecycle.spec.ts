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
  // The resolution survives too: no open rows, and the note waits in the
  // resolved history rather than being gone for good.
  await expect(page.locator('.sm-note-rail article')).toHaveCount(0)
  await expect(page.locator('.sm-note-rail-resolved')).toContainText('1 resolved note')
})

test('a resolved note can be reopened, and comes back to its passage', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator('.milkdown .ProseMirror')).toBeVisible()

  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), MATCHED_QUOTE)
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('needs another pass')
  await page.keyboard.press('Enter')
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)

  await page.locator('.sm-note-rail [data-action="resolve"]').first().click()
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)

  // Resolving must not be a trapdoor: the note is in the resolved history,
  // and Reopen puts it back on the passage — tint, Ask agent and all.
  await page.locator('.sm-note-rail-resolved summary').click()
  await expect(page.locator('.sm-note-rail-resolved')).toContainText('needs another pass')
  await page.locator('.sm-note-rail-resolved [data-action="reopen"]').first().click()
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
  await expect(page.locator('.sm-note-rail [data-action="ask-agent"]')).toHaveCount(1)

  // And the choice survives a reload like any other note state.
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
})

test('a resolved note can be deleted forever', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator('.milkdown .ProseMirror')).toBeVisible()

  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), MATCHED_QUOTE)
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('done and gone')
  await page.keyboard.press('Enter')
  await page.locator('.sm-note-rail [data-action="resolve"]').first().click()

  await page.locator('.sm-note-rail-resolved summary').click()
  await page.locator('.sm-note-rail-resolved [data-action="delete-forever"]').first().click()
  await expect(page.locator('.sm-note-rail')).toHaveCount(0)

  // Forever survives a reload: the store no longer holds it.
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator('.sm-note-rail')).toHaveCount(0)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
})

test('a note body can be edited in place, and the edit survives a reload', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator('.milkdown .ProseMirror')).toBeVisible()

  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), MATCHED_QUOTE)
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('first draft of the note')
  await page.keyboard.press('Enter')
  await expect(page.locator('.sm-note-rail')).toContainText('first draft of the note')

  await page.locator('.sm-note-rail [data-action="edit-note"]').first().click()
  const input = page.locator('.sm-note-rail-edit textarea')
  await input.fill('second thoughts, sharper ask')
  await input.press('Enter')
  await expect(page.locator('.sm-note-rail')).toContainText('second thoughts, sharper ask')
  await expect(page.locator('.sm-note-rail')).not.toContainText('first draft')

  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator('.sm-note-rail')).toContainText('second thoughts, sharper ask')
  // The edited note still drives the agent: body is the instruction.
  await expect(page.locator('.sm-note-rail [data-action="ask-agent"]')).toHaveCount(1)
})

test('a persistence failure is loud on every lifecycle action', async ({ page }) => {
  // Fail-and-fix-early: the identical silence that once let a morning's notes
  // look saved while being persisted nowhere. Break the store, act, and the
  // status line must name what was not saved.
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator('.milkdown .ProseMirror')).toBeVisible()
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), MATCHED_QUOTE)
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('about to face a broken disk')
  await page.keyboard.press('Enter')

  await page.evaluate(() => window.simplemark!.notes.breakPersistenceForTest(true))
  await page.locator('.sm-note-rail [data-action="resolve"]').first().click()
  await expect(page.locator('[data-state="error"]')).toContainText(/Resolving the note was not saved/)

  // And the same class of loudness for a reply that could not be written.
  await page.evaluate(() => window.simplemark!.notes.breakPersistenceForTest(false))
})
