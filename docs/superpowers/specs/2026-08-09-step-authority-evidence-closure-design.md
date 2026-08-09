# Step-authority evidence closure — design

- **Status:** Approved design, ready for planning.
- **Date:** 2026-08-09
- **Switchboard task:** AUTHORITY-5
- **Depends on:** AUTHORITY-2
- **Scope:** Strengthen the disposable authority spike so its verdict covers the evidence AUTHORITY-2 promised but left open. No production authority behavior changes.
- **Companion to:** [ADR-0002](../../decisions/0002-local-document-session-before-crdt.md), [ADR-0006](../../decisions/0006-one-authoritative-change-stream.md), the [original spike plan](../plans/2026-08-09-step-authority-spike.md), and [AUTHORITY-2's result](../../../spike/authority-2/RESULT.md).

## 1. Outcome

AUTHORITY-2 proved that JSON ProseMirror steps can be parsed, applied, and
rebased headlessly against SimpleMark's real Milkdown schema. It deliberately
did not prove mounted NodeViews and decorations, multi-step transaction
rebasing, undo separation, reconnect/retry behavior, or representative
contention.

This follow-up closes those evidence gaps without pretending to ship
collaboration. It produces a stronger executable verdict that downstream work
can trust:

1. a real mounted SimpleMark editor survives remote structural changes without
   losing its diagram/math NodeViews or mapped decorations;
2. a transaction containing multiple dependent steps rebases as a unit;
3. human undo remains independent from a remote rebased batch;
4. a deterministic committed-step-log simulation handles stale clients,
   disconnect/reconnect, idempotent retry, contention, and authority restart;
5. conflicts that cannot be mapped refuse without mutating accepted state; and
6. RESULT.md distinguishes those proofs from the production work still owned
   by AUTHORITY-3, AUTHORITY-4, EDITOR-20, AGENT-5, and AGENT-6.

The product remains unchanged after this task. The value is risk retirement and
a trustworthy reference harness.

## 2. Chosen approach

Extend spike/authority-2/ with two bounded harnesses:

- a **mounted-view harness** that composes the same Milkdown schema, NodeViews,
  decorations, and history mechanisms used by the real editor; and
- an **in-memory authority simulator** that orders committed JSON step batches
  and persists only deterministic test state.

Keep the existing headless harness as the schema and transform core. Share
small helpers inside the spike rather than importing spike code into src/.
Production modules never depend on the spike.

### 2.1 Alternatives rejected

**Adopt Pitter Patter or prosemirror-collab-commit in the spike.** Rejected.
AUTHORITY-2 selected plain prosemirror-transform, and this follow-up is testing
the missing properties of that verdict. Adding another mechanism would answer
a different question and reintroduce peer-dependency risk without a product
requirement.

**Implement the real DocumentSession log here.** Rejected. AUTHORITY-4 owns
revision history, barriers, and application acceptance. Implementing them in
this task would create two competing designs while AUTHORITY-3 is already
building the application port.

**Call the existing headless fixture tests sufficient.** Rejected. They use
one insertion step per logical client, mount no view, create no real
decorations, and compare a saved copy of the input bytes rather than exercising
edited-file preservation.

## 3. Boundaries

### 3.1 May change

- spike/authority-2/**
- authority-spike tests
- spike/authority-2/RESULT.md
- the permanent Vitest inclusion only if a new spike test location requires it
- this specification and the implementation plan

### 3.2 Must not change

- src/application/** or DocumentSession
- application ports being built by AUTHORITY-3
- production editor transaction emission owned by EDITOR-20
- production transaction logs or barriers owned by AUTHORITY-4
- production agent revert owned by AGENT-5
- permissions, scope tokens, or generation fences owned by AGENT-6
- any UI, remote participant, network transport, relay, persistence provider,
  CRDT, or second process

If proving an item requires one of those production changes, the spike records
the limitation and leaves it with the named downstream task.

## 4. Mounted-view proof

### 4.1 Real surface

The mounted harness creates an actual Milkdown EditorView in the existing
browser-test environment. It uses the same schema extensions as MilkdownEditor
and real representative view behavior:

- one Mermaid code-block DiagramNodeView;
- one display or inline math NodeView;
- a folding or find decoration set; and
- ProseMirror history.

The harness may extract stable editor-adapter composition helpers only into
spike/authority-2/. It must not refactor the production editor merely to make
the spike convenient.

### 4.2 Remote change sequence

1. Parse a fixture containing ordinary prose, Mermaid, math, a table, a wiki
   link, and a highlight.
2. Mount the view and record NodeView identity plus decoration/selection
   anchors.
3. Create a remote JSON step batch against the same base document.
4. Rebase and apply the batch through a transaction marked as remote and
   excluded from human history.
5. Assert the document contains both edits.
6. Assert Mermaid and math still render through their expected NodeViews.
7. Assert decorations and selection anchors map to the intended content rather
   than disappearing or drifting.

The proof concerns survival and mapping, not pixel styling or renderer output
quality already covered by the browser suite.

## 5. Correct multi-step rebase

The original implementation maps every local step through only the committed
mapping. That is sufficient for its one-step scenarios but is not a complete
transaction-rebase proof.

The strengthened harness represents a local batch as sequential steps with
their original documents or inverse maps. Rebase must preserve the coordinate
relationship between dependent local steps while mapping them over the
committed batch. A test must fail against the old algorithm before the
replacement is accepted.

Required cases:

- two dependent local steps plus a non-overlapping committed edit;
- a local structural step followed by a text edit inside the new structure;
- multiple committed batches since the client's base version;
- a committed deletion that destroys a later local target;
- same-position insert contention with a deterministic order; and
- an overlapping replacement that refuses when intent cannot be preserved.

A failed batch is atomic: no prefix reaches accepted state.

## 6. Undo separation

Human history and remote authority history are separate evidence:

1. mount the editor with history enabled;
2. dispatch a human edit normally;
3. apply a rebased remote batch with addToHistory: false and a named remote
   transaction meta value;
4. invoke human undo;
5. verify the human edit is removed and the remote edit remains; and
6. invoke redo and verify only the human edit returns.

This proves editor-history separation only. Deliberate agent transaction revert
remains AGENT-5.

## 7. In-memory authority simulator

### 7.1 State

The simulator owns:

- one structured document;
- a monotonically increasing version;
- an ordered list of committed JSON step batches;
- a stable client-generated operation id for idempotency; and
- a serializable checkpoint containing the document, version, log, and
  operation ids.

It has no application imports, file writes, timers, sockets, or background
worker.

### 7.2 Submission

A client submits a client id, operation id, base version, and JSON step batch.
The simulator:

1. returns the prior result for a repeated operation id;
2. rejects an unknown future base version;
3. rebases a stale batch over every commit since its base;
4. commits the whole mapped batch once, advancing the version once; or
5. returns a typed refusal without changing document, version, log, or
   idempotency state.

### 7.3 Scenarios

- **Disconnect/reconnect:** one client retains a pending batch while another
  commits, then reconnects and rebases from its stale version.
- **Retry:** the response is lost and the same operation id is submitted
  again; the batch appears exactly once.
- **Contention:** two stale clients submit at the same base in both arrival
  orders; each order is deterministic and every accepted client converges on
  the authority result.
- **Authority restart:** serialize a checkpoint, create a fresh simulator, and
  continue with identical version, log, dedupe behavior, and document.
- **Destroyed target:** a stale batch whose target was deleted refuses, and
  the accepted checkpoint is byte-for-byte unchanged.

This models the protocol properties needed to assess the transform choice. It
does not claim crash-safe persistence, networking, authentication, permissions,
or multi-process behavior.

## 8. Fidelity evidence

The ten fixtures continue to prove schema coverage and logical convergence.
The revised result must stop presenting the copied raw baseline as evidence of
serializer fidelity.

Instead:

- keep the raw-baseline copy only as fixture provenance;
- assert the authority step affects the intended structured location;
- run the repository's existing untouched-save and dirty-block fidelity suites
  in the full gate; and
- state explicitly that production block-preserving materialization is
  unchanged and is not implemented by the spike.

No new serializer claim is introduced.

## 9. Failure model

All experimental APIs return discriminated results. Tests assert both the
reason and atomic state preservation.

| Failure | Result |
|---|---|
| malformed JSON step | invalid_step |
| invalid base or resulting schema | invalid_schema |
| future base version | invalid_version |
| mapped step loses its target | rebase_failed |
| ambiguous destructive overlap | rebase_failed |
| duplicate operation id with different payload | operation_conflict |

No exception, silent fallback, partial batch, or optimistic version increment
counts as a refusal.

## 10. Verification

Focused tests:

- headless multi-step and conflict tests;
- mounted NodeView/decoration tests;
- history-separation tests; and
- authority-simulator lifecycle tests.

Repository gates:

    npm ls prosemirror-model prosemirror-state prosemirror-transform
    npx vitest run spike/authority-2
    npx playwright test tests/ui/authority-spike.spec.ts
    PLAYWRIGHT_WORKERS=4 bash scripts/simplemark_ci.sh
    git diff --check

The PR result records exact counts and commands. A full green gate proves this
reference material did not regress the shipped reader/editor behavior; it does
not convert the spike into shipped collaboration.

## 11. Completion statement

AUTHORITY-5 is complete when the executable evidence above passes and
RESULT.md contains:

- the mechanism verdict;
- a table mapping every original AUTHORITY-2 promise to proven, refused,
  superseded, or downstream;
- exact test evidence;
- the remaining production boundary; and
- no claim that SimpleMark users can concurrently edit with an agent yet.
