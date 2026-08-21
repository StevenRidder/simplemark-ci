import { expect, test, type Page } from '@playwright/test'

/**
 * BUG-27. A proposal appended at the end of a long note was off-screen: the
 * bar counted it, nothing led to it, Accept changed nothing the reader could
 * see, and ⌘Z could not take an acceptance back. Now the bar's count is the
 * way to the change, staging and accepting both say where it went, an accept
 * scrolls there, and accepting is the person's act — undoable like any edit.
 * The bar also clears the native shell's title row, as the notes rail does.
 */

const editor = '.milkdown .ProseMirror'
const STATUS = '.status'
const PASSAGE = 'Beta carries the argument that needs work.'

async function longNoteWithPassage(page: Page, body: string): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 640 })
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await page.getByRole('button', { name: 'New note' }).click()
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('Alpha holds the opening claim.')
  await page.keyboard.press('Enter')
  await page.keyboard.type(PASSAGE)
  for (let line = 1; line <= 24; line += 1) {
    await page.keyboard.press('Enter')
    await page.keyboard.type(`Filler paragraph ${line} so the end of the note is below the window.`)
  }
  await page.evaluate(() => window.simplemark!.flushPendingChanges())
  await page.evaluate(
    ({ quote, note }) => window.simplemark!.notes.setThreadsForTest([
      { id: 't1', noteKey: 'n', author: 'local', createdAt: '2026-08-22T00:00:00Z', body: note,
        anchor: { quote, prefix: '', suffix: '', blockIndex: 1 }, state: 'open' },
    ]),
    { quote: PASSAGE, note: body },
  )
  await expect(page.locator('.sm-note-rail [data-thread="t1"]')).toHaveCount(1)
  // Typing left the editor scrolled to the end; bring the passage (and so its
  // card, which follows it) back into view. The end of the note is now below
  // the window, which is the situation this spec is about.
  await page.locator(`${editor} p`, { hasText: PASSAGE }).scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
}

async function scriptAgent(page: Page, tool: 'apply_transaction' | 'insert_markdown', markdown: string): Promise<void> {
  await page.evaluate(({ tool, markdown }) => {
    const queue: Array<{ kind: string; name?: string; args?: Record<string, unknown>; text?: string }> = [
      { kind: 'tool', name: tool, args: { markdown } },
      { kind: 'text', text: 'Proposed.' },
    ]
    window.simplemark!.agent.setProviderForTest({
      async complete(input: { scope?: unknown }) {
        const turn = queue.shift()
        if (turn === undefined || turn.kind === 'text') return { kind: 'text', text: turn?.text ?? 'done' }
        return { kind: 'tool', id: 'c1', name: turn.name!, args: { ...turn.args, scope: input.scope } }
      },
    })
  }, { tool, markdown })
}

const markdown = (page: Page): Promise<string> =>
  page.evaluate(() => {
    window.simplemark!.flushPendingChanges()
    return window.simplemark!.session.snapshot().markdown
  })

const inViewport = async (page: Page, selector: string): Promise<boolean> =>
  page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect()
    return r.top >= 0 && r.bottom <= window.innerHeight
  })

test('an appended proposal is off-screen until Show takes the reader to it, and staging says where it went', async ({ page }) => {
  await longNoteWithPassage(page, 'add a closing summary')
  await scriptAgent(page, 'insert_markdown', '## Closing\n\nThe closing summary the agent proposed.')
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await expect(page.locator('.sm-proposal-ins')).toHaveCount(1)
  await expect(page.locator(STATUS)).toContainText('at the end of the note')
  expect(await inViewport(page, '.sm-proposal-ins')).toBe(false)

  const show = page.locator('.sm-proposal-bar [data-action="show-proposal"]')
  await expect(show).toContainText('Show')
  await show.click()
  await expect.poll(() => inViewport(page, '.sm-proposal-ins')).toBe(true)
  await expect(page.locator(STATUS)).toContainText('Proposed:')
})

test('Accept says where it landed, scrolls there, and ⌘Z takes it back', async ({ page }) => {
  await longNoteWithPassage(page, 'split this by region')
  const before = await markdown(page)
  await scriptAgent(page, 'apply_transaction', 'Beta, split by region.')
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await expect(page.locator('.sm-proposal-ins')).toHaveCount(1)
  // Scroll far away first; the accept must bring the reader back to the change.
  await page.evaluate(() => document.querySelector('.document-surface')?.scrollTo(0, 99999))

  await page.locator('.sm-proposal-bar [data-action="accept-all-proposals"]').click()
  await expect(page.locator('.sm-proposal-bar')).toBeHidden()
  await expect(page.locator(STATUS)).toContainText('Accepted:')
  await expect(page.locator(STATUS)).toContainText('⌘Z')
  // Still readable after the autosave has run: a message holds against a
  // bare "Saved" (the merge group caught it replaced within a second).
  await page.waitForTimeout(1500)
  await expect(page.locator(STATUS)).toContainText('Accepted:')
  const accepted = await markdown(page)
  expect(accepted).toContain('Beta, split by region.')
  expect(accepted).not.toContain(PASSAGE)
  await expect.poll(() => inViewport(page, `${editor} p:has-text("Beta, split by region.")`)).toBe(true)

  // The person's own acceptance sits in their undo history.
  await page.locator(editor).click()
  // ProseMirror's undo is Mod-z: ⌘ on a Mac, Ctrl on the Linux runner.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator(editor)).toContainText(PASSAGE)
  const undone = await markdown(page)
  expect(undone).toContain(PASSAGE)
  expect(undone).not.toContain('Beta, split by region.')
  expect(undone.trim()).toBe(before.trim())
})

test('the bar clears the native title row, and sits at the top everywhere else', async ({ page }) => {
  await longNoteWithPassage(page, 'anything')
  await scriptAgent(page, 'apply_transaction', 'Beta, reworded.')
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await expect(page.locator('.sm-proposal-bar')).toBeVisible()
  const top = () => page.locator('.sm-proposal-bar').evaluate((el) => getComputedStyle(el).top)
  expect(await top()).toBe('8px')
  await page.evaluate(() => { document.documentElement.dataset['shell'] = 'native' })
  expect(await top()).toBe('72px')
  await page.evaluate(() => { delete document.documentElement.dataset['shell'] })
})
