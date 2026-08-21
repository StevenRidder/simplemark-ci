import { expect, test } from '@playwright/test'

/**
 * APP-48: the conversation panel carries the note card's byline — who, and
 * when — so a transcript reads as clearly as a margin note does.
 */

test('every panel message says who and when, in the card\'s own voice', async ({ page }) => {
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.evaluate(() => {
    window.simplemark!.agent.setProviderForTest({
      async complete() { return { kind: 'text', text: 'Here is what we can do.' } },
    })
  })
  await page.evaluate(() => window.simplemark!.agent.toggle())
  await expect(page.locator('.sm-agent-panel')).toBeVisible()
  await page.evaluate(() => window.simplemark!.agent.send('redirect', 'help me understand what we can do here'))
  const stamp = /[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}/
  const you = page.locator('.sm-agent-message[data-author="you"] .sm-agent-message-byline').first()
  const agent = page.locator('.sm-agent-message[data-author="agent"] .sm-agent-message-byline').first()
  await expect(you).toContainText('You ·')
  await expect(you).toHaveText(stamp)
  await expect(agent).toContainText('Agent ·')
  await expect(agent).toHaveText(stamp)
  // Same voice as a note card: mono, uppercase.
  const transform = await you.evaluate((el) => getComputedStyle(el).textTransform)
  expect(transform).toBe('uppercase')
})
