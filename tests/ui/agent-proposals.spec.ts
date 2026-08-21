import { expect, test, type Page } from '@playwright/test'

/**
 * ADR-0013 / AGENT-13: agent edits are proposals until a person accepts them.
 * The document is byte-identical while proposals are on screen; Accept lands
 * through the ordinary change stream; Reject forgets.
 */

const editor = '.milkdown .ProseMirror'
const PASSAGE = 'Beta carries the argument that needs work.'

async function noteOnPassage(page: Page, body: string): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await page.getByRole('button', { name: 'New note' }).click()
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  // The merge group once typed the whole setup into nothing: a key burst
  // right after focusEnd() can land before the fresh editor owns focus. Wait
  // for it, as the paste specs do.
  await expect(page.locator(editor)).toBeFocused()
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
  await expect(page.locator('.sm-note-rail [data-thread="t1"]')).toHaveCount(1)
}

async function scriptAgent(page: Page, replacement: string): Promise<void> {
  await page.evaluate((markdown) => {
    const queue: Array<{ kind: string; name?: string; args?: Record<string, unknown>; text?: string }> = [
      { kind: 'tool', name: 'apply_transaction', args: { markdown } },
      { kind: 'text', text: 'Proposed.' },
    ]
    window.simplemark!.agent.setProviderForTest({
      async complete(input: { scope?: unknown }) {
        const turn = queue.shift()
        if (turn === undefined || turn.kind === 'text') return { kind: 'text', text: turn?.text ?? 'done' }
        return { kind: 'tool', id: 'c1', name: turn.name!, args: { ...turn.args, scope: input.scope } }
      },
    })
  }, replacement)
}

const markdown = (page: Page): Promise<string> =>
  page.evaluate(() => {
    window.simplemark!.flushPendingChanges()
    return window.simplemark!.session.snapshot().markdown
  })

test('a proposed edit is drawn, not applied — and Accept lands it', async ({ page }) => {
  await noteOnPassage(page, 'Split this by region.')
  await scriptAgent(page, 'Beta, split by region.')
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()

  await expect(page.locator('.sm-proposal-ins')).toHaveCount(1)
  // Exact spans (ADR-0016): only what changes is struck and inserted — the
  // shared "Beta" stays plain text.
  await expect(page.locator('.sm-proposal-ins-text')).toContainText('split by region')
  await expect(page.locator('.sm-proposal-del').first()).toContainText('carries the argument')
  await expect(page.locator('.sm-proposal-del')).not.toContainText('Beta')
  await expect(page.locator('.sm-proposal-bar')).toContainText('1 proposed change')
  // The promise: nothing has changed until a person says so.
  expect(await markdown(page)).toContain(PASSAGE)
  expect(await markdown(page)).not.toContain('Beta, split by region.')

  await page.locator('[data-action="accept-proposal"]').click()
  await expect.poll(() => markdown(page)).toContain('Beta, split by region.')
  expect(await markdown(page)).not.toContain(PASSAGE)
  await expect(page.locator('.sm-proposal-ins')).toHaveCount(0)
  await expect(page.locator('.sm-proposal-bar')).toBeHidden()

  // Landed through the ordinary stream: Activity names it and can revert it.
  await page.evaluate(() => window.simplemark!.agent.toggleActivity())
  const agentRow = page.locator('.sm-activity-row[data-actor="agent"]').first()
  await expect(agentRow.locator('.sm-activity-name')).toContainText('Split this by region.')
  await expect(agentRow.locator('[data-action="revert"]')).toHaveCount(1)
})

test('Reject forgets the proposal and leaves the document untouched', async ({ page }) => {
  await noteOnPassage(page, 'Tighten this.')
  await scriptAgent(page, 'Beta, tightened.')
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await expect(page.locator('.sm-proposal-ins')).toHaveCount(1)
  const before = await markdown(page)

  await page.locator('[data-action="reject-proposal"]').click()
  await expect(page.locator('.sm-proposal-ins')).toHaveCount(0)
  expect(await markdown(page)).toBe(before)
  await expect(page.locator('.sm-activity-row[data-actor="agent"]')).toHaveCount(0)
})

test('typing elsewhere before accepting still lands the proposal on its passage', async ({ page }) => {
  await noteOnPassage(page, 'Split this by region.')
  await scriptAgent(page, 'Beta, split by region.')
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await expect(page.locator('.sm-proposal-ins')).toHaveCount(1)

  // A person keeps working above the passage; the proposal is relocated by text.
  await page.evaluate(() => window.simplemark!.notes.selectTextForTest('Alpha holds the opening claim.'))
  // ArrowRight collapses the selection to its end in both engines; End does
  // not in WebKit, which typed over the sentence instead.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type(' Indeed.')
  await page.evaluate(() => window.simplemark!.flushPendingChanges())

  await page.locator('[data-action="accept-proposal"]').click()
  await expect.poll(() => markdown(page)).toContain('Beta, split by region.')
  expect(await markdown(page)).toContain('Alpha holds the opening claim. Indeed.')
  expect(await markdown(page)).not.toContain(PASSAGE)
})

test('Accept all lands every proposal from a run', async ({ page }) => {
  await noteOnPassage(page, 'Rewrite both.')
  await page.evaluate(() => {
    const queue: Array<{ kind: string; name?: string; args?: Record<string, unknown>; text?: string }> = [
      { kind: 'tool', name: 'apply_transaction', args: { markdown: 'Beta, rewritten.' } },
      { kind: 'tool', name: 'insert_markdown', args: { markdown: 'A closing line.' } },
      { kind: 'text', text: 'Done.' },
    ]
    window.simplemark!.agent.setProviderForTest({
      async complete(input: { scope?: unknown }) {
        const turn = queue.shift()
        if (turn === undefined || turn.kind === 'text') return { kind: 'text', text: turn?.text ?? 'done' }
        return { kind: 'tool', id: `c${queue.length}`, name: turn.name!, args: { ...turn.args, scope: input.scope } }
      },
    })
  })
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await expect(page.locator('.sm-proposal-bar')).toContainText('2 proposed changes')

  await page.locator('[data-action="accept-all-proposals"]').click()
  await expect.poll(() => markdown(page)).toContain('Beta, rewritten.')
  expect(await markdown(page)).toContain('A closing line.')
  await expect(page.locator('.sm-proposal-bar')).toBeHidden()
})

test('markup views draw proposals three ways and never change what is pending', async ({ page }) => {
  await noteOnPassage(page, 'Split this by region.')
  await scriptAgent(page, 'Beta, split by region.')
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await expect(page.locator('.sm-proposal-ins')).toBeVisible()
  await expect(page.locator('.document-surface')).toHaveAttribute('data-proposal-markup', 'all')

  const markup = page.locator('[data-action="proposal-markup"]')
  await markup.selectOption('none')
  await expect(page.locator('.document-surface')).toHaveAttribute('data-proposal-markup', 'none')
  await expect(page.locator('.sm-proposal-ins')).toBeHidden()
  // Hidden is not gone: the bar still counts, and says the markup is hidden.
  await expect(page.locator('.sm-proposal-bar')).toContainText('1 proposed change · markup hidden')
  expect(await markdown(page)).toContain(PASSAGE)

  await markup.selectOption('simple')
  await expect(page.locator('.sm-proposal-ins')).toBeVisible()
  await expect(page.locator('.document-surface')).toHaveAttribute('data-proposal-markup', 'simple')

  // The choice is remembered.
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator('.document-surface')).toHaveAttribute('data-proposal-markup', 'simple')
})
