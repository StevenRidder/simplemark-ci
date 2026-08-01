# SimpleMark Phase 0–1: Foundation implementation plan

**Status:** executable after task ownership is established

**Governing decisions:** [ADR-0001](../../decisions/0001-single-product-modular-architecture.md),
[ADR-0002](../../decisions/0002-local-document-session-before-crdt.md)

**Goal:** prove byte-preserving Markdown, then test one human and one local agent editing live through
one authoritative `DocumentSession`.

## Architecture

One repository, one JavaScript package, one app release. Internal modules have enforced dependency
direction:

```text
src/app ───────────┐
                   v
src/adapters ─→ src/application ─→ src/domain
                         ^
                         │
                 editor and MCP share use cases
```

Phase 1 contains no Yjs dependency or collaboration adapter implementation. The distributed
multi-client authority decision is a later plan.

The first visible build runs in a browser development shell backed by the approved wireframe. It
is not a separate product: browser and Tauri entrypoints compose the same document session, editor,
renderer, toolbar, and UI modules. Tauri later replaces only the platform file/window adapter.

## Global constraints

- Node 20+, TypeScript strict mode, no `any` in exported signatures.
- `domain` and `application` run without DOM, Tauri, filesystem, MCP, or CRDT imports.
- Untouched blocks re-emit their original bytes; only dirty blocks serialize.
- `originalSource` is an immutable save baseline. Dirty is monotonic until successful save.
- Sniffers validate by parsing and never throw.
- Atomic writes use a temporary file in the same directory followed by rename.
- Editor and MCP adapters never mutate each other, ProseMirror internals, or files directly.
- Agent edits require explicit scope, avoid the active human block, and land as one coherent named
  transaction with an expected revision and optional fenced run generation.
- Every renderer saves a portable Markdown fallback.
- `docs/wireframe.html` supplies the visual tokens, typography, layout, controls, and interaction
  states. Inline wireframe scripts and hard-coded demo content are reference material, not runtime
  architecture.
- No document or editor rule may live only in the browser entrypoint. The browser shell and Tauri
  shell call the same application API.
- Before the fidelity verdict, the visible harness opens committed fixtures through an in-memory
  file port. Writing an arbitrary real file remains gated by the fidelity decision.

## Initial layout

```text
src/
├── domain/
│   ├── source/
│   ├── transactions/
│   └── fences/
├── application/
│   ├── document-session.ts
│   └── ports.ts
├── adapters/
│   ├── editor/
│   ├── filesystem/
│   ├── renderers/
│   └── mcp/
└── app/
    ├── ui/
    ├── styles/
    ├── bootstrap.ts
    ├── browser.ts
    └── tauri.ts
src-tauri/
spike/fidelity/
tests/fixtures/
```

## Deliverable 0: fidelity decision

### 0.1 Scaffold and boundaries

- Create the single root package, TypeScript/Vitest configuration, and the module directories.
- Add import-boundary and cycle checks required by ADR-0001.
- Prove `domain` and `application` tests execute in plain Node.

### 0.2 Fixture corpus and byte-diff harness

- Commit the ten hostile fixtures from `DESIGN.md` §12.
- Include mixed lists, ragged tables, unusual fences, front matter, HTML/SVG, CRLF, hard tabs,
  trailing whitespace, and no-final-newline cases.
- Report exact byte offsets and before/after snippets on failure.

### 0.3 Candidate editor bridge

- Test Milkdown first, but treat raw ProseMirror plus an explicit source map as the planned fallback.
- Parse Markdown into a structured document while retaining each top-level source baseline.
- Save untouched and prove byte identity across all fixtures.
- Edit one block and prove every untouched block remains byte-identical.

### 0.4 Visible fidelity harness

- Extract the calm canvas, formatting bar, Mermaid block, and saved/error states from
  `docs/wireframe.html` into reusable `src/app/ui` and `src/app/styles` modules.
- Run the real candidate editor bridge inside `src/app/browser.ts`; do not use a parallel
  `contenteditable` demo model.
- Open only the committed fixtures through an in-memory file-port implementation until the
  fidelity verdict passes.
- Make text editing, one formatting command, and Mermaid render/source-toggle real. Other
  controls are absent or visibly disabled.
- Prove that the browser entrypoint contains platform wiring only and that the UI talks through
  the application API.

### 0.5 Verdict

Write `spike/fidelity/RESULT.md` with:

- exact dependency versions;
- commands and fixture results;
- PASS or FAIL;
- Milkdown or raw-ProseMirror decision; and
- unresolved fidelity risks.

Stop for review at this gate. Do not begin the app shell on an ambiguous result.

## Deliverable 1: local editor and Mermaid

### 1.0 Reusable browser walking skeleton

Promote the passing fidelity harness directly; do not rewrite it:

- Add a browser implementation of the application file port using the File System Access API,
  with an explicit unsupported-browser state.
- Open one chosen `.md` file, edit it in the wireframe-derived canvas, render/edit Mermaid, save,
  close, and reopen.
- Route every operation through `DocumentSession`; the browser entrypoint may not parse Markdown,
  mutate ProseMirror, render Mermaid, or serialize files itself.
- Exercise the exact shared bundle that Tauri will load. A small platform-adapter contract test
  must run against both browser and native implementations.
- Treat this as the first user-visible checkpoint. It is complete only when it operates on a copy
  of a real note without corrupting it.

### 1.1 DocumentSession

Implement the application authority before UI or MCP handlers:

```ts
interface DocumentSession {
  snapshot(): DocumentSnapshot
  apply(transaction: DocumentTransaction): ApplyResult
  save(): Promise<SaveResult>
  stop(runId: string): FenceResult
  redirect(runId: string, instruction: string): RunGeneration
  revert(transactionId: string): RevertResult
}
```

- Maintain one increasing document revision.
- Enforce `expectedRevision`, block scope, active-human focus, and `mayApply(run, generation)`.
- Journal actor, name, scope, before/after revision, and inverse operation for agent transactions.
- Establish new source baselines only after a successful atomic save.

### 1.2 Native one-file shell

- Load the same `app/ui`, editor, renderer, and `DocumentSession` modules in one macOS Tauri
  window; replace only the browser file/window ports.
- Open one chosen `.md` file in that window.
- Surface external changes and failed writes; never silently replace a dirty live session.
- Implement the approved calm canvas and only the essential Apple Notes-style controls.

### 1.3 Mermaid block

- Recognize valid bare Mermaid at a block boundary.
- Render safely inline and expose editable source on click.
- Use a simple textarea first; adopt CodeMirror 6 only if the editing benefit justifies its measured
  bundle and interaction cost.
- Pass the `DESIGN.md` §4.5 matrix: focus entry/exit, isolated selection, arrow boundaries,
  paste/IME, inner/outer undo, deletion, update-without-recreation, DOM mutation filtering, reopen.
- Save as an ordinary fenced `mermaid` block and fail visibly on invalid input.

## Deliverable 2: one live local agent

### 2.1 Thin MCP adapter

Expose only the POC commands: open/read current session, invoke within scope, apply a named
transaction, set visible status, leave note, redirect, stop, and inspect/revert activity.

MCP maps requests to `DocumentSession`; it never writes the file, synthesizes UI input, or holds a
parallel document model.

### 2.2 Scoped coherent edit

- The human explicitly selects one range or whole blocks and invokes the agent.
- Nothing selected and no invocation means no work.
- The agent returns structured whole-block/coherent steps, not raw character offsets.
- Reject an edit that overlaps the active human block.
- Show one agent name, scope, status, and grouped Activity item. A decorative cursor is optional.

### 2.3 Communication and control

- Leave note records an anchored session message and changes no execution authority.
- Redirect increments the generation, fences the old run, and starts its replacement.
- Stop travels out of band and makes every later write from the stopped generation fail closed.
- `Cmd+Z` remains the human editor's undo; Activity deliberately reverts an agent transaction.

### 2.4 POC acceptance

Run all ten steps in `POC.md`, including a delayed-result test after Redirect and Stop, active-human
focus rejection, separate human undo/agent revert, and plain-text reopen.

## Deliverable 3: one-day product decision

Use one real architecture note for a full working day. Record only speed versus suggestions,
interrupts/redirects/pauses, distraction, and file trust. Choose one outcome:

- retain scoped live editing and authorize the multi-client authority spike;
- make suggest-first the default and keep live editing optional; or
- stop collaboration expansion and ship the notebook.

## Deferred plan: multi-client authority decision

If the one-day decision authorizes it, create a separate version-pinned plan for two ProseMirror
clients. Test a native ProseMirror step authority first using Pitter Patter Collab or
`prosemirror-collab-commit`. Compare Yjs only if truly masterless operation is required. Prove
structured convergence, schema and permission enforcement, anchors/decorations/NodeViews, separate
undo, disconnect/reconnect/contention retry, bounded history, checkpoint/compaction, and safe
source-baseline/save leadership. Passing the local POC proves none of these distributed properties.
