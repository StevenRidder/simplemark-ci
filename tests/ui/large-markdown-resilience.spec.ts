import { expect, test } from '@playwright/test'

const EDITOR = '.milkdown .ProseMirror'

/**
 * The converted federal report that exposed BUG-3 had 239 tables and about
 * 76,000 cells. This synthetic file has the same failure shape without making
 * a user download fixture part of the repository: 100 tables × 804 cells.
 */
function generatedReport(): string {
  const tables = Array.from({ length: 100 }, (_, tableIndex) => {
    const header = '| Quarter | Revenue | Costs | Margin |'
    const delimiter = '| --- | --- | --- | --- |'
    const rows = Array.from(
      { length: 200 },
      (_, row) => `| report-${tableIndex}-${row}-0 | report-${tableIndex}-${row}-1 | report-${tableIndex}-${row}-2 | report-${tableIndex}-${row}-3 |`,
    )
    return `## Table ${tableIndex + 1}\n\n${header}\n${delimiter}\n${rows.join('\n')}`
  })
  return `# Generated financial report\n\nThis report deliberately contains many wide data tables.\n\n${tables.join('\n\n')}\n\nClosing prose remains editable.\n`
}

const REPORT = generatedReport()

test('opens a table-heavy Markdown file promptly without losing its source', async ({ page }) => {
  test.setTimeout(15_000)
  await page.addInitScript((content: string) => {
    const file = new File([content], 'generated-financial-report.md', { type: 'text/markdown' })
    const handle = {
      name: 'generated-financial-report.md',
      getFile: async () => file,
      createWritable: async () => ({ write: async () => undefined, close: async () => undefined }),
    }
    window.showOpenFilePicker = async () => [handle as unknown as FileSystemFileHandle]
  }, REPORT)

  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)

  const startedAt = Date.now()
  await page.getByRole('button', { name: 'Open file' }).click()
  await expect(page.locator('.filename')).toContainText('generated-financial-report.md')
  await expect(page.locator(`${EDITOR} h1`)).toContainText('Generated financial report')
  await expect(page.locator('[data-deferred-table]')).toHaveCount(98)
  await expect(page.locator('[data-deferred-table]').first()).toContainText('Large table held safely')
  expect(Date.now() - startedAt).toBeLessThan(8_000)

  // Two normal tables remain interactive (1,608 cells); the remaining source
  // is not inflated into a 80,000-cell DOM before a person can read the note.
  await expect(page.locator(`${EDITOR} td, ${EDITOR} th`)).toHaveCount(1_608)
  await expect
    .poll(() => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toBe(REPORT)

  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('A safe edit after opening.')
  await expect
    .poll(() => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('A safe edit after opening.')
  const savedMarkdown = await page.evaluate(() => window.simplemark!.session.snapshot().markdown)

  // The table source is still carried by the application document rather than
  // being replaced by the safe-renderer marker on the next user transaction.
  expect(savedMarkdown).toContain('| report-99-199-0 | report-99-199-1 | report-99-199-2 | report-99-199-3 |')
  expect(savedMarkdown).not.toContain('simplemark-deferred-table-v1:')
})
