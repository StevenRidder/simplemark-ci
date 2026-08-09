# iCloud placeholder fast-fail design

## Goal

Opening a Markdown file that iCloud has evicted must not start a download or
leave SimpleMark waiting for one. The app stays usable and explains that the
person must download the file before opening it.

## Scope and decision

On macOS, the native filesystem adapter will read Foundation's ubiquitous-item
resource values before every operation that would read a document's bytes.

- A non-ubiquitous file remains on the existing generic filesystem path.
- An iCloud file whose download status is `NotDownloaded` is rejected before
  `fs::read` runs.
- An iCloud file that is downloading, downloaded, or current continues to the
  normal read path. This change neither starts nor waits for a download.
- If Foundation cannot answer the availability metadata, the adapter preserves
  the existing generic read behaviour and its visible OS error. It must not
  report the file as available based on a guess.

The native command returns a stable, user-facing error naming the file and
telling the person to download it in Finder before trying again. The TypeScript
file port already propagates native command failures, so it needs no second
state or fallback.

This is a deliberately narrow, user-approved exception to the product's
provider-neutral rule: it reads macOS's local iCloud hydration state solely to
avoid an OS-blocking byte read. It does not infer shared folders, authenticate
with iCloud, initiate sync, observe provider identity, or change document
authority. The document is still opened only after its ordinary local bytes
are available.

## Design

`src-tauri/src/lib.rs` gains a macOS-only helper with a platform-neutral
fallback:

1. Convert the `Path` to an `NSURL`.
2. Ask for `NSURLIsUbiquitousItemKey` and
   `NSURLUbiquitousItemDownloadingStatusKey`.
3. Return `Err` only for an explicitly ubiquitous item with the
   `NotDownloaded` status. Other states return `Ok(())`.
4. Call the helper at the single `read_note` boundary, before `fs::read`.

Putting the guard at `read_note` covers file-picker opens, Finder opens,
workspace-note selection, and reopens without duplicating policy across Tauri
commands. It leaves writes, renames, copies, and linked chart data outside
this narrowly requested change.

The macOS dependency declaration enables the Foundation NSURL/NSError support
required by that helper. Non-macOS builds compile a no-op helper, preserving
the shell's honest capability boundary.

## Error handling

`read_note` returns a named availability error before reading an evicted iCloud
file. No command treats it as a cancellation or an empty document. The UI's
existing command-error handling displays the rejection and retains the current
document.

Foundation metadata lookup failures do not silently change the outcome:
the existing `fs::read` error remains the source of truth. This does mean an
unrecognized provider can retain its existing behaviour; the change promises
only the iCloud condition it can prove.

## Tests and verification

The availability decision is factored behind a small testable native seam.
Tests prove that an explicitly evicted iCloud item is rejected before the read
closure executes, while local files, current iCloud files, and unknown
metadata invoke the normal read closure. The prior regression test for catalog
previews remains relevant: listing a folder must not read note bytes.

Before merge, run the focused native tests, `npm run test:native`,
`npm run build:native`, `bash scripts/simplemark_ci.sh`, and
`git diff --check`.
