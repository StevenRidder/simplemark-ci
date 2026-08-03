## What changed

<!-- One paragraph. What behavior is different after this merges? -->

## Board

<!-- Switchboard task id on project=simplemark, e.g. FOUNDATION-1. Docs-only: write "none". -->

Task:

## Evidence

- [ ] `bash scripts/simplemark_ci.sh` passed locally
- [ ] `gate` is green on the head commit
- [ ] Queued to merge — the merge queue runs the full scope on the landing commit

<!-- Optional: if you proved the SHA on the sandbox first, paste that Actions run URL. -->

## Architecture check

- [ ] Dependency direction holds: `app → adapters → application → domain` (ADR-0001)
- [ ] No document or editor rule lives only in `browser.ts` or `tauri.ts`
- [ ] No Yjs / CRDT dependency was added (ADR-0002)
- [ ] Untouched blocks still round-trip byte-identically (D7), or this PR is pre-gate
- [ ] Failure states are visible and local — nothing silently falls back to green
