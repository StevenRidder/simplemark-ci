# SimpleMark Phase 0–1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the source-preservation document model, then build the vertical slice that takes a folder of Markdown files through paste → render → save → reopen → external edit.

**Architecture:** A pnpm workspace with two packages. `@simplemark/core` is DOM-free TypeScript: vault I/O, source mapping, recognition. `@simplemark/editor` wraps Milkdown/ProseMirror. Phase 0 answers whether Milkdown can preserve untouched source byte-for-byte; every later task depends on that answer, so nothing else starts until Task 4 reports.

**Tech Stack:** TypeScript 5.5+, pnpm workspaces, Vitest, Milkdown 7 (`@milkdown/kit`), remark/mdast, `chokidar` for file watching, `mermaid` 11.

## Global Constraints

- **Node 20+, pnpm 9+, TypeScript strict mode.** No `any` in exported signatures.
- **`@simplemark/core` imports no DOM APIs.** It must run under plain Node. Enforced by test.
- **Fidelity contract (DESIGN.md D7):** untouched blocks re-emit their original byte range verbatim; only edited blocks serialize.
- **Sniffers must validate by parsing and must never throw** (TECH-SPEC.md §3).
- **Atomic writes only:** temp file in the same directory, then `rename()` (DESIGN.md §8).
- **Every renderable block writes a portable Markdown fallback** (DESIGN.md §5).
- **Conventional Commits.** One commit per completed task minimum.
- Test command is `pnpm test`; single file is `pnpm vitest run <path>`.

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` | Workspace root |
| `packages/core/src/vault/paths.ts` | Note id ↔ path resolution |
| `packages/core/src/vault/atomic.ts` | Atomic write, hash, write-loop suppression |
| `packages/core/src/vault/vault.ts` | Scan, read, write, watch |
| `packages/core/src/sourcemap/blocks.ts` | Split Markdown into blocks with byte ranges |
| `packages/core/src/sourcemap/document.ts` | `SourceDocument`: dirty tracking + serialize |
| `packages/core/src/recognition/types.ts` | Shared recognition interfaces |
| `packages/core/src/recognition/mermaid.ts` | L1 Mermaid sniffer |
| `packages/core/src/recognition/pipeline.ts` | Ordered sniffer chain |
| `packages/editor/src/editor.ts` | Milkdown instance + source-preserving bridge |
| `packages/editor/src/nodes/mermaid.ts` | Mermaid node schema + NodeView |
| `spike/fidelity/` | Phase 0 spike harness and fixtures |
| `tests/fixtures/` | The 10 acceptance fixtures |

---

## Task 1: Workspace scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/environment.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `pnpm test` runs Vitest across the workspace; `@simplemark/core` resolves as a package.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/__tests__/environment.test.ts
import { describe, expect, it } from 'vitest'
import { VERSION } from '../index'

describe('workspace', () => {
  it('exports a version string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('runs without a DOM', () => {
    expect(typeof globalThis.document).toBe('undefined')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/__tests__/environment.test.ts`
Expected: FAIL — cannot resolve `../index`.

- [ ] **Step 3: Create the workspace files**

```json
// package.json
{
  "name": "simplemark",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -b"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.14.0"
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
```

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "skipLibCheck": true,
    "types": ["node"]
  }
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/__tests__/*.test.ts'],
  },
})
```

```json
// packages/core/package.json
{
  "name": "@simplemark/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

```json
// packages/core/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

```ts
// packages/core/src/index.ts
export const VERSION = '0.1.0'
```

- [ ] **Step 4: Install and run the test**

Run: `pnpm install && pnpm vitest run packages/core/src/__tests__/environment.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: pnpm workspace scaffold with vitest"
```

---

## Task 2: The 10 acceptance fixtures

**Files:**
- Create: `tests/fixtures/01-switchboard.md` … `tests/fixtures/10-external-edit.md`
- Create: `tests/fixtures/index.ts`
- Test: `packages/core/src/__tests__/fixtures.test.ts`

**Interfaces:**
- Consumes: Task 1's workspace
- Produces: `FIXTURES: Array<{ id: string; path: string; describes: string }>` — every later fidelity test iterates this.

These are the go/no-go acceptance set from `DESIGN.md` §12. They must be real files with real awkwardness, not sanitised samples.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/__tests__/fixtures.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FIXTURES } from '../../../../tests/fixtures/index'

describe('acceptance fixtures', () => {
  it('has all ten', () => {
    expect(FIXTURES).toHaveLength(10)
  })

  it.each(FIXTURES)('$id is non-empty and readable', (f) => {
    const bytes = readFileSync(f.path)
    expect(bytes.byteLength).toBeGreaterThan(0)
  })

  it('fixture 09 contains hard tabs, CRLF and no trailing newline', () => {
    const raw = readFileSync(FIXTURES[8]!.path, 'utf8')
    expect(raw).toContain('\t')
    expect(raw).toContain('\r\n')
    expect(raw.endsWith('\n')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/__tests__/fixtures.test.ts`
Expected: FAIL — cannot resolve the fixtures index.

- [ ] **Step 3: Create the fixture index**

```ts
// tests/fixtures/index.ts
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const at = (name: string) => join(here, name)

export interface Fixture { id: string; path: string; describes: string }

export const FIXTURES: Fixture[] = [
  { id: '01-switchboard',  path: at('01-switchboard.md'),  describes: 'nested tables, inline links in cells, anchors, mixed lists' },
  { id: '02-frontmatter',  path: at('02-frontmatter.md'),  describes: 'YAML front matter with comments and unusual key order' },
  { id: '03-html',         path: at('03-html.md'),         describes: 'embedded <details>, <img>, raw <svg>' },
  { id: '04-lists',        path: at('04-lists.md'),        describes: 'deeply nested, mixed markers -, *, 1., 1)' },
  { id: '05-tables',       path: at('05-tables.md'),       describes: 'ragged padding and alignment rows' },
  { id: '06-refs',         path: at('06-refs.md'),         describes: 'reference-style links and footnotes' },
  { id: '07-fences',       path: at('07-fences.md'),       describes: '~~~ fences, >3 backticks, nested fences' },
  { id: '08-mermaid',      path: at('08-mermaid.md'),      describes: 'fenced mermaid plus a bare pasted diagram' },
  { id: '09-whitespace',   path: at('09-whitespace.md'),   describes: 'hard tabs, CRLF, trailing spaces, no trailing newline' },
  { id: '10-external-edit',path: at('10-external-edit.md'),describes: 'baseline for mid-session external modification' },
]
```

- [ ] **Step 4: Create the fixture files**

Fixture 1 is the real document that motivated the project:

```bash
# from the repo root
cp docs/DESIGN.md tests/fixtures/01-switchboard.md
```

Then author the other nine by hand. Each must contain the awkwardness its `describes` field claims. Example for fixture 05 — note the deliberately ragged padding, which a naive serializer will "fix":

```markdown
# Tables

| Track | What | Verdict |
|:--|---:|:-:|
| A | tmux runtime under our relay | Adopt |
|B|`ports.Agent` contract|Port knowledge|
|   C   |   PR-reaction nudge loop   |   Lift 5 mechanics   |
```

Example for fixture 07 — mixed fence styles that must not be normalised:

````markdown
# Fences

~~~python
print("tilde fence")
~~~

`````markdown
```js
console.log('nested')
```
`````
````

Fixture 09 must be written with explicit bytes so the awkwardness survives your editor:

```bash
printf 'line one\r\n\tindented with a hard tab\r\ntrailing spaces here   \r\nno trailing newline' > tests/fixtures/09-whitespace.md
```

- [ ] **Step 5: Run the test**

Run: `pnpm vitest run packages/core/src/__tests__/fixtures.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures packages/core/src/__tests__/fixtures.test.ts
git commit -m "test: add the ten fidelity acceptance fixtures"
```

---

## Task 3: Block splitter with byte ranges

**Files:**
- Create: `packages/core/src/sourcemap/blocks.ts`
- Test: `packages/core/src/sourcemap/blocks.test.ts`

**Interfaces:**
- Consumes: Task 1
- Produces:
  ```ts
  export interface SourceBlock { index: number; start: number; end: number; text: string; kind: string }
  export function splitBlocks(source: string): SourceBlock[]
  ```
  `start`/`end` are byte offsets into the original string. `source.slice(start, end)` must equal `text`. Task 4 and Task 6 depend on this exactly.

This is the foundation of D7: if blocks do not carry faithful ranges, source preservation is impossible.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/sourcemap/blocks.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FIXTURES } from '../../../../tests/fixtures/index'
import { splitBlocks } from './blocks'

describe('splitBlocks', () => {
  it('ranges reconstruct the source exactly', () => {
    const src = '# Title\n\nA paragraph.\n\n```js\nconst a = 1\n```\n'
    const blocks = splitBlocks(src)
    for (const b of blocks) expect(src.slice(b.start, b.end)).toBe(b.text)
    expect(blocks.map(b => b.text).join('')).toBe(src)
  })

  it('does not split inside a fenced code block', () => {
    const src = '```md\n\n# not a heading\n\n```\n'
    const blocks = splitBlocks(src)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('code')
  })

  it('treats front matter as its own opaque block', () => {
    const src = '---\ntitle: x\n---\n\n# Heading\n'
    const blocks = splitBlocks(src)
    expect(blocks[0]!.kind).toBe('frontmatter')
    expect(blocks[0]!.text).toBe('---\ntitle: x\n---\n')
  })

  it.each(FIXTURES)('$id reconstructs byte-for-byte', (f) => {
    const src = readFileSync(f.path, 'utf8')
    const blocks = splitBlocks(src)
    expect(blocks.map(b => b.text).join('')).toBe(src)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/sourcemap/blocks.test.ts`
Expected: FAIL — cannot resolve `./blocks`.

- [ ] **Step 3: Implement the splitter**

```ts
// packages/core/src/sourcemap/blocks.ts
export interface SourceBlock {
  index: number
  start: number
  end: number
  text: string
  kind: 'frontmatter' | 'code' | 'block'
}

const FENCE = /^(\s*)(`{3,}|~{3,})/

/**
 * Split Markdown into top-level blocks, preserving exact byte ranges.
 * Blocks are separated by blank lines, except inside fenced code, which is
 * always one block regardless of blank lines within it.
 */
export function splitBlocks(source: string): SourceBlock[] {
  const lines = source.split(/(?<=\n)/)   // keep line terminators
  const blocks: SourceBlock[] = []
  let offset = 0
  let buf: string[] = []
  let bufStart = 0
  let kind: SourceBlock['kind'] = 'block'
  let fence: string | null = null

  const flush = () => {
    if (buf.length === 0) return
    const text = buf.join('')
    blocks.push({ index: blocks.length, start: bufStart, end: bufStart + text.length, text, kind })
    buf = []
    kind = 'block'
  }

  // front matter must be the very first thing
  let i = 0
  if (lines[0]?.replace(/\r?\n$/, '') === '---') {
    let end = -1
    for (let j = 1; j < lines.length; j++) {
      if (lines[j]?.replace(/\r?\n$/, '') === '---') { end = j; break }
    }
    if (end > 0) {
      const text = lines.slice(0, end + 1).join('')
      blocks.push({ index: 0, start: 0, end: text.length, text, kind: 'frontmatter' })
      offset = text.length
      i = end + 1
    }
  }

  bufStart = offset
  for (; i < lines.length; i++) {
    const line = lines[i]!
    const m = FENCE.exec(line)

    if (fence === null && m) {
      flush()
      bufStart = offset
      fence = m[2]!
      kind = 'code'
      buf.push(line)
      offset += line.length
      continue
    }

    if (fence !== null) {
      buf.push(line)
      offset += line.length
      if (m && m[2]!.startsWith(fence)) { fence = null; flush(); bufStart = offset }
      continue
    }

    if (line.trim() === '') {
      buf.push(line)
      offset += line.length
      flush()
      bufStart = offset
      continue
    }

    buf.push(line)
    offset += line.length
  }

  flush()
  return blocks.map((b, index) => ({ ...b, index }))
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/core/src/sourcemap/blocks.test.ts`
Expected: PASS, 13 tests. If a fixture fails reconstruction, the splitter is wrong — fix it here, not downstream.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sourcemap/
git commit -m "feat(sourcemap): split markdown into blocks with exact byte ranges"
```

---

## Task 4: THE GATE — Milkdown fidelity spike

**Files:**
- Create: `spike/fidelity/package.json`, `spike/fidelity/roundtrip.ts`
- Create: `spike/fidelity/RESULT.md`
- Test: `spike/fidelity/roundtrip.test.ts`

**Interfaces:**
- Consumes: `FIXTURES` (Task 2)
- Produces: a written go/no-go verdict in `RESULT.md`. **No subsequent task may start until this is committed.**

This answers `DESIGN.md` §12: can Milkdown be made to satisfy D7, or does the document model need to be built directly on ProseMirror with a source map?

- [ ] **Step 1: Write the failing test**

```ts
// spike/fidelity/roundtrip.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FIXTURES } from '../../tests/fixtures/index'
import { roundTrip } from './roundtrip'

describe('milkdown fidelity — untouched save', () => {
  it.each(FIXTURES)('$id survives parse → serialize byte-for-byte', async (f) => {
    const src = readFileSync(f.path, 'utf8')
    const out = await roundTrip(src)
    expect(out).toBe(src)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run spike/fidelity/roundtrip.test.ts`
Expected: FAIL — cannot resolve `./roundtrip`.

- [ ] **Step 3: Implement the harness**

```ts
// spike/fidelity/roundtrip.ts
import { Editor, editorViewCtx, serializerCtx, defaultValueCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'

/**
 * Parse Markdown through Milkdown and serialize it straight back out,
 * with no editing in between. Any difference is normalization damage.
 */
export async function roundTrip(source: string): Promise<string> {
  const editor = await Editor.make()
    .config((ctx) => { ctx.set(defaultValueCtx, source) })
    .use(commonmark)
    .use(gfm)
    .create()

  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const serializer = ctx.get(serializerCtx)
    return serializer(view.state.doc)
  })
}
```

Milkdown needs a DOM, so this spike runs under jsdom. Add to `spike/fidelity/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'jsdom', include: ['**/*.test.ts'] } })
```

Install: `pnpm add -D @milkdown/kit jsdom --filter ./spike/fidelity`

- [ ] **Step 4: Run it and record what actually happens**

Run: `pnpm vitest run spike/fidelity/roundtrip.test.ts --reporter=verbose`

Expect **most fixtures to fail.** That is the point — this measures the gap. For each failure, capture the first differing line and classify the damage: bullet marker changed, table repadded, fence style changed, escaping added, blank lines collapsed, front matter reordered, HTML mangled.

- [ ] **Step 5: Write the verdict**

```markdown
<!-- spike/fidelity/RESULT.md -->
# Fidelity spike result

**Date:** <date>
**Milkdown version:** <version>

## Raw round-trip (no source preservation)

| Fixture | Byte-identical | Damage observed |
|---|---|---|
| 01-switchboard | ❌ | table repadding, `-` → `*` bullets |
| … | | |

## With block-level source preservation

Re-run using `splitBlocks` (Task 3): re-emit clean blocks verbatim, serialize only dirty ones.

| Fixture | Byte-identical | Notes |
|---|---|---|

## Verdict

- [ ] **PASS** — Milkdown + block-level preservation satisfies D7. Proceed with D3 as written.
- [ ] **FAIL** — build the document model on ProseMirror with an explicit source map. Fixtures carry over unchanged; add an estimate.

## Evidence
<paste actual diffs here>
```

- [ ] **Step 6: Extend the harness with preservation and re-run**

```ts
// spike/fidelity/roundtrip.ts — add
import { splitBlocks } from '../../packages/core/src/sourcemap/blocks'

/**
 * Preserving round-trip: only blocks whose index is in `dirty` are
 * re-serialized; everything else re-emits its original source slice.
 */
export async function roundTripPreserving(source: string, dirty: Set<number>): Promise<string> {
  const blocks = splitBlocks(source)
  const out: string[] = []
  for (const b of blocks) {
    if (!dirty.has(b.index)) { out.push(b.text); continue }
    out.push(await roundTrip(b.text))
  }
  return out.join('')
}
```

```ts
// spike/fidelity/roundtrip.test.ts — add
describe('block-preserving save', () => {
  it.each(FIXTURES)('$id is untouched when nothing is dirty', async (f) => {
    const src = readFileSync(f.path, 'utf8')
    expect(await roundTripPreserving(src, new Set())).toBe(src)
  })

  it.each(FIXTURES)('$id: editing block 0 leaves every other block byte-identical', async (f) => {
    const src = readFileSync(f.path, 'utf8')
    const out = await roundTripPreserving(src, new Set([0]))
    const before = splitBlocks(src).slice(1).map(b => b.text).join('')
    const after = splitBlocks(out).slice(1).map(b => b.text).join('')
    expect(after).toBe(before)
  })
})
```

Run: `pnpm vitest run spike/fidelity/roundtrip.test.ts`
Expected: the preserving tests PASS for all 10 fixtures. If they do not, the splitter or the preservation strategy is wrong and D3 fails.

- [ ] **Step 7: Commit the verdict**

```bash
git add spike/
git commit -m "spike: milkdown fidelity gate — record verdict against 10 fixtures"
```

**STOP HERE. Report the verdict before continuing.** If FAIL, Tasks 5+ still apply but `packages/editor` is built on raw ProseMirror instead of Milkdown; the plan is revised before proceeding.

---

## Task 5: Atomic writes and write-loop suppression

**Files:**
- Create: `packages/core/src/vault/atomic.ts`
- Test: `packages/core/src/vault/atomic.test.ts`

**Interfaces:**
- Consumes: Task 1
- Produces:
  ```ts
  export function hashContent(text: string): string
  export async function atomicWrite(path: string, text: string): Promise<string>  // returns hash
  export class WriteLedger {
    record(path: string, hash: string): void
    isOwnWrite(path: string, hash: string): boolean
  }
  ```
  Task 6 uses all three.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/vault/atomic.test.ts
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WriteLedger, atomicWrite, hashContent } from './atomic'

const tmp = () => mkdtempSync(join(tmpdir(), 'sm-'))

describe('atomicWrite', () => {
  it('writes the content and leaves no temp file behind', async () => {
    const dir = tmp()
    const p = join(dir, 'note.md')
    await atomicWrite(p, '# hello\n')
    expect(readFileSync(p, 'utf8')).toBe('# hello\n')
    expect(readdirSync(dir)).toEqual(['note.md'])
  })

  it('overwrites an existing file', async () => {
    const dir = tmp()
    const p = join(dir, 'note.md')
    writeFileSync(p, 'old')
    await atomicWrite(p, 'new')
    expect(readFileSync(p, 'utf8')).toBe('new')
  })

  it('returns the content hash', async () => {
    const dir = tmp()
    const h = await atomicWrite(join(dir, 'n.md'), 'abc')
    expect(h).toBe(hashContent('abc'))
  })
})

describe('WriteLedger', () => {
  it('recognises our own write and forgets it after one check', () => {
    const led = new WriteLedger()
    led.record('/a.md', hashContent('x'))
    expect(led.isOwnWrite('/a.md', hashContent('x'))).toBe(true)
    expect(led.isOwnWrite('/a.md', hashContent('x'))).toBe(false)
  })

  it('does not claim a foreign write', () => {
    const led = new WriteLedger()
    led.record('/a.md', hashContent('x'))
    expect(led.isOwnWrite('/a.md', hashContent('y'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/vault/atomic.test.ts`
Expected: FAIL — cannot resolve `./atomic`.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/vault/atomic.ts
import { createHash } from 'node:crypto'
import { open, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export function hashContent(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32)
}

/** Write via a sibling temp file + rename, so a partial file is never observable. */
export async function atomicWrite(path: string, text: string): Promise<string> {
  const tmpPath = join(dirname(path), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
  const handle = await open(tmpPath, 'w')
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(tmpPath, path)
  } catch (err) {
    await unlink(tmpPath).catch(() => {})
    throw err
  }
  return hashContent(text)
}

/**
 * Remembers hashes we just wrote so the file watcher can ignore our own
 * saves. Entries are consumed on first match — a second identical change
 * really is external.
 */
export class WriteLedger {
  private readonly pending = new Map<string, string[]>()

  record(path: string, hash: string): void {
    const list = this.pending.get(path) ?? []
    list.push(hash)
    this.pending.set(path, list)
  }

  isOwnWrite(path: string, hash: string): boolean {
    const list = this.pending.get(path)
    if (!list) return false
    const i = list.indexOf(hash)
    if (i === -1) return false
    list.splice(i, 1)
    if (list.length === 0) this.pending.delete(path)
    return true
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/core/src/vault/atomic.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/vault/
git commit -m "feat(vault): atomic writes and write-loop suppression"
```

---

## Task 6: Vault — scan, read, write, watch

**Files:**
- Create: `packages/core/src/vault/vault.ts`
- Test: `packages/core/src/vault/vault.test.ts`

**Interfaces:**
- Consumes: `atomicWrite`, `hashContent`, `WriteLedger` (Task 5)
- Produces:
  ```ts
  export interface NoteRef { id: string; path: string; title: string; rev: string; mtimeMs: number }
  export type VaultEvent =
    | { type: 'external-change'; path: string; rev: string }
    | { type: 'added'; path: string }
    | { type: 'removed'; path: string }
  export class Vault {
    constructor(root: string)
    scan(): Promise<NoteRef[]>
    read(path: string): Promise<{ content: string; rev: string }>
    write(path: string, text: string, expectedRev?: string): Promise<{ rev: string }>
    watch(onEvent: (e: VaultEvent) => void): () => void
    close(): Promise<void>
  }
  ```

**Why `rev` and stable ids exist now** ([`AGENT-WORKSPACE.md`](../../AGENT-WORKSPACE.md) §7): the MCP server in Phase 6 needs compare-and-swap writes so an agent can never clobber an edit you just made, and `[[wikilinks]]` need ids that survive a rename (`DESIGN.md` §8). Both are a few lines here and would touch every call site if retrofitted. `rev` is `hashContent(content)` — already written in Task 5.

A note's `id` is a ULID stored in front matter, **not** a hash of its path. `scan()` assigns one to any note lacking it and writes it back.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/vault/vault.test.ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { hashContent } from './atomic'
import { Vault } from './vault'

const tmp = () => mkdtempSync(join(tmpdir(), 'sm-vault-'))
const settle = () => new Promise(r => setTimeout(r, 400))

describe('Vault', () => {
  it('scans markdown files and ignores everything else', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'a.md'), '# Alpha\n')
    writeFileSync(join(dir, 'b.md'), '# Beta\n')
    writeFileSync(join(dir, 'notes.txt'), 'ignored')
    const notes = await new Vault(dir).scan()
    expect(notes.map(n => n.title).sort()).toEqual(['Alpha', 'Beta'])
  })

  it('falls back to the filename when there is no heading', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'untitled-note.md'), 'no heading here\n')
    const [note] = await new Vault(dir).scan()
    expect(note!.title).toBe('untitled-note')
  })

  it('assigns a stable id in front matter and preserves it across scans', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'a.md'), '# Alpha\n')
    const vault = new Vault(dir)
    const [first] = await vault.scan()
    const [second] = await vault.scan()
    expect(first!.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)   // ULID
    expect(second!.id).toBe(first!.id)
  })

  it('read returns content and its revision hash', async () => {
    const dir = tmp()
    const p = join(dir, 'a.md')
    writeFileSync(p, '# Alpha\n')
    const vault = new Vault(dir)
    await vault.scan()
    const { content, rev } = await vault.read(p)
    expect(rev).toBe(hashContent(content))
  })

  it('refuses a write whose expectedRev is stale', async () => {
    const dir = tmp()
    const p = join(dir, 'a.md')
    writeFileSync(p, '# Alpha\n')
    const vault = new Vault(dir)
    await expect(vault.write(p, '# Beta\n', 'deadbeef')).rejects.toThrow(/stale/)
    expect((await vault.read(p)).content).toBe('# Alpha\n')
  })

  it('accepts a write with the current rev and returns the new one', async () => {
    const dir = tmp()
    const p = join(dir, 'a.md')
    writeFileSync(p, '# Alpha\n')
    const vault = new Vault(dir)
    const { rev } = await vault.read(p)
    const result = await vault.write(p, '# Beta\n', rev)
    expect(result.rev).toBe(hashContent('# Beta\n'))
  })

  it('does not emit an event for its own write', async () => {
    const dir = tmp()
    const vault = new Vault(dir)
    const onEvent = vi.fn()
    const stop = vault.watch(onEvent)
    await settle()
    await vault.write(join(dir, 'own.md'), '# mine\n')
    await settle()
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'external-change' }))
    stop(); await vault.close()
  })

  it('emits external-change when another process writes', async () => {
    const dir = tmp()
    const p = join(dir, 'ext.md')
    writeFileSync(p, '# one\n')
    const vault = new Vault(dir)
    const onEvent = vi.fn()
    const stop = vault.watch(onEvent)
    await settle()
    writeFileSync(p, '# two\n')
    await settle()
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'external-change', path: p }))
    stop(); await vault.close()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/vault/vault.test.ts`
Expected: FAIL — cannot resolve `./vault`.

- [ ] **Step 3: Implement**

Install: `pnpm add chokidar ulid --filter @simplemark/core`

Note the three additions over a naive vault: `scan()` back-fills a ULID into front matter so ids survive renames, `read()` returns `{ content, rev }`, and `write()` takes an optional `expectedRev` and throws on mismatch. That last one is the compare-and-swap the MCP server depends on.

```ts
// packages/core/src/vault/vault.ts
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { ulid } from 'ulid'
import { WriteLedger, atomicWrite, hashContent } from './atomic'

export interface NoteRef { id: string; path: string; title: string; rev: string; mtimeMs: number }

export type VaultEvent =
  | { type: 'external-change'; path: string; rev: string }
  | { type: 'added'; path: string }
  | { type: 'removed'; path: string }

const TITLE = /^#\s+(.+)$/m
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/
const ID_LINE = /^id:\s*([0-9A-HJKMNP-TV-Z]{26})\s*$/m

export class Vault {
  private readonly ledger = new WriteLedger()
  private watcher: FSWatcher | null = null

  constructor(private readonly root: string) {}

  async scan(): Promise<NoteRef[]> {
    const entries = await readdir(this.root, { withFileTypes: true })
    const notes: NoteRef[] = []
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.md')) continue
      const path = join(this.root, e.name)
      let text = await readFile(path, 'utf8')

      let id = readId(text)
      if (!id) {
        id = ulid()
        text = withId(text, id)
        await this.write(path, text)      // back-fill, suppressed by the ledger
      }

      const st = await stat(path)
      notes.push({
        id,
        path,
        title: TITLE.exec(text)?.[1]?.trim() ?? basename(e.name, '.md'),
        rev: hashContent(text),
        mtimeMs: st.mtimeMs,
      })
    }
    return notes
  }

  async read(path: string): Promise<{ content: string; rev: string }> {
    const content = await readFile(path, 'utf8')
    return { content, rev: hashContent(content) }
  }

  /**
   * Compare-and-swap write. Omit `expectedRev` for a blind write (the app's
   * own save path); pass it for agent writes so a stale patch is refused
   * rather than clobbering a concurrent edit (AGENT-WORKSPACE.md §3).
   */
  async write(path: string, text: string, expectedRev?: string): Promise<{ rev: string }> {
    if (expectedRev !== undefined) {
      const current = await readFile(path, 'utf8').catch(() => null)
      const currentRev = current === null ? null : hashContent(current)
      if (currentRev !== expectedRev) {
        throw new Error(`stale write: expected ${expectedRev}, found ${currentRev ?? 'missing'}`)
      }
    }
    const rev = hashContent(text)
    this.ledger.record(path, rev)
    await atomicWrite(path, text)
    return { rev }
  }

  watch(onEvent: (e: VaultEvent) => void): () => void {
    this.watcher = chokidar.watch(join(this.root, '*.md'), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    })

    this.watcher.on('change', async (path) => {
      const text = await readFile(path, 'utf8').catch(() => null)
      if (text === null) return
      const rev = hashContent(text)
      if (this.ledger.isOwnWrite(path, rev)) return
      onEvent({ type: 'external-change', path, rev })
    })
    this.watcher.on('add', (path) => onEvent({ type: 'added', path }))
    this.watcher.on('unlink', (path) => onEvent({ type: 'removed', path }))

    return () => { void this.watcher?.close(); this.watcher = null }
  }

  async close(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
  }
}

function readId(text: string): string | null {
  const fm = FRONTMATTER.exec(text)
  if (!fm) return null
  return ID_LINE.exec(fm[1]!)?.[1] ?? null
}

/** Insert `id:` into existing front matter, or create front matter holding it. */
function withId(text: string, id: string): string {
  const fm = FRONTMATTER.exec(text)
  if (!fm) return `---\nid: ${id}\n---\n\n${text}`
  const body = fm[1]!
  return text.replace(FRONTMATTER, `---\n${body}\nid: ${id}\n---\n`)
}
```

`awaitWriteFinish` is what implements the "file appears mid-write" rule from `DESIGN.md` §8 — chokidar waits for the size to stabilise before reporting.

**Note on front matter and D7:** `withId` inserts a line into existing front matter rather than re-serializing it, so key order and comments survive. Back-filling an id is the one write SimpleMark makes without the user asking; it happens once per note, on first scan.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/core/src/vault/vault.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/vault/
git commit -m "feat(vault): scan, read, write and watch a notes folder"
```

---

## Task 7: Recognition types and the sniffer chain

**Files:**
- Create: `packages/core/src/recognition/types.ts`
- Create: `packages/core/src/recognition/pipeline.ts`
- Test: `packages/core/src/recognition/pipeline.test.ts`

**Interfaces:**
- Consumes: Task 1
- Produces: the `Sniffer`, `Recognition`, `ClipboardPayload`, `PasteContext` types from `TECH-SPEC.md` §7, plus
  ```ts
  export function recognise(payload: ClipboardPayload, ctx: PasteContext, sniffers: Sniffer[]): Recognition | null
  ```
  Task 8 registers the Mermaid sniffer into this chain.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/recognition/pipeline.test.ts
import { describe, expect, it } from 'vitest'
import { recognise } from './pipeline'
import type { PasteContext, Sniffer } from './types'

const ctx: PasteContext = { standaloneBlock: true, plainTextForced: false, preferences: {} }
const payload = { text: 'anything', files: [], mimeTypes: ['text/plain'] }

const sniffer = (id: string, priority: number, hit: boolean): Sniffer => ({
  id, priority, level: 'L1',
  sniff: () => hit ? { kind: id, rendererId: `${id}@1`, confidence: 1, level: 'L1', evidence: id, raw: payload } : null,
})

describe('recognise', () => {
  it('returns null when nothing matches', () => {
    expect(recognise(payload, ctx, [sniffer('a', 10, false)])).toBeNull()
  })

  it('picks the highest-priority match regardless of array order', () => {
    const chain = [sniffer('low', 10, true), sniffer('high', 90, true)]
    expect(recognise(payload, ctx, chain)!.kind).toBe('high')
  })

  it('never converts when the paste is not a standalone block', () => {
    const inline = { ...ctx, standaloneBlock: false }
    expect(recognise(payload, inline, [sniffer('a', 90, true)])).toBeNull()
  })

  it('never converts when plain text is forced', () => {
    const forced = { ...ctx, plainTextForced: true }
    expect(recognise(payload, forced, [sniffer('a', 90, true)])).toBeNull()
  })

  it('skips a sniffer that throws and continues the chain', () => {
    const bad: Sniffer = {
      id: 'bad', priority: 99, level: 'L1',
      sniff: () => { throw new Error('boom') },
    }
    expect(recognise(payload, ctx, [bad, sniffer('good', 10, true)])!.kind).toBe('good')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/recognition/pipeline.test.ts`
Expected: FAIL — cannot resolve `./pipeline`.

- [ ] **Step 3: Implement the types**

```ts
// packages/core/src/recognition/types.ts
export interface ClipboardPayload {
  text?: string
  html?: string
  files: Array<{ name: string; mime: string; bytes: ArrayBuffer }>
  mimeTypes: string[]
}

export type RecognitionLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4'

export interface Recognition {
  kind: string
  rendererId: string
  confidence: number
  level: RecognitionLevel
  evidence: string
  raw: ClipboardPayload
}

export interface RecognitionPrefs {
  [fingerprint: string]: string   // fingerprint → chosen kind (L4 learning)
}

export interface PasteContext {
  standaloneBlock: boolean
  plainTextForced: boolean
  preferences: RecognitionPrefs
}

export interface Sniffer {
  id: string
  priority: number
  level: 'L0' | 'L1' | 'L2'
  /** Must validate by parsing. Must return null rather than throwing. */
  sniff(payload: ClipboardPayload, ctx: PasteContext): Recognition | null
}
```

- [ ] **Step 4: Implement the chain**

```ts
// packages/core/src/recognition/pipeline.ts
import type { ClipboardPayload, PasteContext, Recognition, Sniffer } from './types'

/**
 * Run sniffers highest-priority first and return the first match.
 * A sniffer that throws is skipped — a broken sniffer can never break paste.
 * Conversion is refused outright for inline pastes and forced plain text.
 */
export function recognise(
  payload: ClipboardPayload,
  ctx: PasteContext,
  sniffers: Sniffer[],
): Recognition | null {
  if (ctx.plainTextForced) return null
  if (!ctx.standaloneBlock) return null

  const ordered = [...sniffers].sort((a, b) => b.priority - a.priority)
  for (const s of ordered) {
    let hit: Recognition | null = null
    try {
      hit = s.sniff(payload, ctx)
    } catch {
      continue
    }
    if (hit) return hit
  }
  return null
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run packages/core/src/recognition/pipeline.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/recognition/
git commit -m "feat(recognition): sniffer chain with priority ordering and safety rules"
```

---

## Task 8: The Mermaid sniffer

**Files:**
- Create: `packages/core/src/recognition/mermaid.ts`
- Test: `packages/core/src/recognition/mermaid.test.ts`

**Interfaces:**
- Consumes: `Sniffer`, `Recognition` (Task 7)
- Produces: `export const mermaidSniffer: Sniffer` — priority 90, level L1, id `'mermaid'`.

This is the first real implementation of the product's defining behavior: bare diagram source, no fence, becomes a diagram.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/recognition/mermaid.test.ts
import { describe, expect, it } from 'vitest'
import { mermaidSniffer } from './mermaid'
import type { PasteContext } from './types'

const ctx: PasteContext = { standaloneBlock: true, plainTextForced: false, preferences: {} }
const p = (text: string) => ({ text, files: [], mimeTypes: ['text/plain'] })

describe('mermaidSniffer', () => {
  it('claims a bare flowchart with no fence', () => {
    const hit = mermaidSniffer.sniff(p('flowchart TB\n  A --> B\n'), ctx)
    expect(hit?.kind).toBe('mermaid')
    expect(hit?.confidence).toBe(1)
  })

  it('claims every supported diagram header', () => {
    const heads = ['sequenceDiagram\n  a->>b: hi', 'stateDiagram-v2\n  [*] --> A', 'erDiagram\n  A ||--o{ B : has']
    for (const h of heads) expect(mermaidSniffer.sniff(p(h), ctx)).not.toBeNull()
  })

  it('refuses prose that merely starts with the word graph', () => {
    expect(mermaidSniffer.sniff(p('graph the results before the meeting'), ctx)).toBeNull()
  })

  it('refuses malformed diagram source', () => {
    expect(mermaidSniffer.sniff(p('flowchart TB\n  --> --> -->'), ctx)).toBeNull()
  })

  it('refuses an empty payload', () => {
    expect(mermaidSniffer.sniff(p('   \n  '), ctx)).toBeNull()
  })

  it('reports evidence naming the diagram type', () => {
    expect(mermaidSniffer.sniff(p('flowchart TB\n  A --> B\n'), ctx)!.evidence).toContain('flowchart')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/recognition/mermaid.test.ts`
Expected: FAIL — cannot resolve `./mermaid`.

- [ ] **Step 3: Implement**

Install: `pnpm add mermaid --filter @simplemark/core`

```ts
// packages/core/src/recognition/mermaid.ts
import type { Recognition, Sniffer } from './types'

const HEADER =
  /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart)\b/

/**
 * Validation is the match: the header regex is only a cheap gate, and
 * mermaid's own parser decides. Prose that begins with "graph" fails here.
 */
export const mermaidSniffer: Sniffer = {
  id: 'mermaid',
  priority: 90,
  level: 'L1',

  sniff(payload): Recognition | null {
    const text = payload.text?.trim()
    if (!text) return null

    const m = HEADER.exec(text)
    if (!m) return null

    if (!parses(text)) return null

    return {
      kind: 'mermaid',
      rendererId: 'mermaid@11',
      confidence: 1,
      level: 'L1',
      evidence: `parsed as a mermaid ${m[1]} diagram`,
      raw: payload,
    }
  },
}

/** mermaid.parse is async in v11; the sync gate uses its grammar detector. */
function parses(text: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { detectType } = require('mermaid/dist/diagram-api/detectType.js')
    detectType(text)
    return true
  } catch {
    return false
  }
}
```

> **Note for the implementer:** `detectType` validates the diagram header against mermaid's registered grammars synchronously, which is what the sniffer chain needs. Full `mermaid.parse()` is async and runs later in the render path (`TECH-SPEC.md` §5), where a parse failure produces the inline error card. If `detectType` proves too permissive against fixture `refuses malformed diagram source`, make `sniff` async and await `mermaid.parse()` — and update `recognise` in Task 7 to be async at the same time.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/core/src/recognition/mermaid.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recognition/
git commit -m "feat(recognition): mermaid sniffer — bare diagram source, validated by parse"
```

---

## Task 9: The vertical slice — end to end

**Files:**
- Create: `packages/core/src/slice.ts`
- Test: `packages/core/src/slice.test.ts`

**Interfaces:**
- Consumes: `Vault` (Task 6), `recognise` + `mermaidSniffer` (Tasks 7–8), `splitBlocks` (Task 3)
- Produces:
  ```ts
  export function pasteIntoNote(source: string, payload: ClipboardPayload, ctx: PasteContext): string
  ```
  Appends recognised content to a note as a portable fenced block, leaving all existing blocks byte-identical.

This is the Phase 1 gate: folder → paste → save → reopen → external edit, proven without a UI.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/slice.test.ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { pasteIntoNote } from './slice'
import { splitBlocks } from './sourcemap/blocks'
import { Vault } from './vault/vault'

const ctx = { standaloneBlock: true, plainTextForced: false, preferences: {} }
const payload = { text: 'flowchart TB\n  A --> B\n', files: [], mimeTypes: ['text/plain'] }
const settle = () => new Promise(r => setTimeout(r, 400))

describe('paste into a note', () => {
  it('appends a portable fenced mermaid block', () => {
    const out = pasteIntoNote('# Note\n\nSome prose.\n', payload, ctx)
    expect(out).toContain('```mermaid\nflowchart TB\n  A --> B\n```')
  })

  it('leaves every pre-existing block byte-identical', () => {
    const src = '# Note\n\nSome prose.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'
    const out = pasteIntoNote(src, payload, ctx)
    const before = splitBlocks(src).map(b => b.text)
    const after = splitBlocks(out).map(b => b.text).slice(0, before.length)
    expect(after).toEqual(before)
  })

  it('inserts raw text when the paste is not recognised', () => {
    const plain = { text: 'just some words', files: [], mimeTypes: ['text/plain'] }
    const out = pasteIntoNote('# Note\n', plain, ctx)
    expect(out).toContain('just some words')
    expect(out).not.toContain('```mermaid')
  })

  it('survives the full round trip: write, reopen, external edit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sm-slice-'))
    const path = join(dir, 'note.md')
    writeFileSync(path, '# Note\n\nSome prose.\n')

    const vault = new Vault(dir)
    const onEvent = vi.fn()
    const stop = vault.watch(onEvent)
    await settle()

    const updated = pasteIntoNote((await vault.read(path)).content, payload, ctx)
    await vault.write(path, updated)
    await settle()

    expect((await vault.read(path)).content).toBe(updated)
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'external-change' }))

    writeFileSync(path, updated + '\nadded elsewhere\n')
    await settle()
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'external-change', path }))

    stop(); await vault.close()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/slice.test.ts`
Expected: FAIL — cannot resolve `./slice`.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/slice.ts
import { mermaidSniffer } from './recognition/mermaid'
import { recognise } from './recognition/pipeline'
import type { ClipboardPayload, PasteContext } from './recognition/types'

const SNIFFERS = [mermaidSniffer]

/**
 * Append pasted content to a note. Recognised content becomes a portable
 * fenced block; anything else is inserted verbatim. Existing blocks are
 * never rewritten (DESIGN.md D7).
 */
export function pasteIntoNote(
  source: string,
  payload: ClipboardPayload,
  ctx: PasteContext,
): string {
  const hit = recognise(payload, ctx, SNIFFERS)
  const body = hit
    ? fence(hit.kind, payload.text ?? '')
    : (payload.text ?? '')

  const separator = source.endsWith('\n\n') ? '' : source.endsWith('\n') ? '\n' : '\n\n'
  return `${source}${separator}${body}\n`
}

function fence(lang: string, text: string): string {
  const body = text.replace(/\n+$/, '')
  const ticks = '`'.repeat(Math.max(3, longestTickRun(body) + 1))
  return `${ticks}${lang}\n${body}\n${ticks}`
}

function longestTickRun(text: string): number {
  let longest = 0
  for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length)
  return longest
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/core/src/slice.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the whole suite**

Run: `pnpm test`
Expected: all tests across Tasks 1–9 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/slice.ts packages/core/src/slice.test.ts
git commit -m "feat: vertical slice — paste, recognise, fence, save, watch"
```

---

## Task 10: Phase 1 report

**Files:**
- Create: `docs/PHASE-1-REPORT.md`

**Interfaces:**
- Consumes: everything above
- Produces: the written decision that unblocks Phase 2.

- [ ] **Step 1: Write the report**

```markdown
# Phase 1 report

**Date:** <date>

## What works, proven by test

- [ ] Block splitter reconstructs all 10 fixtures byte-for-byte
- [ ] Fidelity gate verdict (spike/fidelity/RESULT.md): PASS / FAIL
- [ ] Atomic writes leave no temp files; ledger suppresses self-writes
- [ ] Vault scans, reads, writes, and distinguishes own vs external change
- [ ] Sniffer chain refuses inline pastes, forced plain text, and throwing sniffers
- [ ] Mermaid sniffer claims bare diagram source and refuses prose
- [ ] Vertical slice round-trips through the filesystem

## What surprised us

<observations that should change the spec>

## Spec changes required

<edits to DESIGN.md or TECH-SPEC.md, or "none">

## Ready for Phase 2?

Phase 2 is the recognition ladder L0–L2 plus core renderers (TECH-SPEC.md §10).
```

- [ ] **Step 2: Fill in every checkbox from actual test output, not memory**

Run: `pnpm test --reporter=verbose` and paste the summary into the report.

- [ ] **Step 3: Commit**

```bash
git add docs/PHASE-1-REPORT.md
git commit -m "docs: phase 1 report and phase 2 readiness"
```

---

## Self-review notes

**Spec coverage.** This plan covers `DESIGN.md` D1 (Tasks 5–6), D7 and §12 (Tasks 2–4), §4.2 paste rules (Tasks 7–9), §8 write discipline (Tasks 5–6), and `TECH-SPEC.md` §3 L1 and §7 interfaces (Tasks 7–8). Not covered here, by design: the editor UI, the renderer catalog, the sandbox, converters, and L3 — those are Phases 2–5 and get their own plans once Task 10 reports.

**Known risk carried forward.** Task 8 uses mermaid's synchronous `detectType` rather than the async `parse()`. If it proves too permissive, the sniffer chain becomes async — a change that touches Tasks 7, 8, and 9 together. The note in Task 8 tells the implementer exactly what to do.

**The gate is real.** Task 4 stops the plan. If Milkdown fails the fidelity test, `packages/editor` gets built on raw ProseMirror instead, and this plan is revised before Task 5 rather than pretending the answer was known.
