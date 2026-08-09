# Step Authority Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a repeatable, committed verdict on whether native ProseMirror steps can be parsed, applied, and rebased against SimpleMark's real Milkdown schema without an editor view.

**Architecture:** Keep the experiment disposable in `spike/authority-2/`. A headless harness builds the same parser, schemas, remarks, and serializer used by `src/adapters/editor/milkdown-editor.ts`, then exposes typed parse, apply, rebase, and serialize operations. Vitest drives two logical clients through every fidelity fixture. The result document names exactly what passed and what was not tested.

**Tech Stack:** TypeScript, Vitest, `@milkdown/kit`, `@milkdown/kit/prose/*`, `prosemirror-transform`.

## Global Constraints

- The spike is reference material only; production code must not import `spike/`.
- ProseMirror imports use `@milkdown/kit/prose/*`, never bare `prosemirror-*`.
- Reuse the real Markdown configuration: CommonMark, GFM, code-fence metadata, math, wiki links, highlights, callouts, and large/deferred tables.
- The harness cannot create an `EditorView`, require a DOM selection, or require a NodeView.
- All ten `FIDELITY_FIXTURES` must load, receive concurrent edits from two logical clients, converge, serialize, and be compared to their raw untouched baselines.
- The verdict selects `prosemirror-collab-commit` or plain `prosemirror-transform` over a committed-step log; it does not implement AUTHORITY-3 or AUTHORITY-4.
- Every new behavior is test-first: record a focused red run before its minimal implementation.

---

### Task 1: Build the real-schema headless harness

**Files:**

- Create: `spike/authority-2/harness.ts`
- Create: `spike/authority-2/harness.test.ts`
- Modify: `package.json` and `package-lock.json` only if the locked Milkdown public API lacks a required parser/schema/serializer entry point.

**Interfaces:**

- Produces `createAuthorityHarness(): Promise<AuthorityHarness>`.
- `AuthorityHarness` exposes `parse(markdown: string): ProseNode`, `serialize(doc: ProseNode): string`, `apply(doc: ProseNode, stepsJson: readonly unknown[]): ApplyResult`, and `rebase(base: ProseNode, local: readonly unknown[], committed: readonly unknown[]): RebaseResult`.
- `ApplyResult` and `RebaseResult` are discriminated results: `{ ok: true, doc, stepsJson }` or `{ ok: false, kind: 'invalid_step' | 'invalid_schema' | 'rebase_failed' }`.

- [ ] **Step 1: Write the failing parser test**

```ts
test('parses and serializes Mermaid, math, table, wiki link, and highlight without EditorView', async () => {
  const harness = await createAuthorityHarness()
  const serialized = harness.serialize(harness.parse(FIXTURE_MARKDOWN))

  expect(serialized).toContain('```mermaid')
  expect(serialized).toContain('$$')
  expect(serialized).toContain('[[Roadmap|the roadmap]]')
  expect(serialized).toContain('=={green}important==')
})
```

- [ ] **Step 2: Run the red test**

Run: `npx vitest run spike/authority-2/harness.test.ts`

Expected: FAIL because `createAuthorityHarness` is absent.

- [ ] **Step 3: Implement the minimal headless parser/schema/serializer builder**

```ts
export interface AuthorityHarness {
  parse(markdown: string): ProseNode
  serialize(doc: ProseNode): string
  apply(doc: ProseNode, stepsJson: readonly unknown[]): ApplyResult
  rebase(base: ProseNode, local: readonly unknown[], committed: readonly unknown[]): RebaseResult
}
```

Build only Milkdown parser, schema, and serializer contexts. Do not request `rootCtx`, `editorViewCtx`, or register NodeViews.

- [ ] **Step 4: Run the green test**

Run: `npx vitest run spike/authority-2/harness.test.ts`

Expected: PASS with no mounted editor surface.

- [ ] **Step 5: Add and prove malformed JSON handling**

```ts
test('returns invalid_step rather than throwing for malformed step JSON', async () => {
  const result = (await createAuthorityHarness()).apply(
    (await createAuthorityHarness()).parse('# Note'),
    [{ stepType: 'not-a-step' }],
  )
  expect(result).toMatchObject({ ok: false, kind: 'invalid_step' })
})
```

Run: `npx vitest run spike/authority-2/harness.test.ts`

Expected: red before the error boundary; green after it is implemented.

### Task 2: Prove application and rebase behavior

**Files:**

- Modify: `spike/authority-2/harness.ts`
- Modify: `spike/authority-2/harness.test.ts`

**Interfaces:**

- Consumes `AuthorityHarness` from Task 1.
- Produces a transform-based rebase that maps local steps across a committed batch and refuses a lost target.

- [ ] **Step 1: Write the failing concurrent-edit tests**

```ts
test('rebases a non-overlapping local edit over a committed edit', async () => {
  const { base, local, committed } = await concurrentTextScenario('first paragraph', 'second paragraph')
  expect((await createAuthorityHarness()).rebase(base, local, committed)).toMatchObject({ ok: true })
})

test('returns rebase_failed when the committed edit deletes the local target', async () => {
  const { base, local, committed } = await deletedTargetScenario()
  expect((await createAuthorityHarness()).rebase(base, local, committed))
    .toMatchObject({ ok: false, kind: 'rebase_failed' })
})
```

- [ ] **Step 2: Run the red tests**

Run: `npx vitest run spike/authority-2/harness.test.ts -t rebase`

Expected: FAIL before mapping is implemented.

- [ ] **Step 3: Implement minimal committed-log rebasing**

```ts
for (const step of committedSteps) mapping.appendMap(step.getMap())
const mapped = localSteps.map((step) => step.map(mapping))
if (mapped.some((step) => step === null)) return { ok: false, kind: 'rebase_failed' }
```

Apply only the fully mapped batch and validate the resulting document before returning success.

- [ ] **Step 4: Run the green rebase tests**

Run: `npx vitest run spike/authority-2/harness.test.ts -t rebase`

Expected: PASS: both edits land when non-overlapping; a deleted target is honestly refused.

- [ ] **Step 5: Add structural scenario coverage before implementation**

```ts
test.each(['delete', 'split', 'join', 'list', 'quote', 'table'])(
  '%s concurrent edits keep the real schema valid',
  async (kind) => expect(await applyConcurrentStructuralScenario(kind)).toMatchObject({ ok: true, schemaValid: true }),
)
```

- [ ] **Step 6: Implement each smallest scenario builder and verify it**

Run: `npx vitest run spike/authority-2/harness.test.ts -t 'schema valid'`

Expected: PASS; every result satisfies `doc.type.validContent(doc.content)`.

### Task 3: Exercise all fidelity fixtures and record the verdict

**Files:**

- Create: `spike/authority-2/fidelity.test.ts`
- Create: `spike/authority-2/RESULT.md`
- Modify: `spike/authority-2/harness.ts`

**Interfaces:**

- Consumes `FIDELITY_FIXTURES` and `readFixture` from `tests/support/fixtures.ts`.
- Produces `runFixtureScenario(source: string): Promise<{ converged: boolean; appliedFromJson: boolean; rebased: boolean; serialized: string; editedMarker: string }>`.

- [ ] **Step 1: Write the failing ten-fixture test**

```ts
test.each(FIDELITY_FIXTURES)('$id: clients converge after concurrent edits', async (fixture) => {
  const source = Buffer.from(readFixture(fixture)).toString('utf8')
  const result = await runFixtureScenario(source)

  expect(result).toMatchObject({ converged: true, appliedFromJson: true, rebased: true })
  expect(result.serialized).toContain(result.editedMarker)
})
```

- [ ] **Step 2: Run the red fixture suite**

Run: `npx vitest run spike/authority-2/fidelity.test.ts`

Expected: FAIL because `runFixtureScenario` does not exist.

- [ ] **Step 3: Implement the fixture scenario runner**

Use each fixture's raw bytes as its source-preservation baseline. Parse its decoded text only for the step authority experiment. Edit the first and last safely editable text locations; do not claim serializer output is byte-identical raw input.

- [ ] **Step 4: Run the green fixture suite**

Run: `npx vitest run spike/authority-2/fidelity.test.ts`

Expected: PASS for fixture ids 1–10, including CRLF/no-final-newline input.

- [ ] **Step 5: Execute and capture the final evidence**

```bash
npm ls prosemirror-model prosemirror-state prosemirror-transform
npx vitest run spike/authority-2
npm run typecheck
npm run check:boundaries
git diff --check
```

Expected: one resolved copy of each ProseMirror core package; all tests and architecture checks pass; no whitespace errors.

- [ ] **Step 6: Write RESULT.md only from actual results**

```md
## Verdict

Use plain prosemirror-transform over a committed-step log inside the future editor adapter.

This spike proves only headless parsing, JSON step application, transform rebase, and serialization.
It does not claim NodeView/decorations, undo ownership, reconnect, or Pitter Patter contention support without a separately executed test.
```

- [ ] **Step 7: Commit the spike and plan**

```bash
git add spike/authority-2 docs/superpowers/plans/2026-08-09-step-authority-spike.md
git commit -m "docs: record step authority spike verdict"
```
