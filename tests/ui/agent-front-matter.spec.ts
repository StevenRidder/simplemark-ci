import { expect, test } from '@playwright/test'

/**
 * BUG-23. Every note that has ever taken a note carries front matter (the
 * `id:` and `comments:` lines ADR-0011 adds). The live editor strips it before
 * parsing; the step port the agent's edits go through used to parse the whole
 * file, so a passage edit on an annotated note landed inside the `id:` line
 * and the saved file carried a second, torn copy of the front matter as body.
 *
 * The browser shell never writes front matter itself, which is how the whole
 * UI suite missed this. A file opened through the picker can carry it.
 */

const editor = '.milkdown .ProseMirror'
const MATTER = '---\nid: abc123\ncomments: .simplemark/abc123.json\n---\n\n'
const TARGET = 'A second paragraph, the one to rewrite.'
const BODY = `# Tiny probe\n\nOne paragraph. Nothing else.\n\n${TARGET}\n`

test.beforeEach(async ({ page }) => {
  await page.addInitScript((content: string) => {
    // Direct application is the mode this spec describes (ADR-0013 default is propose).
    window.localStorage.setItem('simplemark.agent-connection', JSON.stringify({ editMode: 'direct' }))
    window.showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle('probe.md', { create: true })
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
  await expect(page.locator('.filename-title')).toHaveText('probe')
  await expect(page.locator(editor)).toContainText(TARGET)
})

const markdown = (page: import('@playwright/test').Page): Promise<string> =>
  page.evaluate(() => {
    window.simplemark!.flushPendingChanges()
    return window.simplemark!.session.snapshot().markdown
  })

test('a passage edit on a note with front matter lands in the passage and leaves the front matter alone', async ({ page }) => {
  // The front matter is not text in the editor.
  await expect(page.locator(editor)).not.toContainText('id: abc123')

  await page.evaluate(() => {
    let calls = 0
    window.simplemark!.agent.setProviderForTest({
      async complete(input) {
        calls += 1
        if (calls === 1) {
          return {
            kind: 'tool',
            id: 'call',
            name: 'apply_transaction',
            args: { markdown: 'The target, rewritten.', scope: input.scope },
          }
        }
        return { kind: 'text', text: 'Rewrote the selected paragraph.' }
      },
    })
  })
  expect(await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), TARGET)).toBe(true)
  await page.evaluate(() => window.simplemark!.agent.send('redirect', 'rewrite this'))
  await expect(page.locator(editor)).toContainText('The target, rewritten.')

  const after = await markdown(page)
  expect(after.startsWith(MATTER)).toBe(true)
  const body = after.slice(MATTER.length)
  expect(body).not.toContain('---')
  expect(body).not.toContain('id: abc123')
  expect(body).not.toContain('comments:')
  expect(body).toContain('# Tiny probe')
  expect(body).toContain('One paragraph. Nothing else.')
  expect(body).toContain('The target, rewritten.')
  expect(body).not.toContain(TARGET)
  // And the editor still shows no front matter as text.
  await expect(page.locator(editor)).not.toContainText('id: abc123')
})
