# File > Save As, and a Move to Trash keyboard shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `File > Save As` (`Cmd+Shift+S`, prompts for a name/location, then edits the copy) and `File > Move to Trash` (`Cmd+Delete`, trashes the currently open note) to SimpleMark's native menu and command registry.

**Architecture:** Both are new entries in the shared `DocumentCommandId` registry (`commands.ts`), dispatched through the existing `runCommand`/`commandState` switch in `bootstrap.ts`, reaching platform-specific implementations in `tauri.ts` through the same `WorkspaceOptions` hook pattern `onDuplicateNote`/`onExportNote`/`onTrashNote` already use. Save As needs one new Rust command (`save_note_as`, modeled on the existing `export_note`); Move to Trash needs no new backend — it reuses `trash_note` exactly as it already exists, just reached from a new place.

**Tech Stack:** TypeScript (Vite, Vitest), Rust (Tauri 2, `tauri-plugin-dialog`), Playwright for existing UI specs (not used here — see Task 5 for why).

## Global Constraints

- Accelerator strings in `commands.ts` MUST use single quotes (`accelerator: 'CmdOrCtrl+Shift+S'`) — a Rust test (`every_registry_accelerator_parses` in `lib.rs`) extracts every accelerator by splitting on the literal text `accelerator: '`, and a double-quoted accelerator is invisible to it.
- Every command in `COMMANDS` must appear in exactly one place in `MENUS` (enforced by `tests/application/commands.test.ts`).
- Rust command names use `snake_case`; the generated JS binding keeps that name in `invoke('save_note_as', ...)` calls — do not camelCase it on the Rust side.

---

### Task 1: Rust — `save_note_as` command

**Files:**
- Modify: `src-tauri/src/lib.rs:721` (add helper + command near `export_note`)
- Modify: `src-tauri/src/lib.rs:1281` (`invoke_handler(tauri::generate_handler![...])` list)
- Test: `src-tauri/src/lib.rs` (`mod tests` block, near `duplicate_note_copies_bytes_without_overwriting_prior_copies` at line 1701)

**Interfaces:**
- Produces: `fn copy_note_to(source: &Path, destination: &Path) -> Result<OpenedNote, String>` — pure, no `AppHandle`, directly unit-testable.
- Produces: `async fn save_note_as(app: AppHandle, handle: String) -> Result<Option<OpenedNote>, String>` — Tauri command, invoked from the frontend as `invoke('save_note_as', { handle })`. Returns `None` when the save dialog is cancelled, matching `open_note`'s contract.

- [ ] **Step 1: Write the failing Rust tests for `copy_note_to`**

Add to the `mod tests` block in `src-tauri/src/lib.rs`, directly after `duplicate_note_copies_bytes_without_overwriting_prior_copies` (ends at line 1719):

```rust
    #[test]
    fn copy_note_to_copies_bytes_to_a_new_path() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("idea.md");
        fs::write(&source, b"# Exact\r\n\r\nbytes").unwrap();
        let destination = directory.path().join("renamed idea.md");

        let saved = copy_note_to(&source, &destination).unwrap();

        assert_eq!(saved.name, "renamed idea.md");
        assert_eq!(fs::read(&destination).unwrap(), b"# Exact\r\n\r\nbytes");
        assert_eq!(fs::read(&source).unwrap(), b"# Exact\r\n\r\nbytes");
    }

    #[test]
    fn copy_note_to_the_same_path_reads_without_copying() {
        // fs::copy opens the destination for writing before it has finished
        // reading the source, so copying a file onto itself risks truncating
        // it mid-read. The same path must short-circuit instead.
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("idea.md");
        fs::write(&source, b"# Exact\r\n\r\nbytes").unwrap();

        let saved = copy_note_to(&source, &source).unwrap();

        assert_eq!(saved.name, "idea.md");
        assert_eq!(fs::read(&source).unwrap(), b"# Exact\r\n\r\nbytes");
    }
```

- [ ] **Step 2: Run the tests to verify they fail to compile**

Run: `cargo test --manifest-path src-tauri/Cargo.toml copy_note_to`
Expected: FAIL — `copy_note_to` is not defined.

- [ ] **Step 3: Implement `copy_note_to` and `save_note_as`**

Insert into `src-tauri/src/lib.rs` directly after `export_note` (which ends at line 748, right before the `trash_note` block at line 750):

```rust
/// Copies `source`'s exact bytes to `destination` and reads the result back.
///
/// A destination equal to the source is not copied — `fs::copy` opens the
/// destination for writing before it has finished reading the source, so
/// copying a file onto itself risks truncating it mid-read.
fn copy_note_to(source: &Path, destination: &Path) -> Result<OpenedNote, String> {
    if destination == source {
        return read_note(source);
    }
    fs::copy(source, destination).map_err(|error| {
        format!(
            "Could not save {} to {}: {error}",
            source.display(),
            destination.display()
        )
    })?;
    read_note(destination)
}

/// Prompts for a new name/location and switches the document to the copy.
///
/// Unlike `duplicate_note`, the destination is the person's own choice, not
/// an auto-generated "copy" name — the traditional desktop Save As.
#[tauri::command]
async fn save_note_as(app: AppHandle, handle: String) -> Result<Option<OpenedNote>, String> {
    let source = PathBuf::from(&handle);
    let name = source
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "note.md".to_string());
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .set_file_name(name)
        .blocking_save_file();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let destination = picked
        .into_path()
        .map_err(|error| format!("That destination has no writable path: {error}"))?;
    copy_note_to(&source, &destination).map(Some)
}
```

- [ ] **Step 4: Register the command**

In `src-tauri/src/lib.rs`, modify the `invoke_handler(tauri::generate_handler![...])` list (currently at lines 1281–1309) — add `save_note_as` directly after `export_note`:

```rust
            duplicate_note,
            export_note,
            save_note_as,
            trash_note,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml copy_note_to`
Expected: PASS (2 tests: `copy_note_to_copies_bytes_to_a_new_path`, `copy_note_to_the_same_path_reads_without_copying`)

- [ ] **Step 6: Run the full Rust suite to catch any registration mistake**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, no compile errors from the `generate_handler!` list.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add save_note_as Tauri command for File > Save As"
```

---

### Task 2: Command registry — `saveAs` and `moveToTrash`

**Files:**
- Modify: `src/application/commands.ts:92-94` (`COMMANDS`), `:464` (`MENUS` File section)
- Test: `tests/application/commands.test.ts:233-242` (existing test breaks — must be updated), plus new assertions

**Interfaces:**
- Produces: `DocumentCommandId` gains `'saveAs'` and `'moveToTrash'`, both `target: 'shell'`.
- Consumes (Task 3/4 will use these): `COMMANDS.saveAs`, `COMMANDS.moveToTrash`.

- [ ] **Step 1: Write the failing tests**

In `tests/application/commands.test.ts`, replace the existing test at lines 233–242:

```ts
  it('ends File with Print alone, where macOS puts it', () => {
    // Its own section, so the menu renders a rule above it. Print grouped with
    // Save reads as a second way to keep the file rather than a way out of it.
    const file = MENUS.find((menu) => menu.label === 'File')
    expect(file!.sections.at(-1)).toEqual(['print'])
    expect(COMMANDS.print.accelerator).toBe('CmdOrCtrl+P')
    // The shell owns it: printing is an OS service, not an editor transaction,
    // and nothing about it may reach the document.
    expect(COMMANDS.print.target).toBe('shell')
  })
```

with:

```ts
  it('keeps Print its own section, and ends File with Move to Trash apart from it', () => {
    // Print and Move to Trash each render their own rule. Print grouped with
    // Save would read as a second way to keep the file rather than a way out
    // of it; Move to Trash grouped with Print would read as a routine action
    // rather than the destructive one macOS convention sets apart.
    const file = MENUS.find((menu) => menu.label === 'File')
    expect(file!.sections.at(-2)).toEqual(['print'])
    expect(file!.sections.at(-1)).toEqual(['moveToTrash'])
    expect(COMMANDS.print.accelerator).toBe('CmdOrCtrl+P')
    // The shell owns both: printing is an OS service and trashing is a
    // filesystem operation, neither an editor transaction.
    expect(COMMANDS.print.target).toBe('shell')
    expect(COMMANDS.moveToTrash.accelerator).toBe('CmdOrCtrl+Delete')
    expect(COMMANDS.moveToTrash.target).toBe('shell')
  })

  it('places Save As beside Save, with its own shortcut', () => {
    const file = MENUS.find((menu) => menu.label === 'File')
    expect(file!.sections).toContainEqual(['save', 'saveAs'])
    expect(COMMANDS.saveAs.accelerator).toBe('CmdOrCtrl+Shift+S')
    expect(COMMANDS.saveAs.target).toBe('shell')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/application/commands.test.ts`
Expected: FAIL — `COMMANDS.saveAs`/`COMMANDS.moveToTrash` are `undefined`, and the old Print-alone assertion is gone so its replacement fails on the current (unchanged) `MENUS` shape.

- [ ] **Step 3: Add the command ids**

In `src/application/commands.ts`, modify the `DocumentCommandId` union — insert `'saveAs'` after `'save'` and `'moveToTrash'` after `'togglePinned'` (lines 92–95):

```ts
  | 'save'
  | 'saveAs'
  | 'print'
  | 'find'
  | 'togglePinned'
  | 'moveToTrash'
```

Modify the `COMMANDS` record (lines 260–263), inserting `saveAs` after `save` and `moveToTrash` after `togglePinned`:

```ts
  save: { id: 'save', label: 'Save', target: 'shell', accelerator: 'CmdOrCtrl+S' },
  saveAs: { id: 'saveAs', label: 'Save As…', target: 'shell', accelerator: 'CmdOrCtrl+Shift+S' },
  print: { id: 'print', label: 'Print…', target: 'shell', accelerator: 'CmdOrCtrl+P' },
  find: { id: 'find', label: 'Find in Document…', target: 'shell', accelerator: 'CmdOrCtrl+F' },
  togglePinned: { id: 'togglePinned', label: 'Pin to Top', target: 'shell', checkable: true },
  moveToTrash: { id: 'moveToTrash', label: 'Move to Trash', target: 'shell', accelerator: 'CmdOrCtrl+Delete' },
```

- [ ] **Step 4: Place both in the File menu**

In `src/application/commands.ts`, modify the `MENUS` File entry (line 461–465):

```ts
  {
    label: 'File',
    // Print and Move to Trash each sit alone, the destructive action kept
    // apart from the rest of File the way macOS convention keeps it.
    sections: [['newNote'], ['openFolder', 'openFile'], ['save', 'saveAs'], ['print'], ['moveToTrash']],
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/application/commands.test.ts`
Expected: PASS, all tests including the two modified/added ones.

- [ ] **Step 6: Commit**

```bash
git add src/application/commands.ts tests/application/commands.test.ts
git commit -m "feat: register saveAs and moveToTrash commands in the File menu"
```

---

### Task 3: Dispatch — `bootstrap.ts` wiring and `WorkspaceOptions` hook

**Files:**
- Modify: `src/app/ui/window-chrome.ts:188` (`WorkspaceOptions` interface)
- Modify: `src/app/bootstrap.ts:224-229` (`runCommand` switch), `:394-400` (`commandState`)
- Test: `tests/app/save-as-and-trash-shortcut.test.ts` (new)

**Interfaces:**
- Consumes: `COMMANDS.saveAs`, `COMMANDS.moveToTrash` (Task 2).
- Produces: `WorkspaceOptions.onSaveNoteAs?: (id: string) => Promise<void>` — Task 4's `tauri.ts` wiring assigns this.
- Consumes (already exists): `WorkspaceOptions.onTrashNote?: (id: string) => Promise<void>`, `WorkspaceOptions.activeNoteId: string`, `WorkspaceOptions.notes: readonly WorkspaceNote[]`.

- [ ] **Step 1: Write the failing source-guard test**

Create `tests/app/save-as-and-trash-shortcut.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * `bootstrap.ts` composes a real editor and DOM, so no behavioural test in
 * this suite can drive it end to end (see tests/app/native-new-note.test.ts
 * for the established reasoning). A source guard proves the wiring shape
 * instead: that Save As and Move to Trash reach the workspace hooks they're
 * supposed to, and that both stay disabled with no note open.
 */

const BOOTSTRAP = readFileSync('src/app/bootstrap.ts', 'utf8')

/** The body of a top-level `function <name>` in the composition closure. */
function closureFunction(name: string): string {
  const start = BOOTSTRAP.indexOf(`  function ${name}(`)
  expect(start, `${name} should exist in src/app/bootstrap.ts`).toBeGreaterThan(-1)
  const end = BOOTSTRAP.indexOf('\n  }\n', start)
  expect(end, `${name} should be a two-space-indented closure member`).toBeGreaterThan(start)
  return BOOTSTRAP.slice(start, end)
}

describe('dispatching saveAs and moveToTrash', () => {
  const runCommand = closureFunction('runCommand')
  const commandState = closureFunction('commandState')

  it('routes saveAs to the workspace hook, with the active note as its target', () => {
    expect(runCommand).toMatch(/case 'saveAs':\s*\n\s*void options\.workspace\?\.onSaveNoteAs\?\.\(options\.workspace\?\.activeNoteId/)
  })

  it('routes moveToTrash to the existing trash hook, with the active note as its target', () => {
    expect(runCommand).toMatch(/case 'moveToTrash':\s*\n\s*void options\.workspace\?\.onTrashNote\?\.\(options\.workspace\?\.activeNoteId/)
  })

  it('disables saveAs when there is no active note or no hook to reach', () => {
    expect(commandState).toMatch(/id === 'saveAs'/)
    expect(commandState).toMatch(/onSaveNoteAs !== undefined && active !== undefined/)
  })

  it('disables moveToTrash when there is no active note or no hook to reach', () => {
    expect(commandState).toMatch(/id === 'moveToTrash'/)
    expect(commandState).toMatch(/onTrashNote !== undefined && active !== undefined/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/app/save-as-and-trash-shortcut.test.ts`
Expected: FAIL — none of the four patterns exist in `bootstrap.ts` yet.

- [ ] **Step 3: Add the `onSaveNoteAs` hook to `WorkspaceOptions`**

In `src/app/ui/window-chrome.ts`, modify the interface (lines 187–188):

```ts
  readonly onDuplicateNote?: (id: string) => Promise<void>
  readonly onExportNote?: (id: string) => Promise<void>
  readonly onSaveNoteAs?: (id: string) => Promise<void>
```

- [ ] **Step 4: Wire `runCommand`**

In `src/app/bootstrap.ts`, modify the `runCommand` switch (lines 224–229):

```ts
      case 'save':
        void save()
        return
      case 'saveAs':
        void options.workspace?.onSaveNoteAs?.(options.workspace?.activeNoteId ?? '')
        return
      case 'print':
        options.onPrint?.()
        return
      case 'moveToTrash':
        void options.workspace?.onTrashNote?.(options.workspace?.activeNoteId ?? '')
        return
```

- [ ] **Step 5: Wire `commandState`**

In `src/app/bootstrap.ts`, modify `commandState`, inserting directly after the `togglePinned` block (lines 394–400):

```ts
    if (id === 'togglePinned') {
      const active = options.workspace?.notes.find((note) => note.id === options.workspace?.activeNoteId)
      return {
        enabled: options.workspace?.onTogglePinned !== undefined && active !== undefined,
        checked: active === undefined ? false : chrome.isPinned(active.id),
      }
    }
    if (id === 'saveAs') {
      const active = options.workspace?.notes.find((note) => note.id === options.workspace?.activeNoteId)
      return { enabled: options.workspace?.onSaveNoteAs !== undefined && active !== undefined, checked: false }
    }
    if (id === 'moveToTrash') {
      const active = options.workspace?.notes.find((note) => note.id === options.workspace?.activeNoteId)
      return { enabled: options.workspace?.onTrashNote !== undefined && active !== undefined, checked: false }
    }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/app/save-as-and-trash-shortcut.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 7: Run the TypeScript build to catch any type mismatch**

Run: `npx tsc --noEmit`
Expected: PASS, no errors — confirms `WorkspaceOptions.onSaveNoteAs` and the `bootstrap.ts` usage agree.

- [ ] **Step 8: Commit**

```bash
git add src/app/ui/window-chrome.ts src/app/bootstrap.ts tests/app/save-as-and-trash-shortcut.test.ts
git commit -m "feat: dispatch saveAs and moveToTrash to workspace hooks"
```

---

### Task 4: Platform action — `tauri.ts` `saveNoteAs`

**Files:**
- Modify: `src/app/tauri.ts:534` (new `saveNoteAs` action, after `exportNote`), `:1056-1077` (`CatalogActions`), `:214-235` (`workspaceActions`), `:1079-1117` (`catalogWorkspace`)
- Test: `tests/app/save-as-and-trash-shortcut.test.ts` (extend, from Task 3)

**Interfaces:**
- Consumes: `invoke<{ readonly handle: string } | null>('save_note_as', { handle })` (Task 1). `DRAFT_NOTE_ID`, `activeHandle`, `flush()`, `activeCollectionId`, `catalogPort.listFolder(id)`, `TauriFilePort`, `install(port, opened, collectionId)` — all already defined in `tauri.ts`, same shape `duplicateNote`/`exportNote` already use.
- Produces: `saveNoteAs: (handle: string) => Promise<void>` on `CatalogActions`, wired to `WorkspaceOptions.onSaveNoteAs` (Task 3) via `catalogWorkspace`.

- [ ] **Step 1: Extend the source-guard test**

Append to `tests/app/save-as-and-trash-shortcut.test.ts` (reusing the `shellFunction` helper style from `tests/app/native-new-note.test.ts`):

```ts
const TAURI = readFileSync('src/app/tauri.ts', 'utf8')

/** The body of a top-level `const <name> = ...` arrow in the shell's closure. */
function shellFunction(name: string): string {
  const start = TAURI.indexOf(`  const ${name} = `)
  expect(start, `${name} should exist in src/app/tauri.ts`).toBeGreaterThan(-1)
  const end = TAURI.indexOf('\n  }\n', start)
  expect(end, `${name} should be a two-space-indented closure member`).toBeGreaterThan(start)
  return TAURI.slice(start, end)
}

describe('saveNoteAs in the native shell', () => {
  const saveNoteAs = shellFunction('saveNoteAs')

  it('declines to save-as the unsaved draft, which has no file to copy', () => {
    expect(saveNoteAs).toContain('DRAFT_NOTE_ID')
  })

  it('flushes pending edits before asking the backend to copy the file', () => {
    expect(saveNoteAs.indexOf('flush()')).toBeGreaterThan(-1)
    expect(saveNoteAs.indexOf('flush()')).toBeLessThan(saveNoteAs.indexOf("invoke<"))
  })

  it('calls the save_note_as command', () => {
    expect(saveNoteAs).toContain("invoke<{ readonly handle: string } | null>('save_note_as', { handle })")
  })

  it('does nothing when the save dialog is cancelled', () => {
    expect(saveNoteAs).toMatch(/if \(saved === null\) return/)
  })

  it('installs the saved copy as the active document, like Save As switches you to it', () => {
    expect(saveNoteAs).toContain('install(port, opened, activeCollectionId)')
  })

  it('is reachable from the command registry through the shared workspace actions', () => {
    expect(shellFunction('workspaceActions')).toContain('saveNoteAs,')
    expect(shellFunction('catalogWorkspace')).toContain('onSaveNoteAs: actions.saveNoteAs,')
  })
})
```

Note: `shellFunction('catalogWorkspace')` needs `catalogWorkspace` to match the `const <name> = ` shape the helper expects — it's actually declared as `function catalogWorkspace(...)`, not `const catalogWorkspace = `. Adjust that one assertion to a direct substring check on `TAURI` instead:

```ts
  it('is reachable from the command registry through the shared workspace actions', () => {
    expect(shellFunction('workspaceActions')).toContain('saveNoteAs,')
    expect(TAURI).toContain('onSaveNoteAs: actions.saveNoteAs,')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/app/save-as-and-trash-shortcut.test.ts`
Expected: FAIL — `saveNoteAs` does not exist in `tauri.ts` yet.

- [ ] **Step 3: Implement `saveNoteAs`**

In `src/app/tauri.ts`, insert directly after `exportNote` (which ends at line 534):

```ts
  const saveNoteAs = (handle: string): Promise<void> => enqueue(async () => {
    if (handle === DRAFT_NOTE_ID) return
    if (handle === activeHandle && !(await flush())) return
    const saved = await invoke<{ readonly handle: string } | null>('save_note_as', { handle })
    if (saved === null) return
    if (activeCollectionId !== 'recent') {
      collections.addFolder(await catalogPort.listFolder(activeCollectionId))
    }
    const port = new TauriFilePort(invoke)
    const opened = await port.openAt(saved.handle)
    await install(port, opened, activeCollectionId)
  })
```

- [ ] **Step 4: Add it to `CatalogActions`**

In `src/app/tauri.ts`, modify the `CatalogActions` interface (lines 1064–1067):

```ts
  readonly duplicateNote: (id: string) => Promise<void>
  readonly exportNote: (id: string) => Promise<void>
  readonly saveNoteAs: (id: string) => Promise<void>
  readonly closeNote: (id: string) => Promise<void>
```

- [ ] **Step 5: Wire it into `workspaceActions`**

In `src/app/tauri.ts`, modify `workspaceActions` (lines 222–225):

```ts
    duplicateNote,
    exportNote,
    saveNoteAs,
    closeNote,
```

- [ ] **Step 6: Wire it into `catalogWorkspace`**

In `src/app/tauri.ts`, modify `catalogWorkspace` (lines 1105–1108):

```ts
    onDuplicateNote: actions.duplicateNote,
    onExportNote: actions.exportNote,
    onSaveNoteAs: actions.saveNoteAs,
    onCloseNote: actions.closeNote,
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/app/save-as-and-trash-shortcut.test.ts`
Expected: PASS, all tests from Task 3 and Task 4.

- [ ] **Step 8: Run the TypeScript build and the full Vitest suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — no type errors, no regressions elsewhere (in particular `tests/application/commands.test.ts` and the two `tests/app/native-*.test.ts` files, which read the same source files this task edits).

- [ ] **Step 9: Commit**

```bash
git add src/app/tauri.ts tests/app/save-as-and-trash-shortcut.test.ts
git commit -m "feat: implement saveNoteAs and wire it to the native shell's workspace"
```

---

### Task 5: Verify in the packaged app

Native-menu accelerators are resolved by macOS against the real application menu — they do not exist as DOM keydown handlers, so neither Playwright nor the dev browser preview can trigger `Cmd+Shift+S` or `Cmd+Delete` the way a person actually would (confirmed during design: `bootstrap.ts`'s `runCommand`/`commandState` are reachable from Playwright only through DOM controls, and neither new command has one — both are File-menu-only by design). This mirrors the constraint already documented in this repo for CSP-sensitive features: some things are provable only by running the real, packaged app.

**Files:** none — this task builds and drives the actual app.

- [ ] **Step 1: Make sure no other SimpleMark instance holds the single-instance lock**

The dev build exits silently with no window if the installed app is already running. Quit any running SimpleMark instance (menu bar or Activity Monitor) before continuing.

- [ ] **Step 2: Run the dev build**

```bash
npm run dev:native
```

- [ ] **Step 3: Verify Save As**

Open any existing note. Press `Cmd+Shift+S`. Expected: a native save dialog opens, pre-filled with the note's current name, filtered to Markdown. Pick a different name/location and save. Expected: the editor now shows the new file (title bar / window reflects the new name), the original file is untouched on disk, and — if the destination is inside the currently open folder — the new note appears in the sidebar.

- [ ] **Step 4: Verify Save As is disabled with nothing open**

Get to a state with no note open (e.g. an empty workspace, or check the File menu before opening anything). Expected: `Save As…` is greyed out.

- [ ] **Step 5: Verify Move to Trash**

Open a note. Press `Cmd+Delete`. Expected: the note disappears from the sidebar, the editor advances to the next note in the same collection (or the welcome screen if it was the only one), and the file is now in the macOS Trash (verify in Finder).

- [ ] **Step 6: Verify Move to Trash is disabled with nothing open**

Same check as Step 4, for `Move to Trash`.

- [ ] **Step 7: Report results**

No commit for this task — it's verification only. If any step fails, return to the relevant earlier task and fix it before considering this plan complete.
