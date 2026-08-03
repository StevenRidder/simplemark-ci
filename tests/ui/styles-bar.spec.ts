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
    items.map((item) => item.matches('button')
      ? item.getAttribute('aria-label')
      : item.querySelector('button')?.getAttribute('aria-label')),
  )).resolves.toEqual([
    'Headers', 'Todo', 'Lists', 'Bold', 'Italic', 'Highlight', 'Link', 'Tables', 'Insert image or link file', 'More',
  ])

  const geometry = await bar.evaluate((element) => {
    const style = getComputedStyle(element)
    const buttons = [...element.querySelectorAll(':scope > button, :scope > div > button')]
    return {
      position: style.position,
      bottom: style.bottom,
      radius: style.borderRadius,
      size: [element.getBoundingClientRect().width, element.getBoundingClientRect().height],
      buttonSizes: buttons.map((button) => {
        const rect = button.getBoundingClientRect()
        return [rect.width, rect.height]
      }),
    }
  })
  expect(geometry).toEqual({
    position: 'absolute',
    bottom: '18px',
    radius: '11px',
    size: [367, 35],
    buttonSizes: [
      [43, 29], [31, 29], [43, 29], [31, 29], [31, 29],
      [43, 29], [31, 29], [31, 29], [31, 29], [31, 29],
    ],
  })

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

test('every styles-bar menu mirrors Bear while unsupported Markdown stays honest', async ({ page }) => {
  const bar = page.getByLabel('Styles bar')
  const headersTrigger = bar.getByRole('button', { name: 'Headers', exact: true })

  await headersTrigger.focus()
  await headersTrigger.press('ArrowDown')
  await expect(bar.getByRole('button', { name: 'Heading 1' })).toBeFocused()
  await page.keyboard.press('End')
  await expect(bar.getByRole('button', { name: 'Heading 6' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(headersTrigger).toBeFocused()
  await expect(bar.locator('.styles-menu.open')).toHaveCount(0)

  await headersTrigger.click()
  await expect(bar.locator('.styles-menu.open').getByRole('button').allTextContents()).resolves.toEqual([
    'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6',
  ])

  await bar.getByRole('button', { name: 'Lists', exact: true }).click()
  const lists = bar.locator('.styles-menu.open')
  await expect(lists.locator(':scope > .styles-control, :scope > .styles-nested-group > .styles-nested-trigger').allTextContents())
    .resolves.toEqual(['List', 'Ordered List', 'Block Quote', 'Todo›', 'Callout›', 'Separator'])
  await lists.locator('.styles-nested-trigger').filter({ hasText: 'Todo' }).hover()
  await expect(lists.getByRole('button', { name: 'Todo', exact: true })).toHaveCount(2)
  await expect(lists.getByRole('button', { name: 'Mark as Completed' })).toBeDisabled()
  await lists.locator('.styles-nested-trigger').filter({ hasText: 'Callout' }).hover()
  await expect(lists.getByRole('button', { name: 'Caution' })).toBeDisabled()

  await bar.getByRole('button', { name: 'Highlight', exact: true }).click()
  const highlight = bar.locator('.styles-menu.open')
  await expect(highlight.getByRole('button').allTextContents()).resolves.toEqual([
    'Default', 'Green', 'Red', 'Blue', 'Yellow', 'Purple',
  ])
  await expect(highlight.getByRole('button', { name: 'Default' })).toBeEnabled()
  await expect(highlight.getByRole('button', { name: 'Green' })).toBeDisabled()

  await bar.getByRole('button', { name: 'More', exact: true }).click()
  const more = bar.locator('.styles-menu.open')
  await expect(more.locator(':scope > .styles-control:not(.styles-overflow-menu-item)').allTextContents())
    .resolves.toEqual([
      'Underline', 'Strikethrough', 'Footnote', 'Code', 'Code Block', 'Math', 'Math Block',
      'Wiki Link', 'Hide styles bar',
    ])
  await expect(more.getByRole('button', { name: 'Underline' })).toBeDisabled()
  await expect(more.getByRole('button', { name: 'Strikethrough' })).toBeEnabled()

  await page.locator('.workspace-library-head').click()
  await expect(bar.locator('.styles-menu.open')).toHaveCount(0)
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

test('the styles bar can move, remembers its place, and resets to the wireframe default', async ({ page }) => {
  const bar = page.getByLabel('Styles bar')
  const surface = page.locator('.document-surface')
  const before = await bar.boundingBox()
  const surfaceBox = await surface.boundingBox()
  if (before === null || surfaceBox === null) throw new Error('Expected visible palette and document pane')

  // Grab the quiet left inset, never a formatting button.
  await page.mouse.move(before.x + 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.72, surfaceBox.y + 120)
  await page.mouse.up()

  const moved = await bar.boundingBox()
  if (moved === null) throw new Error('Expected the moved palette to remain visible')
  expect(moved.y).toBeLessThan(before.y - 100)
  await expect.poll(() => page.evaluate(() =>
    window.localStorage.getItem('simplemark.styles-bar-position.web'),
  )).not.toBe('')

  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  const restored = await page.getByLabel('Styles bar').boundingBox()
  if (restored === null) throw new Error('Expected the restored palette to remain visible')
  expect(Math.abs(restored.x - moved.x)).toBeLessThan(2)
  expect(Math.abs(restored.y - moved.y)).toBeLessThan(2)

  await page.mouse.dblclick(restored.x + 2, restored.y + restored.height / 2)
  const resetStyle = await page.getByLabel('Styles bar').evaluate((element) => ({
    bottom: getComputedStyle(element).bottom,
    placed: element.classList.contains('is-placed'),
  }))
  expect(resetStyle).toEqual({ bottom: '18px', placed: false })
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
