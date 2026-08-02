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

/**
 * Caret at the end of the document, via the editor's own focusEnd.
 *
 * Clicking a paragraph and pressing End is not equivalent: End stops at the end
 * of a wrapped visual line, and a click can land on the Mermaid NodeView, which
 * takes a node selection that silently swallows typing. Both produced
 * intermittent failures that moved between tests.
 */
async function caretAtEnd(page: import('@playwright/test').Page) {
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await expect(page.locator(editor)).toBeFocused()
}

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
  // TOOLBAR-1 made Checklist, Table and Convert to diagram real; what remains
  // disabled needs infrastructure that does not exist. Search, New note and
  // Document list belong to SHELL-1; Work with AI to the live-agent deliverable.
  await expect(page.getByRole('button', { name: 'Work with AI' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Attach file' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Search' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Document list' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Table' })).toBeEnabled()
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
  await caretAtEnd(page)
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
  await caretAtEnd(page)
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

// PASTE-1 — the DESIGN.md §4 sniffer chain, the product's defining behavior:
// "you paste raw Mermaid source or a raw <svg> tag with no code fence, and it
// becomes a picture." Each test below is a row of the §4.2 ruling table.
async function pasteAtEnd(page: import('@playwright/test').Page, text: string, html?: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.bringToFront()
  await caretAtEnd(page)
  await page.evaluate(
    async ({ t, h }) => {
      if (h === undefined) {
        await navigator.clipboard.writeText(t)
        return
      }
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([t], { type: 'text/plain' }),
          'text/html': new Blob([h], { type: 'text/html' }),
        }),
      ])
    },
    { t: text, h: html },
  )
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+v')
}

const BARE_MERMAID = 'flowchart LR\n  PASTE[Bare paste] --> PIC[Becomes a picture]'

test('bare Mermaid pasted at a block boundary becomes a rendered diagram', async ({ page }) => {
  await expect(page.locator('.diagram')).toHaveCount(1)

  await pasteAtEnd(page, BARE_MERMAID)

  await expect(page.locator('.diagram')).toHaveCount(2)
  await expect(page.locator('.diagram').last().locator('.diagram-render svg')).toBeVisible()
  await expect(page.locator('.diagram-error:visible')).toHaveCount(0)

  // §4.4: never lose the source — it lands on disk as a portable fence.
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('```mermaid')
})

test('a bare <svg> pasted at a block boundary renders, sanitised', async ({ page }) => {
  // §7: scripts and event handlers must not survive.
  const hostile =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="window.__pwned=1">' +
    '<script>window.__pwned=1</script>' +
    '<rect x="10" y="10" width="80" height="80" fill="none" stroke="currentColor"/></svg>'

  await pasteAtEnd(page, hostile)

  await expect(page.locator('.diagram')).toHaveCount(2)
  const rendered = page.locator('.diagram').last().locator('.diagram-render svg')
  await expect(rendered).toBeVisible()

  // Neutered, but rendered — the rect survived, the payload did not.
  await expect(rendered.locator('rect')).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
  const markup = await rendered.evaluate((el) => el.outerHTML)
  expect(markup).not.toContain('onload')
  expect(markup).not.toContain('<script')
})

test('prose beginning with a diagram keyword stays prose', async ({ page }) => {
  // §4.2: "Prose beginning with the word 'graph' — mermaid.parse() rejects it."
  await pasteAtEnd(page, 'graph theory is the study of pairwise relations between objects.')

  await expect(page.locator('.diagram')).toHaveCount(1)
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('graph theory is the study')
})

test('a multi-block paste takes the Markdown path and leaves bare diagram source as text', async ({
  page,
}) => {
  // §4.2: "Bare unfenced diagram source inside a larger paste stays text."
  await pasteAtEnd(page, ['## A heading', '', BARE_MERMAID, '', 'Trailing prose.'].join('\n'))

  await expect(page.locator(`${editor} h2`, { hasText: 'A heading' })).toBeVisible()
  await expect(page.locator('.diagram')).toHaveCount(1)
})

test('svg-in-html wins over the text flavour (§4.2 priority 30)', async ({ page }) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'
  await pasteAtEnd(page, 'irrelevant plain text', `<meta charset="utf-8"><div>${svg}</div>`)

  await expect(page.locator('.diagram')).toHaveCount(2)
  await expect(page.locator('.diagram').last().locator('.diagram-render svg circle')).toHaveCount(1)
})

test('undo after conversion restores the raw pasted text (§4.3)', async ({ page }) => {
  await pasteAtEnd(page, BARE_MERMAID)
  await expect(page.locator('.diagram')).toHaveCount(2)

  await page.keyboard.press('ControlOrMeta+z')

  await expect(page.locator('.diagram')).toHaveCount(1)
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('flowchart LR')
})

// Regression: neither the commonmark nor the gfm preset bundles history, so
// EDITOR-1 shipped an editor where Cmd+Z did nothing. POC.md requires it, and
// no test covered it because the suite only ever typed forwards.
test('Cmd+Z undoes an ordinary edit', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.type(' UNDO ME')
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('UNDO ME')

  await page.keyboard.press('ControlOrMeta+z')

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .not.toContain('UNDO ME')

  // The surrounding prose is intact. Deliberately not asserting byte equality
  // with the pre-edit document: remark rewrites `---` to `***` on the first
  // serialise regardless of undo, which is the D7 normalisation FIDELITY-1
  // owns. Asserting it here would fail for a reason that has nothing to do
  // with undo.
  const after = await page.evaluate(() => window.simplemark!.session.snapshot().markdown)
  expect(after).toContain('application database.')
  expect(after).toContain('The live document boundary')
})
