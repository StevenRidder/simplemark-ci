#!/usr/bin/env bash
# The canonical SimpleMark gate. Run locally before pushing; CI runs the same script.
#
# There is exactly one gate so that "it passed on my machine" and "it passed in CI"
# mean the same thing. Mirrors scripts/switchboard_ci.sh on the Switchboard repo.
#
# Missing evidence is never a green result: a required npm script that does not
# exist yet is a FAIL naming the board task that adds it, not a silent skip.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STRICT="${SIMPLEMARK_CI_STRICT:-0}"
SCOPE="${SIMPLEMARK_CI_SCOPE:-full}"
FAIL_FAST="${SIMPLEMARK_CI_FAIL_FAST:-0}"
RESULT_REPORT="${CI_RESULT_REPORT:-.artifacts/ci-result.json}"
SKIP_INSTALL="${SIMPLEMARK_CI_SKIP_INSTALL:-0}"

if [ "$SCOPE" != "fast" ] && [ "$SCOPE" != "full" ]; then
  echo "Unsupported SIMPLEMARK_CI_SCOPE=$SCOPE (expected fast or full)." >&2
  exit 2
fi

if [ "$SKIP_INSTALL" != "0" ] && [ "$SKIP_INSTALL" != "1" ]; then
  echo "Unsupported SIMPLEMARK_CI_SKIP_INSTALL=$SKIP_INSTALL (expected 0 or 1)." >&2
  exit 2
fi

# Required npm scripts. Absence is a hard failure — see FOUNDATION-1 on the
# simplemark board (Scaffold the reusable SimpleMark product modules).
REQUIRED_SCRIPTS="typecheck test check:boundaries"
# Optional npm scripts. Absence is reported, never fatal. test:ui is the
# project UI gate (Playwright); it is the command a project-scoped validation
# policy should point at, in place of the inherited projectplanner default.
OPTIONAL_SCRIPTS="lint build test:ui test:fidelity"

FAILURES=()
RESULTS=()

section() {
  printf '\n== %s ==\n' "$1"
}

record() {
  # record <name> <status> <detail>
  RESULTS+=("$(printf '{"step":"%s","status":"%s","detail":"%s"}' "$1" "$2" "${3//\"/\'}")")
}

fail() {
  FAILURES+=("$1")
  echo "FAIL  $1" >&2
  if [ "$FAIL_FAST" = "1" ]; then
    write_report
    exit 1
  fi
}

has_script() {
  node -e '
    const fs = require("fs");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    process.exit(pkg.scripts && pkg.scripts[process.argv[1]] ? 0 : 1);
  ' "$1" 2>/dev/null
}

run_script() {
  local name="$1" required="$2"
  if ! has_script "$name"; then
    if [ "$required" = "required" ]; then
      record "$name" "missing" "required npm script is not defined (see FOUNDATION-1)"
      fail "$name: required npm script is not defined in package.json"
    else
      record "$name" "skipped" "optional npm script is not defined"
      echo "SKIP  $name (optional, not defined)"
    fi
    return 0
  fi
  section "$name"
  if [ "$name" = "test:ui" ]; then
    # Multiple task worktrees run this same gate locally. A shared default Vite
    # port lets one suite attach to another worktree's app, then fail when that
    # suite shuts its server down. Use a stable per-worktree port unless the
    # caller deliberately supplies one (for example, a hosted CI runner).
    local checksum ui_port
    checksum="$(printf '%s' "$ROOT" | cksum | awk '{print $1}')"
    ui_port="${SIMPLEMARK_TEST_PORT:-$((5400 + checksum % 1000))}"
    echo "SIMPLEMARK_TEST_PORT=$ui_port"
    if SIMPLEMARK_TEST_PORT="$ui_port" npm run --silent "$name"; then
      record "$name" "passed" "port=$ui_port"
      echo "PASS  $name"
    else
      record "$name" "failed" "npm run $name exited non-zero (port=$ui_port)"
      fail "$name: npm run $name failed"
    fi
    return 0
  fi
  if npm run --silent "$name"; then
    record "$name" "passed" ""
    echo "PASS  $name"
  else
    record "$name" "failed" "npm run $name exited non-zero"
    fail "$name: npm run $name failed"
  fi
}

write_report() {
  mkdir -p "$(dirname "$RESULT_REPORT")"
  local joined status
  joined="$(IFS=,; printf '%s' "${RESULTS[*]-}")"
  status=passed
  [ "${#FAILURES[@]}" -eq 0 ] || status=failed
  printf '{"schema":"simplemark.ci_result.v1","status":"%s","scope":"%s","strict":"%s","steps":[%s],"failures":%s}\n' \
    "$status" "$SCOPE" "$STRICT" "$joined" "${#FAILURES[@]}" > "$RESULT_REPORT"
  echo "ci-result: $RESULT_REPORT"
}

section "environment"
command -v node >/dev/null || { echo "node is required" >&2; exit 2; }
command -v npm >/dev/null || { echo "npm is required" >&2; exit 2; }
echo "node $(node --version) / npm $(npm --version)"

if [ ! -f package.json ]; then
  record "package" "missing" "package.json does not exist yet"
  fail "package.json is missing — the product package has not been scaffolded (FOUNDATION-1)"
  write_report
  echo ""
  echo "SimpleMark has no package yet. The gate is wired and deliberately red until" >&2
  echo "FOUNDATION-1 creates the single root TypeScript package (ADR-0001)." >&2
  exit 1
fi
record "package" "passed" ""

section "install"
if [ "$SKIP_INSTALL" = "1" ]; then
  if [ ! -d node_modules ]; then
    echo "SIMPLEMARK_CI_SKIP_INSTALL=1 requires a preinstalled node_modules directory." >&2
    exit 2
  fi
  echo "reusing preinstalled node_modules"
  record "install" "reused" "preinstalled by caller"
elif [ -f package-lock.json ]; then
  npm ci
  record "install" "passed" ""
else
  echo "no package-lock.json — falling back to npm install"
  npm install
  record "install" "passed" ""
fi

section "git hygiene"
if git diff --check; then
  record "git-diff-check" "passed" ""
else
  record "git-diff-check" "failed" "whitespace/conflict markers found"
  fail "git diff --check reported problems"
fi

for s in $REQUIRED_SCRIPTS; do
  [ "$SCOPE" = "fast" ] && [ "$s" = "check:boundaries" ] && continue
  run_script "$s" required
done

if [ "$SCOPE" = "full" ]; then
  for s in $OPTIONAL_SCRIPTS; do
    run_script "$s" optional
  done
fi

write_report

if [ "${#FAILURES[@]}" -ne 0 ]; then
  section "summary"
  printf '%s\n' "${FAILURES[@]}" >&2
  echo "" >&2
  echo "SimpleMark CI: ${#FAILURES[@]} failure(s)." >&2
  exit 1
fi

section "summary"
echo "SimpleMark CI: all steps green (scope=$SCOPE)."
