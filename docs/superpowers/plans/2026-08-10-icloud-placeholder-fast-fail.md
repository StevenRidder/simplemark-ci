# iCloud Placeholder Fast-Fail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject an evicted iCloud Markdown file before SimpleMark reads its bytes, so opening it never waits for iCloud to download it.

**Architecture:** Keep the decision at the native adapter's one `read_note` boundary. A small platform-neutral decision function turns a proven macOS hydration state into either permission to read or the user-facing error; a macOS-only Foundation probe supplies that state. Other platforms return an unknown state and retain their current filesystem behavior.

**Tech Stack:** Rust 2021, Tauri 2, `objc2-foundation`, native `cargo test`, SimpleMark CI shell gate.

## Global Constraints

- Touch only the native filesystem transport; do not change document, editor, application, or cloud-sync authority.
- The macOS probe reads hydration metadata only. It must not request, start, await, or poll a download.
- Reject only an explicitly ubiquitous file whose status is `NotDownloaded`; unknown metadata and all other providers retain the existing visible `fs::read` behavior.
- The error must name the file and tell the person to download it in Finder before trying again.
- Keep non-macOS builds compiling with a no-op availability probe.
- Preserve byte-for-byte document loading for every readable file.

---

### Task 1: Test the local-availability decision

**Files:**

- Modify: `src-tauri/src/lib.rs:535-554` and the `#[cfg(test)]` module beginning at `src-tauri/src/lib.rs:1867`

**Interfaces:**

- Produces: `enum LocalFileAvailability { Available, ICloudNotDownloaded, Unknown }`
- Produces: `fn require_local_note_bytes(path: &Path, availability: LocalFileAvailability) -> Result<(), String>`

- [ ] **Step 1: Write the failing native tests**

```rust
#[test]
fn rejects_an_icloud_note_that_has_not_been_downloaded_before_reading() {
    let error = require_local_note_bytes(
        Path::new("/Users/reader/Library/Mobile Documents/com~apple~CloudDocs/plan.md"),
        LocalFileAvailability::ICloudNotDownloaded,
    )
    .unwrap_err();

    assert!(error.contains("plan.md"));
    assert!(error.contains("Download it in Finder"));
}

#[test]
fn permits_a_locally_available_note() {
    assert!(require_local_note_bytes(
        Path::new("/Users/reader/notes/plan.md"),
        LocalFileAvailability::Available,
    )
    .is_ok());
}

#[test]
fn leaves_unknown_availability_to_the_existing_filesystem_read() {
    assert!(require_local_note_bytes(
        Path::new("/Users/reader/notes/plan.md"),
        LocalFileAvailability::Unknown,
    )
    .is_ok());
}
```

The first test names the regression: changing the decision to allow an evicted iCloud item must fail it. The other two prove the new condition is narrow.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `cargo test rejects_an_icloud_note_that_has_not_been_downloaded_before_reading --manifest-path src-tauri/Cargo.toml`

Expected: compilation failure because `LocalFileAvailability` and `require_local_note_bytes` do not exist yet.

- [ ] **Step 3: Add the minimal decision code**

Place this directly above `read_note`. Keep the error at the Rust boundary so the Tauri command rejects rather than fabricating an empty document.

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LocalFileAvailability {
    Available,
    ICloudNotDownloaded,
    Unknown,
}

fn require_local_note_bytes(path: &Path, availability: LocalFileAvailability) -> Result<(), String> {
    if availability == LocalFileAvailability::ICloudNotDownloaded {
        return Err(format!(
            "{} is stored in iCloud but has not been downloaded. Download it in Finder, then open it again.",
            path.display()
        ));
    }
    Ok(())
}
```

- [ ] **Step 4: Run the focused decision tests to verify they pass**

Run: `cargo test local_note_bytes --manifest-path src-tauri/Cargo.toml`

Expected: all three availability tests pass.

- [ ] **Step 5: Commit the test-first decision**

```bash
git add src-tauri/src/lib.rs
git commit -m "test: cover unavailable iCloud note reads"
```

### Task 2: Probe macOS hydration state and guard `read_note`

**Files:**

- Modify: `src-tauri/Cargo.toml:41-45`
- Modify: `src-tauri/src/lib.rs:535-554`
- Test: `src-tauri/src/lib.rs:1867-...`

**Interfaces:**

- Consumes: `LocalFileAvailability` and `require_local_note_bytes` from Task 1.
- Produces: `fn local_note_availability(path: &Path) -> LocalFileAvailability` on every target.
- Produces: `fn macos_note_availability(path: &Path) -> LocalFileAvailability` behind `#[cfg(target_os = "macos")]`.
- Consumes: Foundation `NSURLIsUbiquitousItemKey`, `NSURLUbiquitousItemDownloadingStatusKey`, and `NSURLUbiquitousItemDownloadingStatusNotDownloaded`.

- [ ] **Step 1: Extend the failing test with the read-boundary assertion**

```rust
#[test]
fn unavailable_icloud_state_is_rejected_before_the_note_reader_runs() {
    let path = Path::new("/Users/reader/Library/Mobile Documents/com~apple~CloudDocs/plan.md");
    let result = read_note_after_availability_check(path, LocalFileAvailability::ICloudNotDownloaded, || {
        panic!("an unavailable iCloud note must not be read")
    });

    assert!(result.unwrap_err().contains("Download it in Finder"));
}
```

Define `read_note_after_availability_check` as the production-internal boundary used by `read_note`; its third argument returns `Result<Vec<u8>, std::io::Error>`. This keeps the guard and the byte read adjacent while making the no-read guarantee directly testable without inventing a file provider.

- [ ] **Step 2: Run that test to verify it fails for the right reason**

Run: `cargo test unavailable_icloud_state_is_rejected_before_the_note_reader_runs --manifest-path src-tauri/Cargo.toml`

Expected: compilation failure because `read_note_after_availability_check` does not exist.

- [ ] **Step 3: Implement the macOS-only probe and route `read_note` through it**

Enable `NSURL` and `NSError` in the macOS `objc2-foundation` feature list in `src-tauri/Cargo.toml`. In `lib.rs`, use `NSURL::fileURLWithPath`, request the two resource keys with `getResourceValue_forKey_error`, and compare the downloading-status value to `NSURLUbiquitousItemDownloadingStatusNotDownloaded`.

```rust
fn read_note(path: &Path) -> Result<OpenedNote, String> {
    read_note_after_availability_check(path, local_note_availability(path), || fs::read(path))
}

fn read_note_after_availability_check(
    path: &Path,
    availability: LocalFileAvailability,
    read: impl FnOnce() -> Result<Vec<u8>, std::io::Error>,
) -> Result<OpenedNote, String> {
    require_local_note_bytes(path, availability)?;
    let bytes = read().map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    opened_note_from_bytes(path, bytes)
}
```

Extract the existing name/base64 construction into `opened_note_from_bytes(path, bytes)` so the guarded reader and testable boundary preserve the exact `OpenedNote` payload. The macOS probe returns `Unknown` if URL conversion, Foundation lookup, or dynamic type checking fails; it returns `ICloudNotDownloaded` only when both resource values prove that exact state. The non-macOS `local_note_availability` returns `Unknown`.

- [ ] **Step 4: Run native tests and a macOS build**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && npm run test:native && npm run build:native`

Expected: native tests pass and the macOS bundle compiles with the newly enabled Foundation APIs.

- [ ] **Step 5: Run the repository gate and inspect the patch**

Run: `bash scripts/simplemark_ci.sh && git diff --check && git status --short`

Expected: the canonical TypeScript/adapter gate passes, no whitespace errors appear, and only the intended Cargo and native source/test changes remain.

- [ ] **Step 6: Commit the implementation**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/Cargo.lock
git commit -m "fix: fail fast for unavailable iCloud notes"
```

## Verification coverage review

- `ICloudNotDownloaded` is rejected with a clear retry instruction: Task 1.
- Available and unknown states retain the existing read path: Task 1.
- The guarded production boundary does not execute its byte reader for the rejected state: Task 2.
- macOS Foundation bindings and non-macOS compilation are exercised by the native test/build commands: Task 2.
- The complete repository gate, dependency boundaries, and whitespace hygiene are rerun after the change: Task 2.
