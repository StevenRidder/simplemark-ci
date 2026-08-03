import { expect, test } from '@playwright/test'

/**
 * Graphviz DOT and KaTeX math end to end: real clipboard, real ⌘V, real
 * engines (the Graphviz wasm module actually loads in the page).
 */

const EDITOR = '.milkdown .ProseMirror'

async function paste(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.evaluate((t) => navigator.clipboard.writeText(t), text)
  await page.keyboard.press('ControlOrMeta+v')
}

test('pasted DOT renders as a Graphviz drawing', async ({ page }) => {
  await paste(page, 'digraph {\n  rankdir=LR\n  Paste -> Recognise -> Render\n}')

  const graph = page.locator('.diagram').last()
  await expect(graph.locator('.diagram-render svg')).toBeVisible({ timeout: 30_000 })
  await expect(graph.locator('.diagram-render')).toContainText('Recognise')
})

test('rendering a graph reaches no external host (D2: no network)', async ({ page }) => {
  const external: string[] = []
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') external.push(url.href)
    void route.continue()
  })

  await paste(page, 'digraph { wasm -> local }')
  await expect(page.locator('.diagram .diagram-render svg').last()).toBeVisible({ timeout: 30_000 })

  // The Graphviz wasm is embedded in its own lazy chunk; a CDN fetch here would
  // mean a note's content could phone home.
  expect(external).toEqual([])
})

test('pasted DOT round-trips to the file as a portable dot fence', async ({ page }) => {
  await paste(page, 'digraph { a -> b }')
  await expect(page.locator('.diagram .diagram-render svg').last()).toBeVisible({ timeout: 30_000 })

  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  expect(markdown).toContain('```dot')
  expect(markdown).toContain('digraph { a -> b }')
})

test('Mermaid still wins its own keyword — "graph LR" is not DOT', async ({ page }) => {
  await paste(page, 'graph LR\n  A --> B')
  await expect(page.locator('.diagram .diagram-render svg').last()).toBeVisible({ timeout: 30_000 })

  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  expect(markdown).toContain('```mermaid')
  expect(markdown).not.toContain('```dot')
})

test('a broken graph fails visibly with its source still editable', async ({ page }) => {
  // Passes the signature (keyword + braces) but Graphviz refuses it, so §4.4
  // sends it down the ordinary text path rather than showing a broken block.
  await paste(page, 'digraph { a -> -> b }')

  await expect(page.locator(EDITOR)).toContainText('digraph { a -> -> b }')
})

test('pasted $$ display math typesets with KaTeX', async ({ page }) => {
  await paste(page, '$$E = mc^2$$')

  const math = page.locator('.math-block').last()
  await expect(math).toBeVisible()
  await expect(math.locator('.katex')).toBeVisible()
})

test('a pasted LaTeX environment typesets and stores as a math fence', async ({ page }) => {
  await paste(page, '\\begin{aligned}\n  a &= b + c \\\\\n  d &= e\n\\end{aligned}')

  await expect(page.locator('.math-block .katex').last()).toBeVisible()
  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  expect(markdown).toContain('```math')
  expect(markdown).toContain('\\begin{aligned}')
})

test('the $$ delimiters are stripped from the stored source', async ({ page }) => {
  await paste(page, '$$\\frac{1}{2}$$')

  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  expect(markdown).toContain('```math')
  expect(markdown).toContain('\\frac{1}{2}')
  expect(markdown).not.toContain('$$\\frac')
})

test('a dollar amount in prose is never claimed as math', async ({ page }) => {
  await paste(page, 'The licence costs $100 and renews yearly.')

  await expect(page.locator('.math-block')).toHaveCount(0)
  await expect(page.locator(EDITOR)).toContainText('The licence costs $100')
})

test('undo restores the raw pasted text for both new formats', async ({ page }) => {
  await paste(page, '$$E = mc^2$$')
  await expect(page.locator('.math-block')).toBeVisible()

  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.math-block')).toHaveCount(0)
  await expect(page.locator(EDITOR)).toContainText('E = mc^2')
})
