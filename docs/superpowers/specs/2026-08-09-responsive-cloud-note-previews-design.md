# Responsive cloud note previews

## Goal

Opening or refreshing a Markdown folder stays responsive when a cloud provider
has not downloaded one of its files yet.

## Context

The native catalog currently obtains metadata and reads up to 8 KiB from every
Markdown file while serving a Tauri command. On macOS, that command is invoked
on the UI thread. A cloud placeholder can block `read` while APFS materializes
its bytes, freezing the application.

## Design

The native catalog commands first return a complete, sorted list made from
directory entries and metadata only. They do not open any note contents. This
puts every filename in the sidebar immediately, including a cloud placeholder.

After that response, TypeScript asks a new native transport command to extract
previews for those opaque note handles. That command schedules the blocking
reads on Tauri's blocking worker pool and emits one preview event per finished
note. The shell listens before it restores any folders, retains each arrived
preview in a shell-local overlay, and patches the matching visible row in
place. Existing AI summaries remain the higher-priority subtitle and continue
to win when the list repaints.

This is deliberately a small, provider-neutral preview protocol:

- A local note retains its existing preview and sort order.
- An unreadable or not-yet-downloaded note remains a filename-only row until a
  preview arrives (or indefinitely if the provider cannot supply bytes).
- A cloud read may take time, but it cannot occupy AppKit's event loop.
- Preview arrivals never cause a list re-sort or a search result to jump.
- The implementation does not infer a cloud provider or add provider-specific
  code.

## Error handling

Directory failures remain visible command errors. Per-note preview failure is
non-fatal: the note still appears without a preview. Worker failures are
returned through the existing command error channel with a local explanation.

## Verification

Add native tests proving a catalog never reads preview bytes and that the
background preview request emits the extracted result. Add TypeScript tests for
the preview overlay and in-place row update, including the rule that a later
preview cannot overwrite an AI summary. Run the targeted native and TypeScript
tests, the full native test suite, the canonical gate, and a macOS native build.
The manual check is to open a folder containing an iCloud placeholder and
confirm the filenames appear and the window remains interactive while the
placeholder becomes available.
