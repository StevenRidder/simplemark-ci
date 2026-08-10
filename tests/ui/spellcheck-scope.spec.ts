import { expect, test } from '@playwright/test'

const EDITOR = '.milkdown .ProseMirror'

test('continuous spellchecking is limited to the active prose block', async ({ page }) => {
  await page.goto('/?fixture=legacy')

  const editor = page.locator(EDITOR)
  const paragraphs = editor.locator('p')
  await expect(editor).toHaveAttribute('spellcheck', 'false')
  await expect(paragraphs.nth(1)).toBeVisible()

  await paragraphs.nth(0).click()
  await expect(paragraphs.nth(0)).toHaveAttribute('spellcheck', 'true')
  await expect(editor.locator('[spellcheck="true"]')).toHaveCount(1)

  await paragraphs.nth(1).click()
  await expect(paragraphs.nth(0)).not.toHaveAttribute('spellcheck')
  await expect(paragraphs.nth(1)).toHaveAttribute('spellcheck', 'true')
  await expect(editor.locator('[spellcheck="true"]')).toHaveCount(1)
})
