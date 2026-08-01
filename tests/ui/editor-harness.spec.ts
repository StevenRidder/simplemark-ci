import { expect, test } from '@playwright/test'

/**
 * EDITOR-1 acceptance, driven in a real browser.
 *
 * The board's proof for this milestone is "the harness visibly matches the
 * approved calm wireframe", "it uses the real candidate editor rather than a
 * parallel contenteditable demo", "text editing, one formatting command, and
 * Mermaid render/source toggle are functional", and "all document operations
 * cross the application API". Each of those is asserted below against the
 * running app, not against a mock.
 */

const editor = '.milkdown .ProseMirror'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
})

test('renders the approved wireframe chrome', async ({ page }) => {
  await expect(page.locator('.window')).toBeVisible()
  await expect(page.locator('.titlebar .lights i')).toHaveCount(3)
  await expect(page.locator('.filename')).toContainText('architecture.md')
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'saved')

  // Typography is the wireframe's, not the browser's default.
  const bodyFont = await page.locator(editor).evaluate((el) => getComputedStyle(el).fontFamily)
  expect(bodyFont).toMatch(/Iowan Old Style|New York|Palatino|Georgia|serif/)
})

test('is the real ProseMirror candidate, not a contenteditable demo', async ({ page }) => {
  // A bare contenteditable div would satisfy neither of these.
  await expect(page.locator(editor)).toHaveAttribute('contenteditable', 'true')
  const isProseMirror = await page.evaluate(() => {
    const node = document.querySelector('.milkdown .ProseMirror') as
      | (HTMLElement & { pmViewDesc?: unknown })
      | null
    return node?.pmViewDesc !== undefined
  })
  expect(isProseMirror).toBe(true)

  // The fixture's Markdown was parsed into real nodes, not shown as text.
  await expect(page.locator(`${editor} h1`)).toContainText('The first useful proof')
  await expect(page.locator(`${editor} h2`)).toContainText('The live document boundary')
})

test('controls that a later task delivers are visibly disabled, never fake', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Work with AI' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Table' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Attach file' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Search' })).toBeDisabled()
})

test('typing flows through the application API and advances the document revision', async ({
  page,
}) => {
  const before = await page.evaluate(() => window.simplemark!.session.snapshot())
  expect(before.dirty).toBe(false)

  await page.locator(`${editor} p`).first().click()
  await page.keyboard.type(' Typed by the acceptance test.')

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().revision))
    .toBeGreaterThan(before.revision)

  const after = await page.evaluate(() => window.simplemark!.session.snapshot())
  expect(after.markdown).toContain('Typed by the acceptance test.')
  expect(after.dirty).toBe(true)
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'dirty')
})

test('a formatting command reaches the document as Markdown', async ({ page }) => {
  await page.locator(`${editor} p`).first().click()
  await page.keyboard.press('End')
  await page.keyboard.type('bold me')
  for (let i = 0; i < 'bold me'.length; i += 1) {
    await page.keyboard.press('Shift+ArrowLeft')
  }

  await page.getByRole('button', { name: 'Text formatting' }).click()
  await page.getByRole('button', { name: 'Bold' }).click()

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('**bold me**')
})

// ADR-0003: the frame stays, its controls fade in. At rest a note is prose and
// pictures with no chrome; hover or keyboard focus reveals the block bar.
test('rendered-block controls are hidden at rest and revealed on hover', async ({ page }) => {
  const diagram = page.locator('.diagram')
  const label = diagram.locator('.diagram-label')
  const editSource = diagram.getByRole('button', { name: 'Edit source' })

  await expect(label).toHaveCSS('opacity', '0')
  await expect(editSource).toHaveCSS('opacity', '0')

  await diagram.hover()
  await expect(label).toHaveCSS('opacity', '1')
  await expect(editSource).toHaveCSS('opacity', '1')

  // The frame itself is always present — it is what makes a third-party block
  // indistinguishable from a built-in.
  await expect(diagram).toHaveCSS('border-radius', '13px')
})

test('the Mermaid fence renders as a diagram and toggles to editable source', async ({ page }) => {
  const diagram = page.locator('.diagram')
  await expect(diagram).toBeVisible()

  // Rendered by the real engine, not a placeholder.
  await expect(diagram.locator('.diagram-render svg')).toBeVisible()
  await expect(diagram.locator('.diagram-error')).toBeHidden()
  await expect(diagram.locator('.diagram-label')).toHaveText('mermaid')

  await diagram.getByRole('button', { name: 'Edit source' }).click()
  const source = diagram.locator('.diagram-source')
  await expect(source).toBeVisible()
  await expect(source).toHaveValue(/flowchart LR/)

  // Editing the source updates the document through ProseMirror.
  await source.click()
  await source.press('End')
  await source.pressSequentially('\n  BOTH --> OUT[Portable Markdown]')

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('OUT[Portable Markdown]')
})

test('invalid diagram source fails visibly and keeps its source editable', async ({ page }) => {
  const diagram = page.locator('.diagram')
  await diagram.getByRole('button', { name: 'Edit source' }).click()
  const source = diagram.locator('.diagram-source')

  await source.click()
  await source.press('ControlOrMeta+a')
  await source.pressSequentially('flowchart LR\n  A --> ((((')

  // An inline error card carrying the parser's message — never a blank frame.
  await expect(diagram.locator('.diagram-error')).toBeVisible()
  await expect(diagram.locator('.diagram-error')).not.toBeEmpty()
  await expect(source).toBeVisible()
})

test('saving round-trips through the port and reopens as portable Markdown', async ({ page }) => {
  await page.locator(`${editor} p`).first().click()
  await page.keyboard.type(' Saved round trip.')

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().dirty))
    .toBe(true)

  await page.evaluate(() => window.simplemark!.save())
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'saved')

  const saved = await page.evaluate(() => window.simplemark!.session.snapshot().markdown)
  expect(saved).toContain('Saved round trip.')
  // Still an ordinary fenced mermaid block on the way out.
  expect(saved).toContain('```mermaid')
})

test('captures the calm state for wireframe comparison', async ({ page }, testInfo) => {
  await expect(page.locator('.diagram-render svg')).toBeVisible()
  const shot = await page.locator('.window').screenshot()
  await testInfo.attach('calm-state', { body: shot, contentType: 'image/png' })
})
