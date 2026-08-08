# Article Capture Implementation Plan

> **Warning:** the inline reference implementations below were written before execution; several were found to fail their own tests during implementation. The committed code is the authority, not these snippets.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pasted web article becomes real Markdown — its images downloaded into `assets/` beside the note and referenced relatively, and its page chrome removable in one explicitly offered, one-undo step.

**Architecture:** Pure rules (page analysis, provenance parsing, reference guards) go in `src/domain/paste/`. DOM work (tree building, trimming, the offer widget, the src rewrite) goes in `src/adapters/editor/`. Network and disk go in a new `src-tauri/src/note_images.rs` behind a new `ImageStorePort`, wired in `src/app/bootstrap.ts` and `src/app/tauri.ts`. The two adapters never import each other.

**Tech Stack:** TypeScript, Milkdown/ProseMirror, vitest (node env), Playwright, Rust (`reqwest`, `sha2`, `base64` — all already in `Cargo.toml`).

**Design spec:** [`docs/superpowers/specs/2026-08-08-article-capture-design.md`](../specs/2026-08-08-article-capture-design.md)
**Governing decision:** [`ADR-0008`](../../decisions/0008-pasted-images-become-local-files.md)

## Global Constraints

- **Base branch:** `worktree-article-capture`, branched from `origin/main` at `0843921`. Baseline: vitest **81 files / 732 tests** green.
- **No new dependencies.** Not `@mozilla/readability`, not a MIME crate, not a hashing library. `reqwest`, `sha2`, `base64` are already present.
- **Domain purity.** `src/domain/**` may not import a DOM type, a framework, or a node builtin — not even with `import type` (`tsPreCompilationDeps: true`). No `Document`, `Element`, `DOMParser`.
- **Public entry points.** Every new domain export must be re-exported from `src/domain/index.ts`; every new application export from `src/application/index.ts`. An unexported new module is a hard `no-orphan-modules` error, so a module and its export land in the same task.
- **No cross-adapter imports.** `adapters/editor/**` may not import `adapters/filesystem/**`. They meet only through a port injected by `src/app/bootstrap.ts`.
- **CSP is untouched.** `src-tauri/tauri.conf.json` is not edited. `tests/app/native-content-policy.test.ts` fails any remote origin.
- **§4.4 is the acceptance bar.** Never guess silently wrong; never lose the source; fail visibly. The faithful paste always lands first and always survives.
- **One ⌘Z.** Image rewrites carry `addToHistory: false`. The trim is one `closeHistory`-bounded transaction.
- **Markdown only ever holds a note-relative path.** Never a `blob:` URL, absolute path, or adapter id.
- **Test commands:** `npm run test` (vitest), `npm run test:native` (cargo), `npx playwright test <file>` **only with `SIMPLEMARK_TEST_PORT` set** — the default 5273 can attach to another worktree's dev server. The canonical gate is `bash scripts/simplemark_ci.sh`, never piped to `tail`.
- **Commit per task**, conventional-commit style, after that task's tests pass.

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/paste/images.ts` (create) | `isRemoteImageSource`, `isPortableAssetReference` — what may be fetched, what may be written |
| `src/domain/paste/page.ts` (create) | `PageNode`, `PageAnalysis`, `analysePastedPage` — the whole trim heuristic, DOM-free |
| `src/domain/paste/provenance.ts` (create) | `readPasteProvenance`, `provenanceHtml` — source URL and title from the clipboard HTML string |
| `src/domain/index.ts` (modify) | Re-export the three above |
| `src/application/ports.ts` (modify) | `StoredImage`, `LoadedImage`, `ImageStorePort`, `NoteImageStore` |
| `src/application/index.ts` (modify) | Re-export them |
| `src-tauri/src/note_images.rs` (create) | `download_note_image`, `read_note_asset`, hashing, refusals, extension table |
| `src-tauri/src/lib.rs` (modify) | `pub mod note_images;` + two entries in `generate_handler!` |
| `src-tauri/capabilities/default.json` (modify) | Description tells the truth about network access |
| `src/adapters/filesystem/tauri-image-store.ts` (create) | Thin transport to the two commands |
| `src/adapters/editor/image-capture.ts` (create) | Collect remote srcs from a fragment; download; rewrite by src, outside history |
| `src/adapters/editor/page-trim.ts` (create) | DOM ↔ `PageNode`; produce trimmed HTML with the provenance line |
| `src/adapters/editor/page-trim-offer.ts` (create) | The offer plugin: state, remapping, widget, accept, dismiss |
| `src/adapters/editor/paste-sniffers.ts` (modify) | `insertHtml` starts capture and raises the offer |
| `src/adapters/editor/asset-image-node-view.ts` (modify) | Three-branch src resolution via `blob:` |
| `src/adapters/editor/milkdown-editor.ts` (modify) | Thread `images` into the sniffer plugin and the image NodeView |
| `src/app/bootstrap.ts` (modify) | `AppPorts.images`; bind `session.documentHandle()` |
| `src/app/tauri.ts` (modify) | Compose `TauriImageStore` |

---

### Task 1: Domain reference guards

**Files:**
- Create: `src/domain/paste/images.ts`
- Modify: `src/domain/index.ts`
- Test: `tests/domain/paste-images.test.ts` (create)

**Interfaces:**
- Consumes: nothing
- Produces: `isRemoteImageSource(src: string): boolean`, `isPortableAssetReference(src: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'

import { isPortableAssetReference, isRemoteImageSource } from '../../src/domain/index.js'

/**
 * The two guards that bound what a paste may fetch and what it may write.
 * Everything the download path touches passes through one of them.
 */
describe('isRemoteImageSource', () => {
  it('is true for http and https', () => {
    expect(isRemoteImageSource('http://example.com/a.png')).toBe(true)
    expect(isRemoteImageSource('https://example.com/a.png')).toBe(true)
  })

  it('ignores surrounding whitespace and case', () => {
    expect(isRemoteImageSource('  HTTPS://example.com/a.png ')).toBe(true)
  })

  it('is false for sources that are already local', () => {
    expect(isRemoteImageSource('assets/a.png')).toBe(false)
    expect(isRemoteImageSource('data:image/png;base64,AAAA')).toBe(false)
    expect(isRemoteImageSource('blob:http://localhost/abc')).toBe(false)
    expect(isRemoteImageSource('file:///Users/x/a.png')).toBe(false)
    expect(isRemoteImageSource('')).toBe(false)
  })
})

describe('isPortableAssetReference', () => {
  it('accepts a note-relative path', () => {
    expect(isPortableAssetReference('assets/3f9a1c2b7d4e5f60.png')).toBe(true)
  })

  it('refuses anything that leaves the note folder or names a host', () => {
    expect(isPortableAssetReference('/etc/passwd')).toBe(false)
    expect(isPortableAssetReference('~/secrets.png')).toBe(false)
    expect(isPortableAssetReference('../outside.png')).toBe(false)
    expect(isPortableAssetReference('assets/../../outside.png')).toBe(false)
    expect(isPortableAssetReference('https://example.com/a.png')).toBe(false)
    expect(isPortableAssetReference('C:\\images\\a.png')).toBe(false)
    expect(isPortableAssetReference('')).toBe(false)
    expect(isPortableAssetReference('assets//a.png')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/domain/paste-images.test.ts`
Expected: FAIL — no export named `isRemoteImageSource`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/paste/images.ts`:

```ts
/**
 * What a paste may fetch, and what it may write into Markdown.
 *
 * Both halves of image capture are bounded by these two rules, which is why
 * they are here rather than in the adapter that happens to call them: a
 * downloaded image that arrived with an absolute path or a scheme would put
 * something unportable into the person's file, and DESIGN.md §5 tier 1 asks
 * that the file keep working as ordinary Markdown somewhere else.
 */

/** Sources worth downloading: a remote host the paste named. */
export function isRemoteImageSource(src: string): boolean {
  return /^https?:\/\//i.test(src.trim())
}

/**
 * The only shape that may be written back into an image reference: a
 * note-relative path. Mirrors `normaliseRelativeAssetPath`'s rule in the
 * browser asset adapter, applied to a value the native side produced.
 */
export function isPortableAssetReference(src: string): boolean {
  const candidate = src.trim()
  if (candidate === '') return false
  if (candidate.includes('\\')) return false
  if (candidate.startsWith('/') || candidate.startsWith('~')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return false
  const segments = candidate.split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}
```

Add to `src/domain/index.ts`, in the existing `paste/` export grouping:

```ts
export { isPortableAssetReference, isRemoteImageSource } from './paste/images.js'
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- tests/domain/paste-images.test.ts` → PASS
Run: `npm run check:boundaries` → clean

- [ ] **Step 5: Commit**

```bash
git add src/domain/paste/images.ts src/domain/index.ts tests/domain/paste-images.test.ts
git commit -m "feat(domain): guards for which image sources may be fetched and written"
```

---

### Task 2: Domain page analysis — the trim heuristic

**Files:**
- Create: `src/domain/paste/page.ts`
- Modify: `src/domain/index.ts`
- Test: `tests/domain/paste-page-analysis.test.ts` (create)

**Interfaces:**
- Consumes: nothing
- Produces:
  ```ts
  interface PageNode {
    readonly id: number
    readonly tag: string
    readonly role?: string
    readonly domId?: string
    readonly href?: string
    readonly text: string
    readonly linkText: string
    readonly children: readonly PageNode[]
  }
  interface PageAnalysis {
    readonly isFullPage: boolean
    readonly coreId?: number
    readonly pruned: ReadonlySet<number>
  }
  function analysePastedPage(root: PageNode): PageAnalysis
  ```
  `text` is the whole subtree's text; `linkText` is the text inside `a` descendants (an `a`'s own text counts toward its own `linkText`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'

import { analysePastedPage, type PageNode } from '../../src/domain/index.js'

/**
 * The trim heuristic, as pure data. It only ever *removes* what it is
 * confident about: the cost of keeping chrome is a wasted offer, and the cost
 * of dropping content is the paste losing something the person wanted.
 */
let nextId = 0
function node(tag: string, parts: Partial<PageNode> & { children?: PageNode[] } = {}): PageNode {
  const children = parts.children ?? []
  const ownText = parts.text ?? ''
  const text = ownText + children.map((child) => child.text).join(' ')
  const linkText =
    (tag === 'a' ? text : parts.linkText ?? '') +
    children.map((child) => (tag === 'a' ? '' : child.linkText)).join(' ')
  return {
    id: (nextId += 1),
    tag,
    text,
    linkText: tag === 'a' ? text : linkText,
    children,
    ...(parts.role === undefined ? {} : { role: parts.role }),
    ...(parts.domId === undefined ? {} : { domId: parts.domId }),
    ...(parts.href === undefined ? {} : { href: parts.href }),
  }
}

const PROSE = 'x'.repeat(500)

function article(...extra: PageNode[]): PageNode {
  return node('article', { children: [node('h1', { text: 'Title' }), node('p', { text: PROSE }), ...extra] })
}

describe('analysePastedPage', () => {
  it('offers a trim when the paste carries a nav element', () => {
    const root = node('div', { children: [node('nav', { children: [node('a', { text: 'Home' })] }), article()] })
    expect(analysePastedPage(root).isFullPage).toBe(true)
  })

  it('offers a trim on link density alone, with no semantic chrome tags', () => {
    // Substack builds its chrome from divs: zero nav/footer/header elements.
    const links = Array.from({ length: 14 }, (_, index) => node('a', { text: `Link ${index}` }))
    const root = node('div', { children: [node('div', { children: links }), article()] })
    expect(analysePastedPage(root).isFullPage).toBe(true)
  })

  it('does not offer a trim for an ordinary rich paste', () => {
    const root = node('div', {
      children: [node('p', { text: PROSE }), node('p', { text: 'A second paragraph.' })],
    })
    expect(analysePastedPage(root).isFullPage).toBe(false)
  })

  it('does not offer a trim when no content core can be identified', () => {
    const root = node('div', { children: [node('nav', { children: [node('a', { text: 'Home' })] })] })
    const analysis = analysePastedPage(root)
    expect(analysis.coreId).toBeUndefined()
    expect(analysis.isFullPage).toBe(false)
  })

  it('picks the densest prose container when there is no article element', () => {
    const core = node('div', { children: [node('p', { text: PROSE })] })
    const root = node('div', { children: [node('div', { children: [node('p', { text: 'short' })] }), core] })
    expect(analysePastedPage(root).coreId).toBe(core.id)
  })

  it('prunes chrome by tag and by ARIA role inside the core', () => {
    const footer = node('footer', { children: [node('a', { text: 'Terms' })] })
    const banner = node('div', { role: 'banner', children: [node('a', { text: 'Logo' })] })
    const analysis = analysePastedPage(node('div', { children: [article(footer, banner)] }))
    expect(analysis.pruned.has(footer.id)).toBe(true)
    expect(analysis.pruned.has(banner.id)).toBe(true)
  })

  it('prunes a link farm but never a heading, table, image or long paragraph', () => {
    const farm = node('div', {
      children: [node('a', { text: 'Share' }), node('a', { text: 'Comment' }), node('a', { text: 'Subscribe' })],
    })
    const heading = node('h2', { text: 'A linked section', children: [node('a', { text: 'Anchor' })] })
    const table = node('table', { children: [node('a', { text: 'ref' })] })
    const image = node('img')
    const paragraph = node('p', { text: PROSE, children: [node('a', { text: 'a source' })] })
    const analysis = analysePastedPage(node('div', { children: [article(farm, heading, table, image, paragraph)] }))
    expect(analysis.pruned.has(farm.id)).toBe(true)
    expect(analysis.pruned.has(heading.id)).toBe(false)
    expect(analysis.pruned.has(table.id)).toBe(false)
    expect(analysis.pruned.has(image.id)).toBe(false)
    expect(analysis.pruned.has(paragraph.id)).toBe(false)
  })

  it('prunes a footnote superscript whose definition did not come along', () => {
    const stranded = node('sup', { children: [node('a', { text: '1', href: '#fn-1' })] })
    const analysis = analysePastedPage(node('div', { children: [article(stranded)] }))
    expect(analysis.pruned.has(stranded.id)).toBe(true)
  })

  it('keeps a footnote superscript whose definition is in the paste', () => {
    const kept = node('sup', { children: [node('a', { text: '1', href: '#fn-1' })] })
    const definition = node('div', { domId: 'fn-1', text: 'The definition.' })
    const analysis = analysePastedPage(node('div', { children: [article(kept, definition)] }))
    expect(analysis.pruned.has(kept.id)).toBe(false)
  })

  it('keeps a documentation core that is legitimately link-heavy', () => {
    const core = node('article', {
      children: [
        node('h1', { text: 'API index' }),
        node('p', { text: PROSE }),
        node('ul', {
          children: Array.from({ length: 20 }, (_, index) => node('li', { children: [node('a', { text: `method${index}` })] })),
        }),
      ],
    })
    const analysis = analysePastedPage(node('div', { children: [core] }))
    expect(analysis.coreId).toBe(core.id)
    // The list is inside the core and carries no chrome role, so the trim
    // leaves it alone: an index page is still the article.
    expect([...analysis.pruned]).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/domain/paste-page-analysis.test.ts`
Expected: FAIL — no export named `analysePastedPage`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/paste/page.ts`. The rules, in order: find a core, then prune inside it.

```ts
/**
 * DESIGN.md §4.2: a clipboard that is a whole web page wrapped around an
 * article. The offer is explicit, so this file's job is to be *conservative*,
 * not clever — it decides whether a trim is worth offering, and which nodes it
 * is confident are page furniture. Everything it is unsure about is kept.
 *
 * Pure by construction: the adapter mirrors the parsed clipboard into
 * `PageNode`s and applies the answer back to the DOM. ADR-0001 keeps the
 * judgement here and the DOM there.
 */

/** A DOM-free mirror of one pasted element, built by the editor adapter. */
export interface PageNode {
  readonly id: number
  readonly tag: string
  readonly role?: string
  readonly domId?: string
  readonly href?: string
  /** All text in this subtree. */
  readonly text: string
  /** The part of `text` that sits inside a link. */
  readonly linkText: string
  readonly children: readonly PageNode[]
}

export interface PageAnalysis {
  readonly isFullPage: boolean
  readonly coreId?: number
  readonly pruned: ReadonlySet<number>
}

const CHROME_TAGS = new Set([
  'nav', 'footer', 'header', 'aside', 'form', 'button', 'script', 'style', 'noscript', 'iframe',
])
const CHROME_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'complementary', 'search'])
const PROTECTED_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'img', 'figure', 'figcaption', 'blockquote', 'pre', 'code',
])
const CORE_TAGS = new Set(['article', 'main'])

/** A core must carry a real article's worth of text before anything is dropped. */
const MIN_CORE_TEXT = 400
/** Above this share of linked text, a block with nothing protected in it is furniture. */
const LINK_DENSITY_LIMIT = 0.5
/** A paragraph this long is content even if it is mostly a link. */
const LONG_PARAGRAPH = 120
/** Fewer links than this outside the core is not a page's worth of chrome. */
const MIN_CHROME_LINKS = 12

function walk(node: PageNode, visit: (node: PageNode) => void): void {
  visit(node)
  for (const child of node.children) walk(child, visit)
}

function isChrome(node: PageNode): boolean {
  return CHROME_TAGS.has(node.tag) || (node.role !== undefined && CHROME_ROLES.has(node.role))
}

function hasProtectedContent(node: PageNode): boolean {
  let protectedContent = false
  walk(node, (candidate) => {
    if (PROTECTED_TAGS.has(candidate.tag)) protectedContent = true
    if (candidate.tag === 'p' && candidate.text.trim().length > LONG_PARAGRAPH) protectedContent = true
  })
  return protectedContent
}

function linkDensity(node: PageNode): number {
  const text = node.text.trim().length
  if (text === 0) return node.linkText.trim().length > 0 ? 1 : 0
  return node.linkText.trim().length / text
}

/** Total text held in `p` descendants — prose, as opposed to menu labels. */
function proseLength(node: PageNode): number {
  let total = 0
  walk(node, (candidate) => {
    if (candidate.tag === 'p') total += candidate.text.trim().length
  })
  return total
}

function findCore(root: PageNode): PageNode | undefined {
  let semantic: PageNode | undefined
  walk(root, (candidate) => {
    if (semantic !== undefined) return
    const isSemantic = CORE_TAGS.has(candidate.tag) || candidate.role === 'main'
    if (isSemantic && candidate.text.trim().length >= MIN_CORE_TEXT) semantic = candidate
  })
  if (semantic !== undefined) return semantic

  let best: PageNode | undefined
  let bestLength = 0
  walk(root, (candidate) => {
    if (candidate.tag === 'a' || isChrome(candidate)) return
    const length = proseLength(candidate)
    // Strictly greater keeps the *innermost* container that still holds all
    // the prose, rather than its identical ancestors.
    if (length > bestLength) {
      best = candidate
      bestLength = length
    }
  })
  return bestLength >= MIN_CORE_TEXT ? best : undefined
}

/** Fragment targets that actually arrived in the paste. */
function definedAnchors(root: PageNode): ReadonlySet<string> {
  const anchors = new Set<string>()
  walk(root, (candidate) => {
    if (candidate.domId !== undefined && candidate.domId !== '') anchors.add(candidate.domId)
  })
  return anchors
}

/** A `sup` that is only a link, pointing at a definition that did not come along. */
function isStrandedFootnote(node: PageNode, anchors: ReadonlySet<string>): boolean {
  if (node.tag !== 'sup') return false
  const links = node.children.filter((child) => child.tag === 'a')
  if (links.length === 0 || links.length !== node.children.length) return false
  return links.every((link) => {
    const href = link.href ?? ''
    return !href.startsWith('#') || !anchors.has(href.slice(1))
  })
}

export function analysePastedPage(root: PageNode): PageAnalysis {
  const core = findCore(root)
  const pruned = new Set<number>()

  if (core === undefined) return { isFullPage: false, pruned }

  const anchors = definedAnchors(root)
  const prune = (node: PageNode): void => {
    if (isChrome(node) || isStrandedFootnote(node, anchors)) {
      pruned.add(node.id)
      return
    }
    if (node.id !== core.id && !hasProtectedContent(node) && linkDensity(node) > LINK_DENSITY_LIMIT) {
      pruned.add(node.id)
      return
    }
    for (const child of node.children) prune(child)
  }
  prune(core)

  // Evidence that this is a page and not just a rich paste.
  let roleEvidence = false
  let outsideLinks = 0
  let denseBlockOutside = false
  const outside = (node: PageNode): void => {
    if (node.id === core.id) return
    if (isChrome(node)) roleEvidence = true
    if (node.tag === 'a') outsideLinks += 1
    if (node.tag !== 'a' && !hasProtectedContent(node) && linkDensity(node) > LINK_DENSITY_LIMIT) {
      denseBlockOutside = true
    }
    for (const child of node.children) outside(child)
  }
  outside(root)

  const densityEvidence = outsideLinks >= MIN_CHROME_LINKS && denseBlockOutside
  return { isFullPage: roleEvidence || densityEvidence, coreId: core.id, pruned }
}
```

Add to `src/domain/index.ts`:

```ts
export { analysePastedPage } from './paste/page.js'
export type { PageAnalysis, PageNode } from './paste/page.js'
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- tests/domain/paste-page-analysis.test.ts` → PASS (11 tests)
Run: `npm run check:boundaries` → clean

- [ ] **Step 5: Commit**

```bash
git add src/domain/paste/page.ts src/domain/index.ts tests/domain/paste-page-analysis.test.ts
git commit -m "feat(domain): conservative article extraction over a DOM-free page tree"
```

---

### Task 3: Domain provenance

**Files:**
- Create: `src/domain/paste/provenance.ts`
- Modify: `src/domain/index.ts`
- Test: `tests/domain/paste-provenance.test.ts` (create)

**Interfaces:**
- Consumes: nothing
- Produces:
  ```ts
  interface PasteProvenance { readonly url: string; readonly title?: string }
  function readPasteProvenance(html: string): PasteProvenance | null
  function provenanceHtml(provenance: PasteProvenance): string
  ```
  `provenanceHtml` returns a `<blockquote>` so it joins the trimmed article on the same HTML-parsing path and serializes to `> Source: [title](url)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'

import { provenanceHtml, readPasteProvenance } from '../../src/domain/index.js'

/**
 * DESIGN.md §4.4 and ADR-0006: provenance is honest, not uniform. A source we
 * cannot read is written as nothing at all — never inferred from a CDN path or
 * a publication name.
 */
describe('readPasteProvenance', () => {
  it('reads the CF_HTML SourceURL header a browser puts above the fragment', () => {
    const html = [
      'Version:0.9',
      'StartHTML:00000097',
      'SourceURL:https://newsletter.semianalysis.com/p/gemini-is-cooked-but-gcp-is-cooking',
      '<html><body><p>Body</p></body></html>',
    ].join('\r\n')
    expect(readPasteProvenance(html)?.url).toBe(
      'https://newsletter.semianalysis.com/p/gemini-is-cooked-but-gcp-is-cooking',
    )
  })

  it('falls back to a base href', () => {
    const html = '<html><head><base href="https://example.com/post"></head><body><p>Body</p></body></html>'
    expect(readPasteProvenance(html)?.url).toBe('https://example.com/post')
  })

  it('prefers the SourceURL header over a base href', () => {
    const html = 'SourceURL:https://real.example/post\n<html><head><base href="https://cdn.example/"></head></html>'
    expect(readPasteProvenance(html)?.url).toBe('https://real.example/post')
  })

  it('reads the title, preferring the document title over og:title', () => {
    const html =
      'SourceURL:https://example.com/p\n<html><head><title>Gemini is Cooked</title>' +
      '<meta property="og:title" content="Something else"></head></html>'
    expect(readPasteProvenance(html)?.title).toBe('Gemini is Cooked')
  })

  it('falls back to og:title in either attribute order', () => {
    const before = 'SourceURL:https://example.com/p\n<meta property="og:title" content="From OG">'
    const after = 'SourceURL:https://example.com/p\n<meta content="From OG" property="og:title">'
    expect(readPasteProvenance(before)?.title).toBe('From OG')
    expect(readPasteProvenance(after)?.title).toBe('From OG')
  })

  it('decodes entities in the title', () => {
    const html = 'SourceURL:https://example.com/p\n<title>Gemini &amp; GCP &#39;26</title>'
    expect(readPasteProvenance(html)?.title).toBe("Gemini & GCP '26")
  })

  it('returns null when no source is present, and never guesses one', () => {
    expect(readPasteProvenance('<html><body><p>Body</p></body></html>')).toBeNull()
    expect(readPasteProvenance('')).toBeNull()
  })

  it('refuses a source that is not http or https', () => {
    expect(readPasteProvenance('SourceURL:file:///Users/x/post.html\n<p>Body</p>')).toBeNull()
    expect(readPasteProvenance('SourceURL:javascript:alert(1)\n<p>Body</p>')).toBeNull()
  })

  it('reports a url with no title rather than inventing one', () => {
    const provenance = readPasteProvenance('SourceURL:https://example.com/p\n<p>Body</p>')
    expect(provenance).toEqual({ url: 'https://example.com/p' })
  })
})

describe('provenanceHtml', () => {
  it('writes a blockquote that serializes to a Markdown source line', () => {
    expect(provenanceHtml({ url: 'https://example.com/p', title: 'A title' })).toBe(
      '<blockquote><p>Source: <a href="https://example.com/p">A title</a></p></blockquote>',
    )
  })

  it('uses the url as its own link text when no title is known', () => {
    expect(provenanceHtml({ url: 'https://example.com/p' })).toBe(
      '<blockquote><p>Source: <a href="https://example.com/p">https://example.com/p</a></p></blockquote>',
    )
  })

  it('escapes markup in a title so a hostile page cannot inject nodes', () => {
    expect(provenanceHtml({ url: 'https://example.com/p', title: '<img src=x onerror=alert(1)>' })).toBe(
      '<blockquote><p>Source: <a href="https://example.com/p">' +
        '&lt;img src=x onerror=alert(1)&gt;</a></p></blockquote>',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/domain/paste-provenance.test.ts`
Expected: FAIL — no export named `readPasteProvenance`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/paste/provenance.ts`:

```ts
/**
 * Where a pasted page came from, when the clipboard says so.
 *
 * String work rather than DOM work on purpose: the CF_HTML `SourceURL` header
 * sits *above* the markup and is not part of any document a parser would build,
 * and ADR-0001 keeps `domain` free of a DOM either way.
 *
 * DESIGN.md §4.4 and ADR-0006 set the bar: an unreadable source is written as
 * nothing. No canonical link, no og:url, no reconstruction from a CDN path.
 */

export interface PasteProvenance {
  readonly url: string
  readonly title?: string
}

const SOURCE_URL = /^\s*SourceURL\s*:\s*(\S+)\s*$/im
const BASE_HREF = /<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i
const TITLE = /<title\b[^>]*>([\s\S]*?)<\/title>/i
const OG_TITLE_CONTENT_LAST =
  /<meta\b[^>]*\bproperty\s*=\s*["']og:title["'][^>]*\bcontent\s*=\s*["']([^"']*)["']/i
const OG_TITLE_CONTENT_FIRST =
  /<meta\b[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*\bproperty\s*=\s*["']og:title["']/i

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (entity) => ENTITIES[entity] ?? entity)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function readPasteProvenance(html: string): PasteProvenance | null {
  const url = (SOURCE_URL.exec(html)?.[1] ?? BASE_HREF.exec(html)?.[1] ?? '').trim()
  if (!/^https?:\/\/\S+$/i.test(url)) return null

  const rawTitle =
    TITLE.exec(html)?.[1] ??
    OG_TITLE_CONTENT_LAST.exec(html)?.[1] ??
    OG_TITLE_CONTENT_FIRST.exec(html)?.[1] ??
    ''
  const title = decodeEntities(rawTitle).replace(/\s+/g, ' ').trim()
  return title === '' ? { url } : { url, title }
}

/**
 * The provenance line as HTML, so it joins the trimmed article on the same
 * parsing path and serializes to `> Source: [title](url)`.
 */
export function provenanceHtml(provenance: PasteProvenance): string {
  const text = escapeHtml(provenance.title ?? provenance.url)
  return `<blockquote><p>Source: <a href="${escapeHtml(provenance.url)}">${text}</a></p></blockquote>`
}
```

Add to `src/domain/index.ts`:

```ts
export { provenanceHtml, readPasteProvenance } from './paste/provenance.js'
export type { PasteProvenance } from './paste/provenance.js'
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- tests/domain/paste-provenance.test.ts` → PASS (12 tests)
Run: `npm run check:boundaries` → clean

- [ ] **Step 5: Commit**

```bash
git add src/domain/paste/provenance.ts src/domain/index.ts tests/domain/paste-provenance.test.ts
git commit -m "feat(domain): read a pasted page's source url and title, or nothing"
```

---

### Task 4: The image store port

**Files:**
- Modify: `src/application/ports.ts`, `src/application/index.ts`
- Test: none of its own — it is types only, exercised by Tasks 5–8

**Interfaces:**
- Consumes: nothing
- Produces: `StoredImage`, `LoadedImage`, `ImageStorePort`, `NoteImageStore` (signatures below)

- [ ] **Step 1: Add the port**

Append to `src/application/ports.ts`, after `ChartDataReader`:

```ts
/** An image stored beside the open note, as the reference written into Markdown. */
export interface StoredImage {
  /** Always a note-relative path such as `assets/3f9a1c2b7d4e5f60.png`. */
  readonly src: string
}

/** Bytes of a note-relative image, for display only — never written to Markdown. */
export interface LoadedImage {
  readonly bytes: Uint8Array
  readonly mediaType: string
}

/**
 * Stores remote images beside the open note and reads them back for display
 * (ADR-0008).
 *
 * The packaged app's content policy blocks both a remote `<img>` and a webview
 * `fetch`, so a pasted article's pictures can only work if the shell downloads
 * them and the note references them relatively. A port rather than a direct
 * call because the halves live in different adapters — the editor decides which
 * sources to capture, the native side fetches and writes — and adapters do not
 * import one another (ADR-0001 §Enforcement 3).
 *
 * The document handle travels per call, as it does for `DocumentLinkPort`: the
 * open note changes under a long-lived port, and a handle captured at
 * construction would resolve against whichever note was open at startup.
 *
 * Absent in hosts that cannot write next to the document. A paste there keeps
 * the remote URL it arrived with, unchanged and visible.
 */
export interface ImageStorePort {
  /** Download `url` into the note's `assets/` folder. `null` declines — keep the remote URL. */
  store(documentHandle: string, url: string): Promise<StoredImage | null>
  /** Read a note-relative image for rendering. `null` when it is not available. */
  read(documentHandle: string, href: string): Promise<LoadedImage | null>
}

/** The same capability with the open note already bound, as the editor sees it. */
export interface NoteImageStore {
  store(url: string): Promise<StoredImage | null>
  read(href: string): Promise<LoadedImage | null>
}
```

Add the four names to the existing `export type { … } from './ports.js'` list in `src/application/index.ts`.

- [ ] **Step 2: Verify**

Run: `npm run typecheck` → clean
Run: `npm run check:boundaries` → clean

- [ ] **Step 3: Commit**

```bash
git add src/application/ports.ts src/application/index.ts
git commit -m "feat(application): ImageStorePort for images kept beside the note"
```

---

### Task 5: The Rust image commands

**Files:**
- Create: `src-tauri/src/note_images.rs` (implementation and its `#[cfg(test)] mod tests`)
- Modify: `src-tauri/src/lib.rs` (module declaration + handler registration), `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: nothing
- Produces, callable as Tauri commands:
  - `download_note_image(documentHandle: String, url: String) -> Result<StoredImage { src }, String>`
  - `read_note_asset(documentHandle: String, href: String) -> Result<LoadedImage { bytes: base64 String, mediaType: String }, String>`

- [ ] **Step 1: Write the failing tests**

Add at the bottom of `src-tauri/src/note_images.rs`. Downloads are served by an in-process `TcpListener`; no network is touched.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    /// A one-shot HTTP server. Returns the base URL it is listening on.
    fn serve(response: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut discard = [0_u8; 1024];
                let _ = stream.read(&mut discard);
                let _ = stream.write_all(&response);
            }
        });
        format!("http://127.0.0.1:{port}")
    }

    fn png_response(body: &[u8]) -> Vec<u8> {
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\n\r\n",
            body.len()
        )
        .into_bytes();
        response.extend_from_slice(body);
        response
    }

    fn note_in_temp_dir() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().expect("tempdir");
        let note = dir.path().join("note.md");
        std::fs::write(&note, b"# Note\n").expect("write note");
        let handle = note.display().to_string();
        (dir, handle)
    }

    #[test]
    fn extension_comes_from_the_content_type() {
        assert_eq!(extension_for_media_type("image/png"), Some("png"));
        assert_eq!(extension_for_media_type("image/jpeg; charset=binary"), Some("jpg"));
        assert_eq!(extension_for_media_type("IMAGE/WEBP"), Some("webp"));
        assert_eq!(extension_for_media_type("image/avif"), Some("avif"));
    }

    #[test]
    fn svg_is_refused_because_nothing_here_can_sanitise_it() {
        assert_eq!(extension_for_media_type("image/svg+xml"), None);
        assert_eq!(extension_for_media_type("text/html"), None);
    }

    #[tokio::test]
    async fn a_download_lands_in_assets_named_by_its_content_hash() {
        let (dir, handle) = note_in_temp_dir();
        let base = serve(png_response(b"fake-png-bytes"));

        let stored = download_note_image(handle, format!("{base}/a.png")).await.expect("download");

        let digest = content_digest(b"fake-png-bytes");
        assert_eq!(stored.src, format!("assets/{}.png", &digest[..16]));
        assert!(dir.path().join(&stored.src).exists());
    }

    #[tokio::test]
    async fn identical_bytes_reuse_one_file() {
        let (dir, handle) = note_in_temp_dir();
        let first = serve(png_response(b"same-bytes"));
        let second = serve(png_response(b"same-bytes"));

        let a = download_note_image(handle.clone(), format!("{first}/a.png")).await.expect("first");
        let b = download_note_image(handle, format!("{second}/b.png")).await.expect("second");

        assert_eq!(a.src, b.src);
        let entries = std::fs::read_dir(dir.path().join("assets")).expect("read assets").count();
        assert_eq!(entries, 1);
    }

    #[tokio::test]
    async fn a_non_image_response_is_refused_and_writes_nothing() {
        let (dir, handle) = note_in_temp_dir();
        let base = serve(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 5\r\n\r\nhello".to_vec(),
        );

        let error = download_note_image(handle, format!("{base}/a.png")).await.expect_err("refusal");

        assert!(error.contains("not an image"), "{error}");
        assert!(!dir.path().join("assets").exists());
    }

    #[tokio::test]
    async fn an_oversized_response_is_refused() {
        let (_dir, handle) = note_in_temp_dir();
        let body = vec![0_u8; 64];
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\n\r\n",
            MAX_IMAGE_BYTES + 1
        )
        .into_bytes();
        response.extend_from_slice(&body);
        let base = serve(response);

        let error = download_note_image(handle, format!("{base}/a.png")).await.expect_err("refusal");

        assert!(error.contains("too large"), "{error}");
    }

    #[tokio::test]
    async fn only_http_urls_are_fetched() {
        let (_dir, handle) = note_in_temp_dir();
        for url in ["file:///etc/passwd", "data:image/png;base64,AAAA", "ftp://example.com/a.png"] {
            let error = download_note_image(handle.clone(), url.to_string()).await.expect_err("refusal");
            assert!(error.contains("http"), "{url}: {error}");
        }
    }

    #[tokio::test]
    async fn pasted_html_cannot_aim_the_app_at_a_private_address() {
        let (_dir, handle) = note_in_temp_dir();
        for url in [
            "http://localhost:8080/a.png",
            "http://127.0.0.1/a.png",
            "http://10.0.0.5/a.png",
            "http://192.168.1.4/a.png",
            "http://169.254.169.254/latest/meta-data",
            "http://[::1]/a.png",
        ] {
            let error = download_note_image(handle.clone(), url.to_string()).await.expect_err("refusal");
            assert!(error.contains("private"), "{url}: {error}");
        }
    }

    #[tokio::test]
    async fn a_note_that_is_not_a_file_has_no_folder_to_write_beside() {
        let base = serve(png_response(b"bytes"));
        let error = download_note_image("Not saved".to_string(), format!("{base}/a.png"))
            .await
            .expect_err("refusal");
        assert!(error.contains("saved"), "{error}");
    }

    #[test]
    fn an_asset_reads_back_with_its_media_type() {
        let (dir, handle) = note_in_temp_dir();
        std::fs::create_dir_all(dir.path().join("assets")).expect("mkdir");
        std::fs::write(dir.path().join("assets/a.png"), b"png-bytes").expect("write");

        let loaded = read_note_asset(handle, "assets/a.png".to_string()).expect("read");

        assert_eq!(BASE64.decode(loaded.bytes).expect("decode"), b"png-bytes");
        assert_eq!(loaded.media_type, "image/png");
    }

    #[test]
    fn an_asset_href_may_not_leave_the_note_folder() {
        let (_dir, handle) = note_in_temp_dir();
        for href in ["../outside.png", "/etc/passwd", "~/secret.png", "https://example.com/a.png"] {
            let error = read_note_asset(handle.clone(), href.to_string()).expect_err("refusal");
            assert!(error.contains("beside the note"), "{href}: {error}");
        }
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:native`
Expected: FAIL — `note_images` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src-tauri/src/note_images.rs`:

```rust
//! Images a paste brought with it, kept beside the note (ADR-0008).
//!
//! The window's content policy blocks a remote `<img>` and blocks `fetch` to
//! anything but the IPC origin, so an article's pictures can only work if this
//! side fetches them. Everything the webview cannot bound is bounded here: the
//! scheme, the address, the redirect count, the size, and the response type.
//!
//! No cookies and no credentials are ever sent — `reqwest` is built without a
//! cookie store — so this cannot reach anything the person is signed in to.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::net::IpAddr;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

/// A note folder is not a download sink.
const MAX_IMAGE_BYTES: u64 = 24 * 1024 * 1024;
/// An image does not need `reqwest`'s default ten.
const MAX_REDIRECTS: usize = 4;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredImage {
    pub src: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedImage {
    /// Base64 so the bytes survive the IPC boundary without being decoded as text.
    pub bytes: String,
    pub media_type: String,
}

/// Stable, cross-process identity for exact bytes. Mirrors `note_preview`.
fn content_digest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The response types worth writing to disk.
///
/// `image/svg+xml` is deliberately absent: DESIGN.md §7 requires that all SVG
/// pass DOMPurify, there is no sanitiser on this side, and writing unsanitised
/// markup into the person's folder to satisfy a paste is exactly the silent
/// risk §4.4 exists to prevent. An SVG keeps its remote URL instead.
pub fn extension_for_media_type(media_type: &str) -> Option<&'static str> {
    let bare = media_type.split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
    match bare.as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/avif" => Some("avif"),
        "image/bmp" => Some("bmp"),
        "image/x-icon" | "image/vnd.microsoft.icon" => Some("ico"),
        "image/tiff" => Some("tiff"),
        _ => None,
    }
}

fn media_type_for_extension(extension: &str) -> &'static str {
    match extension.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "tiff" | "tif" => "image/tiff",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

/// Pasted HTML is untrusted input; it may not aim the app at the person's own
/// network. Literal addresses only — this does not resolve DNS, so a hostname
/// pointing at a private address still reaches it. A documented limit.
fn is_private_host(host: &str) -> bool {
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if bare.eq_ignore_ascii_case("localhost") || bare.eq_ignore_ascii_case("localhost.localdomain") {
        return true;
    }
    match bare.parse::<IpAddr>() {
        Ok(IpAddr::V4(address)) => {
            address.is_loopback()
                || address.is_private()
                || address.is_link_local()
                || address.is_unspecified()
                || address.is_broadcast()
        }
        Ok(IpAddr::V6(address)) => {
            address.is_loopback()
                || address.is_unspecified()
                // Unique-local (fc00::/7) and link-local (fe80::/10).
                || matches!(address.segments()[0] & 0xfe00, 0xfc00)
                || matches!(address.segments()[0] & 0xffc0, 0xfe80)
        }
        Err(_) => false,
    }
}

/// The folder the note lives in. A handle that is not an existing file is one
/// of the shell's display strings ("Not saved"), not a path.
fn note_directory(document_handle: &str) -> Result<PathBuf, String> {
    let note = Path::new(document_handle);
    if !note.is_file() {
        return Err("This note has not been saved yet, so there is no folder to keep images in.".into());
    }
    note.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "This note has no containing folder.".to_string())
}

/// The same rule the browser asset adapter states: note-relative, no escape.
fn resolve_beside_note(document_handle: &str, href: &str) -> Result<PathBuf, String> {
    const REFUSAL: &str = "An image reference must name a file beside the note.";
    let candidate = href.trim();
    if candidate.is_empty()
        || candidate.starts_with('/')
        || candidate.starts_with('~')
        || candidate.contains('\\')
        || candidate.contains(':')
    {
        return Err(REFUSAL.into());
    }
    let relative = Path::new(candidate);
    if relative.components().any(|component| !matches!(component, Component::Normal(_))) {
        return Err(REFUSAL.into());
    }
    Ok(note_directory(document_handle)?.join(relative))
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
        .build()
        .map_err(|error| format!("Could not prepare the image download: {error}"))
}

/// Downloads one image into `<note folder>/assets/`, named by its content hash.
///
/// Every refusal is an ordinary `Err` the shell shows verbatim; the caller
/// keeps the remote URL, visibly unchanged, rather than reporting a success it
/// did not have.
#[tauri::command]
pub async fn download_note_image(
    document_handle: String,
    url: String,
) -> Result<StoredImage, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| format!("That image address is not a URL: {url}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("Only http and https images are downloaded, not {}.", parsed.scheme()));
    }
    if parsed.host_str().is_some_and(is_private_host) {
        return Err("That image is on a private address, so it was not downloaded.".into());
    }

    // Resolve the destination before spending a request on it.
    let assets = note_directory(&document_handle)?.join("assets");

    let response = http_client()?
        .get(parsed)
        .send()
        .await
        .map_err(|error| format!("Could not download the image: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("The image server answered {}.", response.status()));
    }

    let media_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let extension = extension_for_media_type(&media_type)
        .ok_or_else(|| format!("That address is not an image this app stores ({media_type})."))?;

    if response.content_length().is_some_and(|length| length > MAX_IMAGE_BYTES) {
        return Err("That image is too large to keep beside the note.".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Could not read the image: {error}"))?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("That image is too large to keep beside the note.".into());
    }

    let digest = content_digest(&bytes);
    let name = format!("{}.{extension}", &digest[..16]);
    let destination = assets.join(&name);
    let src = format!("assets/{name}");

    // Identical bytes are one file: a second paste of the same picture writes
    // nothing and reuses the reference.
    if destination.exists() {
        return Ok(StoredImage { src });
    }

    std::fs::create_dir_all(&assets)
        .map_err(|error| format!("Could not create the assets folder: {error}"))?;
    std::fs::write(&destination, &bytes).map_err(|error| {
        let _ = std::fs::remove_file(&destination);
        format!("Could not save the image: {error}")
    })?;
    Ok(StoredImage { src })
}

/// Reads a note-relative image so the editor can show it under a policy that
/// admits `blob:` but not the filesystem.
#[tauri::command]
pub fn read_note_asset(document_handle: String, href: String) -> Result<LoadedImage, String> {
    let path = resolve_beside_note(&document_handle, &href)?;
    let bytes = std::fs::read(&path).map_err(|error| format!("Could not read {href}: {error}"))?;
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or_default();
    Ok(LoadedImage {
        bytes: BASE64.encode(bytes),
        media_type: media_type_for_extension(extension).to_string(),
    })
}
```

In `src-tauri/src/lib.rs`, add `pub mod note_images;` beside `pub mod note_preview;` (line ~59), and add these two entries to the `tauri::generate_handler![…]` list:

```rust
note_images::download_note_image,
note_images::read_note_asset,
```

**`tokio` is not a dependency of this crate and must not be added.** Write the async tests as ordinary `#[test]` functions that drive the future with `tauri::async_runtime::block_on(...)`:

```rust
#[test]
fn a_download_lands_in_assets_named_by_its_content_hash() {
    let (dir, handle) = note_in_temp_dir();
    let base = serve(png_response(b"fake-png-bytes"));

    let stored = tauri::async_runtime::block_on(download_note_image(handle, format!("{base}/a.png")))
        .expect("download");
    …
}
```

Apply the same change to every test above marked `#[tokio::test]`.

Update the `description` in `src-tauri/capabilities/default.json` so the manifest stays true — replace the closing clause about network access with:

```
No general filesystem, shell, or unscoped network permission is granted: every other capability goes through this crate's narrow commands, and network access is limited to that one explicit, user-initiated, user-configured call and to downloading the images a pasted article references, which is bounded to http and https, to public addresses, to image responses, and to a size ceiling (ADR-0008).
```

- [ ] **Step 4: Run tests**

Run: `npm run test:native` → PASS, including the 11 new tests
Run: `npm run test -- tests/app/native-capabilities.test.ts tests/app/native-content-policy.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/note_images.rs src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat(native): bounded image download and note-relative asset read"
```

---

### Task 6: The native image store adapter

**Files:**
- Create: `src/adapters/filesystem/tauri-image-store.ts`
- Test: `tests/adapters/tauri-image-store.test.ts` (create)

**Interfaces:**
- Consumes: `ImageStorePort`, `StoredImage`, `LoadedImage` (Task 4); the two commands (Task 5)
- Produces: `class TauriImageStore implements ImageStorePort`, `type TauriImageInvoke = (command: string, args: Record<string, string>) => Promise<unknown>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'

import { TauriImageStore } from '../../src/adapters/filesystem/tauri-image-store.js'

/**
 * A thin transport. Its whole job is to send the right command with the right
 * arguments and to turn a refusal into `null` — a paste that could not store
 * its image keeps the remote URL rather than losing it (§4.4).
 */
describe('TauriImageStore', () => {
  it('downloads through the native command and returns the note-relative reference', async () => {
    const calls: Array<{ command: string; args: unknown }> = []
    const store = new TauriImageStore(async (command, args) => {
      calls.push({ command, args })
      return { src: 'assets/3f9a1c2b7d4e5f60.png' }
    })

    const stored = await store.store('/notes/a.md', 'https://example.com/a.png')

    expect(stored).toEqual({ src: 'assets/3f9a1c2b7d4e5f60.png' })
    expect(calls).toEqual([
      {
        command: 'download_note_image',
        args: { documentHandle: '/notes/a.md', url: 'https://example.com/a.png' },
      },
    ])
  })

  it('declines rather than throwing when the native side refuses', async () => {
    const store = new TauriImageStore(async () => {
      throw new Error('That image is on a private address, so it was not downloaded.')
    })
    await expect(store.store('/notes/a.md', 'http://127.0.0.1/a.png')).resolves.toBeNull()
  })

  it('refuses a reference the native side returned that is not note-relative', async () => {
    const store = new TauriImageStore(async () => ({ src: '/etc/passwd' }))
    await expect(store.store('/notes/a.md', 'https://example.com/a.png')).resolves.toBeNull()
  })

  it('reads an asset back as bytes and a media type', async () => {
    const calls: Array<{ command: string; args: unknown }> = []
    const store = new TauriImageStore(async (command, args) => {
      calls.push({ command, args })
      return { bytes: 'aGVsbG8=', mediaType: 'image/png' }
    })

    const loaded = await store.read('/notes/a.md', 'assets/a.png')

    expect(loaded?.mediaType).toBe('image/png')
    expect(new TextDecoder().decode(loaded?.bytes)).toBe('hello')
    expect(calls[0]).toEqual({
      command: 'read_note_asset',
      args: { documentHandle: '/notes/a.md', href: 'assets/a.png' },
    })
  })

  it('reports a missing asset as null, not an exception', async () => {
    const store = new TauriImageStore(async () => {
      throw new Error('Could not read assets/a.png: No such file or directory')
    })
    await expect(store.read('/notes/a.md', 'assets/a.png')).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/adapters/tauri-image-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import type { ImageStorePort, LoadedImage, StoredImage } from '../../application/index.js'
import { isPortableAssetReference } from '../../domain/index.js'

export type TauriImageInvoke = (
  command: string,
  args: Record<string, string>,
) => Promise<unknown>

/**
 * Thin transport to the audited image commands (ADR-0008).
 *
 * Every refusal becomes `null` rather than an exception: the caller's answer to
 * "this image could not be stored" is to keep the remote URL it already has,
 * which is a visible, unchanged state rather than a lost paste (§4.4).
 */
export class TauriImageStore implements ImageStorePort {
  constructor(private readonly invoke: TauriImageInvoke) {}

  async store(documentHandle: string, url: string): Promise<StoredImage | null> {
    try {
      const result = (await this.invoke('download_note_image', { documentHandle, url })) as {
        src?: unknown
      } | null
      const src = typeof result?.src === 'string' ? result.src : ''
      // The document may only ever hold a note-relative path, whatever the
      // native side reports.
      return isPortableAssetReference(src) ? { src } : null
    } catch {
      return null
    }
  }

  async read(documentHandle: string, href: string): Promise<LoadedImage | null> {
    try {
      const result = (await this.invoke('read_note_asset', { documentHandle, href })) as {
        bytes?: unknown
        mediaType?: unknown
      } | null
      if (typeof result?.bytes !== 'string' || typeof result.mediaType !== 'string') return null
      const binary = atob(result.bytes)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      return { bytes, mediaType: result.mediaType }
    } catch {
      return null
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- tests/adapters/tauri-image-store.test.ts` → PASS (5 tests)
Run: `npm run check:boundaries` → clean

- [ ] **Step 5: Commit**

```bash
git add src/adapters/filesystem/tauri-image-store.ts tests/adapters/tauri-image-store.test.ts
git commit -m "feat(adapters): native transport for storing and reading note images"
```

---

### Task 7: Rewriting pasted image sources

**Files:**
- Create: `src/adapters/editor/image-capture.ts`
- Test: `tests/adapters/image-capture.test.ts` (create)

**Interfaces:**
- Consumes: `NoteImageStore` (Task 4), `isRemoteImageSource` (Task 1)
- Produces:
  ```ts
  function remoteImageSources(fragment: Fragment): string[]
  function captureRemoteImages(view: EditorView, store: NoteImageStore, sources: readonly string[]): Promise<void>
  ```

Tests use a real ProseMirror schema and `EditorState` — no browser needed, so this runs under vitest's node environment like the other adapter tests.

- [ ] **Step 1: Write the failing test**

```ts
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import { describe, expect, it } from 'vitest'

import { captureRemoteImages, remoteImageSources } from '../../src/adapters/editor/image-capture.js'

/**
 * The rewrite finds its image by `src`, not by a remembered position: a
 * download that lands after the person has typed, reordered blocks or accepted
 * a trim must still find the picture it fetched, and one whose picture is gone
 * must do nothing at all.
 */
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    image: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { src: { default: '' }, alt: { default: '' } },
      toDOM: (node) => ['img', node.attrs],
    },
    text: { group: 'inline' },
  },
})

function documentWith(...sources: string[]) {
  const images = sources.map((src) => schema.nodes['image']!.create({ src, alt: 'a' }))
  return schema.nodes['doc']!.create(null, schema.nodes['paragraph']!.create(null, images))
}

/** A minimal stand-in for the parts of EditorView this module touches. */
function viewFor(doc: ReturnType<typeof documentWith>) {
  let state = EditorState.create({ schema, doc })
  return {
    get state() {
      return state
    },
    dispatch(tr: ReturnType<typeof state.tr.setMeta>) {
      state = state.apply(tr as never)
    },
    historyFlags: [] as unknown[],
  }
}

function sourcesIn(view: ReturnType<typeof viewFor>): string[] {
  const found: string[] = []
  view.state.doc.descendants((node) => {
    if (node.type.name === 'image') found.push(String(node.attrs['src']))
    return true
  })
  return found
}

describe('remoteImageSources', () => {
  it('collects each remote source once, ignoring local ones', () => {
    const doc = documentWith(
      'https://example.com/a.png',
      'https://example.com/a.png',
      'assets/b.png',
      'data:image/png;base64,AAAA',
    )
    expect(remoteImageSources(doc.content)).toEqual(['https://example.com/a.png'])
  })
})

describe('captureRemoteImages', () => {
  it('rewrites every node carrying the source it downloaded', async () => {
    const view = viewFor(documentWith('https://example.com/a.png', 'https://example.com/a.png'))
    const store = { store: async () => ({ src: 'assets/hash.png' }), read: async () => null }

    await captureRemoteImages(view as never, store, ['https://example.com/a.png'])

    expect(sourcesIn(view)).toEqual(['assets/hash.png', 'assets/hash.png'])
  })

  it('keeps the remote url when the store declines', async () => {
    const view = viewFor(documentWith('https://example.com/a.png'))
    const store = { store: async () => null, read: async () => null }

    await captureRemoteImages(view as never, store, ['https://example.com/a.png'])

    expect(sourcesIn(view)).toEqual(['https://example.com/a.png'])
  })

  it('keeps the remote url when the store throws', async () => {
    const view = viewFor(documentWith('https://example.com/a.png'))
    const store = {
      store: async () => {
        throw new Error('offline')
      },
      read: async () => null,
    }

    await expect(
      captureRemoteImages(view as never, store, ['https://example.com/a.png']),
    ).resolves.toBeUndefined()
    expect(sourcesIn(view)).toEqual(['https://example.com/a.png'])
  })

  it('does nothing when the image is gone by the time the download lands', async () => {
    const view = viewFor(documentWith('assets/already-local.png'))
    const store = { store: async () => ({ src: 'assets/hash.png' }), read: async () => null }

    await captureRemoteImages(view as never, store, ['https://example.com/gone.png'])

    expect(sourcesIn(view)).toEqual(['assets/already-local.png'])
  })

  it('rewrites outside undo history so one undo lands on the faithful paste', async () => {
    const view = viewFor(documentWith('https://example.com/a.png'))
    const seen: unknown[] = []
    const recording = {
      get state() {
        return view.state
      },
      dispatch(tr: { getMeta(key: string): unknown }) {
        seen.push(tr.getMeta('addToHistory'))
        view.dispatch(tr as never)
      },
    }
    const store = { store: async () => ({ src: 'assets/hash.png' }), read: async () => null }

    await captureRemoteImages(recording as never, store, ['https://example.com/a.png'])

    expect(seen).toEqual([false])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/adapters/image-capture.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import type { Fragment } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'

import type { NoteImageStore } from '../../application/index.js'
import { isRemoteImageSource } from '../../domain/index.js'

/** Enough parallelism for a picture-heavy article, few enough to stay polite. */
const MAX_CONCURRENT_DOWNLOADS = 4

/** Every distinct remote image source in freshly pasted content. */
export function remoteImageSources(fragment: Fragment): string[] {
  const found = new Set<string>()
  fragment.descendants((node) => {
    if (node.type.name === 'image') {
      const src = String(node.attrs['src'] ?? '')
      if (isRemoteImageSource(src)) found.add(src)
    }
    return true
  })
  return [...found]
}

/**
 * Points every node that carries `from` at `to`, in one transaction, outside
 * undo history.
 *
 * By source rather than by position: the download lands a network round-trip
 * after the paste, by which time the person may have typed, reordered blocks,
 * or accepted a trim. `find.ts` records the same reasoning for recomputing
 * rather than remapping — an edit can destroy a target, not just move it.
 *
 * The rewrite is not a user edit, so `addToHistory: false` keeps ⌘Z landing on
 * the faithful paste instead of walking back through one image at a time.
 */
function rewriteSource(view: EditorView, from: string, to: string): void {
  const positions: number[] = []
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && String(node.attrs['src'] ?? '') === from) positions.push(pos)
    return true
  })
  if (positions.length === 0) return

  const tr = view.state.tr
  for (const pos of positions) {
    const node = view.state.doc.nodeAt(pos)
    if (node === null) continue
    // An attribute change keeps the node's size, so earlier positions stay
    // valid for the later ones in the same transaction.
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: to })
  }
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}

/**
 * Downloads each pasted remote image and points the document at the local copy.
 *
 * Never rejects and never reports a failure into the document: an image that
 * could not be stored keeps the remote URL it arrived with, which is visible
 * and unchanged rather than lost (§4.4).
 */
export async function captureRemoteImages(
  view: EditorView,
  store: NoteImageStore,
  sources: readonly string[],
): Promise<void> {
  const queue = [...sources]
  const worker = async (): Promise<void> => {
    for (;;) {
      const source = queue.shift()
      if (source === undefined) return
      try {
        const stored = await store.store(source)
        if (stored !== null) rewriteSource(view, source, stored.src)
      } catch {
        // Keep the remote URL.
      }
    }
  }
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT_DOWNLOADS, queue.length) }, worker)
  await Promise.all(workers)
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- tests/adapters/image-capture.test.ts` → PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/adapters/editor/image-capture.ts tests/adapters/image-capture.test.ts
git commit -m "feat(editor): rewrite pasted image sources to local copies by source"
```

---

### Task 8: Rendering a note-relative image

**Files:**
- Modify: `src/adapters/editor/asset-image-node-view.ts`
- Test: `tests/adapters/asset-image-node-view.test.ts` (create)

**Interfaces:**
- Consumes: `NoteImageStore` (Task 4)
- Produces: `new AssetImageNodeView(node, view, getPos, store?)` — a fourth optional constructor parameter

**`jsdom` is not installed and must not be added** (no new dependencies). vitest runs in `node`, so this test supplies a minimal fake `document`, `Blob` and `URL` through `vi.stubGlobal`. That is enough: this NodeView touches only `createElement`, `append`, `classList`, `addEventListener`, and a handful of properties. Build the fake in the test file — roughly the shape below — and keep it there rather than in a shared helper, so nothing else inherits a fake DOM by accident.

```ts
function fakeElement(tag: string) {
  const element: Record<string, unknown> = {
    tagName: tag.toUpperCase(),
    children: [] as unknown[],
    className: '',
    textContent: '',
    hidden: false,
    style: {},
    classList: { toggle: () => {} },
    setAttribute(name: string, value: string) {
      element[name] = value
    },
    getAttribute(name: string) {
      return element[name] ?? null
    },
    addEventListener: () => {},
    append(...nodes: unknown[]) {
      ;(element['children'] as unknown[]).push(...nodes)
    },
    querySelector(selector: string) {
      const wanted = selector.toLowerCase()
      const walk = (node: Record<string, unknown>): unknown => {
        for (const child of (node['children'] as Record<string, unknown>[]) ?? []) {
          if (String(child['tagName']).toLowerCase() === wanted) return child
          const found = walk(child)
          if (found !== undefined) return found
        }
        return undefined
      }
      return walk(element) ?? null
    },
  }
  return element
}
```

Stub `document` as `{ createElement: (tag: string) => fakeElement(tag) }`, and read the rendered source with `nodeView.dom.querySelector('img')?.src` rather than `getAttribute('src')`, since the NodeView assigns the property. `Blob` exists natively in Node 20; only `URL.createObjectURL` / `revokeObjectURL` need stubbing.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'

import { AssetImageNodeView } from '../../src/adapters/editor/asset-image-node-view.js'

/**
 * There is no working relative-image path in the packaged app: its policy
 * admits `'self' data: blob: asset:` and nothing registers `asset:`. So a
 * note-relative reference renders by reading bytes through the port and
 * showing them as a `blob:` URL. Everything else keeps today's behaviour.
 */
function nodeWith(src: string) {
  return { type: { name: 'image' }, attrs: { src, alt: 'alt text' } } as never
}
const view = { state: { tr: {} }, dispatch: () => {} } as never

describe('AssetImageNodeView', () => {
  it('assigns a remote source directly, without touching the store', () => {
    const store = { store: vi.fn(), read: vi.fn() }
    const nodeView = new AssetImageNodeView(nodeWith('https://example.com/a.png'), view, () => 0, store)
    expect(nodeView.dom.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png')
    expect(store.read).not.toHaveBeenCalled()
  })

  it('assigns a relative source directly when no store is composed', () => {
    const nodeView = new AssetImageNodeView(nodeWith('assets/a.png'), view, () => 0)
    expect(nodeView.dom.querySelector('img')?.getAttribute('src')).toBe('assets/a.png')
  })

  it('renders a relative source through the store as a blob url', async () => {
    const created: Blob[] = []
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        created.push(blob)
        return 'blob:stub'
      },
      revokeObjectURL: () => {},
    })
    const store = {
      store: vi.fn(),
      read: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png' })),
    }

    const nodeView = new AssetImageNodeView(nodeWith('assets/a.png'), view, () => 0, store)
    await vi.waitFor(() => expect(nodeView.dom.querySelector('img')?.getAttribute('src')).toBe('blob:stub'))

    expect(store.read).toHaveBeenCalledWith('assets/a.png')
    expect(created[0]?.type).toBe('image/png')
    vi.unstubAllGlobals()
  })

  it('falls back to the plain reference when the store has no bytes, so the miss stays visible', async () => {
    const store = { store: vi.fn(), read: vi.fn(async () => null) }
    const nodeView = new AssetImageNodeView(nodeWith('assets/missing.png'), view, () => 0, store)
    await vi.waitFor(() =>
      expect(nodeView.dom.querySelector('img')?.getAttribute('src')).toBe('assets/missing.png'),
    )
    expect(nodeView.dom.textContent).toContain('File unavailable: assets/missing.png')
  })

  it('revokes the blob url it created when the node view is destroyed', async () => {
    const revoked: string[] = []
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:stub',
      revokeObjectURL: (url: string) => revoked.push(url),
    })
    const store = {
      store: vi.fn(),
      read: vi.fn(async () => ({ bytes: new Uint8Array([1]), mediaType: 'image/png' })),
    }

    const nodeView = new AssetImageNodeView(nodeWith('assets/a.png'), view, () => 0, store)
    await vi.waitFor(() => expect(nodeView.dom.querySelector('img')?.getAttribute('src')).toBe('blob:stub'))
    nodeView.destroy?.()

    expect(revoked).toEqual(['blob:stub'])
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/adapters/asset-image-node-view.test.ts`
Expected: FAIL — the constructor takes three parameters and never calls a store.

- [ ] **Step 3: Write the implementation**

Modify `src/adapters/editor/asset-image-node-view.ts`:

- Import `type { NoteImageStore } from '../../application/index.js'` and `isRemoteImageSource` from `'../../domain/index.js'`.
- Add a fourth optional constructor parameter `private readonly store?: NoteImageStore`.
- Add two private fields: `#objectUrl: string | null = null` and `#loadToken = 0`.
- Replace `#paint()` with the three-branch resolution, and add `#releaseObjectUrl()` plus a `destroy()`:

```ts
  #paint(): void {
    const src = String(this.#node.attrs['src'] ?? '')
    const alt = String(this.#node.attrs['alt'] ?? '')
    this.#image.alt = alt
    this.#image.title = alt
    this.#fallback.textContent = `File unavailable: ${src}`
    this.#resolve(src)
  }

  /**
   * Three ways an image source becomes something the window will load.
   *
   * A remote or already-inline source is assigned as-is. A note-relative one
   * is assigned as-is too when no store is composed — that is the browser
   * shell, where the dev server resolves it and a miss shows the named
   * fallback. With a store, the bytes come back through the audited command
   * and render as a `blob:` URL, which the packaged app's policy admits and
   * a bare relative path does not (ADR-0008).
   */
  #resolve(src: string): void {
    this.#releaseObjectUrl()
    const token = (this.#loadToken += 1)

    if (this.store === undefined || src === '' || isRemoteImageSource(src) || /^[a-z][a-z0-9+.-]*:/i.test(src)) {
      this.#image.src = src
      return
    }

    void this.store
      .read(src)
      .then((loaded) => {
        if (token !== this.#loadToken) return
        if (loaded === null) {
          // Fall back to the plain reference: a miss must stay visible (§4.4).
          this.#image.src = src
          return
        }
        const url = URL.createObjectURL(new Blob([loaded.bytes], { type: loaded.mediaType }))
        this.#objectUrl = url
        this.#image.src = url
      })
      .catch(() => {
        if (token !== this.#loadToken) return
        this.#image.src = src
      })
  }

  #releaseObjectUrl(): void {
    if (this.#objectUrl === null) return
    URL.revokeObjectURL(this.#objectUrl)
    this.#objectUrl = null
  }

  destroy(): void {
    this.#loadToken += 1
    this.#releaseObjectUrl()
  }
```

`update()` already calls `#paint()`, which now releases the previous object URL before resolving the new source.

- [ ] **Step 4: Run tests**

Run: `npm run test -- tests/adapters/asset-image-node-view.test.ts` → PASS (5 tests)
Run: `npm run test` → the whole vitest suite still green

- [ ] **Step 5: Commit**

```bash
git add src/adapters/editor/asset-image-node-view.ts tests/adapters/asset-image-node-view.test.ts
git commit -m "feat(editor): render note-relative images through the store as blob urls"
```

---

### Task 9: Trimming a pasted page

**Files:**
- Create: `src/adapters/editor/page-trim.ts`
- Test: `tests/ui/page-trim.spec.ts` (create)

**Interfaces:**
- Consumes: `analysePastedPage`, `PageNode`, `readPasteProvenance`, `provenanceHtml` (Tasks 2–3)
- Produces:
  ```ts
  function looksLikeFullPagePaste(html: string): boolean
  function extractArticleHtml(html: string): string | null
  ```

This one needs a **real** DOM — `DOMParser`, `querySelectorAll`, `remove()` — which is too much to fake and `jsdom` is not available. So its unit tests run in Playwright against the Vite dev server, which serves the TypeScript source directly, letting a browser import the module under test:

```ts
const trim = async (page: import('@playwright/test').Page, html: string) =>
  page.evaluate(async (source) => {
    const module = await import('/src/adapters/editor/page-trim.ts')
    return {
      isFullPage: module.looksLikeFullPagePaste(source),
      article: module.extractArticleHtml(source),
    }
  }, html)
```

Put these in `tests/ui/page-trim.spec.ts` with the same `beforeEach` as the other UI specs. If the dynamic import does not resolve, do not fight it: delete that spec and rely on Task 12's end-to-end coverage, which exercises the same code through a real paste — say so in the commit message rather than leaving a silently thinner suite.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from '@playwright/test'

/**
 * The DOM half of article extraction, exercised in the browser that actually
 * runs it. The judgement it delegates to is unit-tested in
 * `tests/domain/paste-page-analysis.test.ts`; what these prove is the mirror
 * into `PageNode`s and the application of the answer back to the tree.
 */
const trim = async (page: import('@playwright/test').Page, html: string) =>
  page.evaluate(async (source) => {
    const module = await import('/src/adapters/editor/page-trim.ts')
    return {
      isFullPage: module.looksLikeFullPagePaste(source),
      article: module.extractArticleHtml(source),
    }
  }, html)

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
})

const PROSE = 'This is a real paragraph of article prose. '.repeat(12)

const FULL_PAGE = `
  <html><head><title>Gemini is Cooked</title></head><body>
    <nav><a href="/">Home</a><a href="/archive">Archive</a><a href="/about">About</a></nav>
    <div class="subscribe"><button>Subscribe</button></div>
    <article>
      <h1>Gemini is Cooked</h1>
      <p>${PROSE}</p>
      <figure><img src="https://cdn.example/chart.png" alt="A chart"></figure>
      <table><tr><td>TPU</td><td>v7</td></tr></table>
      <p>${PROSE}<sup><a href="#fn-1">1</a></sup></p>
      <div class="share"><a href="#">Share</a><a href="#">Comment</a><a href="#">Restack</a></div>
    </article>
    <footer><a href="/terms">Terms</a><a href="/privacy">Privacy</a></footer>
  </body></html>`

test('recognises a page wrapped around an article', async ({ page }) => {
  expect((await trim(page, FULL_PAGE)).isFullPage).toBe(true)
})

test('leaves an ordinary rich paste alone', async ({ page }) => {
  const ordinary = `<div><p>${PROSE}</p><p>A second paragraph.</p></div>`
  expect((await trim(page, ordinary)).isFullPage).toBe(false)
})

test('does not throw on malformed input', async ({ page }) => {
  expect((await trim(page, '<div><p>unclosed')).isFullPage).toBe(false)
  expect((await trim(page, '')).isFullPage).toBe(false)
})

test('keeps the article and drops the page furniture', async ({ page }) => {
  const { article } = await trim(page, FULL_PAGE)
  expect(article).toContain('Gemini is Cooked')
  expect(article).toContain('<img')
  expect(article).toContain('<table')
  expect(article).not.toContain('Archive')
  expect(article).not.toContain('Subscribe')
  expect(article).not.toContain('Restack')
  expect(article).not.toContain('Privacy')
})

test('drops a footnote marker whose definition did not come along', async ({ page }) => {
  expect((await trim(page, FULL_PAGE)).article).not.toContain('#fn-1')
})

test('prepends the source line when the clipboard names one', async ({ page }) => {
  const { article } = await trim(page, `SourceURL:https://example.com/post\n${FULL_PAGE}`)
  expect(article).toContain(
    '<blockquote><p>Source: <a href="https://example.com/post">Gemini is Cooked</a></p></blockquote>',
  )
})

test('omits the source line when the clipboard does not name one', async ({ page }) => {
  expect((await trim(page, FULL_PAGE)).article).not.toContain('Source:')
})

test('returns null when there is nothing to trim', async ({ page }) => {
  expect((await trim(page, `<div><p>${PROSE}</p></div>`)).article).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `SIMPLEMARK_TEST_PORT=5487 npx playwright test tests/ui/page-trim.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { analysePastedPage, provenanceHtml, readPasteProvenance, type PageNode } from '../../domain/index.js'

/**
 * The DOM half of DESIGN.md §4.2's "whole web page wrapped around an article"
 * ruling. It mirrors the parsed clipboard into DOM-free `PageNode`s, asks the
 * domain what to keep, and applies the answer back to the real tree.
 *
 * No extraction library: the rules are a pure function the `node` test
 * environment can exercise with plain fixtures, and they only ever remove what
 * the heuristic is confident about.
 */

interface MirroredPage {
  readonly root: PageNode
  readonly elements: ReadonlyMap<number, Element>
}

function mirror(document: Document): MirroredPage | null {
  const body = document.body as Element | null
  if (body === null) return null

  const elements = new Map<number, Element>()
  let nextId = 0

  const build = (element: Element): PageNode => {
    const id = (nextId += 1)
    elements.set(id, element)
    const children = [...element.children].map(build)
    const tag = element.tagName.toLowerCase()
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
    const linkText =
      tag === 'a'
        ? text
        : [...element.querySelectorAll('a')]
            .map((anchor) => (anchor.textContent ?? '').replace(/\s+/g, ' ').trim())
            .join(' ')
    const role = element.getAttribute('role') ?? undefined
    const domId = element.getAttribute('id') ?? undefined
    const href = element.getAttribute('href') ?? undefined
    return {
      id,
      tag,
      text,
      linkText,
      children,
      ...(role === undefined ? {} : { role }),
      ...(domId === undefined ? {} : { domId }),
      ...(href === undefined ? {} : { href }),
    }
  }

  return { root: build(body), elements }
}

function parse(html: string): Document | null {
  try {
    return new window.DOMParser().parseFromString(html, 'text/html')
  } catch {
    return null
  }
}

/** Whether to offer a trim at all. Never throws — a sniffer-adjacent rule. */
export function looksLikeFullPagePaste(html: string): boolean {
  try {
    const document = parse(html)
    if (document === null) return false
    const page = mirror(document)
    if (page === null) return false
    return analysePastedPage(page.root).isFullPage
  } catch {
    return false
  }
}

/**
 * The trimmed article, with a source line when the clipboard named one.
 *
 * `null` when there is nothing confident to do, which is also what the caller
 * treats as "leave the faithful paste exactly as it is".
 */
export function extractArticleHtml(html: string): string | null {
  try {
    const document = parse(html)
    if (document === null) return null
    const page = mirror(document)
    if (page === null) return null

    const analysis = analysePastedPage(page.root)
    if (!analysis.isFullPage || analysis.coreId === undefined) return null

    const core = page.elements.get(analysis.coreId)
    if (core === undefined) return null

    for (const id of analysis.pruned) page.elements.get(id)?.remove()

    const provenance = readPasteProvenance(html)
    const article = core.innerHTML.trim()
    if (article === '') return null
    return provenance === null ? article : `${provenanceHtml(provenance)}${article}`
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests**

Run: `SIMPLEMARK_TEST_PORT=5487 npx playwright test tests/ui/page-trim.spec.ts` → PASS (9 tests)
Run: `npm run check:boundaries` → clean

- [ ] **Step 5: Commit**

```bash
git add src/adapters/editor/page-trim.ts tests/ui/page-trim.spec.ts
git commit -m "feat(editor): extract a pasted page's article and source line"
```

---

### Task 10: The trim offer

**Files:**
- Create: `src/adapters/editor/page-trim-offer.ts`
- Modify: `src/app/styles/app.css` (the offer bar's styling)
- Test: covered by Task 12's Playwright spec — this is a decoration widget in a live editor

**Interfaces:**
- Consumes: `extractArticleHtml` (Task 9)
- Produces:
  ```ts
  const pageTrimOfferKey: PluginKey<TrimOfferState>
  function pageTrimOfferPlugin(): Plugin
  function offerPageTrim(tr: Transaction, offer: { from: number; to: number; html: string }): Transaction
  ```

- [ ] **Step 1: Write the implementation**

```ts
import { closeHistory } from '@milkdown/kit/prose/history'
import { DOMParser as ProseDOMParser } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'

import { extractArticleHtml } from './page-trim.js'

/**
 * DESIGN.md §4.2: a pasted web page keeps its faithful shape, and trimming is
 * offered rather than done.
 *
 * This is the first implementation of the §4.3 ruling that an affordance
 * appears in the corner after an insertion. It deliberately does not expire:
 * "a few seconds" fits a two-word choice, not one that needs the article read
 * first. Ignoring it costs nothing — the faithful paste is already there.
 *
 * The offer's range is remapped through every transaction and dropped when it
 * no longer maps, the pattern `folding.ts` uses for positions it does not own.
 */

interface TrimOffer {
  readonly from: number
  readonly to: number
  readonly html: string
}

type TrimOfferState = TrimOffer | null

export const pageTrimOfferKey = new PluginKey<TrimOfferState>('simplemark-page-trim-offer')

interface TrimOfferMeta {
  readonly show?: TrimOffer
  readonly dismiss?: true
}

/** Marks a paste transaction as one worth offering to trim. */
export function offerPageTrim(tr: Transaction, offer: TrimOffer): Transaction {
  return tr.setMeta(pageTrimOfferKey, { show: offer } satisfies TrimOfferMeta)
}

function dismiss(view: EditorView): void {
  view.dispatch(
    view.state.tr.setMeta(pageTrimOfferKey, { dismiss: true } satisfies TrimOfferMeta).setMeta('addToHistory', false),
  )
}

/**
 * Replaces the pasted range with the trimmed article, in one undoable step.
 *
 * `closeHistory` stops prosemirror-history grouping it with the paste, so one
 * ⌘Z restores the faithful, untrimmed paste and a second clears it entirely
 * (§4.3).
 */
function accept(view: EditorView, offer: TrimOffer): void {
  const trimmed = extractArticleHtml(offer.html)
  if (trimmed === null) {
    dismiss(view)
    return
  }

  try {
    const dom = new window.DOMParser().parseFromString(trimmed, 'text/html')
    const slice = ProseDOMParser.fromSchema(view.state.schema).parseSlice(dom.body)
    const from = Math.min(offer.from, view.state.doc.content.size)
    const to = Math.min(offer.to, view.state.doc.content.size)
    const tr = view.state.tr
      .replaceRange(from, to, slice)
      .setMeta(pageTrimOfferKey, { dismiss: true } satisfies TrimOfferMeta)
      .scrollIntoView()
    view.dispatch(closeHistory(tr))
  } catch {
    // A parse that throws must not eat the paste: leave it exactly as it is.
    dismiss(view)
  }
}

function offerBar(view: EditorView, offer: TrimOffer): HTMLElement {
  const bar = document.createElement('div')
  bar.className = 'page-trim-offer'
  bar.contentEditable = 'false'

  const label = document.createElement('span')
  label.className = 'page-trim-offer-label'
  label.textContent = 'Pasted a full page — trim page chrome?'

  const trim = document.createElement('button')
  trim.type = 'button'
  trim.className = 'page-trim-offer-accept'
  trim.textContent = 'Trim'
  trim.addEventListener('mousedown', (event) => event.preventDefault())
  trim.addEventListener('click', (event) => {
    event.preventDefault()
    accept(view, offer)
  })

  const later = document.createElement('button')
  later.type = 'button'
  later.className = 'page-trim-offer-dismiss'
  later.textContent = 'Dismiss'
  later.addEventListener('mousedown', (event) => event.preventDefault())
  later.addEventListener('click', (event) => {
    event.preventDefault()
    dismiss(view)
  })

  bar.append(label, trim, later)
  return bar
}

export function pageTrimOfferPlugin(): Plugin {
  return new Plugin<TrimOfferState>({
    key: pageTrimOfferKey,
    state: {
      init: () => null,
      apply: (tr, value) => {
        const meta = tr.getMeta(pageTrimOfferKey) as TrimOfferMeta | undefined
        if (meta?.dismiss === true) return null
        if (meta?.show !== undefined) return meta.show
        if (value === null) return null
        const from = tr.mapping.map(value.from, -1)
        const to = tr.mapping.map(value.to, 1)
        // The pasted range is gone — undone, deleted, or replaced.
        return to <= from ? null : { ...value, from, to }
      },
    },
    props: {
      decorations: (state) => {
        const offer = pageTrimOfferKey.getState(state)
        if (offer === null || offer === undefined) return DecorationSet.empty
        return DecorationSet.create(state.doc, [
          Decoration.widget(offer.from, (view) => offerBar(view, offer), {
            side: -1,
            key: 'page-trim-offer',
            ignoreSelection: true,
            stopEvent: () => true,
          }),
        ])
      },
      handleKeyDown: (view, event) => {
        if (event.key !== 'Escape') return false
        const offer = pageTrimOfferKey.getState(view.state)
        if (offer === null || offer === undefined) return false
        dismiss(view)
        return true
      },
    },
  })
}
```

Add to `src/app/styles/app.css`, following the `.diagram-error-actions` block's conventions:

```css
/* The paste-trim offer (DESIGN.md §4.2). Calm, non-modal, and ignorable:
   the faithful paste is already on the page and costs one ⌘Z. */
.page-trim-offer {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin: 0 0 0.5rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--rule);
  border-radius: 6px;
  background: var(--surface-raised);
  font-size: 0.85rem;
  user-select: none;
}

.page-trim-offer-label {
  flex: 1;
  color: var(--text-muted);
}

.page-trim-offer button {
  padding: 0.2rem 0.6rem;
  border: 1px solid var(--rule);
  border-radius: 5px;
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.page-trim-offer button:hover {
  background: var(--surface-hover);
}
```

Check the real variable names in `app.css` before using them — reuse whatever `.diagram-error` uses for surface, rule and muted text rather than inventing new custom properties.

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck` → clean
Run: `npm run check:boundaries` → clean

- [ ] **Step 3: Commit**

```bash
git add src/adapters/editor/page-trim-offer.ts src/app/styles/app.css
git commit -m "feat(editor): a dismissible offer to trim page chrome from a paste"
```

---

### Task 11: Wire both halves into the paste path

**Files:**
- Modify: `src/adapters/editor/paste-sniffers.ts`, `src/adapters/editor/milkdown-editor.ts`, `src/app/bootstrap.ts`, `src/app/tauri.ts`
- Test: `tests/adapters/paste-sniffer-chain.test.ts` (existing — confirm still green); full coverage lands in Task 12

**Interfaces:**
- Consumes: `captureRemoteImages`, `remoteImageSources` (Task 7); `looksLikeFullPagePaste` (Task 9); `pageTrimOfferPlugin`, `offerPageTrim` (Task 10); `TauriImageStore` (Task 6); `NoteImageStore`, `ImageStorePort` (Task 4)
- Produces: `PasteSnifferOptions.images?: NoteImageStore`, `MilkdownEditorOptions.images?: NoteImageStore`, `AppPorts.images?: ImageStorePort`

- [ ] **Step 1: Extend the paste path**

In `src/adapters/editor/paste-sniffers.ts`:

- Add to the imports: `import type { NoteImageStore } from '../../application/index.js'`, `import { captureRemoteImages, remoteImageSources } from './image-capture.js'`, `import { looksLikeFullPagePaste } from './page-trim.js'`, `import { offerPageTrim } from './page-trim-offer.js'`.
- Extend the options interface:

```ts
export interface PasteSnifferOptions {
  readonly renderer: DiagramRenderer
  /** Absent in hosts that cannot keep images beside the note. */
  readonly images?: NoteImageStore
}
```

- Replace the body of `insertHtml` with the version below. The faithful paste is still one transaction; the offer rides on it as metadata, and the downloads start after it lands.

```ts
    const insertHtml = (view: EditorView, html: string): boolean => {
      try {
        const dom = new window.DOMParser().parseFromString(svgToCodeFenceHtml(html), 'text/html')
        dom.body.querySelectorAll('pre > code').forEach((code) => {
          const language = /(?:^|\s)language-(\S+)/.exec(code.className)?.[1]
          if (language !== undefined) code.parentElement?.setAttribute('data-language', language)
        })
        const slice = ProseDOMParser.fromSchema(view.state.schema).parseSlice(dom.body)

        const from = view.state.selection.from
        let tr = view.state.tr.replaceSelection(slice).scrollIntoView()
        // A whole web page keeps its faithful shape and is offered a trim
        // (§4.2). The offer rides on the paste transaction so it appears with
        // the content rather than a frame later.
        if (looksLikeFullPagePaste(html)) {
          tr = offerPageTrim(tr, { from, to: tr.selection.from, html })
        }
        view.dispatch(tr)

        // Pictures follow the paste (ADR-0008). Sources are collected from what
        // was inserted, and each rewrite finds its own node again by src.
        const sources = remoteImageSources(slice.content)
        if (options.images !== undefined && sources.length > 0) {
          void captureRemoteImages(view, options.images, sources)
        }
        return true
      } catch {
        return false
      }
    }
```

In `src/adapters/editor/milkdown-editor.ts`:

- Add `readonly images?: NoteImageStore` to `MilkdownEditorOptions` (import the type from `'../../application/index.js'`).
- Pass it to the sniffer plugin: `.use(pasteSniffers({ renderer: options.renderer, ...(options.images === undefined ? {} : { images: options.images }) }))`.
- Register the offer plugin next to the sniffers: import `pageTrimOfferPlugin` and add `.use($prose(() => pageTrimOfferPlugin()))` — follow the file's existing `$prose` usage for the exact idiom.
- Give the image NodeView the store:

```ts
const imageView = $view(imageSchema.node, () => {
  return (node: ProseNode, view: EditorView, getPos: () => number | undefined) =>
    new AssetImageNodeView(node, view, getPos, options.images)
})
```

In `src/app/bootstrap.ts`:

- Add `readonly images?: ImageStorePort` to `AppPorts` (import the type).
- Bind the handle at call time when constructing the editor, in the same style as the existing `onOpenLink` block:

```ts
    ...(ports.images === undefined ? {} : {
      images: {
        store: (url: string) => ports.images!.store(session.documentHandle(), url),
        read: (href: string) => ports.images!.read(session.documentHandle(), href),
      },
    }),
```

In `src/app/tauri.ts`, compose the adapter alongside the other native ports:

```ts
images: new TauriImageStore((command, args) => invoke(command, args)),
```

Use whatever `invoke` binding the neighbouring ports in that file already use. `src/app/browser.ts` is **not** modified — the browser shell composes no image port and keeps working remote URLs.

- [ ] **Step 2: Verify nothing regressed**

Run: `npm run typecheck` → clean
Run: `npm run check:boundaries` → clean
Run: `npm run test` → all green, still 732 baseline tests plus the new ones

- [ ] **Step 3: Commit**

```bash
git add src/adapters/editor/paste-sniffers.ts src/adapters/editor/milkdown-editor.ts src/app/bootstrap.ts src/app/tauri.ts
git commit -m "feat: capture images and offer a trim on a pasted web page"
```

---

### Task 12: The browser-level proof

**Files:**
- Create: `tests/ui/article-capture.spec.ts`

**Interfaces:**
- Consumes: everything above, through the real editor

Copy `caretAtEnd`, the `beforeEach`, and the `pasteAtEnd` helper from `tests/ui/editor-harness.spec.ts` (lines ~24–33 and ~490–514) rather than importing them — the UI specs are self-contained by convention. **Every assertion is its own `test`**: PR #137 established that chaining reloads or long sequences under one timeout is the flake pattern.

- [ ] **Step 1: Write the spec**

```ts
import { expect, test } from '@playwright/test'

/**
 * ARTICLE-1 — DESIGN.md §4.2's two new rulings, in a real browser.
 *
 * The browser shell composes no image store, so images keep their remote URLs
 * here; that is the graceful decline, and it is asserted rather than assumed.
 * The download path itself is proven natively in `note_images.rs`.
 */
const editor = '.milkdown .ProseMirror'

const PROSE = 'This is a real paragraph of article prose that runs on for a while. '.repeat(6)

const FULL_PAGE = `<html><head><title>Gemini is Cooked</title></head><body>
  <nav><a href="/">Home</a><a href="/archive">Archive</a><a href="/about">About</a></nav>
  <article>
    <h1>Gemini is Cooked</h1>
    <p>${PROSE}</p>
    <table><thead><tr><th>Chip</th><th>Gen</th></tr></thead><tbody><tr><td>TPU</td><td>v7</td></tr></tbody></table>
    <p>${PROSE}</p>
    <div class="share"><a href="#">Share</a><a href="#">Comment</a><a href="#">Restack</a></div>
  </article>
  <footer><a href="/terms">Terms</a><a href="/privacy">Privacy</a></footer>
</body></html>`

const ORDINARY = `<div><p>${PROSE}</p><p>A second <strong>rich</strong> paragraph.</p></div>`

async function caretAtEnd(page: import('@playwright/test').Page) {
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
}

async function pasteAtEnd(page: import('@playwright/test').Page, text: string, html?: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.bringToFront()
  await caretAtEnd(page)
  await page.evaluate(
    async ({ t, h }) => {
      if (h === undefined) {
        await navigator.clipboard.writeText(t)
        return
      }
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([t], { type: 'text/plain' }),
          'text/html': new Blob([h], { type: 'text/html' }),
        }),
      ])
    },
    { t: text, h: html },
  )
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+v')
}

const serialize = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.simplemark!.editor.serialize())

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
})

test('a pasted web page offers to trim its chrome', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', FULL_PAGE)
  await expect(page.locator('.page-trim-offer')).toBeVisible()
})

test('an ordinary rich paste raises no offer', async ({ page }) => {
  await pasteAtEnd(page, 'plain', ORDINARY)
  await expect(page.locator(editor)).toContainText('A second rich paragraph.')
  await expect(page.locator('.page-trim-offer')).toHaveCount(0)
})

test('the faithful paste lands before anything is offered', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', FULL_PAGE)
  const markdown = await serialize(page)
  expect(markdown).toContain('# Gemini is Cooked')
  // Nothing was removed without being asked.
  expect(markdown).toContain('Archive')
})

test('dismissing leaves the faithful paste exactly as it was', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', FULL_PAGE)
  const before = await serialize(page)
  await page.locator('.page-trim-offer-dismiss').click()
  await expect(page.locator('.page-trim-offer')).toHaveCount(0)
  expect(await serialize(page)).toBe(before)
})

test('Escape dismisses the offer', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', FULL_PAGE)
  await page.keyboard.press('Escape')
  await expect(page.locator('.page-trim-offer')).toHaveCount(0)
})

test('trimming removes the page furniture', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', FULL_PAGE)
  await page.locator('.page-trim-offer-accept').click()
  const markdown = await serialize(page)
  expect(markdown).not.toContain('Archive')
  expect(markdown).not.toContain('Restack')
  expect(markdown).not.toContain('Privacy')
})

test('trimming keeps the heading, the prose and the table', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', FULL_PAGE)
  await page.locator('.page-trim-offer-accept').click()
  const markdown = await serialize(page)
  expect(markdown).toContain('# Gemini is Cooked')
  expect(markdown).toContain('| Chip | Gen |')
  expect(markdown).toContain('TPU')
})

test('trimming prepends the source line when the clipboard names one', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', `SourceURL:https://example.com/post\n${FULL_PAGE}`)
  await page.locator('.page-trim-offer-accept').click()
  expect(await serialize(page)).toContain('> Source: [Gemini is Cooked](https://example.com/post)')
})

test('one undo restores the faithful paste after a trim', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', FULL_PAGE)
  const faithful = await serialize(page)
  await page.locator('.page-trim-offer-accept').click()
  expect(await serialize(page)).not.toBe(faithful)

  await caretAtEnd(page)
  await page.keyboard.press('ControlOrMeta+z')
  expect(await serialize(page)).toBe(faithful)
})

test('a remote image survives a paste unchanged where no store is composed', async ({ page }) => {
  await pasteAtEnd(
    page,
    'picture',
    `<div><p>${PROSE}</p><p><img src="https://example.com/chart.png" alt="A chart"></p></div>`,
  )
  expect(await serialize(page)).toContain('![A chart](https://example.com/chart.png)')
})
```

- [ ] **Step 2: Run the spec on a private port**

```bash
SIMPLEMARK_TEST_PORT=5487 npx playwright test tests/ui/article-capture.spec.ts
```

Expected: 10 passing. If a test fails, fix the source — do not add a retry or extend a timeout.

- [ ] **Step 3: Confirm the existing paste rulings still hold**

```bash
SIMPLEMARK_TEST_PORT=5487 npx playwright test tests/ui/editor-harness.spec.ts tests/ui/paste-exhaust.spec.ts tests/ui/paste-document.spec.ts tests/ui/asset-links.spec.ts
```

Expected: all green — BUG-1, the VS Code `<pre>` wrapper, TSV tables, svg fences and the asset-link fallbacks are unchanged.

- [ ] **Step 4: Commit**

```bash
git add tests/ui/article-capture.spec.ts
git commit -m "test(ui): article capture — the trim offer, undo, and image fidelity"
```

---

### Task 13: The gate, the PR, and the merge

**Files:** none — verification and integration only.

- [ ] **Step 1: Run the canonical gate**

```bash
bash scripts/simplemark_ci.sh
```

Never pipe it to `tail` — that masks the exit code. It must end with a zero exit status and `.artifacts/ci-result.json` written. Note the `SIMPLEMARK_TEST_PORT=` line it echoes.

- [ ] **Step 2: Triage any failure honestly**

`platform-smoke-collection` (vitest) and reload-heavy UI specs are documented to fail under load and pass in isolation. Re-run the failing file on its own **and** re-run the full suite before treating it as real. Anything that fails in isolation is a real defect in this branch — fix it, do not re-run it away.

- [ ] **Step 3: Prove the native side**

```bash
npm run test:native
```

The Linux gate does not build the shell, so this result is the evidence for everything in `src-tauri/`.

- [ ] **Step 4: Open the PR**

Fill the template completely: every Evidence and Architecture-check box annotated with real numbers, in the house style — measured counts, not ticks. Leave any box that is genuinely not provable unchecked with the reason, as PR #136 did.

- [ ] **Step 5: Merge through the queue**

```bash
gh pr merge <N> --squash
```

Never `--delete-branch` — it aborts without enqueueing. Then poll until it lands:

```bash
gh pr view <N> --json state
```

If a concurrently merged branch conflicts (a diagram-chrome branch is expected to touch `src/adapters/editor/diagram-node-view.ts` and `tests/ui/editor-harness.spec.ts`), merge `origin/main` into this branch and resolve. In the test file the conflict is append/append: keep both sides.

---

## Self-Review

**Spec coverage.** §2.1 → Task 5 (naming, dedupe). §2.2 → Task 4 (port), Task 6 (adapter). §2.3–2.5 → Task 5. §2.6 → Task 8. §2.7 → Task 7 (src-keyed, `addToHistory: false`, concurrency, failure keeps the URL). §3.1 → Task 10. §3.2–3.4 → Task 2 (domain) and Task 9 (DOM half). §3.5 → Task 3. §3.6 → Task 10's `accept`. §4 → Task 11 (wiring keeps every existing path) and Task 12 (regression proof). §5 → the `DESIGN.md` rows, already committed with the spec. §6 → Tasks 1–3, 5–9, 12. §7 stays out.

**Type consistency.** `NoteImageStore` is what the editor consumes (Tasks 7, 8, 11); `ImageStorePort` is the handle-taking application port (Tasks 4, 6, 11); `bootstrap.ts` is the only place that converts one to the other. `StoredImage.src` and `LoadedImage.{bytes, mediaType}` match the Rust `#[serde(rename_all = "camelCase")]` output in Task 5. `analysePastedPage` returns `{ isFullPage, coreId?, pruned }` in Task 2 and is consumed with exactly those names in Task 9. `provenanceHtml` (not `provenanceLine`) is the name in Tasks 3 and 9.

**Sequencing.** Tasks 1–4 are independent and can run in parallel. Task 5 depends on nothing in TypeScript. Task 6 needs Tasks 1 and 4. Task 7 needs 1 and 4. Task 8 needs 4. Task 9 needs 2 and 3. Task 10 needs 9. Task 11 needs 6, 7, 8, 10. Task 12 needs 11. Task 13 needs everything.
