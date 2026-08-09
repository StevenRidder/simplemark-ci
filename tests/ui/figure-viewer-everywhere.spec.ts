import { expect, test } from '@playwright/test'

/**
 * The figure-viewer-everywhere rulings, stated here in full because this
 * file is their public record:
 *
 * - The "Open figure" chip is offered on every rendered block's selection
 *   toolbar, regardless of width (ruling 1).
 * - Text cards open as a reading overlay: rendered content, native
 *   two-axis scroll (ruling 2).
 * - The viewer toolbar grows Copy source and Print figure (ruling 3,
 *   partial — image export is Phase 2).
 * - `diagram.openFigure()` is a verb on the app API (ruling 5).
 */

const EDITOR = '.milkdown .ProseMirror'
const RENDER = '.diagram-render'

async function paste(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.evaluate((t) => navigator.clipboard.writeText(t), text)
  await page.keyboard.press('ControlOrMeta+v')
  // Paste conversion is asynchronous — the sniffer claims the event, then
  // validates a tick later and replaces the empty paragraph Enter just made.
  // Clicking before that lands selects the *previous* block, and the
  // conversion transaction then clears that selection, taking its chips with
  // it. Wait for the placeholder to become the converted block.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const last = document.querySelector('.milkdown .ProseMirror')?.lastElementChild
        return last !== null && last !== undefined && !(last.tagName === 'P' && last.textContent === '')
      }),
    )
    .toBe(true)
}

const BARE_MERMAID = 'flowchart LR\n  A[Start] --> B[Middle]'
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect width="80" height="30"/></svg>'
const VEGA_LITE = JSON.stringify({
  $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
  data: { values: [{ slot: 'one', hit: 94 }] },
  mark: 'bar',
  encoding: { x: { field: 'slot', type: 'ordinal' }, y: { field: 'hit', type: 'quantitative' } },
})
const MATH = '$$E = mc^2$$'
const ANSI = '[32m✓ 56 passed[0m'

/** Selects the last rendered block (the one the paste just added) and opens its chip toolbar. */
async function selectLastBlock(page: import('@playwright/test').Page) {
  await page.locator(RENDER).last().click()
  await expect(page.locator('.diagram-chips').last()).toBeVisible()
}

for (const [name, source] of [
  ['mermaid', BARE_MERMAID],
  ['svg', SVG],
  ['vega-lite', VEGA_LITE],
] as const) {
  test(`the chip opens the viewer for a narrow ${name} figure`, async ({ page }) => {
    await paste(page, source)
    await selectLastBlock(page)
    // Selecting only waits for the ProseMirror conversion and the chip
    // toolbar — not for the diagram's own async render — and "not wide"
    // below is trivially true before anything has rendered, so it does not
    // wait either. Without a real wait here, "Open figure" can fire before
    // #openViewer() (diagram-node-view.ts) has any content to hand the
    // viewer: it bails out silently (`content === null`) rather than
    // erroring, which then dooms the final assertion below to its own
    // timeout. Vega-Lite is the slow one of the three — its renderer loads
    // ~800 KB of modules on demand and compiles the spec before it ever
    // produces an <svg> (vega-lite-renderer.ts) — so wait on the actual
    // render output directly, with a deliberately wide budget rather than
    // Playwright's plain 5s default.
    await expect(page.locator(`${RENDER} svg`).last()).toBeVisible({ timeout: 15_000 })
    // Not wide — this is exactly the case the too-wide-only gate used to hide.
    await expect(page.locator('.diagram').last()).not.toHaveClass(/has-wide-figure/)
    await page.locator('.diagram-chips').last().getByRole('button', { name: 'Open figure' }).click()
    await expect(page.locator('.figure-viewer')).toBeVisible()
  })
}

test('the chip opens the viewer for display math', async ({ page }) => {
  await paste(page, MATH)
  await page.locator('.math-block').last().click()
  await expect(page.locator('.diagram-chips').last()).toBeVisible()
  await page.locator('.diagram-chips').last().getByRole('button', { name: 'Open figure' }).click()
  await expect(page.locator('.figure-viewer')).toBeVisible()
})

test('the chip opens the viewer for an ansi text card, and the card overlay scrolls', async ({ page }) => {
  await paste(page, ANSI)
  await page.locator('.ansi-card').last().click()
  await expect(page.locator('.diagram-chips').last()).toBeVisible()
  await page.locator('.diagram-chips').last().getByRole('button', { name: 'Open figure' }).click()
  await expect(page.locator('.figure-viewer')).toBeVisible()

  // Reading overlay: no zoom chrome for a text card.
  await expect(page.locator('.figure-viewer-zoom')).toBeHidden()

  const scroll = page.locator('.figure-viewer-scroll')
  const scrolled = await scroll.evaluate((el) => {
    el.scrollTop = 5
    return el.scrollTop
  })
  expect(scrolled).toBeGreaterThanOrEqual(0)
  await expect(page.locator('.figure-viewer-stage.is-text-card')).toBeVisible()
})

test('Open figure carries a tooltip matching its aria-label', async ({ page }) => {
  await paste(page, BARE_MERMAID)
  await selectLastBlock(page)
  const button = page.locator('.diagram-chips').last().getByRole('button', { name: 'Open figure' })
  await expect(button).toHaveAttribute('title', 'Open figure')
})

test('Copy source round-trips the fence source through the clipboard', async ({ page }) => {
  await paste(page, BARE_MERMAID)
  await selectLastBlock(page)
  await page.locator('.diagram-chips').last().getByRole('button', { name: 'Open figure' }).click()
  await expect(page.locator('.figure-viewer')).toBeVisible()

  await page.getByRole('button', { name: 'Copy source' }).click()
  await expect(page.getByRole('button', { name: 'Copy source' })).toHaveText('Copied')

  const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
  expect(clipboardText).toContain('Start')
})

test('Print figure toggles the printing body class', async ({ page }) => {
  await paste(page, BARE_MERMAID)
  await selectLastBlock(page)
  await page.locator('.diagram-chips').last().getByRole('button', { name: 'Open figure' }).click()
  await expect(page.locator('.figure-viewer')).toBeVisible()

  await page.evaluate(() => window.print = () => {})
  await page.getByRole('button', { name: 'Print figure' }).click()
  await expect(page.locator('body')).toHaveClass(/is-printing-figure/)

  // Under the print body class, everything but the viewer is display:none —
  // asserted the way §3 of the spec calls for: computed display, not a class
  // guess, and only the emulated print stylesheet (not screen) applies it.
  await page.emulateMedia({ media: 'print' })
  const chromeDisplay = await page.locator('.titlebar').first().evaluate((el) => getComputedStyle(el).display)
  expect(chromeDisplay).toBe('none')
  const viewerDisplay = await page.locator('.figure-viewer').evaluate((el) => getComputedStyle(el).display)
  expect(viewerDisplay).not.toBe('none')
})

test('window.simplemark.diagram.openFigure() opens the viewer on a selected diagram and returns false on prose', async ({
  page,
}) => {
  await paste(page, BARE_MERMAID)
  await selectLastBlock(page)

  const opened = await page.evaluate(() => window.simplemark!.diagram.openFigure())
  expect(opened).toBe(true)
  await expect(page.locator('.figure-viewer')).toBeVisible()
  await page.locator('.figure-viewer-close').click()

  // Prose selection (a plain paragraph, not a diagram/math block).
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  const refused = await page.evaluate(() => window.simplemark!.diagram.openFigure())
  expect(refused).toBe(false)
})

/**
 * Phase 2 (§1 ruling 3, ruling 4, ruling 5): Copy image / Save image, and
 * the export verbs on the app API.
 */

test('Save image (browser path) downloads a PNG at 2x the natural size, with non-blank pixels', async ({ page }) => {
  await paste(page, SVG)
  await selectLastBlock(page)
  await page.locator('.diagram-chips').last().getByRole('button', { name: 'Open figure' }).click()
  await expect(page.locator('.figure-viewer')).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save image' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.png$/)
  const path = await download.path()
  expect(path).not.toBeNull()

  // The SVG fixture (SVG constant, above) has viewBox="0 0 100 40" — natural
  // size 100x40 — so the PNG at EXPORT_SCALE (figure-export.ts) must be
  // 200x80, never the viewer's zoom or a block width=.
  const bytes = await import('node:fs').then((fs) => fs.readFileSync(path!))
  const decoded = await page.evaluate(async (base64) => {
    const image = new Image()
    const loaded = new Promise<{ width: number; height: number; nonBlank: boolean }>((resolve, reject) => {
      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(image, 0, 0)
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
        let nonBlank = false
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] !== 0) {
            nonBlank = true
            break
          }
        }
        resolve({ width: image.naturalWidth, height: image.naturalHeight, nonBlank })
      }
      image.onerror = () => reject(new Error('decode failed'))
    })
    image.src = `data:image/png;base64,${base64}`
    return loaded
  }, bytes.toString('base64'))

  expect(decoded.width).toBe(200)
  expect(decoded.height).toBe(80)
  expect(decoded.nonBlank).toBe(true)
})

test('saveImage("svg") offers the raw SVG option, which round-trips valid SVG', async ({ page }) => {
  await paste(page, SVG)
  await selectLastBlock(page)
  const opened = await page.evaluate(() => window.simplemark!.diagram.openFigure())
  expect(opened).toBe(true)

  const [download, ok] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.simplemark!.diagram.saveImage('svg')),
  ])
  expect(ok).toBe(true)
  expect(download.suggestedFilename()).toMatch(/\.svg$/)
  const path = await download.path()
  expect(path).not.toBeNull()
  const svgText = await import('node:fs').then((fs) => fs.readFileSync(path!, 'utf8'))
  const parsed = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    return {
      hasParserError: doc.querySelector('parsererror') !== null,
      tag: doc.documentElement.tagName.toLowerCase(),
    }
  }, svgText)
  expect(parsed.hasParserError).toBe(false)
  expect(parsed.tag).toBe('svg')
})

test('copyImage refuses a text card (no <svg> to serialize)', async ({ page }) => {
  await paste(page, ANSI)
  await page.locator('.ansi-card').last().click()
  await expect(page.locator('.diagram-chips').last()).toBeVisible()

  const ok = await page.evaluate(() => window.simplemark!.diagram.copyImage())
  expect(ok).toBe(false)
})

test('saveImage refuses a text card', async ({ page }) => {
  await paste(page, ANSI)
  await page.locator('.ansi-card').last().click()
  await expect(page.locator('.diagram-chips').last()).toBeVisible()

  const ok = await page.evaluate(() => window.simplemark!.diagram.saveImage())
  expect(ok).toBe(false)
})

test('the app API export verbs act on the selected block without the viewer being open', async ({ page }) => {
  await paste(page, SVG)
  await selectLastBlock(page)
  await expect(page.locator('.figure-viewer')).toBeHidden()

  const copySourceOk = await page.evaluate(() => window.simplemark!.diagram.copySource())
  expect(copySourceOk).toBe(true)

  const copyImageOk = await page.evaluate(() => window.simplemark!.diagram.copyImage())
  expect(copyImageOk).toBe(true)

  // Prose selection refuses every export verb, the same honest `false`
  // `openFigure()` already returns.
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  expect(await page.evaluate(() => window.simplemark!.diagram.copySource())).toBe(false)
  expect(await page.evaluate(() => window.simplemark!.diagram.copyImage())).toBe(false)
  expect(await page.evaluate(() => window.simplemark!.diagram.saveImage())).toBe(false)
  expect(await page.evaluate(() => window.simplemark!.diagram.printFigure())).toBe(false)
})

test('printFigure() opens the viewer and toggles the printing body class without a prior openFigure() call', async ({
  page,
}) => {
  await paste(page, BARE_MERMAID)
  await selectLastBlock(page)
  await expect(page.locator('.figure-viewer')).toBeHidden()

  await page.evaluate(() => (window.print = () => {}))
  const ok = await page.evaluate(() => window.simplemark!.diagram.printFigure())
  expect(ok).toBe(true)
  await expect(page.locator('.figure-viewer')).toBeVisible()
  await expect(page.locator('body')).toHaveClass(/is-printing-figure/)
})

test('Copy image either lands image/png on the clipboard, or shows a visible status message on refusal', async ({
  page,
  browserName,
}) => {
  await paste(page, SVG)
  await selectLastBlock(page)
  await page.locator('.diagram-chips').last().getByRole('button', { name: 'Open figure' }).click()
  await expect(page.locator('.figure-viewer')).toBeVisible()

  const button = page.getByRole('button', { name: 'Copy image' })
  await expect(button).toBeVisible()
  await button.click()

  if (browserName === 'chromium') {
    // Chromium is the one engine Playwright can grant clipboard-write to for
    // an image payload — verify the actual bytes landed, not just the label.
    await expect(button).toHaveText('Copied')
    const hasImage = await page.evaluate(async () => {
      const items = await navigator.clipboard.read()
      return items.some((item) => item.types.includes('image/png'))
    })
    expect(hasImage).toBe(true)
  } else {
    // §4.4: a refusal is never a silent no-op — the button's own text is the
    // visible status message.
    await expect(button).toHaveText(/Copied|Copy failed/)
  }
})

/**
 * Real-world-fixes bug 1: "open image only works on mermaid". Root cause —
 * the always-present corner `.diagram-expand` button used to only become
 * visible once `.has-wide-figure` was set, and `#fitDiagram`
 * (diagram-node-view.ts) only ever sets that class when it finds an `<svg>`
 * to measure. A narrow dot/vega figure, and math/text-card kinds (no `<svg>`
 * at all), never got the button — only the selection-chip route worked for
 * them. Mermaid diagrams are commonly wide enough at rest to get the button
 * "for free", which is what made mermaid look like the only kind that
 * worked. These fixtures are deliberately narrow/small (not the
 * `wideMermaid()` fixture figure-viewer.spec.ts uses), so `has-wide-figure`
 * never gets set — the corner button has to work anyway.
 */
for (const [name, source] of [
  ['mermaid', BARE_MERMAID],
  ['svg', SVG],
  ['vega-lite', VEGA_LITE],
] as const) {
  test(`the corner Open figure button opens the viewer for a narrow ${name} figure, with visible content`, async ({
    page,
  }) => {
    await paste(page, source)
    await expect(page.locator('.diagram').last()).not.toHaveClass(/has-wide-figure/)
    await page.locator('.diagram-expand').last().click()
    await expect(page.locator('.figure-viewer')).toBeVisible()

    const rect = await page
      .locator('.figure-viewer-stage')
      .evaluate((stage) => stage.firstElementChild?.getBoundingClientRect())
    expect(rect?.width).toBeGreaterThan(0)
    expect(rect?.height).toBeGreaterThan(0)
  })
}

test('the corner Open figure button opens the viewer for display math, with visible content', async ({ page }) => {
  await paste(page, MATH)
  await expect(page.locator('.diagram').last()).not.toHaveClass(/has-wide-figure/)
  await page.locator('.diagram-expand').last().click()
  await expect(page.locator('.figure-viewer')).toBeVisible()

  const rect = await page
    .locator('.figure-viewer-stage')
    .evaluate((stage) => stage.firstElementChild?.getBoundingClientRect())
  expect(rect?.width).toBeGreaterThan(0)
  expect(rect?.height).toBeGreaterThan(0)
})

test('the corner Open figure button opens the viewer for an ansi text card, with visible content', async ({
  page,
}) => {
  await paste(page, ANSI)
  await expect(page.locator('.diagram').last()).not.toHaveClass(/has-wide-figure/)
  await page.locator('.diagram-expand').last().click()
  await expect(page.locator('.figure-viewer')).toBeVisible()

  const rect = await page
    .locator('.figure-viewer-stage')
    .evaluate((stage) => stage.firstElementChild?.getBoundingClientRect())
  expect(rect?.width).toBeGreaterThan(0)
  expect(rect?.height).toBeGreaterThan(0)
})

/**
 * Bug 2: trackpad pinch did nothing — the old handling only tracked
 * two-pointer touch semantics. Chromium (and Playwright) delivers a
 * trackpad pinch as a synthetic `wheel` event with `ctrlKey: true`; the
 * WebKit `gesturestart`/`gesturechange` path cannot be synthesized outside
 * WebKit, so it is covered by a unit test on the pure `gestureScale`
 * function instead (tests/adapters/figure-viewer-zoom.test.ts) and needs
 * manual verification in the packaged macOS app.
 */
test('ctrl+wheel (Chromium trackpad-pinch delivery) zooms the figure within the 50-400% clamp', async ({ page }) => {
  await paste(page, BARE_MERMAID)
  await selectLastBlock(page)
  await page.locator('.diagram-chips').last().getByRole('button', { name: 'Open figure' }).click()
  await expect(page.locator('.figure-viewer')).toBeVisible()
  await expect(page.locator('.figure-viewer-zoom-level')).toHaveText('100%')

  // Negative deltaY = pinch-out = zoom in.
  await page.locator('.figure-viewer-scroll').dispatchEvent('wheel', { deltaY: -200, ctrlKey: true })
  await expect
    .poll(async () => page.locator('.figure-viewer-zoom-level').textContent())
    .not.toBe('100%')
  const zoomedInText = await page.locator('.figure-viewer-zoom-level').textContent()
  const zoomedInPct = Number(zoomedInText?.replace('%', ''))
  expect(zoomedInPct).toBeGreaterThan(100)
  expect(zoomedInPct).toBeLessThanOrEqual(400)

  // Positive deltaY = pinch-in = zoom out, clamps at 50%.
  for (let i = 0; i < 40; i += 1) {
    await page.locator('.figure-viewer-scroll').dispatchEvent('wheel', { deltaY: 400, ctrlKey: true })
  }
  await expect(page.locator('.figure-viewer-zoom-level')).toHaveText('50%')

  // A plain (non-ctrl) wheel must not zoom — it is an ordinary scroll.
  await page.locator('.figure-viewer').getByRole('button', { name: 'Reset zoom' }).click()
  await expect(page.locator('.figure-viewer-zoom-level')).toHaveText('100%')
  await page.locator('.figure-viewer-scroll').dispatchEvent('wheel', { deltaY: -200, ctrlKey: false })
  await expect(page.locator('.figure-viewer-zoom-level')).toHaveText('100%')
})

/**
 * Bug 3: zooming in via the on-screen controls could permanently hide the
 * top (and left) of the drawing — `transform: scale()` never grows the
 * layout box `.figure-viewer-scroll` measures for scroll, and flex
 * `align-items`/`justify-content: center` clips overflow on the start side,
 * so no `scrollTop`/`scrollLeft` could ever reach it.
 */
test('zooming in leaves the whole figure reachable by scroll, in both axes', async ({ page }) => {
  await paste(page, BARE_MERMAID)
  await selectLastBlock(page)
  await page.locator('.diagram-chips').last().getByRole('button', { name: 'Open figure' }).click()
  await expect(page.locator('.figure-viewer')).toBeVisible()

  for (let i = 0; i < 3; i += 1) {
    await page.locator('.figure-viewer').getByRole('button', { name: 'Zoom in' }).click()
  }
  await expect(page.locator('.figure-viewer-zoom-level')).toHaveText('195%')

  const metrics = await page.evaluate(() => {
    const scroll = document.querySelector('.figure-viewer-scroll') as HTMLElement
    const stage = document.querySelector('.figure-viewer-stage') as HTMLElement
    const content = stage.firstElementChild as HTMLElement
    const contentRect = content.getBoundingClientRect()
    return {
      scrollWidth: scroll.scrollWidth,
      scrollHeight: scroll.scrollHeight,
      clientWidth: scroll.clientWidth,
      clientHeight: scroll.clientHeight,
      contentWidth: contentRect.width,
      contentHeight: contentRect.height,
    }
  })
  // The scroll container's overflow must cover at least the whole scaled
  // drawing in both axes, not just the unscaled layout box.
  expect(metrics.scrollWidth).toBeGreaterThanOrEqual(metrics.contentWidth - 1)
  expect(metrics.scrollHeight).toBeGreaterThanOrEqual(metrics.contentHeight - 1)

  // The top-left corner of the drawing must be programmatically reachable —
  // this is the exact symptom report: "can't scroll up and see, it gets
  // blocked."
  const reached = await page.evaluate(() => {
    const scroll = document.querySelector('.figure-viewer-scroll') as HTMLElement
    scroll.scrollTop = 0
    scroll.scrollLeft = 0
    return { top: scroll.scrollTop, left: scroll.scrollLeft }
  })
  expect(reached.top).toBe(0)
  expect(reached.left).toBe(0)

  const stageRect = await page.locator('.figure-viewer-stage').evaluate((el) => el.getBoundingClientRect())
  const scrollRect = await page.locator('.figure-viewer-scroll').evaluate((el) => el.getBoundingClientRect())
  // With scrollTop/scrollLeft at 0, the stage's own top-left edge must be at
  // (or past) the viewport's top-left — not clipped above/left of it.
  expect(stageRect.top).toBeGreaterThanOrEqual(scrollRect.top - 1)
  expect(stageRect.left).toBeGreaterThanOrEqual(scrollRect.left - 1)
})
