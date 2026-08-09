# AUTHORITY-2 / AUTHORITY-5 — step-authority evidence

## Verdict

AUTHORITY-5 closes the evidence gaps left by AUTHORITY-2. SimpleMark's headless
production-schema shape accepts JSON ProseMirror steps, correctly rebases
dependent sequential batches, refuses destructive ambiguity, and can deliver a
stale rebased remote batch into a mounted editor without losing NodeViews,
selection, decorations, or human undo/redo ownership.

This is evidence, not a new product feature. The lifecycle authority remains an
in-memory simulator under `spike/`, and the mounted page remains a browser test
harness. AUTHORITY-3's production `StepDocumentPort` landed separately on
`main`; AUTHORITY-5 neither implements nor claims provenance for it.

## Closure matrix

| Promise | Status | Executable evidence |
| --- | --- | --- |
| Real SimpleMark schema, including underline | Closed | `spike/authority-2/harness.test.ts` |
| Dependent multi-step and structural rebase | Closed | `spike/authority-2/harness.test.ts` |
| Same-position order and overlapping-replacement refusal | Closed | `spike/authority-2/harness.test.ts` |
| Atomic failure when a later step loses its target | Closed | `spike/authority-2/harness.test.ts` |
| Mounted stale-remote rebase with named remote metadata | Closed | `tests/ui/authority-spike.spec.ts` |
| NodeView, selection, find, and folding survival | Closed | `tests/ui/authority-spike.spec.ts` |
| Human undo and redo remain separate from remote history | Closed | `tests/ui/authority-spike.spec.ts` |
| Retry, reconnect, both contention orders, and restart continuation | Closed | `spike/authority-2/authority-simulator.test.ts` |
| Destroyed target preserves checkpoint and mounted cleanup | Closed | simulator and browser authority tests |
| Untouched-source fidelity | Closed by existing owner | source-map, application-save, and browser fidelity tests |
| Production application port | Separately landed | AUTHORITY-3; not AUTHORITY-5 evidence |
| Durable log, network, second process, or CRDT | Open / out of scope | AUTHORITY-4 and later decisions |

## Step application and rebasing

`spike/authority-2/harness.test.ts` uses the same schema extensions as the
production headless adapter, including highlight, underline, GFM, math, large
tables, wiki links, callouts, and code-fence metadata. Its 18 tests prove:

- JSON step decoding and typed rejection of malformed steps;
- non-overlapping text and structural changes remain schema-valid;
- sequential local steps are decoded against the document created by the prior
  step, then rebased using inverse-local, committed, and mapped-local maps;
- a text edit created inside a preceding structural step keeps its target;
- same-position insertion order follows authority arrival;
- overlapping replacement ranges refuse with `rebase_failed` rather than
  concatenating incompatible intent;
- deleting a later local target returns no accepted document or step prefix.

## Mounted editor behavior

`tests/ui/authority-spike.spec.ts` mounts a real `EditorView` with the production
`DiagramNodeView`, `InlineMathNodeView`, folding plugin, find plugin, and
ProseMirror history. The scenario creates remote steps against an earlier base,
dispatches an intervening human batch, rebases the stale remote batch, and
applies its mapped steps with `addToHistory: false` plus the named
`simplemark-authority-remote` receipt.

The three browser tests prove:

- Mermaid, block-math, and inline-math NodeViews retain DOM identity;
- selection remains on `search target`, find still decorates that text, and the
  folding widget remains attached to its heading;
- the final document contains both the intervening human edit and rebased remote
  edit;
- undo removes only the human edit, redo restores only it, and the remote edit
  survives both operations;
- destroying the mounted target rejects a late batch, retains the last captured
  document, removes body-level source sheets, and leaves no NodeView DOM.

## Retry, reconnect, restart, and contention

`spike/authority-2/authority-simulator.test.ts` drives the test-only in-memory
authority through logical clients. Its 10 tests prove:

- a fresh batch advances version and log exactly once;
- a stale batch rebases over every commit since its base version;
- an identical operation retry returns the prior result without duplication;
- operation-ID reuse with a different payload returns `operation_conflict` and
  changes no state;
- same-position contenders are deterministic in both arrival orders;
- a JSON checkpoint restores document snapshots, version, accepted-step log,
  and retry identity, then accepts a new post-restart commit;
- a disconnected client resumes from an older known version;
- future versions and malformed batches leave all authority state unchanged;
- a stale batch whose target was destroyed refuses while the serialized accepted
  checkpoint remains byte-for-byte identical.

These are deterministic single-process semantics. They are not evidence of
network or durable-storage behavior.

## Fidelity evidence

The authority harness records `untouchedRawBaseline` before parsing. That copy
proves fixture provenance only; it is not a serializer claim.

Portable Markdown fidelity is owned by the existing application and domain
path:

- `tests/domain/source-map.test.ts` proves untouched emission is byte-identical
  and dirty-block emission preserves untouched neighboring bytes;
- `tests/application/save-preserves-untouched-blocks.test.ts` proves save uses
  that preservation path;
- `tests/ui/fidelity.spec.ts` drives the real editor bridge across all ten §12
  fixtures, including CRLF and missing-final-newline hostility.

The known reference-link block-index fallback remains pinned by the browser
suite; AUTHORITY-5 does not claim to solve it.

## AUTHORITY-5 executed evidence

Executed on the clean rebased branch on 2026-08-09:

```text
npm ls @milkdown/kit prosemirror-model prosemirror-state prosemirror-history prosemirror-transform
@milkdown/kit 7.21.3; model 1.25.11; state 1.4.4; history 1.5.0;
transform 1.12.0; one deduplicated core dependency tree

npx vitest run spike/authority-2
3 files passed; 38 tests passed

npx playwright test tests/ui/authority-spike.spec.ts tests/ui/fidelity.spec.ts
25 tests passed

npm run build
PASS; authority spike emitted as dist/spike/authority-2/index.html

bash scripts/simplemark_ci.sh
full scope passed: clean tree, public-mirror hygiene, typecheck, 100 unit-test
files / 892 tests, boundaries, build, and 390 browser tests; 0 failures

git diff --check
PASS; no output
```

Independent review found no Critical issue. Its Important findings—fresh rather
than stale mounted application, missing redo/adversarial scenarios, underline
schema drift, and incomplete evidence accounting—were reproduced and closed
before the final commands above.

## Preserved AUTHORITY-2 record

AUTHORITY-2's original 2026-08-09 result remains part of the evidence history:

- `npx vitest run spike/authority-2`: 2 files and 22 tests passed across all ten
  fidelity fixtures. Each fixture parsed, accepted independently generated JSON
  insertion steps, rebased both client orders, converged, and serialized the
  edited marker.
- `npm ls prosemirror-model prosemirror-state prosemirror-transform`: one
  deduplicated resolved copy of model `1.25.11`, state `1.4.4`, and transform
  `1.12.0`.
- `npm run typecheck`, `npm run check:boundaries`, and `git diff --check` passed;
  the boundary check reported 252 modules and 435 dependencies.
- That result explicitly did not prove mounted views, history ownership,
  reconnect/retry/contention, arbitrary conflicts, source-preserving edited-file
  writes, or raw serializer equality. AUTHORITY-5 closes only the items named in
  the matrix above.

## Still not proven or implemented by AUTHORITY-5

- AUTHORITY-3's separately landed production port is not validated merely by
  this spike; it has its own tests and merge provenance.
- AUTHORITY-4's durable committed-step log and restart from durable storage.
- A second process, socket, unreliable network, delivery acknowledgment, or a
  crash between persistence and response.
- CRDT behavior or a later multi-client authority decision.
- Provider/model/key design, participant provenance, agent operations, or the
  AGENT-5/AGENT-6 workflow.
- General semantic merge resolution. This spike deliberately refuses overlapping
  replacements, destroyed targets, and unmappable steps.
- Any new user-facing behavior. This evidence lowers implementation risk; by
  itself it does not change what a SimpleMark user can do.
