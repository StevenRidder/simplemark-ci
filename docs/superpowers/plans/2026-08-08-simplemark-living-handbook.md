# SimpleMark Living Handbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Welcome to SimpleMark and Project Tanoa: Storm Atlas as the same two rich, session-local default sample documents in the web and native shells.

**Architecture:** The two ordinary files in `docs/showcase/` remain the only authored Markdown. A small `src/app/sample-documents.ts` catalogue imports those sources with Vite's `?raw` loader and supplies immutable metadata to both composition roots; each shell continues to use its existing `FixtureFilePort` for temporary sample edits and its existing real file port after the user opens a file. No parser, persistence rule, renderer, or user-directory write is added.

**Tech Stack:** TypeScript 5.9, Vitest, Playwright, Milkdown/ProseMirror, Mermaid 11, sanitised SVG, Graphviz WASM, KaTeX, Vega-Lite 6, Tauri 2, ordinary Markdown.

## Global Constraints

- Follow `docs/PRODUCT.md`: the rendered document is the default surface and editing is contextual.
- Canonical sample sources are exactly `docs/showcase/welcome-to-simplemark.md` and `docs/showcase/project-tanoa-storm-atlas.md`.
- Import canonical Markdown as raw build input; never duplicate a document in a TypeScript template literal.
- Show exactly two public samples, with Welcome to SimpleMark first and Project Tanoa second.
- Label the list `Samples` and state that changes reset on restart.
- Never copy a sample into Documents, app data, or another user-owned directory without an explicit later save action.
- Add no dependencies and no new renderer behavior.
- Include only renderers wired into both current compositions; exclude Markmap.
- Use inline chart data and self-contained visuals; sample rendering must require no network or sidecar file.
- Preserve Project Tanoa's approved source and 22-second GIF unchanged during handbook work.
- Every task follows red-green TDD and ends with its focused tests passing before commit.

---

## File map

| File | Responsibility |
| --- | --- |
| `docs/showcase/welcome-to-simplemark.md` | Canonical Living Handbook source and every public example. |
| `src/app/sample-documents.ts` | Immutable metadata and raw Markdown imports for the two samples. |
| `src/app/browser.ts` | Browser-only selection, temporary sample ports, and browser workspace actions. |
| `src/app/tauri.ts` | Native-only selection, temporary sample ports, and transition to real files. |
| `src/app/welcome-note.ts` | Remove after both entrypoints consume the shared sample catalogue. |
| `tests/app/simplemark-living-handbook.test.ts` | Source contract, capability truth, guided edit pairs, and local links. |
| `tests/app/sample-documents.test.ts` | Exact catalogue ordering, metadata, and canonical byte identity. |
| `tests/app/native-sample-documents.test.ts` | Native composition uses the shared catalogue and exposes sample selection. |
| `tests/ui/simplemark-living-handbook.spec.ts` | Exact browser rendering, live guided edits, sample switching, and byte-safe save. |
| `tests/ui/sidebar-parity.spec.ts` | Existing browser workspace behavior re-based from three obsolete fixtures to two public samples. |

---

### Task 0: Freeze the already-approved Project Tanoa Storm Atlas cut

**Files:**
- Modify: `package.json`
- Create: `docs/showcase/project-tanoa-storm-atlas.md`
- Create: `docs/assets/project-tanoa-storm-atlas.gif`
- Create: `scripts/record-tanoa-storm-atlas.mjs`
- Create: `tests/app/project-tanoa-storm-atlas-recorder.test.ts`

**Interfaces:**
- Consumes: the user-approved 22-second cut already present in this worktree.
- Produces: a committed canonical Project Tanoa source and immutable GIF baseline for every later task.

This work completed its red-green cycle before this plan: the recorder contract failed against the
old 17-second behavior, then passed after the Mermaid and Vega edits were added. Do not rewrite the
approved cut; rerun its proof freshly and commit it as the prerequisite.

- [ ] **Step 1: Re-run the approved recorder contract and content check**

Run:

```bash
npm test -- --run tests/app/project-tanoa-storm-atlas-recorder.test.ts
node --check scripts/record-tanoa-storm-atlas.mjs
node scripts/record-tanoa-storm-atlas.mjs --verify-content
```

Expected content receipt:

```text
opening: storm map
mermaid: battery branch → deferred before shelter
vega: reserve floor 35% → 42%
final: island mode holding
duration: 22 seconds
```

- [ ] **Step 2: Verify the exact public GIF**

Run:

```bash
ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=width,height,r_frame_rate,nb_read_frames:format=duration,size -of default=noprint_wrappers=1 docs/assets/project-tanoa-storm-atlas.gif
strings docs/assets/project-tanoa-storm-atlas.gif | rg NETSCAPE2.0
shasum -a 256 .artifacts/tanoa-storm-atlas/project-tanoa-storm-atlas.gif docs/assets/project-tanoa-storm-atlas.gif
```

Expected: 1000×625, 6 fps, 132 frames, exactly 22 seconds, under 5 MiB, looping, and identical
candidate/public SHA-256 values.

- [ ] **Step 3: Confirm the approved change is isolated and commit it**

Run:

```bash
git diff --check
git status --short
```

Then commit exactly the five approved paths:

```bash
git add package.json docs/showcase/project-tanoa-storm-atlas.md docs/assets/project-tanoa-storm-atlas.gif scripts/record-tanoa-storm-atlas.mjs tests/app/project-tanoa-storm-atlas-recorder.test.ts
git commit -m "docs: add the Project Tanoa Storm Atlas showcase"
```

---

### Task 1: Author the canonical Living Handbook under an executable source contract

**Files:**
- Create: `docs/showcase/welcome-to-simplemark.md`
- Create: `tests/app/simplemark-living-handbook.test.ts`

**Interfaces:**
- Consumes: the shipped fence names `mermaid`, `svg`, `dot`, `vega-lite`, `ansi`, `diff`, `json`, `tree`, and `stacktrace`; portable display math uses `$$`.
- Produces: `docs/showcase/welcome-to-simplemark.md` plus the unique guided-edit tokens consumed by Task 3's browser test.

- [ ] **Step 1: Write the failing source-contract test**

Create `tests/app/simplemark-living-handbook.test.ts` with the following contract:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PATH = resolve('docs/showcase/welcome-to-simplemark.md')
const read = (): string => readFileSync(PATH, 'utf8')

describe('SimpleMark Living Handbook', () => {
  it('exists as the six-chapter guided tour', () => {
    expect(existsSync(PATH)).toBe(true)
    if (!existsSync(PATH)) return
    const source = read()
    for (const heading of [
      'Start here',
      'Make ordinary Markdown beautiful',
      'Paste technical material like magic',
      'Change the picture by changing the source',
      'Understand the trust model',
      'Keep this page nearby',
    ]) expect(source).toContain(`## ${heading}`)
    expect(source).toContain('# Welcome to SimpleMark')
    expect(source).toContain('*This document is the demo.*')
  })

  it('contains every shipped technical form and no roadmap renderer', () => {
    const source = read()
    for (const language of [
      'mermaid', 'svg', 'dot', 'ansi', 'diff', 'json', 'tree', 'stacktrace',
    ]) expect(source).toContain(`\`\`\`${language}\n`)
    expect(source.match(/```vega-lite\n/gu)).toHaveLength(2)
    expect(source).toContain('\n$$\n')
    expect(source).toContain('```typescript\n')
    expect(source).toContain('\u001b[32m')
    expect(source).toContain('\u001b[0m')
    expect(source).not.toMatch(/markmap/iu)
  })

  it('uses rich document forms as instructions rather than a syntax dump', () => {
    const source = read()
    for (const token of [
      '> [!IMPORTANT]', '> [!TIP]', '> [!NOTE]', '- [x]', '- [ ]',
      '<u>', '[[Project Tanoa]]', '[^portable]', '| Capability |',
    ]) expect(source).toContain(token)
  })

  it('pins four unique valid guided-edit pairs', () => {
    const source = read()
    for (const [before, after] of [
      ['JUDGE["Read & judge"]', 'JUDGE["Read, judge & decide"]'],
      ['"category":"Evidence","value":18', '"category":"Evidence","value":24'],
      ['fill="#ff7a66"', 'fill="#5c7cfa"'],
      ['\\boxed{3}', '\\boxed{4}'],
    ] as const) {
      expect(source.split(before)).toHaveLength(2)
      expect(source).toContain(after)
    }
  })

  it('keeps every local link portable', () => {
    const links = [...read().matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
      .map((match) => match[1] ?? '')
      .filter((link) => !link.startsWith('#') && !/^[a-z]+:/iu.test(link))
    expect(links).toContain('project-tanoa-storm-atlas.md')
    for (const link of links) {
      expect(existsSync(resolve(dirname(PATH), link.split('#')[0] ?? '')), link).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run the contract to verify RED**

Run:

```bash
npm test -- --run tests/app/simplemark-living-handbook.test.ts
```

Expected: FAIL because `docs/showcase/welcome-to-simplemark.md` does not exist.

- [ ] **Step 3: Write the complete handbook**

Create `docs/showcase/welcome-to-simplemark.md` in this exact story order:

```markdown
# Welcome to SimpleMark
*This document is the demo.*

> [!IMPORTANT]
> Open ordinary Markdown, read the rendered page, and reveal source only for the block you need.

## Start here
## Make ordinary Markdown beautiful
## Paste technical material like magic
## Change the picture by changing the source
## Understand the trust model
## Keep this page nearby
```

Within that structure, use these exact visual payloads and labels:

| Visual | Required source and purpose |
| --- | --- |
| SVG hero | `viewBox="0 0 920 360"`; warm-paper background; source card → arrow → rendered card; the editable coral accent occurs once as `fill="#ff7a66"`; include the valid replacement `fill="#5c7cfa"` in the adjacent Try it callout. |
| Mermaid journey | `flowchart LR`; `AI["AI writes"] --> FILE["ordinary .md"] --> RENDER["SimpleMark renders"] --> JUDGE["Read & judge"]`; dotted correction edge back to `FILE`; adjacent callout names the exact replacement `JUDGE["Read, judge & decide"]`. |
| Anatomy chart | Vega-Lite v6 arc chart titled `A strong AI document has more than words`; inline rows Prose 34, Decisions 18, Data 16, Diagrams 14, Evidence 18; the Evidence row is minified exactly as `"category":"Evidence","value":18`; adjacent callout gives the valid replacement value 24. |
| Recognition heatmap | Vega-Lite v6 rect/text layered chart; inline rows map Markdown→Document, Mermaid/SVG/DOT→Diagram, Vega-Lite→Chart, LaTeX→Math, JSON/diff/ANSI/tree/stack trace→Technical card, TSV→Table; no remote URL. |
| Graphviz path | `digraph SimpleMarkPaste`; left-to-right nodes Paste → Recognise → Validate → Store portable source → Render; a failure edge ends at Visible message. |
| KaTeX | One inline example and one display block containing `\boxed{3}` exactly once; the adjacent Try it callout supplies `\boxed{4}`. |
| Evidence wall | One highlighted `typescript` fence, plus one each of `ansi`, `diff`, `json`, `tree`, and `stacktrace`; content explains one fictional sample build and is visibly labelled illustrative. The ANSI block contains actual U+001B SGR bytes for green success and reset (`ESC[32m` and `ESC[0m`), not the printable characters `\\u001b`. |

Use a short capability table, a paste-recognition table, and an app table with columns
`Capability | Web | macOS | What remains portable`. Say that desktop external-file refresh does not
identify the writer or merge concurrent edits. Label all sample metrics illustrative. Link to
`project-tanoa-storm-atlas.md` and define `[^portable]`. Do not describe collaboration, hosted
persistence, signing/notarization, Markmap, automatic merge, or universal attribution as shipped.

The app table uses these current, bounded claims:

| Capability | Web | macOS | Portable result |
| --- | --- | --- | --- |
| Open a local `.md` | browser file picker | native picker or file association | the same Markdown file |
| Save | in place where the browser retains a file handle; otherwise a downloaded replacement | atomic in-place save | ordinary Markdown |
| Default samples | session-local; reset on restart | session-local; reset on restart | canonical samples remain `.md` |
| Reader appearance, zoom, find, contents, and statistics | available | available | presentation state never enters Markdown |
| Print or PDF | browser print panel | native print panel | platform print/PDF output |
| Recent notes and adopted folders | sample-session catalogue only | persistent local recent/folder catalogue | files stay in their original folders |
| Refresh after an external file write | unavailable as a desktop-style watcher | native filesystem watcher | the external bytes remain the source |

Do not shorten the browser save row to a universal “in-place save” claim and do not describe the
native watcher as attribution or merge.

- [ ] **Step 4: Run the focused contract to verify GREEN**

Run:

```bash
npm test -- --run tests/app/simplemark-living-handbook.test.ts
```

Expected: 1 file passed, 5 tests passed.

- [ ] **Step 5: Check Markdown hygiene and commit**

Run:

```bash
git diff --check
```

Then commit only the handbook and its contract:

```bash
git add docs/showcase/welcome-to-simplemark.md tests/app/simplemark-living-handbook.test.ts
git commit -m "docs: add the SimpleMark Living Handbook"
```

---

### Task 2: Create one exact shared sample catalogue

**Files:**
- Create: `src/app/sample-documents.ts`
- Create: `tests/app/sample-documents.test.ts`
- Delete: `src/app/welcome-note.ts` only after Tasks 3 and 4 remove its imports

**Interfaces:**
- Consumes: the two canonical Markdown files from Task 1 and the approved Project Tanoa source.
- Produces: `SampleDocument`, `SAMPLE_DOCUMENTS`, `WELCOME_SAMPLE`, and `sampleDocument(id)`.

- [ ] **Step 1: Write the failing catalogue test**

Create `tests/app/sample-documents.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  SAMPLE_DOCUMENTS,
  WELCOME_SAMPLE,
  sampleDocument,
} from '../../src/app/sample-documents.js'

describe('default sample documents', () => {
  it('publishes exactly the approved pair in landing order', () => {
    expect(SAMPLE_DOCUMENTS.map(({ id, name, title }) => ({ id, name, title }))).toEqual([
      {
        id: 'welcome-to-simplemark',
        name: 'welcome-to-simplemark.md',
        title: 'Welcome to SimpleMark',
      },
      {
        id: 'project-tanoa-storm-atlas',
        name: 'project-tanoa-storm-atlas.md',
        title: 'Project Tanoa: Storm Atlas',
      },
    ])
    expect(WELCOME_SAMPLE).toBe(SAMPLE_DOCUMENTS[0])
  })

  it('imports the exact canonical bytes rather than a copied template literal', () => {
    for (const sample of SAMPLE_DOCUMENTS) {
      const canonical = readFileSync(resolve('docs/showcase', sample.name), 'utf8')
      expect(sample.markdown).toBe(canonical)
      expect(sample.updatedLabel).toBe('Sample')
    }
  })

  it('looks up only known samples', () => {
    expect(sampleDocument('project-tanoa-storm-atlas')?.title).toBe('Project Tanoa: Storm Atlas')
    expect(sampleDocument('missing')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
npm test -- --run tests/app/sample-documents.test.ts
```

Expected: FAIL because `src/app/sample-documents.ts` does not exist.

- [ ] **Step 3: Implement the minimal catalogue**

Create `src/app/sample-documents.ts`:

```ts
import projectTanoaMarkdown from '../../docs/showcase/project-tanoa-storm-atlas.md?raw'
import welcomeMarkdown from '../../docs/showcase/welcome-to-simplemark.md?raw'

export interface SampleDocument {
  readonly id: string
  readonly name: string
  readonly title: string
  readonly preview: string
  readonly markdown: string
  readonly updatedLabel: 'Sample'
  readonly modifiedHoursAgo: number
  readonly createdHoursAgo: number
  readonly pinned: boolean
}

export const SAMPLE_DOCUMENTS: readonly SampleDocument[] = [
  {
    id: 'welcome-to-simplemark',
    name: 'welcome-to-simplemark.md',
    title: 'Welcome to SimpleMark',
    preview: 'A ten-minute tour of every living-document capability.',
    markdown: welcomeMarkdown,
    updatedLabel: 'Sample',
    modifiedHoursAgo: 0,
    createdHoursAgo: 52,
    pinned: true,
  },
  {
    id: 'project-tanoa-storm-atlas',
    name: 'project-tanoa-storm-atlas.md',
    title: 'Project Tanoa: Storm Atlas',
    preview: 'A community microgrid enters island mode before the storm.',
    markdown: projectTanoaMarkdown,
    updatedLabel: 'Sample',
    modifiedHoursAgo: 3,
    createdHoursAgo: 6,
    pinned: false,
  },
]

export const WELCOME_SAMPLE = SAMPLE_DOCUMENTS[0]!

export function sampleDocument(id: string): SampleDocument | undefined {
  return SAMPLE_DOCUMENTS.find((sample) => sample.id === id)
}
```

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
npm test -- --run tests/app/sample-documents.test.ts tests/app/simplemark-living-handbook.test.ts
npm run typecheck
```

Expected: both files pass and TypeScript accepts Vite's `?raw` imports.

- [ ] **Step 5: Commit the catalogue without deleting the old welcome module yet**

```bash
git add src/app/sample-documents.ts tests/app/sample-documents.test.ts
git commit -m "feat: define the shared default samples"
```

---

### Task 3: Make the browser open and prove the two real samples

**Files:**
- Modify: `src/app/browser.ts:40-180`
- Create: `tests/ui/simplemark-living-handbook.spec.ts`
- Modify: `tests/ui/sidebar-parity.spec.ts`

**Interfaces:**
- Consumes: `SampleDocument` and `SAMPLE_DOCUMENTS` from Task 2.
- Produces: the browser Samples catalogue, temporary per-sample `FixtureFilePort`s, and end-to-end proof of every handbook renderer and guided edit.

- [ ] **Step 1: Rebase the browser expectations onto the approved samples**

Before implementation, change `tests/ui/sidebar-parity.spec.ts` to expect these default identities:

```ts
const WELCOME = 'welcome-to-simplemark'
const TANOA = 'project-tanoa-storm-atlas'
```

Apply this exact expectation map throughout the existing tests:

| Old fixture expectation | New sample expectation |
| --- | --- |
| three initial notes | two initial notes |
| architecture heading | Welcome to SimpleMark heading |
| field-notes / Field notes | project-tanoa-storm-atlas / Holding the island through the storm |
| ideas search for `portable` | Project Tanoa search for `Fulaga` |
| new-note-4 then new-note-5 | new-note-3 then new-note-4 |
| Recent Notes 3 | Recent Notes 2 |
| creation order field-notes, ideas, architecture | project-tanoa-storm-atlas, welcome-to-simplemark |
| modification order architecture, field-notes, ideas | welcome-to-simplemark, project-tanoa-storm-atlas |

Keep the existing pin, search, sort, density, close, history, keyboard, and New Note behaviors; change
only their seed names/counts. The welcome sample remains initially pinned, so it still leads default
and newly-created notes.

- [ ] **Step 2: Write the failing handbook UI test**

Create `tests/ui/simplemark-living-handbook.spec.ts` with these checks:

```ts
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const WELCOME_SOURCE = readFileSync(
  new URL('../../docs/showcase/welcome-to-simplemark.md', import.meta.url),
  'utf8',
)
const TANOA_SOURCE = readFileSync(
  new URL('../../docs/showcase/project-tanoa-storm-atlas.md', import.meta.url),
  'utf8',
)

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
})

test('the default Samples catalogue opens both canonical documents', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Note list options' })).toContainText('Samples')
  await expect(page.locator('.workspace-notes .note-item')).toHaveCount(2)
  await expect(page.getByRole('heading', { name: 'Welcome to SimpleMark' })).toBeVisible()

  await page.getByRole('button', { name: 'project-tanoa-storm-atlas', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Holding the island through the storm' })).toBeVisible()
})

test('untouched sample saves reload the exact canonical bytes', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.save())
  await page.getByRole('button', { name: 'project-tanoa-storm-atlas', exact: true }).click()
  await page.evaluate(() => window.simplemark!.save())
  await page.getByRole('button', { name: 'welcome-to-simplemark', exact: true }).click()
  expect(await page.evaluate(() => window.simplemark!.session.snapshot().markdown)).toBe(WELCOME_SOURCE)
  await page.getByRole('button', { name: 'project-tanoa-storm-atlas', exact: true }).click()
  expect(await page.evaluate(() => window.simplemark!.session.snapshot().markdown)).toBe(TANOA_SOURCE)
})

test('the handbook renders every promised technical form without a blank', async ({ page }) => {
  await expect(page.locator('.diagram .diagram-render svg')).toHaveCount(5, { timeout: 30_000 })
  await expect(page.locator('.math-block .katex')).toBeVisible()
  for (const selector of ['.ansi-card', '.diff-card', '.json-card', '.tree-card', '.stack-card']) {
    await expect(page.locator(selector)).toBeVisible()
  }
  await expect(page.locator('.diagram-error:visible')).toHaveCount(0)
})

async function replaceSource(
  page: import('@playwright/test').Page,
  block: import('@playwright/test').Locator,
  before: string,
  after: string,
): Promise<void> {
  await block.getByRole('button', { name: 'Edit source' }).click()
  const source = page.locator('.diagram-source-sheet:not([hidden]) .diagram-source')
  await source.fill((await source.inputValue()).replace(before, after))
  await page.getByRole('button', { name: 'Close source editor' }).click()
}

test('the four guided corrections visibly redraw their blocks', async ({ page }) => {
  const mermaid = page.locator('.diagram').filter({ has: page.locator('.diagram-label', { hasText: 'mermaid' }) })
  await replaceSource(page, mermaid, 'Read & judge', 'Read, judge & decide')
  await expect(mermaid.locator('.diagram-render')).toContainText('Read, judge & decide')

  const charts = page.locator('.diagram').filter({ has: page.locator('.diagram-label', { hasText: 'vega-lite' }) })
  const chartBefore = await charts.first().locator('svg').innerHTML()
  await replaceSource(page, charts.first(), '"category":"Evidence","value":18', '"category":"Evidence","value":24')
  await expect.poll(() => charts.first().locator('svg').innerHTML()).not.toBe(chartBefore)

  const svg = page.locator('.diagram').filter({ has: page.locator('.diagram-label', { hasText: 'svg' }) })
  await replaceSource(page, svg, 'fill="#ff7a66"', 'fill="#5c7cfa"')
  await expect(svg.locator('[fill="#5c7cfa"]')).toHaveCount(1)

  const math = page.locator('.math-block').first()
  const mathBefore = await math.locator('.katex').innerHTML()
  await replaceSource(page, math, '\\boxed{3}', '\\boxed{4}')
  await expect.poll(() => math.locator('.katex').innerHTML()).not.toBe(mathBefore)
})
```

- [ ] **Step 3: Run the new and re-based UI tests to verify RED**

Run:

```bash
npx playwright test tests/ui/simplemark-living-handbook.spec.ts tests/ui/sidebar-parity.spec.ts
```

Expected: FAIL because the browser still exposes architecture, field-notes, and ideas.

- [ ] **Step 4: Seed the browser from `SAMPLE_DOCUMENTS`**

In `src/app/browser.ts`:

1. Import `SAMPLE_DOCUMENTS` and `type SampleDocument` from `./sample-documents.js`.
2. Delete `FIXTURE_NAME`, `FIXTURE_MARKDOWN`, and the three literal `DEMO_NOTES` rows.
3. Define mutable browser rows without copying Markdown:

```ts
interface DemoNote extends Omit<SampleDocument, 'pinned'> {
  pinned: boolean
}

const DEMO_NOTES: DemoNote[] = SAMPLE_DOCUMENTS.map((sample) => ({ ...sample }))
```

4. Keep one `FixtureFilePort` per sample so switching away and back preserves temporary edits for the
   current browser session.
5. Change the sample `filePath` copy to
   `Samples · changes reset when SimpleMark restarts · open a file to use your own Markdown`.
6. Set `collectionLabel: 'Samples'` in `workspaceOptions` while leaving the existing browser-only
   pin, sort, search, history, new-note, close, and copy actions intact.
7. Use `note.title`, `note.name`, `note.preview`, and the existing timestamp calculation directly;
   do not derive public titles by stripping filenames.

- [ ] **Step 5: Run browser tests to verify GREEN**

Run:

```bash
npx playwright test tests/ui/simplemark-living-handbook.spec.ts tests/ui/sidebar-parity.spec.ts
npm test -- --run tests/app/simplemark-living-handbook.test.ts tests/app/sample-documents.test.ts
```

Expected: the handbook and workspace suites pass with two default samples.

- [ ] **Step 6: Commit the browser sample experience**

```bash
git add src/app/browser.ts tests/ui/simplemark-living-handbook.spec.ts tests/ui/sidebar-parity.spec.ts
git commit -m "feat: open the showcase pair as browser samples"
```

---

### Task 4: Give the native shell the same selectable sample pair

**Files:**
- Modify: `src/app/tauri.ts:39,179-230,680-706,790-810,870-887,930-950,1157-1193`
- Delete: `src/app/welcome-note.ts`
- Create: `tests/app/native-sample-documents.test.ts`
- Modify: `tests/app/native-new-note.test.ts`

**Interfaces:**
- Consumes: `SAMPLE_DOCUMENTS`, `WELCOME_SAMPLE`, and `sampleDocument(id)` from Task 2.
- Produces: `mountSample(id)`, `selectSample(id)`, and `nativeSampleWorkspace(activeId, actions)` inside the native composition root.

- [ ] **Step 1: Write the failing native-wiring contract**

Create `tests/app/native-sample-documents.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const TAURI = readFileSync('src/app/tauri.ts', 'utf8')

describe('native default samples', () => {
  it('uses the shared sample catalogue instead of copied welcome Markdown', () => {
    expect(TAURI).toContain("from './sample-documents.js'")
    expect(TAURI).toContain('function mountSample(')
    expect(TAURI).toContain('function selectSample(')
    expect(TAURI).toContain('function nativeSampleWorkspace(')
    expect(TAURI).not.toContain('WELCOME_MARKDOWN')
    expect(TAURI).not.toContain('WELCOME_NAME')
  })

  it('labels samples honestly and makes both rows selectable', () => {
    expect(TAURI).toContain("collectionLabel: 'Samples'")
    expect(TAURI).toContain('notes: SAMPLE_DOCUMENTS.map')
    expect(TAURI).toContain('onSelectNote: actions.select')
    expect(TAURI).toContain('changes reset when SimpleMark restarts')
  })
})
```

Update `tests/app/native-new-note.test.ts` to look for `nativeSampleWorkspace(` wherever it currently
pins the old `nativeWorkspace(` welcome helper. Keep its existing assertion that a draft uses the
real catalog shape rather than the sample shape.

- [ ] **Step 2: Run native composition tests to verify RED**

Run:

```bash
npm test -- --run tests/app/native-sample-documents.test.ts tests/app/native-new-note.test.ts
```

Expected: FAIL because Tauri still imports `WELCOME_NAME` and `WELCOME_MARKDOWN`.

- [ ] **Step 3: Implement the native sample transition**

In `src/app/tauri.ts`:

1. Replace the welcome-note import with:

```ts
import {
  SAMPLE_DOCUMENTS,
  WELCOME_SAMPLE,
  sampleDocument,
} from './sample-documents.js'
```

2. Near the other shell-scoped state, create the temporary sample ports and active id:

```ts
const samplePorts = new Map(
  SAMPLE_DOCUMENTS.map((sample) => [
    sample.id,
    new FixtureFilePort(sample.name, sample.markdown),
  ]),
)
let activeSampleId = WELCOME_SAMPLE.id
```

3. Add two local function declarations inside `startNative` after the existing catalog actions are
   available and before the initial mount:

```ts
async function mountSample(id: string): Promise<void> {
  const sample = sampleDocument(id)
  const port = samplePorts.get(id)
  if (sample === undefined || port === undefined) return
  activeHandle = undefined
  draft = false
  activeSampleId = id
  current = await mount(root, port, {
    filePath: 'Samples · changes reset when SimpleMark restarts · open a file to use your own Markdown',
    pageZoom,
    menuTarget: () => current,
    onOpenFile: openFromPicker,
    workspace: nativeSampleWorkspace(activeSampleId, {
      select: selectSample,
      create: createNote,
      addFolder,
      selectCollection,
      folders: collections.folders(),
    }),
  })
}

function selectSample(id: string): void {
  void enqueue(async () => {
    if (sampleDocument(id) === undefined || id === activeSampleId) return
    if (!(await flush())) return
    await current.destroy()
    await mountSample(id)
    current.setStatus('saved', 'Sample document · changes reset when SimpleMark restarts')
  })
}
```

4. Replace the initial welcome mount with `await mountSample(WELCOME_SAMPLE.id)`.
5. In the three paths that return to an empty welcome state after discarding/closing/removing a real
   note, destroy the old composition as they already do, then call
   `await mountSample(WELCOME_SAMPLE.id)` instead of rebuilding a one-row fixture inline.
6. Replace `nativeWorkspace` with this pure row builder:

```ts
function nativeSampleWorkspace(
  activeId: string,
  actions: {
    readonly select: (id: string) => void
    readonly create: () => void
    readonly addFolder: () => void
    readonly selectCollection: (id: string) => void
    readonly folders: readonly WorkspaceCatalog[]
  },
): WorkspaceOptions {
  return {
    name: 'SimpleMark',
    collectionLabel: 'Samples',
    activeCollectionId: 'recent',
    activeNoteId: activeId,
    recentNotesCount: 0,
    onSelectNote: actions.select,
    onCreateNote: actions.create,
    onAddFolder: actions.addFolder,
    onSelectCollection: actions.selectCollection,
    folders: actions.folders.map((folder) => ({
      id: folder.handle,
      name: folder.name,
      count: folder.notes.length,
    })),
    notes: SAMPLE_DOCUMENTS.map((sample) => ({
      id: sample.id,
      identifier: sample.name,
      title: sample.title,
      preview: sample.preview,
      updatedLabel: sample.updatedLabel,
      pinned: sample.pinned,
    })),
  }
}
```

7. Delete `src/app/welcome-note.ts` only after `rg -n "welcome-note|WELCOME_NAME|WELCOME_MARKDOWN" src tests`
   returns no live import or assertion.

- [ ] **Step 4: Run focused native and shared tests to verify GREEN**

Run:

```bash
npm test -- --run tests/app/native-sample-documents.test.ts tests/app/native-new-note.test.ts tests/app/sample-documents.test.ts
npm run typecheck
npm run build
```

Expected: all focused tests pass, typecheck passes, and Vite bundles both raw Markdown imports.

- [ ] **Step 5: Prove the real native boundary and commit**

Run:

```bash
npm run test:native
npm run build:native
```

Open the built `.app`, confirm Welcome to SimpleMark lands first, select Project Tanoa from the
Samples list, switch back, edit one guided block, restart, and confirm the sample resets. Record the
exact artifact path and observed results in the task evidence; do not call the native behavior
verified from the web build alone.

Then commit:

```bash
git add src/app/tauri.ts src/app/welcome-note.ts tests/app/native-sample-documents.test.ts tests/app/native-new-note.test.ts
git commit -m "feat: open the showcase pair as native samples"
```

---

### Task 5: Visual polish, regression proof, and canonical gate

**Files:**
- Modify if needed: `docs/showcase/welcome-to-simplemark.md`
- Modify if needed: `tests/app/simplemark-living-handbook.test.ts`
- Modify if needed: `tests/ui/simplemark-living-handbook.spec.ts`
- Do not modify: `docs/showcase/project-tanoa-storm-atlas.md`
- Do not modify: `docs/assets/project-tanoa-storm-atlas.gif`

**Interfaces:**
- Consumes: the complete default-sample experience from Tasks 1–4.
- Produces: publication-width visual evidence and a clean, fully verified branch.

- [ ] **Step 1: Capture immutable Project Tanoa baselines**

Run before visual edits:

```bash
shasum -a 256 docs/showcase/project-tanoa-storm-atlas.md docs/assets/project-tanoa-storm-atlas.gif
```

Save the two hashes in the work log and compare them again in Step 5.

- [ ] **Step 2: Review the exact browser samples at publication width**

Start SimpleMark at its fixed demo size:

```bash
npm run dev -- --host 127.0.0.1 --port 5274 --strictPort
```

At 1000×625, inspect the handbook from top to bottom and confirm:

- the title and promise fit before the first scroll;
- every screenful has one dominant visual rather than competing cards;
- the SVG hero, radial chart, heatmap, Mermaid, Graphviz, and formula are legible without zoom;
- the technical evidence wall remains readable and does not create horizontal page overflow;
- each Try it callout is adjacent to the block it edits;
- the capability matrices fit the content column;
- source sheets reveal the exact replacement token; and
- switching to Project Tanoa preserves its approved rendering.

Make only document-source adjustments required by this checklist. Do not add app-specific HTML or
CSS to rescue a weak document.

- [ ] **Step 3: Re-run focused browser proof after any visual adjustment**

Run:

```bash
npm test -- --run tests/app/simplemark-living-handbook.test.ts tests/app/sample-documents.test.ts
npx playwright test tests/ui/simplemark-living-handbook.spec.ts tests/ui/project-tanoa-showcase.spec.ts tests/ui/sidebar-parity.spec.ts
git diff --check
```

Expected: all focused tests pass and no whitespace errors are reported.

- [ ] **Step 4: Run the complete canonical gate**

Run:

```bash
bash scripts/simplemark_ci.sh
```

Expected: typecheck, boundaries, Vitest, production build, and the complete Playwright suite all pass.

- [ ] **Step 5: Confirm scope and immutable assets**

Run:

```bash
shasum -a 256 docs/showcase/project-tanoa-storm-atlas.md docs/assets/project-tanoa-storm-atlas.gif
git status --short
git diff --check
```

Expected: both Project Tanoa hashes match Step 1; only the handbook, sample catalogue, two composition
roots, obsolete welcome module deletion, and their tests differ from the task's starting state.

- [ ] **Step 6: Commit visual-only refinements if Step 2 changed the handbook**

If the review required source changes:

```bash
git add docs/showcase/welcome-to-simplemark.md tests/app/simplemark-living-handbook.test.ts tests/ui/simplemark-living-handbook.spec.ts
git commit -m "docs: polish the Living Handbook in SimpleMark"
```

If Step 2 required no changes, do not create an empty commit.

- [ ] **Step 7: Prepare completion evidence without publishing prematurely**

Record:

- branch and exact head SHA;
- the full gate command and pass counts;
- native test/build results and built artifact path;
- native sample-selection/reset observations;
- Project Tanoa before/after SHA-256 values; and
- a screenshot or browser-review note for the handbook at 1000×625.

Do not create a second GIF, push, open a PR, or complete the board claim until the user approves the
actual handbook in SimpleMark.
