import { expect, test, type Page } from '@playwright/test'

/**
 * BUG-29. An accepted agent change reached the editor and the session but was
 * never written to disk: the autosave was scheduled only from the human-typing
 * callback, which an agent edit does not fire. The change lived in memory and
 * the old file won on the next open. An accepted change now schedules a save
 * like a keystroke would.
 */

const MATTER = '---\nid: abc123\ncomments: .simplemark/abc123.json\n---\n\n'
const QUOTE = 'Finding first: the equipment agent receives every signal.'
const BODY = `# Evaluation\n\n- ${QUOTE}\n- Second bullet stays.\n\nClosing paragraph.\n`

async function open(page: Page): Promise<void> {
  await page.addInitScript((content: string) => {
    window.showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle('scada.md', { create: true })
      if ((await handle.getFile()).size === 0) {
        const w = await handle.createWritable(); await w.write(content); await w.close()
      }
      ;(window as unknown as { __readFile: () => Promise<string> }).__readFile =
        async () => (await (await root.getFileHandle('scada.md')).getFile()).text()
      return [handle]
    }
  }, MATTER + BODY)
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.getByRole('button', { name: 'Open file' }).click()
  await expect(page.locator('.filename-title')).toHaveText('scada')
}

const diskText = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __readFile: () => Promise<string> }).__readFile())

test('an accepted agent change is written to disk without a keystroke', async ({ page }) => {
  await open(page)
  expect(await diskText(page)).not.toContain('Executive summary')
  await page.evaluate((quote) => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'abc123', author: 'local', createdAt: '2026-08-22T00:00:00Z', body: 'add a summary',
      anchor: { quote, prefix: '', suffix: '', blockIndex: 1 }, state: 'open' },
  ]), QUOTE)
  await page.evaluate(() => {
    const queue = [{ kind: 'tool', name: 'insert_markdown', args: { markdown: '## Executive summary\n\nDo not promote.' } }, { kind: 'text', text: 'Added a section.' }]
    window.simplemark!.agent.setProviderForTest({
      async complete(input: { scope?: unknown }) {
        const t = queue.shift() as { kind: string; name?: string; args?: Record<string, unknown>; text?: string } | undefined
        if (t === undefined || t.kind === 'text') return { kind: 'text', text: t?.text ?? 'done' }
        return { kind: 'tool', id: 'c1', name: t.name!, args: { ...t.args, scope: input.scope } }
      },
    })
  })
  await page.locator('.sm-note-rail [data-thread="t1"] [data-action="ask-agent"]').click()
  await expect(page.locator('.sm-proposal-bar')).toContainText('1 proposed change')
  await page.locator('.sm-proposal-bar [data-action="accept-all-proposals"]').click()

  // No manual flush, no keystroke — the debounced save must run on its own.
  await expect.poll(async () => (await diskText(page)).includes('Executive summary'), { timeout: 4000 }).toBe(true)
  const onDisk = await diskText(page)
  expect(onDisk.startsWith(MATTER)).toBe(true)
  expect(onDisk.slice(MATTER.length)).not.toContain('---')
  expect(onDisk).toContain('Second bullet stays.')
})
