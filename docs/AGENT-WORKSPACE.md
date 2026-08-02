# SimpleMark — Agent Workspace

**The later cold-file MCP surface.** For the first live human-plus-agent proof, see [`POC.md`](POC.md).

- **Status:** Draft 1 — **§3–§4 superseded by [`MCP-SERVER.md`](MCP-SERVER.md)** and
  [`ADR-0004`](decisions/0004-mcp-as-participant-client.md)
- **Date:** 2026-08-01
- **Companion to:** [`DESIGN.md`](DESIGN.md), [`TECH-SPEC.md`](TECH-SPEC.md), [`RENDERERS.md`](RENDERERS.md)

> **Supersession record.** This document's cold-file tool surface was written for a single-process
> notebook. [`ADR-0004`](decisions/0004-mcp-as-participant-client.md) replaced it with one surface
> serving open and unopened notes alike: revision-hash compare-and-swap became `baseVersion` plus
> rebase (§3 → [`MCP-SERVER.md`](MCP-SERVER.md) §5), content-hash anchors became opaque
> authority-issued tokens (§3.1 → §6), and `patch_note`'s Markdown-source edits became structural
> steps (§4.2 → §5.3). The §9.1 and §9.2 open questions are closed there.
>
> **What remains current:** §1.1's rule that agents never operate the editor UI (restated and
> broadened), §5's safety posture, §6's human-facing surface, and §7–§8's build rationale. The §7
> prerequisites — stable note ids and a revision exposed on read and write — are unchanged and
> remain Phase 1 work.

---

## 1. The shape

```
   You edit in SimpleMark ─┐
                           ├─→  Markdown files + attachments  ─→  renderers
   Agent edits over MCP  ──┘         (the canonical truth)
```

The agent works with raw, portable source. You see rendered diagrams, charts, and documents. Neither of you is translating for the other, because there is nothing between you but a folder.

**This is only possible because of D1.** An app whose truth is a proprietary database would need an API, an auth model, a sync protocol, and a schema the agent has to learn. A folder of Markdown needs none of it.

### 1.1 The governing rule

> **Agents modify the canonical Markdown. Agents never operate the editor UI.**

No synthetic keystrokes, no clicking buttons, no driving the canvas. The app is the live visual surface for both parties; the agent's surface is a semantic tool API over the files. This keeps the app's state machine sane, makes every agent action reviewable and undoable, and means an agent bug can never put the editor into an impossible state.

### 1.2 What this document does not cover

This document specifies agents working on notes that are **not live**. A live POC note uses the
application `DocumentSession`, session-local anchors, named transactions, and the control channel
specified in `COLLABORATION.md` and proved in `POC.md`. A future multi-client adapter first tests a
ProseMirror step authority and may use Yjs only for a proven masterless requirement. A live note
never falls back to a watcher-driven write.

---

## 2. Scope

**In:** a local stdio MCP server, bound to one folder, no network listener, no accounts, and
single-user cold-file work. It follows the POC rather than competing with it.

**Out:** hosted servers, multi-user concurrency, agent identity federation, remote access. If those ever arrive they are a separate product decision, not an extension of this one.

---

## 3. Concurrency: revision hashes

Every write is conditional. An agent may not silently overwrite an edit you made two seconds ago.

```ts
type Rev = string  // sha256 of the file's bytes, first 32 hex chars
```

`rev` is computed by `hashContent()` — the same function the write ledger already uses (`DESIGN.md` §8), so this costs nothing new.

**Protocol:**

| Step | Behavior |
|---|---|
| `read_note` | Returns `{ content, rev }` |
| `patch_note(id, expected_rev, edits)` | Applies only if the file's current rev equals `expected_rev` |
| Mismatch | Returns `{ error: 'stale', current_rev, diff }` — never writes |
| On stale | The agent re-reads and retries. This is its problem to handle, not yours. |

Compare-and-swap, not locking. No agent can hold your note hostage, and no agent can clobber you.

### 3.1 Block anchors

Index-based patching is fragile — you add a paragraph at the top and every index the agent held is wrong. So edits address blocks by **anchor**, not position:

```ts
type Anchor =
  | { kind: 'block';   hash: string }              // sha256 of the block's source, first 12
  | { kind: 'heading'; path: string[] }            // ['Architecture', 'Storage']
  | { kind: 'range';   start: number; end: number } // byte range, from read_note
```

Resolution rules, in order:

1. Exact block-hash match → apply.
2. Unique heading-path match → apply.
3. Zero matches → `{ error: 'anchor_not_found' }`.
4. **Two or more matches → refuse.** Ambiguity is never resolved by guessing.

Anchors are derived from `splitBlocks()` (plan Task 3), which already carries byte ranges and content — no new machinery.

---

## 4. Tool surface

Semantic operations, not `write_file`. A generic file-write tool forces the agent to re-serialize whole documents, which is exactly how untouched content gets rewritten and D7 gets violated.

### 4.1 Read

| Tool | Signature | Notes |
|---|---|---|
| `vault_info` | `() → { root, noteCount, tags[], capabilities[] }` | Orientation |
| `find_notes` | `({ query?, tag?, linkedTo?, modifiedSince?, limit? }) → NoteRef[]` | Metadata only, cheap |
| `search` | `({ query, limit }) → { noteId, blockAnchor, snippet, score }[]` | FTS5 over the index |
| `read_note` | `({ id }) → { id, path, title, rev, content, blocks: BlockRef[] }` | `BlockRef = { anchor, kind, preview }` |
| `read_block` | `({ id, anchor }) → { text, rev }` | Cheap targeted read |
| `list_links` | `({ id }) → { outgoing: NoteRef[], incoming: NoteRef[] }` | The link graph |
| `read_attachment` | `({ id, name }) → { mime, bytes }` | Size-capped |

### 4.2 Write

Every write takes `expected_rev` and returns the new `rev`.

| Tool | Signature |
|---|---|
| `create_note` | `({ title, content, tags?, folder? }) → { id, path, rev }` |
| `append_block` | `({ id, expected_rev, markdown }) → { rev, anchor }` |
| `patch_note` | `({ id, expected_rev, edits: Edit[], dry_run? }) → { rev, applied, diff }` |
| `rename_note` | `({ id, expected_rev, title }) → { rev, rewroteLinks }` |
| `put_attachment` | `({ id, name, bytes, mime }) → { path, sha }` |
| `delete_note` | `({ id, expected_rev }) → { trashed: path }` — moves to `.trash/`, never unlinks |

```ts
type Edit =
  | { op: 'replace';      anchor: Anchor; markdown: string }
  | { op: 'insert_after'; anchor: Anchor; markdown: string }
  | { op: 'insert_before';anchor: Anchor; markdown: string }
  | { op: 'delete';       anchor: Anchor }
```

**Edits are atomic as a set.** All apply or none do, and the result is written with `atomicWrite()`. A half-applied patch is not observable.

**`dry_run: true` returns the diff without writing.** Agents are encouraged to use it; the UI can surface a proposed change for approval instead of applying it.

### 4.3 What is deliberately absent

- No `write_file` / raw path access — every operation is note-scoped and rev-checked.
- No `execute` / shell of any kind.
- No renderer installation. Agents cannot add to the catalog (`TECH-SPEC.md` §4.3); that boundary is a reviewed PR.
- No settings mutation. An agent cannot turn off the LLM consent gate or point the vault elsewhere.

---

## 5. Safety

The MCP server is the one component with write access to your notes and a model on the other end. It is designed on the assumption that the model may be confused or actively manipulated by content it read.

| Control | Behavior |
|---|---|
| **Folder jail** | Every path resolved against the vault root; `..`, symlinks, and absolute paths rejected. One folder, chosen by you. |
| **No network** | stdio transport only. The server never opens a socket. |
| **No deletion** | `delete_note` moves to `.trash/`; a sweep after 30 days. Attachments are never removed inline. |
| **Size caps** | 1 MB per write, 10 MB per attachment, 50 writes/minute. Exceeded → refused, surfaced in the UI. |
| **Extension allowlist** | `.md` and catalogued attachment types only. No `.sh`, no `.command`, no executables — ever. |
| **Journal** | Every agent write appends to `.simplemark/journal.jsonl`: timestamp, tool, note id, `rev` before and after, the diff, and the agent's declared identity. |
| **One-click undo** | Any journal entry reverses, because the before-rev content is recoverable from the diff. |
| **Attribution** | Notes touched by an agent carry `last_edited_by: agent:<name>` in front matter. Preserved verbatim like all front matter. |
| **Content is data** | Note content passed to an agent is never treated as instruction by SimpleMark itself. The app has no "run what the note says" path. |

### 5.1 Proposal mode

An optional stricter posture, per-vault: agent writes land in `.simplemark/proposals/<id>.patch` instead of the note, and the app shows a review bar. Approve applies the patch; reject discards it.

This is the right default for anyone letting an unattended agent work in their notes, and it costs one branch in the write path because `patch_note` already computes the diff for `dry_run`.

---

## 6. The human side: seeing agent edits

| Situation | UI |
|---|---|
| Agent edits a note you don't have open | Note list shows a dot and "edited by Claude · 2m ago" |
| Agent edits the note you have open, editor clean | Content updates in place; a quiet bar: **"Claude edited this note · View changes · Undo"** |
| Agent edits the note you have open, editor dirty | Your text is never touched. Bar offers a side-by-side diff. |
| Agent creates a note | Appears in the list with an agent chip |
| Agent proposes (proposal mode) | Review bar with the diff, Approve / Reject |

This is the §8 external-change machinery from `DESIGN.md` with an attribution label — not a new subsystem. The design already handles "the file changed underneath me"; agents are just a well-behaved instance of that.

---

## 7. Why this shapes Phase 1

The reviewer's instinct is right: design for it now, build it later. Concretely, five things must be true before MCP is written, and four of them already are:

| Requirement | Status |
|---|---|
| Atomic writes | Plan Task 5 ✓ |
| Filesystem change events, self-write suppression | Plan Task 6 ✓ |
| Block splitting with byte ranges | Plan Task 3 ✓ |
| Stable note ids independent of path | **Add to Task 6** — id in front matter, not a path hash |
| Revision hash exposed on read/write | **Add to Task 6** — `Vault.read()` returns `{ content, rev }` |

Both additions are small and belong in Phase 1 regardless: stable ids are what keep `[[wikilinks]]` alive across a rename (`DESIGN.md` §8), and `rev` is already computed by the write ledger. Doing them now costs a few lines; retrofitting them later would touch every call site.

---

## 8. Build order

| Phase | Deliverable |
|---|---|
| **After the POC** | Stable ids + `rev` on read/write — the two prerequisites above |
| **6a** | Read-only MCP server: `vault_info`, `find_notes`, `read_note`, `read_block`, `search`, `list_links`. Zero write risk, immediately useful — an agent that can read your whole knowledge base. |
| **6b** | Writes: `create_note`, `append_block`, `patch_note` with rev checking and the journal |
| **6c** | Attribution UI, undo-from-journal, proposal mode |
| **6d** | Attachments, `rename_note` with link rewriting |

**6a is worth shipping on its own.** An agent that can search and read your notes is valuable before it can write a single byte, and it exercises the id, anchor, and search surfaces with no chance of data loss.

---

## 9. Open questions

1. **Anchor stability across agent and human edits.** Block-hash anchors break when either party edits the block. Heading-path anchors are stabler but coarser. Worth measuring in 6a with real traffic before committing to a resolution order.
2. **Whether `search` should return rendered or raw source.** Raw is honest and cheaper; rendered may be more useful to a model reading a chart spec. Probably raw with a `kind` hint.
3. **Multiple concurrent agents.** The rev protocol handles it correctly, but the journal and attribution UI assume one. Not a v1 problem.
