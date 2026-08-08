import { expect, test } from '@playwright/test'

/**
 * The "Open figure" full-screen viewer (`openFigureViewer`,
 * src/adapters/editor/figure-viewer.ts — landed in 51adadb). User report from
 * the installed app: it "does work but it's almost like a screencap — I can't
 * scroll down to see the rest or zoom in and out."
 *
 * Root cause: `.figure-viewer-stage svg` forced `width: calc(100vw - 48px)`
 * regardless of the drawing's own size — every figure got squeezed to fit the
 * viewport, like a screenshot — and the overlay was `overflow: hidden` with
 * no zoom affordance for a mouse/keyboard reader (only touch pinch/pan).
 */

const editor = '.milkdown .ProseMirror'
const render = '.diagram-render'

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await expect(page.locator(`${render} svg`).first()).toBeVisible()
})

/** Replaces the first diagram's source, the same helper diagram-frame.spec.ts uses. */
async function setFirstDiagramSource(page: import('@playwright/test').Page, source: string) {
  await page.locator(render).first().click()
  await page.locator('.diagram-chips').first().getByRole('button', { name: 'Edit source' }).click()
  const textarea = page.locator('textarea.diagram-source').first()
  await textarea.fill(source)
  await expect
    .poll(async () => page.locator(`${render} svg`).first().getAttribute('viewBox'))
    .not.toBe(null)
  await page.locator('.diagram-source-close').first().click()
}

/**
 * The exact "chain of stages" shape diagram-frame.spec.ts already relies on
 * to reliably trip `is-wide`/`has-wide-figure` — the expand button ("Open
 * figure") only appears at all once a diagram is this wide.
 */
function wideMermaid(): string {
  return [
    'flowchart LR',
    ...Array.from(
      { length: 12 },
      (_, i) => `  N${i}[Stage number ${i}] --> N${i + 1}[Stage number ${i + 1}]`,
    ),
  ].join('\n')
}

/**
 * A top-to-bottom chain long enough to be tall, whose first node's label is
 * long enough on its own to trip `has-wide-figure` — wide *and* tall at
 * `scale === 1`, so the "scrolls in both axes" assertion needs no zoom to be
 * true, and zooming (a separate test) is not what is proving the height
 * overflow here.
 */
function tallAndWideMermaid(): string {
  const longLabel = 'X'.repeat(140)
  return [
    'flowchart TD',
    `  N0[${longLabel}]`,
    ...Array.from({ length: 19 }, (_, i) => `  N${i} --> N${i + 1}[Stage ${i + 1}]`),
  ].join('\n')
}

async function openViewer(page: import('@playwright/test').Page, source: string = wideMermaid()) {
  await setFirstDiagramSource(page, source)
  // The expand button only shows on a figure too wide for its column.
  await expect(page.locator('.diagram').first()).toHaveClass(/has-wide-figure/)
  await page.locator('.diagram-expand').first().click()
  await expect(page.locator('.figure-viewer')).toBeVisible()
}

test('the viewer scrolls in both axes instead of squeezing the drawing to fit', async ({ page }) => {
  await openViewer(page, tallAndWideMermaid())

  // The drawing itself renders at its natural size, not squeezed to the
  // viewport — the svg's own rendered width must not be clamped to ~viewport
  // width the way `calc(100vw - 48px)` used to force it. This diagram is
  // wide and tall enough, at rest (scale === 1), to overflow both axes.
  const svg = page.locator('.figure-viewer-stage svg')
  const svgWidth = await svg.evaluate((el) => el.getBoundingClientRect().width)
  const viewportWidth = page.viewportSize()!.width
  expect(svgWidth).toBeGreaterThan(viewportWidth)

  const scroll = page.locator('.figure-viewer-scroll')
  const metrics = await scroll.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }))
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth)
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)

  const scrolled = await scroll.evaluate((el) => {
    el.scrollTop = 200
    el.scrollLeft = 150
    return { top: el.scrollTop, left: el.scrollLeft }
  })
  expect(scrolled.top).toBeGreaterThan(0)
  expect(scrolled.left).toBeGreaterThan(0)
})

test('zoom controls grow and reset the drawing, independent of the block zoom', async ({ page }) => {
  await openViewer(page)

  const svg = page.locator('.figure-viewer-stage svg')
  const widthAt = async () => svg.evaluate((el) => el.getBoundingClientRect().width)

  const initial = await widthAt()
  await expect(page.locator('.figure-viewer-zoom-level')).toHaveText('100%')

  await page.getByRole('button', { name: 'Zoom in' }).click()
  const zoomedIn = await widthAt()
  expect(zoomedIn).toBeGreaterThan(initial * 1.2)
  await expect(page.locator('.figure-viewer-zoom-level')).toHaveText('125%')

  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.getByRole('button', { name: 'Zoom out' }).click()
  const zoomedOut = await widthAt()
  expect(zoomedOut).toBeLessThan(initial)

  await page.getByRole('button', { name: 'Reset zoom' }).click()
  const reset = await widthAt()
  expect(Math.abs(reset - initial)).toBeLessThan(2)
  await expect(page.locator('.figure-viewer-zoom-level')).toHaveText('100%')
})

test('viewer zoom controls carry title tooltips matching their aria-labels', async ({ page }) => {
  await openViewer(page)

  for (const name of ['Zoom out', 'Reset zoom', 'Zoom in']) {
    const button = page.getByRole('button', { name })
    await expect(button).toHaveAttribute('title', name)
  }
})

test('Escape still closes the viewer, and scrolling/zooming does not', async ({ page }) => {
  await openViewer(page)

  const scroll = page.locator('.figure-viewer-scroll')
  await scroll.evaluate((el) => {
    el.scrollTop = 100
    el.scrollLeft = 100
  })
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(page.locator('.figure-viewer')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.locator('.figure-viewer')).toBeHidden()
})

test('the Done button still closes the viewer', async ({ page }) => {
  await openViewer(page)
  await page.locator('.figure-viewer-close').click()
  await expect(page.locator('.figure-viewer')).toBeHidden()
})
