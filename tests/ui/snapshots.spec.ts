import { expect, test, type Page } from '@playwright/test'

/**
 * ADR-0014: snapshots beside the document. One is taken before every agent
 * run; a person can name one; Restore is an ordinary named transaction that
 * snapshots first; Compare is block-level.
 */

const editor = '.milkdown .ProseMirror'
const PASSAGE = 'Beta carries the argument that needs work.'

async function noteOnPassage(page: Page, body: string): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('simplemark.agent-connection', JSON.stringify({ editMode: 'direct' })))
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await page.getByRole('button', { name: 'New note' }).click()
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('Alpha holds the opening claim.')
  await page.keyboard.press('Enter')
  await page.keyboard.type(PASSAGE)
  await page.evaluate(() => window.simplemark!.flushPendingChanges())
  await page.evaluate(
    ({ quote, note }) => window.simplemark!.notes.setThreadsForTest([
      { id: 't1', noteKey: 'n', author: 'local', createdAt: '2026-08-21T00:00:00Z', body: note,
        anchor: { quote, prefix: '', suffix: '', blockIndex: 1 }, state: 'open' },
    ]),
    { quote: PASSAGE, note: body },
  )
  await page.evaluate((markdown) => {
    const queue: Array<{ kind: string; name?: string; args?: Record<string, unknown>; text?: string }> = [
      { kind: 'tool', name: 'apply_transaction', args: { markdown } },
      { kind: 'text', text: 'Done.' },
    ]
    window.simplemark!.agent.setProviderForTest({
      async complete(input: { scope?: unknown }) {
        const turn = queue.shift()
        if (turn === undefined || turn.kind === 'text') return { kind: 'text', text: turn?.text ?? 'done' }
        return { kind: 'tool', id: 'c1', name: turn.name!, args: { ...turn.args, scope: input.scope } }
      },
    })
  }, 'Beta, split by region.')
}

const markdown = (page: Page): Promise<string> =>
  page.evaluate(() => {
    window.simplemark!.flushPendingChanges()
    return window.simplemark!.session.snapshot().markdown
  })

test('an agent run snapshots first; a snapshot restores and compares', async ({ page }) => {
  await noteOnPassage(page, 'Split this by region.')
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await expect(page.locator(editor)).toContainText('Beta, split by region.')

  await page.evaluate(() => window.simplemark!.agent.toggleActivity())
  const auto = page.locator('.sm-snapshot-row[data-trigger="agent"]')
  await expect(auto).toHaveCount(1)
  await expect(auto.locator('.sm-snapshot-name')).toContainText('Before agent run')

  // Compare: the agent's rewrite shows as the removed passage and the added one.
  await auto.locator('[data-action="compare-snapshot"]').click()
  await expect(page.locator('.sm-snapshot-block[data-kind="removed"]')).toContainText(PASSAGE)
  await expect(page.locator('.sm-snapshot-block[data-kind="added"]')).toContainText('Beta, split by region.')

  // Name one now.
  await page.locator('.sm-snapshots-label').fill('after the agent')
  await page.locator('[data-action="snapshot-now"]').click()
  await expect(page.locator('.sm-snapshot-row[data-trigger="manual"] .sm-snapshot-name')).toContainText('after the agent')

  // Restore the automatic one: the passage returns, the restore is a named
  // transaction in Activity, and a pre-restore snapshot was taken first.
  await page.locator('.sm-snapshot-row[data-trigger="agent"] [data-action="restore-snapshot"]').click()
  await expect.poll(() => markdown(page)).toContain(PASSAGE)
  expect(await markdown(page)).not.toContain('Beta, split by region.')
  await expect(page.locator(editor)).toContainText(PASSAGE)
  await expect(page.locator('.sm-activity-row[data-actor="activity"] .sm-activity-name')).toContainText('Restore')
  await expect(page.locator('.sm-snapshot-row[data-trigger="restore"]')).toHaveCount(1)
})

test('snapshots never enter the document', async ({ page }) => {
  await noteOnPassage(page, 'Tighten this.')
  await page.evaluate(() => window.simplemark!.agent.toggleActivity())
  const before = await markdown(page)
  await page.locator('.sm-snapshots-label').fill('untouched')
  await page.locator('[data-action="snapshot-now"]').click()
  await expect(page.locator('.sm-snapshot-row[data-trigger="manual"]')).toHaveCount(1)
  expect(await markdown(page)).toBe(before)
})
