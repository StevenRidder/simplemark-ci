import { expect, test } from '@playwright/test'

/**
 * A chart that has never been on screen must still hold its place.
 *
 * Off-screen charts (#204) start as a placeholder. If that placeholder has no
 * height, the first visit grows the block from nothing, and when the block is
 * above the viewport the content under the reader jumps — the "bounce" seen
 * scrolling back up past SVG wireframes.
 */

const EDITOR = '.milkdown .ProseMirror'

function tallSvgDocument(): string {
  const svg = (n: number) =>
    `## Figure ${n}\n\n\`\`\`svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" width="400" height="600"><rect x="10" y="10" width="380" height="580" fill="none" stroke="black"/><text x="200" y="300" text-anchor="middle">wireframe ${n}</text></svg>\n\`\`\`\n`
  const pad = Array.from({ length: 12 }, () => 'Filler paragraph so the next figure sits below the fold.\n').join('\n')
  return ['# Wireframes\n', ...[1, 2, 3, 4, 5, 6].map((n) => svg(n) + pad)].join('\n')
}

async function openGeneratedFile(page: import('@playwright/test').Page, body: string): Promise<void> {
  await page.addInitScript((content: string) => {
    window.showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle('wireframes.md', { create: true })
      if ((await handle.getFile()).size === 0) {
        const writable = await handle.createWritable()
        await writable.write(content)
        await writable.close()
      }
      return [handle]
    }
  }, body)
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.getByRole('button', { name: 'Open file' }).click()
}

test('scrolling back up past unvisited figures does not shift the text under the reader', async ({ page }) => {
  await openGeneratedFile(page, tallSvgDocument())
  await expect(page.locator(`${EDITOR} h1`)).toContainText('Wireframes', { timeout: 15_000 })
  await expect(page.locator('.diagram').first().locator('.diagram-render svg')).toBeVisible({ timeout: 30_000 })

  const scroller = page.locator('section.editor')
  // Jump straight to the end, as a scrollbar drag or a link would.
  await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await page.waitForTimeout(600)

  // Walk back up in steps. Each step, the heading we anchor on must move by
  // exactly the distance scrolled — anything more is content growing above us.
  const anchor = page.locator(`${EDITOR} h2`).last()
  let previousTop = (await anchor.boundingBox())!.y
  const jumps: number[] = []
  for (let step = 0; step < 12; step++) {
    await scroller.evaluate((element) => { element.scrollTop = Math.max(0, element.scrollTop - 250) })
    await page.waitForTimeout(150)
    const top = (await anchor.boundingBox())!.y
    const moved = top - previousTop
    const scrolledTo = await scroller.evaluate((element) => element.scrollTop)
    if (scrolledTo > 0) jumps.push(Math.round(moved - 250))
    previousTop = top
  }
  expect(jumps.filter((jump) => Math.abs(jump) > 4), `content shifted while scrolling up: ${jumps.join(', ')}`).toEqual([])
})
