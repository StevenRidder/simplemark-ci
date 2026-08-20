import { expect, test, type Page } from '@playwright/test'

/**
 * APP-32's six exit criteria, as browser tests.
 *
 * Each one is a claim about the whole path — composer to fence to authority to
 * the visible document — not about a unit. The provider is scripted rather than
 * live, for two reasons that are about honesty rather than convenience: a real
 * model cannot be asked to be ambiguous on demand, and three of these six
 * assert that *nothing* was written, which a nondeterministic model can pass by
 * luck. The real provider's own request shape is pinned separately, in
 * `tests/adapters/openai-responses-agent.test.ts`.
 */

const editor = '.milkdown .ProseMirror'

/** Three paragraphs, each occurring once, so a target is unambiguous. */
const FIRST = 'Alpha holds the opening claim.'
const SECOND = 'Beta carries the argument that needs work.'
const THIRD = 'Gamma closes without repeating anything.'

interface ScriptedTurn {
  readonly kind: 'tool' | 'text'
  readonly id?: string
  readonly name?: string
  readonly args?: Record<string, unknown>
  readonly text?: string
}

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
  // A new note opens with its title heading focused; typing straight away would
  // append to the H1 rather than starting a paragraph.
  await page.keyboard.press('Enter')
  await page.keyboard.type(FIRST)
  await page.keyboard.press('Enter')
  await page.keyboard.type(SECOND)
  await page.keyboard.press('Enter')
  await page.keyboard.type(THIRD)
  await page.evaluate(() => window.simplemark!.flushPendingChanges())
  await expect(page.locator(editor)).toContainText(SECOND)
}

/**
 * Installs a scripted provider.
 *
 * `gateFirstCall` makes the first turn wait until the test releases it, which
 * is how "typing while the agent works" gets a real overlap rather than a
 * simulated one.
 */
async function scriptProvider(
  page: Page,
  script: readonly ScriptedTurn[],
  options: { readonly gateFirstCall?: boolean } = {},
): Promise<void> {
  await page.evaluate(
    ({ script, gateFirstCall }) => {
      const queue = [...script]
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
          if (turn === undefined) return { kind: 'text', text: 'done' }
          if (turn.kind === 'text') return { kind: 'text', text: turn.text ?? 'done' }
          return {
            kind: 'tool',
            id: turn.id ?? 'call',
            name: turn.name ?? 'read_note',
            // The authority issues the scope; the model only ever echoes it.
            args: { ...(turn.args ?? {}), scope: input.scope },
          }
        },
      })
    },
    { script: script as ScriptedTurn[], gateFirstCall: options.gateFirstCall === true },
  )
}

const markdown = (page: Page): Promise<string> =>
  page.evaluate(() => {
    window.simplemark!.flushPendingChanges()
    return window.simplemark!.session.snapshot().markdown
  })

const providerCalls = (page: Page): Promise<number> =>
  page.evaluate(() => window.__agentCalls ?? 0)

test.beforeEach(async ({ page }) => {
  await openNote(page)
})

test('a highlighted paragraph is edited in place with nothing appended below', async ({ page }) => {
  const before = await markdown(page)
  await scriptProvider(page, [
    { kind: 'tool', name: 'apply_transaction', args: { markdown: 'Beta, rewritten in place.' } },
    { kind: 'text', text: 'Rewrote the selected paragraph.' },
  ])

  expect(await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), SECOND))
    .toBe(true)
  await page.evaluate(() => window.simplemark!.agent.send('redirect', 'rewrite this'))
  await expect(page.locator(editor)).toContainText('Beta, rewritten in place.')

  const after = await markdown(page)
  expect(after).toContain('Beta, rewritten in place.')
  expect(after).not.toContain(SECOND)
  // Nothing appended: the paragraph after the target is still the last thing in
  // the document, and the block count did not grow.
  expect(after.trimEnd().endsWith(THIRD)).toBe(true)
  expect(after.split('\n\n').length).toBe(before.split('\n\n').length)
})

test('pasting a paragraph into the composer edits that paragraph, not the end', async ({ page }) => {
  const before = await markdown(page)
  await scriptProvider(page, [
    { kind: 'tool', name: 'apply_transaction', args: { markdown: 'Beta, tightened.' } },
    { kind: 'text', text: 'Tightened it.' },
  ])

  // No selection at all. The pasted paragraph is the only thing pointing at a
  // target, and the application — not the model — resolves it.
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.evaluate((paste) => window.simplemark!.agent.send('redirect', paste), SECOND)
  await expect(page.locator(editor)).toContainText('Beta, tightened.')

  const after = await markdown(page)
  expect(after).not.toContain(SECOND)
  // The give-away for "edited the end instead": Gamma would no longer be last.
  expect(after.trimEnd().endsWith(THIRD)).toBe(true)
  expect(after.split('\n\n').length).toBe(before.split('\n\n').length)
  expect(after).toContain(FIRST)
})

test('an instruction with no referent appends and leaves existing blocks byte-identical', async ({ page }) => {
  const before = await markdown(page)
  await scriptProvider(page, [
    { kind: 'tool', name: 'insert_markdown', args: { markdown: 'Delta was added at the end.' } },
    { kind: 'text', text: 'Added a closing line.' },
  ])

  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.evaluate(() => window.simplemark!.agent.send('redirect', 'add a closing line'))
  await expect(page.locator(editor)).toContainText('Delta was added at the end.')

  const after = await markdown(page)
  // Byte-identical, not merely "still contains": an append that renormalised
  // the blocks it did not touch would fail D7 while looking correct on screen.
  expect(after.startsWith(before.trimEnd())).toBe(true)
  expect(after).toContain('Delta was added at the end.')
})

test('text appearing twice asks which, and edits nothing until answered', async ({ page }) => {
  // Give the document a phrase that genuinely occurs twice.
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('Beta carries the argument that needs work.')
  await page.evaluate(() => window.simplemark!.flushPendingChanges())

  const before = await markdown(page)
  await scriptProvider(page, [
    { kind: 'tool', name: 'apply_transaction', args: { markdown: 'Chosen occurrence rewritten.' } },
    { kind: 'text', text: 'Rewrote the one you picked.' },
  ])

  await page.evaluate(() => window.simplemark!.agent.toggle())
  await page.evaluate(
    (quote) => window.simplemark!.agent.send('redirect', `tighten "${quote}"`),
    SECOND,
  )

  const question = page.locator('.sm-agent-question[data-reason="ambiguous"]')
  await expect(question).toBeVisible()
  await expect(question).toContainText('Which one?')
  // Nothing was edited, and the model was never even asked: the target is
  // resolved before a scope is issued, so there is nothing to undo.
  expect(await markdown(page)).toBe(before)
  expect(await providerCalls(page)).toBe(0)

  const choices = question.locator('[data-action="answer-question"]')
  await expect(choices).toHaveCount(2)
  await choices.nth(1).click()

  await expect(page.locator(editor)).toContainText('Chosen occurrence rewritten.')
  const after = await markdown(page)
  // The second occurrence was replaced; the first survived untouched.
  expect(after).toContain(SECOND)
  expect(after).toContain('Chosen occurrence rewritten.')
})

test('typing while the agent works keeps both changes', async ({ page }) => {
  await scriptProvider(
    page,
    [
      { kind: 'tool', name: 'apply_transaction', args: { markdown: 'Beta, rewritten by the agent.' } },
      { kind: 'text', text: 'Done.' },
    ],
    { gateFirstCall: true },
  )

  expect(await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), SECOND))
    .toBe(true)
  await page.evaluate(() => window.simplemark!.agent.send('redirect', 'rewrite this'))
  await page.waitForFunction(() => (window.__agentCalls ?? 0) >= 1)

  // The reader types while the run is genuinely in flight, so the agent's
  // transaction arrives against a revision that has already moved on.
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.type(' Typed during the run.')
  await page.evaluate(() => window.simplemark!.flushPendingChanges())

  await page.evaluate(() => window.__agentRelease?.())
  await expect(page.locator(editor)).toContainText('Beta, rewritten by the agent.')

  const after = await markdown(page)
  // Both survive. A guard that refused the stale write, or a write that
  // clobbered the document, would lose one of these.
  expect(after).toContain('Typed during the run.')
  expect(after).toContain('Beta, rewritten by the agent.')
  expect(after).toContain(FIRST)
})

test('Pause stops further writes without ending the run', async ({ page }) => {
  await scriptProvider(page, [
    { kind: 'tool', name: 'apply_transaction', args: { markdown: 'First agent write.' } },
    { kind: 'tool', name: 'insert_markdown', args: { markdown: 'Second agent write.' } },
    { kind: 'text', text: 'Both landed.' },
  ], { gateFirstCall: true })

  expect(await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), SECOND))
    .toBe(true)
  await page.evaluate(() => window.simplemark!.agent.send('redirect', 'rewrite this'))
  await page.waitForFunction(() => (window.__agentCalls ?? 0) >= 1)

  // Pause while the model is still being asked — the press a reader can
  // physically make, and the one that used to be dropped.
  await page.evaluate(() => window.simplemark!.agent.pause())
  await page.evaluate(() => window.__agentRelease?.())

  const status = page.locator('.sm-agent-status[data-status="paused"]')
  await expect(status).toBeVisible()
  await expect(status.locator('[data-action="resume"]')).toBeVisible()

  const paused = await markdown(page)
  const callsWhilePaused = await providerCalls(page)
  // Held, not ended: still running, and no further model call is made.
  expect(await page.evaluate(() => window.simplemark!.agent.isRunning())).toBe(true)
  await page.waitForTimeout(200)
  expect(await providerCalls(page)).toBe(callsWhilePaused)
  expect(await markdown(page)).toBe(paused)

  await status.locator('[data-action="resume"]').click()
  await expect(page.locator(editor)).toContainText('Second agent write.')
  expect(await markdown(page)).toContain('First agent write.')
})
