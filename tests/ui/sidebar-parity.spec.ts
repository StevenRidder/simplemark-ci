import { expect, test } from '@playwright/test'

const notes = (page: import('@playwright/test').Page) =>
  page.getByRole('complementary', { name: 'Notes' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
})

test('L2-020 selecting notes preserves the complete catalog and changes only the document', async ({ page }) => {
  await expect(notes(page).locator('.note-item')).toHaveCount(3)

  for (const [name, heading] of [
    ['field-notes', 'Field notes'],
    ['ideas', 'Ideas'],
    ['architecture', 'The first useful proof'],
  ] as const) {
    await page.getByRole('button', { name, exact: true }).click()
    await expect(notes(page).locator('.note-item')).toHaveCount(3)
    await expect(page.locator('.milkdown .ProseMirror h1')).toHaveText(heading)
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page')
  }
})

test('L2-010 each New Note accumulates instead of replacing the list', async ({ page }) => {
  const newNote = page.getByRole('button', { name: 'New note' })
  await newNote.click()
  await expect(notes(page).locator('.note-item')).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'new-note-4', exact: true })).toHaveAttribute('aria-current', 'page')

  await newNote.click()
  await expect(notes(page).locator('.note-item')).toHaveCount(5)
  await expect(page.getByRole('button', { name: 'new-note-4', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'new-note-5', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByLabel('Library')).toContainText('Open Notes5')
})

test('L2-040/L2-041 pinning reorders, filters, and unpins without closing the document', async ({ page }) => {
  await page.getByRole('button', { name: 'ideas', exact: true }).click()
  await page.getByRole('button', { name: 'Pin ideas' }).click()

  await expect(notes(page).locator('.note-select').first()).toHaveAccessibleName('ideas')
  await expect(page.getByRole('button', { name: 'Unpin ideas' })).toBeVisible()
  await expect(page.getByLabel('Library')).toContainText('Pinned2')

  await page.getByRole('button', { name: /Pinned\s*2/ }).click()
  await expect(notes(page).locator('.note-item')).toHaveCount(2)
  await page.getByRole('button', { name: 'Unpin ideas' }).click()

  await expect(notes(page).locator('.note-item')).toHaveCount(1)
  await expect(page.locator('.milkdown .ProseMirror h1')).toHaveText('Ideas')
  await expect(page.getByLabel('Library')).toContainText('Pinned1')
})

test('L2-030/L2-031 search is scoped, live, clearable, and keeps the document open', async ({ page }) => {
  await page.getByRole('button', { name: 'Search' }).click()
  const search = page.getByRole('searchbox', { name: 'Search notes' })
  await expect(search).toBeFocused()
  await search.fill('portable')
  await expect(notes(page).locator('.note-item')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'ideas', exact: true })).toBeVisible()

  await search.fill('no note has this phrase')
  await expect(notes(page).locator('.note-item')).toHaveCount(0)
  await expect(page.locator('.milkdown .ProseMirror h1')).toHaveText('The first useful proof')

  await page.keyboard.press('Escape')
  await expect(search).toBeHidden()
  await expect(notes(page).locator('.note-item')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Search' })).toBeFocused()
})

test('L2-001/L2-050/L2-060 list options expose count, sorting, and all preview densities', async ({ page }) => {
  const open = page.getByRole('button', { name: 'Note list options' })
  await open.click()
  let menu = page.getByLabel('Note list options').filter({ has: page.getByText('3 notes') })
  await expect(menu.getByText('3 notes')).toBeVisible()
  await menu.getByRole('button', { name: 'Sort by title' }).click()
  await expect.poll(() => notes(page).locator('.note-select').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('aria-label')),
  )).toEqual(['architecture', 'field-notes', 'ideas'])

  for (const [label, density] of [
    ['Small preview', 'small'],
    ['Medium preview', 'medium'],
    ['Large preview', 'large'],
  ] as const) {
    await open.click()
    menu = page.getByLabel('Note list options').filter({ has: page.getByText('3 notes') })
    await menu.getByRole('button', { name: label }).click()
    await expect(notes(page)).toHaveAttribute('data-preview', density)
  }
})

test('L1-050 Open Notes and Pinned keep collection title, selection, and count aligned', async ({ page }) => {
  await page.getByRole('button', { name: /Pinned\s*1/ }).click()
  await expect(page.getByRole('button', { name: 'Note list options' })).toContainText('Pinned')
  await expect(notes(page).locator('.note-item')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Pinned\s*1/ })).toHaveClass(/selected/)

  await page.getByRole('button', { name: /Open Notes\s*3/ }).click()
  await expect(page.getByRole('button', { name: 'Note list options' })).toContainText('Open Notes')
  await expect(notes(page).locator('.note-item')).toHaveCount(3)
  await expect(page.getByRole('button', { name: /Open Notes\s*3/ })).toHaveClass(/selected/)
})

test('L1-120 visible sidebar controls expose names and honest disabled states', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Search' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'New note' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Sidebar options' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Folder sync status' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeDisabled()
  const library = page.getByLabel('Library')
  await expect(library.getByRole('button', { name: 'Untagged' })).toBeDisabled()
  await expect(library.getByRole('button', { name: 'Todo' })).toBeDisabled()
  await expect(library.getByRole('button', { name: 'Today' })).toBeDisabled()
  await expect(library.getByRole('button', { name: 'Trash' })).toBeDisabled()
})
