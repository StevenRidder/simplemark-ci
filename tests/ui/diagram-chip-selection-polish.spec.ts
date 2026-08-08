import { expect, test } from '@playwright/test'

/**
 * Three defects reported from the installed app's diagram chrome, all
 * screenshot-only symptoms that only a browser can prove:
 *
 * 1. Selecting a diagram painted a native blue text-selection wash across the
 *    whole figure — render, labels, chips, all of it. `prosemirror-view`'s
 *    own stylesheet (`.ProseMirror-hideselection *::selection { background:
 *    transparent }`) was never imported, so nothing neutralized the real DOM
 *    Range a NodeSelection leaves spanning the node.
 * 2. Chips had `aria-label`s but no `title` tooltips.
 * 3. `.diagram-expand` ("Open figure") and `.diagram-chips` both anchor
 *    top-right and can overlap on a selected, too-wide figure.
 */

const editor = '.milkdown .ProseMirror'
const render = '.diagram-render'

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await expect(page.locator(`${render} svg`).first()).toBeVisible()
})

async function selectFirstDiagram(page: import('@playwright/test').Page) {
  await page.locator(render).first().click()
  await expect(page.locator('.diagram').first()).toHaveClass(/is-selected/)
  await expect(page.locator('.diagram-chips').first()).toBeVisible()
}

/**
 * `getComputedStyle(el, '::selection')` only reports a real value once an
 * author rule targets the pseudo-element — with none present it reports the
 * same "transparent" regardless of whether the browser is about to paint its
 * native (non-transparent) highlight, so it can't distinguish "no rule" from
 * "rule says transparent". The mechanism itself — `user-select: none` on the
 * figure's UI chrome, and a stylesheet rule neutralizing `::selection` under
 * a selected figure — is what's actually checkable and is what the fix is
 * specified to be (see diagram-node-view.ts / app.css comments).
 */
async function hasSelectionNeutralizingRule(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      } catch {
        continue
      }
      for (const rule of Array.from(rules)) {
        const text = rule.cssText
        if (text.includes('::selection') && text.includes('is-selected') && text.includes('transparent')) {
          return true
        }
      }
    }
    return false
  })
}

test('a selected diagram shows only the accent outline, not a selection wash', async ({ page }) => {
  await selectFirstDiagram(page)

  const chrome = await page.evaluate((renderSelector) => {
    const figure = document.querySelector('.diagram') as HTMLElement
    const pick = (sel: string) => figure.querySelector(sel) as HTMLElement | null
    const userSelectOf = (el: HTMLElement | null) => (el === null ? null : window.getComputedStyle(el).userSelect)
    return {
      label: userSelectOf(pick('.diagram-label')),
      chips: userSelectOf(pick('.diagram-chips')),
      expand: userSelectOf(pick('.diagram-expand')),
      grip: userSelectOf(pick('.diagram-resize-grip')),
      render: userSelectOf(pick(renderSelector)),
    }
  }, render)

  // UI chrome is never copy-text.
  expect(chrome.label).toBe('none')
  expect(chrome.chips).toBe('none')
  expect(chrome.expand).toBe('none')
  expect(chrome.grip).toBe('none')
  // The rendered diagram itself is not blanket user-select:none — copyability
  // is preserved when the block is not node-selected.
  expect(chrome.render).not.toBe('none')

  expect(await hasSelectionNeutralizingRule(page)).toBe(true)

  await expect(page.locator('.diagram').first()).toHaveCSS('outline-style', 'solid')
})

test('prose selection outside a diagram is unaffected', async ({ page }) => {
  const paragraph = page.locator(`${editor} p`).first()
  await paragraph.click({ clickCount: 3 })

  const state = await page.evaluate(() => {
    const p = document.querySelector('.milkdown .ProseMirror p') as HTMLElement
    return {
      // The diagram fix scopes selection-neutralizing to the figure's own
      // subtree — prose paragraphs must never pick up `user-select: none` or
      // a forced-transparent `::selection` as collateral damage.
      userSelect: window.getComputedStyle(p).userSelect,
      selectedText: window.getSelection()?.toString() ?? '',
    }
  })

  expect(state.userSelect).not.toBe('none')
  expect(state.selectedText.length).toBeGreaterThan(0)
})

test('every diagram chrome control has a title tooltip', async ({ page }) => {
  await selectFirstDiagram(page)

  const controls = page.locator(
    '.diagram-chip, .diagram-expand, .diagram-resize-grip',
  )
  const count = await controls.count()
  expect(count).toBeGreaterThan(0)

  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i)
    const ariaLabel = await control.getAttribute('aria-label')
    const title = await control.getAttribute('title')
    expect(title).not.toBeNull()
    expect(title).not.toBe('')
    // The resize grip is the one control whose spec'd title text
    // ("Drag to resize") intentionally differs from its aria-label
    // ("Resize chart") — everything else mirrors its aria-label verbatim.
    const isGrip = await control.evaluate((el) => el.classList.contains('diagram-resize-grip'))
    if (ariaLabel !== null && !isGrip) {
      expect(title).toBe(ariaLabel)
    }
  }
})

test('a selected too-wide figure keeps Open figure reachable without overlapping the chips', async ({ page }) => {
  await page.locator(render).first().click()
  await page.locator('.diagram-chips').first().getByRole('button', { name: 'Edit source' }).click()
  const chain = [
    'flowchart LR',
    ...Array.from(
      { length: 12 },
      (_, i) => `  N${i}[Stage number ${i}] --> N${i + 1}[Stage number ${i + 1}]`,
    ),
  ].join('\n')
  const textarea = page.locator('textarea.diagram-source').first()
  await textarea.fill(chain)
  await expect
    .poll(async () => page.locator(`${render} svg`).first().getAttribute('viewBox'))
    .not.toBe(null)
  await page.locator('.diagram-source-close').first().click()

  await expect(page.locator('.diagram').first()).toHaveClass(/has-wide-figure/)

  // Unselected: `.diagram-expand` is the reachable "Open figure" affordance.
  await expect(page.locator('.diagram-expand').first()).toBeVisible()

  await selectFirstDiagram(page)

  // Selected: `.diagram-expand` steps aside for the chip toolbar rather than
  // overlap it in the same top-right corner...
  await expect(page.locator('.diagram-expand').first()).toBeHidden()
  // ...and the action stays reachable as a chip in that same toolbar.
  await expect(
    page.locator('.diagram-chips').first().getByRole('button', { name: 'Open figure' }),
  ).toBeVisible()
})
