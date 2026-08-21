# ADR-0014: Snapshots live beside the document, taken before the agent writes

- **Status:** Accepted
- **Date:** 2026-08-21
- **Decision owners:** SimpleMark maintainers
- **Amends:** nothing. It extends the sidecar contract of
  [`ADR-0011`](0011-comments-travel-beside-the-document.md) with a second kind
  of companion file and relies on the atomic-write rule of the file port
  (`FilePort.save`) and the authority of
  [`ADR-0002`](0002-document-session-authority.md) for every restore.

## Context

Activity answers "what changed this session" and Revert undoes one named
change. Neither answers "what did this document say before the agent touched
it on Tuesday" — Activity is per session, and a Revert past many later edits
is a surgery, not a return. Google Docs and Word both keep a version history;
the SimpleMark Margins map calls it W5 and the last phase for a reason: every
other feature here is a view, and this one writes files.

Two facts shape the answer. Files are plain Markdown, so a version is a plain
file — no database, no cloud, survives any editor. And the agent is the one
author whose work a person may want to walk back wholesale, which means the
moment before an agent writes is the moment worth keeping automatically.

## Decision

1. **A snapshot is the document's exact bytes**, stored beside it in
   `.simplemark/versions/<note-id>/<snapshot-id>.md` with an `index.json`
   listing stamp, label and trigger. Where the sidecar directory is not
   writable, or the note has only a degraded path key, the ledger falls back to
   application data — the same resolution rule threads use, so the two kinds of
   companion file can never disagree about where "beside" is.

2. **Automatic before the agent writes.** A snapshot is taken when a direct-mode
   run starts, and before a proposal is accepted. Both are "before the agent's
   words enter the document". Nothing is taken for a person's own typing; that is
   what undo is for.

3. **Named on demand.** Activity offers "Snapshot now" with a label. Named
   snapshots are never pruned; automatic ones keep the most recent fifty per
   note. The bound is a product choice about disk, not a correctness rule.

4. **Restore is an ordinary, named, whole-document transaction.** It first
   snapshots the current bytes (trigger `restore`), then applies the chosen
   bytes through `DocumentSession.apply` as `Restore "label"`, re-renders the
   editor, and saves through the ordinary path. It lands in Activity like any
   other change. A restore is therefore itself restorable.

5. **Compare is block-level.** Two texts, a longest-common-subsequence over
   block boundaries, changed blocks marked. Good enough to answer "what moved",
   deliberately not a word-level diff engine.

6. **Nothing enters the `.md`.** The raw-Markdown purity audit holds: snapshot
   files are separate files, the index is separate, and a document with a
   hundred snapshots is byte-identical to one with none.

## Consequences

- Disk grows with agent activity; the fifty-per-note bound caps it.
- Snapshots are per machine in v1 — the sidecar syncs wherever the document
  syncs, application-data fallbacks do not.
- Restore across a front-matter change keeps the current `id:`/`comments:`
  lines by the same rule saves use (`adoptDiskWrite`), so restoring never
  orphans the note's own threads.
