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

test('a drag selection opts no block into spellchecking', async ({ page }) => {
  // BUG-10: the head of a drag crosses every block on its way, and marking the
  // block under it per selection change cost one synchronous AppleSpell round
  // trip per block crossed in the packaged shell. A range selection is not
  // typing, so while one exists nothing opts in.
  await page.goto('/?fixture=legacy')
  const editor = page.locator(EDITOR)
  const paragraphs = editor.locator('p')
  await expect(paragraphs.nth(1)).toBeVisible()

  const first = await paragraphs.nth(0).boundingBox()
  const second = await paragraphs.nth(1).boundingBox()
  if (!first || !second) throw new Error('paragraphs not laid out')

  await page.mouse.move(first.x + 8, first.y + 8)
  await page.mouse.down()
  await page.mouse.move(second.x + second.width - 8, second.y + second.height - 4, { steps: 12 })
  await page.mouse.up()

  await expect
    .poll(() => page.evaluate(() => (window.getSelection()?.toString() ?? '').length))
    .toBeGreaterThan(0)
  await expect(editor.locator('[spellcheck="true"]')).toHaveCount(0)

  // Collapsing back to a caret restores the single opted-in block.
  await paragraphs.nth(1).click()
  await expect(editor.locator('[spellcheck="true"]')).toHaveCount(1)
})

test('typing inside one block never re-announces its spellcheck attribute', async ({ page }) => {
  await page.goto('/?fixture=legacy')
  const editor = page.locator(EDITOR)
  const paragraphs = editor.locator('p')
  await paragraphs.nth(0).click()
  await expect(paragraphs.nth(0)).toHaveAttribute('spellcheck', 'true')

  // Recreating the decoration per keystroke flipped the attribute off and on,
  // and each on is an AppleSpell check in the packaged shell. Watch the
  // attribute itself: a stable decoration produces zero mutations.
  await page.evaluate(() => {
    const w = window as unknown as { __spellFlips: number; __spellObserver: MutationObserver }
    w.__spellFlips = 0
    w.__spellObserver = new MutationObserver((records) => {
      w.__spellFlips += records.length
    })
    w.__spellObserver.observe(document.querySelector('.milkdown .ProseMirror')!, {
      subtree: true,
      attributes: true,
      attributeFilter: ['spellcheck'],
    })
  })
  await page.keyboard.type('steady as she goes')
  await page.evaluate(() => window.simplemark!.flushPendingChanges())
  const flips = await page.evaluate(() => {
    const w = window as unknown as { __spellFlips: number; __spellObserver: MutationObserver }
    w.__spellObserver.disconnect()
    return w.__spellFlips
  })
  expect(flips).toBe(0)
  await expect(editor.locator('[spellcheck="true"]')).toHaveCount(1)
})
