import { expect, test, type Page } from '@playwright/test'

/**
 * AGENT-9: ask the agent from the passage it should edit.
 *
 * The flow the wireframe specifies and a person reaches for: highlight a
 * passage, note it, and that note is where you say what to do. The note body is
 * the instruction, its anchor is the scope, the edit lands inline, and the
 * answer arrives in the same thread.
 *
 * The first test is the whole feature end to end. The rest are the properties
 * that make it trustworthy rather than merely working.
 */

const editor = '.milkdown .ProseMirror'
const PASSAGE = 'Beta carries the argument that needs work.'

declare global {
  interface Window {
    __agentCalls?: number
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
  await page.keyboard.press('Enter')
  await page.keyboard.type('Gamma closes without repeating anything.')
  await page.evaluate(() => window.simplemark!.flushPendingChanges())

  // An anchored note on that passage — the surface that already ships.
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

async function scriptAgent(page: Page, replacement: string, said: string): Promise<void> {
  await page.evaluate(
    ({ markdown, text }) => {
      const queue = [
        { kind: 'tool', name: 'apply_transaction', args: { markdown } },
        { kind: 'text', text },
      ]
      window.__agentCalls = 0
      window.simplemark!.agent.setProviderForTest({
        async complete(input) {
          window.__agentCalls = (window.__agentCalls ?? 0) + 1
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
    { markdown: replacement, text: said },
  )
}

const markdown = (page: Page): Promise<string> =>
  page.evaluate(() => {
    window.simplemark!.flushPendingChanges()
    return window.simplemark!.session.snapshot().markdown
  })

test('Ask agent edits the noted passage in place and answers in the thread', async ({ page }) => {
  await noteOnPassage(page, 'Split this by region before the customer call.')
  const before = await markdown(page)
  await scriptAgent(page, 'Beta, split by region.', 'Split it into regional claims.')

  const row = page.locator('.sm-note-rail [data-thread="t1"]')
  await row.locator('[data-action="ask-agent"]').click()

  // Inline, in the noted passage — not appended, and the neighbours untouched.
  await expect(page.locator(editor)).toContainText('Beta, split by region.')
  const after = await markdown(page)
  expect(after).not.toContain(PASSAGE)
  expect(after).toContain('Alpha holds the opening claim.')
  expect(after.trimEnd().endsWith('Gamma closes without repeating anything.')).toBe(true)
  expect(after.split('\n\n').length).toBe(before.split('\n\n').length)

  // And the answer is a turn in the same thread, after the note that asked.
  await expect(row.locator('.sm-note-rail-body')).toHaveCount(2)
  await expect(row.locator('.sm-note-rail-body[data-author="agent"]'))
    .toContainText('Split it into regional claims.')
  await expect(row).toHaveAttribute('data-conversation', 'true')
})

test('the note body is the instruction the agent receives', async ({ page }) => {
  await noteOnPassage(page, 'Turn this into a three-step list.')
  await page.evaluate(() => {
    window.__agentCalls = 0
    const probe = window as unknown as { __seen: string }
    probe.__seen = ''
    window.simplemark!.agent.setProviderForTest({
      async complete(input) {
        window.__agentCalls = (window.__agentCalls ?? 0) + 1
        probe.__seen = input.instruction
        return { kind: 'text', text: 'ok' }
      },
    })
  })

  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await page.waitForFunction(() => (window.__agentCalls ?? 0) >= 1)

  expect(await page.evaluate(() => (window as unknown as { __seen: string }).__seen))
    .toBe('Turn this into a three-step list.')
})

test('every note takes replies; Redirect appears once an agent joins', async ({ page }) => {
  await noteOnPassage(page, 'Tighten this.')
  // APP-41: a note is a thread of one from birth — the composer is there, and
  // the only thing missing is a generation to redirect.
  const composer = page.locator('.sm-note-rail-composer')
  await expect(composer).toHaveCount(1)
  await expect(composer.locator('[data-action="leave-note"]')).toBeVisible()
  await expect(composer.locator('[data-action="redirect-now"]')).toHaveCount(0)

  await scriptAgent(page, 'Beta, tightened.', 'Tightened it.')
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await expect(page.locator(editor)).toContainText('Beta, tightened.')

  await expect(composer).toHaveCount(1)
  await expect(composer.locator('[data-action="redirect-now"]')).toBeVisible()
  await expect(composer.locator('[data-action="leave-note"]')).toBeVisible()
})

test('Leave note at the passage posts a turn and runs nothing', async ({ page }) => {
  await noteOnPassage(page, 'Tighten this.')
  await scriptAgent(page, 'Beta, tightened.', 'Tightened it.')
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await expect(page.locator(editor)).toContainText('Beta, tightened.')

  const callsBefore = await page.evaluate(() => window.__agentCalls ?? 0)
  const documentBefore = await markdown(page)

  await page.locator('.sm-note-rail-input').fill('stop')
  await page.locator('[data-action="leave-note"]').click()

  // A message reading "stop" is a message. Nothing ran, nothing changed.
  await expect(page.locator('.sm-note-rail-body[data-mode="note"]')).toContainText('stop')
  expect(await page.evaluate(() => window.__agentCalls ?? 0)).toBe(callsBefore)
  expect(await markdown(page)).toBe(documentBefore)
})

test('an orphaned note refuses to guess a passage', async ({ page }) => {
  await noteOnPassage(page, 'Tighten this.')
  await scriptAgent(page, 'should never land', 'unreachable')

  // A note whose passage is not in this document at all — and under a fresh id.
  // Two things would otherwise hide the orphan: rewording in-session teaches the
  // anchor its new wording rather than staling it (NOTES-9), and reusing `t1`
  // lets `paintNotes` write that live decoration's derived anchor back over the
  // one being set here. Both are the designed behaviour.
  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([
    {
      id: 't2',
      noteKey: 'n',
      author: 'local',
      createdAt: '2026-08-20T00:00:00Z',
      body: 'Tighten this.',
      anchor: {
        quote: 'a passage this document has never contained',
        prefix: '',
        suffix: '',
        blockIndex: 1,
      },
      state: 'open',
    },
  ]))

  const before = await markdown(page)
  const row = page.locator('.sm-note-rail [data-thread="t2"]')
  // An orphan offers reattach rather than Ask agent — there is no passage to
  // scope to, and a near miss is worse than admitting the note is adrift.
  await expect(row).toHaveAttribute('data-orphan', 'true')
  await expect(row.locator('[data-action="reattach"]')).toBeVisible()
  await expect(row.locator('[data-action="ask-agent"]')).toHaveCount(0)
  expect(await page.evaluate(() => window.__agentCalls ?? 0)).toBe(0)
  expect(await markdown(page)).toBe(before)
})

test('Ask agent on a diagram edits that diagram, not the prose around it', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await page.getByRole('button', { name: 'New note' }).click()
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('Intro paragraph that must not move.')
  await page.evaluate(() => window.simplemark!.flushPendingChanges())

  // A real diagram block, added at the end the way an insert does.
  await page.evaluate(() => {
    const base = window.simplemark!.session.snapshot()
    return window.simplemark!.session.applyMarkdown({
      actorId: 'agent',
      name: 'add diagram',
      baseVersion: base.revision,
      markdown: '\n\n```mermaid\nflowchart LR\n  A --> B\n```\n',
    })
  })
  // Wait for the rendered figure, not the source: once a fence renders, its
  // source lives behind the node view and is no longer visible text.
  await expect(page.locator('.diagram-render')).toHaveCount(1)

  // A diagram's source is ordinary anchorable text, so a note grips it exactly
  // as it grips a sentence — the anchor contract does not know about diagrams.
  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([
    {
      id: 'd1',
      noteKey: 'n',
      author: 'local',
      createdAt: '2026-08-20T00:00:00Z',
      body: 'Add a third step, C.',
      anchor: { quote: 'flowchart LR\n  A --> B', prefix: '', suffix: '', blockIndex: 2 },
      state: 'open',
    },
  ]))
  await expect(page.locator('.sm-note-rail [data-thread="d1"]')).toHaveCount(1)

  await scriptAgent(page, '```mermaid\nflowchart LR\n  A --> B\n  B --> C\n```', 'Added step C.')
  await page.locator('.sm-note-rail [data-thread="d1"] [data-action="ask-agent"]').click()

  // The document is the assertion, not the editor's text: a rendered diagram
  // shows the picture, and its source sits behind the node view.
  await expect
    .poll(() => markdown(page), { timeout: 10_000 })
    .toContain('B --> C')
  const after = await markdown(page)
  // Still one fenced block, and still rendered — not source that leaked into the
  // document as plain text.
  expect(after.match(/```mermaid/g)).toHaveLength(1)
  expect(after).toContain('Intro paragraph that must not move.')
  await expect(page.locator('.diagram-render')).toHaveCount(1)
})

test('the agent can turn a paragraph into a chart', async ({ page }) => {
  await noteOnPassage(page, 'Turn this into a flowchart.')

  // Markdown with a fence, supplied into a prose scope: the step port parses it
  // as a real diagram node, so a chart arrives as a chart rather than as text
  // that happens to look like one.
  await scriptAgent(page, '```mermaid\nflowchart LR\n  Beta --> Argument\n```', 'Charted it.')
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()

  // A rendered chart, in the paragraph's place — the picture is the proof, and
  // its labels come from the source the agent supplied.
  await expect(page.locator('.diagram-render')).toHaveCount(1)
  await expect(page.locator('.diagram-render')).toContainText('Beta')
  const after = await markdown(page)
  expect(after).toContain('```mermaid')
  expect(after).toContain('Beta --> Argument')
  expect(after).not.toContain(PASSAGE)
  expect(after).toContain('Alpha holds the opening claim.')
})

test('Ask agent appears only once the note has been written', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await page.getByRole('button', { name: 'New note' }).click()
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type(PASSAGE)
  await page.evaluate(() => window.simplemark!.flushPendingChanges())

  // Add Note creates the thread with an empty body and opens its composer. An
  // Ask agent offered at that moment reads a body the reader is still typing,
  // so pressing it refuses — which reads as the button doing nothing.
  await page.evaluate((quote) => window.simplemark!.notes.setThreadsForTest([
    {
      id: 'draft',
      noteKey: 'n',
      author: 'local',
      createdAt: 'x',
      body: '',
      anchor: { quote, prefix: '', suffix: '', blockIndex: 1 },
      state: 'open',
    },
  ]), PASSAGE)

  const row = page.locator('.sm-note-rail [data-thread="draft"]')
  await expect(row).toHaveCount(1)
  await expect(row.locator('[data-action="ask-agent"]')).toHaveCount(0)
  // Resolve is still there: an empty note is a note, just not an instruction.
  await expect(row.locator('[data-action="resolve"]')).toBeVisible()

  // Once written, the button is there to press.
  await page.evaluate((quote) => window.simplemark!.notes.setThreadsForTest([
    {
      id: 'draft',
      noteKey: 'n',
      author: 'local',
      createdAt: 'x',
      body: 'Rewrite this to be more concrete.',
      anchor: { quote, prefix: '', suffix: '', blockIndex: 1 },
      state: 'open',
    },
  ]), PASSAGE)
  await expect(row.locator('[data-action="ask-agent"]')).toBeVisible()
})

test('turns carry bylines, and a human reply persists on a plain note', async ({ page }) => {
  // A real note, through the real store — the reload leg needs persistence,
  // which the fixture threads deliberately do not have.
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await page.evaluate(() => window.simplemark!.notes.selectTextForTest('This document is the demo.'))
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('needs a second look tomorrow')
  await page.keyboard.press('Enter')

  const row = page.locator('.sm-note-rail article').first()
  // The opening turn is yours, and says so (APP-41).
  await expect(row.locator('.sm-note-rail-byline').first()).toContainText('You')

  await row.locator('.sm-note-rail-input').fill('checked — still true after the call')
  await row.locator('[data-action="leave-note"]').click()
  await expect(row).toContainText('checked — still true after the call')
  await expect(row.locator('.sm-note-rail-byline')).toHaveCount(2)

  // A reply is a stored turn, not a rendering — it survives a reload.
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  const after = page.locator('.sm-note-rail article').first()
  await expect(after).toContainText('checked — still true after the call')
  await expect(after.locator('.sm-note-rail-byline').nth(1)).toContainText('You')
})
