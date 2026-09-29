# Public-only CI sandbox

The private `6th-Element-Labs/simplemark` repository owns source and merge
provenance. The existing public `StevenRidder/simplemark-ci` repository executes
all CI. This is the owner's policy, restored on 2026-09-30 after private Actions
workflows caused unapproved charges. Public CI is mandatory, not optional.

Private `verify.yml` and `native-testbuild.yml` are disabled in GitHub settings.
Their job conditions also reject private repositories before allocating runners.
Never re-enable them or introduce another private CI workflow.

## Branch and merge queue loop

Run the local gate first, then:

```bash
scripts/ci-sandbox.sh setup
scripts/ci-sandbox.sh open-pr <branch>
scripts/ci-sandbox.sh queue <PR-number>
```

`open-pr` mirrors the exact source SHA, dispatches `verify.yml` in the public
sandbox, waits for actual success, pushes that same SHA to canonical, and posts
`simplemark-ci/full-suite`. Canonical `main` requires this status.

`queue` keeps GitHub's native merge queue: it waits for the PR's synthetic
`gh-readonly-queue/main/pr-<number>-*` ref, mirrors that exact commit to an ephemeral
public branch, executes the full public verification, and stamps success only
on the still-current merge-group SHA. Failure, cancellation, missing evidence,
a private sandbox, or a changed SHA cannot pass the gate. Keep it running until
GitHub merges the PR. Re-run it if interrupted. It needs Python 3 and the same
GitHub CLI access already used by `open-pr`; no new hosted credential is required.

For an already-open PR:

```bash
scripts/ci-sandbox.sh push <branch>
scripts/ci-sandbox.sh queue <PR-number>
```

After merge, `scripts/ci-sandbox.sh refresh-main` refreshes the public baseline.
`prune` removes branches no longer present in canonical; do not prune live work.

## Native checks and installers

`native-testbuild.yml` runs on qualifying public mirror pushes and public manual
dispatches. It retains the four native desktop builds and iOS compile check,
verifies installer formats on the runner, and uploads diagnostic logs for seven
days. It does **not** upload unsigned installers from the public repository.
Private test-installer uploads are superseded by the public-only CI policy.
Product releases remain governed by `RELEASE-CONTRACT.md` and `RELEASE-TRUST.md`.

## Enforcement and recovery

The sandbox helper refuses a private CI target. The workflows reject private
execution at job level. The private workflow disable switches are the immediate
billing stop. Preserve both layers. `protect-main` requires executed evidence
before changing protection; matching repository refs alone cannot create proof.

If CI fails, inspect the public run and fix the canonical source. Do not turn
private Actions back on, remove the required status, or manufacture a green check.
