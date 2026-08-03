#!/usr/bin/env bash
# Public CI sandbox helpers for SimpleMark.
#
# The canonical tree lives on a PRIVATE repo (6th-Element-Labs/simplemark), where
# GitHub Actions minutes are billed. The sandbox is a separate PUBLIC repo with
# the full actual tree and the same workflows, where Actions minutes are free.
#
# Flow: push the branch to the sandbox -> dispatch workflows -> wait for green ->
# push the exact same SHA to the canonical repo -> stamp the required canonical
# status -> open the PR. Only the canonical repo can prove Done (Switchboard
# repo_topology: canonical = done/merge_provenance/code_truth; public_ci =
# verification_only).
#
# Requires: git, gh (authenticated), jq, column, network.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CI_REPO="${CI_REPO:-StevenRidder/simplemark-ci}"
CI_REMOTE="${CI_REMOTE:-ci}"
CI_REMOTE_URL="${CI_REMOTE_URL:-https://github.com/${CI_REPO}.git}"
CANONICAL_REPO="${CANONICAL_REPO:-6th-Element-Labs/simplemark}"
ORIGIN_REMOTE="${ORIGIN_REMOTE:-origin}"
WAIT_TIMEOUT_SEC="${WAIT_TIMEOUT_SEC:-3600}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-20}"
MAIN_REF="${MAIN_REF:-origin/main}"
SANDBOX_WORKFLOWS="${SANDBOX_WORKFLOWS:-verify.yml}"
STATUS_CONTEXT="${STATUS_CONTEXT:-simplemark-ci/full-suite}"

die() {
  echo "ci-sandbox: $*" >&2
  exit 1
}

need_tools() {
  command -v git >/dev/null || die "git is required"
  command -v gh >/dev/null || die "GitHub CLI gh is required (https://cli.github.com/)"
  command -v jq >/dev/null || die "jq is required"
  command -v column >/dev/null || die "column is required"
}

repo_root() {
  git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "run from the SimpleMark git worktree"
}

remote_url() {
  git -C "$ROOT" remote get-url "$CI_REMOTE" 2>/dev/null || true
}

ensure_remote() {
  if [ -n "$(remote_url)" ]; then
    return 0
  fi
  echo "ci-sandbox: adding git remote '$CI_REMOTE' -> $CI_REMOTE_URL"
  git -C "$ROOT" remote add "$CI_REMOTE" "$CI_REMOTE_URL"
}

ensure_repo() {
  if gh repo view "$CI_REPO" --json nameWithOwner >/dev/null 2>&1; then
    return 0
  fi
  cat >&2 <<EOF
ci-sandbox: $CI_REPO does not exist.

Creating it makes the full SimpleMark tree PUBLIC. That is the deliberate trade
Helm and Switchboard already make (free Actions minutes on a public sandbox),
but it is an owner decision, not something this script does silently.

Create it once, as the repo owner:

  gh repo create $CI_REPO --public \\
    --description "Public CI sandbox for SimpleMark — full tree, GitHub Actions run here for free. Not a product mirror; feature branches are ephemeral."

Then:

  scripts/ci-sandbox.sh setup
  scripts/ci-sandbox.sh refresh-main
EOF
  die "missing CI sandbox repo $CI_REPO"
}

current_branch() {
  git -C "$ROOT" branch --show-current
}

resolve_branch() {
  local branch="${1:-}"
  if [ -z "$branch" ]; then
    branch="$(current_branch)"
  fi
  [ -n "$branch" ] || die "could not determine branch; pass one explicitly"
  if [ "$branch" = "HEAD" ]; then
    die "detached HEAD; checkout a branch first"
  fi
  printf '%s' "$branch"
}

usage() {
  cat <<EOF
Usage: scripts/ci-sandbox.sh <command> [options] [branch]

Commands:
  setup                 Verify $CI_REPO exists and add git remote '$CI_REMOTE'
  push [--no-wait]      Push <branch>, dispatch, wait; the sandbox copy is deleted
       [--keep]         once the canonical proof is stamped, and kept otherwise
                        because its run is the evidence 'prove' reads (--keep
                        always retains it)
  wait                  Wait for in-progress Actions on <branch> (default: current)
  status                Print recent Actions conclusions for <branch> (default: current)
  prove                 Stamp the canonical status after the exact SHA passed the sandbox
  doctor                Verify repo/remote/workflow/baseline/branch wiring
  protect-main          Require the sandbox status before canonical main can move
  delete                Delete <branch> from the CI sandbox remote
  prune [--all]         Delete merged sandbox branches; keeps any still open on
                        the canonical repo unless --all is given
  sync-main             Push local main to the CI sandbox (refresh baseline after merges)
  refresh-main          Fetch canonical main, then sync it to the CI sandbox
  open-pr               Push/wait on sandbox, push canonical, stamp, then open the PR

Environment:
  CI_REPO               Sandbox repo (default: $CI_REPO)
  CI_REMOTE             Git remote name (default: $CI_REMOTE)
  CI_REMOTE_URL         Sandbox clone URL (default: derived from CI_REPO)
  CANONICAL_REPO        PR target (default: $CANONICAL_REPO)
  ORIGIN_REMOTE         Canonical git remote name (default: $ORIGIN_REMOTE)
  WAIT_TIMEOUT_SEC      Max wait for Actions (default: $WAIT_TIMEOUT_SEC)
  POLL_INTERVAL_SEC     Poll interval while waiting (default: $POLL_INTERVAL_SEC)
  MAIN_REF              Ref to seed sandbox main from (default: $MAIN_REF)
  SANDBOX_WORKFLOWS     Space-separated workflow files to dispatch after push
  STATUS_CONTEXT        Canonical required status context (default: $STATUS_CONTEXT)

Typical loop:
  scripts/ci-sandbox.sh setup
  scripts/ci-sandbox.sh doctor
  git checkout -b claude/FOUNDATION-1-scaffold
  # ... edit, commit ...
  scripts/ci-sandbox.sh open-pr claude/FOUNDATION-1-scaffold
  # after merge:
  scripts/ci-sandbox.sh refresh-main
  scripts/ci-sandbox.sh delete claude/FOUNDATION-1-scaffold

See docs/CI-SANDBOX.md.
EOF
}

cmd_setup() {
  need_tools
  repo_root
  ensure_repo
  ensure_remote
  echo "ci-sandbox: ready — remote '$CI_REMOTE' -> $(remote_url)"
  echo "ci-sandbox: next: scripts/ci-sandbox.sh refresh-main   # once, to seed main"
}

workflow_count() {
  set -- $SANDBOX_WORKFLOWS
  printf '%s' "$#"
}

actions_url() {
  local branch="$1"
  local encoded="${branch//\//%2F}"
  printf 'https://github.com/%s/actions?query=branch%%3A%s' "$CI_REPO" "$encoded"
}

dispatch_workflows() {
  local branch="$1"
  local workflow
  echo "ci-sandbox: dispatching workflows on $CI_REPO@$branch"
  for workflow in $SANDBOX_WORKFLOWS; do
    echo "ci-sandbox: gh workflow run $workflow --ref $branch"
    gh workflow run "$workflow" --repo "$CI_REPO" --ref "$branch"
  done
}

list_runs_json() {
  local branch="$1"
  gh run list \
    --repo "$CI_REPO" \
    --branch "$branch" \
    --limit 30 \
    --json databaseId,name,status,conclusion,createdAt,event,headSha \
    2>/dev/null || printf '[]'
}

matching_runs_for_sha_json() {
  local branch="$1" sha="$2"
  list_runs_json "$branch" | jq --arg sha "$sha" '[.[] | select(.headSha == $sha and .event == "workflow_dispatch")]'
}

latest_runs_by_workflow_for_sha_json() {
  local branch="$1" sha="$2"
  matching_runs_for_sha_json "$branch" "$sha" | jq 'sort_by(.name, .createdAt) | group_by(.name) | map(max_by(.createdAt))'
}

assert_sandbox_green_for_sha() {
  local branch="$1" sha="$2"
  local matching matching_count pending failed required
  required="$(workflow_count)"
  matching="$(latest_runs_by_workflow_for_sha_json "$branch" "$sha")"
  matching_count="$(printf '%s' "$matching" | jq 'length')"
  if [ "$matching_count" -lt "$required" ]; then
    return 10
  fi
  pending="$(printf '%s' "$matching" | jq '[.[] | select(.status != "completed")] | length')"
  if [ "$pending" != "0" ]; then
    return 11
  fi
  failed="$(printf '%s' "$matching" | jq '[.[] | select(.conclusion != "success" and .conclusion != "skipped")] | length')"
  if [ "$failed" != "0" ]; then
    return 12
  fi
  return 0
}

set_canonical_status() {
  local sha="$1" state="$2" description="$3" target_url="$4"
  echo "ci-sandbox: setting $CANONICAL_REPO status $STATUS_CONTEXT=$state on ${sha:0:12}"
  gh api "repos/${CANONICAL_REPO}/statuses/${sha}" \
    -f state="$state" \
    -f context="$STATUS_CONTEXT" \
    -f description="$description" \
    -f target_url="$target_url" >/dev/null
}

canonical_status_state() {
  local sha="$1" jq_filter
  jq_filter='[.statuses[]? | select(.context == "'"$STATUS_CONTEXT"'") | .state][0] // ""'
  gh api "repos/${CANONICAL_REPO}/commits/${sha}/status" --jq "$jq_filter" 2>/dev/null
}

# Prints the remote SHA, or nothing when the remote is unreachable/unauthenticated.
# Never propagates git's failure: under `set -e -o pipefail` a bare `git ls-remote |
# awk` in a command substitution kills the whole script, so `doctor` would abort
# mid-report instead of listing the wiring problem it exists to find.
ls_remote_sha() {
  local remote="$1" ref="$2"
  { GIT_TERMINAL_PROMPT=0 git -C "$ROOT" ls-remote "$remote" "$ref" 2>/dev/null || true; } | awk '{print $1}'
}

# Returns 0 only when the proof is actually stamped on the canonical SHA, so the
# caller can gate sandbox cleanup on it. Returning success here without stamping
# is what let `open-pr` delete the ref its own next step needed.
maybe_stamp_existing_canonical_branch() {
  local branch="$1" sha origin_branch
  sha="$(git -C "$ROOT" rev-parse "$branch")"
  origin_branch="$(ls_remote_sha "$ORIGIN_REMOTE" "refs/heads/$branch")"
  if [ "$origin_branch" = "$sha" ]; then
    cmd_prove "$branch"
    return 0
  fi
  echo "ci-sandbox: $STATUS_CONTEXT not stamped yet; push the exact SHA to $CANONICAL_REPO and run: scripts/ci-sandbox.sh prove $branch"
  return 1
}

# The sandbox copy is disposable only once the proof exists on the canonical SHA.
# Deleting it earlier destroys the evidence `prove` reads — and `prove` is the
# only thing that can turn a green sandbox run into a canonical status.
cleanup_sandbox_branch() {
  local branch="$1"
  [ "$branch" != "main" ] || return 0
  echo "ci-sandbox: proof stamped — deleting ephemeral $CI_REPO:$branch"
  git -C "$ROOT" push "$CI_REMOTE" --delete "$branch" \
    || echo "ci-sandbox: WARNING: cleanup push failed; run 'scripts/ci-sandbox.sh prune' later"
}

summarize_runs() {
  local branch="$1" event_filter="${2:-}" json
  json="$(list_runs_json "$branch")"
  if [ "$json" = "[]" ] || [ -z "$json" ]; then
    echo "ci-sandbox: no Actions runs yet for branch '$branch' on $CI_REPO"
    return 1
  fi
  printf '%s\n' "$json" | jq -r --arg event "$event_filter" '
    sort_by(.createdAt) | reverse | .[]
    | select(($event == "") or (.event == $event)) |
    [ (.conclusion // .status), .name, (.headSha[0:12] // "?"), .event, .createdAt ]
    | @tsv' | column -t -s $'\t'
}

wait_for_runs() {
  local branch="$1" event_filter="${2:-}" since="${3:-}" required_count="${4:-1}"
  local deadline=$(( $(date +%s) + WAIT_TIMEOUT_SEC ))
  local head_sha
  head_sha="$(git -C "$ROOT" rev-parse "$branch")"

  echo "ci-sandbox: waiting for Actions on $CI_REPO@$branch (${head_sha:0:12}), timeout ${WAIT_TIMEOUT_SEC}s"

  while [ "$(date +%s)" -lt "$deadline" ]; do
    local json matching pending matching_count failed
    json="$(list_runs_json "$branch")"
    matching="$(printf '%s' "$json" | jq \
      --arg sha "$head_sha" --arg event "$event_filter" --arg since "$since" \
      '[.[] | select(.headSha == $sha)
        | select(($event == "") or (.event == $event))
        | select(($since == "") or (.createdAt >= $since))]')"
    matching_count="$(printf '%s' "$matching" | jq 'length')"
    pending="$(printf '%s' "$matching" | jq '[.[] | select(.status != "completed")] | length')"

    if [ "$matching_count" -lt "$required_count" ]; then
      echo "ci-sandbox: found $matching_count/$required_count gated run(s) for ${head_sha:0:12}; sleeping ${POLL_INTERVAL_SEC}s"
      sleep "$POLL_INTERVAL_SEC"
      continue
    fi

    if [ "$pending" = "0" ]; then
      # `cancelled` is not a failure. verify.yml sets concurrency with
      # cancel-in-progress, so dispatching on a ref that also received a push
      # deliberately kills the older run — counting that as red reports a
      # failure for a commit that is green, and a tool that cries wolf gets
      # ignored. A cancelled run is absent evidence, so it cannot make the
      # branch green either: at least one genuine success is still required.
      local failed superseded succeeded
      failed="$(printf '%s' "$matching" | jq '[.[] | select(.conclusion != "success" and .conclusion != "skipped" and .conclusion != "cancelled")] | length')"
      superseded="$(printf '%s' "$matching" | jq '[.[] | select(.conclusion == "cancelled")] | length')"
      succeeded="$(printf '%s' "$matching" | jq '[.[] | select(.conclusion == "success")] | length')"
      echo ""
      summarize_runs "$branch" || true
      if [ "$failed" != "0" ]; then
        die "CI sandbox failed ($failed run(s) not success/skipped/cancelled) — see $(actions_url "$branch")"
      fi
      if [ "$succeeded" = "0" ]; then
        die "no successful run for ${head_sha:0:12} ($superseded cancelled) — see $(actions_url "$branch")"
      fi
      if [ "$superseded" != "0" ]; then
        echo "ci-sandbox: $superseded run(s) superseded by a newer run for the same ref (concurrency), not counted as failures"
      fi
      echo "ci-sandbox: all Actions green for ${head_sha:0:12} on $CI_REPO"
      return 0
    fi

    echo "ci-sandbox: $pending run(s) still in progress..."
    sleep "$POLL_INTERVAL_SEC"
  done

  summarize_runs "$branch" || true
  die "timed out waiting for CI sandbox runs on $branch"
}

cmd_push() {
  local wait=1 dispatch=1 keep=0 stamp=1 branch=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --no-wait) wait=0; shift ;;
      --no-dispatch) dispatch=0; shift ;;
      --keep) keep=1; shift ;;
      # Internal, for cmd_open_pr: verify on the sandbox but leave stamping and
      # cleanup to the caller, which has to push the canonical branch first.
      --no-stamp) stamp=0; shift ;;
      -h|--help) usage; exit 0 ;;
      *) branch="$(resolve_branch "$1")"; shift ;;
    esac
  done
  branch="$(resolve_branch "$branch")"

  need_tools
  repo_root
  ensure_repo
  ensure_remote

  local sha dispatch_since=""
  sha="$(git -C "$ROOT" rev-parse "$branch")"
  echo "ci-sandbox: pushing $branch @ ${sha:0:12} -> $CI_REPO"
  # Deliberately no -u. The sandbox is a disposable verification target, never a
  # branch's upstream: `prove` resolves the canonical SHA through $ORIGIN_REMOTE,
  # and the code_strict work-session policy expects upstream to be the canonical
  # repo. `-u` here would repoint the branch at the sandbox — and for `main` it
  # would silently detach the local branch from origin. Only cmd_open_pr sets an
  # upstream, and it sets origin.
  git -C "$ROOT" push "$CI_REMOTE" "refs/heads/${branch}:refs/heads/${branch}"

  if [ "$dispatch" = 1 ]; then
    dispatch_since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    dispatch_workflows "$branch"
  fi

  if [ "$wait" = 1 ]; then
    if [ "$dispatch" = 1 ]; then
      wait_for_runs "$branch" "workflow_dispatch" "$dispatch_since" "$(workflow_count)"
    else
      wait_for_runs "$branch" "" "" 1
    fi
    [ "$stamp" = 1 ] || return 0
    # Terminal cleanup, the Switchboard way (external_ci_mirror.py's
    # _cleanup_terminal_mirror_branch): the mirror is disposable once the run is
    # terminal AND the proof is recorded. Switchboard can delete unconditionally
    # because it mirrors a SHA that is already on the canonical repo — the proof
    # target exists before the mirror does. Here the canonical push can still be
    # ahead of us, so cleanup waits for a stamp that actually happened. A failed
    # wait dies above, so a red branch stays put for inspection — `prune` sweeps
    # those. main is the dispatch baseline and never deleted.
    if maybe_stamp_existing_canonical_branch "$branch"; then
      [ "$keep" = 1 ] || cleanup_sandbox_branch "$branch"
    else
      echo "ci-sandbox: keeping $CI_REPO:$branch — its run is the only evidence 'prove' can read"
    fi
  else
    echo "ci-sandbox: pushed; check $(actions_url "$branch")"
  fi
}

cmd_prove() {
  local branch
  branch="$(resolve_branch "${1:-}")"
  need_tools
  repo_root
  ensure_remote

  local sha ci_branch origin_branch target_url
  sha="$(git -C "$ROOT" rev-parse "$branch")"
  ci_branch="$(ls_remote_sha "$CI_REMOTE_URL" "refs/heads/$branch")"
  origin_branch="$(ls_remote_sha "$ORIGIN_REMOTE" "refs/heads/$branch")"
  target_url="$(actions_url "$branch")"

  [ "$ci_branch" = "$sha" ] || die "$CI_REPO branch $branch is not the local tested SHA ${sha:0:12}"
  [ "$origin_branch" = "$sha" ] || die "$CANONICAL_REPO branch $branch is not the local tested SHA ${sha:0:12}; push it first"

  # Capture the classifier's exit code directly. `local result=$?` after an
  # `if` block reads the compound statement's status (always 0), not the
  # function's — which would silently turn every failure into "could not evaluate".
  local result=0
  assert_sandbox_green_for_sha "$branch" "$sha" || result=$?

  if [ "$result" -eq 0 ]; then
    set_canonical_status "$sha" "success" "Full SimpleMark CI passed for exact SHA ${sha:0:12}" "$target_url"
    echo "ci-sandbox: proof stamped on $CANONICAL_REPO for ${sha:0:12}"
    return 0
  fi

  case "$result" in
    10)
      set_canonical_status "$sha" "pending" "Waiting for the full workflow_dispatch suite" "$target_url"
      die "not enough sandbox workflow_dispatch runs found for ${sha:0:12}"
      ;;
    11)
      set_canonical_status "$sha" "pending" "Sandbox suite still running" "$target_url"
      die "sandbox workflow_dispatch suite still running for ${sha:0:12}"
      ;;
    12)
      set_canonical_status "$sha" "failure" "Sandbox suite failed for exact SHA ${sha:0:12}" "$target_url"
      die "sandbox workflow_dispatch suite failed for ${sha:0:12}"
      ;;
    *)
      set_canonical_status "$sha" "error" "Sandbox proof could not be evaluated" "$target_url"
      die "sandbox proof could not be evaluated for ${sha:0:12}"
      ;;
  esac
}

cmd_wait() {
  local branch
  branch="$(resolve_branch "${1:-}")"
  need_tools; repo_root; ensure_remote
  wait_for_runs "$branch" "" "" 1
}

cmd_status() {
  local branch
  branch="$(resolve_branch "${1:-}")"
  need_tools; repo_root
  summarize_runs "$branch" || exit 1
}

ok_count=0
warn_count=0
fail_count=0
doctor_ok()   { ok_count=$((ok_count + 1));     echo "ok: $*"; }
doctor_warn() { warn_count=$((warn_count + 1)); echo "warn: $*"; }
doctor_fail() { fail_count=$((fail_count + 1)); echo "fail: $*"; }

repo_visibility() {
  gh repo view "$1" --json visibility --jq .visibility 2>/dev/null || true
}

cmd_doctor() {
  local branch=""
  if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    echo "Usage: scripts/ci-sandbox.sh doctor [branch]"
    return 0
  fi
  branch="${1:-$(current_branch)}"

  repo_root
  need_tools

  echo "ci-sandbox: doctor for $CI_REPO (canonical $CANONICAL_REPO)"

  local canonical_visibility ci_visibility
  canonical_visibility="$(repo_visibility "$CANONICAL_REPO")"
  ci_visibility="$(repo_visibility "$CI_REPO")"
  if [ -n "$canonical_visibility" ]; then
    doctor_ok "canonical repo reachable: $CANONICAL_REPO ($canonical_visibility)"
  else
    doctor_fail "canonical repo not reachable: $CANONICAL_REPO"
  fi
  if [ "$ci_visibility" = "PUBLIC" ]; then
    doctor_ok "CI sandbox repo reachable and public: $CI_REPO"
  elif [ -n "$ci_visibility" ]; then
    doctor_warn "CI sandbox repo is reachable but not public: $CI_REPO ($ci_visibility) — Actions minutes are billed"
  else
    doctor_fail "CI sandbox repo not reachable: $CI_REPO (see scripts/ci-sandbox.sh setup)"
  fi

  local configured_ci_url
  configured_ci_url="$(remote_url)"
  if [ -n "$configured_ci_url" ]; then
    if [ "$configured_ci_url" = "$CI_REMOTE_URL" ]; then
      doctor_ok "remote '$CI_REMOTE' points at $CI_REMOTE_URL"
    else
      doctor_warn "remote '$CI_REMOTE' points at $configured_ci_url (expected $CI_REMOTE_URL)"
    fi
  else
    doctor_fail "remote '$CI_REMOTE' is missing; run scripts/ci-sandbox.sh setup"
  fi

  if git -C "$ROOT" remote get-url "$ORIGIN_REMOTE" >/dev/null 2>&1; then
    doctor_ok "canonical remote '$ORIGIN_REMOTE' exists"
  else
    doctor_fail "canonical remote '$ORIGIN_REMOTE' is missing"
  fi

  # No local branch may track the sandbox. An earlier version of cmd_push passed
  # -u, so a checkout that ran it still has branches pointing at the disposable
  # remote; for `main` that silently detaches it from origin and a later `git
  # pull` fetches the sandbox instead of code truth. Report it rather than
  # assuming the fix was always in place.
  local tracking_ci
  tracking_ci="$(git -C "$ROOT" for-each-ref --format='%(refname:short) %(upstream:short)' refs/heads \
    | awk -v r="$CI_REMOTE/" '$2 ~ "^"r {print $1}')"
  if [ -z "$tracking_ci" ]; then
    doctor_ok "no local branch tracks the sandbox remote '$CI_REMOTE'"
  else
    while IFS= read -r stray; do
      [ -n "$stray" ] || continue
      doctor_fail "local branch '$stray' tracks '$CI_REMOTE'; repoint it: git branch -u $ORIGIN_REMOTE/$stray $stray"
    done <<EOF
$tracking_ci
EOF
  fi

  local local_main origin_main ci_main
  local_main="$(git -C "$ROOT" rev-parse --verify "${MAIN_REF}^{commit}" 2>/dev/null || true)"
  origin_main="$(ls_remote_sha "$ORIGIN_REMOTE" refs/heads/main)"
  ci_main="$(ls_remote_sha "$CI_REMOTE_URL" refs/heads/main)"
  [ -n "$local_main" ] && doctor_ok "$MAIN_REF resolves to ${local_main:0:12}" \
    || doctor_fail "$MAIN_REF does not resolve locally; run git fetch $ORIGIN_REMOTE main"
  [ -n "$origin_main" ] && doctor_ok "$ORIGIN_REMOTE/main is reachable at ${origin_main:0:12}" \
    || doctor_fail "$ORIGIN_REMOTE/main is not reachable"
  [ -n "$ci_main" ] && doctor_ok "$CI_REPO/main is reachable at ${ci_main:0:12}" \
    || doctor_fail "$CI_REPO/main is not reachable"
  if [ -n "$origin_main" ] && [ -n "$ci_main" ] && [ "$origin_main" != "$ci_main" ]; then
    doctor_fail "$CI_REPO/main (${ci_main:0:12}) differs from $ORIGIN_REMOTE/main (${origin_main:0:12}); run scripts/ci-sandbox.sh refresh-main"
  fi

  local protection_contexts
  protection_contexts="$(gh api "repos/${CANONICAL_REPO}/branches/main/protection/required_status_checks" --jq '.contexts[]?' 2>/dev/null || true)"
  if printf '%s\n' "$protection_contexts" | grep -Fx "$STATUS_CONTEXT" >/dev/null 2>&1; then
    doctor_ok "main requires canonical status: $STATUS_CONTEXT"
  else
    doctor_warn "main does not require $STATUS_CONTEXT yet; run scripts/ci-sandbox.sh protect-main"
  fi

  local workflow
  for workflow in $SANDBOX_WORKFLOWS; do
    if [ -f "$ROOT/.github/workflows/$workflow" ]; then
      doctor_ok "workflow file exists locally: $workflow"
      if grep -q 'workflow_dispatch:' "$ROOT/.github/workflows/$workflow"; then
        doctor_ok "workflow supports manual dispatch locally: $workflow"
      else
        doctor_fail "workflow lacks workflow_dispatch locally: $workflow"
      fi
    else
      doctor_fail "workflow file missing locally: $workflow"
    fi
    if gh workflow view "$workflow" --repo "$CI_REPO" >/dev/null 2>&1; then
      doctor_ok "workflow visible on $CI_REPO: $workflow"
    else
      doctor_fail "workflow not visible on $CI_REPO: $workflow"
    fi
  done

  if [ -n "$branch" ] && git -C "$ROOT" rev-parse --verify "$branch^{commit}" >/dev/null 2>&1; then
    local branch_sha ci_branch origin_branch status_state
    branch_sha="$(git -C "$ROOT" rev-parse "$branch")"
    ci_branch="$(ls_remote_sha "$CI_REMOTE_URL" "refs/heads/$branch")"
    origin_branch="$(ls_remote_sha "$ORIGIN_REMOTE" "refs/heads/$branch")"
    doctor_ok "local branch $branch resolves to ${branch_sha:0:12}"
    if [ -n "$ci_branch" ]; then
      [ "$ci_branch" = "$branch_sha" ] && doctor_ok "$CI_REPO branch $branch matches local SHA" \
        || doctor_fail "$CI_REPO branch $branch is ${ci_branch:0:12}, local is ${branch_sha:0:12}"
    else
      doctor_warn "$CI_REPO branch $branch is not pushed yet; run scripts/ci-sandbox.sh push $branch"
    fi
    if [ -n "$origin_branch" ] && [ "$origin_branch" = "$branch_sha" ]; then
      doctor_ok "$CANONICAL_REPO branch $branch matches local SHA"
      status_state="$(canonical_status_state "$branch_sha")"
      if [ "$status_state" = "success" ]; then
        doctor_ok "$STATUS_CONTEXT is success for ${branch_sha:0:12}"
      else
        doctor_warn "$STATUS_CONTEXT is not success for ${branch_sha:0:12}"
      fi
    else
      doctor_warn "$CANONICAL_REPO branch $branch is not pushed at the local SHA"
    fi
  else
    doctor_warn "branch-specific checks skipped"
  fi

  echo "ci-sandbox: doctor summary: ${ok_count} ok, ${warn_count} warn, ${fail_count} fail"
  [ "$fail_count" -eq 0 ] || die "doctor found $fail_count failure(s)"
}

cmd_protect_main() {
  need_tools; repo_root
  local main_sha ci_main payload
  main_sha="$(ls_remote_sha "$ORIGIN_REMOTE" refs/heads/main)"
  ci_main="$(ls_remote_sha "$CI_REMOTE_URL" refs/heads/main)"
  [ -n "$main_sha" ] || die "$ORIGIN_REMOTE/main is not reachable"
  [ "$ci_main" = "$main_sha" ] || die "$CI_REPO/main must match $ORIGIN_REMOTE/main first; run scripts/ci-sandbox.sh refresh-main"

  set_canonical_status "$main_sha" "success" "$CI_REPO/main matches canonical main ${main_sha:0:12}" "https://github.com/${CI_REPO}/actions"

  payload="$(jq -n --arg context "$STATUS_CONTEXT" '{
    required_status_checks: { strict: true, contexts: [$context] },
    enforce_admins: true,
    required_pull_request_reviews: null,
    restrictions: null
  }')"

  printf '%s' "$payload" | gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "repos/${CANONICAL_REPO}/branches/main/protection" \
    --input - >/dev/null

  echo "ci-sandbox: protected $CANONICAL_REPO main; required status: $STATUS_CONTEXT"
}

cmd_delete() {
  local branch
  branch="$(resolve_branch "${1:-}")"
  need_tools; repo_root; ensure_remote
  echo "ci-sandbox: deleting $CI_REPO:$branch"
  git -C "$ROOT" push "$CI_REMOTE" --delete "$branch"
}

# Sweep merged ephemeral branches off the sandbox.
#
# A sandbox branch is disposable only once its canonical counterpart is gone:
# we squash-merge, so a merged branch is deleted from origin and its original
# SHA is never an ancestor of main. That makes "still on origin" the honest
# signal for "someone may still be working on this" — and deleting a live
# agent's sandbox branch mid-run breaks their gate for no gain.
#
# --all overrides, for when you know the remaining branches are abandoned.
cmd_prune() {
  local force=0
  [ "${1:-}" = "--all" ] && force=1
  need_tools; repo_root; ensure_remote

  local refs branch pruned=0 skipped=0
  refs="$({ GIT_TERMINAL_PROMPT=0 git -C "$ROOT" ls-remote "$CI_REMOTE_URL" 'refs/heads/*' 2>/dev/null || true; } \
    | awk '{print $2}' | sed 's|refs/heads/||' | grep -v '^main$' || true)"
  if [ -z "$refs" ]; then
    echo "ci-sandbox: nothing to prune — only main on $CI_REPO"
    return 0
  fi

  while IFS= read -r branch; do
    [ -n "$branch" ] || continue
    if [ "$force" = 0 ] && git -C "$ROOT" ls-remote --exit-code "$ORIGIN_REMOTE" "refs/heads/${branch}" >/dev/null 2>&1; then
      echo "ci-sandbox: keeping $branch — still open on $CANONICAL_REPO (unmerged or in flight)"
      skipped=$((skipped + 1))
      continue
    fi
    echo "ci-sandbox: pruning $CI_REPO:$branch"
    git -C "$ROOT" push "$CI_REMOTE" --delete "$branch"
    pruned=$((pruned + 1))
  done <<< "$refs"

  echo "ci-sandbox: pruned $pruned, kept $skipped still-open branch(es)"
  [ "$skipped" -gt 0 ] && echo "ci-sandbox: re-run with --all to remove those too"
  return 0
}

cmd_sync_main() {
  need_tools; repo_root; ensure_repo; ensure_remote
  local sha
  sha="$(git -C "$ROOT" rev-parse --verify "${MAIN_REF}^{commit}")"
  echo "ci-sandbox: syncing $MAIN_REF @ ${sha:0:12} -> $CI_REPO:main"
  git -C "$ROOT" push "$CI_REMOTE" "${sha}:refs/heads/main"
  echo "ci-sandbox: main synced — https://github.com/${CI_REPO}"
}

cmd_refresh_main() {
  need_tools; repo_root; ensure_repo; ensure_remote
  echo "ci-sandbox: fetching $ORIGIN_REMOTE main"
  git -C "$ROOT" fetch "$ORIGIN_REMOTE" main
  local MAIN_REF="${ORIGIN_REMOTE}/main"
  cmd_sync_main
}

cmd_open_pr() {
  local branch
  branch="$(resolve_branch "${1:-}")"
  need_tools; repo_root

  git -C "$ROOT" show-ref --verify --quiet "refs/heads/${branch}" || die "branch '$branch' not found locally"

  # Order matters, and it is the whole bug this function used to have. `prove`
  # asserts the exact SHA is on BOTH remotes, so the canonical push has to happen
  # before stamping, and the sandbox ref has to survive until after it. Letting
  # cmd_push stamp and clean up here deleted the sandbox ref one line before
  # `prove` went looking for it, and announced a stamp that had not happened.
  cmd_push --no-stamp "$branch"

  echo "ci-sandbox: pushing $branch to canonical repo ($CANONICAL_REPO)"
  git -C "$ROOT" push -u "$ORIGIN_REMOTE" "$branch"
  cmd_prove "$branch"
  cleanup_sandbox_branch "$branch"

  if gh pr view --repo "$CANONICAL_REPO" --head "$branch" >/dev/null 2>&1; then
    die "PR already exists for $branch on $CANONICAL_REPO"
  fi

  gh pr create \
    --repo "$CANONICAL_REPO" \
    --head "$branch" \
    --title "$branch" \
    --body "$(cat <<EOF
## CI sandbox

The full SimpleMark gate ran on [\`${CI_REPO}\`](https://github.com/${CI_REPO}/actions?query=branch%3A${branch}) for this exact SHA before this PR was opened on \`${CANONICAL_REPO}\`.

After merge, refresh the sandbox baseline and delete the temporary sandbox branch:
\`\`\`bash
scripts/ci-sandbox.sh refresh-main
scripts/ci-sandbox.sh delete ${branch}
\`\`\`
EOF
)"
}

main() {
  local cmd="${1:-}"
  shift || true
  case "$cmd" in
    setup) cmd_setup "$@" ;;
    push) cmd_push "$@" ;;
    wait) cmd_wait "$@" ;;
    status) cmd_status "$@" ;;
    prove) cmd_prove "$@" ;;
    doctor) cmd_doctor "$@" ;;
    protect-main) cmd_protect_main "$@" ;;
    delete) cmd_delete "$@" ;;
    prune) cmd_prune "$@" ;;
    sync-main) cmd_sync_main "$@" ;;
    refresh-main) cmd_refresh_main "$@" ;;
    open-pr) cmd_open_pr "$@" ;;
    -h|--help|help|"") usage ;;
    *) die "unknown command '$cmd' (try: scripts/ci-sandbox.sh --help)" ;;
  esac
}

main "$@"
