import { expect, test } from '@playwright/test'

/**
 * The swallowed-diagram notice and its Fix it button.
 *
 * The failure this covers is silent: a stray info-less fence turns a diagram
 * into literal text, so no block renders and no error appears. There is nothing
 * for the diagram error box to attach to, which is exactly why the notice
 * exists. Driven against a routed-and-stubbed `/chat/completions`, the same way
 * diagram-fix-it.spec.ts does — no test-only seam in app code.
 */

const NOTICE = '.hidden-diagram-notice'
const AI_SETTINGS = { apiKey: 'sk-test', baseUrl: 'https://ai-fix.test/v1', model: 'gpt-4o' }

const SWALLOWED = ['# Note', '', '```', '```mermaid', 'flowchart TD', '  A --> B', '```', ''].join('\n')
const CORRECTED = ['```mermaid', 'flowchart TD', '  A --> B', '```'].join('\n')

function chatCompletionResponse(content: string) {
  return { choices: [{ message: { content } }] }
}

async function openNote(page: import('@playwright/test').Page, body: string): Promise<void> {
  await page.addInitScript(
    ({ content, settings }: { content: string; settings: typeof AI_SETTINGS }) => {
      window.localStorage.setItem('simplemark.ai-settings', JSON.stringify(settings))
      window.showOpenFilePicker = async () => {
        const root = await navigator.storage.getDirectory()
        const handle = await root.getFileHandle('hidden-diagram.md', { create: true })
        if ((await handle.getFile()).size === 0) {
          const writable = await handle.createWritable()
          await writable.write(content)
          await writable.close()
        }
        return [handle]
      }
    },
    { content: body, settings: AI_SETTINGS },
  )
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Open file' }).click()
}

test('names the swallowed diagram instead of failing silently', async ({ page }) => {
  await openNote(page, SWALLOWED)

  await expect(page.locator(NOTICE)).toBeVisible()
  await expect(page.locator(NOTICE)).toContainText('mermaid')
  await expect(page.locator(NOTICE)).toContainText('stored as text')
})

test('stays out of the way when the diagram is fenced correctly', async ({ page }) => {
  await openNote(page, ['# Note', '', CORRECTED, ''].join('\n'))

  await expect(page.locator(NOTICE)).toBeHidden()
})

test('catches the mistake when it arrives by paste, not just on open', async ({ page }) => {
  // The serializer rewrites the stray fence the instant the paste lands, into a
  // form that looks deliberate. Only the raw clipboard text still proves it was
  // an accident, so a paste that is never re-opened must still be caught.
  await openNote(page, '# Note\n\nStart here.\n')
  await expect(page.locator(NOTICE)).toBeHidden()

  await page.locator('.milkdown .ProseMirror p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text)
  }, ['```', '```mermaid', 'flowchart TD', '  A --> B', '```'].join('\n'))
  await page.keyboard.press('ControlOrMeta+v')

  await expect(page.locator(NOTICE)).toBeVisible({ timeout: 10_000 })
  await expect(page.locator(NOTICE)).toContainText('mermaid')
})

test('Fix it repairs the document so the diagram renders', async ({ page }) => {
  await page.route('https://ai-fix.test/v1/chat/completions', async (route) => {
    await route.fulfill({ json: chatCompletionResponse(CORRECTED) })
  })

  await openNote(page, SWALLOWED)
  await page.locator(`${NOTICE} button`).click()

  await expect(page.locator('.milkdown .ProseMirror .diagram-render svg').first()).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.locator(NOTICE)).toBeHidden()

  await page.evaluate(() => window.simplemark!.flushPendingChanges())
  const saved = await page.evaluate(() => window.simplemark!.session.snapshot().markdown)
  expect(saved).toContain('```mermaid')
  expect(saved).not.toContain('```\n```mermaid')
})
