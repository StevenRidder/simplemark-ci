import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'

/**
 * The D7 gate, permanent.
 *
 * FIDELITY-1 answered §12's question by measurement; this keeps the answer
 * true. It drives the real editor bridge through `spike/fidelity/harness.ts`,
 * so a change to the parser, the serializer, the plugin set, or the source map
 * that breaks source preservation fails CI rather than being discovered in
 * someone's notes.
 *
 * Recorded baseline at the time of the verdict: Milkdown alone reproduced 1 of
 * 10 fixtures; with the source map, 10 of 10.
 */

const FIXTURE_DIR = new URL('../fixtures/', import.meta.url)

const fixtures = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.md'))
  .sort()

function read(name: string): string {
  return readFileSync(new URL(name, FIXTURE_DIR), 'utf8')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/spike/fidelity/index.html')
  await page.waitForFunction(() => window.fidelity !== undefined)
})

test('the corpus is all ten §12 fixtures', () => {
  expect(fixtures).toHaveLength(10)
})

test.describe('untouched open → save is byte-identical', () => {
  for (const name of fixtures) {
    test(name, async ({ page }) => {
      const input = read(name)
      const output = await page.evaluate(
        (markdown) => window.fidelity!.preservingRoundTrip(markdown, []),
        input,
      )
      expect(output).toBe(input)
    })
  }
})

test.describe('editing one block leaves every other byte identical', () => {
  for (const name of fixtures) {
    test(name, async ({ page }) => {
      const input = read(name)
      const spans = await page.evaluate((markdown) => window.fidelity!.spans(markdown), input)
      expect(spans.length).toBeGreaterThan(1)

      // Every block in turn, not a sample: a tiling bug can hide in one seam.
      for (let index = 0; index < spans.length; index += 1) {
        const span = spans[index]!
        const output = await page.evaluate(
          ([markdown, i]) => window.fidelity!.preservingRoundTrip(markdown as string, [i as number]),
          [input, index] as const,
        )
        expect(output.startsWith(input.slice(0, span.contentStart)), `block ${index} prefix`).toBe(
          true,
        )
        expect(output.endsWith(input.slice(span.separatorEnd)), `block ${index} suffix`).toBe(true)

        // A block must never be emptied. Serialising in isolation used to
        // delete reference-link definitions outright (fixture 06).
        const replaced = output.slice(
          span.contentStart,
          output.length - input.slice(span.separatorEnd).length,
        )
        const original = input.slice(span.contentStart, span.contentEnd)
        if (original.trim() !== '') {
          expect(replaced.trim(), `block ${index} was emptied`).not.toBe('')
        }
      }
    })
  }
})

/**
 * The boundary the spike found, pinned so it cannot be forgotten.
 *
 * remark drops reference-link definitions when serialising, so the serialised
 * document has fewer top-level blocks than the source. Locating an edited block
 * by index is therefore unsound. When this test starts failing because the
 * counts match, the mapping problem has been solved and this test should be
 * replaced by one asserting stable block identity.
 */
test('block indexes do not survive serialisation — the known fallback boundary', async ({
  page,
}) => {
  const input = read('06-reference-links-footnotes.md')

  const sourceBlocks = await page.evaluate((markdown) => window.fidelity!.blockCount(markdown), input)
  const serialised = await page.evaluate(
    (markdown) => window.fidelity!.roundTrip(markdown),
    input,
  )
  const serialisedBlocks = await page.evaluate(
    (markdown) => window.fidelity!.blockCount(markdown),
    serialised,
  )

  expect(sourceBlocks).toBeGreaterThan(serialisedBlocks)
  expect(serialised).not.toContain('[peritext]: https://')
})
