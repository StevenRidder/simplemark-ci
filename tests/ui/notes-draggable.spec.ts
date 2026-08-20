import { expect, test, type Page } from '@playwright/test'

/**
 * Every popup over the document is movable: the composer you write a note in
 * and the stack that opens on a noted passage both follow the pointer from
 * their grip, and neither can be dragged out of reach.
 */

const editor = '.milkdown .ProseMirror'
const QUOTE = 'This document is the demo.'

async function box(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const b = await page.locator(selector).boundingBox()
  if (b === null) throw new Error(`${selector} has no box`)
  return { x: b.x, y: b.y }
}

async function drag(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const grip = await box(page, `${selector} .sm-drag-grip`)
  await page.mouse.move(grip.x + 20, grip.y + 5)
  await page.mouse.down()
  await page.mouse.move(grip.x + 20 + dx, grip.y + 5 + dy, { steps: 4 })
  await page.mouse.up()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
})

test('the note composer follows a drag and still takes the note', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), QUOTE)
  await page.keyboard.press('Meta+Shift+M')
  await expect(page.locator('.sm-note-composer')).toBeVisible()

  const before = await box(page, '.sm-note-composer')
  await drag(page, '.sm-note-composer', 140, 90)
  const after = await box(page, '.sm-note-composer')
  expect(Math.abs(after.x - before.x - 140)).toBeLessThanOrEqual(2)
  expect(Math.abs(after.y - before.y - 90)).toBeLessThanOrEqual(2)

  // Moving it must not cost the composer its job.
  await page.locator('.sm-note-composer textarea').click()
  await page.keyboard.type('still works here')
  await page.keyboard.press('Enter')
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
  await expect(page.locator('.sm-note-rail')).toContainText('still works here')
})

test('a drag cannot lose the composer outside the document surface', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), QUOTE)
  await page.keyboard.press('Meta+Shift+M')
  await expect(page.locator('.sm-note-composer')).toBeVisible()

  await drag(page, '.sm-note-composer', 5000, 5000)
  const surface = await page.locator('.document-surface').boundingBox()
  const panel = await box(page, '.sm-note-composer')
  if (surface === null) throw new Error('no document surface')
  expect(panel.x).toBeLessThan(surface.x + surface.width)
  expect(panel.y).toBeLessThan(surface.y + surface.height)
})

test('the note stack on a passage follows a drag', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), QUOTE)
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('a note to reopen')
  await page.keyboard.press('Enter')
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)

  await page.locator('.sm-note-anchor').first().click()
  await expect(page.locator('.sm-note-stack')).toBeVisible()

  const before = await box(page, '.sm-note-stack')
  await drag(page, '.sm-note-stack', 90, 60)
  const after = await box(page, '.sm-note-stack')
  expect(Math.abs(after.x - before.x - 90)).toBeLessThanOrEqual(2)
  expect(Math.abs(after.y - before.y - 60)).toBeLessThanOrEqual(2)
})
