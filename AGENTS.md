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
- The canonical repo `StevenRidder/simplemark` is the only `done` / `merge_provenance`
  / `code_truth` authority. `simplemark-ci` is `verification_only` and can never prove Done.
- Agents own their work end to end: open the PR, and once the required status is
  green, merge it. There is no human review step in this loop.
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

- **Fidelity (D7).** Untouched blocks re-emit their original bytes; only dirty blocks
  serialize. `originalSource` is an immutable save baseline, never collaborative content.
  `dirty` is monotonic until a successful atomic save.
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

CI runs on a public sandbox to keep Actions minutes free. See
[`docs/CI-SANDBOX.md`](docs/CI-SANDBOX.md); the whole branch loop is:

```bash
scripts/ci-sandbox.sh open-pr <branch>
```

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
