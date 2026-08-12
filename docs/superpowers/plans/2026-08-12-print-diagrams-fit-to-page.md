# Print Diagrams Fit to Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make File → Print / Save as PDF show full Mermaid (and other SVG) diagrams scaled to page width, with no Open figure chrome on paper.

**Architecture:** Print remains an OS service defined entirely by `@media print` in `src/app/styles/print.css` (APP-21). On-screen wide-scroll (`.diagram-render.is-wide`) stays; paper unwraps overflow/mask and forces SVG `max-width: 100%` at a specificity that beats the screen `.is-wide` rule. No `beforeprint` DOM mutation and no raster swap.

**Tech Stack:** Hand-authored CSS (`print.css`), Playwright UI tests (`emulateMedia({ media: 'print' })`), Mermaid via existing diagram node view.

## Global Constraints

- Touch only `src/app/styles/print.css` and `tests/ui/print.spec.ts` unless a test helper must be duplicated locally in the spec (prefer local helpers, do not refactor other suites).
- Do not change on-screen diagram layout, `#WIDEST_SQUEEZE`, figure-viewer “Print figure”, or Mermaid renderer theme/security settings.
- Print rules must load after `app.css` (already true) and must beat `.diagram-render.is-wide svg { width: auto; max-width: none }` — that selector is specificity `(0, 3, 0)`; today’s print rule `.diagram-render svg` is only `(0, 2, 0)` and loses.
- In a worktree, set `SIMPLEMARK_TEST_PORT` to something other than 5273 before `npm run test:ui`.
- Never open the real macOS print panel in tests; assert computed styles under `emulateMedia({ media: 'print' })` only.

**Spec:** `docs/superpowers/specs/2026-08-12-print-diagrams-fit-to-page-design.md`

---

### Task 1: Failing Playwright coverage for print diagram fit

**Files:**
- Modify: `tests/ui/print.spec.ts`

**Interfaces:**
- Consumes: existing `/?fixture=legacy` boot path and diagram node DOM (`.diagram`, `.diagram-expand`, `.diagram-render`, `.diagram-render svg`)
- Produces: one new test that fails on current `print.css` for expand visibility and/or wide SVG `max-width`

- [ ] **Step 1: Add helpers and the failing test to `tests/ui/print.spec.ts`**

Keep the existing `beforeEach` (print stub + `/?fixture=legacy`). Append:

```ts
const render = '.diagram-render'

/** Same shape figure-viewer.spec.ts uses to trip `.is-wide`. */
function wideMermaid(): string {
  return [
    'flowchart LR',
    ...Array.from(
      { length: 12 },
      (_, i) => `  N${i}[Stage number ${i}] --> N${i + 1}[Stage number ${i + 1}]`,
    ),
  ].join('\n')
}

async function setFirstDiagramSource(
  page: import('@playwright/test').Page,
  source: string,
): Promise<void> {
  await page.locator(render).first().click()
  await page.locator('.diagram-chips').first().getByRole('button', { name: 'Edit source' }).click()
  const textarea = page.locator('textarea.diagram-source').first()
  await textarea.fill(source)
  await expect
    .poll(async () => page.locator(`${render} svg`).first().getAttribute('viewBox'))
    .not.toBe(null)
  await page.locator('.diagram-source-close').first().click()
}

test('wide diagrams fit the sheet and drop Open figure chrome on paper', async ({ page }) => {
  await setFirstDiagramSource(page, wideMermaid())
  const figure = page.locator('.diagram').first()
  const wideRender = figure.locator('.diagram-render')
  await expect(wideRender).toHaveClass(/is-wide/, { timeout: 20_000 })
  await expect(figure.locator('.diagram-expand')).toBeVisible()

  await page.emulateMedia({ media: 'print' })

  await expect(figure.locator('.diagram-expand'), 'Open figure must not reach paper').toBeHidden()
  await expect(figure.locator('.diagram-resize-grip')).toBeHidden()

  const paper = await wideRender.evaluate((element) => {
    const style = getComputedStyle(element)
    const svg = element.querySelector('svg')
    const svgStyle = svg ? getComputedStyle(svg) : null
    return {
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      maskImage: style.maskImage || style.webkitMaskImage,
      svgMaxWidth: svgStyle?.maxWidth ?? '',
      svgWidth: svgStyle?.width ?? '',
      printColorAdjust: style.printColorAdjust || style.webkitPrintColorAdjust,
    }
  })

  expect(paper.overflowX, 'wide render must not keep a horizontal clip on paper').toBe('visible')
  expect(paper.overflowY).toBe('visible')
  expect(paper.maskImage === 'none' || paper.maskImage === '', `mask must clear on paper, got ${paper.maskImage}`).toBe(true)
  expect(paper.svgMaxWidth).toBe('100%')
  // Fit-to-page: not the screen is-wide `width: auto` path.
  expect(paper.svgWidth).not.toBe('auto')
  expect(paper.printColorAdjust).toBe('exact')
})
```

- [ ] **Step 2: Run the new test and confirm it fails for the right reason**

Run:

```bash
npx playwright test tests/ui/print.spec.ts -g "wide diagrams fit"
```

Expected: FAIL. Likely failures before the CSS fix:
- `.diagram-expand` still visible (`toBeHidden` fails), and/or
- `svgMaxWidth` is `none` (screen `.is-wide` beats print), and/or
- `overflowX` is `auto`.

Do not “fix” by changing the test to match today’s broken print.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/ui/print.spec.ts
git commit -m "$(cat <<'EOF'
test: cover print fit-to-page for wide diagrams

EOF
)"
```

---

### Task 2: Print CSS — hide chrome, unwrap wide figures, fit SVGs

**Files:**
- Modify: `src/app/styles/print.css` (chrome list ~106–113; diagram SVG block ~210–216; add a new diagram-print block after that)

**Interfaces:**
- Consumes: screen classes `.diagram`, `.diagram-expand`, `.diagram-resize-grip`, `.diagram-render`, `.diagram-render.is-wide`, `.diagram-render svg`
- Produces: print cascade that matches Task 1 assertions

- [ ] **Step 1: Extend the reader-chrome hide list**

In the existing block that already hides `.diagram-chips` / `.diagram-label`, add the corner affordance and resize grip:

```css
  .milkdown .ProseMirror > *::after,
  .milkdown .ProseMirror .sm-fold-chevron,
  .diagram-label,
  .diagram-source-sheet,
  .diagram-error-actions,
  .diagram-chips,
  .diagram-expand,
  .diagram-resize-grip {
    display: none;
  }
```

Update the comment above that block so it names Open figure / resize as paper-excluded reader chrome, not only “hover label and source editor”.

- [ ] **Step 2: Add the fit-to-page diagram rules**

Replace the existing “Nothing may exceed the sheet” SVG snippet with a fuller diagram block (keep the `img` / generic `svg` lines; strengthen diagram-specific rules):

```css
  /* Nothing may exceed the sheet. */
  .milkdown .ProseMirror img,
  .milkdown .ProseMirror svg,
  .diagram-render svg {
    max-width: 100%;
    height: auto;
  }

  /*
   * Wide figures scroll on screen (`.diagram-render.is-wide` + fade mask).
   * Paper has no scrollport: unwrap the clip, drop the mask, and shrink the
   * SVG to the sheet. The `.is-wide svg` selectors are load-bearing — screen
   * sets `width: auto; max-width: none` at higher specificity than
   * `.diagram-render svg`, and without matching specificity print loses.
   */
  .diagram,
  .diagram-render,
  .diagram-render.is-wide {
    overflow: visible;
  }

  .diagram-render.is-wide {
    -webkit-mask-image: none;
    mask-image: none;
  }

  .diagram-render svg,
  .diagram-render.is-wide svg {
    width: 100%;
    max-width: 100%;
    height: auto;
  }

  .diagram-render {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
```

Also add `.diagram` to the big unwrap list only if you prefer one place for overflow — either is fine as long as `.diagram { overflow: hidden }` from `app.css` does not survive on paper. The dedicated `.diagram, .diagram-render, .diagram-render.is-wide { overflow: visible; }` block above is enough.

- [ ] **Step 3: Re-run the focused print tests**

Run:

```bash
npx playwright test tests/ui/print.spec.ts
```

Expected: all tests in the file PASS, including `wide diagrams fit the sheet and drop Open figure chrome on paper`.

- [ ] **Step 4: Manual smoke (optional but recommended before PR)**

In the packaged or `npm run dev` app, open a note with a wide Mermaid gantt (e.g. Total Summary), File → Print → PDF. Confirm the full chart is on the page and **Open figure** is absent.

- [ ] **Step 5: Commit the CSS fix**

```bash
git add src/app/styles/print.css tests/ui/print.spec.ts
git commit -m "$(cat <<'EOF'
fix: fit wide diagrams to the printed page

Hide Open figure chrome on paper and shrink is-wide SVGs to sheet width
so Mermaid gantts survive Save as PDF.

EOF
)"
```

---

## Spec coverage check

| Spec ruling | Task |
| --- | --- |
| Hide `.diagram-expand` / `.diagram-resize-grip` on paper | Task 2 Step 1 (+ Task 1 asserts) |
| Unwrap overflow + clear `.is-wide` mask | Task 2 Step 2 (+ Task 1 asserts) |
| Fit SVG to 100% including `.is-wide` | Task 2 Step 2 (+ Task 1 asserts) |
| `print-color-adjust: exact` | Task 2 Step 2 (+ Task 1 asserts) |
| No beforeprint / raster / figure-viewer changes | Global constraints |
| Playwright print media coverage | Task 1 |

## Placeholder / consistency self-review

- No TBD/TODO left in steps.
- Specificity bug called out explicitly so implementers do not “add max-width: 100%” only on `.diagram-render svg` and ship a still-broken print.
- Test helpers are inlined in `print.spec.ts` (same pattern as `figure-viewer.spec.ts`) — no cross-file refactor required.
