# CI sandbox (`simplemark-ci`)

SimpleMark keeps its canonical source on the **private** repo
[`StevenRidder/simplemark`](https://github.com/StevenRidder/simplemark). GitHub
Actions minutes are billed on private repos and free on public ones, so — exactly
as Helm and Switchboard already do — CI runs on a separate **public sandbox** that
holds the **full actual tree** and the **same workflows**.

| Repo | Role | Authority |
|---|---|---|
| `StevenRidder/simplemark` | Canonical source, PRs, Switchboard merge webhook | `done` · `merge_provenance` · `code_truth` |
| `StevenRidder/simplemark-ci` | Public CI sandbox — push branches here first | `verification_only` |

The sandbox is **not** a product mirror. It is not scrubbed, its feature branches
are ephemeral, and it can never prove Done. Only a merge on the canonical repo can
(Switchboard `repo_topology`, `switchboard.project_repo_topology.v1`).

## Reference implementations

| Project | Canonical | Public CI | Required status |
|---|---|---|---|
| Switchboard | `6th-Element-Labs/projectplanner` | `6th-Element-Labs/projectplanner-ci` | `Switchboard CI / VM gate` |
| Helm | `StevenRidder/Helm` | `StevenRidder/helm-ci` | `helm-ci/full-suite` |
| SimpleMark | `StevenRidder/simplemark` | `StevenRidder/simplemark-ci` | `simplemark-ci/full-suite` |

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

Finally, make the sandbox result binding on canonical `main`:

```bash
scripts/ci-sandbox.sh protect-main
```

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

Push to the sandbox, wait for green, push the exact SHA to canonical, stamp the
required status, and open the PR — one command:

```bash
scripts/ci-sandbox.sh open-pr claude/FOUNDATION-1-scaffold
```

Sandbox branches are terminal-scoped, the same rule Switchboard's
`external_ci_mirror.py` enforces with `_cleanup_terminal_mirror_branch`: once the
run is terminal and the proof is stamped on the canonical SHA, the sandbox copy is
deleted automatically by `push`. A red run stays put for inspection; sweep leftovers
with:

```bash
scripts/ci-sandbox.sh prune     # delete every sandbox branch except main
```

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

The gate is wired and deliberately **red**: `scripts/simplemark_ci.sh` fails with
`package.json is missing` because the product package does not exist yet. It goes
green when `FOUNDATION-1` (Scaffold the reusable SimpleMark product modules) lands
the single root TypeScript package with `typecheck`, `test`, and `check:boundaries`
scripts, per [ADR-0001](decisions/0001-single-product-modular-architecture.md).
