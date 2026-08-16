import { expect, type Locator } from '@playwright/test'

/** Scroll a chart on screen and wait until it is a live drawing again. */
export async function revealLiveDrawing(block: Locator): Promise<void> {
  await block.scrollIntoViewIfNeeded()
  await expect(block.locator('.diagram-render svg')).toBeVisible({ timeout: 30_000 })
}
