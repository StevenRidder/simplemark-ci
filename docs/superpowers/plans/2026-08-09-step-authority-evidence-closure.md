# Step Authority Evidence Closure Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the concrete evidence gaps left by AUTHORITY-2: correct multi-step rebasing, mounted-editor survival, undo isolation, reconnect/retry/contention behavior, and explicit fidelity evidence.

**Architecture:** Keep all new authority behavior in the `spike/authority-2` evidence surface. Extend the existing pure harness for correct ProseMirror mapping, add an in-memory simulator for lifecycle behavior, and mount a real `EditorView` in a browser-only spike page using the same NodeViews and plugins as SimpleMark. Do not add production ports, persistence, network transport, CRDT code, or UI.

**Tech Stack:** TypeScript, ProseMirror through `@milkdown/kit`, Vitest, Playwright, Vite.

---

## Guardrails

- Do not modify `src/application/**`, `DocumentSession`, or any production authority API.
- Do not implement work assigned to AUTHORITY-3, AUTHORITY-4, EDITOR-20, AGENT-5, or AGENT-6.
- Keep every lifecycle mechanism explicitly test-only and in memory.
- Treat any partially applied or unmappable batch as a typed failure; never return a partly changed document.
- Preserve AUTHORITY-2's narrow claims in `RESULT.md`; add evidence and remaining limits rather than rewriting history.

## Task 1: Make multi-step rebasing correct and atomic

**Files:**

- Modify: `spike/authority-2/harness.ts`
- Modify: `spike/authority-2/harness.test.ts`

### Step 1: Write failing multi-step tests

Add tests that build two-step local and committed batches from sequential document states. Cover:

1. non-overlapping two-step batches converge;
2. same-position inserts use committed-arrival-before-local ordering;
3. a later local step is mapped through earlier local maps as well as committed maps;
4. an invalid or destroyed-target batch fails without exposing a partial document.

Use helper functions in the test that create a step, apply it to the current document, then create the next step from that new document. Assert both the final text and the returned step JSON.

### Step 2: Run the narrow test and confirm RED

Run:

~~~bash
npx vitest run spike/authority-2/harness.test.ts
~~~

Expected: at least the multi-step mapping case fails because the current implementation maps every local step only through the committed mapping.

### Step 3: Implement sequential decode and standard rebase mapping

In `harness.ts`, replace independent step decoding with a helper that validates and applies each step against the document state produced by the previous step:

~~~ts
interface DecodedStep {
  readonly step: Step;
  readonly inverted: Step;
}

function decodeSequentialSteps(
  base: ProseMirrorNode,
  stepsJson: readonly unknown[],
): { ok: true; steps: readonly DecodedStep[]; doc: ProseMirrorNode } | ApplyFailure
~~~

For rebasing, construct one `Mapping` in the ProseMirror-recommended order:

1. append inverse local maps in reverse order;
2. append committed maps in forward order;
3. map each local step through the relevant mapping slice;
4. append every accepted mapped-local map with its mirror index;
5. apply only to local variables and return success after the complete batch succeeds.

Return `invalid_step`, `invalid_schema`, or `rebase_failed` without mutating or returning an intermediate document.

### Step 4: Run the narrow tests and confirm GREEN

Run:

~~~bash
npx vitest run spike/authority-2/harness.test.ts
~~~

Expected: all harness tests pass.

### Step 5: Commit

~~~bash
git add spike/authority-2/harness.ts spike/authority-2/harness.test.ts
git commit -m "test(authority): prove multi-step rebase"
~~~

## Task 2: Prove retry, reconnect, restart, and contention semantics

**Files:**

- Create: `spike/authority-2/authority-simulator.ts`
- Create: `spike/authority-2/authority-simulator.test.ts`

### Step 1: Write failing simulator tests

Describe the test-only contract in the test itself:

~~~ts
interface SubmittedBatch {
  readonly clientId: string;
  readonly operationId: string;
  readonly baseVersion: number;
  readonly stepsJson: readonly unknown[];
}
~~~

Cover these scenarios:

1. a fresh batch advances the version exactly once;
2. a stale batch rebases over every commit since its base version;
3. retrying the identical operation ID returns the prior result and does not duplicate content;
4. reusing an operation ID with different content returns `operation_conflict`;
5. two clients contending at the same position converge deterministically by arrival order;
6. exporting and restoring a checkpoint preserves document, version, log, and dedupe state;
7. a disconnected client can resume from its known version and submit a stale batch;
8. invalid versions and invalid batches leave document, version, and log unchanged.

### Step 2: Run the new test and confirm RED

Run:

~~~bash
npx vitest run spike/authority-2/authority-simulator.test.ts
~~~

Expected: module-not-found failure because the simulator does not exist.

### Step 3: Implement the in-memory simulator

Export:

~~~ts
export type AuthoritySubmitResult =
  | { readonly ok: true; readonly version: number; readonly rebased: boolean; readonly stepsJson: readonly unknown[] }
  | { readonly ok: false; readonly kind: "invalid_step" | "invalid_schema" | "invalid_version" | "rebase_failed" | "operation_conflict" };

export interface AuthorityCheckpoint {
  readonly documentsJson: readonly unknown[];
  readonly commits: readonly { readonly version: number; readonly stepsJson: readonly unknown[] }[];
  readonly operations: readonly { readonly operationId: string; readonly payload: string; readonly result: AuthoritySubmitResult }[];
}

export function createAuthoritySimulator(
  harness: AuthorityHarness,
  initialMarkdown: string,
  checkpoint?: AuthorityCheckpoint,
): AuthoritySimulator
~~~

Implementation rules:

- Keep a document snapshot for version zero and each accepted version.
- Validate `baseVersion` is an existing non-future version.
- For stale submissions, flatten committed steps after `baseVersion` and call the harness rebase path.
- Record a successful operation ID with a stable serialized payload and exact prior result.
- On identical retry, return the recorded result before applying anything.
- On payload mismatch, return `operation_conflict`.
- Export JSON-compatible checkpoint data and rebuild ProseMirror nodes through the initial document's schema.
- Clone checkpoint arrays/objects at the boundary so callers cannot mutate internal state.

### Step 4: Run simulator and all authority unit tests

Run:

~~~bash
npx vitest run spike/authority-2/authority-simulator.test.ts
npx vitest run spike/authority-2
~~~

Expected: all pass.

### Step 5: Commit

~~~bash
git add spike/authority-2/authority-simulator.ts spike/authority-2/authority-simulator.test.ts
git commit -m "test(authority): prove lifecycle convergence"
~~~

## Task 3: Prove mounted-editor behavior with real NodeViews and plugins

**Files:**

- Create: `spike/authority-2/index.html`
- Create: `spike/authority-2/mounted.ts`
- Create: `tests/ui/authority-spike.spec.ts`
- Modify: `vite.config.ts`

### Step 1: Write failing Playwright scenarios

Create browser tests that navigate to `/spike/authority-2/index.html` and call a small typed API exposed by the spike page. Cover:

1. a mounted Mermaid code NodeView, block-math NodeView, and inline-math NodeView remain connected after a remote insertion outside those nodes;
2. the selection maps to the same logical text after a remote insertion before it;
3. find decorations still mark the intended text after that insertion;
4. a human edit enters history, a remote transaction uses `addToHistory: false`, and one undo removes only the human edit while retaining the remote edit;
5. a destroyed view rejects a later remote batch without changing the last captured document.

The first run should fail because the page and API do not exist.

### Step 2: Run the browser test and confirm RED

Run:

~~~bash
npx playwright test tests/ui/authority-spike.spec.ts
~~~

Expected: navigation/API failure.

### Step 3: Add the mounted spike page

Build a minimal page containing only a mount root and import `mounted.ts`. Add its HTML entry to the existing Vite rollup inputs so the production build compiles it.

In `mounted.ts`:

- parse a real SimpleMark Markdown fixture with `createAuthorityHarness()`;
- create a real `EditorState` and `EditorView`;
- install ProseMirror history plus the production `foldingProsePlugin()` and `findProsePlugin()`;
- wire the production `DiagramNodeView` and `InlineMathNodeView` with a deterministic in-memory renderer;
- route remote steps through the authority harness, then dispatch one replacement transaction with `addToHistory: false`;
- expose only scenario-oriented methods under `window.authoritySpike`;
- destroy the view and reject later application explicitly.

Keep all orchestration in the spike file. Do not alter `MilkdownEditor`, production ports, or application state.

### Step 4: Run browser and build checks

Run:

~~~bash
npx playwright test tests/ui/authority-spike.spec.ts
npm run build
~~~

Expected: browser scenarios pass and Vite builds the new entry.

### Step 5: Commit

~~~bash
git add spike/authority-2/index.html spike/authority-2/mounted.ts tests/ui/authority-spike.spec.ts vite.config.ts
git commit -m "test(authority): prove mounted editor behavior"
~~~

## Task 4: Reconcile fidelity claims and record the verdict

**Files:**

- Modify: `spike/authority-2/RESULT.md`
- Modify only if a real evidence gap is found: existing fidelity tests under `src/domain/**` or `tests/ui/fidelity.spec.ts`

### Step 1: Run existing fidelity evidence before changing it

Run the targeted tests identified in `RESULT.md` and the repository docs:

~~~bash
npx vitest run src/domain
npx playwright test tests/ui/fidelity.spec.ts
~~~

Expected: existing untouched-source and rendered-fidelity coverage passes. If it does not, stop and diagnose rather than weakening the claim.

### Step 2: Update `RESULT.md` as an evidence ledger

Add exact sections for:

- multi-step and same-position rebase results;
- mounted NodeView, selection, and decoration survival;
- undo isolation;
- reconnect, retry, idempotency, checkpoint restore, and contention;
- fidelity evidence, naming the existing tests rather than claiming the spike serializes Markdown;
- explicit remaining exclusions: second process, durable storage, network failure, CRDT, production ports, and provider/participant work.

For every claim, name the test file and command that proves it. Preserve the distinction between “evidence closed” and “production feature implemented.”

### Step 3: Run the complete AUTHORITY-5 verification set

Run:

~~~bash
npm ls @milkdown/kit prosemirror-history prosemirror-transform
npx vitest run spike/authority-2
npx playwright test tests/ui/authority-spike.spec.ts tests/ui/fidelity.spec.ts
bash scripts/simplemark_ci.sh
git diff --check
~~~

Expected:

- dependency tree exits zero;
- all spike tests pass;
- both targeted browser suites pass;
- the canonical gate passes with no skipped mandatory scope;
- `git diff --check` prints nothing.

### Step 4: Inspect final scope

Run:

~~~bash
git status --short
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
~~~

Expected: only the approved spec/plan, `spike/authority-2/**`, one Playwright test, and `vite.config.ts` are changed. No production application or domain file should appear.

### Step 5: Commit the evidence record

~~~bash
git add spike/authority-2/RESULT.md
git commit -m "docs(authority): record closed spike evidence"
~~~

## Task 5: Review, publish, and complete through Switchboard

### Step 1: Perform an implementation review

Use the `superpowers:requesting-code-review` skill. Resolve any correctness issue, rerun the affected narrow test, then rerun the complete AUTHORITY-5 verification set.

### Step 2: Push and open the PR

~~~bash
git push -u origin codex/AUTHORITY-5-evidence-closure
gh pr create --base main --head codex/AUTHORITY-5-evidence-closure --title "test(authority): close step-authority evidence gaps" --body-file <prepared-pr-body>
~~~

The PR body must say plainly that this closes spike evidence only and does not implement the production authority boundary.

### Step 3: Record the exact head with Switchboard

Call `complete_claim` for project `simplemark` with:

- task `AUTHORITY-5`;
- claim `taskclaim-1f699e8d409749e2`;
- Work Session `worksession-b2d303bde5954297`;
- branch `codex/AUTHORITY-5-evidence-closure`;
- pushed head SHA;
- PR URL;
- exact test commands and results;
- `git diff --check` result;
- review result.

This moves the task to In Review. Do not mark it Done manually.

### Step 4: Queue only after the canonical `gate` is green

Inspect the PR checks. Once `gate` passes, add the PR to GitHub's merge queue. Wait for merge-group/default-branch provenance, then reconcile AUTHORITY-5 in Switchboard.

### Step 5: Final user handoff

Report:

- what evidence is now genuinely proven;
- what product behavior remains unimplemented;
- PR, branch head, merged SHA if landed, and Switchboard state;
- exact verification totals and any caveats.
