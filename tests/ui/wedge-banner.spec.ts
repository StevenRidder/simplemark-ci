import { expect, test } from '@playwright/test'

/**
 * BUG-13: when the renderer starves behind an external accessibility client,
 * the app says so and offers the recovery. The detector's thresholds are
 * unit-tested; this pins the surface — a wedge only a diagnostician can see
 * is a hidden failure.
 */

test('the wedge banner names the problem and carries the recovery', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)

  // No banner in ordinary life.
  await expect(page.locator('.sm-wedge-banner')).toHaveCount(0)

  await page.evaluate(() => window.simplemark!.agent.triggerWedgeBannerForTest())
  const banner = page.locator('.sm-wedge-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toHaveAttribute('role', 'alert')
  await expect(banner).toContainText('outside SimpleMark')
  await expect(banner.locator('[data-action="wedge-restart"]')).toBeVisible()

  // Dismiss removes it, and it does not immediately return.
  await banner.locator('[data-action="wedge-dismiss"]').click()
  await expect(page.locator('.sm-wedge-banner')).toHaveCount(0)
  await page.evaluate(() => window.simplemark!.agent.triggerWedgeBannerForTest())
  await expect(page.locator('.sm-wedge-banner')).toHaveCount(0)
})
