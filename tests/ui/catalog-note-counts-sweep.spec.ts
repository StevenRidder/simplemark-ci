import { expect, test } from '@playwright/test'

/**
 * APP-47, ADR-0015: a document annotated in an earlier session shows its note
 * count in the catalog without being opened. APP-44 could only count the
 * documents this session had painted; everything else read as unannotated
 * when it was merely unknown. The browser shell answers through the same
 * `NoteCountSource` port the native shell does, over its localStorage store.
 */

const editor = '.milkdown .ProseMirror'
const STATUS = '.status'

async function freshHarness(page: import('@playwright/test').Page): Promise<string[]> {
  await page.goto('/?fixture=legacy')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  return page.locator('.note-select').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? ''))
}

const rowNamed = (page: import('@playwright/test').Page, name: string) =>
  page.locator('.note-item').filter({ has: page.locator(`.note-select[aria-label="${name}"]`) })

test('a document annotated last session shows its count without being opened', async ({ page }) => {
  const [first, second] = await freshHarness(page)
  await page.getByRole('button', { name: second!, exact: true }).click()
  await page.waitForTimeout(400)
  // A passage the fixture already has, so the anchor still resolves after the
  // reload rebuilds the in-memory document.
  const passage = (await page.locator(`${editor} p`).first().innerText()).trim()
  expect(passage.length).toBeGreaterThan(10)
  expect(await page.evaluate((text) => window.simplemark!.notes.selectTextForTest(text), passage)).toBe(true)
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('count me later')
  await page.keyboard.press('Enter')
  await expect(rowNamed(page, second!).locator('.note-notes-status')).toHaveAttribute('data-state', 'open')

  // A new session: the default document opens; the annotated one is not touched.
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await expect(page.locator('.note-item .note-select[aria-current="page"]')).toHaveAttribute('aria-label', first!)

  const mark = rowNamed(page, second!).locator('.note-notes-status')
  await expect(mark).toHaveCount(1)
  await expect(mark).toHaveAttribute('data-state', 'open')
  await expect(mark).toHaveAttribute('aria-label', '1 open note')
  // The unannotated rows stay exactly as they were: absent, not zero.
  await expect(rowNamed(page, first!).locator('.note-notes-status')).toHaveCount(0)

  // Opening it and resolving the note updates the same row through the document's own report.
  await page.getByRole('button', { name: second!, exact: true }).click()
  await page.waitForTimeout(600)
  await page.locator('.sm-note-rail [data-action="resolve"]').first().click()
  await expect(mark).toHaveAttribute('data-state', 'resolved')
  await expect(mark).toHaveAttribute('aria-label', '1 resolved note')
})

test('a threads file that will not parse is named in the status line, never counted as zero', async ({ page }) => {
  const [first, second] = await freshHarness(page)
  // The thread key is the document's handle; read it from the document itself
  // rather than guessing at the shell's mapping.
  await page.getByRole('button', { name: second!, exact: true }).click()
  await page.waitForTimeout(400)
  const handle = await page.evaluate(() => window.simplemark!.session.documentHandle())
  expect(handle.startsWith('fixture:')).toBe(true)
  await page.evaluate((key) => window.localStorage.setItem(`simplemark.threads.${key}`, '{not json'), handle)
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await expect(page.locator('.note-item .note-select[aria-current="page"]')).toHaveAttribute('aria-label', first!)
  const status = page.locator(STATUS)
  await expect(status).toHaveAttribute('data-state', 'error')
  await expect(status).toHaveText(`Could not read the notes for ${handle.slice('fixture:'.length)}`)
  await expect(rowNamed(page, second!).locator('.note-notes-status')).toHaveCount(0)
})
