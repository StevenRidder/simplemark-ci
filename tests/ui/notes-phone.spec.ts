import { expect, test } from '@playwright/test'

/**
 * On a phone, notes live in bottom sheets above the keyboard and every action
 * is a 44pt target. The composer sits above the keyboard, not under it.
 */
const QUOTE = 'This document is the demo.'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([]))
})

test('capture through the styles bar, see the rail as a bottom sheet, resolve', async ({ page }) => {
  // The styles bar is the keyboard accessory (Task 2): below 620px it stays
  // `display: none` until `.window.keyboard-open` is set, the same gate a
  // real on-screen keyboard trips via visualViewport. Headless Chromium never
  // shows a real keyboard, so the test sets the class itself.
  await page.evaluate(() => document.querySelector<HTMLElement>('.window')!.classList.add('keyboard-open'))
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), QUOTE)
  await page.locator('.styles-bar .styles-note').click()
  await page.keyboard.type('phone note')
  await page.keyboard.press('Enter')

  const rail = page.locator('.sm-note-rail')
  await expect(rail).toBeVisible()
  const railBox = await rail.boundingBox()
  expect(railBox!.x).toBeLessThan(2)
  expect(railBox!.x + railBox!.width).toBeGreaterThan(388)
  for (const button of await rail.locator('button').all()) {
    const box = await button.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }

  // The keyboard-accessory styles bar floats on the same edge the rail
  // docks to. With the keyboard open, both are visible at once, and the
  // rail must clear the bar's top edge rather than paint underneath it.
  const stylesBar = page.locator('.styles-bar')
  await expect(stylesBar).toBeVisible()
  const barBox = await stylesBar.boundingBox()
  expect(railBox!.y + railBox!.height).toBeLessThanOrEqual(barBox!.y)

  await rail.locator('[data-action="resolve"]').first().click()
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
})

test('the composer sits above the keyboard inset when the keyboard is open', async ({ page }) => {
  await page.evaluate(() => {
    const win = document.querySelector<HTMLElement>('.window')!
    win.classList.add('keyboard-open')
    win.style.setProperty('--keyboard-inset', '300px')
  })
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), QUOTE)
  await page.locator('.styles-bar .styles-note').click()
  const composer = page.locator('.sm-note-composer')
  await expect(composer).toHaveAttribute('data-placement', 'keyboard')
  const box = await composer.boundingBox()
  expect(box!.y + box!.height).toBeLessThanOrEqual(844 - 300 + 1)

  // Same overlap check as the rail: the composer sits on the keyboard's
  // edge too, and the accessory bar must not cover it.
  const stylesBar = page.locator('.styles-bar')
  await expect(stylesBar).toBeVisible()
  const barBox = await stylesBar.boundingBox()
  expect(box!.y + box!.height).toBeLessThanOrEqual(barBox!.y)
})

test('the stack opened from a tint click still docks as a bottom sheet', async ({ page }) => {
  // renderNoteStack (src/app/ui/note-rail.ts) sets inline top/left when it
  // opens from a tint click — that positions the desktop popover next to the
  // tap, and inline styles beat a stylesheet rule of equal specificity, so
  // the phone sheet rule needs !important here or the stack floats near the
  // tap point instead of spanning the bottom of the screen.
  await page.evaluate((quote) => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'only this note',
      anchor: { quote, prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
  ]), QUOTE)

  await page.locator('.sm-note-anchor').first().click()
  const stack = page.locator('.sm-note-stack')
  await expect(stack).toBeVisible()
  const box = await stack.boundingBox()
  expect(box!.x).toBeLessThan(2)
  expect(box!.x + box!.width).toBeGreaterThan(388)
})

test('notes.reload() picks up a thread written behind the composition', async ({ page }) => {
  await page.evaluate((quote) => {
    // The browser shell stores threads in localStorage under the document key.
    const key = Object.keys(localStorage).find((k) => k.startsWith('simplemark.threads.'))
    const noteKey = key === undefined ? 'fixture:welcome-to-simplemark.md' : key.slice('simplemark.threads.'.length)
    localStorage.setItem(`simplemark.threads.${noteKey}`, JSON.stringify([
      { id: 'external', noteKey, author: 'phone', createdAt: '', body: 'from another device',
        anchor: { quote, prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
    ]))
  }, QUOTE)
  await page.evaluate(() => window.simplemark!.notes.reload())
  await expect(page.locator('.sm-note-rail')).toContainText('from another device')
})
