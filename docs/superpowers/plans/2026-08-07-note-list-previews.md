# Note-List Previews Implementation Plan (PR 1 — the spine)

> **Status: implemented, with deviations.** This plan was executed on
> `worktree-note-list-previews`. Five things changed during the build and the
> reasons are recorded in the commits rather than rewritten above:
>
> 1. `previewFor` lives in `src/app/note-preview-line.ts`, not `tauri.ts` —
>    vitest runs in `node` by deliberate choice, so a test importing the
>    composition root fails on `document is not defined`.
> 2. The Rust side uses `#[serde(skip_serializing_if)]` on `preview`, because
>    `Option::None` otherwise serialises as `null` and the TypeScript
>    `preview?: string` would have been a lie.
> 3. Running the extractor over real notes rather than fixtures found three
>    defects the fixtures missed. `examples/preview_corpus.rs` is how.
> 4. `distil_for_model` was added — the plan had the queue sending raw leading
>    characters, which measurably degraded output.
> 5. PR 2 landed in the same branch rather than separately, and the prompt asks
>    for two sentences shown in full rather than one clipped line.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `'Local Markdown file'` subtitle on every note-list row with a real preview extracted from the note, and build the content-hash cache, queue and port that PR 2's Foundation Models bridge will plug into.

**Architecture:** A pure Rust module (`note_preview.rs`) derives a SHA-256 content digest and a one-line preview from Markdown bytes. A second Rust module (`note_summaries.rs`) owns an Application Support cache keyed by that digest, plus a one-at-a-time request queue that reaches its summarizer through a trait. The TypeScript side gains one port with two adapters; in PR 1 only the unavailable adapter is composed, so no model is involved anywhere and the whole plan is testable on Linux CI.

**Tech Stack:** Rust (Tauri 2, `serde`, `sha2`), TypeScript (vitest, Playwright), no new JS dependencies.

**Spec:** [`docs/superpowers/specs/2026-08-07-note-list-summaries-design.md`](../specs/2026-08-07-note-list-summaries-design.md)

## Global Constraints

- **Dependency direction (ADR-0001):** `app → adapters → application → domain`. `domain` gains nothing here. `npm run check:boundaries` must pass unchanged.
- **Do not modify [`content_hash`](../../../src-tauri/src/lib.rs:164).** It is `DefaultHasher` serving the write ledger and is correct there. SHA-256 is added alongside it.
- **The summary path only ever reads.** It must not go through `DocumentSession`, must not touch `originalSource`, and must not write to the [`WriteLedger`](../../../src-tauri/src/lib.rs:117).
- **Never reorder the note list.** Sort order is computed from the catalog; a preview arriving must never change row order.
- **Never delay opening.** Nothing in the open path may await a preview or summary.
- **Cache key is the hex SHA-256 of the file's bytes and nothing else** — never the path.
- **Preview cap:** 160 characters, truncated on a word boundary with a trailing `…`.
- **Cache cap:** 5,000 entries, evict least-recently-seen.
- **Quiescence interval:** 30 seconds, one named constant.
- **Rust edition 2021, `rust-version = "1.77"`.** No `async` in `note_preview.rs` — it is pure.
- Run `npm test`, `npm run test:native`, `npm run typecheck` and `npm run check:boundaries` before each commit that touches their surfaces.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src-tauri/src/note_preview.rs` | Create | SHA-256 digest + deterministic preview extraction. Pure, no Tauri, no I/O. |
| `src-tauri/src/note_summaries.rs` | Create | Application Support cache, request queue, Tauri commands. Summarizer behind a trait. |
| `src-tauri/src/lib.rs` | Modify | Declare both modules, extend `WorkspaceCatalogEntry`, register commands. |
| `src-tauri/Cargo.toml` | Modify | Add `sha2`. |
| `src/application/ports.ts` | Modify | Add `NoteSummary` and `NoteSummaryPort`. |
| `src/adapters/intelligence/unavailable-note-summary-port.ts` | Create | The always-absent implementation. |
| `src/adapters/intelligence/tauri-note-summary-port.ts` | Create | Thin transport over the Tauri commands and event. |
| `src/app/tauri.ts` | Modify | Carry `preview` through `catalogWorkspace`, compose the port. |
| `src/app/ui/window-chrome.ts` | Modify | Report visible rows; apply a summary to model *and* span. |
| `tests/domain/note-preview.test.ts` | — | Not used; Rust owns extraction. See Task 2. |

---

## Task 1: SHA-256 content digest

**Files:**
- Create: `src-tauri/src/note_preview.rs`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `note_preview::content_digest(bytes: &[u8]) -> String` — lowercase hex, 64 chars.

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]`, after `base64 = "0.22"`:

```toml
sha2 = "0.10"
```

- [ ] **Step 2: Write the failing test**

Create `src-tauri/src/note_preview.rs` containing only:

```rust
//! Deriving a stable identity and a one-line preview from a note's bytes.
//!
//! Pure: no Tauri, no filesystem, no async. Everything here is unit-tested on
//! every platform, which is why the model-facing work in `note_summaries.rs`
//! is kept out of it.

#[cfg(test)]
mod tests {
    use super::*;

    /// The property `DefaultHasher` does not offer. `content_hash` in `lib.rs`
    /// serves the write ledger and is correct there; a cache that outlives the
    /// process needs a digest whose value is fixed by the algorithm.
    #[test]
    fn digest_is_the_published_sha256_of_the_bytes() {
        assert_eq!(
            content_digest(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn digest_of_empty_input_is_defined() {
        assert_eq!(
            content_digest(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn one_changed_byte_changes_the_digest() {
        assert_ne!(content_digest(b"note\n"), content_digest(b"note\r\n"));
    }
}
```

Add to `src-tauri/src/lib.rs`, beside the existing `mod` declarations near the top:

```rust
pub mod note_preview;
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml note_preview`
Expected: FAIL — `cannot find function 'content_digest' in this scope`

- [ ] **Step 4: Write the minimal implementation**

At the top of `src-tauri/src/note_preview.rs`, above the test module:

```rust
use sha2::{Digest, Sha256};

/// Stable, cross-process identity for a note's exact bytes.
///
/// Lowercase hex so it can be a JSON object key and read in a diff.
pub fn content_digest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml note_preview`
Expected: PASS, 3 tests

- [ ] **Step 6: Confirm the write ledger's hash is untouched**

Run: `git diff src-tauri/src/lib.rs | grep -c DefaultHasher`
Expected: `0` — no line mentioning `DefaultHasher` was added or removed.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/note_preview.rs src-tauri/src/lib.rs
git commit -m "feat: add SHA-256 content digest for note identity"
```

---

## Task 2: Deterministic preview extraction

Extraction rules come from measurement, not taste. Against five real documents, taking the author's own lead sentence matched or beat the on-device model on three; the failures were all caused by metadata lines (`Date:`, `Tone:`, `Transcription:`) being mistaken for prose, which is why they are skipped explicitly.

**Files:**
- Modify: `src-tauri/src/note_preview.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `note_preview::extract_preview(text: &str) -> Option<String>` — `None` when the note has no prose at all.

- [ ] **Step 1: Write the failing tests**

Add inside `mod tests` in `src-tauri/src/note_preview.rs`:

```rust
    /// A README whose lead is a bold tagline. The extractor must take the
    /// tagline, not the H1 and not the paragraph beneath it.
    #[test]
    fn takes_a_bold_lead_sentence() {
        let note = "# SimpleMark\n\n**The beautiful living document for AI work.**\n\nYour agent writes the Markdown.\n";
        assert_eq!(
            extract_preview(note).as_deref(),
            Some("The beautiful living document for AI work.")
        );
    }

    /// A briefing with a labelled headline. The label is scaffolding; the
    /// sentence after it is the preview.
    #[test]
    fn unwraps_a_labelled_lead() {
        let note = "# Status Briefing\n\n## Headline\n\n**Total's FMP asset sync is live in production.** Pads sync cleanly.\n";
        assert_eq!(
            extract_preview(note).as_deref(),
            Some("Total's FMP asset sync is live in production.")
        );
    }

    /// The failure that broke the first attempt: a document whose first lines
    /// are all `Key: value` metadata. Those are not prose.
    #[test]
    fn skips_metadata_lines_before_prose() {
        let note = "# Call Transcript\n\n**Date:** 2026-06-14\n**Duration:** 25 min\n**Source:** recording.m4a\n\nThe team agreed to defer the gateway until June.\n";
        assert_eq!(
            extract_preview(note).as_deref(),
            Some("The team agreed to defer the gateway until June.")
        );
    }

    #[test]
    fn skips_frontmatter_fences_tables_and_quotes() {
        let note = "---\ntitle: x\n---\n\n# Heading\n\n```rust\nfn main() {}\n```\n\n| a | b |\n\n> quoted\n\nThe first real sentence lives here. A second one follows.\n";
        assert_eq!(
            extract_preview(note).as_deref(),
            Some("The first real sentence lives here.")
        );
    }

    #[test]
    fn strips_inline_markup_from_prose() {
        let note = "# Doc\n\nThe `budget` is **fixed** at _four_ thousand tokens for now.\n";
        assert_eq!(
            extract_preview(note).as_deref(),
            Some("The budget is fixed at four thousand tokens for now.")
        );
    }

    /// A short bold run is a label or emphasis, not a lead sentence. Falling
    /// through to prose is what keeps `**Note:**` out of the subtitle.
    #[test]
    fn ignores_a_short_bold_run() {
        let note = "# Doc\n\n**Warning** applies to every one of the cases listed below.\n";
        assert_eq!(
            extract_preview(note).as_deref(),
            Some("Warning applies to every one of the cases listed below.")
        );
    }

    #[test]
    fn caps_a_long_sentence_on_a_word_boundary() {
        let note = format!("# Doc\n\n{}\n", "alpha ".repeat(60));
        let preview = extract_preview(&note).expect("prose");
        assert!(preview.chars().count() <= 160, "got {} chars", preview.chars().count());
        assert!(preview.ends_with('…'));
        assert!(!preview.contains("alph…"), "must cut between words");
    }

    #[test]
    fn returns_none_when_there_is_no_prose() {
        assert_eq!(extract_preview("# Only A Heading\n\n- a\n"), None);
        assert_eq!(extract_preview(""), None);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml note_preview`
Expected: FAIL — `cannot find function 'extract_preview' in this scope`

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/note_preview.rs`, above the test module:

```rust
/// Longest preview we will show. Beyond this the row cannot render it anyway.
const PREVIEW_LIMIT: usize = 160;

/// A bold run shorter than this is emphasis or a label, not a lead sentence.
const LEAD_MIN_WORDS: usize = 5;

/// Prose needs enough words to be a sentence rather than a stray fragment.
const PROSE_MIN_WORDS: usize = 6;

/// Bold labels that introduce the real lead rather than being it.
const LEAD_LABELS: &[&str] = &["one-liner", "headline", "bottom line", "tl;dr", "summary"];

/// Document metadata that reads like prose to a naive scanner. Every one of
/// these produced a wrong preview before it was excluded.
const METADATA_KEYS: &[&str] = &[
    "to", "from", "date", "tone", "type", "product", "source", "status",
    "duration", "transcription", "note", "participants", "author", "updated",
];

/// The author's own lead sentence, or `None` if the note has no prose.
pub fn extract_preview(text: &str) -> Option<String> {
    let mut in_fence = false;
    for raw in strip_frontmatter(text).lines() {
        let line = raw.trim();
        if line.starts_with("```") || line.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence || line.is_empty() || line.starts_with('#') {
            continue;
        }
        // Tables, quotes, images, raw HTML, reference links and horizontal
        // rules are structure. None of them is a sentence about the note.
        if line.starts_with(['|', '>', '!', '<', '[']) {
            continue;
        }
        if line.chars().all(|c| matches!(c, '-' | '=' | '*' | ' ')) {
            continue;
        }
        let content = line.trim_start_matches(['-', '*', '+', ' ']).trim();
        if content.is_empty() || is_metadata(content) {
            continue;
        }
        if let Some(lead) = bold_lead(content) {
            return Some(cap(&lead));
        }
        if content.split_whitespace().count() >= PROSE_MIN_WORDS {
            return Some(cap(&first_sentence(&strip_inline_markup(content))));
        }
    }
    None
}

fn strip_frontmatter(text: &str) -> &str {
    let Some(rest) = text.strip_prefix("---\n") else {
        return text;
    };
    match rest.find("\n---") {
        Some(end) => rest[end + 4..].trim_start_matches('\n'),
        None => text,
    }
}

/// `**Key:** value` and `Key: value` are metadata, whatever they contain.
fn is_metadata(content: &str) -> bool {
    let bare = content.trim_start_matches('*').trim();
    let Some((key, _)) = bare.split_once(':') else {
        return false;
    };
    let key = key.trim_end_matches('*').trim().to_lowercase();
    METADATA_KEYS.contains(&key.as_str())
}

/// A bold opener used as the document's lead sentence, unwrapping a label
/// such as `**One-liner:**` when one introduces it.
fn bold_lead(content: &str) -> Option<String> {
    let rest = content.strip_prefix("**")?;
    let close = rest.find("**")?;
    let head = rest[..close].trim().trim_end_matches(':').trim();
    let tail = rest[close + 2..].trim_start_matches([':', '.', ' ']).trim();

    if LEAD_LABELS.contains(&head.to_lowercase().as_str()) {
        if tail.is_empty() {
            return None;
        }
        return Some(first_sentence(&strip_inline_markup(tail)));
    }
    if head.split_whitespace().count() >= LEAD_MIN_WORDS {
        return Some(strip_inline_markup(head));
    }
    None
}

fn strip_inline_markup(text: &str) -> String {
    text.chars().filter(|c| !matches!(c, '*' | '`' | '_')).collect()
}

fn first_sentence(text: &str) -> String {
    let bytes = text.as_bytes();
    for (index, window) in bytes.windows(2).enumerate() {
        if matches!(window[0], b'.' | b'!' | b'?' | b';') && window[1] == b' ' {
            return text[..=index].trim().to_string();
        }
    }
    text.trim().to_string()
}

/// Truncate on a word boundary so a preview never ends mid-word.
fn cap(text: &str) -> String {
    if text.chars().count() <= PREVIEW_LIMIT {
        return text.to_string();
    }
    let clipped: String = text.chars().take(PREVIEW_LIMIT - 1).collect();
    let cut = clipped.rfind(' ').unwrap_or(clipped.len());
    format!("{}…", clipped[..cut].trim_end())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml note_preview`
Expected: PASS, 11 tests

- [ ] **Step 5: Check the extractor against the real corpus**

The spike measured these exact documents. Confirm the extractor still agrees:

```bash
cargo test --manifest-path src-tauri/Cargo.toml note_preview -- --nocapture
```

Expected: PASS. If `takes_a_bold_lead_sentence` or `skips_metadata_lines_before_prose` fails, the rule order in `extract_preview` is wrong — metadata must be checked before `bold_lead`, because `**Date:** …` matches both.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/note_preview.rs
git commit -m "feat: extract a one-line preview from a note's Markdown"
```

---

## Task 3: Carry the preview through the workspace catalog

**Files:**
- Modify: `src-tauri/src/lib.rs` (`WorkspaceCatalogEntry` at `:100`, `catalog_entry` at `:437`)

**Interfaces:**
- Consumes: `note_preview::extract_preview`.
- Produces: `WorkspaceCatalogEntry.preview: Option<String>`, serialized as `preview` in the catalog JSON.

Reading is bounded to 8 KiB per note. Every preview rule looks only at the document's opening, so reading further would cost I/O on folder open — which the spec forbids delaying — and buy nothing.

- [ ] **Step 1: Write the failing test**

Add to `mod tests` in `src-tauri/src/lib.rs`:

```rust
    #[test]
    fn catalog_entries_carry_a_preview() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(
            directory.path().join("note.md"),
            b"# Title\n\nThe agent rewrites this file while you read it.\n",
        )
        .unwrap();

        let catalog = workspace_catalog_for_directory(directory.path()).unwrap();

        assert_eq!(
            catalog.notes[0].preview.as_deref(),
            Some("The agent rewrites this file while you read it.")
        );
    }

    /// A note with no prose is not an error and not an empty string — it has
    /// no preview, and the row simply shows none.
    #[test]
    fn a_note_without_prose_has_no_preview() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("stub.md"), b"# Just A Heading\n").unwrap();

        let catalog = workspace_catalog_for_directory(directory.path()).unwrap();

        assert_eq!(catalog.notes[0].preview, None);
    }

    /// Opening a folder must not read whole notes. A 5 MiB file still yields
    /// its preview from the first 8 KiB.
    #[test]
    fn reads_only_a_bounded_prefix_of_each_note() {
        let directory = tempfile::tempdir().unwrap();
        let mut huge = String::from("# Huge\n\nThe opening sentence is right here.\n");
        huge.push_str(&"filler filler filler\n".repeat(250_000));
        fs::write(directory.path().join("huge.md"), huge.as_bytes()).unwrap();

        let catalog = workspace_catalog_for_directory(directory.path()).unwrap();

        assert_eq!(
            catalog.notes[0].preview.as_deref(),
            Some("The opening sentence is right here.")
        );
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml catalog_entries_carry_a_preview`
Expected: FAIL — `no field 'preview' on type 'WorkspaceCatalogEntry'`

- [ ] **Step 3: Extend the struct**

In `src-tauri/src/lib.rs`, replace the `WorkspaceCatalogEntry` definition at line 100:

```rust
pub struct WorkspaceCatalogEntry {
    handle: String,
    name: String,
    modified_ms: u64,
    created_ms: u64,
    /// The author's own lead sentence, when the note has one. `None` renders
    /// no subtitle rather than an empty one.
    preview: Option<String>,
}
```

- [ ] **Step 4: Populate it in `catalog_entry`**

Replace the body of `catalog_entry` (line 437):

```rust
/// How much of a note is read to find its preview.
///
/// Every extraction rule looks at the document's opening only, and folder
/// open must not wait on I/O — so this is deliberately small.
const PREVIEW_READ_LIMIT: u64 = 8 * 1024;

fn catalog_entry(path: &Path) -> Result<WorkspaceCatalogEntry, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
    Ok(WorkspaceCatalogEntry {
        handle: path.display().to_string(),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string()),
        modified_ms: millis(metadata.modified()),
        created_ms: millis(metadata.created()),
        preview: preview_of(path),
    })
}

/// An unreadable note is not a catalog failure. The row still lists, without
/// a subtitle — the same outcome as a note that has no prose.
fn preview_of(path: &Path) -> Option<String> {
    use std::io::Read;
    let file = fs::File::open(path).ok()?;
    let mut buffer = Vec::with_capacity(PREVIEW_READ_LIMIT as usize);
    file.take(PREVIEW_READ_LIMIT).read_to_end(&mut buffer).ok()?;
    note_preview::extract_preview(&String::from_utf8_lossy(&buffer))
}
```

- [ ] **Step 5: Fix the other construction site**

`inspected_workspace_note` at line 451 builds entries through `catalog_entry`, so it needs no change. Confirm no other literal `WorkspaceCatalogEntry { … }` exists:

Run: `grep -n "WorkspaceCatalogEntry {" src-tauri/src/lib.rs`
Expected: exactly two lines — the struct definition and the one inside `catalog_entry`.

- [ ] **Step 6: Run the whole native suite**

Run: `npm run test:native`
Expected: PASS, including the three new tests.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: carry a note preview through the workspace catalog"
```

---

## Task 4: Show the preview in the note list

**Files:**
- Modify: `src/app/tauri.ts` (`catalogWorkspace` at `:984`, single-note options at `:916`)
- Modify: `src/application/ports.ts` (`WorkspaceCatalogEntry`)
- Test: `tests/app/note-preview-mapping.test.ts`

**Interfaces:**
- Consumes: `WorkspaceCatalogEntry.preview` from Task 3.
- Produces: note-list rows whose `preview` is the note's own lead sentence, or `''`.

- [ ] **Step 1: Write the failing test**

Create `tests/app/note-preview-mapping.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { previewFor } from '../../src/app/tauri.js'

describe('note-list preview', () => {
  it('uses the note’s own lead sentence', () => {
    expect(previewFor({ preview: 'The agent rewrites this file.' })).toBe(
      'The agent rewrites this file.',
    )
  })

  // The row must go bare rather than back to the placeholder this work
  // exists to delete.
  it('is empty when the note has no prose', () => {
    expect(previewFor({ preview: undefined })).toBe('')
    expect(previewFor({})).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/app/note-preview-mapping.test.ts`
Expected: FAIL — `previewFor is not exported`

- [ ] **Step 3: Add the field to the port type**

In `src/application/ports.ts`, extend `WorkspaceCatalogEntry`:

```ts
export interface WorkspaceCatalogEntry {
  /** Opaque, stable identity. Native uses the canonical absolute path. */
  readonly handle: string
  readonly name: string
  readonly modifiedMs: number
  readonly createdMs: number
  /** The note's own lead sentence, when it has one. */
  readonly preview?: string
}
```

- [ ] **Step 4: Implement and use it**

In `src/app/tauri.ts`, add near the other helpers:

```ts
/**
 * The subtitle for one row.
 *
 * Every row used to show the constant `'Local Markdown file'`, which told the
 * reader nothing. A note with no prose now shows nothing at all rather than
 * boilerplate.
 */
export function previewFor(note: { readonly preview?: string }): string {
  return note.preview ?? ''
}
```

In `catalogWorkspace` (line 984), replace `preview: 'Local Markdown file',` with:

```ts
      preview: previewFor(note),
```

At line 916, replace `preview: 'Current local Markdown file',` with:

```ts
        preview: '',
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/app/note-preview-mapping.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 6: Verify the placeholder is gone**

Run: `grep -rn "Local Markdown file" src/`
Expected: no output.

- [ ] **Step 7: Run the full checks**

Run: `npm test && npm run typecheck && npm run check:boundaries`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/tauri.ts src/application/ports.ts tests/app/note-preview-mapping.test.ts
git commit -m "feat: show each note's own lead sentence in the note list"
```

---

## Task 5: The summary cache

**Files:**
- Create: `src-tauri/src/note_summaries.rs`
- Modify: `src-tauri/src/lib.rs` (module declaration)

**Interfaces:**
- Consumes: `note_preview::content_digest`.
- Produces:
  - `note_summaries::SummaryCache::load(path: &Path) -> SummaryCache`
  - `SummaryCache::get(&mut self, digest: &str, now_ms: u64) -> Option<String>`
  - `SummaryCache::insert(&mut self, digest: &str, summary: &str, now_ms: u64)`
  - `SummaryCache::save(&self, path: &Path) -> Result<(), String>`

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/note_summaries.rs`:

```rust
//! Durable summaries keyed by note content, and the queue that fills them.
//!
//! Nothing here knows what a language model is: the summarizer arrives as a
//! `Summarizer` implementation, so every path below is tested on Linux with no
//! model present. PR 2 supplies the Foundation Models implementation.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_disk() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("note-summaries.json");

        let mut cache = SummaryCache::load(&path);
        cache.insert("abc", "Defers the gateway until June.", 1_000);
        cache.save(&path).unwrap();

        let mut reloaded = SummaryCache::load(&path);
        assert_eq!(
            reloaded.get("abc", 2_000).as_deref(),
            Some("Defers the gateway until June.")
        );
    }

    /// A missing or corrupt cache is an empty cache, never a startup failure.
    #[test]
    fn a_missing_or_unreadable_cache_starts_empty() {
        let directory = tempfile::tempdir().unwrap();
        let absent = directory.path().join("nothing.json");
        assert_eq!(SummaryCache::load(&absent).len(), 0);

        let corrupt = directory.path().join("corrupt.json");
        std::fs::write(&corrupt, b"{ not json").unwrap();
        assert_eq!(SummaryCache::load(&corrupt).len(), 0);
    }

    #[test]
    fn a_hit_touches_last_seen() {
        let mut cache = SummaryCache::default();
        cache.insert("abc", "one", 1_000);
        assert!(cache.get("abc", 9_000).is_some());
        assert_eq!(cache.last_seen("abc"), Some(9_000));
    }

    /// Every editing session mints a new digest and abandons the previous one,
    /// so without eviction this file grows for the life of the install.
    #[test]
    fn evicts_the_least_recently_seen_past_the_cap() {
        let mut cache = SummaryCache::default();
        for index in 0..MAX_ENTRIES {
            cache.insert(&format!("key{index}"), "summary", index as u64);
        }
        assert_eq!(cache.len(), MAX_ENTRIES);

        cache.insert("newest", "summary", 9_999_999);

        assert_eq!(cache.len(), MAX_ENTRIES);
        assert!(cache.get("newest", 9_999_999).is_some());
        assert!(cache.get("key0", 9_999_999).is_none(), "oldest must be evicted");
    }

    /// A partially written cache must never be observable, for the same reason
    /// `FilePort.save` writes atomically.
    #[test]
    fn writes_atomically_leaving_no_temp_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("note-summaries.json");

        let mut cache = SummaryCache::default();
        cache.insert("abc", "one", 1_000);
        cache.save(&path).unwrap();

        let leftovers: Vec<_> = std::fs::read_dir(directory.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name != "note-summaries.json")
            .collect();
        assert!(leftovers.is_empty(), "left behind {leftovers:?}");
    }
}
```

Add to `src-tauri/src/lib.rs` beside the Task 1 declaration:

```rust
pub mod note_summaries;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml note_summaries`
Expected: FAIL — `cannot find type 'SummaryCache' in this scope`

- [ ] **Step 3: Write the implementation**

At the top of `src-tauri/src/note_summaries.rs`, above the test module:

```rust
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Entries kept before the least-recently-seen are dropped.
///
/// Bounded because §4.3's quiescence rule mints a fresh digest per editing
/// session and never refers to the previous one again.
pub const MAX_ENTRIES: usize = 5_000;

const CACHE_VERSION: u32 = 1;

#[derive(Clone, Serialize, Deserialize)]
pub struct CachedSummary {
    summary: String,
    last_seen_ms: u64,
}

#[derive(Serialize, Deserialize)]
pub struct SummaryCache {
    version: u32,
    entries: HashMap<String, CachedSummary>,
}

impl Default for SummaryCache {
    fn default() -> Self {
        Self { version: CACHE_VERSION, entries: HashMap::new() }
    }
}

impl SummaryCache {
    /// A missing, unreadable, corrupt, or future-versioned cache is an empty
    /// cache. Summaries are derived data; refusing to start over them would
    /// trade a cosmetic subtitle for a broken app.
    pub fn load(path: &Path) -> Self {
        let Ok(bytes) = fs::read(path) else {
            return Self::default();
        };
        match serde_json::from_slice::<Self>(&bytes) {
            Ok(cache) if cache.version == CACHE_VERSION => cache,
            _ => Self::default(),
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        let parent = path
            .parent()
            .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;

        let encoded = serde_json::to_vec_pretty(self)
            .map_err(|error| format!("Could not encode the summary cache: {error}"))?;

        // Same discipline as `FilePort.save`: a partially written file is
        // never observable at the real path.
        let temporary = path.with_extension("json.writing");
        fs::write(&temporary, &encoded)
            .map_err(|error| format!("Could not write {}: {error}", temporary.display()))?;
        fs::rename(&temporary, path)
            .map_err(|error| format!("Could not replace {}: {error}", path.display()))
    }

    pub fn get(&mut self, digest: &str, now_ms: u64) -> Option<String> {
        let entry = self.entries.get_mut(digest)?;
        entry.last_seen_ms = now_ms;
        Some(entry.summary.clone())
    }

    pub fn insert(&mut self, digest: &str, summary: &str, now_ms: u64) {
        self.entries.insert(
            digest.to_string(),
            CachedSummary { summary: summary.to_string(), last_seen_ms: now_ms },
        );
        self.evict_to_cap();
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    #[cfg(test)]
    fn last_seen(&self, digest: &str) -> Option<u64> {
        self.entries.get(digest).map(|entry| entry.last_seen_ms)
    }

    fn evict_to_cap(&mut self) {
        while self.entries.len() > MAX_ENTRIES {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_seen_ms)
                .map(|(digest, _)| digest.clone())
            else {
                return;
            };
            self.entries.remove(&oldest);
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml note_summaries`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/note_summaries.rs src-tauri/src/lib.rs
git commit -m "feat: add a content-keyed summary cache with LRU eviction"
```

---

## Task 6: The queue, behind a stubbed summarizer

**Files:**
- Modify: `src-tauri/src/note_summaries.rs`

**Interfaces:**
- Consumes: `SummaryCache`, `note_preview::content_digest`.
- Produces:
  - `trait Summarizer { fn summarize(&self, distilled: &str) -> Option<String>; }`
  - `note_summaries::SummaryQueue::new(cache: SummaryCache) -> SummaryQueue`
  - `SummaryQueue::request(&mut self, handles: &[String])` — replaces the wanted set
  - `SummaryQueue::drain_next(&mut self, summarizer: &dyn Summarizer, now_ms: u64) -> Option<NoteSummary>`
  - `note_summaries::tidy_summary(raw: &str) -> Option<String>` — the hygiene gate
  - `struct NoteSummary { handle: String, content_hash: String, summary: String }`

`request` **replaces** rather than appends: a newer viewport supersedes an older one, matching what [`SupersedingOperationQueue.enqueueLatest`](../../../src/app/superseding-operation-queue.ts) does on the TypeScript side.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `src-tauri/src/note_summaries.rs`:

```rust
    struct StubSummarizer {
        reply: Option<String>,
    }

    impl Summarizer for StubSummarizer {
        fn availability(&self) -> bool {
            self.reply.is_some()
        }

        fn summarize(&self, _distilled: &str) -> Option<String> {
            self.reply.clone()
        }
    }

    fn note_at(directory: &Path, name: &str, body: &str) -> String {
        let path = directory.join(name);
        std::fs::write(&path, body.as_bytes()).unwrap();
        path.display().to_string()
    }

    #[test]
    fn summarizes_the_first_wanted_note_and_caches_it() {
        let directory = tempfile::tempdir().unwrap();
        let handle = note_at(directory.path(), "a.md", "# A\n\nThe first sentence is here.\n");
        let summarizer = StubSummarizer { reply: Some("Stub summary".into()) };

        let mut queue = SummaryQueue::new(SummaryCache::default());
        queue.request(&[handle.clone()]);

        let produced = queue.drain_next(&summarizer, 1_000).expect("a summary");
        assert_eq!(produced.handle, handle);
        assert_eq!(produced.summary, "Stub summary");

        // Second pass: nothing left to do, and the answer came from cache.
        assert!(queue.drain_next(&summarizer, 2_000).is_none());
        assert_eq!(queue.cache_len(), 1);
    }

    /// The first handle is the active note. It must be served before the rows
    /// that merely happen to be on screen.
    #[test]
    fn serves_the_active_note_first() {
        let directory = tempfile::tempdir().unwrap();
        let active = note_at(directory.path(), "active.md", "# A\n\nActive note prose here.\n");
        let other = note_at(directory.path(), "other.md", "# B\n\nOther note prose here.\n");
        let summarizer = StubSummarizer { reply: Some("Stub".into()) };

        let mut queue = SummaryQueue::new(SummaryCache::default());
        queue.request(&[active.clone(), other]);

        assert_eq!(queue.drain_next(&summarizer, 1_000).unwrap().handle, active);
    }

    /// Scrolling replaces the wanted set. Work queued for rows that have
    /// scrolled away must not be done.
    #[test]
    fn a_newer_request_supersedes_an_older_one() {
        let directory = tempfile::tempdir().unwrap();
        let gone = note_at(directory.path(), "gone.md", "# A\n\nScrolled away already.\n");
        let shown = note_at(directory.path(), "shown.md", "# B\n\nOn screen right now.\n");
        let summarizer = StubSummarizer { reply: Some("Stub".into()) };

        let mut queue = SummaryQueue::new(SummaryCache::default());
        queue.request(&[gone]);
        queue.request(&[shown.clone()]);

        assert_eq!(queue.drain_next(&summarizer, 1_000).unwrap().handle, shown);
        assert!(queue.drain_next(&summarizer, 2_000).is_none());
    }

    /// A declined note keeps its extractor preview, is not cached, and is not
    /// retried in a loop within the session.
    #[test]
    fn a_declined_note_is_not_cached_and_not_retried() {
        let directory = tempfile::tempdir().unwrap();
        let handle = note_at(directory.path(), "a.md", "# A\n\nThe first sentence is here.\n");
        let declining = StubSummarizer { reply: None };

        let mut queue = SummaryQueue::new(SummaryCache::default());
        queue.request(&[handle.clone()]);

        assert!(queue.drain_next(&declining, 1_000).is_none());
        assert_eq!(queue.cache_len(), 0);

        // Still nothing to do: the attempt is remembered for this session.
        queue.request(&[handle]);
        assert!(queue.drain_next(&declining, 2_000).is_none());
    }

    /// An empty or heading-only note has nothing to summarize. Queueing it
    /// would spend a model call to describe nothing.
    #[test]
    fn a_note_with_no_prose_is_never_queued() {
        let directory = tempfile::tempdir().unwrap();
        let empty = note_at(directory.path(), "empty.md", "");
        let heading = note_at(directory.path(), "heading.md", "# Just A Heading\n");
        let summarizer = StubSummarizer { reply: Some("Stub".into()) };

        let mut queue = SummaryQueue::new(SummaryCache::default());
        queue.request(&[empty, heading]);

        assert!(queue.drain_next(&summarizer, 1_000).is_none());
        assert_eq!(queue.cache_len(), 0);
    }

    /// §4.4: hygiene only. Leaked markup is stripped and nothing is rejected
    /// for being short, blunt, or a title restatement — those judgements were
    /// overruled on review after several such outputs were judged good.
    #[test]
    fn the_gate_strips_markup_and_keeps_terse_output() {
        assert_eq!(
            tidy_summary("Uses `GitHub`'s **native** merge queue").as_deref(),
            Some("Uses GitHub's native merge queue")
        );
        assert_eq!(tidy_summary("Project Maxwell kickoff call").as_deref(), Some("Project Maxwell kickoff call"));
        assert_eq!(tidy_summary("OpenAI's Free Tier Update").as_deref(), Some("OpenAI's Free Tier Update"));
    }

    #[test]
    fn the_gate_rejects_empty_output_and_caps_length() {
        assert_eq!(tidy_summary(""), None);
        assert_eq!(tidy_summary("   \n  "), None);
        assert_eq!(tidy_summary("**``**"), None);

        let long = "alpha ".repeat(80);
        let tidied = tidy_summary(&long).expect("kept");
        assert!(tidied.chars().count() <= 160);
    }

    /// A summary is one line. A model that returns several must not blow the
    /// row's layout open.
    #[test]
    fn the_gate_collapses_newlines() {
        assert_eq!(
            tidy_summary("First line.\nSecond line.").as_deref(),
            Some("First line. Second line.")
        );
    }

    /// Editing a note changes its digest, so the cached summary no longer
    /// applies and the note becomes wanted again.
    #[test]
    fn edited_content_misses_the_cache() {
        let directory = tempfile::tempdir().unwrap();
        let handle = note_at(directory.path(), "a.md", "# A\n\nThe original sentence.\n");
        let summarizer = StubSummarizer { reply: Some("Stub".into()) };

        let mut queue = SummaryQueue::new(SummaryCache::default());
        queue.request(&[handle.clone()]);
        assert!(queue.drain_next(&summarizer, 1_000).is_some());

        std::fs::write(&handle, b"# A\n\nA completely rewritten sentence.\n").unwrap();
        queue.request(&[handle]);
        assert!(queue.drain_next(&summarizer, 2_000).is_some());
        assert_eq!(queue.cache_len(), 2);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml note_summaries`
Expected: FAIL — `cannot find type 'SummaryQueue' in this scope`

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/note_summaries.rs`, above the test module:

```rust
use std::collections::HashSet;

use crate::note_preview;

/// How much of a note is sent for summarization.
///
/// The spike distilled a 33,736-character document to 867 and halved latency;
/// nothing measured needed more than 2,253 against a 4,096-token window.
const DISTIL_LIMIT: usize = 3_000;

/// Produces a one-line summary, or `None` when it cannot or will not.
///
/// PR 1 has only a stub. PR 2 supplies the Foundation Models implementation
/// behind the same trait, so nothing above this line changes.
pub trait Summarizer {
    /// Whether this summarizer can do anything at all right now. Apple
    /// requires a runtime availability check rather than a compile-time
    /// assumption, so this is a method and not a constant.
    fn availability(&self) -> bool;

    fn summarize(&self, distilled: &str) -> Option<String>;
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub handle: String,
    pub content_hash: String,
    pub summary: String,
}

pub struct SummaryQueue {
    cache: SummaryCache,
    /// Handles the viewport currently wants, active note first.
    wanted: Vec<String>,
    /// Digests already attempted and declined this session. Prevents a note
    /// the model refuses from being retried on every scroll.
    attempted: HashSet<String>,
}

impl SummaryQueue {
    pub fn new(cache: SummaryCache) -> Self {
        Self { cache, wanted: Vec::new(), attempted: HashSet::new() }
    }

    /// Replaces the wanted set. A newer viewport supersedes an older one
    /// rather than queueing behind it.
    pub fn request(&mut self, handles: &[String]) {
        self.wanted = handles.to_vec();
    }

    /// Does at most one note's work. Returns the summary to emit, or `None`
    /// when there is nothing left to do.
    pub fn drain_next(
        &mut self,
        summarizer: &dyn Summarizer,
        now_ms: u64,
    ) -> Option<NoteSummary> {
        while !self.wanted.is_empty() {
            let handle = self.wanted.remove(0);
            let Some(bytes) = std::fs::read(&handle).ok() else {
                continue;
            };
            let digest = note_preview::content_digest(&bytes);

            if let Some(summary) = self.cache.get(&digest, now_ms) {
                return Some(NoteSummary { handle, content_hash: digest, summary });
            }
            if self.attempted.contains(&digest) {
                continue;
            }

            let text = String::from_utf8_lossy(&bytes);

            // A note with no prose has nothing to summarize. Spending a model
            // call to describe an empty file or a bare heading is waste.
            if note_preview::extract_preview(&text).is_none() {
                continue;
            }

            let distilled: String = text.chars().take(DISTIL_LIMIT).collect();
            self.attempted.insert(digest.clone());

            match summarizer.summarize(&distilled).as_deref().and_then(tidy_summary) {
                Some(summary) => {
                    self.cache.insert(&digest, &summary, now_ms);
                    return Some(NoteSummary { handle, content_hash: digest, summary });
                }
                // Declined, or output that did not survive hygiene: the row
                // keeps its extractor preview and nothing is written. A later
                // session retries; this one does not.
                None => continue,
            }
        }
        None
    }

    pub fn cache(&self) -> &SummaryCache {
        &self.cache
    }

    #[cfg(test)]
    fn cache_len(&self) -> usize {
        self.cache.len()
    }
}

/// The hygiene gate (§4.4). Strips leaked markup, collapses a multi-line
/// reply to one line, caps length, and rejects what is left if it is empty.
///
/// It makes no quality judgement. An earlier draft rejected short summaries,
/// questions, and lines that restated the title; those rejections were
/// overruled on review because several of the outputs they killed were judged
/// good. A gate that second-guesses accepted output only produces false
/// negatives.
pub fn tidy_summary(raw: &str) -> Option<String> {
    let collapsed = raw
        .chars()
        .map(|c| if c == '\n' || c == '\r' || c == '\t' { ' ' } else { c })
        .filter(|c| !matches!(c, '*' | '`' | '_' | '#' | '|' | '[' | ']'))
        .collect::<String>();

    let mut tidied = String::with_capacity(collapsed.len());
    let mut previous_was_space = false;
    for character in collapsed.chars() {
        if character == ' ' {
            if !previous_was_space && !tidied.is_empty() {
                tidied.push(' ');
            }
            previous_was_space = true;
        } else {
            tidied.push(character);
            previous_was_space = false;
        }
    }

    let tidied = tidied.trim();
    if tidied.is_empty() {
        return None;
    }
    Some(note_preview::cap_for_row(tidied))
}
```

Task 2's `cap` is the same rule, so expose it rather than duplicating it. In `src-tauri/src/note_preview.rs`, rename `fn cap` to:

```rust
/// Truncate on a word boundary so a preview never ends mid-word.
pub fn cap_for_row(text: &str) -> String {
```

and update its two call sites inside `extract_preview` from `cap(&lead)` / `cap(&first_sentence(…))` to `cap_for_row(…)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml note_summaries`
Expected: PASS, 14 tests (5 from Task 5, 9 added here)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/note_summaries.rs
git commit -m "feat: add a superseding, one-at-a-time summary queue"
```

---

## Task 7: The port and the unavailable adapter

**Files:**
- Modify: `src/application/ports.ts`
- Create: `src/adapters/intelligence/unavailable-note-summary-port.ts`
- Create: `src/adapters/intelligence/index.ts`
- Test: `tests/adapters/unavailable-note-summary-port.test.ts`

**Interfaces:**
- Produces: `NoteSummary`, `NoteSummaryPort`, `UnavailableNoteSummaryPort`.

- [ ] **Step 1: Write the failing test**

Create `tests/adapters/unavailable-note-summary-port.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { UnavailableNoteSummaryPort } from '../../src/adapters/intelligence/index.js'

describe('the unavailable note summary port', () => {
  // This is the path taken by the browser shell, every Intel Mac, every Mac
  // on macOS 25 or earlier, and anyone with Apple Intelligence off. It is
  // load-bearing, not a stub.
  it('reports that summaries are unavailable', async () => {
    await expect(new UnavailableNoteSummaryPort().available()).resolves.toBe(false)
  })

  it('accepts a request and does nothing', async () => {
    await expect(new UnavailableNoteSummaryPort().request(['a.md'])).resolves.toBeUndefined()
  })

  it('never calls a listener, and unsubscribing is safe', () => {
    const listener = vi.fn()
    const unsubscribe = new UnavailableNoteSummaryPort().onSummary(listener)
    unsubscribe()
    unsubscribe()
    expect(listener).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/adapters/unavailable-note-summary-port.test.ts`
Expected: FAIL — cannot resolve `src/adapters/intelligence/index.js`

- [ ] **Step 3: Declare the port**

Append to `src/application/ports.ts`:

```ts
/** One note's summary, keyed to the exact content it describes. */
export interface NoteSummary {
  readonly handle: string
  /** Hex SHA-256 of the bytes this summary was written from. */
  readonly contentHash: string
  readonly summary: string
}

/**
 * Optional one-line summaries for note-list rows.
 *
 * The "bytes, not strings" rule above does not reach this port: a summary is
 * display text that never round-trips to disk, so it cannot destroy the byte
 * evidence the D7 contract protects.
 *
 * Implementations: Foundation Models on macOS 26+ Apple silicon, and an
 * unavailable one everywhere else. A caller must work correctly when
 * `available()` is false — the note list then shows extracted previews only.
 */
export interface NoteSummaryPort {
  available(): Promise<boolean>
  /** Requests summaries, highest priority first. Idempotent; supersedes. */
  request(handles: readonly string[]): Promise<void>
  /** Returns an unsubscribe function. */
  onSummary(listener: (summary: NoteSummary) => void): () => void
}
```

- [ ] **Step 4: Write the adapter**

Create `src/adapters/intelligence/unavailable-note-summary-port.ts`:

```ts
import type { NoteSummary, NoteSummaryPort } from '../../application/index.js'

/**
 * Summaries are absent, not disabled.
 *
 * Every method succeeds quietly. Nothing greys out, nothing explains itself,
 * and no setting appears — a caller cannot tell this apart from a machine
 * whose model simply has nothing to say yet.
 */
export class UnavailableNoteSummaryPort implements NoteSummaryPort {
  async available(): Promise<boolean> {
    return false
  }

  async request(_handles: readonly string[]): Promise<void> {}

  onSummary(_listener: (summary: NoteSummary) => void): () => void {
    return () => {}
  }
}
```

Create `src/adapters/intelligence/index.ts`:

```ts
export { UnavailableNoteSummaryPort } from './unavailable-note-summary-port.js'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/adapters/unavailable-note-summary-port.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 6: Confirm the boundary rule still holds**

Run: `npm run check:boundaries && npm run typecheck`
Expected: both PASS. `adapters` importing `application` is the permitted direction.

- [ ] **Step 7: Commit**

```bash
git add src/application/ports.ts src/adapters/intelligence tests/adapters/unavailable-note-summary-port.test.ts
git commit -m "feat: add the note summary port and its unavailable adapter"
```

---

## Task 8: The Tauri commands and adapter

**Files:**
- Modify: `src-tauri/src/note_summaries.rs` (commands), `src-tauri/src/lib.rs` (registration, managed state)
- Create: `src/adapters/intelligence/tauri-note-summary-port.ts`
- Modify: `src/adapters/intelligence/index.ts`, `src/app/tauri.ts`, `src/app/browser.ts`
- Test: `tests/adapters/tauri-note-summary-port.test.ts`

**Interfaces:**
- Consumes: `SummaryQueue`, `NoteSummaryPort`.
- Produces: commands `note_summaries_available` and `request_note_summaries`; event `note-summary` carrying `NoteSummary`.

In PR 1 the registered summarizer always declines, so `note_summaries_available` returns `false` on every platform and the composed adapter is the unavailable one. The commands exist so PR 2 changes one implementation rather than the whole surface.

- [ ] **Step 1: Write the failing test**

Create `tests/adapters/tauri-note-summary-port.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { TauriNoteSummaryPort } from '../../src/adapters/intelligence/index.js'

describe('the Tauri note summary port', () => {
  it('asks the native side whether summaries are available', async () => {
    const invoke = vi.fn().mockResolvedValue(true)
    const port = new TauriNoteSummaryPort(invoke, vi.fn())
    await expect(port.available()).resolves.toBe(true)
    expect(invoke).toHaveBeenCalledWith('note_summaries_available', {})
  })

  it('forwards requested handles in priority order', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    await new TauriNoteSummaryPort(invoke, vi.fn()).request(['active.md', 'other.md'])
    expect(invoke).toHaveBeenCalledWith('request_note_summaries', {
      handles: ['active.md', 'other.md'],
    })
  })

  it('delivers summaries from the native event and unsubscribes', async () => {
    const unlisten = vi.fn()
    let deliver: ((event: { payload: unknown }) => void) | undefined
    const listen = vi.fn().mockImplementation((_name, handler) => {
      deliver = handler
      return Promise.resolve(unlisten)
    })
    const received: unknown[] = []

    const stop = new TauriNoteSummaryPort(vi.fn(), listen).onSummary((s) => received.push(s))
    await Promise.resolve()

    deliver?.({ payload: { handle: 'a.md', contentHash: 'abc', summary: 'One line.' } })
    expect(received).toEqual([{ handle: 'a.md', contentHash: 'abc', summary: 'One line.' }])

    stop()
    await Promise.resolve()
    expect(unlisten).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/adapters/tauri-note-summary-port.test.ts`
Expected: FAIL — `TauriNoteSummaryPort is not exported`

- [ ] **Step 3: Write the adapter**

Create `src/adapters/intelligence/tauri-note-summary-port.ts`:

```ts
import type { NoteSummary, NoteSummaryPort } from '../../application/index.js'

export type TauriSummaryInvoke = (command: string, args: object) => Promise<unknown>
export type TauriSummaryListen = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>

/**
 * Thin transport to the native summary queue (ADR-0001: a Tauri command is a
 * transport, never a place where a rule lives).
 *
 * Requests are fire-and-forget and results arrive on an event, because a
 * summary must never be something the note list waits for.
 */
export class TauriNoteSummaryPort implements NoteSummaryPort {
  constructor(
    private readonly invoke: TauriSummaryInvoke,
    private readonly listen: TauriSummaryListen,
  ) {}

  async available(): Promise<boolean> {
    return (await this.invoke('note_summaries_available', {})) === true
  }

  async request(handles: readonly string[]): Promise<void> {
    await this.invoke('request_note_summaries', { handles: [...handles] })
  }

  onSummary(listener: (summary: NoteSummary) => void): () => void {
    let stopped = false
    let unlisten: (() => void) | undefined

    void this.listen('note-summary', (event) => {
      const payload = event.payload as Partial<NoteSummary> | null
      if (
        payload === null ||
        typeof payload.handle !== 'string' ||
        typeof payload.contentHash !== 'string' ||
        typeof payload.summary !== 'string'
      ) {
        return
      }
      listener({
        handle: payload.handle,
        contentHash: payload.contentHash,
        summary: payload.summary,
      })
    }).then((stop) => {
      unlisten = stop
      // The caller may have unsubscribed before `listen` resolved.
      if (stopped) stop()
    })

    return () => {
      stopped = true
      unlisten?.()
    }
  }
}
```

Add to `src/adapters/intelligence/index.ts`:

```ts
export { TauriNoteSummaryPort } from './tauri-note-summary-port.js'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/adapters/tauri-note-summary-port.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Add the native commands**

Append to `src-tauri/src/note_summaries.rs`, above the test module:

```rust
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

/// The summarizer PR 1 ships: it declines everything.
///
/// Not a placeholder to be deleted — it is what every non-macOS platform, and
/// every Mac without Apple Intelligence, will keep using.
pub struct NoSummarizer;

impl Summarizer for NoSummarizer {
    fn availability(&self) -> bool {
        false
    }

    fn summarize(&self, _distilled: &str) -> Option<String> {
        None
    }
}

/// Managed state: the queue plus the cache path it persists to.
pub struct SummaryState {
    queue: Mutex<SummaryQueue>,
    cache_path: std::path::PathBuf,
}

impl SummaryState {
    pub fn new(cache_path: std::path::PathBuf) -> Self {
        Self {
            queue: Mutex::new(SummaryQueue::new(SummaryCache::load(&cache_path))),
            cache_path,
        }
    }
}

/// Whether this build can produce summaries at all.
///
/// `false` means the webview never asks, so no work is queued and the note
/// list shows extracted previews only. PR 1 ships `NoSummarizer` on every
/// platform, so this is `false` everywhere; PR 2 makes it report what the
/// Foundation Models bridge actually says.
#[tauri::command]
pub fn note_summaries_available() -> bool {
    NoSummarizer.availability()
}

/// Records what the viewport wants and drains it one note at a time.
///
/// Returns immediately. Results arrive on the `note-summary` event, because
/// nothing in the note list may wait on a model.
#[tauri::command]
pub fn request_note_summaries(
    app: AppHandle,
    state: State<'_, SummaryState>,
    handles: Vec<String>,
) -> Result<(), String> {
    let Ok(mut queue) = state.queue.lock() else {
        return Ok(());
    };
    queue.request(&handles);

    let summarizer = NoSummarizer;
    let now = now_ms();
    while let Some(summary) = queue.drain_next(&summarizer, now) {
        let _ = app.emit("note-summary", summary);
    }
    let _ = queue.cache().save(&state.cache_path);
    Ok(())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// Where the cache lives, under the identifier in `tauri.conf.json`.
pub fn cache_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("note-summaries.json"))
        .map_err(|error| format!("Could not resolve the application data directory: {error}"))
}
```

- [ ] **Step 6: Register the commands and the state**

In `src-tauri/src/lib.rs`, the `generate_handler!` list at line 1143 currently ends:

```rust
            watch_note,
            stop_watching_note,
            watch_workspace_folder
        ])
```

Replace that with:

```rust
            watch_note,
            stop_watching_note,
            watch_workspace_folder,
            note_summaries::note_summaries_available,
            note_summaries::request_note_summaries
        ])
```

And in the builder's `setup`, before `.build(...)`:

```rust
        .setup(|app| {
            let path = note_summaries::cache_path(&app.handle())?;
            app.manage(note_summaries::SummaryState::new(path));
            Ok(())
        })
```

- [ ] **Step 7: Compose the port**

In `src/app/tauri.ts`, where the other adapters are constructed, add:

```ts
  // PR 1 registers a summarizer that declines, so this resolves to the
  // unavailable port on every platform. PR 2 changes only what
  // `note_summaries_available` returns.
  const summaryTransport = new TauriNoteSummaryPort(invoke, listen)
  const noteSummaries: NoteSummaryPort = (await summaryTransport.available())
    ? summaryTransport
    : new UnavailableNoteSummaryPort()
```

In `src/app/browser.ts`, compose `new UnavailableNoteSummaryPort()` directly — the browser shell has no native side to ask.

- [ ] **Step 8: Run everything**

Run: `npm test && npm run test:native && npm run typecheck && npm run check:boundaries`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/note_summaries.rs src-tauri/src/lib.rs src/adapters/intelligence src/app/tauri.ts src/app/browser.ts tests/adapters/tauri-note-summary-port.test.ts
git commit -m "feat: expose the summary queue as Tauri commands and a port"
```

---

## Task 9: Report visible rows and apply summaries without reordering

**Files:**
- Modify: `src/app/ui/window-chrome.ts`
- Test: `tests/ui/note-summaries.spec.ts`

**Interfaces:**
- Consumes: `NoteSummaryPort`.
- Produces: `WorkspaceOptions.onVisibleNotesChanged?: (handles: readonly string[]) => void` and `applyNoteSummary(handle: string, summary: string): void` on the chrome handle.

Two things must both happen when a summary arrives. The note model's `preview` is updated **because the search filter reads it** (`${note.title} ${note.preview}` at [line 2166](../../../src/app/ui/window-chrome.ts:2166)) and because the list has a full re-render path that would otherwise wipe a DOM-only patch. The `<span>` is patched directly **because re-rendering would re-run the sort**, and the spec forbids reordering.

- [ ] **Step 1: Write the failing Playwright test**

Create `tests/ui/note-summaries.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('a summary replaces one subtitle and never reorders the list', async ({ page }) => {
  await page.goto('/')

  const rows = page.locator('.note-item')
  await expect(rows.first()).toBeVisible()
  const orderBefore = await rows.locator('.note-select strong').allTextContents()

  // Deliver a summary the way the native side does.
  await page.evaluate(() => {
    const target = document.querySelector('.note-item .note-select strong')
    ;(window as unknown as {
      __simplemarkApplyNoteSummary?: (handle: string, summary: string) => void
    }).__simplemarkApplyNoteSummary?.(target?.textContent ?? '', 'A one-line summary.')
  })

  await expect(page.locator('.note-item').first().locator('.note-select span').first())
    .toHaveText('A one-line summary.')

  const orderAfter = await rows.locator('.note-select strong').allTextContents()
  expect(orderAfter).toEqual(orderBefore)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/ui/note-summaries.spec.ts`
Expected: FAIL — the subtitle never becomes `'A one-line summary.'`

- [ ] **Step 3: Report visible rows**

In `src/app/ui/window-chrome.ts`, after the `for (const note of visibleNotes)` loop finishes appending items, add:

```ts
      // Which rows are actually on screen drives summary priority. Nothing is
      // computed during scroll itself — the observer only reports handles, and
      // the native side does the work one note at a time.
      visibleObserver?.disconnect()
      if (workspace.onVisibleNotesChanged !== undefined) {
        const onScreen = new Set<string>()
        visibleObserver = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset['noteId']
            if (id === undefined) continue
            if (entry.isIntersecting) onScreen.add(id)
            else onScreen.delete(id)
          }
          const active = workspace.activeNoteId
          const ordered = [
            ...(active !== undefined && onScreen.has(active) ? [active] : []),
            ...[...onScreen].filter((id) => id !== active),
          ]
          reportVisible.enqueueLatest('note-summaries', async () => {
            workspace.onVisibleNotesChanged?.(ordered)
          })
        })
        for (const element of noteItems.querySelectorAll('.note-item')) {
          visibleObserver.observe(element)
        }
      }
```

Declare alongside the other chrome-scoped state:

```ts
  let visibleObserver: IntersectionObserver | undefined
  // A newer viewport supersedes an older one rather than queueing behind it.
  const reportVisible = new SupersedingOperationQueue((error) => console.error(error))
```

And set `item.dataset['noteId'] = note.id` immediately after `item.className = 'note-item'`.

- [ ] **Step 4: Apply an arriving summary**

Add to the chrome's returned handle:

```ts
    /**
     * Applies one summary in place.
     *
     * Updates the note model as well as the span: the search filter reads
     * `preview`, and the list has a full re-render path that would otherwise
     * discard a DOM-only change. Deliberately does not re-render, because
     * re-rendering re-runs the sort and the list must never reorder.
     */
    applyNoteSummary(handle: string, summary: string): void {
      const note = workspaceNotes.find((candidate) => candidate.id === handle)
      if (note === undefined) return
      Object.assign(note, { preview: summary })
      const row = noteItems.querySelector(`.note-item[data-note-id="${CSS.escape(handle)}"]`)
      const span = row?.querySelector('.note-select span')
      if (span !== null && span !== undefined) span.textContent = summary
    },
```

Expose it for the Playwright test in the same place the chrome is constructed:

```ts
  ;(window as unknown as {
    __simplemarkApplyNoteSummary?: (handle: string, summary: string) => void
  }).__simplemarkApplyNoteSummary = (handle, summary) => chrome.applyNoteSummary(handle, summary)
```

- [ ] **Step 5: Wire the port in**

In `src/app/tauri.ts`, after the chrome is built:

```ts
  noteSummaries.onSummary((summary) => chrome.applyNoteSummary(summary.handle, summary.summary))
```

and pass `onVisibleNotesChanged: (handles) => void noteSummaries.request(handles)` in the workspace options built by `catalogWorkspace`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx playwright test tests/ui/note-summaries.spec.ts`
Expected: PASS

- [ ] **Step 7: Run everything**

Run: `npm test && npm run test:ui && npm run typecheck && npm run check:boundaries`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/ui/window-chrome.ts src/app/tauri.ts tests/ui/note-summaries.spec.ts
git commit -m "feat: prioritise summaries by viewport and apply them in place"
```

---

## Task 10: Re-summarise only after writes stop

**Files:**
- Modify: `src-tauri/src/note_summaries.rs`
- Modify: `src-tauri/src/lib.rs` (the watcher emit sites at `:964` and `:1021`)

**Interfaces:**
- Consumes: `SummaryQueue`, `SummaryState`.
- Produces: `SummaryQueue::note_changed(&mut self, handle: &str, now_ms: u64)`, `SummaryQueue::quiesced(&mut self, now_ms: u64) -> Vec<String>` (takes `&mut self` — claiming a note clears it), and `note_summaries::note_changed_externally(state: &SummaryState, handle: &str)`.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `src-tauri/src/note_summaries.rs`:

```rust
    /// An agent rewriting a file fires the watcher constantly. One call per
    /// write would mean a model call every few seconds, indefinitely.
    #[test]
    fn a_burst_of_writes_yields_one_re_summary() {
        let mut queue = SummaryQueue::new(SummaryCache::default());
        for tick in 0..20 {
            queue.note_changed("a.md", 1_000 + tick * 500);
        }
        // Still being written: nothing is due yet.
        assert!(queue.quiesced(1_000 + 20 * 500).is_empty());

        let settled = 1_000 + 19 * 500 + QUIESCENCE_MS + 1;
        assert_eq!(queue.quiesced(settled), vec!["a.md".to_string()]);
    }

    /// Once claimed, a note is not due again until it changes again.
    #[test]
    fn a_quiesced_note_is_reported_once() {
        let mut queue = SummaryQueue::new(SummaryCache::default());
        queue.note_changed("a.md", 1_000);
        let settled = 1_000 + QUIESCENCE_MS + 1;
        assert_eq!(queue.quiesced(settled).len(), 1);
        assert!(queue.quiesced(settled + 10_000).is_empty());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml note_summaries`
Expected: FAIL — `cannot find value 'QUIESCENCE_MS' in this scope`

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/note_summaries.rs`:

```rust
/// How long a file must be still before it is re-summarized.
///
/// Saves and agent writes change the content digest and are therefore cache
/// misses. Chosen to sit well clear of an agent's write cadence, so an editing
/// session costs one model call rather than one per write.
pub const QUIESCENCE_MS: u64 = 30_000;
```

Add the field to `SummaryQueue`, initialised in `new` as `HashMap::new()`:

```rust
    /// Handles written recently, and when they were last written.
    pending_changes: HashMap<String, u64>,
```

And the methods, inside `impl SummaryQueue`:

```rust
    /// Records that a note changed on disk. Called for every watcher event;
    /// a burst simply moves the deadline.
    pub fn note_changed(&mut self, handle: &str, now_ms: u64) {
        self.pending_changes.insert(handle.to_string(), now_ms);
    }

    /// Handles whose writes have stopped long enough to be worth re-reading.
    /// Claiming them clears them: a note is due once per burst.
    pub fn quiesced(&mut self, now_ms: u64) -> Vec<String> {
        let due: Vec<String> = self
            .pending_changes
            .iter()
            .filter(|(_, last)| now_ms.saturating_sub(**last) > QUIESCENCE_MS)
            .map(|(handle, _)| handle.clone())
            .collect();
        for handle in &due {
            self.pending_changes.remove(handle);
        }
        due
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml note_summaries`
Expected: PASS, 16 tests (14 from Tasks 5–6, 2 added here)

- [ ] **Step 5: Connect the watcher**

Without this the methods above are dead code — the queue never learns a file
changed. Add to `src-tauri/src/note_summaries.rs`:

```rust
/// Records an external write so §4.3's quiescence timer can start.
///
/// Called for every watcher event, which during agent activity means many per
/// second. It only stamps a time; no reading and no model work happens here.
pub fn note_changed_externally(state: &SummaryState, handle: &str) {
    if let Ok(mut queue) = state.queue.lock() {
        queue.note_changed(handle, now_ms());
    }
}
```

In `src-tauri/src/lib.rs`, at the watcher emit site (line 964), alongside the
existing `app.emit("note-changed-externally", handle.clone())`:

```rust
            if let Some(state) = app.try_state::<note_summaries::SummaryState>() {
                note_summaries::note_changed_externally(&state, &handle);
            }
```

Then extend `request_note_summaries` (Task 8) so the webview's next request
also picks up anything that has since settled. Immediately after
`queue.request(&handles);`:

```rust
    // Notes whose writes have stopped are wanted again, behind whatever the
    // viewport asked for — the visible rows still come first.
    let settled = queue.quiesced(now_ms());
    let mut wanted = handles;
    wanted.extend(settled);
    queue.request(&wanted);
```

- [ ] **Step 6: Verify the wiring is live**

Run: `grep -n "note_changed_externally" src-tauri/src/lib.rs src-tauri/src/note_summaries.rs`
Expected: three lines — the definition, the call in the watcher, and nothing orphaned.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 7: Run everything and commit**

Run: `npm run test:native && npm test && npm run typecheck && npm run check:boundaries`
Expected: all PASS.

```bash
git add src-tauri/src/note_summaries.rs
git commit -m "feat: re-summarise a note only once its writes have stopped"
```

---

## Task 11: Open the pull request

- [ ] **Step 1: Confirm the whole gate is green**

```bash
npm test && npm run test:native && npm run test:ui && npm run typecheck && npm run check:boundaries
```

Expected: every command PASS. Do not proceed on a failure.

- [ ] **Step 2: Confirm the constraints held**

```bash
grep -rn "Local Markdown file" src/ ; grep -c DefaultHasher src-tauri/src/note_summaries.rs src-tauri/src/note_preview.rs
```

Expected: no output from the first (placeholder gone); `0` from both files in the second (the write ledger's hash untouched).

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin HEAD
```

Then open the PR against `main` and, once the required status is green, add it to the merge queue. Per [`AGENTS.md`](../../../AGENTS.md) there is no human review step: anything touching `src/`, `src-tauri/` or `tests/` goes through the queue.

---

## Follow-on: PR 2

Not planned here. Its first step is confirming which GitHub-hosted runner image carries the macOS 26 SDK — `macos-15` ([`native-testbuild.yml:40`](../../../.github/workflows/native-testbuild.yml:40)) cannot compile `FoundationModels`, and planning the Swift module against an unconfirmed image would be planning on an assumption. Once confirmed, PR 2 adds `src-tauri/swift/SimpleMarkIntelligence.swift`, `build.rs` linking, `foundation_models.rs`, and changes exactly one thing above: `note_summaries_available` stops returning `false`, and a real `Summarizer` replaces `NoSummarizer`.
