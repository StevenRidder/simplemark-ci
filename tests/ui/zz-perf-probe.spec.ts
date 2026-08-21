import { expect, test } from '@playwright/test'
const editor = '.milkdown .ProseMirror'

test('probe: scroll cost and figure rendering', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await page.waitForTimeout(3000)

  const r = await page.evaluate(async () => {
    const ed = document.querySelector('.editor') as HTMLElement
    const frames: number[] = []
    let last = performance.now()
    let raf = requestAnimationFrame(function tick() {
      const now = performance.now(); frames.push(now - last); last = now
      raf = requestAnimationFrame(tick)
    })
    const step = Math.max(150, Math.floor(ed.scrollHeight / 30))
    const passes: Array<{ rendered: number; placeholders: number }> = []
    for (let round = 0; round < 2; round += 1) {
      for (let y = 0; y < ed.scrollHeight; y += step) {
        ed.scrollTop = y
        await new Promise(r => requestAnimationFrame(() => r(null)))
      }
      for (let y = ed.scrollHeight; y > 0; y -= step) {
        ed.scrollTop = y
        await new Promise(r => requestAnimationFrame(() => r(null)))
      }
      passes.push({
        rendered: document.querySelectorAll('.diagram-render svg, .diagram-render canvas, .diagram-render img').length,
        placeholders: document.querySelectorAll('.diagram-placeholder, .diagram-render:empty').length,
      })
    }
    cancelAnimationFrame(raf)
    frames.sort((a, b) => a - b)
    const at = (p: number) => Math.round(((frames[Math.floor(frames.length * p)] ?? 0)) * 10) / 10
    return {
      frames: frames.length, median: at(0.5), p95: at(0.95),
      worst: Math.round((frames[frames.length - 1] ?? 0) * 10) / 10,
      over32: frames.filter(f => f > 32).length,
      over100: frames.filter(f => f > 100).length,
      scrollHeight: ed.scrollHeight,
      figures: document.querySelectorAll('.diagram-render').length,
      passes,
    }
  })
  console.log('RESULT ' + JSON.stringify(r))
})
