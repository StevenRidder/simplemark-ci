# FIDELITY-1: wire block preservation into the save path

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop a save re-serializing the whole document. Untouched blocks must re-emit their original bytes, which is what `README.md` claims and what `domain` already implements.

**Architecture:** No new domain code. `buildSourceMap` and `emitDocument` exist, are exported, and are proven by `tests/ui/fidelity.spec.ts` across all ten fixtures. This plan wires them into `DocumentSession` and the save path, which today carry whole-document Markdown.

**Tech Stack:** TypeScript, vitest, Playwright. No Rust, no native changes.

## Why this exists

Found on a real document, not a fixture: adding two four-word comments to a 257-line file rewrote 26 lines the author never touched — bullet markers `-` → `*`, thematic breaks `---` → `***`, tildes escaped to `\~`, a `<br />` inserted, a non-breaking space appended.

Nothing is broken. `src/application/document-session.ts` says so in its own header: *"there is no source baseline or dirty-block serialization yet — those are FIDELITY-1's, and coarse whole-document serialization is explicitly not a D7 fidelity claim."* The preservation layer simply has no caller: `src/application/` and `milkdown-editor.ts` contain zero references to `emitDocument`, `buildSourceMap` or a source baseline.

## Global Constraints

- **No changes to `src/domain/`.** The domain half is done and tested. If this plan seems to need a domain change, stop — that is a signal the approach is wrong.
- **`emitDocument(map, dirty)` is the only serialization entry point** for a save of a previously-opened document. Signature: `(map: SourceMap, dirty: ReadonlyMap<number, string>) => string`.
- **ADR-0001 holds.** `application` imports `domain` only. The baseline lives in `DocumentSession`, never in an adapter.
- **ADR-0002 holds.** `DocumentSession` remains the single coordination authority. Do not let the editor adapter own the baseline.
- **Falling back is allowed; guessing is not.** Where the dirty set cannot be determined honestly (§Task 3), serialize the whole document as today and say so in a comment. A wrong preservation is worse than an honest re-serialization.
- Run `npm test`, `npm run typecheck`, `npm run check:boundaries` and `npx playwright test tests/ui/fidelity.spec.ts` before every commit.

## Correction, 2026-08-07 — where the block boundaries come from

**Task 2 is done and committed** (`src/application/dirty-blocks.ts`, five passing tests). Building
it exposed a wrong assumption in the rest of this plan, corrected here before anyone follows it.

`buildSourceMap` does **not** parse Markdown. Its real signature is
`buildSourceMap(source: string, blockStarts: readonly number[])` — a pure *tiling* function that is
**given** the offset of every top-level block. So "build a source map of the incoming Markdown" is
not a thing the application layer can do on its own, and Tasks 1 and 3 as written below are
incomplete: they need a source of `blockStarts`.

Three ways to get them, in order of preference:

1. **Parse with remark and read `position.start.offset`.** Every top-level child of an mdast root
   carries its source offset, which is exactly `blockStarts`. remark is already a dependency —
   Milkdown is built on it — so this adds nothing new. **But it cannot live in `application`**,
   which ADR-0001 restricts to importing `domain` only. It needs a port: something like
   `BlockBoundaryPort { starts(markdown: string): readonly number[] }`, implemented in `adapters`
   and injected into `DocumentSession`. That port is the missing piece of this plan.
2. **Ask the editor.** ProseMirror knows each top-level node's position and Milkdown can map that
   back to source. More precise, and it is the FIDELITY-1 design proper — but it puts editor
   knowledge on the save path, and option 1 gets the same offsets without it.
3. **Scan for blank lines in the application layer.** No dependency and no port, but it is a second
   Markdown parser written by hand, and it will disagree with the real one on fenced code, HTML
   blocks and lists. The test helper in `dirty-blocks.test.ts` does exactly this and is explicitly
   marked as adequate only for testing comparison logic.

**Recommended: option 1.** Add the port, implement it in `adapters` over remark, inject it. Tasks 1
and 3 below should be read with that substitution: wherever they say "build a source map", it means
"ask the port for block starts, then build the map".

**This also answers the ProseMirror question.** You do not need it. You need a parser, and you
already have one.

## The approach, and the one real decision

The editor hands `DocumentSession` whole-document Markdown. It does **not** report which blocks changed. Two ways to get a dirty set:

1. **Derive it by comparison.** On save, build a source map of the incoming Markdown and compare block-by-block against the baseline's map. Blocks whose text is unchanged are not dirty. **Recommended** — no editor changes, no ProseMirror knowledge in `application`, and it is honest by construction: a block is dirty precisely when its bytes differ.
2. **Have the editor report dirty blocks.** More precise, but it requires the Milkdown adapter to map ProseMirror nodes to source blocks, which is the hard part of FIDELITY-1 and is not needed to fix this.

This plan implements option 1. Option 2 remains available later and would slot in behind the same `DocumentSession` API.

**The known limit of option 1:** when the block *count* changes — a block added, removed, or split — pairwise comparison is not meaningful. Task 3 detects that and falls back to whole-document serialization. That case renormalizes, exactly as today, and is the honest boundary rather than a bug.

---

## Task 0: Configure the serializer to house style

**Files:** the remark-stringify configuration behind `milkdown-editor.ts`, plus a unit test.

Cheap, independent of everything below, and worth doing first because it reduces the damage the
Task 3 fallback can still do.

Every reformatting seen on the real document is a remark-stringify **default**, not a ProseMirror
behaviour: `bullet` defaults to `*` (turning `-` into `*`), `rule` defaults to `*` (turning `---`
into `***`), and the escape rules produced `\~`. All are options.

**What this does not achieve.** remark parses every thematic-break variant into one AST node with
no memory of the original characters, count or spacing, and recreates it from config on output. So
this buys consistency, not fidelity — and `tests/fixtures/04-mixed-list-markers.md` is exactly the
document it cannot serve, since a file mixing `-` and `*` can only come back as one of them. That
is why Tasks 1–3 still matter.

- [ ] **Step 1: Failing test** — serializing a document with `-` bullets and `---` rules returns
      `-` and `---`, not `*` and `***`.
- [ ] **Step 2: Run, confirm it fails**
- [ ] **Step 3: Set `bullet: '-'`, `rule: '-'`** and whatever escaping options stop `~` becoming
      `\~`. Match what the repository's own Markdown already uses rather than inventing a style.
- [ ] **Step 4: Run, confirm pass. Run the fidelity suite** — some fixtures may now round-trip
      that previously did not, which is a gain, but confirm none regressed.
- [ ] **Step 5: Commit** — `fix: serialize Markdown in the repository's own style`

## Task 1: Keep the baseline on open

**Files:** Modify `src/application/document-session.ts`, `tests/application/document-session.test.ts`

**Interfaces produced:** `DocumentSession` retains `#baseline: string` (the exact Markdown as opened) and `#baselineMap: SourceMap`.

- [ ] **Step 1: Failing test** — a session opened with Markdown reports that same Markdown as its baseline, and the baseline does not change when a transaction is applied.
- [ ] **Step 2: Run it, confirm it fails** (`npx vitest run tests/application/document-session.test.ts`)
- [ ] **Step 3: Implement.** Store the opening Markdown and `buildSourceMap(markdown)` alongside it. The baseline is replaced only by a successful save or a reopen — never by `apply`.
- [ ] **Step 4: Run tests, confirm pass**
- [ ] **Step 5: Commit** — `feat: keep the source baseline on the document session`

## Task 2: Compare blocks and build the dirty set

**Files:** Create `src/application/dirty-blocks.ts`, `tests/application/dirty-blocks.test.ts`

**Interfaces produced:** `dirtyBlocks(baseline: SourceMap, next: SourceMap): ReadonlyMap<number, string> | null` — `null` means "cannot determine, fall back".

- [ ] **Step 1: Failing tests.** Cover each case explicitly:
  - identical documents → empty map (nothing dirty)
  - one block's text changed → map of exactly that index
  - two blocks changed → both, and only both
  - block counts differ → `null`
  - a block whose *content* is identical but whose separator differs → not dirty (the separator is preserved by `emitDocument`, not by us)
- [ ] **Step 2: Run, confirm fail**
- [ ] **Step 3: Implement.** Pure function, no I/O. Pair blocks by index; a block is dirty when its content slice differs.
- [ ] **Step 4: Run, confirm pass**
- [ ] **Step 5: Commit** — `feat: derive the dirty block set by comparing source maps`

## Task 3: Route save through emitDocument

**Files:** Modify `src/application/document-session.ts`, `tests/application/document-session.test.ts`

- [ ] **Step 1: Failing test — the defect that started this.** Take a fixture with `-` bullets and `---` rules, apply a transaction that changes exactly one paragraph, save, and assert every other byte is identical. This test must fail before the change.
- [ ] **Step 2: Run, confirm it fails with the whole document renormalized**
- [ ] **Step 3: Implement.** On save: build a map of the incoming Markdown, call `dirtyBlocks`. If it returns a map, write `emitDocument(baselineMap, dirty)`. If it returns `null`, write the whole document as today, with a comment naming why. Update the baseline on success.
- [ ] **Step 4: Run, confirm pass**
- [ ] **Step 5: Run the whole fidelity suite** — `npx playwright test tests/ui/fidelity.spec.ts`
- [ ] **Step 6: Commit** — `fix: preserve untouched blocks when saving`

## Task 4: Prove it on the document that exposed it

**Files:** Create `tests/fixtures/11-review-comments.md`, modify `tests/fidelity-corpus.test.ts`

The ten-fixture corpus is fixed by `DESIGN.md` §12 and the corpus test asserts exactly ten. Adding an eleventh means either amending §12 or holding this fixture outside the corpus — **decide before writing the test**, and if §12 is amended, say so in the commit.

- [ ] **Step 1:** Add a fixture with the constructs that were mangled: `-` bullets, `---` thematic breaks, a `~` in prose, and a trailing-space line.
- [ ] **Step 2:** Assert that editing one paragraph leaves markers, rules and tildes byte-identical.
- [ ] **Step 3: Commit**

## Task 5: Restore the README claim

**Files:** Modify `README.md`

- [ ] **Step 1:** Revert the FIDELITY-1 caveat added on 2026-08-07 — lines 44–47 and the Fidelity row of the table — so the README states block-level preservation plainly again.
- [ ] **Step 2:** Verify the claim is now true by running the Task 3 and Task 4 tests.
- [ ] **Step 3: Commit** — `docs: the byte-fidelity claim is true again`

## Task 6: Open the PR

- [ ] Full gate: `npm test && npm run typecheck && npm run check:boundaries && npx playwright test`
- [ ] Push, open PR, add to the merge queue once `gate` is green.

## What would make this plan wrong

- **If `SourceBlock` has no stable content slice** to compare, Task 2's premise fails and option 2 becomes necessary. Check `src/domain/source/source-map.ts` before starting.
- **If the editor already reports structural changes** somewhere I did not find, option 2 is cheaper than assumed and Task 2 should be reconsidered. ProseMirror does expose the raw material — step maps, and the first-party `prosemirror-changeset` package which distills steps into changed ranges — but its maintainers describe position tracking across multiple steps as subtle, since each step's positions are relative to the document as it was when that step applied.
- **If block counts change on most real edits** — typing at the end of a paragraph splitting it, say — the fallback fires constantly and this fixes little. Measure on a real document early: if the fallback rate is high, stop and do option 2 instead.
