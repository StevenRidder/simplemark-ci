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
})

test('controls needing infrastructure stay disabled', async ({ page }) => {
  // SHELL-1 owns these; they must not pretend to work.
  for (const name of ['Attach file', 'Search', 'Document list', 'New note', 'Work with AI']) {
    await expect(page.getByRole('button', { name })).toBeDisabled()
  }
})
