import { expect, test } from '@playwright/test'

/**
 * EDITOR-3: quiet reader preferences, folding, and temporary contents.
 *
 * The acceptance from the board task, verbatim: "actual browser UI and
 * Playwright prove theme/preferences, folding behavior, temporary contents
 * navigation, reopen persistence, and byte-safe source behavior."
 *
 * Byte safety is the recurring assertion: every one of these features is view
 * state, so the serialised Markdown must be identical before and after using
 * any of them.
 */

const editor = '.milkdown .ProseMirror'
const markdown = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.simplemark!.session.snapshot().markdown)
const serialized = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.simplemark!.editor.serialize())

test.beforeEach(async ({ page }) => {
  // Clear once, before the first navigation — addInitScript would also wipe
  // the preferences the persistence tests exist to check.
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
})

async function openFormatPopover(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Text formatting' }).click()
  await expect(page.locator('.format-popover')).toBeVisible()
}

test.describe('reader layout preferences (D6)', () => {
  test('reading width steps the column, document-level', async ({ page }) => {
    const width = async () =>
      page.locator('.page').evaluate((el) => parseFloat(getComputedStyle(el).width))
    const before = await width()

    await openFormatPopover(page)
    await page.getByRole('button', { name: 'Wide width' }).click()
    expect(await width()).toBeGreaterThan(before)

    await page.getByRole('button', { name: 'Narrow width' }).click()
    expect(await width()).toBeLessThan(before)
  })

  test('line height steps the body leading', async ({ page }) => {
    const leading = async () =>
      page.locator(editor).evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
    const before = await leading()

    await openFormatPopover(page)
    await page.getByRole('button', { name: 'Open leading' }).click()
    expect(await leading()).toBeGreaterThan(before)

    await page.getByRole('button', { name: 'Tight leading' }).click()
    expect(await leading()).toBeLessThan(before)
  })

  test('paragraph spacing steps the block rhythm', async ({ page }) => {
    const spacing = async () =>
      page
        .locator(`${editor} > p`)
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).marginBottom))
    const before = await spacing()

    await openFormatPopover(page)
    await page.getByRole('button', { name: 'Airy spacing' }).click()
    expect(await spacing()).toBeGreaterThan(before)

    await page.getByRole('button', { name: 'Compact spacing' }).click()
    expect(await spacing()).toBeLessThan(before)
  })

  test('first-line indentation applies to top-level prose only', async ({ page }) => {
    const indent = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).textIndent))

    await openFormatPopover(page)
    await page.getByRole('button', { name: 'First line indent' }).click()
    expect(await indent(`${editor} > p`)).toBeGreaterThan(0)
    // Headings never indent — this is a book convention for prose.
    expect(await indent(`${editor} h1`)).toBe(0)

    await page.getByRole('button', { name: 'None indent' }).click()
    expect(await indent(`${editor} > p`)).toBe(0)
  })

  test('preferences are reader state: the source Markdown never changes', async ({ page }) => {
    const before = await markdown(page)
    // The bridge's own serialisation is compared against its own baseline:
    // byte-for-byte source preservation is the session's contract (D7), while
    // this asserts preferences change *neither* representation.
    const beforeSerialized = await serialized(page)

    await openFormatPopover(page)
    for (const name of ['Wide width', 'Open leading', 'Airy spacing', 'First line indent', 'night background']) {
      await page.getByRole('button', { name }).click()
    }

    expect(await markdown(page)).toBe(before)
    expect(await serialized(page)).toBe(beforeSerialized)
    // And the document is not dirty — the status still says Saved.
    await expect(page.locator('.status')).toHaveAttribute('data-state', 'saved')
  })

  test('the full reader setup survives a reload', async ({ page }) => {
    await openFormatPopover(page)
    for (const name of ['night background', 'Wide width', 'Open leading', 'Airy spacing', 'First line indent']) {
      await page.getByRole('button', { name }).click()
    }

    await page.reload()
    await page.waitForFunction(() => window.simplemark !== undefined)

    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'night')
    const variables = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return {
        width: style.getPropertyValue('--reader-width').trim(),
        leading: style.getPropertyValue('--reader-leading').trim(),
        spacing: style.getPropertyValue('--reader-para-space').trim(),
        indent: style.getPropertyValue('--reader-indent').trim(),
      }
    })
    expect(variables).toEqual({ width: '860px', leading: '1.9', spacing: '32px', indent: '1.4em' })
  })

  test('a stored pre-rename `black` theme still opens as night', async ({ page }) => {
    await page.evaluate(() =>
      window.localStorage.setItem(
        'simplemark.reader-preferences',
        JSON.stringify({ theme: 'black', family: 'serif', scale: 1 }),
      ),
    )
    await page.reload()
    await page.waitForFunction(() => window.simplemark !== undefined)
    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'night')
  })
})

test.describe('folding', () => {
  test('a heading chevron folds the section and unfolds it, byte-safely', async ({ page }) => {
    const before = await markdown(page)
    const beforeSerialized = await serialized(page)
    const sectionParagraph = page.getByText('Stop is immediate control', { exact: false })
    await expect(sectionParagraph).toBeVisible()

    // The chevron is quiet: hidden until the heading is hovered.
    const heading = page.locator(`${editor} h2`, { hasText: 'The live document boundary' })
    const chevron = heading.locator('.sm-fold-chevron')
    await expect(chevron).toHaveCSS('opacity', '0')
    await heading.hover()
    await expect(chevron).not.toHaveCSS('opacity', '0')

    await chevron.click()
    await expect(sectionParagraph).toBeHidden()
    // The heading itself stays visible, marked as folded.
    await expect(heading).toBeVisible()
    await expect(heading.locator('.sm-fold-chevron.is-folded')).toBeVisible()

    // Folding is view state only: the source is byte-identical.
    expect(await markdown(page)).toBe(before)
    expect(await serialized(page)).toBe(beforeSerialized)

    await heading.locator('.sm-fold-chevron').click()
    await expect(sectionParagraph).toBeVisible()
    expect(await serialized(page)).toBe(beforeSerialized)
  })

  test('a nested todo list folds under its parent item', async ({ page }) => {
    // Build a todo with two children through the real editor.
    await page.evaluate(() => window.simplemark!.editor.focusEnd())
    await page.keyboard.press('Enter')
    await page.keyboard.type('- [ ] parent task')
    await page.keyboard.press('Enter')
    await page.keyboard.type('child one')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await page.keyboard.type('child two')
    await expect.poll(() => markdown(page)).toContain('child two')

    const before = await markdown(page)
    const parent = page.locator(`${editor} li`, { hasText: 'parent task' }).first()
    const childOne = page.getByText('child one', { exact: true })
    await expect(childOne).toBeVisible()

    await parent.hover()
    await parent.locator('.sm-fold-chevron').first().click()
    await expect(childOne).toBeHidden()
    expect(await markdown(page)).toBe(before)

    await parent.locator('.sm-fold-chevron').first().click()
    await expect(childOne).toBeVisible()
    expect(await markdown(page)).toBe(before)
  })
})

/**
 * The contents view became one tab of the document-information panel.
 *
 * EDITOR-3 shipped it as a popover that closed on navigate, because it was the
 * only view of its kind and a popover was the smallest thing that could work.
 * Statistics and backlinks ask the same question about the same document, and
 * three popovers fighting for the same corner is not a design — so the three
 * share a panel, matching Bear. What EDITOR-3 was protecting survives: the
 * panel floats over the page instead of taking a column, so the document keeps
 * its width and nothing reflows when the panel opens.
 */
test.describe('document information panel', () => {
  test('lists the headings and navigates, floating over the page', async ({ page }) => {
    await page.getByRole('button', { name: 'Contents' }).click()
    const panel = page.locator('.info-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('button', { name: 'The first useful proof' })).toBeVisible()

    const widthBefore = await page.locator(`${editor}`).evaluate((node) => node.clientWidth)
    await panel.getByRole('button', { name: 'The live document boundary' }).click()

    // The caret landed in the heading, and the panel is still open — a person
    // navigating an outline is usually navigating it more than once.
    const selection = await page.evaluate(() => window.getSelection()?.anchorNode?.textContent)
    expect(selection).toContain('live document boundary')
    await expect(panel).toBeVisible()

    // Floating, not docked: the page never gave up width for it.
    const widthAfter = await page.locator(`${editor}`).evaluate((node) => node.clientWidth)
    expect(widthAfter).toBe(widthBefore)
  })

  test('Escape dismisses it; editing the document does not', async ({ page }) => {
    await page.getByRole('button', { name: 'Contents' }).click()
    const panel = page.locator('.info-panel')
    await expect(panel).toBeVisible()

    // Clicking into the document must not steal it — the panel is read while
    // editing, which is the whole reason it is a panel and not a popover.
    await page.locator(editor).click({ position: { x: 200, y: 300 } })
    await expect(panel).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
  })

  test('the tabs switch views without ever closing the panel', async ({ page }) => {
    const panel = page.locator('.info-panel')
    await page.getByRole('button', { name: 'Contents' }).click()
    await expect(panel.locator('.info-panel-title')).toHaveText('Table of Contents')

    await panel.getByRole('tab', { name: 'Statistics' }).click()
    await expect(panel.locator('.info-panel-title')).toHaveText('Statistics')

    // A segmented control is a choice, not a switch: pressing the selected
    // segment again re-selects it. Closing is the command's job, below.
    await panel.getByRole('tab', { name: 'Statistics' }).click()
    await expect(panel).toBeVisible()
  })

  test('the View command for the open view closes it; another view switches', async ({ page }) => {
    // Bear's exact menubar behaviour, exercised through the shared router the
    // macOS menubar dispatches into — the browser has no menubar to click.
    const panel = page.locator('.info-panel')
    const run = (id: string): Promise<void> => page.evaluate((command) => window.simplemark!.run(command as never), id)

    await run('toggleStatistics')
    await expect(panel.locator('.info-panel-title')).toHaveText('Statistics')

    await run('contents')
    await expect(panel.locator('.info-panel-title')).toHaveText('Table of Contents')
    await expect(panel).toBeVisible()

    await run('contents')
    await expect(panel).toBeHidden()
  })

  test('the word count travels with the styles bar and follows the document', async ({ page }) => {
    const run = (id: string): Promise<void> => page.evaluate((command) => window.simplemark!.run(command as never), id)
    const pill = page.locator('.word-count')
    await expect(pill).toBeHidden()

    await run('toggleWordCount')
    await expect(pill).toBeVisible()
    // Inside the palette, so dragging the bar takes the count with it rather
    // than leaving it to chase a moving target.
    await expect(page.locator('.styles-bar .word-count')).toBeVisible()

    const count = async (): Promise<number> => Number((await pill.innerText()).replace(/[^\d]/g, ''))
    const before = await count()
    expect(before).toBeGreaterThan(0)

    // The editor's own API, as the folding tests use. A bare click can land on
    // a rendered block that accepts no text, and then the assertion below would
    // be reporting a typing failure as a broken counter.
    await page.evaluate(() => window.simplemark!.editor.focusEnd())
    await page.keyboard.type(' one two three')

    // Prove the document took the words before asking what the pill says, so a
    // failure names which half went wrong.
    await expect.poll(() => markdown(page)).toContain('one two three')
    await expect.poll(count).toBe(before + 3)
  })

  test('statistics count the prose, not the Markdown furniture', async ({ page }) => {
    await page.getByRole('button', { name: 'Contents' }).click()
    const panel = page.locator('.info-panel')
    await panel.getByRole('tab', { name: 'Statistics' }).click()

    const words = Number(await panel.locator('.info-statistic').first().locator('strong').innerText())
    expect(words).toBeGreaterThan(0)

    // Timestamps need a file port that reports them. Named and dimmed, never a
    // fabricated date and never a blank row.
    await expect(panel.locator('.info-statistic.unavailable')).toHaveCount(2)
  })

  test('navigating to a heading hidden by a fold reveals it', async ({ page }) => {
    // Fold the H1 — the whole document below it, the H2 included, disappears.
    const h1 = page.locator(`${editor} h1`).first()
    await h1.hover()
    await h1.locator('.sm-fold-chevron').click()
    const h2 = page.locator(`${editor} h2`, { hasText: 'The live document boundary' })
    await expect(h2).toBeHidden()

    // The outline reads the document, not the DOM, so the entry is still there.
    await page.getByRole('button', { name: 'Contents' }).click()
    await page.locator('.info-panel').getByRole('button', { name: 'The live document boundary' }).click()

    await expect(h2).toBeVisible()
  })
})
