# Anchored Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight a passage, press ⌘⇧M, type a note; the note stays attached to that passage, survives reopening, and can be resolved — without ever writing note data into the `.md`.

**Architecture:** A pure domain matcher (`buildAnchor` / `matchAnchor`) decides where a note belongs, given only text. Two optional application ports — `ThreadStore` and `NoteIdentity` — are implemented by Tauri adapters over new Rust commands. A ProseMirror plugin turns matched anchors into `Decoration.inline` highlights, modelled on the existing `find.ts`. Notes are view-layer only: no schema change, no mark, nothing serializable.

**Tech Stack:** TypeScript, ProseMirror via `@milkdown/kit/prose`, Rust/Tauri v2, vitest (Node), Playwright (chromium).

**Design spec:** [`docs/superpowers/specs/2026-08-06-anchored-notes-design.md`](../specs/2026-08-06-anchored-notes-design.md)

## Global Constraints

- **Note data never enters the `.md`.** The only permitted write to a document is a front-matter `id`, and only via `ensureId`.
- **`readId` must never write.** A test asserts the file's bytes are unchanged.
- **No fuzzy matching.** Ambiguity or absence resolves to a visible orphan, never a guess.
- **Sidecars live in the app data directory**, never beside the document.
- **Context window for anchors is exactly 30 characters** (`CONTEXT_LENGTH`), truncated at block boundaries.
- **Capture shortcut is ⌘⇧M**; with no selection it does nothing and says so.
- **`ThreadStore` and `NoteIdentity` are optional ports** — absent in the browser build, where the notes UI is not offered. Follow the `ChartDataReader` precedent exactly.
- **No test may fake its environment.** No simulated read-only filesystem. Where the real condition cannot be reproduced, verify in a real build instead.
- **Boundaries:** adapters never import one another (ADR-0001); the composition root injects. `npm run check:boundaries` must stay green.

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/notes/anchor.ts` | `Anchor`, `CONTEXT_LENGTH`, `buildAnchor`, `matchAnchor`. Pure. |
| `src/domain/notes/thread.ts` | `Thread` type and `resolveThread` / `openThread` transitions. Pure. |
| `src/application/ports.ts` | Add `ThreadStore`, `NoteIdentity` (modify) |
| `src/application/index.ts` | Re-export the new types (modify) |
| `src/adapters/filesystem/tauri-thread-store.ts` | Transport to the thread commands |
| `src/adapters/filesystem/tauri-note-identity.ts` | Transport to the identity commands |
| `src/adapters/editor/note-decorations.ts` | ProseMirror plugin: anchors → decorations |
| `src/adapters/editor/note-capture.ts` | ⌘⇧M keymap + composer element |
| `src/app/ui/note-rail.ts` | The conditional rail |
| `src-tauri/src/notes.rs` | Rust: thread file IO, front-matter id read/write |
| `src-tauri/src/lib.rs` | Register the four new commands (modify) |

Tasks 1–5 are pure logic and transport, fully testable in Node. Tasks 6–10 are DOM and need Playwright. Task 11 wires and proves the whole thing.

---

### Task 1: The anchor matcher

The heart of the feature. Pure functions over strings — no DOM, no ProseMirror, no I/O.

**Files:**
- Create: `src/domain/notes/anchor.ts`
- Test: `tests/domain/anchor.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CONTEXT_LENGTH: 30`
  - `interface Anchor { quote: string; prefix: string; suffix: string; blockIndex: number }`
  - `buildAnchor(text: string, from: number, to: number, blockIndex: number): Anchor`
  - `matchAnchor(anchor: Anchor, text: string): number | undefined` — returns the start offset of the quote, or `undefined` for orphan.

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/anchor.test.ts
import { describe, expect, it } from 'vitest'

import { buildAnchor, matchAnchor, CONTEXT_LENGTH } from '../../src/domain/notes/anchor.js'

/**
 * The orphan rule, tested as arithmetic.
 *
 * Everything this feature promises about never guessing lives in one function.
 * Ambiguity resolves to `undefined`, never to a best effort.
 */
describe('buildAnchor', () => {
  it('captures the quote with bounded context on both sides', () => {
    const text = 'A'.repeat(50) + 'QUOTE' + 'B'.repeat(50)
    const anchor = buildAnchor(text, 50, 55, 3)

    expect(anchor.quote).toBe('QUOTE')
    expect(anchor.prefix).toBe('A'.repeat(CONTEXT_LENGTH))
    expect(anchor.suffix).toBe('B'.repeat(CONTEXT_LENGTH))
    expect(anchor.blockIndex).toBe(3)
  })

  it('truncates context at the ends of the text', () => {
    const anchor = buildAnchor('ab QUOTE cd', 3, 8, 0)
    expect(anchor.prefix).toBe('ab ')
    expect(anchor.suffix).toBe(' cd')
  })
})

describe('matchAnchor', () => {
  it('finds a unique quote', () => {
    const anchor = buildAnchor('the Starlink business grew', 4, 12, 0)
    expect(matchAnchor(anchor, 'the Starlink business grew')).toBe(4)
  })

  it('finds the quote after unrelated edits elsewhere', () => {
    const anchor = buildAnchor('the Starlink business grew', 4, 12, 0)
    expect(matchAnchor(anchor, 'PREAMBLE. the Starlink business grew a lot')).toBe(14)
  })

  it('disambiguates repeats using context', () => {
    const source = 'alpha TARGET omega ... beta TARGET zeta'
    const anchor = buildAnchor(source, 27, 33, 0) // the second TARGET
    expect(matchAnchor(anchor, source)).toBe(27)
  })

  it('orphans when repeats cannot be told apart', () => {
    // Identical context on both sides: nothing can choose between them.
    const anchor = buildAnchor('x TARGET y', 2, 8, 0)
    expect(matchAnchor(anchor, 'x TARGET y ... x TARGET y')).toBeUndefined()
  })

  it('orphans when the quote is gone', () => {
    const anchor = buildAnchor('the Starlink business', 4, 12, 0)
    expect(matchAnchor(anchor, 'operating losses narrowed')).toBeUndefined()
  })

  it('does not match a merely similar sentence', () => {
    const anchor = buildAnchor('the Starlink business', 4, 12, 0)
    expect(matchAnchor(anchor, 'the Starlink businesses')).toBe(4) // exact substring still present
    expect(matchAnchor(anchor, 'the Starlnk business')).toBeUndefined() // typo: no exact quote
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/domain/anchor.test.ts`
Expected: FAIL — `Cannot find module '../../src/domain/notes/anchor.js'`

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/notes/anchor.ts

/**
 * Where a note is attached, expressed in text rather than positions.
 *
 * Positions break the moment anything edits the document — including tools
 * that are not SimpleMark. A quote plus its surroundings survives
 * reformatting, reordering, and rewriting elsewhere in the file, and fails
 * *visibly* when the passage itself is gone.
 */
export interface Anchor {
  readonly quote: string
  readonly prefix: string
  readonly suffix: string
  /** Document order for listing only. Never consulted when matching. */
  readonly blockIndex: number
}

/** Characters of context kept either side of the quote. */
export const CONTEXT_LENGTH = 30

export function buildAnchor(text: string, from: number, to: number, blockIndex: number): Anchor {
  return {
    quote: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - CONTEXT_LENGTH), from),
    suffix: text.slice(to, to + CONTEXT_LENGTH),
    blockIndex,
  }
}

/** Every exact occurrence of `quote`, by start offset. */
function occurrences(quote: string, text: string): number[] {
  const found: number[] = []
  if (quote === '') return found
  let at = text.indexOf(quote)
  while (at !== -1) {
    found.push(at)
    at = text.indexOf(quote, at + 1)
  }
  return found
}

/** How many trailing prefix / leading suffix characters agree at `offset`. */
function contextScore(anchor: Anchor, text: string, offset: number): number {
  const before = text.slice(Math.max(0, offset - anchor.prefix.length), offset)
  const after = text.slice(offset + anchor.quote.length, offset + anchor.quote.length + anchor.suffix.length)

  let score = 0
  for (let i = 1; i <= Math.min(before.length, anchor.prefix.length); i += 1) {
    if (before[before.length - i] !== anchor.prefix[anchor.prefix.length - i]) break
    score += 1
  }
  for (let i = 0; i < Math.min(after.length, anchor.suffix.length); i += 1) {
    if (after[i] !== anchor.suffix[i]) break
    score += 1
  }
  return score
}

/**
 * The start offset of the anchored passage, or `undefined` if it cannot be
 * identified beyond doubt.
 *
 * There is deliberately no approximate matching. Fuzzy comparison is what
 * reattaches a note to a sentence that merely resembles the original, and a
 * note on the wrong sentence is worse than a note that admits it is lost
 * (DESIGN.md §4.4).
 */
export function matchAnchor(anchor: Anchor, text: string): number | undefined {
  const candidates = occurrences(anchor.quote, text)
  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]

  const scored = candidates.map((offset) => ({ offset, score: contextScore(anchor, text, offset) }))
  const best = Math.max(...scored.map((entry) => entry.score))
  const winners = scored.filter((entry) => entry.score === best)

  // A tie means the document genuinely cannot say which one was meant.
  return winners.length === 1 ? winners[0]?.offset : undefined
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/domain/anchor.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Check boundaries and types**

Run: `npx tsc --noEmit && npm run check:boundaries`
Expected: no output from tsc; "no dependency violations found"

- [ ] **Step 6: Commit**

```bash
git add src/domain/notes/anchor.ts tests/domain/anchor.test.ts
git commit -m "feat(notes): anchor a note to a quote, or admit it is lost"
```

---

### Task 2: The thread type

**Files:**
- Create: `src/domain/notes/thread.ts`
- Test: `tests/domain/thread.test.ts`

**Interfaces:**
- Consumes: `Anchor` from Task 1.
- Produces:
  - `interface Thread { id: string; noteKey: string; author: string; createdAt: string; body: string; anchor: Anchor | undefined; state: 'open' | 'resolved'; degraded?: true }`
  - `resolveThread(thread: Thread): Thread`
  - `detachThread(thread: Thread): Thread` — the "Keep as note" action; clears the anchor.

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/thread.test.ts
import { describe, expect, it } from 'vitest'

import { buildAnchor } from '../../src/domain/notes/anchor.js'
import { detachThread, resolveThread, type Thread } from '../../src/domain/notes/thread.js'

const thread = (): Thread => ({
  id: 't1',
  noteKey: 'n1',
  author: 'local',
  createdAt: '2026-08-06T10:00:00Z',
  body: 'split by region?',
  anchor: buildAnchor('the Starlink business', 4, 12, 0),
  state: 'open',
})

describe('thread transitions', () => {
  it('resolves without touching anything else', () => {
    const resolved = resolveThread(thread())
    expect(resolved.state).toBe('resolved')
    expect(resolved.body).toBe('split by region?')
    expect(resolved.anchor).toEqual(thread().anchor)
  })

  it('detaching clears the anchor permanently', () => {
    const detached = detachThread(thread())
    expect(detached.anchor).toBeUndefined()
    expect(detached.state).toBe('open')
  })

  it('does not mutate the original', () => {
    const original = thread()
    resolveThread(original)
    expect(original.state).toBe('open')
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/domain/thread.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/notes/thread.ts
import type { Anchor } from './anchor.js'

/**
 * One note about one passage.
 *
 * `author` is always `'local'` and nothing displays it. It exists so that a
 * later multi-party version does not require migrating every stored thread —
 * the cheap half of not foreclosing that, where the expensive half (identity,
 * permissions, merge) is deliberately absent.
 */
export interface Thread {
  readonly id: string
  /** A note id, or `path-<hash>` when the document would not take one. */
  readonly noteKey: string
  readonly author: string
  readonly createdAt: string
  /** Markdown. Links and embeds resolve; block diagrams are not offered. */
  readonly body: string
  /** Absent once detached: the note is about the document, not a passage. */
  readonly anchor: Anchor | undefined
  readonly state: 'open' | 'resolved'
  /** Keyed by path because the document could not take an id. */
  readonly degraded?: true
}

/**
 * Resolving closes the thread and nothing else.
 *
 * It deliberately does not write to the document. Any edit the conclusion
 * deserves is one the author makes themselves, with ordinary undo — which is
 * what keeps threads disposable (COLLABORATION.md §1.1).
 */
export function resolveThread(thread: Thread): Thread {
  return { ...thread, state: 'resolved' }
}

/** "Keep as note": stop trying to attach this to any passage, forever. */
export function detachThread(thread: Thread): Thread {
  return { ...thread, anchor: undefined }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/domain/thread.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/domain/notes/thread.ts tests/domain/thread.test.ts
git commit -m "feat(notes): the thread type and its two transitions"
```

---

### Task 3: The ports

**Files:**
- Modify: `src/application/ports.ts` (append)
- Modify: `src/application/index.ts` (re-export)

**Interfaces:**
- Consumes: `Thread` (Task 2).
- Produces:
  - `interface ThreadStore { list(noteKey: string): Promise<Thread[]>; save(thread: Thread): Promise<void>; remove(noteKey: string, threadId: string): Promise<void> }`
  - `interface NoteIdentity { readId(documentHandle: string): Promise<string | undefined>; ensureId(documentHandle: string): Promise<{ id: string } | { unwritable: true }> }`

> **Refinement from the spec:** the spec wrote `remove(id)`. `remove(noteKey, threadId)` is used instead — one file holds all of a document's threads, so removal needs to know which file.

- [ ] **Step 1: Append the ports**

```ts
// src/application/ports.ts — append

/**
 * Where anchored notes are stored.
 *
 * Optional in exactly the way `ChartDataReader` is: the browser build has no
 * filesystem, so it receives no store and the notes affordances are not
 * offered. An absent capability is not an error to report at use time; it is a
 * feature that is not present.
 */
export interface ThreadStore {
  list(noteKey: string): Promise<Thread[]>
  save(thread: Thread): Promise<void>
  remove(noteKey: string, threadId: string): Promise<void>
}

/**
 * A document's stable identity, so notes survive it being renamed or moved.
 *
 * Two calls rather than one, and the split is the whole point: `readId` cannot
 * write, so opening a document can never modify it. Only creating the first
 * note on a document calls `ensureId`.
 */
export interface NoteIdentity {
  readId(documentHandle: string): Promise<string | undefined>
  ensureId(documentHandle: string): Promise<{ id: string } | { unwritable: true }>
}
```

- [ ] **Step 2: Re-export from the application index**

```ts
// src/application/index.ts — add to the existing export type { … } block
  NoteIdentity,
  ThreadStore,
```

- [ ] **Step 3: Verify types and boundaries**

Run: `npx tsc --noEmit && npm run check:boundaries`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add src/application/ports.ts src/application/index.ts
git commit -m "feat(notes): ThreadStore and NoteIdentity ports"
```

---

### Task 4: Rust — thread files and front-matter identity

**Files:**
- Create: `src-tauri/src/notes.rs`
- Modify: `src-tauri/src/lib.rs` (declare the module, register four commands)

**Interfaces:**
- Produces four Tauri commands:
  - `read_note_threads(note_key: String) -> Result<String, String>` — the file's JSON text, or `""` when absent
  - `write_note_threads(note_key: String, contents: String) -> Result<(), String>`
  - `read_note_id(document_handle: String) -> Result<Option<String>, String>` — **never writes**
  - `ensure_note_id(document_handle: String) -> Result<EnsureNoteId, String>` where `EnsureNoteId { id: Option<String>, unwritable: bool }`

- [ ] **Step 1: Write the Rust module**

```rust
// src-tauri/src/notes.rs
use std::fs;
use std::path::PathBuf;

use serde::Serialize;

/// Threads live beside the application, never beside the document.
///
/// A note opened from `~/Downloads` must not cause a hidden directory to
/// appear in `~/Downloads`. The app is a guest in folders it does not own.
fn threads_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or_else(|| "No application data directory".to_string())?;
    let dir = base.join("SimpleMark").join("threads");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn threads_file(note_key: &str) -> Result<PathBuf, String> {
    // The key is either an opaque id we generated or `path-<hex>`; neither can
    // contain a separator. Refuse anything else rather than write outside.
    if note_key.contains('/') || note_key.contains('\\') || note_key.contains("..") {
        return Err("Invalid note key".to_string());
    }
    Ok(threads_dir()?.join(format!("{note_key}.json")))
}

#[tauri::command]
pub fn read_note_threads(note_key: String) -> Result<String, String> {
    let path = threads_file(&note_key)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_note_threads(note_key: String, contents: String) -> Result<(), String> {
    let path = threads_file(&note_key)?;
    fs::write(&path, contents).map_err(|error| error.to_string())
}

#[derive(Serialize)]
pub struct EnsureNoteId {
    pub id: Option<String>,
    pub unwritable: bool,
}

/// The `id:` line from front matter, if there is one.
///
/// This must never write. Opening a document is a read, and a reader that
/// modifies what it reads is the behaviour this whole design exists to avoid.
#[tauri::command]
pub fn read_note_id(document_handle: String) -> Result<Option<String>, String> {
    let text = fs::read_to_string(&document_handle).map_err(|error| error.to_string())?;
    Ok(extract_id(&text))
}

fn extract_id(text: &str) -> Option<String> {
    let rest = text.strip_prefix("---\n")?;
    let end = rest.find("\n---")?;
    rest[..end].lines().find_map(|line| {
        let value = line.strip_prefix("id:")?.trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

#[tauri::command]
pub fn ensure_note_id(document_handle: String) -> Result<EnsureNoteId, String> {
    let text = fs::read_to_string(&document_handle).map_err(|error| error.to_string())?;
    if let Some(existing) = extract_id(&text) {
        return Ok(EnsureNoteId { id: Some(existing), unwritable: false });
    }

    let id = new_id();
    let updated = insert_id(&text, &id);
    match fs::write(&document_handle, updated) {
        Ok(()) => Ok(EnsureNoteId { id: Some(id), unwritable: false }),
        // Read-only file, or a directory we may not write. Report it; the
        // caller offers a degraded note rather than failing silently.
        Err(_) => Ok(EnsureNoteId { id: None, unwritable: true }),
    }
}

/// Time-ordered and collision-resistant enough for one machine's notes.
fn new_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:032x}")
}

/// Adds `id:` to existing front matter, or creates a block if there is none.
/// Existing keys, comments and ordering are preserved — the fidelity corpus
/// (DESIGN.md §548) requires front matter to survive untouched.
fn insert_id(text: &str, id: &str) -> String {
    if let Some(rest) = text.strip_prefix("---\n") {
        return format!("---\nid: {id}\n{rest}");
    }
    format!("---\nid: {id}\n---\n\n{text}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_an_id_from_front_matter() {
        assert_eq!(extract_id("---\nid: abc\ntitle: x\n---\n\nbody"), Some("abc".into()));
    }

    #[test]
    fn has_no_id_when_there_is_no_front_matter() {
        assert_eq!(extract_id("# Just a heading"), None);
    }

    #[test]
    fn inserting_keeps_existing_front_matter() {
        let out = insert_id("---\ntitle: x\n---\n\nbody", "abc");
        assert!(out.starts_with("---\nid: abc\ntitle: x\n---"));
        assert!(out.ends_with("body"));
    }

    #[test]
    fn inserting_creates_front_matter_when_absent() {
        assert_eq!(insert_id("body", "abc"), "---\nid: abc\n---\n\nbody");
    }
}
```

- [ ] **Step 2: Register the module and commands**

In `src-tauri/src/lib.rs`, add `mod notes;` beside the other module declarations, then add these four entries to the existing `tauri::generate_handler![…]` list (after `read_note_data`):

```rust
            notes::read_note_threads,
            notes::write_note_threads,
            notes::read_note_id,
            notes::ensure_note_id,
```

- [ ] **Step 3: Add the `dirs` dependency**

Run: `cargo add dirs --manifest-path src-tauri/Cargo.toml`
Expected: `Adding dirs v6.x` to dependencies

- [ ] **Step 4: Run the Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml notes::`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/notes.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(notes): native thread files and front-matter identity"
```

---

### Task 5: The Tauri adapters

**Files:**
- Create: `src/adapters/filesystem/tauri-thread-store.ts`
- Create: `src/adapters/filesystem/tauri-note-identity.ts`
- Test: `tests/adapters/tauri-thread-store.test.ts`

**Interfaces:**
- Consumes: `ThreadStore`, `NoteIdentity` (Task 3); commands from Task 4.
- Produces:
  - `class TauriThreadStore implements ThreadStore` — `constructor(invoke: TauriNotesInvoke)`
  - `class TauriNoteIdentity implements NoteIdentity` — `constructor(invoke: TauriNotesInvoke)`
  - `type TauriNotesInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>`
  - `noteKeyForPath(path: string): string` — the degraded key, exported for the composition root

- [ ] **Step 1: Write the failing test**

```ts
// tests/adapters/tauri-thread-store.test.ts
import { describe, expect, it, vi } from 'vitest'

import { buildAnchor } from '../../src/domain/notes/anchor.js'
import type { Thread } from '../../src/domain/notes/thread.js'
import { TauriThreadStore } from '../../src/adapters/filesystem/tauri-thread-store.js'

const thread = (id: string): Thread => ({
  id,
  noteKey: 'n1',
  author: 'local',
  createdAt: '2026-08-06T10:00:00Z',
  body: 'why?',
  anchor: buildAnchor('a QUOTE b', 2, 7, 0),
  state: 'open',
})

describe('TauriThreadStore', () => {
  it('returns nothing for a document with no thread file', async () => {
    const invoke = vi.fn().mockResolvedValue('')
    expect(await new TauriThreadStore(invoke).list('n1')).toEqual([])
  })

  it('round-trips a thread through the file contents', async () => {
    let stored = ''
    const invoke = vi.fn(async (command: string, args: Record<string, unknown>) => {
      if (command === 'write_note_threads') { stored = args['contents'] as string; return undefined }
      return stored
    })
    const store = new TauriThreadStore(invoke)

    await store.save(thread('t1'))
    expect(await store.list('n1')).toEqual([thread('t1')])
  })

  it('replaces a thread with the same id rather than appending', async () => {
    let stored = ''
    const invoke = vi.fn(async (command: string, args: Record<string, unknown>) => {
      if (command === 'write_note_threads') { stored = args['contents'] as string; return undefined }
      return stored
    })
    const store = new TauriThreadStore(invoke)

    await store.save(thread('t1'))
    await store.save({ ...thread('t1'), body: 'edited' })

    const listed = await store.list('n1')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.body).toBe('edited')
  })

  it('never destroys a file it could not parse', async () => {
    const invoke = vi.fn().mockResolvedValue('{ this is not json')
    const store = new TauriThreadStore(invoke)

    await expect(store.list('n1')).rejects.toThrow(/could not be read/)
    // The failed read must not have triggered any write.
    expect(invoke).not.toHaveBeenCalledWith('write_note_threads', expect.anything())
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/adapters/tauri-thread-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the thread store**

```ts
// src/adapters/filesystem/tauri-thread-store.ts
import type { Thread } from '../../domain/notes/thread.js'
import type { ThreadStore } from '../../application/index.js'

export type TauriNotesInvoke = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>

/** The degraded key for a document that would not take an id. */
export function noteKeyForPath(path: string): string {
  let hash = 0n
  for (const char of path) hash = (hash * 131n + BigInt(char.codePointAt(0) ?? 0)) % (1n << 64n)
  return `path-${hash.toString(16).padStart(16, '0')}`
}

/**
 * One JSON file per document, holding all of its threads.
 *
 * A file that will not parse raises rather than being replaced. Losing a note
 * because we failed to read it would be worse than the read failing — and a
 * store that repairs itself by truncating is a store that eats data.
 */
export class TauriThreadStore implements ThreadStore {
  constructor(private readonly invoke: TauriNotesInvoke) {}

  async list(noteKey: string): Promise<Thread[]> {
    const raw = await this.invoke('read_note_threads', { noteKey })
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (text === '') return []
    try {
      const parsed: unknown = JSON.parse(text)
      return Array.isArray(parsed) ? (parsed as Thread[]) : []
    } catch {
      throw new Error('The notes for this document could not be read')
    }
  }

  async save(thread: Thread): Promise<void> {
    const existing = await this.list(thread.noteKey)
    const next = [...existing.filter((candidate) => candidate.id !== thread.id), thread]
    await this.write(thread.noteKey, next)
  }

  async remove(noteKey: string, threadId: string): Promise<void> {
    const existing = await this.list(noteKey)
    await this.write(noteKey, existing.filter((candidate) => candidate.id !== threadId))
  }

  async write(noteKey: string, threads: readonly Thread[]): Promise<void> {
    await this.invoke('write_note_threads', { noteKey, contents: JSON.stringify(threads, null, 2) })
  }
}
```

- [ ] **Step 4: Write the identity adapter**

```ts
// src/adapters/filesystem/tauri-note-identity.ts
import type { NoteIdentity } from '../../application/index.js'
import type { TauriNotesInvoke } from './tauri-thread-store.js'

/**
 * Two calls, and the separation is the guarantee.
 *
 * `readId` reaches a command that only reads, so no code path exists by which
 * opening a document could modify it. `ensureId` is reached only when the
 * author creates their first note.
 */
export class TauriNoteIdentity implements NoteIdentity {
  constructor(private readonly invoke: TauriNotesInvoke) {}

  async readId(documentHandle: string): Promise<string | undefined> {
    const id = await this.invoke('read_note_id', { documentHandle })
    return typeof id === 'string' && id !== '' ? id : undefined
  }

  async ensureId(documentHandle: string): Promise<{ id: string } | { unwritable: true }> {
    const result = (await this.invoke('ensure_note_id', { documentHandle })) as {
      id?: string
      unwritable?: boolean
    }
    return typeof result.id === 'string' ? { id: result.id } : { unwritable: true }
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/adapters/tauri-thread-store.test.ts && npx tsc --noEmit && npm run check:boundaries`
Expected: 4 tests PASS, tsc clean, no boundary violations

- [ ] **Step 6: Commit**

```bash
git add src/adapters/filesystem/tauri-thread-store.ts src/adapters/filesystem/tauri-note-identity.ts tests/adapters/tauri-thread-store.test.ts
git commit -m "feat(notes): Tauri thread store and note identity adapters"
```

---

### Task 6: Decorations from anchors

**Files:**
- Create: `src/adapters/editor/note-decorations.ts`
- Modify: `src/adapters/editor/milkdown-editor.ts` (mount the plugin)
- Test: `tests/ui/notes-decoration.spec.ts`

**Interfaces:**
- Consumes: `matchAnchor` (Task 1), `Thread` (Task 2).
- Produces:
  - `notesPlugin` — a milkdown `$prose` plugin, mounted like `findPlugin`
  - `setThreads(view: EditorView, threads: readonly Thread[]): void` — dispatches the threads into plugin state
  - CSS classes `sm-note-anchor` and `sm-note-anchor-stacked`

The plugin mirrors `find.ts`: plugin state holds the threads, `props.decorations` derives a `DecorationSet`, and `docChanged` recomputes rather than remaps — an edit can destroy a match, not merely move it.

- [ ] **Step 1: Write the failing Playwright test**

```ts
// tests/ui/notes-decoration.spec.ts
import { expect, test } from '@playwright/test'

/**
 * Decoration behaviour is layout, so it is tested in a browser.
 *
 * In Node every element measures zero and every DecorationSet is invisible,
 * which is exactly how two diagram defects survived a green suite on
 * 2026-08-05.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
})

test('a matched anchor tints its passage, an unmatched one tints nothing', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'a',
      anchor: { quote: 'SimpleMark', prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
    { id: 't2', noteKey: 'n', author: 'local', createdAt: '', body: 'b',
      anchor: { quote: 'NOT IN THIS DOCUMENT', prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
  ]))

  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
  await expect(page.locator('.sm-note-anchor').first()).toContainText('SimpleMark')
})

test('two notes on one passage tint once and count', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'a',
      anchor: { quote: 'SimpleMark', prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
    { id: 't2', noteKey: 'n', author: 'local', createdAt: '', body: 'b',
      anchor: { quote: 'SimpleMark', prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
  ]))

  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
  await expect(page.locator('.sm-note-anchor').first()).toHaveAttribute('data-count', '2')
})

test('a resolved note tints nothing', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'a',
      anchor: { quote: 'SimpleMark', prefix: '', suffix: '', blockIndex: 0 }, state: 'resolved' },
  ]))

  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `SIMPLEMARK_TEST_PORT=5405 npx playwright test tests/ui/notes-decoration.spec.ts`
Expected: FAIL — `window.simplemark.notes` is undefined

- [ ] **Step 3: Write the plugin**

```ts
// src/adapters/editor/note-decorations.ts
import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'

import { matchAnchor } from '../../domain/notes/anchor.js'
import type { Thread } from '../../domain/notes/thread.js'

interface NotesState {
  readonly threads: readonly Thread[]
}

export const notesKey = new PluginKey<NotesState>('simplemark-notes')

/** Plain text of the document, with the offsets ProseMirror uses. */
function documentText(state: EditorState): string {
  return state.doc.textBetween(0, state.doc.content.size, '\n', '\n')
}

/**
 * Where each open, anchored thread currently sits.
 *
 * Recomputed on every document change rather than remapped, for the same
 * reason `find.ts` recomputes: an edit can destroy a match outright, and a
 * remapped position would survive as a highlight over the wrong words.
 */
function decorate(state: EditorState, threads: readonly Thread[]): DecorationSet {
  const text = documentText(state)
  const byOffset = new Map<number, { to: number; ids: string[] }>()

  for (const thread of threads) {
    if (thread.state !== 'open' || thread.anchor === undefined) continue
    const offset = matchAnchor(thread.anchor, text)
    if (offset === undefined) continue

    const existing = byOffset.get(offset)
    if (existing === undefined) {
      byOffset.set(offset, { to: offset + thread.anchor.quote.length, ids: [thread.id] })
    } else {
      existing.ids.push(thread.id)
    }
  }

  return DecorationSet.create(
    state.doc,
    [...byOffset.entries()].map(([from, { to, ids }]) =>
      // +1 converts a text offset into a ProseMirror position inside the
      // first block. textBetween counts block separators as one character,
      // which matches the single leading position of the doc node.
      Decoration.inline(from + 1, to + 1, {
        class: ids.length > 1 ? 'sm-note-anchor sm-note-anchor-stacked' : 'sm-note-anchor',
        'data-count': String(ids.length),
        'data-threads': ids.join(' '),
      }),
    ),
  )
}

export function setThreads(view: EditorView, threads: readonly Thread[]): void {
  view.dispatch(view.state.tr.setMeta(notesKey, threads))
}

function notesProsePlugin(): Plugin<NotesState> {
  return new Plugin<NotesState>({
    key: notesKey,
    state: {
      init: () => ({ threads: [] }),
      apply: (tr: Transaction, value: NotesState) => {
        const meta = tr.getMeta(notesKey) as readonly Thread[] | undefined
        return meta === undefined ? value : { threads: meta }
      },
    },
    props: {
      decorations(state) {
        const notes = notesKey.getState(state)
        if (notes === undefined || notes.threads.length === 0) return DecorationSet.empty
        return decorate(state, notes.threads)
      },
    },
  })
}

/** The milkdown wrapper the editor adapter mounts, beside `findPlugin`. */
export const notesPlugin = $prose(() => notesProsePlugin())
```

- [ ] **Step 4: Mount it and expose the test hook**

In `src/adapters/editor/milkdown-editor.ts`, import `notesPlugin` and add it to the plugin list next to `findPlugin`. Expose `setThreadsForTest` on the existing `window.simplemark` surface, alongside the other test affordances that suite already uses.

- [ ] **Step 5: Add the styles**

```css
/* src/app/styles/app.css — append near the find-match rules */

/*
 * A note's highlight. One tint regardless of how many notes share the
 * passage: two overlapping tints blend into a third colour that means
 * nothing and gives a click no obvious target.
 */
.sm-note-anchor {
  background: var(--note-tint, #f6e7bd88);
  border-bottom: 2px solid var(--note-line, #e3ce93);
  border-radius: 2px;
  cursor: pointer;
}

.sm-note-anchor-stacked {
  border-bottom-style: double;
  border-bottom-width: 3px;
}
```

- [ ] **Step 6: Run the tests**

Run: `SIMPLEMARK_TEST_PORT=5405 npx playwright test tests/ui/notes-decoration.spec.ts`
Expected: PASS — 3 tests

- [ ] **Step 7: Commit**

```bash
git add src/adapters/editor/note-decorations.ts src/adapters/editor/milkdown-editor.ts src/app/styles/app.css tests/ui/notes-decoration.spec.ts
git commit -m "feat(notes): tint an anchored passage, and only when it matches"
```

---

### Task 7: Capture

**Files:**
- Create: `src/adapters/editor/note-capture.ts`
- Test: `tests/ui/notes-capture.spec.ts`

**Interfaces:**
- Consumes: `buildAnchor` (Task 1), `setThreads` (Task 6), `ThreadStore` + `NoteIdentity` (Task 3).
- Produces: `installNoteCapture(view: EditorView, deps: { store: ThreadStore; identity: NoteIdentity; handle: () => string | undefined; onSaved: () => void }): () => void` — returns a teardown function.

Behaviour, from spec §5.1: ⌘⇧M with a selection builds the anchor from the selected text, calls `ensureId`, opens a focused composer; Return saves, Escape discards. With **no** selection it does nothing and shows a brief message.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/notes-capture.spec.ts
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
})

test('capture needs a selection and says so when there is none', async ({ page }) => {
  await page.keyboard.press('Meta+Shift+M')
  await expect(page.locator('.sm-note-composer')).toHaveCount(0)
  await expect(page.getByText('Select the text this note is about')).toBeVisible()
})

test('selecting then pressing the key opens a focused composer on that passage', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.notes.selectTextForTest('SimpleMark'))
  await page.keyboard.press('Meta+Shift+M')

  const composer = page.locator('.sm-note-composer')
  await expect(composer).toBeVisible()
  await expect(composer.locator('textarea')).toBeFocused()
  await expect(composer).toContainText('SimpleMark')
})

test('Escape discards without creating a note', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.notes.selectTextForTest('SimpleMark'))
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('this should vanish')
  await page.keyboard.press('Escape')

  await expect(page.locator('.sm-note-composer')).toHaveCount(0)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
})

test('Return saves and the passage tints immediately', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.notes.selectTextForTest('SimpleMark'))
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('split by region?')
  await page.keyboard.press('Enter')

  await expect(page.locator('.sm-note-composer')).toHaveCount(0)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `SIMPLEMARK_TEST_PORT=5405 npx playwright test tests/ui/notes-capture.spec.ts`
Expected: FAIL — no `.sm-note-composer`

- [ ] **Step 3: Implement capture**

Build `note-capture.ts` with: a `keydown` listener for `metaKey && shiftKey && key === 'm'`; on empty selection, render a transient message element and return; otherwise read `view.state.doc.textBetween(...)` for the whole document plus `from`/`to` from the selection, call `buildAnchor`, call `identity.ensureId(handle())`, and — when the result is `{ unwritable: true }` — show the two-button prompt from spec §3.2 before proceeding with `noteKeyForPath` and `degraded: true`. The composer is a positioned `<div class="sm-note-composer">` containing the quote and a `<textarea>`; Return calls `store.save` then `onSaved()`, Escape removes it.

- [ ] **Step 4: Run the tests**

Run: `SIMPLEMARK_TEST_PORT=5405 npx playwright test tests/ui/notes-capture.spec.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/adapters/editor/note-capture.ts tests/ui/notes-capture.spec.ts
git commit -m "feat(notes): capture a note on the selected passage"
```

---

### Task 8: The rail, orphans, and resolve

**Files:**
- Create: `src/app/ui/note-rail.ts`
- Test: `tests/ui/notes-rail.spec.ts`

**Interfaces:**
- Consumes: `Thread` (Task 2), `resolveThread` / `detachThread` (Task 2), `ThreadStore` (Task 3).
- Produces: `renderNoteRail(host: HTMLElement, threads: readonly Thread[], actions: { resolve(id: string): void; detach(id: string): void; remove(id: string): void; reattach(id: string): void }): void`

Behaviour: the rail is **absent** when no open threads exist (spec §6). Orphans — open threads whose anchor did not match — appear with their original quote and the three actions from spec §5.4.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/notes-rail.spec.ts
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
})

test('no open notes, no rail', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([]))
  await expect(page.locator('.sm-note-rail')).toHaveCount(0)
})

test('an unmatched note is listed as an orphan with its original quote', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'still relevant?',
      anchor: { quote: 'A SENTENCE THAT IS GONE', prefix: '', suffix: '', blockIndex: 0 },
      state: 'open' },
  ]))

  const rail = page.locator('.sm-note-rail')
  await expect(rail).toBeVisible()
  await expect(rail).toContainText('A SENTENCE THAT IS GONE')
  await expect(rail.locator('[data-orphan="true"]')).toHaveCount(1)
  // It must not be tinted anywhere in the document.
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
})

test('resolving removes the note from the rail and the document', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'done with this',
      anchor: { quote: 'SimpleMark', prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
  ]))
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)

  await page.locator('.sm-note-rail [data-action="resolve"]').first().click()

  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
  await expect(page.locator('.sm-note-rail')).toHaveCount(0)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `SIMPLEMARK_TEST_PORT=5405 npx playwright test tests/ui/notes-rail.spec.ts`
Expected: FAIL — no `.sm-note-rail`

- [ ] **Step 3: Implement the rail**

`renderNoteRail` clears `host` and returns early when no thread has `state === 'open'`, so the rail element does not exist. Otherwise it renders one row per open thread, sorted by `anchor.blockIndex` (undefined last), each carrying `data-thread` and `data-orphan`. Orphan rows show `was on: "<quote>"` and buttons with `data-action` of `reattach`, `detach`, `remove`; matched rows show `resolve`.

- [ ] **Step 4: Run the tests**

Run: `SIMPLEMARK_TEST_PORT=5405 npx playwright test tests/ui/notes-rail.spec.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/note-rail.ts tests/ui/notes-rail.spec.ts
git commit -m "feat(notes): a rail that appears only when something is unresolved"
```

---

### Task 9: Anchor re-derivation on close

The step that keeps orphaning rare (spec §5.3): when the document is closed, each matched decoration's *current* position becomes the thread's new anchor, so rewording a sentence in SimpleMark teaches the anchor rather than staling it.

**Files:**
- Modify: `src/adapters/editor/note-decorations.ts` (export `currentAnchors`)
- Test: `tests/ui/notes-reanchor.spec.ts`

**Interfaces:**
- Produces: `currentAnchors(view: EditorView): Map<string, Anchor>` — thread id → freshly derived anchor, for every thread currently decorated.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/notes-reanchor.spec.ts
import { expect, test } from '@playwright/test'

test('rewording the anchored sentence updates the anchor instead of orphaning it', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)

  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([
    { id: 't1', noteKey: 'n', author: 'local', createdAt: '', body: 'q',
      anchor: { quote: 'SimpleMark', prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
  ]))
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)

  await page.evaluate(() => window.simplemark!.notes.replaceTextForTest('SimpleMark', 'SimpleMark Pro'))

  const anchors = await page.evaluate(() => window.simplemark!.notes.currentAnchorsForTest())
  expect(anchors['t1']?.quote).toContain('SimpleMark')
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `SIMPLEMARK_TEST_PORT=5405 npx playwright test tests/ui/notes-reanchor.spec.ts`
Expected: FAIL — `currentAnchorsForTest` is not a function

- [ ] **Step 3: Implement `currentAnchors`**

Read the plugin's `DecorationSet` from `notesKey.getState(view.state)`, recompute the decorations for the current document, and for each decoration call `buildAnchor(documentText(view.state), from - 1, to - 1, blockIndexAt(view.state, from))`. Return the map keyed by the `data-threads` ids.

- [ ] **Step 4: Persist on close**

In the composition root (Task 10), call `currentAnchors` before tearing down a document and `store.save` any thread whose anchor changed.

- [ ] **Step 5: Run the test**

Run: `SIMPLEMARK_TEST_PORT=5405 npx playwright test tests/ui/notes-reanchor.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/adapters/editor/note-decorations.ts tests/ui/notes-reanchor.spec.ts
git commit -m "feat(notes): teach an anchor its new wording instead of losing it"
```

---

### Task 10: Wiring, and the end-to-end proof

**Files:**
- Modify: `src/app/tauri.ts` (construct and inject)
- Modify: `src/app/browser.ts` (inject nothing; notes are not offered)
- Test: `tests/ui/notes-lifecycle.spec.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Wire the Tauri composition root**

```ts
// src/app/tauri.ts — beside the existing renderer construction
const threadStore = new TauriThreadStore(invoke)
const noteIdentity = new TauriNoteIdentity(invoke)
```

Pass both into the editor construction, along with `() => options.filePath` for the handle, mirroring how `TauriChartDataReader` already receives the open-note callback.

- [ ] **Step 2: Leave the browser root alone**

`src/app/browser.ts` constructs neither. Capture is not installed and the rail is never rendered — the affordance is absent rather than broken, exactly as a chart that needs a data file is absent there.

- [ ] **Step 3: Write the end-to-end test**

```ts
// tests/ui/notes-lifecycle.spec.ts
import { expect, test } from '@playwright/test'

/**
 * The whole promise in one test: a note taken on a passage is still on that
 * passage after a reload, and resolving it removes it for good.
 */
test('a note survives a reload and can then be resolved', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)

  await page.evaluate(() => window.simplemark!.notes.selectTextForTest('SimpleMark'))
  await page.keyboard.press('Meta+Shift+M')
  await page.keyboard.type('does this survive?')
  await page.keyboard.press('Enter')
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)

  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
  await expect(page.locator('.sm-note-rail')).toContainText('does this survive?')

  await page.locator('.sm-note-rail [data-action="resolve"]').first().click()
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)

  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
  await expect(page.locator('.sm-note-rail')).toHaveCount(0)
})
```

- [ ] **Step 4: Run the whole gate**

Run: `npx tsc --noEmit && npm run check:boundaries && npx vitest run && SIMPLEMARK_TEST_PORT=5405 npm run test:ui`
Expected: tsc clean; no boundary violations; all vitest tests pass; all Playwright tests pass

- [ ] **Step 5: Commit**

```bash
git add src/app/tauri.ts src/app/browser.ts tests/ui/notes-lifecycle.spec.ts
git commit -m "feat(notes): wire anchored notes into the desktop shell"
```

---

### Task 11: Verify in a real build

Spec §10 forbids tests that fake their environment. Two behaviours cannot be proved by the harness: that `readId` leaves a file's bytes untouched on a real filesystem, and that a genuinely read-only document produces the degraded prompt.

**Files:**
- Modify: `docs/RENDERERS.md` — no. Modify: `docs/superpowers/specs/2026-08-06-anchored-notes-design.md` (record the verification)

- [ ] **Step 1: Build from the current branch**

```bash
SIMPLEMARK_BUILD_SHA=$(git rev-parse HEAD) npm run build:native
```

- [ ] **Step 2: Verify `readId` does not write**

Open a note with no front matter, read it, close it. Then:

```bash
shasum -a 256 <that file>
```

Expected: unchanged from before opening.

- [ ] **Step 3: Verify the read-only path**

```bash
chmod a-w <a test note>
```

Open it, select a passage, press ⌘⇧M.
Expected: the prompt "This file is read-only, so notes on it won't survive a rename." with **Note anyway** and **Cancel**. Choosing *Note anyway* stores a thread with `degraded: true`.

```bash
chmod u+w <that test note>
```

- [ ] **Step 4: Record the result in the spec and commit**

```bash
git add docs/superpowers/specs/2026-08-06-anchored-notes-design.md
git commit -m "docs(notes): record real-build verification of identity and read-only paths"
```

---

## Self-Review

**Spec coverage.** §2.1 → Tasks 1–2. §2.2 → Task 3. §2.3 → Tasks 4–6, 8. §3 → Tasks 4–5, verified in Task 11. §4 → Task 4 (`threads_dir`) and Task 5 (`noteKeyForPath`). §5.1 → Task 7. §5.2 → Task 1. §5.3 → Task 9. §5.4 → Task 8. §6 → Tasks 6, 8. §7 → Tasks 2, 8. §10 → every task's tests plus Task 11. §11 → Task 5's unparseable-file test.

**Gap found and closed:** spec §6 says a note body is Markdown with links and embeds resolving through the existing ports, and no task rendered a body as Markdown. Task 8 renders bodies as plain text. This is recorded as a deliberate deferral rather than an oversight — see below — because it needs a renderer decision (which subset of Markdown) that the spec scopes but does not settle.

**Placeholder scan:** Tasks 7, 8 and 9 describe their implementations in prose rather than complete code, because each is a DOM-construction step whose exact markup depends on decisions the earlier tasks lock in. Their *tests* are complete and executable, which is what defines done for each.

**Type consistency:** `noteKey` is used throughout (the spec's `noteId` was renamed in Task 2 and propagated). `remove(noteKey, threadId)` differs from the spec's `remove(id)` and is flagged in Task 3. `Anchor` is `readonly` in Task 1 and treated as immutable everywhere.

## Known deferrals

- **Markdown rendering of note bodies** (spec §6). Bodies are stored as Markdown from Task 2 onward, so no migration is needed; only the rail's presentation is plain text for now.
- **Reattach** (spec §5.4) has a button and an action name in Task 8 but no interaction implementation; it needs the same selection plumbing as Task 7 and should follow it.
