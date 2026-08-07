# Anchored notes — design

- **Status:** Approved design, ready for planning. Its load-bearing decisions — the §9
  decomposition, the §4 storage location, and the §5 anchor mechanism — are recorded in
  [`ADR-0007`](../../decisions/0007-annotation-before-participation.md), which is binding where this
  document is explanatory.
- **Date:** 2026-08-06
- **Scope:** Sub-projects A and B of the annotation decomposition (§9)
- **Companion to:** [`COLLABORATION.md`](../../COLLABORATION.md), [`PRODUCT.md`](../../PRODUCT.md), [`DESIGN.md`](../../DESIGN.md)

## 1. What this is

Highlight a passage, press a key, type a note. The note stays attached to that
passage, survives closing the app, and is listed somewhere you can work through
afterwards. Resolving one closes it.

The motivating case is a live customer call: reading a Markdown document
together, the customer asks something, and you have about two seconds to capture
it without losing the thread of the conversation. Anything with a dialog, a
field, or a participant picker loses the question.

**No AI is involved.** Asking an agent about a passage is a later sub-project
with its own prerequisite (§9), and on a live call letting an agent rewrite the
document while a customer watches is the last thing anyone wants.

### 1.1 The constraint that shapes everything

> The `.md` is the durable result. Notes are not part of it.

Comment bodies, anchors and thread state never enter the document. This is the
`COLLABORATION.md` §4 layer split — Canvas is portable Markdown, Conversation is
a sidecar — with its stated asymmetry: *losing the sidecar loses discussion,
never content.*

One exception, agreed explicitly: a note's **identity** goes in front matter
(§3). One line, a normal Markdown convention, and already specified by
`DESIGN.md` §343.

## 2. Architecture

Domain is pure, adapters never import one another, the composition root injects
(ADR-0001).

### 2.1 Domain — no I/O, no DOM

```ts
type Anchor = {
  quote: string        // the selected text, verbatim
  prefix: string       // exactly 30 chars before it, or fewer at a block start
  suffix: string       // exactly 30 chars after it, or fewer at a block end
  blockIndex: number   // ordering only — see below
}

type Thread = {
  id: string            // globally unique, not sequential
  noteKey: string       // a note id (§3), or `path:<absolute path>` when degraded
  author: string        // the literal string 'local' in this version
  createdAt: string
  body: string          // Markdown
  anchor: Anchor
  state: 'open' | 'resolved'
  degraded?: true       // keyed by path because the file would not take an id (§3.2)
}

function matchAnchor(anchor: Anchor, text: string): number | undefined
```

`matchAnchor` is the whole orphan question reduced to one pure function. It is
the first thing to test and the last thing to change casually.

`blockIndex` **plays no part in matching.** It exists so the rail can list notes
in document order, and it is recomputed whenever an anchor is re-derived (§5.3).
Matching uses the quote and its context only — a block index is worthless the
moment blocks are reordered, and trusting it is how a note ends up on the wrong
paragraph.

`author` is the constant `'local'`, and a globally unique `id` is generated
although nothing reads either yet. They are the cheap half of not foreclosing
multi-party later; everything else about identity is deliberately absent. No
author is displayed anywhere in this version.

### 2.2 Application ports

| Port | Shape | Notes |
|---|---|---|
| `ThreadStore` | `list(noteKey)`, `save(thread)`, `remove(id)` | **Optional.** Absent in the browser build, exactly as `ChartDataReader` is |
| `NoteIdentity` | `readId(handle)`, `ensureId(handle)` | Two calls, deliberately (§3.1) |

### 2.3 Adapters

- `tauri-thread-store.ts` — JSON in the app data directory (§4)
- `tauri-note-identity.ts` — front-matter read and write
- `note-decorations.ts` — ProseMirror plugin, modelled on the existing
  `find.ts`, which already builds a `DecorationSet` from `Decoration.inline`
- composer and rail UI

## 3. Note identity

### 3.1 Two calls, not one

```
readId(handle)   → id | undefined      never writes
ensureId(handle) → { id } | { unwritable: true }   writes front matter
```

Opening a note calls `readId`. Creating your first note on a file calls
`ensureId`. **Reading a file can therefore never modify it** — a property of the
interface rather than of anyone remembering.

Written lazily for the same reason: a document you only ever read never acquires
an id.

### 3.2 When the file will not take one

Read-only file, or one the user would rather not touch. The app says so and
offers a choice:

> This file is read-only, so notes on it won't survive a rename.
> **[Note anyway] [Cancel]**

*Note anyway* keys the thread by path and sets `degraded: true`, so the
limitation is recorded on the thread rather than inferred later. Silent
fallback is forbidden: an invisible downgrade is the silent-wrong-answer
pattern `DESIGN.md` §4.4 rules out.

## 4. Where threads live

One file per document, named for its `noteKey`:

| Document | File |
|---|---|
| has a front-matter id | `<app data>/SimpleMark/threads/<id>.json` |
| degraded (§3.2) | `<app data>/SimpleMark/threads/path-<sha256 of absolute path>.json` |

Hashing the path keeps the filename safe and fixed-length. A degraded file is
found again only at the same path — which is precisely the limitation the
prompt in §3.2 warns about, made concrete.

If a degraded document later becomes writable and acquires an id, its threads
are migrated to the id-named file on next save and `degraded` is cleared.

Never beside the document. A note opened from `~/Downloads` must not cause a
hidden `.simplemark/` directory to appear in `~/Downloads`; the app is a guest
in directories it does not own. For documents with an id, threads survive the
note being renamed or moved anywhere.

The cost, accepted: copying the `.md` elsewhere does not carry its notes.
Exporting an annotated copy is out of scope (§8).

## 5. The anchor lifecycle

### 5.1 Capture

Select the passage, press **⌘⇧M**. **There is no floating button to aim at** —
a target that appears near the cursor is what makes commenting slow under time
pressure, and speed is the entire point of the motivating case.

The selection tints immediately, so what the note is about is visible before a
word is typed. The composer opens focused; Return saves, Escape discards.

Recorded: the quote verbatim, and exactly 30 characters of prefix and suffix
(fewer at a block boundary) for disambiguation.

Pressing ⌘⇧M with **no selection** does nothing and says so briefly. Anchoring
to a guessed reading position was considered and rejected: a note whose subject
the user did not choose is a note they cannot trust later.

A selection crossing block boundaries **clamps to the first block**. A
multi-block range must re-match every block on reopen and so orphans far more
often; "this note is about roughly here" is honest, where a range that silently
shrank is not.

### 5.2 Matching, on reopen

```
1. find every exact occurrence of `quote` in the document text
2. exactly one          → match
3. several              → score by prefix/suffix agreement;
                          a single clear winner matches
4. several still tied   → ORPHAN
5. none                 → ORPHAN
```

**No fuzzy matching.** Approximate matching is what reattaches a note to a
sentence that merely resembles the original, which is the failure this design
most needs to avoid. Ambiguity resolves to *orphan*, never to a guess. If real
use produces too many orphans, fuzzy matching is a later change justified by
evidence rather than by intuition.

### 5.3 Staying attached, during a session

While the note is open, ProseMirror maps decoration positions forward through
every transaction — the mechanism `find.ts` already depends on. Notes follow
live edits with no re-matching.

**On close, the anchor is re-derived** from each decoration's current position
and saved. Rewording a sentence therefore teaches the anchor its new wording
instead of silently staling it. This is what keeps orphaning rare: the common
case — editing in SimpleMark — never drifts. Anchors go stale only when the file
changes outside the app, which is exactly when being told is useful.

### 5.4 Orphans

Highlight gone; the note moves to the rail retaining its original quote
("was on: …"). It never floats onto a neighbouring paragraph.

Three actions, each fully defined:

- **Reattach** — the note enters a waiting state; the next selection you make
  in the document becomes its new anchor, replacing quote, prefix, suffix and
  `blockIndex`. Escape cancels and leaves it orphaned.
- **Keep as note** — clears the anchor entirely. The note becomes
  document-level, listed in the rail with no highlight, and is never matched
  again.
- **Delete** — removes the thread.

**Orphaned is a state of the moment, not a permanent verdict.** The matcher in
§5.2 runs on every open against the thread's stored anchor, so undoing the edit
that broke it — or reverting the file — reattaches the note by itself. Nothing
needs clearing.

That is safe precisely because §5.2 will not guess: a similar-but-different
sentence produces no exact quote match and the note stays in the rail.

Only **Keep as note** is permanent, because it discards the anchor.

Orphaning is guaranteed at some rate. It is the direct consequence of refusing
to write anchors into the document, and it is the right trade — but it means the
orphan state is a designed-in feature, not an edge case to add later.

## 6. Presentation

- **Note bodies are Markdown**, so `[[links]]`, `![[embeds]]` and note-relative
  files resolve through the three ports that already exist —
  `DocumentLinkPort`, `AssetReferencePort`, `ChartDataReader`. A note can carry
  the CSV a customer sent and the spec it contradicts.
  Scope: inline formatting, links and embeds. **No block diagrams** — a note
  containing a graph has stopped being a note *about* a document.
- **A referenced file that has moved** gets the chart-style refusal — "not
  beside this note any more" — never a dead link rendered as live.
- **Overlapping notes** on one passage: a single tint plus a count badge;
  clicking opens the stack. Never blended colours, which produce a third colour
  meaning nothing and no obvious click target.
- **The rail is conditional.** No open threads, no rail. `PRODUCT.md` §284 lists
  comments among the surfaces that "demonstrate machinery instead of value";
  a permanent rail would be exactly that.

## 7. Resolving

Resolving sets `state: 'resolved'`, saves, and removes the decoration. **It does
not write to the document.** Any edit the conclusion deserves is one you make
yourself, in the document, with ordinary undo.

This means nothing in this feature writes to the `.md` except the front-matter
id in §3 — a stronger guarantee than the original sketch, which proposed
inserting conclusions automatically.

The rule it serves is `COLLABORATION.md` §78: *a note that accumulates a
thousand unresolved threads has failed.* Resolve exists to make threads
disposable.

## 8. Out of scope

Participants, permissions, merge across devices, fuzzy matching, resolve
write-back, a browser storage adapter, exporting annotated copies, and anything
involving AI. Each is a separate increment; several are separate sub-projects
(§9).

## 9. Where this sits

| | Sub-project | Depends on |
|---|---|---|
| **A** | Anchored notes — this document | — |
| **B** | Resolve — this document, §7 | A |
| **C0** | AI connection: provider, model, key | — |
| **C** | Ask — an agent answers in a thread, cannot edit | A + C0 |
| **D** | Agent edits from a thread | A + C + `COLLABORATION.md` |

C0 is an unresolved design problem, not merely plumbing: `PRODUCT.md` §125 does
not want a provider setup and model picker becoming visible product surface.
D is larger than A, B and C combined.

## 10. Testing

Split by what can actually observe the failure.

**Node (vitest)**

- `matchAnchor` exhaustively: single hit; ambiguous then disambiguated by
  context; ambiguous and tied → orphan; absent → orphan; whitespace variation;
  a quote spanning bold or a link.
- Thread store round-trip against a temporary directory, including an
  unparseable file.
- `readId` never writes. Assert the file's bytes are unchanged.

**Playwright**

- Capture, decoration rendering, the overlap badge, the rail, resolve. Layout
  and DOM: in Node every element measures zero, which is exactly how two
  diagram defects survived a full green suite on 2026-08-05.
- **The orphan path, specifically:** open a note, change the anchored sentence
  outside the app, reopen, and assert the note is listed in the rail and
  decorated **nowhere**. This is the assertion that stops a wrong reattachment
  from shipping.

**A rule, learned the hard way:** no test may fake its own environment. No
simulated read-only filesystem, no faked policy. Where the real condition cannot
be reproduced in the harness, it is verified in a real build instead of by a
test that passes for the wrong reason.

## 11. Corrupt or unreadable data

A thread file that will not parse produces "notes for this document couldn't be
read" and **is never overwritten**. A failed read must not destroy the data it
failed to read. Malformed front matter is likewise left alone and treated as no
id.
