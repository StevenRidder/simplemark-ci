import { expect, test } from '@playwright/test'

const editor = '.milkdown .ProseMirror'
const markdown = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.simplemark!.session.snapshot().markdown)

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
})

async function selectNewWord(page: import('@playwright/test').Page, text: string) {
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.type(text)
  await expect.poll(() => markdown(page)).toContain(text)
  for (let index = 0; index < text.length; index += 1) await page.keyboard.press('Shift+ArrowLeft')
}

test('the styles bar is quiet, ordered, and its commands edit ordinary Markdown', async ({ page }) => {
  const bar = page.getByLabel('Styles bar')
  await expect(bar).toBeVisible()
  await expect(bar.locator(':scope > *').evaluateAll((items) =>
    items.map((item) => item.querySelector('button')?.getAttribute('aria-label') ?? item.textContent?.trim()),
  )).resolves.toEqual([
    'Headers', 'Todo', 'Lists', 'Bold', 'Italic', 'Link', 'Tables', 'Image/File', 'More',
  ])

  await selectNewWord(page, 'calm controls')
  await bar.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect.poll(() => markdown(page)).toContain('**calm controls**')

  // Reader chrome must not become a document feature.
  const afterBold = await markdown(page)
  await page.getByRole('button', { name: 'Text formatting' }).click()
  await page.getByRole('button', { name: 'Hide styles bar', exact: true }).click()
  await expect(bar).toBeHidden()
  await expect.poll(() => markdown(page)).toBe(afterBold)

  await page.getByRole('button', { name: 'Show styles bar', exact: true }).click()
  await expect(bar).toBeVisible()
})

test('the styles-bar preference survives reload without changing source', async ({ page }) => {
  const before = await markdown(page)
  await page.getByRole('button', { name: 'Text formatting' }).click()
  await page.getByRole('button', { name: 'Hide styles bar', exact: true }).click()
  await expect(page.getByLabel('Styles bar')).toBeHidden()
  await expect.poll(() => markdown(page)).toBe(before)

  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.getByLabel('Styles bar')).toBeHidden()
})

test('narrow windows collapse low-frequency controls into More', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 760 })
  const bar = page.getByLabel('Styles bar')
  await expect(bar.getByRole('button', { name: 'Bold', exact: true })).toBeHidden()
  await expect(bar.getByRole('button', { name: 'Image/File', exact: true })).toBeHidden()

  await bar.getByRole('button', { name: 'More', exact: true }).click()
  const more = bar.locator('.styles-menu.open')
  await expect(more.getByRole('button', { name: 'Bold', exact: true })).toBeVisible()

  await selectNewWord(page, 'overflow works')
  await more.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect.poll(() => markdown(page)).toContain('**overflow works**')
})
