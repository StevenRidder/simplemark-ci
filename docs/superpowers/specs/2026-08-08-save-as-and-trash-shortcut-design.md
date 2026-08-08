# File > Save As, and a Trash keyboard shortcut — design

- **Status:** Approved design, ready for planning
- **Date:** 2026-08-08
- **Companion to:** [`commands.ts`](../../../src/application/commands.ts), [`native-menu.ts`](../../../src/app/ui/native-menu.ts), [`bootstrap.ts`](../../../src/app/bootstrap.ts), [`lib.rs`](../../../src-tauri/src/lib.rs)

## 1. What this is

Two small additions to the File menu and command registry:

1. **File > Save As** (`Cmd+Shift+S`) — prompts for a new name/location and
   switches the editor to the new copy. Duplicate and Export already exist as
   context-menu-only actions; Save As is a third, dialog-driven variant that
   also becomes a real menu command with a shortcut.
2. **File > Move to Trash** (`Cmd+Delete`) — trashes the currently open note.
   Trash itself already works (right-click a note in the sidebar); this adds
   a way to trash the note you're *editing*, without leaving the editor.

Neither feature needs new infrastructure: both reuse the dialog plugin,
Rust command pattern, and `runCommand` dispatch that already exist for
`save`, `print`, `duplicate_note`, `export_note`, and `trash_note`.

## 2. Save As

**Registry:** new `saveAs` entry in `commands.ts`, `target: 'shell'`,
accelerator `CmdOrCtrl+Shift+S`, placed in File's Save section:
`['save', 'saveAs']`. Enabled only when a note is open
(`options.workspace?.activeNoteId !== undefined`).

**Backend:** new Rust command `save_note_as(handle) -> Result<Option<OpenedNote>, String>`,
modeled on `export_note` (`lib.rs:721`) — opens a native save dialog via
`tauri-plugin-dialog`, pre-filled with the current filename, filtered to
`.md`/`.markdown`. Differs from `export_note` in its return contract: instead
of copying and returning `bool`, it copies then calls `read_note(&destination)`
and returns `Some(OpenedNote)`, matching `duplicate_note`'s (`lib.rs:684`)
contract so the frontend can open the result the same way. A cancelled dialog
returns `None`, same as `open_note`.

**Same-path guard:** if the picked destination equals the source path,
skip `fs::copy` entirely and just `read_note(&source)` directly. `fs::copy`
opens the destination for writing before it's done reading the source —
copying a file onto itself risks truncating it mid-read. This must be an
explicit early-return, not left to chance.

**Frontend:** `saveNoteAs()` in `tauri.ts`, mirroring `duplicateNote`'s
(`tauri.ts:517`) follow-up: refresh the folder listing, then open the
returned note as the active document — so, like traditional Save As, the
editor ends up showing the new copy, not the original. If the destination is
outside the currently adopted workspace folder, the note opens in the editor
but won't appear in the sidebar, consistent with how File > Open already
handles files outside the workspace.

**Wiring:** `runCommand()` in `bootstrap.ts` gets a `case 'saveAs'` calling
the new action, following the same shape as the existing `case 'save'`.

## 3. Move to Trash (keyboard shortcut)

Trash has no menu presence today — it's reachable only from the sidebar's
right-click context menu. This app has no keybinding mechanism separate from
the command registry (confirmed: no DOM keydown handlers exist for any
menu-bound command; accelerators are resolved by macOS against the native
menu). So a real, global shortcut requires promoting Trash to a proper menu
command, not just adding a hidden accelerator.

**Registry:** new `moveToTrash` entry in `commands.ts`, `target: 'shell'`,
accelerator `CmdOrCtrl+Delete`, its own new section at the end of File:
`[['newNote'], ['openFolder', 'openFile'], ['save', 'saveAs'], ['print'], ['moveToTrash']]`
— separated by a divider from Print, matching the convention (most Mac apps
put a destructive Trash action at the bottom of File, set apart). Enabled
only when a note is open.

**Wiring:** `runCommand()` gets a `case 'moveToTrash'`, calling a new
workspace-level hook with `options.workspace?.activeNoteId` — the same shape
`togglePinned` (`bootstrap.ts:273`) already uses to reach a chrome/workspace
action from the command dispatch. This reuses the existing `trash_note` Rust
command and `trashNote` frontend action (`tauri.ts:632`) as-is; nothing about
trashing itself changes, only how it's triggered.

**Scope:** this command always acts on the *currently open* note, not
whatever the sidebar happens to have selected or hovered — the same note the
editor is showing when `Cmd+Delete` is pressed.

## 4. Out of scope

- A confirmation dialog before trashing — the existing context-menu Trash has
  none today, so the shortcut matches existing behavior rather than
  introducing a new safety gate. (Trash is recoverable via the OS Trash, not
  a permanent delete.)
- Menu presence for the already-existing Duplicate and Export actions — not
  requested here; they remain context-menu-only.
- Any changes to `trash_note`, `duplicate_note`, or `export_note` themselves.

## 5. Testing

| Test | Catches |
|---|---|
| Unit: `save_note_as`'s copy helper copies to a new path and returns the new note | core path |
| Unit: `save_note_as`'s copy helper skips the copy when the destination equals the source | §2 guard |
| Source guard: `runCommand`/`commandState` route `saveAs`/`moveToTrash` to their workspace hooks and disable without an active note | §2, §3 dispatch |
| Source guard: `saveNoteAs` declines the draft, flushes before copying, and installs the result | §2 frontend flow |

**No Playwright coverage, and no automated end-to-end check at all.** Native-menu
accelerators are resolved by macOS against the real application menu — they
are not DOM keydown handlers, so neither Playwright nor the dev browser
preview can trigger `Cmd+Shift+S` or `Cmd+Delete` the way a person actually
would, and neither command gets a second, DOM-reachable surface (no
context-menu row, no toolbar button). The only way to prove either shortcut
actually works is running the packaged app and pressing the keys, the same
constraint this codebase already lives with for CSP-sensitive features.
