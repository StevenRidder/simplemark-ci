import { expect, test, type Page } from '@playwright/test'

/**
 * BUG-28. On a note with front matter, the model was shown the front matter
 * and sent the whole note back as its "rewrite" of one bullet; the inserted
 * text began `id: … comments: …` and Accept refused with `invalid_step`. The
 * model now reads the body only, a replacement never carries front matter,
 * a multi-block rewrite of a passage lands, and a refusal says what went
 * wrong in the reader's words.
 */

const editor = '.milkdown .ProseMirror'
const STATUS = '.status'
const MATTER = '---\nid: abc123\ncomments: .simplemark/abc123.json\n---\n\n'
const QUOTE = 'Finding first: the equipment agent already receives every pad well SCADA.'
const BODY = `# Evaluation\n\n- ${QUOTE}\n- Second bullet stays.\n\nClosing paragraph.\n`

async function openFrontMatterNote(page: Page): Promise<void> {
  await page.addInitScript((content: string) => {
    window.showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle('scada.md', { create: true })
      if ((await handle.getFile()).size === 0) {
        const w = await handle.createWritable()
        await w.write(content)
        await w.close()
      }
      return [handle]
    }
  }, MATTER + BODY)
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.getByRole('button', { name: 'Open file' }).click()
  await expect(page.locator('.filename-title')).toHaveText('scada')
  await page.evaluate((quote) => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'abc123', author: 'local', createdAt: '2026-08-22T00:00:00Z', body: 'what am i looking at here',
      anchor: { quote, prefix: '', suffix: '', blockIndex: 1 }, state: 'open' },
  ]), QUOTE)
  await expect(page.locator('.sm-note-rail [data-thread="t1"]')).toHaveCount(1)
}

/** A model that resends the whole note, front matter included, as its rewrite. */
async function scriptWholeNoteRewrite(page: Page): Promise<void> {
  const WHOLE = `${MATTER}# Evaluation\n\n**Decision: do not promote.** It reaches the gate but closes more leaks.\n\n## What happened\n\nOffice-clear cases: 33/96 → 41/96.\n\n- ${QUOTE}\n- Second bullet stays.\n`
  await page.evaluate((markdown) => {
    const queue: Array<{ kind: string; name?: string; args?: Record<string, unknown>; text?: string }> = [
      { kind: 'tool', name: 'apply_transaction', args: { markdown } },
      { kind: 'text', text: 'Added a section.' },
    ]
    window.simplemark!.agent.setProviderForTest({
      async complete(input: { scope?: unknown; noteMarkdown?: string }) {
        ;(window as unknown as { __seen: string | undefined }).__seen = input.noteMarkdown
        const turn = queue.shift()
        if (turn === undefined || turn.kind === 'text') return { kind: 'text', text: turn?.text ?? 'done' }
        return { kind: 'tool', id: 'c1', name: turn.name!, args: { ...turn.args, scope: input.scope } }
      },
    })
  }, WHOLE)
}

const markdown = (page: Page): Promise<string> =>
  page.evaluate(() => {
    window.simplemark!.flushPendingChanges()
    return window.simplemark!.session.snapshot().markdown
  })

test('the model reads the body only, a whole-note rewrite never proposes front matter, and Accept lands it', async ({ page }) => {
  await openFrontMatterNote(page)
  await scriptWholeNoteRewrite(page)
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await expect(page.locator('.sm-proposal-bar')).toContainText('1 proposed change')

  const seen = await page.evaluate(() => String((window as unknown as { __seen?: string }).__seen ?? ''))
  expect(seen.startsWith('# Evaluation')).toBe(true)
  expect(seen).not.toContain('id: abc123')

  // Nothing proposed reads as front matter.
  await expect(page.locator(editor)).not.toContainText('id: abc123')
  await expect(page.locator(editor)).not.toContainText('comments:')

  await page.locator('.sm-proposal-bar [data-action="accept-all-proposals"]').click()
  await expect(page.locator(STATUS)).not.toHaveAttribute('data-state', 'error')
  await expect(page.locator('.sm-proposal-bar')).toBeHidden()
  const after = await markdown(page)
  expect(after.startsWith(MATTER)).toBe(true)
  expect(after.slice(MATTER.length)).not.toContain('---')
  expect(after).toContain('Decision: do not promote.')
  expect(after).toContain('Second bullet stays.')
})

test('a refusal says what went wrong in the reader\'s words', async ({ page }) => {
  await openFrontMatterNote(page)
  await scriptWholeNoteRewrite(page)
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await expect(page.locator('.sm-proposal-bar')).toContainText('1 proposed change')
  // Make the passage disappear so the accept must refuse — and say why.
  await page.evaluate((quote) => window.simplemark!.notes.replaceTextForTest(quote, 'A different sentence entirely.'), QUOTE)
  await page.locator('.sm-proposal-bar [data-action="accept-all-proposals"]').click()
  await expect(page.locator(STATUS)).toHaveAttribute('data-state', 'error')
  await expect(page.locator(STATUS)).toContainText('Could not accept')
  await expect(page.locator(STATUS)).not.toContainText('invalid_')
})
