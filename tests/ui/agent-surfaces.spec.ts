import { expect, test, type Page } from '@playwright/test'

/**
 * The surfaces APP-32 adds, and the constraints ADR-0012 granted them under.
 *
 * The first three tests are the price of the amendment: `DESIGN.md` §9 forbids a
 * permanent chat rail, and the panel was allowed only because it is absent until
 * asked for, never opens itself, and never takes focus. Those are exactly the
 * properties that decay quietly, so they are asserted rather than described.
 */

const editor = '.milkdown .ProseMirror'
const PASSAGE = 'Beta carries the argument that needs work.'

declare global {
  interface Window {
    __agentCalls?: number
    __agentRelease?: () => void
  }
}

async function openNote(page: Page): Promise<void> {
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
}

async function scriptOneEdit(
  page: Page,
  replacement: string,
  options: { readonly gateFirstCall?: boolean } = {},
): Promise<void> {
  await page.evaluate(
    ({ markdown, gateFirstCall }) => {
      const queue = [
        { kind: 'tool', id: 'c1', name: 'apply_transaction', args: { markdown } },
        { kind: 'text', text: 'Rewrote it.' },
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
            id: turn.id!,
            name: turn.name!,
            args: { ...turn.args, scope: input.scope },
          }
        },
      })
    },
    { markdown: replacement, gateFirstCall: options.gateFirstCall === true },
  )
}

test.beforeEach(async ({ page }) => {
  await openNote(page)
})

test('with the panel never opened, no panel element exists at all', async ({ page }) => {
  // Absent from the layout, not present and empty — the same standard the notes
  // rail is held to. A hidden-but-present panel would fail the rule the
  // amendment was granted under.
  await expect(page.locator('.sm-agent-panel')).toHaveCount(0)
  await expect(page.locator('.sm-agent-composer')).toHaveCount(0)
  expect(await page.evaluate(() => window.simplemark!.agent.isPanelOpen())).toBe(false)

  await page.evaluate(() => window.simplemark!.agent.toggle())
  await expect(page.locator('.sm-agent-panel')).toHaveCount(1)

  // Closing removes it again rather than hiding it.
  await page.locator('[data-action="close-panel"]').click()
  await expect(page.locator('.sm-agent-panel')).toHaveCount(0)
})

test('a run neither opens the panel nor moves the page', async ({ page }) => {
  await scriptOneEdit(page, 'Beta, rewritten while the panel was shut.', { gateFirstCall: true })
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  const focusedBefore = await page.evaluate(() => document.activeElement?.className ?? '')

  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), PASSAGE)
  await page.evaluate(() => window.simplemark!.agent.send('redirect', 'rewrite this'))
  await page.waitForFunction(() => (window.__agentCalls ?? 0) >= 1)

  // Mid-run: the reader is told by the status line, and nothing else moved.
  await expect(page.locator('.sm-agent-status')).toHaveCount(1)
  await expect(page.locator('.sm-agent-panel')).toHaveCount(0)
  expect(await page.evaluate(() => window.simplemark!.agent.isPanelOpen())).toBe(false)
  expect(await page.evaluate(() => document.activeElement?.className ?? '')).toBe(focusedBefore)
  // Follow is off unless asked for, which is what keeps the page still.
  expect(await page.evaluate(() => window.simplemark!.agent.isFollowing())).toBe(false)

  await page.evaluate(() => window.__agentRelease?.())
  await expect(page.locator(editor)).toContainText('Beta, rewritten while the panel was shut.')

  // And once it is over the line goes away: no run, no status line. A permanent
  // "Finished" bar is the status rail DESIGN.md forbids.
  await expect(page.locator('.sm-agent-status')).toHaveCount(0)
  await expect(page.locator('.sm-agent-panel')).toHaveCount(0)
})

test('Leave note posts a message and has no control effect', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.agent.toggle())
  await scriptOneEdit(page, 'never asked for')

  // A message whose text reads "stop" is still only a message.
  await page.evaluate(() => window.simplemark!.agent.send('note', 'stop'))

  const message = page.locator('.sm-agent-message[data-author="you"]')
  await expect(message).toHaveCount(1)
  await expect(message).toHaveAttribute('data-mode', 'note')
  // Nothing ran: no model call, and no status line, because there is no run.
  expect(await page.evaluate(() => window.__agentCalls ?? 0)).toBe(0)
  await expect(page.locator('.sm-agent-status')).toHaveCount(0)
  expect(await page.evaluate(() => window.simplemark!.agent.isRunning())).toBe(false)
})

test('a conversation message renders Markdown and is corrected in place', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.agent.toggle())
  await page.evaluate(() => window.simplemark!.agent.send('note', 'use a **table** here'))

  const body = page.locator('.sm-agent-message[data-author="you"] .sm-agent-message-body')
  // Through the document's own parser and schema, so a message looks like the
  // note it is talking about.
  await expect(body.locator('strong')).toHaveText('table')

  await page.locator('[data-action="edit-message"]').first().click()
  const input = page.locator('.sm-agent-message-input')
  await input.fill('use a *list* here instead')
  await page.locator('[data-action="save-message"]').click()

  // One message, corrected — not two with a retraction below.
  await expect(page.locator('.sm-agent-message[data-author="you"]')).toHaveCount(1)
  await expect(body.locator('em')).toHaveText('list')
  await expect(page.locator('.sm-agent-message[data-author="you"]'))
    .toHaveAttribute('data-edited', 'true')
})

test('a block edited by both lists both, most recent first', async ({ page }) => {
  await scriptOneEdit(page, 'Beta, polished by the agent.')
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), PASSAGE)
  await page.evaluate(() => window.simplemark!.agent.send('redirect', 'polish this'))
  await expect(page.locator(editor)).toContainText('Beta, polished by the agent.')

  const chips = page.locator('.sm-margin-chips').first()
  await expect(chips).toBeVisible()
  await expect(chips.locator('.sm-margin-chip')).toHaveText(['agent'])

  // The reader then edits the same block. Both authors are named, the newest
  // first, and neither is collapsed away.
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.type(' And a human sentence.')
  await page.evaluate(() => window.simplemark!.flushPendingChanges())

  const attribution = await page.evaluate(() => window.simplemark!.editor.blockAttribution())
  const both = attribution.find((block) => block.actors.length > 1)
  expect(both?.actors).toEqual(['you', 'agent'])
})

test('a document only a person has edited carries no attribution at all', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.type(' More of my own writing.')
  await page.evaluate(() => window.simplemark!.flushPendingChanges())

  // With no agent in the room the window looks exactly as it did before this
  // feature existed. Chips on every block a person touched would say nothing.
  await expect(page.locator('.sm-margin-chips')).toHaveCount(0)
  expect(await page.evaluate(() => window.simplemark!.editor.blockAttribution())).toEqual([])
})

test('the note row says an agent edited it, and how many changes', async ({ page }) => {
  await scriptOneEdit(page, 'Beta, edited once.')
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), PASSAGE)
  await page.evaluate(() => window.simplemark!.agent.send('redirect', 'rewrite this'))
  await expect(page.locator(editor)).toContainText('Beta, edited once.')

  // Counted against the note, which is the only surface that can report an edit
  // to a note nobody is looking at.
  const edits = await page.evaluate(() => window.simplemark!.agent.editsForTest())
  expect(Object.values(edits)).toEqual([1])
})

test('with no provider configured the panel says so instead of going quiet', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.agent.setProviderForTest(undefined))
  await page.evaluate(() => window.simplemark!.agent.toggle())

  const missing = page.locator('.sm-agent-unconfigured[data-state="unconfigured"]')
  await expect(missing).toBeVisible()
  await expect(page.locator('.sm-agent-send')).toBeDisabled()
})

test('the note-row marker survives the remount that opening a note performs', async ({ page }) => {
  // The whole point of this marker is reporting an edit to a note the reader is
  // not looking at — so it has to outlive a note switch, which tears down and
  // rebuilds the entire composition.
  const edited = await page.evaluate(() => {
    const active = document.querySelector('.note-item.selected')
    return active?.getAttribute('data-note-id') ?? ''
  })
  expect(edited).not.toBe('')

  await scriptOneEdit(page, 'Beta, edited before switching away.')
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), PASSAGE)
  await page.evaluate(() => window.simplemark!.agent.send('redirect', 'rewrite this'))
  await expect(page.locator(editor)).toContainText('Beta, edited before switching away.')

  const marker = page.locator(
    `.note-item[data-note-id="${edited}"] .note-agent-status[data-agent-changes="1"]`,
  )
  await expect(marker).toHaveCount(1)

  // Switch to another note. The composition is rebuilt and the rows repaint
  // from the catalog; the marker has to come back with them.
  const other = page.locator(`.note-item:not([data-note-id="${edited}"]) .note-select`).first()
  await other.click()
  await expect(page.locator(`.note-item[data-note-id="${edited}"].selected`)).toHaveCount(0)
  await expect(marker).toHaveCount(1)
})

test('a Redirect naming a different passage edits that one, not the first', async ({ page }) => {
  const FIRST = 'Alpha holds the opening claim.'
  await page.evaluate(
    ({ first, second }) => {
      const queue = [
        { kind: 'tool', name: 'apply_transaction', args: { markdown: 'SHOULD NOT LAND' } },
        { kind: 'tool', name: 'apply_transaction', args: { markdown: 'Alpha, redirected.' } },
        { kind: 'text', text: 'Done.' },
      ]
      let released = false
      window.__agentCalls = 0
      window.__agentRelease = () => {
        released = true
      }
      window.simplemark!.agent.setProviderForTest({
        async complete(input) {
          window.__agentCalls = (window.__agentCalls ?? 0) + 1
          // Hold the first turn until the redirect has been issued, so the
          // second turn is the one that writes.
          while (!released) await new Promise((resolve) => setTimeout(resolve, 10))
          const turn = queue.shift()
          if (turn === undefined || turn.kind === 'text') {
            return { kind: 'text', text: 'done' }
          }
          return {
            kind: 'tool',
            id: 'c',
            name: turn.name!,
            args: { ...turn.args, scope: input.scope },
          }
        },
      })
      void first
      void second
    },
    { first: FIRST, second: PASSAGE },
  )

  // Start against the second paragraph, then redirect at the first.
  await page.evaluate((quote) => window.simplemark!.agent.send('redirect', `tighten "${quote}"`), PASSAGE)
  await page.waitForFunction(() => (window.__agentCalls ?? 0) >= 1)
  await page.evaluate((quote) => window.simplemark!.agent.send('redirect', `tighten "${quote}"`), FIRST)
  await page.evaluate(() => window.__agentRelease?.())

  await expect(page.locator(editor)).toContainText('Alpha, redirected.')
  const after = await page.evaluate(() => {
    window.simplemark!.flushPendingChanges()
    return window.simplemark!.session.snapshot().markdown
  })
  // The replacement work went where the *new* instruction pointed. Resolving the
  // target once, at the start, would have rewritten the second paragraph.
  expect(after).toContain('Alpha, redirected.')
  expect(after).toContain(PASSAGE)
  expect(after).not.toContain('SHOULD NOT LAND')
})

test('an arriving message does not wipe a correction being typed', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.agent.toggle())
  await page.evaluate(() => window.simplemark!.agent.send('note', 'original body'))
  await page.locator('[data-action="edit-message"]').first().click()

  const input = page.locator('.sm-agent-message-input')
  await input.fill('half-written correcti')

  // The agent answers while the reader is mid-word. A repaint that rebuilt the
  // box from the stored message would throw the correction away.
  await page.evaluate(() => window.simplemark!.agent.send('note', 'unrelated later message'))
  await expect(input).toHaveValue('half-written correcti')

  await input.fill('half-written correction, finished')
  await page.locator('[data-action="save-message"]').click()
  await expect(page.locator('.sm-agent-message[data-message="message-1"]'))
    .toContainText('half-written correction, finished')
})

test('the composer’s own Send button is reachable and works', async ({ page }) => {
  // Driven by clicking, not by calling `agent.send`: the floating styles bar
  // sits at the bottom of the same surface and covered this button, so every
  // test that called the harness directly passed while a person could not press
  // it at all.
  // A configured provider, because Send is correctly dead without one — which is
  // what the unconfigured test above asserts.
  await scriptOneEdit(page, 'unused')
  await page.evaluate(() => window.simplemark!.agent.toggle())
  const input = page.locator('.sm-agent-composer-input')
  await input.fill('a message typed into the composer')

  const send = page.locator('.sm-agent-send')
  await expect(send).toBeEnabled()
  await send.click()

  await expect(page.locator('.sm-agent-message[data-author="you"]')).toHaveCount(1)
  await expect(page.locator('.sm-agent-message[data-author="you"]'))
    .toContainText('a message typed into the composer')
  // The composer clears, so the next message is not the previous one again.
  await expect(input).toHaveValue('')
})

test('switching the composer mode changes what Send says it will do', async ({ page }) => {
  await scriptOneEdit(page, 'unused')
  await page.evaluate(() => window.simplemark!.agent.toggle())
  // The label is the guard against conflating the two modes.
  await expect(page.locator('.sm-agent-send')).toHaveText('Leave note')

  await page.locator('[data-action="mode-redirect"]').click()
  await expect(page.locator('.sm-agent-send')).toHaveText('Redirect')
  await expect(page.locator('.sm-agent-composer')).toHaveAttribute('data-mode', 'redirect')
})
