import { expect, test } from '@playwright/test'

/**
 * TOOLBAR-1: the editing commands and D6 reader typography.
 *
 * Every assertion is against the real document through the application API or
 * against computed style, never against the button's own state — a toolbar that
 * looks enabled and does nothing is exactly what EDITOR-1's acceptance forbids.
 */

const editor = '.milkdown .ProseMirror'
const markdown = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.simplemark!.session.snapshot().markdown)

test.beforeEach(async ({ page }) => {
  // Clear once, before the first navigation. addInitScript runs on *every*
  // navigation, so clearing there would wipe the preferences the reload test
  // exists to check.
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
})

/**
 * Puts the caret at the very end of the document, reliably.
 *
 * Uses the editor's own focusEnd rather than simulated keys. Clicking the
 * canvas can land on the Mermaid NodeView, which takes a node selection and
 * silently swallows typing; `End` stops at the end of a wrapped visual line;
 * and select-all-then-collapse raced the async listener. All three produced
 * intermittent failures in different tests on different runs.
 */
async function caretAtEnd(page: import('@playwright/test').Page) {
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await expect(page.locator(editor)).toBeFocused()
}

async function selectWord(page: import('@playwright/test').Page, word: string) {
  await caretAtEnd(page)
  await page.keyboard.type(word)
  // Wait for the word to actually be in the document. Selecting before the last
  // keystroke lands shifts the selection off the word, and the command then
  // applies to the wrong range — which failed intermittently under load.
  await expect.poll(() => markdown(page)).toContain(word)
  for (let i = 0; i < word.length; i += 1) await page.keyboard.press('Shift+ArrowLeft')
}

test.describe('inline commands reach the document', () => {
  for (const [label, word, expected] of [
    ['Italic', 'slanted', '*slanted*'],
    ['Strikethrough', 'struck', '~~struck~~'],
  ] as const) {
    test(`${label} produces ${expected}`, async ({ page }) => {
      await selectWord(page, word)
      await page.getByRole('button', { name: 'Text formatting' }).click()
      await page.getByRole('button', { name: label, exact: true }).click()
      await expect.poll(() => markdown(page)).toContain(expected)
    })
  }
})

test('the checklist button produces a task item', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type('a thing to do')
  await expect.poll(() => markdown(page)).toContain('a thing to do')
  await page.getByRole('button', { name: 'Checklist' }).click()

  await expect(page.locator(`${editor} li[data-item-type="task"]`)).toHaveCount(1)
  await expect.poll(() => markdown(page)).toMatch(/[-*] \[ \] a thing to do/)
})

test('the table button inserts a real table', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Table' }).click()

  await expect(page.locator(`${editor} table`)).toBeVisible()

  // A wholly empty table serialises to nothing, so type a cell before checking
  // the document — an empty table in the DOM is not yet a table in the file.
  await page.locator(`${editor} table th`).first().click()
  await page.keyboard.type('Take')
  await expect.poll(() => markdown(page)).toMatch(/\|\s*Take\s*\|/)
})

test('table-local controls change rows, columns, and alignment as portable Markdown', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Table' }).click()

  const table = page.locator(`${editor} table`)
  await table.locator('th').first().click()
  await expect(page.getByRole('button', { name: 'Row below' })).toBeVisible()

  const rowsBefore = await table.locator('tr').count()
  await page.getByRole('button', { name: 'Row below' }).click()
  await expect(table.locator('tr')).toHaveCount(rowsBefore + 1)

  const cellsBefore = await table.locator('tr').first().locator('th, td').count()
  await page.getByRole('button', { name: 'Column right' }).click()
  await expect(table.locator('tr').first().locator('th, td')).toHaveCount(cellsBefore + 1)

  await page.getByRole('button', { name: 'Align right' }).click()
  await table.locator('th').first().click()
  await page.keyboard.type('Revenue')
  await expect.poll(() => markdown(page)).toContain('Revenue')
  // Alignment serializes through the regular GFM delimiter; no HTML or width
  // metadata is allowed to leak into the Markdown file.
  await expect.poll(() => markdown(page)).toMatch(/\|\s*:?-+:\s*\|/)
  await expect.poll(() => markdown(page)).not.toContain('colwidth')
})

test('Tab from the final table cell creates a new editable GFM row', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Table' }).click()

  const table = page.locator(`${editor} table`)
  const rowsBefore = await table.locator('tr').count()
  await table.locator('th, td').last().click()
  await page.keyboard.press('Tab')

  await expect(table.locator('tr')).toHaveCount(rowsBefore + 1)
  await page.keyboard.type('A real next row')
  await expect.poll(() => markdown(page)).toContain('A real next row')
})

test('table controls delete structure and keep display sizing out of source', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Table' }).click()

  const table = page.locator(`${editor} table`)
  await table.locator('td').first().click()
  await expect(page.getByRole('button', { name: 'Delete row' })).toBeVisible()

  const rowsBefore = await table.locator('tr').count()
  await page.getByRole('button', { name: 'Delete row' }).click()
  await expect(table.locator('tr')).toHaveCount(rowsBefore - 1)

  // The controls offer reader-local layout modes. They must never turn a
  // portable `.md` file into HTML or hidden table metadata.
  await table.locator('td').first().click()
  await page.getByRole('button', { name: 'Fit content' }).click()
  await expect(table).toHaveCSS('table-layout', 'auto')
  await page.getByRole('button', { name: 'Equal columns' }).click()
  await expect(table).toHaveCSS('table-layout', 'fixed')
  expect(await markdown(page)).not.toContain('style=')
  expect(await markdown(page)).not.toContain('colwidth')

  const columnsBefore = await table.locator('tr').first().locator('th, td').count()
  await page.getByRole('button', { name: 'Delete column' }).click()
  await expect(table.locator('tr').first().locator('th, td')).toHaveCount(columnsBefore - 1)
  await page.getByRole('button', { name: 'Delete table' }).click()
  await expect(table).toHaveCount(0)
})

test('a table column can be width-dragged without width metadata entering Markdown', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Table' }).click()

  const table = page.locator(`${editor} table`)
  const cell = table.locator('th').first()
  await cell.scrollIntoViewIfNeeded()
  const box = await cell.boundingBox()
  if (box === null) throw new Error('Expected a visible table header cell')
  const before = box.width
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2)
  await expect(cell.locator('.column-resize-handle')).toBeVisible()
  await page.mouse.down()
  await page.mouse.move(box.x + box.width + 80, box.y + box.height / 2)
  await page.mouse.up()

  await expect.poll(async () => (await cell.boundingBox())?.width ?? 0).toBeGreaterThan(before + 30)
  expect(await markdown(page)).not.toContain('colwidth')
})

test('table-local sort and move controls reorder portable rows and columns', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Table' }).click()

  const table = page.locator(`${editor} table`)
  const cells = table.locator('th, td')
  await cells.nth(0).click()
  await page.keyboard.type('Name')
  await cells.nth(1).click()
  await page.keyboard.type('Status')
  await cells.nth(3).click()
  await page.keyboard.type('Zebra')
  await cells.nth(6).click()
  await page.keyboard.type('Apple')

  await table.locator('td').first().click()
  await page.getByRole('button', { name: 'Sort selected column ascending' }).click()
  await expect(table.locator('tr').nth(1).locator('td').first()).toContainText('Apple')

  await table.locator('tr').nth(1).locator('td').first().click()
  await page.getByRole('button', { name: 'Shift row down' }).click()
  await expect(table.locator('tr').nth(2).locator('td').first()).toContainText('Apple')

  await table.locator('tr').nth(2).locator('td').first().click()
  await page.getByRole('button', { name: 'Move right' }).click()
  await expect(table.locator('tr').first().locator('th').nth(1)).toContainText('Name')
  await expect.poll(() => markdown(page)).toContain('Apple')
  expect(await markdown(page)).not.toContain('colwidth')
})

test('the numbered list button produces an ordered list', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type('first thing')
  await expect.poll(() => markdown(page)).toContain('first thing')
  await page.getByRole('button', { name: 'Text formatting' }).click()
  await page.getByRole('button', { name: 'Numbered list' }).click()

  await expect(page.locator(`${editor} ol li`)).toHaveCount(1)
  await expect.poll(() => markdown(page)).toContain('1. first thing')
})

test.describe('everyday correction controls', () => {
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    test(`Heading ${level} creates a real H${level}`, async ({ page }) => {
      const text = `heading level ${level}`
      await caretAtEnd(page)
      await page.keyboard.press('Enter')
      await page.keyboard.type(text)
      await page.getByRole('button', { name: 'Text formatting' }).click()
      await page.getByRole('button', { name: `Heading ${level}` }).click()

      await expect(page.locator(`${editor} h${level}`, { hasText: text })).toBeVisible()
      await expect.poll(() => markdown(page)).toContain(`${'#'.repeat(level)} ${text}`)
    })
  }

  test('quote, code block, and divider write normal Markdown structures', async ({ page }) => {
    await caretAtEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('quoted correction')
    await page.getByRole('button', { name: 'Text formatting' }).click()
    await page.getByRole('button', { name: 'Quote' }).click()
    await expect(page.locator(`${editor} blockquote`, { hasText: 'quoted correction' })).toBeVisible()

    await caretAtEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('const portable = true')
    await page.getByRole('button', { name: 'Code block' }).click()
    await expect(page.locator(`${editor} pre`)).toBeVisible()

    await caretAtEnd(page)
    await page.getByRole('button', { name: 'Divider' }).click()
    await expect(page.locator(`${editor} hr`)).toHaveCount(2)
    // remark may serialise the same horizontal rule as `---` or `***`
    // depending on the surrounding blockquote. Both are ordinary Markdown.
    await expect.poll(() => markdown(page)).toMatch(/^(---|\*\*\*)$/m)
  })

  test('highlight, inline code, and link stay portable in the document', async ({ page }) => {
    await selectWord(page, 'emphasized')
    await page.getByRole('button', { name: 'Text formatting' }).click()
    await page.getByRole('button', { name: 'Highlight' }).click()
    await expect.poll(() => markdown(page)).toContain('==emphasized==')

    await selectWord(page, 'identifier')
    await page.getByRole('button', { name: 'Inline code' }).click()
    await expect.poll(() => markdown(page)).toContain('`identifier`')

    await caretAtEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('destination')
    for (let i = 0; i < 'destination'.length; i += 1) await page.keyboard.press('Shift+ArrowLeft')
    await page.once('dialog', (dialog) => dialog.accept('https://example.invalid/destination'))
    await page.getByRole('button', { name: 'Link' }).click()
    await expect.poll(() => markdown(page)).toContain('[destination](https://example.invalid/destination)')
  })
})

test.describe('undo and redo', () => {
  test('the buttons undo and redo an edit', async ({ page }) => {
    await caretAtEnd(page)
    await page.keyboard.type(' BUTTON UNDO')
    await expect.poll(() => markdown(page)).toContain('BUTTON UNDO')

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => markdown(page)).not.toContain('BUTTON UNDO')

    await page.getByRole('button', { name: 'Redo' }).click()
    await expect.poll(() => markdown(page)).toContain('BUTTON UNDO')
  })

  test('Cmd+Shift+Z and Cmd+Y both redo', async ({ page }) => {
    for (const redoKey of ['ControlOrMeta+Shift+z', 'ControlOrMeta+y'] as const) {
      await caretAtEnd(page)
      await page.keyboard.type(` KEY ${redoKey}`)
      await expect.poll(() => markdown(page)).toContain(`KEY ${redoKey}`)

      await page.keyboard.press('ControlOrMeta+z')
      await expect.poll(() => markdown(page)).not.toContain(`KEY ${redoKey}`)

      await page.keyboard.press(redoKey)
      await expect.poll(() => markdown(page)).toContain(`KEY ${redoKey}`)
    }
  })
})

test.describe('reader typography is document-level (D6)', () => {
  const paper = (page: import('@playwright/test').Page) =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
    )

  test('defaults to the approved warm-paper theme', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'tan')
  })

  test('the three backgrounds change the whole page', async ({ page }) => {
    await page.getByRole('button', { name: 'Text formatting' }).click()

    await page.getByRole('button', { name: 'black background' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'black')
    expect(await paper(page)).toBe('#0d0d0d')

    await page.getByRole('button', { name: 'white background' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'white')
    expect(await paper(page)).toBe('#ffffff')
  })

  test('text size steps up and down for the whole document, not a selection', async ({ page }) => {
    const size = async () =>
      page.locator(editor).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    const before = await size()

    await page.getByRole('button', { name: 'Text formatting' }).click()
    await page.getByRole('button', { name: 'Larger text' }).click()
    expect(await size()).toBeGreaterThan(before)

    await page.getByRole('button', { name: 'Smaller text' }).click()
    await page.getByRole('button', { name: 'Smaller text' }).click()
    expect(await size()).toBeLessThan(before)

    // Nothing about typography may reach the document.
    expect(await markdown(page)).not.toContain('font')
    expect(await markdown(page)).not.toContain('style=')
  })

  test('the typeface choice applies to body text', async ({ page }) => {
    await page.getByRole('button', { name: 'Text formatting' }).click()
    await page.getByRole('button', { name: 'Mono typeface' }).click()
    const family = await page.locator(editor).evaluate((el) => getComputedStyle(el).fontFamily)
    expect(family).toMatch(/Mono|Consolas|monospace/i)
  })

  test('preferences survive a reload', async ({ page }) => {
    await page.getByRole('button', { name: 'Text formatting' }).click()
    await page.getByRole('button', { name: 'black background' }).click()
    await page.getByRole('button', { name: 'Larger text' }).click()

    await page.reload()
    await page.waitForFunction(() => window.simplemark !== undefined)

    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'black')
    const scale = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--reader-scale').trim(),
    )
    expect(Number(scale)).toBeGreaterThan(1)
  })
})

test('convert to diagram turns a Mermaid paragraph into a rendered block', async ({ page }) => {
  await expect(page.locator('.diagram')).toHaveCount(1)

  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type('flowchart LR')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('  A --> B')

  // Wait for the typed source to actually be in the block. Clicking Convert
  // before the last keystroke lands gives Mermaid a half-typed diagram, which
  // fails validation and correctly refuses to convert.
  await expect
    .poll(() => markdown(page))
    .toContain('A --> B')

  await page.getByRole('button', { name: 'Convert to diagram' }).click()

  await expect(page.locator('.diagram')).toHaveCount(2)
  await expect.poll(() => markdown(page)).toContain('```mermaid')

  // A diagram at the terminal position remains a document, not an editing
  // dead end. This creates a paragraph only when the reader asks for one.
  await page.getByRole('button', { name: 'Click to keep writing' }).click()
  await page.keyboard.type('continued after diagram')
  await expect.poll(() => markdown(page)).toContain('continued after diagram')
})

test('the quiet gutter drag reorders document blocks through the editor transaction', async ({ page }) => {
  const h1 = page.locator(`${editor} > h1`)
  const h2 = page.locator(`${editor} > h2`)
  await expect(h1).toHaveCount(1)
  await expect(h2).toHaveCount(1)
  const h1Box = await h1.boundingBox()
  const h2Box = await h2.boundingBox()
  expect(h1Box).not.toBeNull()
  expect(h2Box).not.toBeNull()

  // The handle is a six-dot visual in the left gutter. Dragging it moves the
  // actual ProseMirror block, so the Markdown order changes too.
  const gutterX = h2Box!.x - 16
  await page.mouse.move(gutterX, h2Box!.y + 8)
  await page.mouse.down()
  await page.mouse.move(gutterX, h1Box!.y + 4, { steps: 6 })
  await page.mouse.up()

  await expect.poll(async () => {
    const value = await markdown(page)
    return value.indexOf('## The live document boundary') < value.indexOf('# The first useful proof')
  }).toBe(true)
})

test('controls needing infrastructure stay disabled', async ({ page }) => {
  // SHELL-1 owns these; they must not pretend to work.
  for (const name of ['Attach file', 'Search', 'Document list', 'New note', 'Work with AI']) {
    await expect(page.getByRole('button', { name })).toBeDisabled()
  }
})
