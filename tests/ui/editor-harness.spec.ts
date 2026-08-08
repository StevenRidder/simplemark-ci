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

const handbookMermaid = (page: import('@playwright/test').Page) =>
  page.locator('.diagram').filter({
    has: page.locator('.diagram-label', { hasText: 'mermaid' }),
  }).first()

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
  await expect(page.locator('.titlebar .lights')).toHaveCount(0)
  await expect(page.locator('.filename-title')).toHaveText('welcome-to-simplemark')
  await expect(page.locator('.filename-title')).not.toContainText('.md')
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'saved')
  await expect(page.getByRole('button', { name: 'Save file' })).toBeEnabled()
  await expect(page.locator('.titlebar').getByRole('button', { name: 'Text formatting' })).toHaveCount(0)
  await expect(page.getByLabel('Styles bar').getByRole('button', { name: 'Text formatting' })).toBeVisible()

  // Typography is the wireframe's, not the browser's default.
  const bodyFont = await page.locator(editor).evaluate((el) => getComputedStyle(el).fontFamily)
  expect(bodyFont).toMatch(/Iowan Old Style|New York|Palatino|Georgia|serif/)
})

test('sidebar typography uses Bear-sized macOS system text', async ({ page }) => {
  const typography = await page.evaluate(() => {
    const metrics = (selector: string) => {
      const style = getComputedStyle(document.querySelector(selector)!)
      return {
        family: style.fontFamily,
        size: style.fontSize,
        weight: style.fontWeight,
        lineHeight: style.lineHeight,
      }
    }
    return {
      navigation: metrics('.folder-row:not(.selected)'),
      section: metrics('.library-section-label'),
      noteTitle: metrics('.note-select strong'),
      notePreview: metrics('.note-select span'),
      noteTime: metrics('.note-select time'),
    }
  })

  for (const value of Object.values(typography)) {
    expect(value.family).toMatch(/-apple-system|BlinkMacSystemFont|SF Pro Text/)
  }
  expect(typography).toMatchObject({
    navigation: { size: '15.5px', weight: '450' },
    section: { size: '11px', weight: '600' },
    noteTitle: { size: '14px', weight: '600' },
    notePreview: { size: '13px', weight: '400' },
    noteTime: { size: '12px' },
  })
})

test('save-state wording does not move the styles bar', async ({ page }) => {
  const formatting = page.getByLabel('Styles bar')
  const before = await formatting.boundingBox()
  expect(before).not.toBeNull()

  await caretAtEnd(page)
  await page.keyboard.type(' one edit is enough')
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'dirty')

  const after = await formatting.boundingBox()
  expect(after).not.toBeNull()
  expect(after!.x).toBe(before!.x)
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

  // The sample's Markdown was parsed into real nodes, not shown as text.
  await expect(page.locator(`${editor} h1`)).toContainText('Welcome to SimpleMark')
  await expect(page.locator(`${editor} h2`).first()).toContainText('Start here')
})

test('workspace controls are real while collaboration controls stay disabled', async ({ page }) => {
  // TOOLBAR-1 made Checklist, Table and Convert to diagram real; EDITOR-4 made
  // portable image/file references real. SHELL-1 delivers search, new note,
  // and the document list; Work with AI remains later work.
  await expect(page.getByRole('button', { name: 'Work with AI' })).toBeDisabled()
  await expect(page.getByLabel('Styles bar').getByRole('button', { name: 'Insert image or link file' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Search' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Open note' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Document list' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'New note' })).toBeEnabled()
  await expect(page.getByLabel('Styles bar').getByRole('button', { name: 'Tables' })).toBeEnabled()
})

test('switches notes, filters the local index, creates a note, and can focus the page', async ({ page }) => {
  await expect(page.getByLabel('Library')).toContainText('Recent Notes2')
  await page.getByRole('button', { name: 'Project Tanoa: Storm Atlas', exact: true }).click()
  await expect(page.locator('.filename-title')).toHaveText('project-tanoa-storm-atlas')
  await expect(page.locator(`${editor} h1`)).toContainText('Project Tanoa: the storm atlas')

  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByRole('searchbox', { name: 'Search notes' }).fill('microgrid')
  await expect(page.getByRole('button', { name: 'Project Tanoa: Storm Atlas', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Welcome to SimpleMark', exact: true })).toBeHidden()

  const pinTanoa = page.getByRole('button', { name: 'Pin Project Tanoa: Storm Atlas' })
  await pinTanoa.locator('..').hover()
  await pinTanoa.click()
  await expect(page.getByRole('button', { name: 'Unpin Project Tanoa: Storm Atlas' })).toBeVisible()
  // Pinning is an in-place sidebar state change, like Bear. It deliberately
  // does not remount the shell or dismiss an active search.
  await page.getByRole('button', { name: 'Close search' }).click()

  await page.getByRole('button', { name: 'Document list' }).click()
  await expect(page.locator('.workspace-body')).toHaveClass(/navigation-hidden/)
  await page.getByRole('button', { name: 'Document list' }).click()
  await page.getByRole('button', { name: 'New note' }).click()
  await expect(page.locator('.filename-title')).toHaveText('new-note-3')
  await expect(page.locator(`${editor} h1`)).toContainText('New note')
})

test('note-list options provide Bear-like sorting, density, and pinned views', async ({ page }) => {
  await page.getByRole('button', { name: 'Note list options' }).click()
  const options = page.getByLabel('Note list options').filter({ has: page.getByText('2 notes') })
  await expect(options).toBeVisible()
  await expect(options.getByText('2 notes')).toBeVisible()

  await options.getByRole('button', { name: 'Small preview' }).click()
  const notes = page.getByRole('complementary', { name: 'Notes' })
  await expect(notes).toHaveAttribute('data-preview', 'small')
  await expect(notes.locator('.note-select span').first()).toHaveCSS('display', 'none')

  await page.getByRole('button', { name: 'Note list options' }).click()
  await page.getByLabel('Note list options').filter({ has: page.getByText('2 notes') }).getByRole('button', { name: 'Pinned' }).click()
  await expect(page.getByRole('button', { name: 'Welcome to SimpleMark', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Project Tanoa: Storm Atlas', exact: true })).toHaveCount(0)
})

test('typing flows through the application API and advances the document revision', async ({
  page,
}) => {
  const before = await page.evaluate(() => window.simplemark!.session.snapshot())
  expect(before.dirty).toBe(false)

  await caretAtEnd(page)
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
  // Under a loaded CI worker the final keystroke can arrive after the next
  // selection key. Wait for the document transaction before selecting it.
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('bold me')
  for (let i = 0; i < 'bold me'.length; i += 1) {
    await page.keyboard.press('Shift+ArrowLeft')
  }

  await page.getByRole('button', { name: 'Text formatting' }).click()
  await page.locator('.format-popover').getByRole('button', { name: 'Bold' }).click()

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('**bold me**')
})

// ADR-0003: the frame stays, its controls fade in. At rest a note is prose and
// pictures with no chrome; hover or keyboard focus reveals the block bar.
test('rendered-block controls are hidden at rest and revealed on hover', async ({ page }) => {
  const diagram = handbookMermaid(page)
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
  const diagram = handbookMermaid(page)
  await expect(diagram).toBeVisible()

  // Rendered by the real engine, not a placeholder.
  await expect(diagram.locator('.diagram-render svg')).toBeVisible()
  await expect(diagram.locator('.diagram-error')).toBeHidden()
  await expect(diagram.locator('.diagram-label')).toHaveText('mermaid')

  await diagram.getByRole('button', { name: 'Edit source' }).click()
  const sheet = page.locator('.diagram-source-sheet:not([hidden])')
  const source = sheet.locator('.diagram-source')
  await expect(source).toBeVisible()
  await expect(source).toHaveValue(/flowchart LR/)
  await expect(sheet).toHaveCSS('resize', 'both')

  // Editing the source updates the document through ProseMirror.
  await source.click()
  await source.press('End')
  await source.pressSequentially('\n  JUDGE --> OUT[Portable Markdown]')

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('OUT[Portable Markdown]')
})

test('invalid diagram source fails visibly and keeps its source editable', async ({ page }) => {
  const diagram = handbookMermaid(page)
  await diagram.getByRole('button', { name: 'Edit source' }).click()
  const source = page.locator('.diagram-source-sheet:not([hidden]) .diagram-source')

  await source.click()
  await source.press('ControlOrMeta+a')
  await source.pressSequentially('flowchart LR\n  A --> ((((')

  // An inline error card carrying the parser's message — never a blank frame.
  await expect(diagram.locator('.diagram-error')).toBeVisible()
  await expect(diagram.locator('.diagram-error')).not.toBeEmpty()
  await expect(source).toBeVisible()
})

// A renderer that *rejects* is a crash inside the renderer, which is a
// different thing from the `{ok: false}` a parser returns for source it can
// read but not draw. Only the second had a visible-failure path, so a crash
// left the last good picture on screen, said nothing, and reached the console
// as an unhandled rejection — the same bug class already fixed in the paste
// pipeline and in Convert to diagram.
test('a renderer that throws fails visibly instead of leaving stale markup', async ({ page }) => {
  const crashes: string[] = []
  page.on('pageerror', (error) => crashes.push(error.message))

  // Built here rather than taken from whatever the fixture note happens to
  // hold: "stale markup" is only a claim if this test put the picture on screen
  // itself and can see it go.
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('```mermaid ')
  const diagram = page.locator('.diagram').last()
  await diagram.getByRole('button', { name: 'Edit source' }).click()
  // Every block's sheet lives on <body>, so the open one is the only one that
  // belongs to the block under test.
  const source = page.locator('.diagram-source-sheet:not([hidden]) .diagram-source')
  await source.click()
  await source.pressSequentially('flowchart LR\n  A[Start] --> B[Middle]')
  await expect(diagram.locator('.diagram-render svg')).toBeVisible()

  await page.evaluate(() => {
    const editor = window.simplemark!.editor as unknown as {
      renderer: { render: () => Promise<never> }
    }
    editor.renderer.render = () => Promise.reject(new Error('renderer crashed'))
  })

  await source.press('ControlOrMeta+a')
  await source.pressSequentially('flowchart LR\n  A --> C')

  await expect(diagram.locator('.diagram-error')).toBeVisible()
  await expect(diagram.locator('.diagram-error-message')).toHaveText('renderer crashed')
  await expect(diagram.locator('.diagram-render svg')).toHaveCount(0)
  expect(crashes).toEqual([])
})

test('saving round-trips through the port and reopens as portable Markdown', async ({ page }) => {
  await caretAtEnd(page)
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
  await expect(handbookMermaid(page).locator('.diagram-render svg')).toBeVisible()
  const shot = await page.locator('.window').screenshot()
  await testInfo.attach('calm-state', { body: shot, contentType: 'image/png' })
})

// BUG-1 regression. EDITOR-1 shipped without @milkdown/kit/plugin/clipboard, so
// pasted Markdown was inserted as literal text and then escaped on serialise —
// turning a pasted document into 500+ paragraphs full of \# and \*\*. The UI
// suite exercised typing and toolbar commands but never a paste, which is
// exactly how it got through.
test('pasted Markdown is parsed, not inserted as escaped literal text', async ({ page }) => {
  const initialDiagrams = await page.locator('.diagram').count()
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
  await caretAtEnd(page)
  await page.evaluate((text) => navigator.clipboard.writeText(text), pasted)

  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+v')

  // Structure, not text: the paste became real nodes.
  await expect(page.locator(`${editor} h2`, { hasText: 'Pasted heading' })).toBeVisible()
  await expect(page.locator(`${editor} li`, { hasText: 'first item' })).toBeVisible()
  await expect(page.locator(`${editor} strong`, { hasText: 'bold' })).toBeVisible()

  // The fenced diagram went through the existing NodeView.
  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams + 1)

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
  expect(markdown).not.toContain('PASTE\\[Pasted\\]')
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
  await caretAtEnd(page)

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

  await expect(page.locator(`${editor} table`).filter({ has: page.getByText('The fence') })).toBeVisible()
  await expect(page.locator(`${editor} th`, { hasText: 'Take' })).toBeVisible()
  await expect(page.locator(`${editor} td`, { hasText: 'The fence' })).toBeVisible()
  await expect(page.locator(`${editor} li[data-item-type="task"]`, { hasText: 'unchecked task' })).toHaveCount(1)
  await expect(page.locator(`${editor} li[data-checked="true"]`, { hasText: 'checked task' })).toHaveCount(1)
  await expect(page.locator(`${editor} del, ${editor} s`, { hasText: 'struck' })).toBeVisible()

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
  const initialDiagrams = await page.locator('.diagram').count()

  await pasteAtEnd(page, BARE_MERMAID)

  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams + 1)
  await expect(page.locator('.diagram').last().locator('.diagram-render svg')).toBeVisible()
  await expect(page.locator('.diagram-error:visible')).toHaveCount(0)

  // §4.4: never lose the source — it lands on disk as a portable fence.
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('```mermaid')
})

// §4.4 "never lose the source", rejection flavour. Invalid diagram source
// resolves {ok: false} and falls back to the Markdown path — but a renderer
// that REJECTS (a crash inside a renderer, not a parse failure) settled into
// nothing: handlePaste had already claimed the event, so ProseMirror inserted
// nothing either and the pasted text vanished.
test('a renderer that rejects outright still lands the pasted text (§4.4)', async ({ page }) => {
  const initialDiagrams = await page.locator('.diagram').count()
  await page.evaluate(() => {
    // The composition's editor holds the same renderer object the paste
    // plugin captured, so patching it here forces the rejection path.
    const milkdown = window.simplemark!.editor as unknown as {
      renderer: { render(language: string, source: string): Promise<unknown> }
    }
    milkdown.renderer.render = () => Promise.reject(new Error('renderer crashed'))
  })

  await pasteAtEnd(page, BARE_MERMAID)

  // The fallback is the ordinary Markdown path: prose lands, no diagram, and
  // the source survives into the document.
  await expect(page.locator(editor)).toContainText('Bare paste')
  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams)
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('Bare paste')
  // Exactly the fixture's own fence — the rejected paste must not have added
  // a second one.
  const doc = await page.evaluate(() => window.simplemark!.session.snapshot().markdown)
  expect(doc.match(/```mermaid/g)).toHaveLength(1)
})

test('a bare <svg> pasted at a block boundary renders, sanitised', async ({ page }) => {
  const initialDiagrams = await page.locator('.diagram').count()
  // §7: scripts and event handlers must not survive.
  const hostile =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="window.__pwned=1">' +
    '<script>window.__pwned=1</script>' +
    '<rect x="10" y="10" width="80" height="80" fill="none" stroke="currentColor"/></svg>'

  await pasteAtEnd(page, hostile)

  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams + 1)
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
  const initialDiagrams = await page.locator('.diagram').count()
  // §4.2: "Prose beginning with the word 'graph' — mermaid.parse() rejects it."
  await pasteAtEnd(page, 'graph theory is the study of pairwise relations between objects.')

  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams)
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('graph theory is the study')
})

test('a multi-block paste takes the Markdown path and leaves bare diagram source as text', async ({
  page,
}) => {
  const initialDiagrams = await page.locator('.diagram').count()
  // §4.2: "Bare unfenced diagram source inside a larger paste stays text."
  await pasteAtEnd(page, ['## A heading', '', BARE_MERMAID, '', 'Trailing prose.'].join('\n'))

  await expect(page.locator(`${editor} h2`, { hasText: 'A heading' })).toBeVisible()
  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams)
})

test('svg-in-html wins over the text flavour (§4.2 priority 30)', async ({ page }) => {
  const initialDiagrams = await page.locator('.diagram').count()
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'
  await pasteAtEnd(page, 'irrelevant plain text', `<meta charset="utf-8"><div>${svg}</div>`)

  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams + 1)
  await expect(page.locator('.diagram').last().locator('.diagram-render svg circle')).toHaveCount(1)
})

test('undo after conversion restores the raw pasted text (§4.3)', async ({ page }) => {
  const initialDiagrams = await page.locator('.diagram').count()
  await pasteAtEnd(page, BARE_MERMAID)
  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams + 1)

  await page.keyboard.press('ControlOrMeta+z')

  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams)
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

  // The surrounding prose is intact — undo removed only the last edit.
  const after = await page.evaluate(() => window.simplemark!.session.snapshot().markdown)
  expect(after).toContain('This document is the demo.')
  expect(after).toContain('Paste technical material like magic')
})

const PASTED_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect width="20" height="30"/></svg>'

const RICH_HTML = `<meta charset="utf-8">
<h2>A pasted heading</h2>
<p>Some <strong>bold text</strong> and a <a href="https://example.test/">real link</a>.</p>
<ul><li>first bullet</li><li>second bullet</li></ul>
<table><thead><tr><th>Alert</th><th>Pad</th></tr></thead><tbody><tr><td>#854</td><td>GM A Pad</td></tr></tbody></table>
<p>Closing prose.</p>`

// What a browser actually puts in text/plain: no Markdown markers at all.
const RICH_TEXT = 'A pasted heading\nSome bold text and a real link.\nfirst bullet\nsecond bullet\nAlert\tPad\n#854\tGM A Pad\nClosing prose.'

test('a pasted document keeps its formatting (§4.2, HTML path)', async ({ page }) => {
  const initialTables = await page.locator(`${editor} table`).count()
  await pasteAtEnd(page, RICH_TEXT, RICH_HTML)

  await expect(page.locator(`${editor} h2`, { hasText: 'A pasted heading' })).toBeVisible()
  await expect(page.locator(`${editor} strong`, { hasText: 'bold text' })).toBeVisible()
  await expect(page.locator(`${editor} a[href="https://example.test/"]`)).toBeVisible()
  await expect(page.locator(`${editor} li`, { hasText: 'first bullet' })).toBeVisible()
  await expect(page.locator(`${editor} table`)).toHaveCount(initialTables + 1)
  await expect(page.locator(editor)).toContainText('Closing prose.')
})

// The reported bug, end to end: the chart arrived and everything else did not.
test('a pasted document containing a chart keeps both (§4.4 never lose the source)', async ({ page }) => {
  const initialTables = await page.locator(`${editor} table`).count()
  const initialDiagrams = await page.locator('.diagram').count()
  const html = RICH_HTML.replace('<p>Closing prose.</p>', `<figure>${PASTED_SVG}</figure><p>Closing prose.</p>`)
  await pasteAtEnd(page, RICH_TEXT, html)

  await expect(page.locator(`${editor} h2`, { hasText: 'A pasted heading' })).toBeVisible()
  await expect(page.locator(`${editor} table`)).toHaveCount(initialTables + 1)
  await expect(page.locator(editor)).toContainText('Closing prose.')
  // The chart survives in place, as the block the renderer already draws.
  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams + 1)
  await expect(page.locator('.diagram').last().locator('.diagram-render svg rect')).toHaveCount(1)
})

// BUG-1 regression guard: a plain-text copy of Markdown source is still parsed
// as Markdown, not inserted verbatim and escaped on the way out.
test('a plain-text Markdown paste still takes the Markdown path', async ({ page }) => {
  await pasteAtEnd(page, '## Plain markdown heading\n\nWith **bold** in it.')

  await expect(page.locator(`${editor} h2`, { hasText: 'Plain markdown heading' })).toBeVisible()
  await expect(page.locator(`${editor} strong`, { hasText: 'bold' })).toBeVisible()
})

test('a rendered diagram can be selected and deleted', async ({ page }) => {
  const initialDiagrams = await page.locator('.diagram').count()
  await pasteAtEnd(page, BARE_MERMAID)
  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams + 1)

  await page.locator('.diagram').last().locator('.diagram-render').click()
  await expect(page.locator('.diagram.is-selected')).toHaveCount(1)

  await page.keyboard.press('Backspace')
  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams)
})

test('right-clicking a diagram offers Delete', async ({ page }) => {
  const initialDiagrams = await page.locator('.diagram').count()
  await pasteAtEnd(page, BARE_MERMAID)
  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams + 1)

  await page.locator('.diagram').last().locator('.diagram-render').click({ button: 'right' })

  const menu = page.locator('.diagram-context-menu')
  await expect(menu).toBeVisible()
  await menu.getByRole('button', { name: 'Delete' }).click()

  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams)
  await expect(menu).toHaveCount(0)
})

// §2 of the chart-size spec: a pasted SVG has an author-chosen size, so the
// frame must not inflate it to the column the way it sizes a Mermaid render.
const SMALL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" viewBox="0 0 200 80"><rect width="120" height="40"/></svg>'

test('a pasted SVG renders at its natural width, not the column width', async ({ page }) => {
  const initialDiagrams = await page.locator('.diagram').count()
  await pasteAtEnd(page, SMALL_SVG)
  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams + 1)

  const svg = page.locator('.diagram').last().locator('.diagram-render svg')
  await expect(svg).toBeVisible()
  const box = await svg.boundingBox()
  expect(box!.width).toBeGreaterThan(150)
  expect(box!.width).toBeLessThan(260)
})

test('a pasted SVG with no discoverable size still fills the column', async ({ page }) => {
  const initialDiagrams = await page.locator('.diagram').count()
  await pasteAtEnd(page, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="40" height="20"/></svg>')
  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams + 1)

  const svg = page.locator('.diagram').last().locator('.diagram-render svg')
  await expect(svg).toBeVisible()
  const box = await svg.boundingBox()
  expect(box!.width).toBeGreaterThan(400)
})

// §6 of the chart-size spec: zoom is transient reader state on generated
// diagrams. Pasted SVGs get resize instead — no zoom controls there.
test('zoom controls scale a Mermaid diagram and reset to 100%', async ({ page }) => {
  const initialDiagrams = await page.locator('.diagram').count()
  await pasteAtEnd(page, BARE_MERMAID)
  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams + 1)

  const figure = page.locator('.diagram').last()
  const svg = figure.locator('.diagram-render svg')
  await expect(svg).toBeVisible()
  const before = (await svg.boundingBox())!.width

  await figure.locator('.diagram-zoom').getByRole('button', { name: 'Zoom in' }).click()
  await expect(figure.locator('.diagram-zoom-level')).toHaveText('125%')
  const zoomed = (await svg.boundingBox())!.width
  expect(zoomed).toBeGreaterThan(before * 1.1)

  await figure.locator('.diagram-zoom-level').click()
  await expect(figure.locator('.diagram-zoom-level')).toHaveText('100%')
})

test('zooming past the column engages the scroll rail', async ({ page }) => {
  await pasteAtEnd(page, BARE_MERMAID)
  const figure = page.locator('.diagram').last()
  const zoomIn = figure.locator('.diagram-zoom').getByRole('button', { name: 'Zoom in' })
  for (let i = 0; i < 6; i += 1) await zoomIn.click()
  await expect(figure.locator('.diagram-render.is-wide')).toHaveCount(1)
})

test('a pasted SVG block has no zoom controls', async ({ page }) => {
  await pasteAtEnd(page, SMALL_SVG)
  await expect(page.locator('.diagram').last().locator('.diagram-zoom')).toHaveCount(0)
})

// Review fix round 1, Finding 1: a dense diagram trips #fitDiagram's natural-width
// "wide" branch, which used to return before zoom ever ran — exactly the diagram a
// reader reaches for zoom on. Zoom must win over that default in both directions.
const WIDE_MERMAID = `flowchart LR\n${Array.from({ length: 12 }, (_, i) => `N${i + 1}[Node ${i + 1}]`).join(' --> ')}`

test('zoom overrides the wide default: zooming out un-wides a dense diagram, zooming in restores it', async ({
  page,
}) => {
  const initialDiagrams = await page.locator('.diagram').count()
  await pasteAtEnd(page, WIDE_MERMAID)
  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams + 1)

  const figure = page.locator('.diagram').last()
  const svg = figure.locator('.diagram-render svg')
  await expect(svg).toBeVisible()
  // Twelve chained nodes are comfortably past #WIDEST_SQUEEZE (1.6x the column)
  // at their natural size, so the diagram starts wide, unzoomed.
  await expect(figure.locator('.diagram-render.is-wide')).toHaveCount(1)
  const wideWidth = (await svg.boundingBox())!.width

  const zoomOut = figure.locator('.diagram-zoom').getByRole('button', { name: 'Zoom out' })
  await zoomOut.click()
  await zoomOut.click()
  await expect(figure.locator('.diagram-zoom-level')).toHaveText('64%')
  const shrunkWidth = (await svg.boundingBox())!.width
  expect(shrunkWidth).toBeLessThan(wideWidth)
  await expect(figure.locator('.diagram-render.is-wide')).toHaveCount(0)

  const zoomIn = figure.locator('.diagram-zoom').getByRole('button', { name: 'Zoom in' })
  for (let i = 0; i < 4; i += 1) await zoomIn.click()
  await expect(figure.locator('.diagram-render.is-wide')).toHaveCount(1)
  const regrownWidth = (await svg.boundingBox())!.width
  expect(regrownWidth).toBeGreaterThan(shrunkWidth)
})

// Review fix round 1, Finding 2: the zoom base has to match the resting fill
// width (capped at #FILL_CAP), or a reader on a column wider than 720px sees a
// zoom step's visual growth overshoot its own percentage readout.
test('zoom scales from the capped fill width, not the raw column, on a wide reading column', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.getByRole('button', { name: 'Text formatting' }).click()
  await page.locator('.format-popover').getByRole('button', { name: 'Wide width' }).click()
  // Close the popover — left open, it sits over the diagram and intercepts
  // the zoom-button click below.
  await page.getByRole('button', { name: 'Text formatting' }).click()
  await expect(page.locator('.format-popover')).not.toHaveClass(/open/)

  const initialDiagrams = await page.locator('.diagram').count()
  await pasteAtEnd(page, BARE_MERMAID)
  await expect(page.locator('.diagram')).toHaveCount(initialDiagrams + 1)
  const figure = page.locator('.diagram').last()
  const svg = figure.locator('.diagram-render svg')
  await expect(svg).toBeVisible()
  const before = (await svg.boundingBox())!.width

  await figure.locator('.diagram-zoom').getByRole('button', { name: 'Zoom in' }).click()
  await expect(figure.locator('.diagram-zoom-level')).toHaveText('125%')
  const zoomed = (await svg.boundingBox())!.width

  // The readout says 125% — the rendered growth has to match it, not the
  // wider (uncapped) column the readout is blind to.
  expect(zoomed).toBeGreaterThan(before * 1.2)
  expect(zoomed).toBeLessThan(before * 1.3)
})

// D7: the fence info tail is part of the user's bytes. Milkdown drops it by
// default; the schema extension is what carries it through a serialise.
test('fence meta survives an edit-elsewhere round trip', async ({ page }) => {
  await pasteAtEnd(page, '```svg width=320 twoslash\n<svg viewBox="0 0 4 4"><rect/></svg>\n```')

  // The parse direction: `width=320` in the fence meta must drive the render,
  // not just survive as bytes — otherwise this test could pass on a parser
  // that keeps the meta string but a renderer that ignores it.
  const svg = page.locator('.diagram').last().locator('.diagram-render svg')
  await expect(svg).toBeVisible()
  const box = (await svg.boundingBox())!
  expect(box.width).toBeGreaterThan(300)
  expect(box.width).toBeLessThan(340)

  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Unrelated edit.')

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('```svg width=320 twoslash')
})

// §4 of the chart-size spec: dragging the grip persists width= into the
// fence meta — the document, not the DOM, is where layout lives.
test('dragging the resize grip persists width= and the render honors it', async ({ page }) => {
  await pasteAtEnd(page, SMALL_SVG)
  const figure = page.locator('.diagram').last()
  await figure.locator('.diagram-render').click()
  await expect(page.locator('.diagram.is-selected')).toHaveCount(1)

  const grip = figure.locator('.diagram-resize-grip')
  await expect(grip).toBeVisible()
  const gripBox = (await grip.boundingBox())!
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(gripBox.x + gripBox.width / 2 + 120, gripBox.y + gripBox.height / 2, { steps: 6 })
  await page.mouse.up()

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toMatch(/```svg width=3\d\d/)

  const svg = figure.locator('.diagram-render svg')
  const box = (await svg.boundingBox())!
  expect(box.width).toBeGreaterThan(290)
  expect(box.width).toBeLessThan(360)
})

// Fix round 1, Finding 1: an svg whose natural width already trips the wide
// threshold used to have the wide branch run before the meta-aware svg
// branch — a drag would commit width= correctly and then get overwritten
// straight back to natural on the very next paint. The committed width must
// win over the wide default, the same way zoom already wins over it for
// generated diagrams.
const WIDE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="200" viewBox="0 0 1200 200"><rect width="1160" height="160"/></svg>'

test('a committed resize wins over the wide default for an oversized svg', async ({ page }) => {
  await pasteAtEnd(page, WIDE_SVG)
  const figure = page.locator('.diagram').last()
  await expect(figure.locator('.diagram-render.is-wide')).toHaveCount(1)

  await figure.locator('.diagram-render').click()
  await expect(page.locator('.diagram.is-selected')).toHaveCount(1)

  const grip = figure.locator('.diagram-resize-grip')
  await expect(grip).toBeVisible()
  const gripBox = (await grip.boundingBox())!
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
  await page.mouse.down()
  // Dragged far past the left edge of the column — #MIN_WIDTH floors the
  // result, so the committed width is deterministic (120) regardless of the
  // column's actual measure.
  await page.mouse.move(10, gripBox.y + gripBox.height / 2, { steps: 8 })
  await page.mouse.up()

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toMatch(/```svg width=120(?!\d)/)

  const svg = figure.locator('.diagram-render svg')
  const box = (await svg.boundingBox())!
  expect(box.width).toBeLessThan(200)
  expect(box.width).toBeGreaterThan(100)
  await expect(figure.locator('.diagram-render.is-wide')).toHaveCount(0)
})

// §5 of the chart-size spec: float is a menu action on svg figures, persisted
// as float= in the meta, and narrow viewports ignore it entirely.
test('Float left wraps prose around a small chart; Inline undoes it', async ({ page }) => {
  await pasteAtEnd(page, SMALL_SVG)
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Prose that should wrap beside the floated chart.')

  const figure = page.locator('.diagram').last()
  await figure.locator('.diagram-render').click({ button: 'right' })
  await page.locator('.diagram-context-menu').getByRole('button', { name: 'Float left' }).click()

  await expect(figure).toHaveClass(/diagram--float-left/)
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('float=left')
  expect(await figure.evaluate((el) => getComputedStyle(el).float)).toBe('left')

  await figure.locator('.diagram-render').click({ button: 'right' })
  await page.locator('.diagram-context-menu').getByRole('button', { name: 'Inline' }).click()
  await expect(figure).not.toHaveClass(/diagram--float-left/)
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .not.toContain('float=')
})

// Float, then narrow the viewport — not the brief's order. At <=620px
// `.document-surface` is `display: none` unless a note was opened while
// already single-pane (window-chrome.ts's `isSinglePane` escape hatch); a
// note already open from a desktop-width `beforeEach` never trips that, so
// resizing first leaves the editor unfocusable and `pasteAtEnd` hangs on
// nothing the float feature controls. Floating before the resize checks the
// same CSS (float only ever reads the current viewport) without the
// unrelated pane visibility gate.
test('a narrow viewport ignores float', async ({ page }) => {
  await pasteAtEnd(page, SMALL_SVG)
  const figure = page.locator('.diagram').last()
  await figure.locator('.diagram-render').click({ button: 'right' })
  await page.locator('.diagram-context-menu').getByRole('button', { name: 'Float left' }).click()
  await expect(figure).toHaveClass(/diagram--float-left/)

  await page.setViewportSize({ width: 420, height: 800 })
  expect(await figure.evaluate((el) => getComputedStyle(el).float)).toBe('none')
})

// Fix round 2, Finding 1: a floated figure is `width: fit-content`, so its
// own render box collapses toward the drawing and cannot stand in for "the
// column" — both the float menu's room-to-wrap check and the resize clamp
// used it, and both broke the moment a chart had already floated once.
test('a floated chart can re-float to the other side and still grow on drag', async ({ page }) => {
  await pasteAtEnd(page, SMALL_SVG)
  const figure = page.locator('.diagram').last()
  await figure.locator('.diagram-render').click({ button: 'right' })
  await page.locator('.diagram-context-menu').getByRole('button', { name: 'Float left' }).click()
  await expect(figure).toHaveClass(/diagram--float-left/)

  // (a) Switching sides must not require a detour through Inline first.
  await figure.locator('.diagram-render').click({ button: 'right' })
  const menu = page.locator('.diagram-context-menu')
  await expect(menu).toBeVisible()
  const floatRight = menu.getByRole('button', { name: 'Float right' })
  await expect(floatRight).toBeEnabled()
  await floatRight.click()
  await expect(figure).toHaveClass(/diagram--float-right/)
  await expect(figure).not.toHaveClass(/diagram--float-left/)

  // (b) A grow-drag on a floated chart must not clamp at its current width,
  // nor land in the edge-clear band and silently delete the committed width=.
  await figure.locator('.diagram-render').click()
  await expect(page.locator('.diagram.is-selected')).toHaveCount(1)

  const svg = figure.locator('.diagram-render svg')
  await expect(svg).toBeVisible()
  const beforeWidth = (await svg.boundingBox())!.width

  const grip = figure.locator('.diagram-resize-grip')
  await expect(grip).toBeVisible()
  const gripBox = (await grip.boundingBox())!
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(gripBox.x + gripBox.width / 2 + 100, gripBox.y + gripBox.height / 2, { steps: 6 })
  await page.mouse.up()

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toMatch(/width=\d+/)

  const afterWidth = (await svg.boundingBox())!.width
  expect(afterWidth).toBeGreaterThan(beforeWidth + 30)
})

// Regression: the task checkbox is drawn by CSS on the list item and the app
// only reached `checked` through the Format menu, so the box everyone tries to
// click was decoration — a pointer press just placed the caret.
test('clicking the checkbox toggles the task under it', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type('a thing to do')
  await page.getByLabel('Styles bar').getByRole('button', { name: 'Todo', exact: true }).click()

  const item = page.locator(`${editor} li[data-item-type="task"]`).filter({ hasText: 'a thing to do' })
  await expect(item).toHaveCount(1)
  await expect(item).toHaveAttribute('data-checked', 'false')

  const box = (await item.boundingBox())!
  await page.mouse.click(box.x + 7, box.y + 15)

  await expect(item).toHaveAttribute('data-checked', 'true')
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toMatch(/\[x\] a thing to do/)

  await page.mouse.click(box.x + 7, box.y + 15)

  await expect(item).toHaveAttribute('data-checked', 'false')
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toMatch(/\[ \] a thing to do/)
})
