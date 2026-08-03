import { expect, test } from '@playwright/test'

const editor = '.milkdown .ProseMirror'
const markdown = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.simplemark!.session.snapshot().markdown)

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
})

async function chooseAsset(
  page: import('@playwright/test').Page,
  file: { name: string; mimeType: string; buffer: Buffer },
  src: string,
  label: string,
): Promise<void> {
  const answers = [src, label]
  const answerPrompt = (dialog: import('@playwright/test').Dialog): void => {
    const answer = answers.shift()
    void (answer === undefined ? dialog.dismiss() : dialog.accept(answer))
  }
  page.on('dialog', answerPrompt)
  const chooser = page.waitForEvent('filechooser')
  try {
    await page.getByRole('button', { name: 'Insert image or link file' }).click()
    // `prompt()` blocks the page. Register both answers before setFiles so the
    // picker never deadlocks waiting for a modal the test has not yet observed.
    await (await chooser).setFiles(file)
    await expect.poll(() => answers.length).toBe(0)
  } finally {
    page.off('dialog', answerPrompt)
  }
}

test('a chosen image writes portable Markdown and gives a visible missing-file state', async ({ page }) => {
  // A relative image already in the document resolves normally when the file
  // exists. The next reference intentionally points at an unavailable path.
  await expect
    .poll(() => page.locator(`${editor} img[alt="SimpleMark asset"]`).evaluate(
      (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
    ))
    .toBe(true)

  await chooseAsset(page, {
    name: 'architecture.png', mimeType: 'image/png', buffer: Buffer.from('not-an-image'),
  }, 'assets/architecture.png', 'Architecture diagram')

  await expect.poll(() => markdown(page)).toContain('![Architecture diagram](assets/architecture.png)')
  await expect(page.getByText('File unavailable: assets/architecture.png', { exact: true })).toBeVisible()
  expect(await markdown(page)).not.toMatch(/file:|blob:|data:|!\[\[/)
})

test('a selected non-image is a normal portable Markdown link', async ({ page }) => {
  // The browser picker itself is exercised above. This assertion isolates the
  // second half of the same path: the editor must serialise a non-image as an
  // ordinary link, never an opaque attachment node.
  await page.evaluate(() => window.simplemark!.editor.insertAsset({
    kind: 'file', src: 'assets/decision.pdf', label: 'Decision PDF',
  }))

  await expect.poll(() => markdown(page)).toContain('[Decision PDF](assets/decision.pdf)')
  await expect(page.locator(`${editor} a`, { hasText: 'Decision PDF' })).toHaveAttribute('href', 'assets/decision.pdf')
})
