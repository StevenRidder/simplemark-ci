import { expect, test, type Page } from '@playwright/test'

/**
 * APP-50, ADR-0016 (Tiptap's linking semantics, not its code): a proposal
 * staged from a note carries that note's thread; the card shows its change
 * with Show / Accept / Reject; accepting resolves the note with an agent
 * turn; rejecting says so and leaves the note open; resolving a note with a
 * change still pending is refused, loudly.
 */

const editor = '.milkdown .ProseMirror'
const STATUS = '.status'
const PASSAGE = 'Beta carries the argument that needs work.'
// The open card only: the resolved history row carries the same thread id.
const card = '.sm-note-rail article[data-thread="t1"]'

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
  await expect(page.locator(card)).toHaveCount(1)
}

async function scriptAgent(page: Page, markdown: string): Promise<void> {
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
  }, markdown)
}

const markdown = (page: Page): Promise<string> =>
  page.evaluate(() => {
    window.simplemark!.flushPendingChanges()
    return window.simplemark!.session.snapshot().markdown
  })

async function proposeFromNote(page: Page): Promise<void> {
  await noteOnPassage(page, 'Split this by region.')
  await scriptAgent(page, 'Beta, split by region.')
  await page.locator(`${card} [data-action="ask-agent"]`).click()
  await expect(page.locator('.sm-proposal-bar')).toContainText('1 proposed change')
  await expect(page.locator(`${card} .sm-note-rail-proposal`)).toContainText('Proposed change')
}

test('the note that asked shows its change; Accept on the card lands it and resolves the note', async ({ page }) => {
  await proposeFromNote(page)
  await page.locator(`${card} .sm-note-rail-proposal [data-action="accept-proposal"]`).click()
  await expect(page.locator('.sm-proposal-bar')).toBeHidden()
  expect(await markdown(page)).toContain('Beta, split by region.')
  // Resolved by the acceptance: gone from the open cards, in the history.
  await expect(page.locator(card)).toHaveCount(0)
  await expect(page.locator('.sm-note-rail-resolved summary')).toContainText('1 resolved note')
  // Reopen shows the agent's word in the thread.
  await page.locator('.sm-note-rail-resolved summary').click()
  await page.locator('.sm-note-rail-resolved [data-action="reopen"]').first().click()
  await expect(page.locator(card)).toContainText('Accepted: ')
})

test('Resolve on a note with a change still pending is refused, loudly', async ({ page }) => {
  await proposeFromNote(page)
  await page.locator(`${card} [data-action="resolve"]`).click()
  await expect(page.locator(STATUS)).toHaveAttribute('data-state', 'error')
  await expect(page.locator(STATUS)).toContainText('accept or reject it first')
  await expect(page.locator(card)).toHaveCount(1)
  await expect(page.locator('.sm-proposal-bar')).toContainText('1 proposed change')
})

test('Reject on the card drops the change, says so in the note, and leaves it open', async ({ page }) => {
  await proposeFromNote(page)
  const before = await markdown(page)
  await page.locator(`${card} .sm-note-rail-proposal [data-action="reject-proposal"]`).click()
  await expect(page.locator('.sm-proposal-bar')).toBeHidden()
  await expect(page.locator(`${card} .sm-note-rail-proposal`)).toHaveCount(0)
  await expect(page.locator(card)).toContainText('Rejected: ')
  expect(await markdown(page)).toBe(before)
})
