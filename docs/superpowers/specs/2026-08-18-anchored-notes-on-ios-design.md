# Anchored notes on iOS — design

**Date:** 2026-08-18
**Status:** approved for planning
**Builds on:** ADR-0007 (annotation before participation), ADR-0011 (comments travel beside the document), `2026-08-06-anchored-notes-design.md`, PR #220 (opening a note must never blank the window)

## 1. Problem

Anchored notes were specified and wired for the desktop shell only. iOS runs the
same entry (`tauri.html` → `src/app/tauri.ts`) and the same shared layer, so the
thread domain, `TauriThreadStore`, `TauriNoteIdentity`, tinted anchors, the rail
and the note stack all ship in the iOS binary and the four Rust commands compile
and are registered there. What is missing is everything a phone needs:

1. **No touch route to Add Note.** The three triggers are ⌘⇧M (hardware
   keyboard), the in-webview selection menu (suppressed because `tauri.ts`
   hardcodes `chromeMode: 'macos'`, which routes right-click to the native
   AppKit menu), and the macOS native context menu (`cfg(target_os = "macos")`).
2. **Sidecar writes fail for Files-opened documents.** iOS grants a file-level
   security scope, not the parent directory, so creating `.simplemark/` beside
   the note is denied. The four notes commands are synchronous, so a lazily
   materialising iCloud file blocks the UI thread.
3. **No phone layout** for `.sm-note-rail`, `.sm-note-composer`,
   `.sm-note-stack`; the composer can land under the keyboard and rail actions
   are far below the 44 pt targets the touch-targets plan enforces elsewhere.
4. **No cross-device freshness.** The mobile watcher polls only the `.md`; a note
   added on the Mac does not appear on the phone until the note is reopened.
5. **No tests** at phone viewport, and no ADR/spec gives notes an iOS scope.

## 2. Decision in one line

Ship notes on iOS as the same feature with a touch trigger, a container-store
fallback where the sidecar cannot be written, a phone layout, and sidecar
freshness — and say so in an ADR amendment. Sidecars-beside-the-document with
directory scope + `NSFileCoordinator` are explicitly *later*.

## 3. Scope

### In

- **Platform signal.** A Rust command `host_platform` (`"macos" | "ios" | "other"`,
  from `cfg!`) read once in `start()`. `chromeMode` gains a third value `'ios'`.
  `window-chrome.ts` splits today's `isMacOS` into two named booleans:
  `hasNativeTitlebar` (`macos`) and `hasNativeContextMenu` (`macos`), so iOS gets
  the in-webview selection menu and the macOS titlebar arrangement stays as is.
  Where iOS should look like macOS today (sidebar/titlebar composition, styles-bar
  storage key), it keeps that behaviour explicitly, not by accident.
- **Touch trigger.** An **Add Note** control in the styles bar (the keyboard
  accessory on phones), placed after `Tables` and also in the More overflow.
  Enabled only when the editor selection is non-empty (uses the existing
  `getSelectionShape`/selection tracking); tapping calls the existing `onAddNote`
  → `capture()`. On the phone the in-webview selection menu also offers Add Note
  because `hasNativeContextMenu` is false there (long-press → `contextmenu` where
  WebKit dispatches it; when it does not, the styles bar is the primary route).
- **Container fallback (Rust).** `sidecar_target` learns a writability probe: if
  the sidecar directory cannot be created/written (permission denied), the store
  falls back to the application-data path for that key, on read and write alike,
  and `ensure_note_id` still stamps `id:`/`comments:` when the `.md` itself is
  writable. Read order stays *sidecar if present, else app data*. The four notes
  commands become `async` and run through `off_the_ui_thread`.
- **Phone layout (CSS, `max-width: 620px`).** Rail becomes a bottom sheet above
  the keyboard inset (`--keyboard-inset`), rail/stack actions ≥ 44 pt, composer
  anchored above the keyboard rather than at `coordsAtPos` when the keyboard is
  open. Selectors added to the touch-target sweep the touch-targets plan defines.
- **Freshness (mobile watcher).** The mobile poll also hashes the sidecar
  (`<parent>/.simplemark/<id>.json` when the `.md` carries a `comments:` link,
  else the app-data file) and emits `note-threads-changed-externally` with the
  handle. The shell re-lists threads and repaints (`notes.reload()` on the
  composition). Own writes are ignored via the same write ledger.
- **Tests.** Vitest for `host_platform` wiring and the chrome split; Rust tests
  for the fallback and the async commands; Playwright at 390 px for
  capture → rail → resolve through the styles-bar button; `cargo check` for
  `aarch64-apple-ios` stays green in CI.
- **Docs.** ADR-0011 amendment: iOS scope, fallback rule, what "beside the
  document" means when the directory is not ours to write.

### Out

- Directory-level security scope acquisition and `NSFileCoordinator` writes.
- `UIEditMenuInteraction` / native iOS callout customisation.
- Desktop watcher sidecar coverage (desktop `notify` watches the `.md` only
  today; tracked as a follow-up so both watchers converge).
- Any change to note semantics, anchors, or the composer's keyboard flow.

## 4. Architecture

```
tauri.ts start()
  └─ invoke('host_platform') ──► chromeMode: 'macos' | 'ios'
        └─ composeApp({ chromeMode }) ──► createWindowChrome({ chromeMode })
              ├─ hasNativeTitlebar   = chromeMode === 'macos'
              ├─ hasNativeContextMenu= chromeMode === 'macos'
              └─ createStylesBar: [Add Note] ── onAddNote ──► captureNote()

notes.rs
  read/write_note_threads (async) ─► off_the_ui_thread ─► resolve_store(key, doc)
        resolve_store: sidecar if writable-or-present, else app-data (fallback)
  read_note_id / ensure_note_id (async) ─► off_the_ui_thread

lib.rs mobile watch_note poll
  hash(.md) as today  +  hash(threads file for this note)
        └─ emit 'note-threads-changed-externally' ─► tauri.ts ─► app.notes.reload()
```

### 4.1 Platform signal

- `src-tauri/src/lib.rs`: `#[tauri::command] fn host_platform() -> &'static str`
  using `cfg!(target_os = "macos")` / `cfg!(target_os = "ios")`. Registered in
  `generate_handler`.
- `src/app/tauri.ts` `start()`: `const platform = await invoke<string>('host_platform')`
  wrapped in try/catch defaulting to `'macos'` (an old binary without the
  command must not change desktop behaviour). Passed as `chromeMode` to
  `mount()`.
- `src/app/bootstrap.ts` / `src/app/ui/window-chrome.ts`: type
  `'web' | 'macos' | 'ios'`. Styles-bar storage keys keep using the mode string,
  so iOS gets its own persisted visibility/position, which is what a phone
  wants (bar visible by default there — see §4.2).

### 4.2 Touch trigger

- `createStylesBar` gains an **Add Note** button (`styles-control styles-note`,
  glyph: a small speech-bubble SVG in the Tabler style used by the bar) after
  `Tables`, and an `Add Note` item in the More overflow, both present only when
  `options.onAddNote !== undefined`. Disabled state mirrors selection emptiness:
  the bar already repaints on selection change (`getSelectionShape` +
  `onSelectionChange` in bootstrap); we add `hasSelection` to that shape.
- On `chromeMode === 'ios'` the styles bar defaults to visible (phone users
  cannot reach View → Styles Bar); the persisted key still wins once set.
- `window-chrome.ts` selection menu: the `contextmenu` listener uses
  `hasNativeContextMenu` instead of `isMacOS`, so on iOS the in-webview menu
  (with Add Note) is built when WebKit dispatches `contextmenu`.

### 4.3 Container fallback

`src-tauri/src/notes.rs`:

```rust
enum ThreadsLocation { Sidecar(PathBuf), AppData(PathBuf) }

fn resolve_threads_location(note_key, document_handle, intent: Read|Write)
  -> Result<ThreadsLocation, String>
```

- `Read`: sidecar if it exists, else app-data (unchanged).
- `Write`: sidecar if `ensure_sidecar_dir_writable(parent)` succeeds
  (`create_dir_all` + a probe `OpenOptions::create(true).write(true)` on a
  `.simplemark/.write-probe` that is removed afterwards); on
  `PermissionDenied`/`ReadOnlyFilesystem` fall back to app-data. Any other error
  is still an error (a full disk must not silently move notes).
- The four commands become `pub async fn … { off_the_ui_thread(move || …).await }`.
  Signatures and TypeScript adapters are unchanged.
- Front-matter `comments:` keeps pointing at `.simplemark/<id>.json` — it names
  where comments *belong*; a note whose comments live in app data on this device
  is exactly ADR-0011's "degraded" state and is documented as such.

### 4.4 Phone layout

`src/app/styles/app.css` under `@media (max-width: 620px)`:

- `.sm-note-rail`: `position: fixed; left: 0; right: 0; bottom: var(--keyboard-inset, 0);`
  max-height 40vh, scrollable, sheet radius; actions `min-height: 44px`.
- `.sm-note-stack`: same bottom-sheet treatment; the tint tap already opens it.
- `.sm-note-composer`: when `.keyboard-open`, `position: fixed; left: 8px; right: 8px;
  bottom: calc(var(--keyboard-inset) + 8px)`; otherwise unchanged. `note-capture.ts`
  keeps `coordsAtPos` placement but adds `data-placement="keyboard"` when
  `documentElement` has `.keyboard-open`, so CSS decides.
- Add `.sm-note-rail button`, `.sm-note-stack button`, `.styles-note` to the
  touch-target sweep list in the touch-targets plan/spec (`phone-touch-targets`).

### 4.5 Freshness

- `lib.rs` mobile `watch_note`: alongside the `.md` hash, track the threads file
  for this note. Path resolution reuses `notes::threads_file_for_document(handle)`
  (new helper: reads front-matter `id`/`comments`; returns sidecar path if
  present, else app-data path for `id` or the degraded key). Poll both; when the
  threads hash changes and is not ours, `emit("note-threads-changed-externally", handle)`.
- `write_note_threads` records its bytes in the `WriteLedger` for that path.
- `tauri.ts`: `listen('note-threads-changed-externally')` → if it matches the
  open handle, `current.notes.reload()`.
- `bootstrap.ts`: `notes.reload()` = re-list via `persist.list(await
  noteKeyForOpenDocument())`, replace `noteThreads`, `paintNotes()`; a failed
  reload sets the same status message as a failed initial load and keeps the
  previous threads.

## 5. Error handling

- Notes never take the document down (PR #220 rule): every new await in the
  shell is guarded and degrades to a status message.
- Fallback only on permission errors; other IO errors surface as today.
- Missing `host_platform` (old binary) → `'macos'`.

## 6. Testing

- Rust: fallback on `PermissionDenied` (read-only parent dir), no fallback on
  other errors, read order, `threads_file_for_document`, async commands compile
  (`cargo test --lib notes::`), `cargo check --target aarch64-apple-ios` in CI.
- Vitest: `tauri.ts` reads `host_platform` and defaults to `'macos'` (source
  guard, per repo convention); `window-chrome` split (`hasNativeContextMenu`
  false for `'ios'`); styles bar renders Add Note only with `onAddNote`.
- Playwright (`tests/ui/notes-phone.spec.ts`, viewport 390×844): styles bar
  shows Add Note; disabled with empty selection; select → tap → composer →
  type → Enter → rail entry → resolve; composer sits above `--keyboard-inset`
  when `.keyboard-open` is set.
- Simulator smoke (manual, recorded in the plan): build the iOS target, open a
  container note, add a note through the styles bar, kill and relaunch, note is
  still there. Real-device Files/iCloud behaviour is called out as unproven by
  the simulator (per project memory).

## 7. Risks

- WebKit `contextmenu` on iOS is inconsistent; the styles bar is the primary
  route by design.
- `visualViewport` inset heuristics already exist and are reused, not
  re-derived.
- The `.simplemark/` directory inside the iCloud `Documents` scope syncs to
  every device; that is ADR-0011's intent, and this design does not change it.
