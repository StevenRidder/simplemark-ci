import { expect, test } from '@playwright/test'

const editor = '.milkdown .ProseMirror'

/** Temporary A/B probe for the field report "typing is unusable". */
test('typing latency in a large document', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await page.getByRole('button', { name: 'New note' }).click()

  // A Maxwell-sized document: ~70KB of headed prose.
  const big = Array.from({ length: 220 }, (_, i) =>
    `## Section ${i}\n\nParagraph ${i} carries a long argument about signal firewalls and operating inboxes, repeated to give the block real width and the parser real work to do on every serialize pass.`,
  ).join('\n\n')
  await page.evaluate((markdown) => {
    const s = window.simplemark!.session
    const r = s.applyMarkdown({ actorId: 'agent', name: 'Load fixture', baseVersion: s.snapshot().revision, markdown })
    if (!r.ok) throw new Error('load failed: ' + r.reason)
  }, big)
  await expect(page.locator(`${editor} h2`).first()).toBeVisible()
  const size = await page.evaluate(() => window.simplemark!.session.snapshot().markdown.length)

  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  // Warmup
  await page.keyboard.type('warmup ', { delay: 0 })

  const CHARS = 120
  const text = 'The quick brown fox jumps over the lazy dog and keeps going. '
  const started = Date.now()
  for (let i = 0; i < CHARS; i += 1) {
    await page.keyboard.type(text[i % text.length]!, { delay: 0 })
  }
  const elapsed = Date.now() - started

  // In-page long-task census over the same window is more honest than wall
  // clock (driver round-trips pollute wall time).
  const longTasks = await page.evaluate(async () => {
    return await new Promise<number[]>((resolve) => {
      const seen: number[] = []
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) seen.push(Math.round(entry.duration))
      })
      observer.observe({ entryTypes: ['longtask'] })
      const input = document.querySelector('.milkdown .ProseMirror') as HTMLElement
      const t0 = performance.now()
      let count = 0
      const tick = (): void => {
        if (count >= 60) { observer.disconnect(); resolve(seen); return }
        count += 1
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
        document.execCommand('insertText', false, 'x')
        requestAnimationFrame(tick)
      }
      tick()
      void t0
    })
  }).catch(() => [] as number[])

  console.log(`BENCH doc=${size}B chars=${CHARS} elapsed=${elapsed}ms per-char=${(elapsed / CHARS).toFixed(1)}ms longtasks=${JSON.stringify(longTasks)}`)
})
