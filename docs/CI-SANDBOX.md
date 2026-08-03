# CI sandbox (`simplemark-ci`)

SimpleMark keeps its canonical source on the **private** repo
[`6th-Element-Labs/simplemark`](https://github.com/6th-Element-Labs/simplemark). GitHub
Actions minutes are billed on private repos and free on public ones, so — exactly
as Helm and Switchboard already do — CI runs on a separate **public sandbox** that
holds the **full actual tree** and the **same workflows**.

| Repo | Role | Authority |
|---|---|---|
| `6th-Element-Labs/simplemark` | Canonical source, PRs, Switchboard merge webhook | `done` · `merge_provenance` · `code_truth` |
| `StevenRidder/simplemark-ci` | Public CI sandbox — push branches here first | `verification_only` |

The sandbox is **not** a product mirror. It is not scrubbed, its feature branches
are ephemeral, and it can never prove Done. Only a merge on the canonical repo can
(Switchboard `repo_topology`, `switchboard.project_repo_topology.v1`).

## Reference implementations

| Project | Canonical | Public CI | Required status |
|---|---|---|---|
| Switchboard | `6th-Element-Labs/projectplanner` | `6th-Element-Labs/projectplanner-ci` | `Switchboard CI / VM gate` |
| Helm | `StevenRidder/Helm` | `StevenRidder/helm-ci` | `helm-ci/full-suite` |
| SimpleMark | `6th-Element-Labs/simplemark` | `StevenRidder/simplemark-ci` | `gate` |

> **SimpleMark no longer gates on the sandbox status.** Canonical `main` requires
> `gate`, published by `.github/workflows/verify.yml` running on the canonical repo,
> and landing is owned by GitHub's native merge queue. `simplemark-ci/full-suite` is
> still what `ci-sandbox.sh` stamps, but nothing requires it. The sandbox is now an
> optional pre-PR proof, not the gate.

Switchboard uses the stricter variant: the canonical dispatcher mirrors an exact
SHA to a disposable `ci/**` tag and invokes a workflow that lives on the sandbox's
*trusted default branch*, so agent-authored workflow files on the mirrored branch
are never executed. SimpleMark uses the simpler Helm-style flow until it has a
fleet of agents authoring workflow changes; the upgrade path is
[`verify.yml` on projectplanner](https://github.com/6th-Element-Labs/projectplanner/blob/master/.github/workflows/verify.yml).

## One-time setup

From a SimpleMark checkout with `gh` authenticated as a user who can create repos
under `StevenRidder`:

```bash
gh repo create StevenRidder/simplemark-ci --public --description "Public CI sandbox for SimpleMark — full tree, GitHub Actions run here for free. Not a product mirror; feature branches are ephemeral."
```

Then wire the local checkout and seed the sandbox baseline:

```bash
scripts/ci-sandbox.sh setup && scripts/ci-sandbox.sh refresh-main
```

> **Do not run `scripts/ci-sandbox.sh protect-main` on SimpleMark.** It PUTs
> `required_status_checks.contexts = ["simplemark-ci/full-suite"]` on canonical
> `main`, which would replace the required `gate` context and break the merge-queue
> gate. It remains correct for a project whose sandbox status *is* the required one.

## Typical branch loop

```bash
git checkout -b claude/FOUNDATION-1-scaffold
```

Edit, commit, then run the local gate before spending any CI minutes:

```bash
bash scripts/simplemark_ci.sh
```

Prove the checkout is wired correctly:

```bash
scripts/ci-sandbox.sh doctor
```

Then push and open the PR against canonical. The `gate` check runs there, and the
merge queue runs the full scope on the commit that lands:

```bash
git push -u origin claude/FOUNDATION-1-scaffold && gh pr create --base main
```

To spend sandbox minutes instead of canonical ones, prove the SHA first. This
pushes to the sandbox, waits for green, pushes the exact SHA to canonical, stamps
`simplemark-ci/full-suite`, and opens the PR — one command:

```bash
scripts/ci-sandbox.sh open-pr claude/FOUNDATION-1-scaffold
```

That stamped status is evidence only; `gate` is still what `main` requires.

Sandbox branches are terminal-scoped, the same rule Switchboard's
`external_ci_mirror.py` enforces with `_cleanup_terminal_mirror_branch`: once the
run is terminal and the proof is stamped on the canonical SHA, the sandbox copy is
deleted automatically by `push`. A red run stays put for inspection; sweep leftovers
with:

```bash
scripts/ci-sandbox.sh prune     # delete merged sandbox branches
```

`prune` keeps any branch that still exists on the canonical repo. We squash-merge,
so a merged branch is deleted from `origin` and its original SHA is never an
ancestor of `main` — which makes "still on origin" the honest signal for "someone
may still be working on this". Deleting a live agent's sandbox branch mid-run
breaks their gate for no gain. `prune --all` overrides when you know the
remainder is abandoned.

After the PR merges, refresh the dispatch baseline:

```bash
scripts/ci-sandbox.sh refresh-main
```

## Why `workflow_dispatch` is mandatory

`ci-sandbox.sh push` dispatches each workflow in `SANDBOX_WORKFLOWS` by name and
then gates on `workflow_dispatch` runs whose `headSha` equals the exact local SHA.
A workflow without `workflow_dispatch:` can never be dispatched, so the proof never
completes and `prove` refuses to stamp. `ci-sandbox.sh doctor` fails on this.

## Current state

The gate is green. `FOUNDATION-1` landed the single root TypeScript package with
`typecheck`, `test`, and `check:boundaries` per
[ADR-0001](decisions/0001-single-product-modular-architecture.md), so
`scripts/simplemark_ci.sh` runs the real suite rather than failing with
`package.json is missing`.

Landing is owned by the canonical `gate` check and the native merge queue. The
sandbox path still works and is still worth using to keep private Actions minutes
down, but it no longer decides whether a PR can merge.
