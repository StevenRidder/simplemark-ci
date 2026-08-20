import { expect, test, type Page } from '@playwright/test'

/**
 * AGENT-10: the Activity timeline, and the agent's visible scope.
 *
 * The wireframe's fifth surface — "named transactions you can inspect, jump to,
 * or revert, opened deliberately" — plus the thing that makes it worth opening:
 * rows that say what the change was for.
 */

const editor = '.milkdown .ProseMirror'
const PASSAGE = 'Beta carries the argument that needs work.'

declare global {
  interface Window {
    __agentCalls?: number
    __agentRelease?: () => void
  }
}

async function noteOnPassage(page: Page, body: string): Promise<void> {
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
      {
        id: 't1',
        noteKey: 'n',
        author: 'local',
        createdAt: '2026-08-20T00:00:00Z',
        body: note,
        anchor: { quote, prefix: '', suffix: '', blockIndex: 1 },
        state: 'open',
      },
    ]),
    { quote: PASSAGE, note: body },
  )
  await expect(page.locator('.sm-note-rail [data-thread="t1"]')).toHaveCount(1)
}

async function scriptAgent(
  page: Page,
  replacement: string,
  said: string,
  options: { readonly gateFirstCall?: boolean } = {},
): Promise<void> {
  await page.evaluate(
    ({ markdown, text, gateFirstCall }) => {
      const queue = [
        { kind: 'tool', name: 'apply_transaction', args: { markdown } },
        { kind: 'text', text },
      ]
      window.__agentCalls = 0
      let gate: Promise<void> | undefined
      if (gateFirstCall === true) {
        gate = new Promise<void>((resolve) => {
          window.__agentRelease = resolve
        })
      }
      window.simplemark!.agent.setProviderForTest({
        async complete(input) {
          window.__agentCalls = (window.__agentCalls ?? 0) + 1
          if (gate !== undefined) {
            const waiting = gate
            gate = undefined
            await waiting
          }
          const turn = queue.shift()
          if (turn === undefined || turn.kind === 'text') {
            return { kind: 'text', text: turn?.text ?? 'done' }
          }
          return {
            kind: 'tool',
            id: 'c1',
            name: turn.name!,
            args: { ...turn.args, scope: input.scope },
          }
        },
      })
    },
    { markdown: replacement, text: said, gateFirstCall: options.gateFirstCall === true },
  )
}

const markdown = (page: Page): Promise<string> =>
  page.evaluate(() => {
    window.simplemark!.flushPendingChanges()
    return window.simplemark!.session.snapshot().markdown
  })

test('the timeline does not exist until it is opened', async ({ page }) => {
  await noteOnPassage(page, 'Tighten this.')
  // DESIGN.md §9 forbids a resident activity rail, so this is absent rather
  // than present and empty.
  await expect(page.locator('.sm-activity')).toHaveCount(0)

  await page.evaluate(() => window.simplemark!.agent.toggleActivity())
  await expect(page.locator('.sm-activity')).toHaveCount(1)

  await page.locator('[data-action="close-activity"]').click()
  await expect(page.locator('.sm-activity')).toHaveCount(0)
})

test('an agent change is named for what was asked, not for the tool', async ({ page }) => {
  await noteOnPassage(page, 'Split this by region.')
  await scriptAgent(page, 'Beta, split by region.', 'Done.')
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await expect(page.locator(editor)).toContainText('Beta, split by region.')

  await page.evaluate(() => window.simplemark!.agent.toggleActivity())
  const agentRow = page.locator('.sm-activity-row[data-actor="agent"]').first()
  await expect(agentRow).toHaveCount(1)
  // The instruction, and the passage it acted on — not "Agent edit".
  await expect(agentRow.locator('.sm-activity-name')).toContainText('Split this by region.')
  await expect(agentRow.locator('.sm-activity-name')).not.toContainText('apply_transaction')
})

test('reverting the agent’s last change restores the passage', async ({ page }) => {
  await noteOnPassage(page, 'Split this by region.')
  await scriptAgent(page, 'Beta, split by region.', 'Done.')
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await expect(page.locator(editor)).toContainText('Beta, split by region.')

  await page.evaluate(() => window.simplemark!.agent.toggleActivity())
  const agentRow = page.locator('.sm-activity-row[data-actor="agent"]').first()
  await agentRow.locator('[data-action="revert"]').click()

  await expect
    .poll(() => markdown(page), { timeout: 10_000 })
    .toContain(PASSAGE)
  const after = await markdown(page)
  expect(after).not.toContain('Beta, split by region.')
  // The rest of the document is untouched — a revert, not a snapshot restore.
  expect(after).toContain('Alpha holds the opening claim.')
  await expect(agentRow.locator('.sm-activity-reverted')).toBeVisible()
})

test('a change something else came after says so instead of offering Revert', async ({ page }) => {
  await noteOnPassage(page, 'Split this by region.')
  await scriptAgent(page, 'Beta, split by region.', 'Done.')
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await expect(page.locator(editor)).toContainText('Beta, split by region.')

  // Anything typed after it supersedes it. Reverting past a later editor batch
  // is not yet trustworthy — replaying that batch under a headless rebase does
  // not reproduce a block added afterwards, which then vanishes (BUG-9). The
  // timeline refuses rather than risking a paragraph.
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('A paragraph of my own.')
  await page.evaluate(() => window.simplemark!.flushPendingChanges())

  await page.evaluate(() => window.simplemark!.agent.toggleActivity())
  const agentRow = page.locator('.sm-activity-row[data-actor="agent"]').first()
  await expect(agentRow.locator('[data-action="revert"]')).toHaveCount(0)
  await expect(agentRow.locator('.sm-activity-unavailable'))
    .toHaveText('superseded by later edits')
  // And nothing was lost by refusing.
  expect(await markdown(page)).toContain('A paragraph of my own.')
  expect(await markdown(page)).toContain('Beta, split by region.')
})

test('a row with no stored inverse says so instead of offering Revert', async ({ page }) => {
  await noteOnPassage(page, 'Tighten this.')
  // Live typing is recorded without an inverse on purpose: human undo is the
  // editor's own history, and re-inverting every keystroke would re-parse the
  // document each time.
  await page.evaluate(() => window.simplemark!.agent.toggleActivity())
  const humanRows = page.locator('.sm-activity-row[data-revertible="false"]')
  await expect(humanRows.first()).toBeVisible()
  await expect(humanRows.first().locator('[data-action="revert"]')).toHaveCount(0)
  await expect(humanRows.first().locator('.sm-activity-unavailable')).toBeVisible()
})

test('the agent’s scope is visible while it works, and gone when it stops', async ({ page }) => {
  await noteOnPassage(page, 'Tighten this.')
  await scriptAgent(page, 'Beta, tightened.', 'Done.', { gateFirstCall: true })

  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await page.waitForFunction(() => (window.__agentCalls ?? 0) >= 1)

  // Mid-run: the passage it holds is marked, so "where is it working" has an
  // answer without the page moving to show you.
  const scope = page.locator('.sm-agent-scope')
  await expect(scope).toHaveCount(1)
  await expect(scope).toContainText('Beta carries')
  expect(await page.evaluate(() => window.simplemark!.agent.isFollowing())).toBe(false)

  await page.evaluate(() => window.__agentRelease?.())
  await expect(page.locator(editor)).toContainText('Beta, tightened.')
  // A finished run holds nothing, so nothing claims it does.
  await expect(page.locator('.sm-agent-scope')).toHaveCount(0)
})

test('Escape closes the open side panel, and only one is ever open', async ({ page }) => {
  await noteOnPassage(page, 'Tighten this.')

  // Both pin to the same corner at the same width, so two at once would put one
  // on top of the other's close button — a box with no visible way out.
  await page.evaluate(() => window.simplemark!.agent.toggle())
  await expect(page.locator('.sm-agent-panel')).toHaveCount(1)
  await page.evaluate(() => window.simplemark!.agent.toggleActivity())
  await expect(page.locator('.sm-activity')).toHaveCount(1)
  await expect(page.locator('.sm-agent-panel')).toHaveCount(0)

  // Escape is the way out that needs no aiming.
  await page.locator('.milkdown .ProseMirror').press('Escape')
  await expect(page.locator('.sm-activity')).toHaveCount(0)

  await page.evaluate(() => window.simplemark!.agent.toggle())
  await expect(page.locator('.sm-agent-panel')).toHaveCount(1)
  await page.locator('.milkdown .ProseMirror').press('Escape')
  await expect(page.locator('.sm-agent-panel')).toHaveCount(0)
  expect(await page.evaluate(() => window.simplemark!.agent.isPanelOpen())).toBe(false)
})

test('Ask agent says why when it will not run', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await page.getByRole('button', { name: 'New note' }).click()
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type(PASSAGE)
  await page.evaluate(() => window.simplemark!.flushPendingChanges())

  // An empty note body: nothing to instruct with. Pressing Ask agent used to
  // return in silence, which is indistinguishable from a hang.
  await page.evaluate((quote) => window.simplemark!.notes.setThreadsForTest([
    {
      id: 'empty',
      noteKey: 'n',
      author: 'local',
      createdAt: 'x',
      body: '   ',
      anchor: { quote, prefix: '', suffix: '', blockIndex: 1 },
      state: 'open',
    },
  ]), PASSAGE)

  await page.locator('.sm-note-rail [data-thread="empty"] [data-action="ask-agent"]').click()
  await expect(page.locator('.sm-note-rail [data-thread="empty"] .sm-note-rail-body[data-author="agent"]'))
    .toContainText('This note is empty')
})
