import { expect, test } from '@playwright/test'

/**
 * APP-44, SimpleMark Margins W6: the catalog row answers "does this document
 * still have open review work" before anyone opens it. Open notes win the
 * number; resolved-only says so; nothing at all reads as unannotated.
 */

const editor = '.milkdown .ProseMirror'
const QUOTE = 'This document is the demo.'

test('the active catalog row carries open and resolved note counts', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  const activeRow = page.locator('.note-item .note-select[aria-current="page"]')
  await expect(activeRow.locator('.note-notes-status')).toHaveCount(0)

  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), QUOTE)
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('still to decide')
  await page.keyboard.press('Enter')
  const mark = activeRow.locator('.note-notes-status')
  await expect(mark).toHaveCount(1)
  await expect(mark).toHaveAttribute('data-state', 'open')
  await expect(mark).toContainText('1')
  await expect(mark).toHaveAttribute('aria-label', '1 open note')

  await page.locator('.sm-note-rail [data-action="resolve"]').first().click()
  await expect(mark).toHaveAttribute('data-state', 'resolved')
  await expect(mark).toHaveAttribute('aria-label', '1 resolved note')

  await page.locator('.sm-note-rail-resolved summary').click()
  await page.locator('.sm-note-rail-resolved [data-action="delete-forever"]').first().click()
  await expect(activeRow.locator('.note-notes-status')).toHaveCount(0)
})
