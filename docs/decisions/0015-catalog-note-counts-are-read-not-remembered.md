# 0015. Catalog note counts are read, not remembered

Date: 2026-08-21
Status: Accepted
Task: APP-47 (follow-up to APP-44, SimpleMark Margins W6)

## Context

APP-44 put open and resolved note counts on catalog rows so a person can see
which documents still carry review work before opening them. It painted a
count only for documents this session had opened: the open document counts
its own threads and reports them; the shell remembers the report across
remounts. Every other row in the folder showed nothing — and under the
"absent, never zero" rule, nothing reads as *unannotated*, when it was in
fact *unknown*. The row answered the question it was built to answer only
for documents whose answer the reader already knew.

## Decision

The shell **reads** the counts it does not know, once per catalog, through a
`NoteCountSource` port:

- One request carries every row the cache does not know. The native source is
  a single command that, off the UI thread, reads each document's front-matter
  id (else the degraded path key), locates its threads exactly as the composer
  does — sidecar beside the document when it exists, else application data —
  and counts by `state`. It reads only; a count never creates a sidecar.
- Results land in the same per-handle cache the open document reports into,
  and the open document's report wins: what is on screen beats what was on
  disk a moment ago.
- A document whose notes cannot be read is **named**, never counted as zero.
  The status line says so once per session per document and the sweep does
  not retry it — a placeholder that never downloads should say so once, not
  on every repaint of the list. A source that fails outright is reported the
  same way. Nothing is swallowed.
- The browser shell implements the same port over its `localStorage` thread
  store, so the behaviour is proven end to end in the UI suite rather than
  only in the native shell nobody can drive in CI.

## Consequences

- Opening a folder costs one extra native call and one small read per
  document (the front-matter window, 8 KiB, plus the threads file). Rows are
  patched as results arrive; nothing waits on the sweep.
- Counts for unopened documents are as fresh as the last catalog load in this
  process. Notes written by another device while the app runs show up on the
  next catalog load, not live — the threads watcher still covers only the
  open document.
- `NoteCountSource` is a new port in `application`, implemented by
  `TauriNoteCountSource` and `LocalNoteCountSource`, composed by the hosts,
  with the sweep itself a pure, tested module under `src/app/`.
