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

test('a drag selection never mutates a spellcheck attribute', async ({ page }) => {
  // BUG-10: the head of a drag crosses every block, and marking the block
  // under it per selection change cost one synchronous AppleSpell round trip
  // per block crossed in the packaged shell. BUG-12 sharpened the fix from
  // "empty the set" to "freeze it": macOS word-selects under every
  // right-click, and emptying removed the attribute during AppKit's
  // synchronous menu tracking. The contract is therefore zero attribute
  // mutations while any range exists — frozen, not cleared.
  await page.goto('/?fixture=legacy')
  const editor = page.locator(EDITOR)
  const paragraphs = editor.locator('p')
  await expect(paragraphs.nth(1)).toBeVisible()

  // Place the caret first, so one block is legitimately opted in.
  await paragraphs.nth(0).click()
  await expect(paragraphs.nth(0)).toHaveAttribute('spellcheck', 'true')

  await page.evaluate(() => {
    const w = window as unknown as { __flips: number; __obs: MutationObserver }
    w.__flips = 0
    w.__obs = new MutationObserver((records) => {
      w.__flips += records.length
    })
    w.__obs.observe(document.querySelector('.milkdown .ProseMirror')!, {
      subtree: true,
      attributes: true,
      attributeFilter: ['spellcheck'],
    })
  })

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

  // The drag itself: zero mutations, in every engine. This is the BUG-10/12
  // contract — a range freezes the decoration, and frozen means untouched.
  const dragFlips = await page.evaluate(() => (window as unknown as { __flips: number }).__flips)
  expect(dragFlips).toBe(0)
  await expect(editor.locator('[spellcheck="true"]')).toHaveCount(1)

  // A word-select inside a block — what macOS does under a right-click. WebKit
  // delivers this as a momentary caret then the word range, so the caret's
  // ordinary block move may cost one remove+add; Chromium collapses it to
  // none. Bounded either way — the same price as clicking into a block, and
  // nothing like the per-block storm this spec exists to forbid.
  await page.mouse.dblclick(second.x + 30, second.y + 8)
  const totalFlips = await page.evaluate(() => {
    const w = window as unknown as { __flips: number; __obs: MutationObserver }
    w.__obs.disconnect()
    return w.__flips
  })
  expect(totalFlips - dragFlips).toBeLessThanOrEqual(2)

  // Collapsing to a caret in another block moves the opt-in there, once.
  await paragraphs.nth(1).click({ position: { x: 10, y: 4 } })
  await expect(paragraphs.nth(1)).toHaveAttribute('spellcheck', 'true')
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
