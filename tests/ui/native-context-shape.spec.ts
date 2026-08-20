import { expect, test } from '@playwright/test'

/**
 * BUG-11: the native chrome pre-arms the right-click Copy As menu from hover,
 * and computing that shape serialized the selection to Markdown on every
 * pointermove — quadratic during a drag, and a stall right as AppKit opened
 * the menu. Invisible to the web shell, which never runs the listener; the
 * `?chrome=macos` override exists so this path is testable at all.
 *
 * These assertions are counts, not timings (ADR-0009): the contract is that
 * mouse movement serializes nothing, ever.
 */

const editor = '.milkdown .ProseMirror'

test.beforeEach(async ({ page }) => {
  await page.goto('/?chrome=macos')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await page.evaluate(() => {
    const ed = window.simplemark!.editor as unknown as Record<string, unknown>
    const w = window as unknown as { __ser: number; __ctx: number }
    w.__ser = 0
    w.__ctx = 0
    const origSel = (ed['selectionMarkdown'] as () => string).bind(ed)
    ed['selectionMarkdown'] = () => {
      w.__ser += 1
      return origSel()
    }
    const origCtx = (ed['contextSelection'] as (t: Node | null) => unknown).bind(ed)
    ed['contextSelection'] = (t: Node | null) => {
      w.__ctx += 1
      return origCtx(t)
    }
  })
})

const counts = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __ser: number; __ctx: number }
    return { ser: w.__ser, ctx: w.__ctx }
  })

test('mouse movement never serializes — hovering, dragging, or selected', async ({ page }) => {
  const box = await page.locator(editor).boundingBox()
  if (!box) throw new Error('no editor box')

  // Hovering inside one block.
  await page.mouse.move(box.x + 60, box.y + 80)
  for (let i = 0; i < 60; i += 1) await page.mouse.move(box.x + 60 + (i % 20) * 4, box.y + 82)
  expect(await counts(page)).toEqual({ ser: 0, ctx: 0 })

  // A drag selection down the document. Every one of these moves used to
  // serialize the selection-so-far.
  await page.mouse.move(box.x + 40, box.y + 60)
  await page.mouse.down()
  for (let i = 1; i <= 40; i += 1) {
    await page.mouse.move(box.x + 60, box.y + 60 + i * 12, { steps: 2 })
  }
  await page.mouse.up()
  await expect
    .poll(() => page.evaluate(() => (window.getSelection()?.toString() ?? '').length))
    .toBeGreaterThan(0)
  expect(await counts(page)).toEqual({ ser: 0, ctx: 0 })

  // Travelling across blocks with that whole selection live — the post-drag
  // mouse movement that re-serialized the entire slice per move.
  for (let i = 0; i < 60; i += 1) await page.mouse.move(box.x + 200 + i * 3, box.y + 40 + i * 8)
  expect(await counts(page)).toEqual({ ser: 0, ctx: 0 })
})

test('a right-click captures its selection exactly once', async ({ page }) => {
  const box = await page.locator(editor).boundingBox()
  if (!box) throw new Error('no editor box')

  // Pointerdown and contextmenu both fire on a real right-click, and each used
  // to capture — two serializations of the block at the moment the menu opens.
  await page.mouse.click(box.x + 80, box.y + 100, { button: 'right' })
  expect(await counts(page)).toMatchObject({ ctx: 1 })

  // A menu invoked without a pointerdown (keyboard, synthetic) still captures:
  // the dedupe is per gesture, not a latch.
  await page.evaluate(() => {
    document.querySelector('.milkdown .ProseMirror p')?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
  })
  expect(await counts(page)).toMatchObject({ ctx: 2 })
})
