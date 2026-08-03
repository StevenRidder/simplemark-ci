#!/usr/bin/env bash
set -euo pipefail

# Publish a sanitized snapshot of the private SimpleMark repo to the stable
# public mirror. Ported from Helm's scripts/publish-public-mirror.sh.
#
#   scripts/publish-public-mirror.sh [ref]        # publish
#   MIRROR_DRY_RUN=1 scripts/publish-public-mirror.sh   # build and scan only
#
# Three distinct repos, three distinct jobs:
#   StevenRidder/simplemark         private canonical — the only source of truth
#   StevenRidder/simplemark-ci      public CI sandbox — temporary, full tree, do not repurpose
#   StevenRidder/simplemark-public  this mirror — clean, curated, no agent plumbing
#
# This script is private-side tooling and never ships in the export.

PUBLIC_REPO="${PUBLIC_REPO:-StevenRidder/simplemark-public}"
PUBLIC_REMOTE_URL="${PUBLIC_REMOTE_URL:-https://github.com/${PUBLIC_REPO}.git}"
SOURCE_REF="${1:-HEAD}"
COMMIT_MESSAGE="${PUBLIC_COMMIT_MESSAGE:-Publish public snapshot}"
DRY_RUN="${MIRROR_DRY_RUN:-0}"
ROOT="$(git rev-parse --show-toplevel)"
WORK_ROOT="${WORK_ROOT:-$(mktemp -d "${TMPDIR:-/tmp}/simplemark-public-publish.XXXXXX")}"
ARCHIVE="${WORK_ROOT}/source.tar"
EXPORT_DIR="${WORK_ROOT}/export"
PUBLIC_CLONE="${WORK_ROOT}/public"

# Paths that must never reach the mirror: agent plumbing, board wiring, CI
# sandbox mechanics, and internal strategy documents.
# tests/ui/fidelity.spec.ts drives spike/fidelity's harness and types against the
# window global it installs. The spike does not ship, so the spec goes with it.
HIDDEN_PATH_RE='^(AGENTS\.md|\.mcp\.json|\.claude/|\.github/|\.gitattributes$|scripts/(publish-public-mirror|ci-sandbox|simplemark_ci)\.sh|scripts/mirror/|spike/|tests/ui/fidelity\.spec\.ts|docs/(POC|SWITCHBOARD-KERNEL|AGENT-WORKSPACE|CI-SANDBOX)\.md|docs/superpowers/|tests/fixtures/01-switchboard-borrowing-map\.md)'

# Text that must never appear in the mirror, even inside a file that ships.
# Scoped to the agent/board scaffolding and CI mechanics — not to every mention
# of Switchboard, which is a sibling product the docs legitimately cite.
HIDDEN_TEXT_RE='AGENTS\.md|CLAUDE\.md|superpowers|ci-sandbox|simplemark-ci|taikun-plan|plan\.taikunai|PM_MCP_TOKEN|SWITCHBOARD_TOKEN|MIRROR_DRY_RUN'

# Documents that do not ship. References to them are de-linked rather than
# deleted, so the surrounding sentence survives and the mirror has no dead links.
UNSHIPPED_DOCS=(POC SWITCHBOARD-KERNEL AGENT-WORKSPACE CI-SANDBOX)

# Machine paths and credential shapes. A hit here is a hard stop, always.
# "Dropbox" is deliberately path-shaped here: the product docs legitimately name
# Dropbox as a sync target, but /Dropbox/ or CloudStorage/ is this machine.
HARD_SECRET_RE='(/Users/[a-z]+|CloudStorage/|/Dropbox/Git|PM_MCP_TOKEN|SWITCHBOARD_TOKEN|plan\.taikunai|sk-(proj|live|test|ant)-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY)'

# The mirror is worthless if the product itself did not ship. Assert the spine.
REQUIRED_PATHS=(
  README.md
  LICENSE
  package.json
  index.html
  docs/assets/simplemark-demo.gif
  docs/DESIGN.md
  docs/decisions/INDEX.md
  src/domain/source/source-map.ts
  src/adapters/editor/milkdown-editor.ts
  src/app/browser.ts
  tests/fixtures/01-hostile-markdown.md
)

die() {
  echo "publish-public-mirror: $*" >&2
  exit 1
}

require_clean_private_tree() {
  git -C "$ROOT" diff --quiet || die "private worktree has unstaged changes; publish from a clean checkout"
  git -C "$ROOT" diff --cached --quiet || die "private worktree has staged changes; publish from a clean checkout"
}

scan_tree() {
  local tree_dir="$1"
  local label="$2"
  local rel_files hits

  rel_files="$(cd "$tree_dir" && find . -type f -not -path './.git/*' | sed 's#^\./##' | LC_ALL=C sort)"

  if hits="$(printf '%s\n' "$rel_files" | rg -n "$HIDDEN_PATH_RE" || true)"; [ -n "$hits" ]; then
    printf '%s\n' "$hits" >&2
    die "[$label] hidden private paths are present in export"
  fi

  if hits="$(cd "$tree_dir" && rg -n "$HIDDEN_TEXT_RE" --glob '!package-lock.json' || true)"; [ -n "$hits" ]; then
    printf '%s\n' "$hits" >&2
    die "[$label] hidden private references are present in export"
  fi

  if hits="$(cd "$tree_dir" && rg -n "$HARD_SECRET_RE" --glob '!package-lock.json' || true)"; [ -n "$hits" ]; then
    printf '%s\n' "$hits" >&2
    die "[$label] hard secret/private-machine pattern found in export"
  fi
}

scan_product_contract() {
  local tree_dir="$1"
  local label="$2"
  local path

  for path in "${REQUIRED_PATHS[@]}"; do
    [ -e "${tree_dir}/${path}" ] || die "[$label] product guard failed: ${path} is missing from the mirror"
  done

  # The README must actually show the demo, or the front page is pointless.
  rg -q 'docs/assets/simplemark-demo\.gif' "${tree_dir}/README.md" \
    || die "[$label] product guard failed: README does not embed the demo GIF"

  # The fixture swap must be complete on both sides, or the suite cannot run.
  rg -q "01-hostile-markdown\.md" "${tree_dir}/tests/support/fixtures.ts" \
    || die "[$label] product guard failed: fixtures.ts was not repointed at the neutral fixture"
}

sanitize_export() {
  local dir="$1"
  local path

  # Drop the private-only paths.
  (cd "$dir" && find . -type f -not -path './.git/*' | sed 's#^\./##' \
    | rg "$HIDDEN_PATH_RE" || true) | while IFS= read -r path; do
    [ -n "$path" ] && rm -f "${dir}/${path}"
  done
  find "$dir" -type d -empty -delete

  # The internal README links eight private documents; the mirror gets its own.
  cp "${ROOT}/scripts/mirror/README.public.md" "${dir}/README.md"
  cp "${ROOT}/scripts/mirror/LICENSE" "${dir}/LICENSE"

  # Fixture 01 is a real internal document naming another product's modules.
  # Swap in a neutral file that exercises the same adversarial Markdown, and
  # repoint the fixture table so the round-trip suite still runs.
  cp "${ROOT}/scripts/mirror/fixtures/01-hostile-markdown.md" \
    "${dir}/tests/fixtures/01-hostile-markdown.md"
  perl -0pi -e "s/01-switchboard-borrowing-map\.md/01-hostile-markdown.md/g" \
    "${dir}/tests/support/fixtures.ts"
  perl -0pi -e "s/Real hostile input: nested tables, inline links in cells, anchors, mixed lists/Hostile input: nested tables, inline links in cells, anchors, mixed lists/g" \
    "${dir}/tests/support/fixtures.ts"

  # check:boundaries scans spike/, which does not ship. Narrow it to what does.
  perl -0pi -e "s/depcruise src tests spike /depcruise src tests /g" "${dir}/package.json"

  # De-link references to documents that do not ship, keeping the prose intact:
  #   [`X.md`](X.md)  ->  `X.md`        [`X.md`](../X.md) -> `X.md`
  #   [`X.md`](docs/X.md) -> `X.md`
  local doc
  for doc in "${UNSHIPPED_DOCS[@]}"; do
    find "$dir" -type f \( -name '*.md' -o -name '*.ts' -o -name '*.html' \) -print0 \
      | xargs -0 perl -0pi -e "s/\\[(\`?)${doc}\\.md(\`?)\\]\\([^)]*\\)/\$1${doc}.md\$2/g"
  done

  # AGENTS.md is contributor/agent workflow and does not ship at all, so its
  # references become the plain noun rather than a de-linked filename.
  find "$dir" -type f \( -name '*.md' -o -name '*.ts' \) -print0 \
    | xargs -0 perl -0pi -e 's/\[`AGENTS\.md`\]\([^)]*\)/the contributor guide/g; s/`?AGENTS\.md`?/the contributor guide/g'
}

main() {
  command -v git >/dev/null || die "git is required"
  command -v gh >/dev/null || die "GitHub CLI gh is required"
  command -v rg >/dev/null || die "ripgrep rg is required"
  command -v rsync >/dev/null || die "rsync is required"
  command -v perl >/dev/null || die "perl is required"

  git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null || die "run from the private SimpleMark worktree"
  require_clean_private_tree

  mkdir -p "$EXPORT_DIR"
  git -C "$ROOT" archive --format=tar --output="$ARCHIVE" "$SOURCE_REF"
  tar -xf "$ARCHIVE" -C "$EXPORT_DIR"

  echo "Sanitizing export from ${SOURCE_REF}..."
  sanitize_export "$EXPORT_DIR"

  echo "Scanning sanitized export..."
  scan_tree "$EXPORT_DIR" export
  scan_product_contract "$EXPORT_DIR" export

  if [ "$DRY_RUN" = "1" ]; then
    echo
    echo "DRY RUN — nothing published. Export tree:"
    (cd "$EXPORT_DIR" && find . -type f -not -path './.git/*' | sed 's#^\./##' | LC_ALL=C sort)
    echo
    echo "Review it at: ${EXPORT_DIR}"
    exit 0
  fi

  if ! gh repo view "$PUBLIC_REPO" --json nameWithOwner >/dev/null 2>&1; then
    gh repo create "$PUBLIC_REPO" --public \
      --description "SimpleMark — a local-first Markdown notebook that renders what you paste. Clean public mirror."
  fi

  mkdir -p "$PUBLIC_CLONE"
  git -C "$PUBLIC_CLONE" init -q -b main
  git -C "$PUBLIC_CLONE" remote add origin "$PUBLIC_REMOTE_URL"
  rsync -a --delete --exclude '.git/' "${EXPORT_DIR}/" "${PUBLIC_CLONE}/"

  echo "Scanning public mirror working tree..."
  scan_tree "$PUBLIC_CLONE" mirror
  scan_product_contract "$PUBLIC_CLONE" mirror

  (
    cd "$PUBLIC_CLONE"
    git add -A
    git -c user.name=StevenRidder -c user.email=steve@6elementlabs.com commit -q -m "$COMMIT_MESSAGE"
    current_public_ref="$(git ls-remote "$PUBLIC_REMOTE_URL" refs/heads/main 2>/dev/null | awk '{print $1}')"
    if [ -n "$current_public_ref" ]; then
      git push --force-with-lease=refs/heads/main:"$current_public_ref" origin main
    else
      git push -q origin main
    fi
  )

  echo "Published ${PUBLIC_REPO} from ${SOURCE_REF}."
  echo "Review clone: ${PUBLIC_CLONE}"
}

main "$@"
