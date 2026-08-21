import { expect, test, type Page } from '@playwright/test'

/**
 * APP-49, ADR-0016: proposal markup is drawn from the editor's own diff
 * (`prosemirror-changeset`). A rewrite that changes one word strikes that
 * word and inserts the new one — not the whole passage struck and re-typed.
 * A proposal that only adds (a new section) still renders its Markdown whole.
 */

const editor = '.milkdown .ProseMirror'
const PASSAGE = 'Beta carries the argument that needs work.'

async function noteOnPassage(page: Page, body: string): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await page.getByRole('button', { name: 'New note' }).click()
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await expect(page.locator(editor)).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.type('Alpha holds the opening claim.')
  await page.keyboard.press('Enter')
  await page.keyboard.type(PASSAGE)
  await page.evaluate(() => window.simplemark!.flushPendingChanges())
  await page.evaluate(
    ({ quote, note }) => window.simplemark!.notes.setThreadsForTest([
      { id: 't1', noteKey: 'n', author: 'local', createdAt: '2026-08-22T00:00:00Z', body: note,
        anchor: { quote, prefix: '', suffix: '', blockIndex: 1 }, state: 'open' },
    ]),
    { quote: PASSAGE, note: body },
  )
  await expect(page.locator('.sm-note-rail [data-thread="t1"]')).toHaveCount(1)
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

test('a one-word rewrite strikes one word and inserts one word; Accept lands it', async ({ page }) => {
  await noteOnPassage(page, 'needs polish, not work')
  await scriptAgent(page, 'apply_transaction', 'Beta carries the argument that needs polish.')
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()

  await expect(page.locator('.sm-proposal-del')).toHaveCount(1)
  await expect(page.locator('.sm-proposal-del')).toHaveText('work')
  await expect(page.locator('.sm-proposal-ins-text')).toHaveCount(1)
  await expect(page.locator('.sm-proposal-ins-text')).toHaveText('polish')
  // The rest of the passage is untouched text, not markup.
  await expect(page.locator(editor)).toContainText('Beta carries the argument that needs')
  expect(await markdown(page)).toContain(PASSAGE)

  // Markup: None hides the inserted word too; the proposal stays pending.
  await page.locator('[data-action="proposal-markup"]').selectOption('none')
  await expect(page.locator('.sm-proposal-ins-text')).toBeHidden()
  await page.locator('[data-action="proposal-markup"]').selectOption('all')

  await page.locator('[data-action="accept-proposal"]').click()
  await expect(page.locator('.sm-proposal-ins-text')).toHaveCount(0)
  const after = await markdown(page)
  expect(after).toContain('Beta carries the argument that needs polish.')
  expect(after).not.toContain(PASSAGE)
})

test('a proposal that only adds still renders its Markdown whole', async ({ page }) => {
  await noteOnPassage(page, 'add a closing section')
  await scriptAgent(page, 'insert_markdown', '## Closing\n\nThe closing summary.')
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()

  await expect(page.locator('.sm-proposal-ins')).toHaveCount(1)
  await expect(page.locator('.sm-proposal-ins-body h2')).toHaveText('Closing')
  await expect(page.locator('.sm-proposal-ins-text')).toHaveCount(0)
  await expect(page.locator('.sm-proposal-del')).toHaveCount(0)
})
