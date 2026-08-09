import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/spike/authority-2/index.html')
  await page.waitForFunction(() => 'authoritySpike' in window)
})

test('real NodeViews, selection, and find decorations survive an accepted remote step', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const authoritySpike = (window as unknown as {
      authoritySpike: {
        mountedMapping(): Promise<{
          before: { diagrams: number; inlineMath: number; foldChevrons: number; connected: boolean }
          after: { diagrams: number; inlineMath: number; foldChevrons: number; connected: boolean }
          sameNodeViews: boolean
          rebased: boolean
          remoteMeta: string
          selectedText: string
          decoratedText: string
          documentText: string
        }>
      }
    }).authoritySpike
    return authoritySpike.mountedMapping()
  })

  expect(result.before).toEqual({ diagrams: 2, inlineMath: 1, foldChevrons: 1, connected: true })
  expect(result.after).toEqual({ diagrams: 2, inlineMath: 1, foldChevrons: 1, connected: true })
  expect(result.sameNodeViews).toBe(true)
  expect(result.rebased).toBe(true)
  expect(result.remoteMeta).toBe('authority-5-remote')
  expect(result.selectedText).toBe('search target')
  expect(result.decoratedText).toBe('search target')
  expect(result.documentText).toContain('remote prefix')
  expect(result.documentText).toContain('human local')
})

test('remote steps stay outside human undo history', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const authoritySpike = (window as unknown as {
      authoritySpike: {
        undoIsolation(): Promise<{
          afterHuman: string
          afterRemote: string
          afterUndo: string
          afterRedo: string
          undoApplied: boolean
          redoApplied: boolean
          remoteMeta: string
        }>
      }
    }).authoritySpike
    return authoritySpike.undoIsolation()
  })

  expect(result.afterHuman).toContain('human edit')
  expect(result.afterRemote).toContain('human edit')
  expect(result.afterRemote).toContain('remote edit')
  expect(result.undoApplied).toBe(true)
  expect(result.afterUndo).not.toContain('human edit')
  expect(result.afterUndo).toContain('remote edit')
  expect(result.redoApplied).toBe(true)
  expect(result.afterRedo).toContain('human edit')
  expect(result.afterRedo).toContain('remote edit')
  expect(result.remoteMeta).toBe('authority-5-remote')
})

test('a destroyed mounted target rejects a later remote batch atomically', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const authoritySpike = (window as unknown as {
      authoritySpike: {
        destroyedTarget(): Promise<{
          accepted: boolean
          beforeDestroy: string
          afterAttempt: string
          mountChildren: number
          orphanedNodeViews: number
        }>
      }
    }).authoritySpike
    return authoritySpike.destroyedTarget()
  })

  expect(result.accepted).toBe(false)
  expect(result.afterAttempt).toBe(result.beforeDestroy)
  expect(result.afterAttempt).not.toContain('late remote')
  expect(result.mountChildren).toBe(0)
  expect(result.orphanedNodeViews).toBe(0)
})
