import { expect, test } from '@playwright/test'

/**
 * Off-screen charts drop their live SVG for a still frame, then draw live
 * again when they come back on screen. A note with many Mermaid blocks
 * otherwise keeps every SVG tree in the document for the whole session.
 */

const EDITOR = '.milkdown .ProseMirror'

function tallDiagramDocument(): string {
  const chart = (n: number) =>
    `## Chart ${n}\n\n\`\`\`mermaid\nflowchart LR\n  Start${n} --> End${n}\n\`\`\`\n`
  const pad = Array.from(
    { length: 30 },
    () => 'Filler paragraph so the next chart sits below the fold.\n',
  ).join('\n')
  return ['# Tall charts\n', ...[1, 2, 3, 4, 5, 6].map((n) => chart(n) + pad)].join('\n')
}

async function openGeneratedFile(page: import('@playwright/test').Page, body: string): Promise<void> {
  await page.addInitScript((content: string) => {
    window.showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle('tall-charts.md', { create: true })
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

test('an off-screen chart becomes a still frame and draws live again on screen', async ({ page }) => {
  await openGeneratedFile(page, tallDiagramDocument())
  await expect(page.locator(`${EDITOR} h1`)).toContainText('Tall charts', { timeout: 15_000 })

  const first = page.locator('.diagram').first()
  const last = page.locator('.diagram').last()

  await expect(first.locator('.diagram-render svg')).toBeVisible({ timeout: 30_000 })
  await expect(first).toHaveAttribute('data-diagram-surface', 'live')

  await expect(last).toHaveAttribute('data-diagram-surface', /snapshot|placeholder/)
  await expect(last.locator('svg')).toHaveCount(0)

  await last.scrollIntoViewIfNeeded()
  await expect(last.locator('.diagram-render svg')).toBeVisible({ timeout: 30_000 })
  await expect(last).toHaveAttribute('data-diagram-surface', 'live')

  await expect(first).toHaveAttribute('data-diagram-surface', 'snapshot', { timeout: 10_000 })
  await expect(first.locator('img.diagram-snapshot')).toBeVisible()
  await expect(first.locator('svg')).toHaveCount(0)
})
