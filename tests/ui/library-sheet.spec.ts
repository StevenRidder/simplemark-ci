import { expect, test } from '@playwright/test'

/**
 * The Library on a phone.
 *
 * Below 820px the Library column is `display: none`, which left every folder
 * on disk unreachable on a phone — the workspace still knew about them, and
 * there was no way to say which one you wanted. The list title now carries
 * them, in a sheet, alongside the sort and preview options it already owned.
 *
 * What these tests actually guard is the lending: the sheet shows the *same*
 * `.library-rows` node the column shows, moved for the duration and moved
 * back. A second, copied folder list would pass a screenshot and then drift —
 * different counts, a different row marked selected — so "there is exactly
 * one of these, and it goes home afterwards" is the property worth pinning.
 */

const PHONE = { width: 402, height: 800 }
const DESKTOP = { width: 1280, height: 860 }

const title = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Note list options' })

const menu = (page: import('@playwright/test').Page) => page.locator('.notes-menu')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
})

test('a phone reaches the Library through the list title', async ({ page }) => {
  await page.setViewportSize(PHONE)

  // The column itself is gone at this width — that is the whole problem.
  await expect(page.locator('.workspace-folders')).toBeHidden()
  await expect(menu(page)).toBeHidden()

  await title(page).click()
  await expect(menu(page)).toBeVisible()
  await expect(title(page)).toHaveAttribute('aria-expanded', 'true')

  // Exactly one Library list exists, and it is now inside the sheet.
  await expect(page.locator('.library-rows')).toHaveCount(1)
  await expect(menu(page).locator('.library-rows')).toHaveCount(1)
  await expect(menu(page).locator('.library-rows')).toBeVisible()

  // The options the title already owned are still here, under the folders.
  await expect(menu(page).getByText('Sort by title')).toBeVisible()
})

test('choosing where you are closes the sheet and returns the column', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await title(page).click()
  await expect(menu(page).locator('.library-rows')).toHaveCount(1)

  // Scoped to the Library section deliberately: the sheet also carries the
  // display option "Pinned only (1)", and the two must stay tellable apart.
  await menu(page).locator('.library-rows').getByRole('button', { name: /^Pinned/ }).click()

  await expect(menu(page)).toBeHidden()
  await expect(title(page)).toHaveAttribute('aria-expanded', 'false')
  // Back in the column where the desktop expects to find it, still singular.
  await expect(page.locator('.library-rows')).toHaveCount(1)
  await expect(page.locator('.workspace-folders .library-rows')).toHaveCount(1)
})

test('dismissing without choosing also returns the column', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await title(page).click()
  await expect(menu(page).locator('.library-rows')).toHaveCount(1)

  await page.keyboard.press('Escape')

  await expect(menu(page)).toBeHidden()
  await expect(page.locator('.workspace-folders .library-rows')).toHaveCount(1)
})

test('a desktop menu never borrows the column', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await expect(page.locator('.workspace-folders')).toBeVisible()

  await title(page).click()
  await expect(menu(page)).toBeVisible()

  // The column is right there on screen; the menu stays the short list of
  // display options it has always been.
  await expect(page.locator('.workspace-folders .library-rows')).toHaveCount(1)
  await expect(menu(page).locator('.library-rows')).toHaveCount(0)
  await expect(menu(page)).not.toHaveClass(/has-library/)
})

test('the sheet survives being opened on a phone and reopened on a desktop', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await title(page).click()
  await expect(menu(page).locator('.library-rows')).toHaveCount(1)
  await page.keyboard.press('Escape')

  await page.setViewportSize(DESKTOP)
  await title(page).click()
  await expect(page.locator('.library-rows')).toHaveCount(1)
  await expect(page.locator('.workspace-folders .library-rows')).toHaveCount(1)
  await expect(menu(page).locator('.library-rows')).toHaveCount(0)
})
