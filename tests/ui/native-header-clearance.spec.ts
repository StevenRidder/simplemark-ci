import { expect, test } from '@playwright/test'

/**
 * Native shell only: macOS draws the real traffic-light cluster at a fixed
 * inset from the window's corner (docs/NATIVE-WORKSPACE.md), so whichever
 * pane header ends up physically leftmost needs left padding wide enough to
 * clear it. `data-shell` is set by tauri.ts and never by the browser demo
 * these tests load, so each test forces it directly — the thing under test
 * is CSS selector matching against layout state, not AppKit chrome itself.
 */

const run = (page: import('@playwright/test').Page, id: string): Promise<void> =>
  page.evaluate((command) => window.simplemark!.run(command as never), id)

const notesHeaderPaddingLeft = (page: import('@playwright/test').Page) =>
  page.locator('.notes-header').evaluate((el) => getComputedStyle(el).paddingLeft)

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.evaluate(() => {
    document.documentElement.dataset['shell'] = 'native'
  })
})

test('the notes header clears the traffic lights in the explicit Notes & Document layout', async ({ page }) => {
  await run(page, 'showNotesAndEditor')
  await expect(page.locator('.workspace-folders')).toBeHidden()
  expect(await notesHeaderPaddingLeft(page)).toBe('90px')
})

test('the notes header still clears the traffic lights when a narrow window collapses the folder rail on its own', async ({ page }) => {
  // 620-820px: the responsive breakpoint hides .workspace-folders by itself,
  // with no view command involved, so data-layout stays 'all' throughout.
  await page.setViewportSize({ width: 700, height: 760 })
  await expect(page.locator('.workspace-folders')).toBeHidden()
  expect(await notesHeaderPaddingLeft(page)).toBe('90px')
})
