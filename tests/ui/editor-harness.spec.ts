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

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('Typed by the acceptance test.')

  // Assert the settled state, not a moment mid-flight. The edit marks the
  // document dirty and the 900ms debounced save then clears it, so asserting
  // dirty===true here raced the autosave and failed intermittently under load.
  // "Saved" is the durable end state and proves the whole path: keystroke ->
  // transaction -> revision -> save through the port.
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'saved')
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().dirty))
    .toBe(false)
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

// BUG-1 regression. EDITOR-1 shipped without @milkdown/kit/plugin/clipboard, so
// pasted Markdown was inserted as literal text and then escaped on serialise —
// turning a pasted document into 500+ paragraphs full of \# and \*\*. The UI
// suite exercised typing and toolbar commands but never a paste, which is
// exactly how it got through.
test('pasted Markdown is parsed, not inserted as escaped literal text', async ({ page }) => {
  const pasted = [
    '## Pasted heading',
    '',
    'Body with **bold** and a [link](https://example.invalid).',
    '',
    '- first item',
    '- second item',
    '',
    '```mermaid',
    'flowchart TD',
    '  PASTE[Pasted] --> RENDER[Rendered]',
    '```',
  ].join('\n')

  // A real clipboard and a real Cmd/Ctrl+V. A synthetic ClipboardEvent is not
  // equivalent — ProseMirror ignored it entirely, which would have made this
  // test pass or fail for reasons unrelated to the bug.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

  // Focus first. Headless Chromium refuses navigator.clipboard.writeText on an
  // unfocused document, which made this pass in isolation and fail in the suite.
  await page.bringToFront()
  await page.locator(`${editor} p`).first().click()
  await page.evaluate((text) => navigator.clipboard.writeText(text), pasted)

  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+v')

  // Structure, not text: the paste became real nodes.
  await expect(page.locator(`${editor} h2`, { hasText: 'Pasted heading' })).toBeVisible()
  await expect(page.locator(`${editor} li`, { hasText: 'first item' })).toBeVisible()
  await expect(page.locator(`${editor} strong`, { hasText: 'bold' })).toBeVisible()

  // The fenced diagram went through the existing NodeView.
  await expect(page.locator('.diagram')).toHaveCount(2)

  // Poll: the DOM updates synchronously but Milkdown's markdownUpdated listener
  // — and therefore the DocumentSession transaction — lands just after.
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('## Pasted heading')

  const markdown = await page.evaluate(() => window.simplemark!.session.snapshot().markdown)
  expect(markdown).toContain('**bold**')
  expect(markdown).toContain('flowchart TD')
  // No syntax the user pasted may come back escaped.
  expect(markdown).not.toContain('\\#')
  expect(markdown).not.toContain('\\*')
  expect(markdown).not.toContain('\\[')
})

// BUG-2, defect 1. Editors and viewers put a syntax-highlighted <pre> on the
// clipboard next to the plain text. Milkdown's clipboard plugin prefers
// text/html, so copying a .md file out of an editor produced one giant
// ```markdown code block — the whole document rendered as source.
// DESIGN.md §4.2 rules that text/plain wins when there is no SVG.
test('a clipboard carrying both HTML and plain text takes the Markdown path', async ({ page }) => {
  const markdown = '## From an editor\n\nSome **bold** prose.\n'
  // What VS Code and most viewers actually put on the clipboard.
  const html = '<pre style="font-family: monospace"><span>## From an editor</span>\n<span>Some **bold** prose.</span></pre>'

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.bringToFront()
  await page.locator(`${editor} p`).last().click()

  // A real clipboard carrying both flavours, the way an editor writes it.
  // A synthetic ClipboardEvent is untrusted and ProseMirror ignores it.
  await page.evaluate(
    async ({ md, htm }) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([md], { type: 'text/plain' }),
          'text/html': new Blob([htm], { type: 'text/html' }),
        }),
      ])
    },
    { md: markdown, htm: html },
  )

  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+v')

  await expect(page.locator(`${editor} h2`, { hasText: 'From an editor' })).toBeVisible()
  await expect(page.locator(`${editor} strong`, { hasText: 'bold' })).toBeVisible()

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('## From an editor')

  const doc = await page.evaluate(() => window.simplemark!.session.snapshot().markdown)
  // The killer symptom: the paste must not become a fenced code block.
  expect(doc).not.toContain('```markdown')
})

// BUG-2, defect 2. DESIGN.md §6 specifies commonmark + gfm and §5 puts tables
// and task lists in portability tier 1. Only commonmark was loaded, so these
// constructs had no schema and rendered as plain paragraphs.
test('GFM constructs render: tables, task lists, strikethrough', async ({ page }) => {
  const markdown = [
    '| Take | From |',
    '| --- | --- |',
    '| The fence | execution_liveness |',
    '',
    '- [ ] unchecked task',
    '- [x] checked task',
    '',
    'Some ~~struck~~ text.',
  ].join('\n')

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.bringToFront()
  await page.locator(`${editor} p`).last().click()
  await page.evaluate((md) => navigator.clipboard.writeText(md), markdown)

  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+v')

  await expect(page.locator(`${editor} table`)).toBeVisible()
  await expect(page.locator(`${editor} th`, { hasText: 'Take' })).toBeVisible()
  await expect(page.locator(`${editor} td`, { hasText: 'The fence' })).toBeVisible()
  await expect(page.locator(`${editor} li[data-item-type="task"]`)).toHaveCount(2)
  await expect(page.locator(`${editor} li[data-checked="true"]`)).toHaveCount(1)
  await expect(page.locator(`${editor} del, ${editor} s`)).toBeVisible()

  // Structure, not spacing. remark re-pads table cells, escapes underscores, and
  // rewrites `-` bullets to `*` on serialise — the normalisation D7 forbids and
  // fixtures 4 and 5 exist to catch. FIDELITY-1 owns fixing it; asserting exact
  // bytes here would just duplicate that gate and fail for the wrong reason.
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toMatch(/\|\s*Take\s*\|\s*From\s*\|/)

  const doc = await page.evaluate(() => window.simplemark!.session.snapshot().markdown)
  expect(doc).toMatch(/\[[ x]\]\s+unchecked task/)
  expect(doc).toContain('~~struck~~')
})
