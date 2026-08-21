import { expect, test, type Page } from '@playwright/test'

/**
 * APP-42, SimpleMark Margins W1: on a wide surface, note cards sit in the
 * margin at their passage's height, crowding pushes down instead of
 * overlapping, and focus couples both ways. The stacked rail and the tint
 * popup remain the narrow layout's behavior.
 */

const editor = '.milkdown .ProseMirror'
const FIRST = 'Alpha holds the opening claim.'
const SECOND = 'Omega carries the closing point.'

async function twoNotes(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await page.getByRole('button', { name: 'New note' }).click()
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type(FIRST)
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press('Enter')
    await page.keyboard.type(`Filler paragraph ${i} keeps the passages far apart.`)
  }
  await page.keyboard.press('Enter')
  await page.keyboard.type(SECOND)
  await page.evaluate(() => window.simplemark!.flushPendingChanges())

  for (const [quote, note] of [[FIRST, 'first note'], [SECOND, 'second note']] as const) {
    await page.evaluate((q) => window.simplemark!.notes.selectTextForTest(q), quote)
    await page.keyboard.press('Meta+Shift+M')
    await page.keyboard.type(note)
    await page.keyboard.press('Enter')
  }
  await expect(page.locator('.sm-note-anchor')).toHaveCount(2)
}

test('cards sit at their passages, and never overlap when crowded', async ({ page }) => {
  await twoNotes(page)
  await expect(page.locator('.sm-note-rail-host')).toHaveAttribute('data-layout', 'margin')

  const tintBox = await page.locator('.sm-note-anchor').first().boundingBox()
  const card = page.locator('.sm-note-rail article[data-thread]').first()
  const cardBox = await card.boundingBox()
  if (tintBox === null || cardBox === null) throw new Error('missing boxes')
  expect(Math.abs(cardBox.y - tintBox.y)).toBeLessThan(60)

  const boxes = await page.locator('.sm-note-rail article[data-thread]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const b = (node as HTMLElement).getBoundingClientRect()
      return { top: b.top, bottom: b.bottom }
    }))
  const sorted = [...boxes].sort((a, b) => a.top - b.top)
  for (let i = 1; i < sorted.length; i += 1) {
    expect(sorted[i]!.top).toBeGreaterThanOrEqual(sorted[i - 1]!.bottom - 1)
  }
})

test('clicking a tint focuses its card; clicking a card lights its passage', async ({ page }) => {
  await twoNotes(page)
  await page.locator('.sm-note-anchor').first().click()
  await expect(page.locator('.sm-note-card-focused')).toHaveCount(1)
  await expect(page.locator('.sm-note-card-focused')).toContainText('first note')
  await expect(page.locator('.sm-note-anchor-focused')).toHaveCount(1)
  // No popup on a wide surface — the margin card IS the popup now.
  await expect(page.locator('.sm-note-stack')).toHaveCount(0)

  const second = page.locator('.sm-note-rail article[data-thread]').filter({ hasText: 'second note' })
  // Aim at the card's own chrome — its center is the reply composer, which
  // rightly keeps clicks to itself.
  await second.locator('.sm-note-rail-byline').first().click()
  await expect(page.locator('.sm-note-card-focused')).toContainText('second note')
})

test('a narrow surface keeps the stacked rail and the tint popup', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 800 })
  await twoNotes(page)
  await expect(page.locator('.sm-note-rail-host')).toHaveAttribute('data-layout', 'stack')
  await page.locator('.sm-note-anchor').first().click()
  await expect(page.locator('.sm-note-stack')).toBeVisible()
})

test('a long reply scrolls inside its card instead of growing past the viewport', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await page.evaluate(() => window.simplemark!.notes.selectTextForTest('This document is the demo.'))
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('price this out')
  await page.keyboard.press('Enter')

  // A reply the size of a real agent pricing answer.
  const long = Array.from({ length: 40 }, (_, i) => `- consideration ${i}: a line of pricing rationale`).join('\n')
  await page.evaluate((body) => {
    const row = document.querySelector('.sm-note-rail article textarea') as HTMLTextAreaElement
    row.value = body
    row.dispatchEvent(new Event('input', { bubbles: true }))
  }, long)
  await page.locator('.sm-note-rail [data-action="leave-note"]').click()
  await expect(page.locator('.sm-note-rail article')).toContainText('consideration 39')

  const card = page.locator('.sm-note-rail article[data-thread]').first()
  const sizes = await card.evaluate((node) => ({
    client: node.clientHeight,
    scroll: node.scrollHeight,
    viewport: window.innerHeight,
  }))
  // Clamped to the viewport, with the overflow reachable inside the card.
  expect(sizes.client).toBeLessThanOrEqual(Math.min(sizes.viewport * 0.62, 545))
  expect(sizes.scroll).toBeGreaterThan(sizes.client)
})
