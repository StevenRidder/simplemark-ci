# ADR-0011: Comments travel beside the document, linked from front matter

- **Status:** Accepted
- **Date:** 2026-08-18
- **Decision owners:** SimpleMark maintainers
- **Supersedes:** the storage location in
  [`ADR-0007`](0007-annotation-before-participation.md) ("Threads live in
  application data, never beside the document") and the matching amendment in
  [`COLLABORATION.md`](../COLLABORATION.md) §4. It does not supersede ADR-0007's
  A→B→C0→C→D decomposition, the two-anchor rule, or the conditional rail.

## Context

ADR-0007 put anchored-note threads in application data so opening one file from
`~/Downloads` would not create a hidden folder there. The accepted cost was that
copying the `.md` did not carry its notes, and a folder agent (Cursor, or any
other tool reading the same directory) could not see them.

That cost is now the product problem. Notes must travel with the document so
both SimpleMark and a folder agent can read the same comments. Comment bodies
still must not become Canvas: the living document must look and behave as it
does today (tint, composer, rail). iCloud is not special — every cloud is a
folder on disk (`PRODUCT.md` §8).

Pasted images already write an `assets/` folder beside the note ([`ADR-0008`](0008-pasted-images-become-local-files.md)).
A comments sidecar is the same class of beside-the-file write, with a pointer
in the Markdown so another tool can find it.

## Decision

**A writable document with a real filesystem path stores its threads in
`.simplemark/<id>.json` beside the `.md`. The document holds a front-matter
`comments:` link to that file. The app reads and writes that same file. The
composer, tint, and rail do not change.**

1. **Sidecar path.** `<parent>/.simplemark/<id>.json` — one JSON array of
   threads, the same payload application data used. The folder is created on
   the first thread write, never on open.
2. **Link in the `.md`.** Front matter carries `comments: .simplemark/<id>.json`
   next to `id:`. A folder agent follows that relative path. The living
   document does not show the link: it is YAML, not body text. Comment bodies,
   anchors, and thread state stay out of the Canvas.
3. **Lazy write, same as `ensureId`.** Opening a document never writes. The
   first note stamps `id` and `comments:` together. A document that already has
   an `id` but no `comments:` link receives the link on that same `ensureId`
   call — still a first-note write, not an open write.
4. **Degraded notes stay in application data.** A `path-` key (read-only file,
   Note anyway) does not create `.simplemark/`. Relative or sample handles
   (`Not saved`) do not either. The guest rule survives for files that would
   not take an id.
5. **Read order.** Sidecar if it exists; otherwise application data, so notes
   written before this decision still appear until the next save migrates them
   by writing the sidecar.
6. **No cloud-specific path.** The rule is "absolute filesystem path with a
   parent directory", not iCloud, Dropbox, or any provider name.

## Consequences

### Positive

- A copied folder carries both the `.md` and its comments.
- A folder agent can find comments from the front-matter link without opening
  SimpleMark.
- The in-app note surface stays the same.

### Costs

- A writable file now grows a `.simplemark/` folder in its directory, including
  in Downloads when the person captures a note there.
- Two locations exist during migration: application data until the next thread
  write creates the sidecar.
- Front matter holds two SimpleMark keys (`id`, `comments`) instead of one.

## Rejected alternatives

### Keep threads only in application data

Rejected because notes would not travel and a folder agent could not read them.

### Put comment bodies inside the `.md`

Rejected because the living document would become a canvas of discussion. The
link is the pointer; the sidecar is the conversation.

### Visible wiki links on each passage

Rejected because the document would no longer look as it does now. Front matter
is already hidden from the default surface.

### Beside the file only when a library folder is open

Rejected as a special case. A real path is enough. Sample documents and
unwritable files already take the application-data fallback.
