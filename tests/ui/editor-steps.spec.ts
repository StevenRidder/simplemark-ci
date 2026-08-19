import { expect, test } from '@playwright/test'

/**
 * EDITOR-20: live typing must emit ProseMirror steps, and a remote batch must
 * land in the view without echoing back into the session as a second revision.
 */

const editor = '.milkdown .ProseMirror'

async function caretAtEnd(page: import('@playwright/test').Page) {
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await expect(page.locator(editor)).toBeFocused()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await page.getByRole('button', { name: 'New note' }).click()
  await expect(page.locator('.filename-title')).toHaveText('new-note-3')
})

test('typing produces a non-empty step batch that replays to the editor Markdown', async ({ page }) => {
  const before = await page.evaluate(() => window.simplemark!.session.snapshot())

  await caretAtEnd(page)
  await page.keyboard.type(' Typed steps.')
  await page.evaluate(() => window.simplemark!.flushPendingChanges())

  const replay = await page.evaluate((baseMarkdown) => {
    const steps = window.simplemark!.editor.emittedSteps()
    const replayed = window.simplemark!.steps.applySteps(baseMarkdown, steps)
    return {
      steps,
      replayed,
      current: window.simplemark!.session.snapshot(),
    }
  }, before.markdown)

  expect(replay.steps.length).toBeGreaterThan(0)
  expect(replay.replayed).toMatchObject({ ok: true })
  if (!replay.replayed.ok) throw new Error(`Expected replay to succeed, got ${replay.replayed.kind}`)
  expect(replay.replayed.markdown).toBe(replay.current.markdown)
  expect(replay.current.markdown).toContain('Typed steps.')
})

test('applying a remote step changes the visible document and advances revision once', async ({ page }) => {
  const result = await page.evaluate(() => {
    const base = window.simplemark!.session.snapshot()
    const created = window.simplemark!.steps.markdownToSteps(base.markdown, 'Remote line')
    if (!created.ok) return { ok: false as const, reason: created.kind }
    const applied = window.simplemark!.session.applySteps({
      actorId: 'agent',
      name: 'Remote edit',
      baseVersion: base.revision,
      steps: created.steps,
    })
    const revisionAfterSession = window.simplemark!.session.snapshot().revision
    const viewOk = applied.ok ? window.simplemark!.editor.applyRemoteSteps(applied.steps) : false
    window.simplemark!.flushPendingChanges()
    const after = window.simplemark!.session.snapshot()
    const visible = document.querySelector('.milkdown .ProseMirror')?.textContent ?? ''
    return {
      ok: true as const,
      applied,
      viewOk,
      before: base.revision,
      revisionAfterSession,
      after,
      visible,
    }
  })

  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Expected remote Markdown conversion to succeed')
  expect(result.applied).toMatchObject({ ok: true })
  expect(result.viewOk).toBe(true)
  expect(result.after.revision).toBe(result.before + 1)
  expect(result.revisionAfterSession).toBe(result.after.revision)
  expect(result.visible).toContain('Remote line')
  expect(result.after.markdown).toContain('Remote line')
})

test('a remote step that cannot apply returns false and does not throw', async ({ page }) => {
  const result = await page.evaluate(() => {
    const before = window.simplemark!.session.snapshot()
    const visibleBefore = document.querySelector('.milkdown .ProseMirror')?.textContent ?? ''
    let threw = false
    let viewOk = true
    try {
      viewOk = window.simplemark!.editor.applyRemoteSteps([{ stepType: 'not-a-step' }])
    } catch {
      threw = true
    }
    const after = window.simplemark!.session.snapshot()
    const visibleAfter = document.querySelector('.milkdown .ProseMirror')?.textContent ?? ''
    return { threw, viewOk, before, after, visibleBefore, visibleAfter }
  })

  expect(result.threw).toBe(false)
  expect(result.viewOk).toBe(false)
  expect(result.after.revision).toBe(result.before.revision)
  expect(result.after.markdown).toBe(result.before.markdown)
  expect(result.visibleAfter).toBe(result.visibleBefore)
})
