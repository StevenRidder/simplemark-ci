#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/simplemark-public-hygiene.XXXXXX")"
trap 'rm -rf "$WORK_ROOT"' EXIT

MIRROR_DRY_RUN=1 WORK_ROOT="$WORK_ROOT" \
  bash "$ROOT/scripts/publish-public-mirror.sh" HEAD >/dev/null

EXPORT_DIR="$WORK_ROOT/export"

if [ -e "$EXPORT_DIR/website" ]; then
  echo "public mirror hygiene: website/ reached the sanitized export" >&2
  exit 1
fi

if find "$EXPORT_DIR" -path '*/.openai/*' -print -quit | grep -q .; then
  echo "public mirror hygiene: hosting metadata reached the sanitized export" >&2
  exit 1
fi

if grep -ERIn --exclude='package-lock.json' \
  -e '6th-Element-Labs/simplemark|StevenRidder/simplemark([^[:alnum:]-]|$)' \
  "$EXPORT_DIR"; then
  echo "public mirror hygiene: private canonical repository identity reached the export" >&2
  exit 1
fi

test -f "$EXPORT_DIR/src/app/browser.ts"
test -f "$EXPORT_DIR/docs/GETTING-STARTED.md"
test ! -e "$EXPORT_DIR/docs/PRODUCT.md"
test ! -e "$EXPORT_DIR/docs/decisions"
test ! -e "$EXPORT_DIR/docs/COLLABORATION.md"
test ! -e "$EXPORT_DIR/docs/MCP-SERVER.md"
test ! -e "$EXPORT_DIR/docs/TECH-SPEC.md"
test ! -e "$EXPORT_DIR/docs/showcase/simplemark-1.0-launch-plan.md"
test ! -e "$EXPORT_DIR/docs/wireframe-collaboration.html"
test ! -e "$EXPORT_DIR/docs/wireframe-bear.html"
test ! -e "$EXPORT_DIR/docs/wireframe-ios.html"
test ! -e "$EXPORT_DIR/docs/wireframe.html"
test ! -e "$EXPORT_DIR/src/adapters/mcp/README.md"
test ! -e "$EXPORT_DIR/src/domain/fences/README.md"
test ! -e "$EXPORT_DIR/src/domain/transactions/README.md"

echo "public mirror hygiene: sanitized export excludes website and private identity"
