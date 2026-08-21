import { expect, test, type Page } from '@playwright/test'

/**
 * APP-40: the panel composer states what a send will touch, before the press.
 * The routing rule (selection edits, no selection chats) predates the chip;
 * the chip is the rule made visible — and the heading picker makes "expand
 * this section" aimable without leaving the panel.
 */

const editor = '.milkdown .ProseMirror'

async function openPanelOnDemo(page: Page): Promise<void> {
  // Direct application is the mode these specs describe (ADR-0013 default is propose).
  await page.addInitScript(() => window.localStorage.setItem('simplemark.agent-connection', JSON.stringify({ editMode: 'direct' })))
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await page.evaluate(() => {
    window.simplemark!.agent.setProviderForTest({
      async complete() {
        return { kind: 'text', text: 'ok' }
      },
    })
  })
  await page.evaluate(() => window.simplemark!.agent.toggle())
  await expect(page.locator('.sm-agent-composer')).toBeVisible()
}

test('the chip says chat-only with nothing selected, and names a selection', async ({ page }) => {
  await openPanelOnDemo(page)
  await expect(page.locator('[data-action="scope-chip"]')).toContainText('Whole document · chat only')

  await page.evaluate(() => window.simplemark!.notes.selectTextForTest('This document is the demo.'))
  await expect(page.locator('[data-action="scope-chip"]')).toContainText('Selection: “This document is the demo.”')
})

test('picking a heading pins the section, and the send edits inside it', async ({ page }) => {
  await openPanelOnDemo(page)
  await page.locator('[data-action="scope-chip"]').click()
  const first = page.locator('[data-action="scope-heading"]').first()
  await expect(first).toBeVisible()
  const label = (await first.textContent()) ?? ''
  await first.click()
  await expect(page.locator('[data-action="scope-chip"]')).toContainText(`Section: ${label}`)

  // The scripted agent replaces its scope with a marker; the marker must land
  // inside the pinned section — proof the chip's promise reached the run.
  await page.evaluate(() => {
    window.simplemark!.agent.setProviderForTest({
      async complete(input: { scope?: unknown }) {
        const calls = (window as unknown as Record<string, number>)
        if ((calls['__chipCalls'] = (calls['__chipCalls'] ?? 0) + 1) === 1) {
          return { kind: 'tool', id: 'c1', name: 'apply_transaction', args: { markdown: 'SECTION-EDIT-MARKER', scope: input.scope } }
        }
        return { kind: 'text', text: 'done' }
      },
    })
  })
  await page.locator('.sm-agent-composer [data-action="mode-redirect"]').click()
  await page.locator('.sm-agent-composer-input').fill('expand this section')
  await page.locator('.sm-agent-composer [data-action="send"]').click()
  await expect(page.locator(editor)).toContainText('SECTION-EDIT-MARKER')

  // One-shot: the pin is consumed by the send.
  await expect(page.locator('[data-action="scope-chip"]')).toContainText('Whole document · chat only')
})
