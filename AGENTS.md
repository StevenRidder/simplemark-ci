# SimpleMark contributor and agent guide

This is the repository front door. [`README.md`](README.md) says what SimpleMark is;
this file says how to change it.

## Read first

1. [`docs/PRODUCT.md`](docs/PRODUCT.md) — the current job, product boundary, sequencing, UI rules,
   demo, and language. Product work must make this experience stronger.
2. [`docs/DESIGN.md`](docs/DESIGN.md) — the notebook: architecture, the D1–D7 decisions,
   the paste pipeline, and the §12 go/no-go spike.
3. [`docs/decisions/`](docs/decisions/) — accepted architecture. **ADR-0001** (one repo,
   one package, enforced module boundaries) and **ADR-0002** (local `DocumentSession`
   before any CRDT) remain load-bearing; **ADR-0005** makes the rendered-document proof precede
   in-app agent participation.
   **ADR-0006** requires source-specific adapters to converge on one authoritative accepted-change
   stream while keeping provenance and platform capabilities honest.
   **ADR-0011** stores anchored comments beside a writable document and links them from front matter.
4. [`docs/POC.md`](docs/POC.md) — the next executable target and its ten-step acceptance test.
5. [`docs/superpowers/plans/`](docs/superpowers/plans/) — executable implementation plans.

Read only the specs relevant to the surface being changed. If accepted architecture,
executable enforcement, and current code disagree, surface the conflict — do not
silently pick whichever source makes the change easiest.

## Board and provenance

Work is tracked on the Switchboard project **`simplemark`** (`plan.taikunai.com`).
Every MCP call must pass `project="simplemark"`; the local server config is in
[`.mcp.json`](.mcp.json).

- Fetch the live working agreement (`get_working_agreement`) at session start. It
  overrides anything written here about workflow and provenance.
- The canonical repo `6th-Element-Labs/simplemark` is the only `done` / `merge_provenance`
  / `code_truth` authority. `simplemark-ci` is `verification_only` and can never prove Done.
- Agents own their work end to end: open the PR, and once the required status is
  green, add it to the GitHub merge queue. GitHub runs the full gate on the
  merge-group commit and owns landing. There is no human review step in this loop.
- **Repository admins may bypass the queue and the `gate` check** and push directly
  to `main`. This exists so documentation and administrative changes are not held
  behind a four-platform build. It is not a shortcut for source changes: anything
  touching `src/`, `src-tauri/`, or `tests/` goes through the PR and the queue like
  always, because the bypass skips the gate rather than passing it. Non-admins are
  unaffected and the queue remains the only path for them.
- `complete_claim(evidence=...)` with branch, head SHA, and PR URL moves the task to
  In Review; Done is then stamped from merge provenance on the default branch. That
  is a bookkeeping distinction, not a gate — merging is what produces the provenance.
- Code tasks on this board carry `policy_profile:code_strict` — a bound, clean work
  session with pushed branch and executed tests is required before completion.

## Non-negotiable architecture

From ADR-0001. Dependency direction is one-way:

```text
app ──> adapters ──> application ──> domain
                          ^
                          │
              UI and MCP call the same use cases
```

- `domain` imports no framework, DOM, Tauri, filesystem, MCP, or CRDT API. It owns
  untouched-source preservation, dirty-block serialization, run generations, and `mayApply`.
- `application` imports only `domain`. It defines ports and owns `DocumentSession`:
  open, save, invoke agent, apply transaction, leave note, redirect, stop, revert.
- `adapters` implement application ports and never call one another's private code.
- `app` is the only composition root. `browser.ts` and `tauri.ts` contain platform
  wiring only — no document rule may live in an entrypoint.
- Tauri commands and MCP tools are thin transports. Neither edits editor state,
  future CRDT state, or files directly.
- No `pnpm-workspace.yaml`, no `packages/`, no per-module manifest. One root package.

Further invariants:

- **Rendered document first (ADR-0005).** The install reason is reading and judging AI-generated
  Markdown as a beautiful living document. Raw source, agent controls, collaboration, sessions,
  and activity do not occupy the default surface. Editing is contextual; agent participation is a
  later gate.
- **Annotation is decomposed (ADR-0007).** Agent participation is A→B→C0→C→D, not one step. A and B
  — a person's own anchored notes, and resolving them — introduce no participant and ship ahead of
  the `POC.md` reader trial. C0 (provider, model, key) is an unresolved design problem that gates
  everything with an agent in it. Threads for a writable document live in `.simplemark/` beside
  the file, linked from front-matter `comments:` ([ADR-0011](docs/decisions/0011-comments-travel-beside-the-document.md));
  comment bodies are never written into the `.md`. Note anchors are text;
  participant anchors stay opaque and authority-issued — do not merge the two.

- **Fidelity (D7).** Untouched blocks re-emit their original bytes; only dirty blocks
  serialize. `originalSource` is an immutable save baseline, never collaborative content.
  `dirty` is monotonic until a successful atomic save.
- **One accepted-change stream (ADR-0006).** Human editor steps, participant operations, remote
  steps, and external bytes need different adapters, but only the application authority accepts a
  document change. Never guess an external writer's identity or infer a shared cloud root from a
  provider name or path.
- **No Yjs in Phase 1** (ADR-0002). The multi-client authority decision is a later,
  version-pinned spike gated on the one-day dogfood result.
- **Communication is not control.** A message saying "stop" posts a message. The Stop
  control bumps the run generation; that is what stops an agent. Never wire the causal
  path through text. See [`docs/SWITCHBOARD-KERNEL.md`](docs/SWITCHBOARD-KERNEL.md) §5.
- **Atomic writes only:** temp file in the same directory, `fsync`, `rename()`.
- **Failures are visible and local.** No silent fallbacks, no blank rectangles, no
  turning missing evidence into a green result.

## Coding rules

- Node 20+ (CI pins 22), TypeScript strict mode, no `any` in exported signatures.
- Use explicit imports. Imports of another module's internal paths are forbidden.
- Sniffers validate by parsing and never throw.
- Every renderer saves a portable Markdown fallback.
- Do not create a generic `utils/` dumping ground; shared behavior moves downward only
  when it is a real, stable rule.
- Do not renumber or rewrite accepted ADR history as drive-by cleanup. Add an explicit
  supersession record.

## Validation

The canonical gate — run it locally before pushing; CI runs the identical script:

```bash
bash scripts/simplemark_ci.sh
```

For documentation-only changes, at minimum run `git diff --check` and verify local
Markdown links when changing document paths.

The macOS shell is **not** covered by that gate. CI runs on Linux, where no Apple
toolchain exists, so a native step there could never mean what it says. Changes
under `src-tauri/` are proven locally and the result recorded as task evidence:

```bash
npm run test:native      # cargo test — the Rust boundary's own contract
npm run build:native     # a real .app bundle
```

Nothing in `src-tauri/` may hold a document rule, so a native-only regression is
a transport bug by construction; the shared modules the gate does cover are the
same ones the native shell loads.

## Public-only CI (owner policy, 2026-09-30)

All CI runs on the existing **public** `StevenRidder/simplemark-ci` sandbox.
Never enable private `verify.yml` or `native-testbuild.yml`, add private CI jobs,
or change the required check back to the private Actions `gate`.
Release and promotion execution also runs on public standard runners in `6th-Element-Labs/projectplanner-ci`; the private release workflows are retired and guarded against runner allocation. Canonical source, release authority, and unsigned draft assets remain in `6th-Element-Labs/simplemark`.

Canonical `main` requires `simplemark-ci/full-suite`, posted only after an executed
full public workflow passes for the exact canonical SHA. Matching refs, skipped
jobs, cancelled runs, or a green result for another SHA are not proof.

Use the sandbox helper from the canonical checkout:

```bash
scripts/ci-sandbox.sh open-pr <branch>
scripts/ci-sandbox.sh queue <PR-number>
```

The first command verifies the PR head publicly and stamps its canonical status.
The second enqueues the PR, mirrors GitHub's exact synthetic merge-group SHA,
runs the full public suite, and posts that SHA's result before GitHub lands it.
Keep this command running through the merge; a plain `gh pr merge --auto` does not
provide the merge-group proof. The native merge queue remains enabled.

Native desktop and iOS checks run only on public mirror pushes or public manual
dispatches. CI verifies generated installers but uploads only diagnostic logs;
unsigned test installers are not published. See [docs/CI-SANDBOX.md](docs/CI-SANDBOX.md).

## Where information belongs

| Information | Home |
|---|---|
| What the product is and its status | `README.md` |
| Current user, job, product boundary, sequencing, and language | `docs/PRODUCT.md` |
| Durable architectural choice and rejected alternatives | `docs/decisions/` |
| Current coding and placement rules | this file |
| Product or protocol contract | the relevant spec under `docs/` |
| What a build-and-release workflow must do | `docs/RELEASE-CONTRACT.md` |
| Executable sequence for a phase | `docs/superpowers/plans/` |
| Temporary execution sequence | the Switchboard `simplemark` board |
| Spike evidence and verdicts | `spike/<name>/RESULT.md` |
