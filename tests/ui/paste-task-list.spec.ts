import { expect, test } from '@playwright/test'

/**
 * A pasted task list keeps its ticks.
 *
 * `tests/ui/paste-chat-answer-fidelity.spec.ts` measured the loss: a GFM task
 * list copied out of a browser goes down the §4.2 HTML path, and the schema had
 * no rule for `<input type="checkbox">`, so every item arrived as an ordinary
 * bullet and the checked/unchecked state was simply gone. That is not specific
 * to one source — a chat UI, GitHub, Notion and Confluence all publish a
 * checkbox inside the `<li>`, and all of them lost it.
 *
 * These tests use `text/plain` flavours that contain **no** `- [x]` syntax at
 * all — stripped prose, the way a browser selection copy really arrives. So a
 * tick in the serialised document can only have come from the HTML, which is
 * what makes this a measurement of the HTML path rather than of the fallback.
 *
 * The markup shapes are deliberately different from each other. Milkdown's own
 * task item round-trips through `li[data-item-type="task"]`, and nothing here
 * writes that attribute: the point is the shape *other* tools publish.
 */

const EDITOR = '.milkdown .ProseMirror'

/** GitHub / remark-gfm: the class-marked list every Markdown renderer emits. */
const GITHUB_TASK_LIST = {
  text: 'Handles streaming input\nHandles removing a sample',
  html: '<ul class="contains-task-list">\n'
    + '<li class="task-list-item"><input type="checkbox" checked="" disabled=""> Handles streaming input</li>\n'
    + '<li class="task-list-item"><input type="checkbox" disabled=""> Handles removing a sample</li>\n'
    + '</ul>',
}

/**
 * A wrapped checkbox with no task class on the item — the shape an app-styled
 * list (Notion, Confluence, a chat UI's own CSS) publishes. A rule keyed on the
 * `task-list-item` class would keep the ticks for GitHub and quietly drop them
 * for everyone else, which is the failure this file exists to prevent.
 */
const APP_STYLED_TASK_LIST = {
  text: 'Wire the adapter\nDelete the workaround',
  html: '<ul>\n'
    + '<li><span class="cb"><input type="checkbox" checked="checked"></span><span>Wire the adapter</span></li>\n'
    + '<li><span class="cb"><input type="checkbox"></span><span>Delete the workaround</span></li>\n'
    + '</ul>',
}

/** A task list inside a task list: state has to survive at both depths. */
const NESTED_TASK_LIST = {
  text: 'Paste pipeline\nHTML path\nMarkdown path\nRender the result',
  html: '<ul class="contains-task-list">\n'
    + '<li class="task-list-item"><input type="checkbox" checked=""> Paste pipeline\n'
    + '<ul class="contains-task-list">\n'
    + '<li class="task-list-item"><input type="checkbox" checked=""> HTML path</li>\n'
    + '<li class="task-list-item"><input type="checkbox"> Markdown path</li>\n'
    + '</ul>\n'
    + '</li>\n'
    + '<li class="task-list-item"><input type="checkbox"> Render the result</li>\n'
    + '</ul>',
}

/** Tasks and plain bullets in one list: only the items with a box are tasks. */
const MIXED_LIST = {
  text: 'A plain bullet\nA real task',
  html: '<ul>\n'
    + '<li>A plain bullet</li>\n'
    + '<li class="task-list-item"><input type="checkbox" checked=""> A real task</li>\n'
    + '</ul>',
}

/**
 * Replaces the whole document with the paste, and returns what would be saved.
 *
 * Select-all first so the serialisation is the paste and nothing else. A
 * selection replacement still counts as a block boundary (§4.2 condition 1),
 * so this does not change which path the paste takes.
 */
async function pasteAndSerialize(
  page: import('@playwright/test').Page,
  payload: { text: string; html: string },
  marker: string,
): Promise<string> {
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  // Headless Chromium refuses the async clipboard on an unfocused document.
  await page.bringToFront()
  await page.evaluate(() => window.simplemark!.editor.focusEnd())

  await page.evaluate(
    async ({ text, html }) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ])
    },
    payload,
  )

  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ControlOrMeta+v')

  // Settled, not merely present: a NodeView that mounts after the insert can
  // still commit back into the document, so first sight of the marker is a
  // half-built reading.
  let previous = ''
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.simplemark!.editor.serialize())
        const settled = current === previous && current.includes(marker)
        previous = current
        return settled
      },
      { timeout: 30_000, intervals: [250] },
    )
    .toBe(true)

  return previous
}

test('a checked and an unchecked item keep their state through the HTML path', async ({ page }) => {
  const markdown = await pasteAndSerialize(page, GITHUB_TASK_LIST, 'Handles streaming input')

  expect(markdown).toMatch(/^\* \[x] Handles streaming input$/m)
  expect(markdown).toMatch(/^\* \[ ] Handles removing a sample$/m)
})

test('a checkbox wrapped in its own element is still a task', async ({ page }) => {
  const markdown = await pasteAndSerialize(page, APP_STYLED_TASK_LIST, 'Wire the adapter')

  expect(markdown).toMatch(/^\* \[x] Wire the adapter$/m)
  expect(markdown).toMatch(/^\* \[ ] Delete the workaround$/m)
})

test('a nested task list keeps the state of the parent and of each child', async ({ page }) => {
  const markdown = await pasteAndSerialize(page, NESTED_TASK_LIST, 'Paste pipeline')

  expect(markdown).toMatch(/^\* \[x] Paste pipeline$/m)
  expect(markdown).toMatch(/^ {2,}\* \[x] HTML path$/m)
  expect(markdown).toMatch(/^ {2,}\* \[ ] Markdown path$/m)
  expect(markdown).toMatch(/^\* \[ ] Render the result$/m)
})

test('a bullet with no checkbox beside a task stays a plain bullet', async ({ page }) => {
  const markdown = await pasteAndSerialize(page, MIXED_LIST, 'A plain bullet')

  expect(markdown).toMatch(/^\* A plain bullet$/m)
  expect(markdown).toMatch(/^\* \[x] A real task$/m)
})

test('the pasted checkbox is state, never a stray input in the text', async ({ page }) => {
  const markdown = await pasteAndSerialize(page, GITHUB_TASK_LIST, 'Handles streaming input')

  expect(markdown).not.toContain('<input')
  // The leading space after the box belongs to the markup, not to the label.
  expect(markdown).not.toMatch(/\[[ x]] {2}/)
})

/**
 * The round trip that matters: what reaches the file.
 *
 * Serialising in memory is not the claim — the claim is that a person pastes a
 * task list, saves, and the `.md` on disk is ordinary GFM that any other tool
 * reads back as tasks. The file lives in OPFS, so every byte goes through the
 * real BrowserFilePort.
 */
test('a pasted task list saves to the file as real GFM task syntax', async ({ page }) => {
  await page.addInitScript(() => {
    window.showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle('pasted-tasks.md', { create: true })
      const file = await handle.getFile()
      if (file.size === 0) {
        const writable = await handle.createWritable()
        await writable.write('# Pasted tasks\n\nReplace me.\n')
        await writable.close()
      }
      return [handle]
    }
  })

  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.bringToFront()
  await page.getByRole('button', { name: 'Open file' }).click()
  await expect(page.locator('.filename-title')).toHaveText('pasted-tasks')

  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.evaluate(
    async ({ text, html }) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ])
    },
    NESTED_TASK_LIST,
  )
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ControlOrMeta+v')

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('Paste pipeline')
  await page.evaluate(() => window.simplemark!.save())

  const onDisk = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle('pasted-tasks.md')
    return (await handle.getFile()).text()
  })

  expect(onDisk).toMatch(/^\* \[x] Paste pipeline$/m)
  expect(onDisk).toMatch(/^ {2,}\* \[ ] Markdown path$/m)
  expect(onDisk).not.toContain('<input')

  // And it reads back as tasks, from the file's own bytes.
  await page.getByRole('button', { name: 'Open file' }).click()
  await expect(page.locator('.filename-title')).toHaveText('pasted-tasks')
  await expect(page.locator(`${EDITOR} li[data-item-type="task"][data-checked="true"]`).first())
    .toContainText('Paste pipeline')
})
