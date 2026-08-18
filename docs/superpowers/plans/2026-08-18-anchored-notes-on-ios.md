# Anchored Notes on iOS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make anchored notes usable on the iPhone: a touch route to Add Note, a store that never fails because iOS will not let us write beside the file, a phone layout, and notes that refresh when another device adds one.

**Architecture:** One new Rust command (`host_platform`) gives the shared TypeScript shell a third `chromeMode`, `'ios'`, and `window-chrome.ts` stops treating "macOS" as the only native mode. The styles bar (the keyboard accessory on phones) grows an **Add Note** control that calls the same `capture()` as ⌘⇧M. In Rust, `notes.rs` resolves the threads location per intent (read: sidecar-if-present; write: sidecar-if-writable else app-data), all four notes commands go async through `off_the_ui_thread`, and the mobile poll also hashes the threads file so the shell can `notes.reload()`.

**Tech Stack:** TypeScript (Vite, Milkdown), Rust (Tauri 2), Vitest, Playwright, cargo test. Spec: `docs/superpowers/specs/2026-08-18-anchored-notes-on-ios-design.md`.

## Global Constraints

- Work in the worktree `/private/tmp/simplemark-ios-notes` on branch `feat/notes-ios` (never the Dropbox root checkout).
- Notes never take the document down: every new await in the shell is guarded and degrades to a status message (PR #220 rule).
- Fallback to app-data happens **only** on `PermissionDenied` / `ReadOnlyFilesystem`; every other IO error still surfaces.
- Missing `host_platform` (old binary) → behave as `'macos'`.
- Front-matter `comments:` keeps pointing at `.simplemark/<id>.json` even when this device stores threads in app data.
- Playwright: always pass a private port, e.g. `SIMPLEMARK_TEST_PORT=5413`, so a shared default port never serves another checkout.
- Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml --lib notes::` (set `CARGO_TARGET_DIR` to an existing target dir to avoid a cold build, e.g. `/private/tmp/simplemark-paint-first/src-tauri/target`).
- Commit after every task with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

---

## File map

| File | Responsibility in this plan |
|---|---|
| `src-tauri/src/lib.rs` | `host_platform` command; register it; mobile `watch_note` also hashes the threads file and emits `note-threads-changed-externally` |
| `src-tauri/src/notes.rs` | `ThreadsLocation`, `resolve_threads_location`, writability probe + fallback; async commands; `threads_file_for_document`; ledger recording on write |
| `src/app/tauri.ts` | read `host_platform` in `start()`; pass `chromeMode`; listen for `note-threads-changed-externally` → `notes.reload()` |
| `src/app/bootstrap.ts` | `chromeMode` type widened; `hasSelection` in selection shape; `notes.reload()` |
| `src/app/ui/window-chrome.ts` | `chromeMode` type widened; `hasNativeTitlebar` / `hasNativeContextMenu`; styles-bar **Add Note** button + overflow item; iOS default styles-bar visibility |
| `src/adapters/editor/note-capture.ts` | `data-placement="keyboard"` on the composer when `.keyboard-open` |
| `src/app/styles/app.css` | phone layout for rail / stack / composer, 44 pt actions, `.styles-note` |
| `tests/app/notes-ios-shell.test.ts` | source guards: platform signal, chrome split, reload listener |
| `tests/ui/notes-styles-bar.spec.ts` | desktop: Add Note button behaviour |
| `tests/ui/notes-phone.spec.ts` | 390×844: capture → rail → resolve; composer above keyboard inset; reload |
| `docs/decisions/0011-comments-travel-beside-the-document.md` | iOS scope amendment |
| `docs/superpowers/plans/2026-08-11-ios-touch-targets.md` | add note selectors to the sweep list |

---

### Task 1: Platform signal — `host_platform` and `chromeMode: 'ios'`

**Files:**
- Modify: `src-tauri/src/lib.rs` (near `native_capabilities`, ~line 154; `generate_handler` ~line 2270)
- Modify: `src/app/tauri.ts:91` (`start()`), `:1238` (`chromeMode: 'macos'`)
- Modify: `src/app/bootstrap.ts:230` (`chromeMode?: 'web' | 'macos'`)
- Modify: `src/app/ui/window-chrome.ts:73` (`chromeMode`), `:1087` (`isMacOS`) and its uses at `:1103, :1533, :1535, :1558, :1685, :2016, :2033, :2921, :3046, :3054, :3062`
- Test: `tests/app/notes-ios-shell.test.ts` (create)

**Interfaces:**
- Produces: Rust `fn host_platform() -> &'static str` returning `"macos" | "ios" | "other"`; TS type `ChromeMode = 'web' | 'macos' | 'ios'` exported from `src/app/ui/window-chrome.ts`; module-level `let hostChromeMode: 'macos' | 'ios' = 'macos'` in `tauri.ts`; in `window-chrome.ts` two consts `hasNativeTitlebar` (`chromeMode !== 'web'` — iOS keeps the macOS titlebar/sidebar composition) and `hasNativeContextMenu` (`=== 'macos'`).

- [ ] **Step 1: Write the failing source-guard tests**

Create `tests/app/notes-ios-shell.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Anchored notes on iOS (spec 2026-08-18). `bootstrap.ts` and `tauri.ts`
 * compose a real editor, so these are source guards, per
 * tests/app/native-new-note.test.ts.
 */
const TAURI = readFileSync('src/app/tauri.ts', 'utf8')
const CHROME = readFileSync('src/app/ui/window-chrome.ts', 'utf8')
const RUST = readFileSync('src-tauri/src/lib.rs', 'utf8')

describe('the platform signal', () => {
  it('is a Rust command that answers from cfg!, not a user-agent guess', () => {
    expect(RUST).toMatch(/fn host_platform\(\) -> &'static str/)
    expect(RUST).toMatch(/cfg!\(target_os = "ios"\)/)
    expect(RUST).toMatch(/host_platform,/)
  })

  it('is read once in start() and defaults to macos when the binary predates it', () => {
    const start = TAURI.slice(TAURI.indexOf('export async function start('), TAURI.indexOf('async function startNative('))
    expect(start).toMatch(/invoke<string>\('host_platform'\)/)
    expect(start).toMatch(/hostChromeMode = platform === 'ios' \? 'ios' : 'macos'/)
    expect(start).toMatch(/catch[\s\S]*hostChromeMode = 'macos'/)
    expect(TAURI).toMatch(/chromeMode: hostChromeMode,/)
    expect(TAURI).not.toMatch(/chromeMode: 'macos',/)
  })
})

describe('the chrome split', () => {
  it('names two capabilities instead of one platform', () => {
    expect(CHROME).toMatch(/const hasNativeTitlebar = options\.chromeMode !== 'web'/)
    expect(CHROME).toMatch(/const hasNativeContextMenu = options\.chromeMode === 'macos'/)
    expect(CHROME).not.toMatch(/const isMacOS = /)
  })

  it('offers the in-webview selection menu wherever there is no native one', () => {
    const contextmenu = CHROME.slice(CHROME.indexOf("page.addEventListener('contextmenu'"))
    expect(contextmenu.slice(0, 400)).toMatch(/if \(hasNativeContextMenu && options\.onNativeContextMenu !== undefined\)/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /private/tmp/simplemark-ios-notes && npx vitest run tests/app/notes-ios-shell.test.ts`
Expected: FAIL (no `host_platform`, `isMacOS` still present).

- [ ] **Step 3: Rust command**

In `src-tauri/src/lib.rs`, directly after `fn native_capabilities()`:

```rust
/// Which shell this binary is: the TypeScript chrome adapts to it once, at start.
///
/// Answered from `cfg!` rather than a user-agent string, because an iPad
/// asking for desktop-class pages reports itself as a Mac.
#[tauri::command]
fn host_platform() -> &'static str {
    if cfg!(target_os = "ios") {
        "ios"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "other"
    }
}
```

Register it in `generate_handler![ ... ]` next to `build_provenance,` as `host_platform,`.

- [ ] **Step 4: TypeScript types and the split**

`src/app/ui/window-chrome.ts`:
- Line 73: `readonly chromeMode: ChromeMode` and add above the interface: `export type ChromeMode = 'web' | 'macos' | 'ios'`.
- Line 1087: replace `const isMacOS = options.chromeMode === 'macos'` with

```ts
  // Two capabilities, not one platform. iOS shares the macOS titlebar-less
  // arrangement below but has no AppKit context menu, so it keeps the
  // in-webview selection menu that carries Add Note.
  const hasNativeTitlebar = options.chromeMode !== 'web'
  const hasNativeContextMenu = options.chromeMode === 'macos'
```

- Every remaining `isMacOS` use: at `:3046, :3054, :3062` (the three context-menu listeners) use `hasNativeContextMenu`; everywhere else (`:1103, :1533, :1535, :1558, :1685, :2016, :2033, :2921`) use `hasNativeTitlebar`.

`src/app/bootstrap.ts:230`: `readonly chromeMode?: ChromeMode` (import the type from `./ui/window-chrome.js`).

`src/app/tauri.ts`:
- Import `ChromeMode` from `./ui/window-chrome.js`.
- Add at module scope above `start()`: `let hostChromeMode: 'macos' | 'ios' = 'macos'`.
- At the top of `start()`, before `getCurrentWindow()`:

```ts
  try {
    const platform = await invoke<string>('host_platform')
    hostChromeMode = platform === 'ios' ? 'ios' : 'macos'
  } catch {
    // A binary built before this command is a desktop binary.
    hostChromeMode = 'macos'
  }
```

- Line 1238: `chromeMode: hostChromeMode,`.

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/app/notes-ios-shell.test.ts && npx tsc --noEmit && npm run check:boundaries`
Expected: PASS, clean.
Run: `CARGO_TARGET_DIR=/private/tmp/simplemark-paint-first/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib macos_context_menu 2>&1 | tail -3` — compiles.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(shell): host_platform and a third chrome mode for iOS

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Add Note in the styles bar

**Files:**
- Modify: `src/app/ui/window-chrome.ts` — `createStylesBar` (~`:590`–`:880`), `WindowChromeOptions.getSelectionShape` (`:126`), the styles-bar reveal default near `:1568`–`:1575`
- Modify: `src/app/bootstrap.ts:799` (`getSelectionShape`), `:1074` (`onEditorSelectionSettled`)
- Modify: `src/app/styles/app.css` (near the `.styles-control` rules)
- Test: `tests/ui/notes-styles-bar.spec.ts` (create)

**Interfaces:**
- Consumes: `options.onAddNote?: () => void` (exists, `window-chrome.ts:121`), `hasNativeContextMenu` from Task 1.
- Produces: `getSelectionShape()` returns `{ inTable, inCode, hasSelection: boolean }`; the bar element exposes `stylesBar.dispatchEvent(new Event('simplemark-selection-changed'))` to repaint the Add Note enabled state; DOM: `button.styles-control.styles-note[aria-label="Add Note"]` and an overflow item with text `Add Note`.

- [ ] **Step 1: Write the failing Playwright spec**

Create `tests/ui/notes-styles-bar.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

/**
 * Add Note has a button on the styles bar, the one command surface a phone
 * keyboard offers. It is enabled only with a selection and opens the same
 * composer as ⌘⇧M.
 */
const QUOTE = 'This document is the demo.'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([]))
})

test('the styles bar offers Add Note, disabled until something is selected', async ({ page }) => {
  const button = page.locator('.styles-bar .styles-note')
  await expect(button).toHaveCount(1)
  await expect(button).toHaveAttribute('aria-label', 'Add Note')
  await page.locator('.milkdown .ProseMirror').click()
  await page.keyboard.press('End')
  await expect(button).toBeDisabled()
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), QUOTE)
  await expect(button).toBeEnabled()
})

test('tapping Add Note opens the composer on the selection and saves a note', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), QUOTE)
  await page.locator('.styles-bar .styles-note').click()
  await expect(page.locator('.sm-note-composer textarea')).toBeFocused()
  await page.keyboard.type('from the styles bar')
  await page.keyboard.press('Enter')
  await expect(page.locator('.sm-note-anchor')).toHaveCount(1)
  await expect(page.locator('.sm-note-rail')).toContainText('from the styles bar')
})

test('the More menu carries Add Note too', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), QUOTE)
  await page.locator('.styles-bar .styles-more').click()
  await expect(page.locator('.styles-bar .styles-overflow-menu-item', { hasText: 'Add Note' })).toBeVisible()
})
```

(If the More trigger's class differs from `.styles-more`, read `createStylesBar` for the actual trigger — it is the `menu('More', …)` group's `.styles-menu-trigger[aria-label="More"]` — and use `.styles-menu-trigger[aria-label="More"]`.)

- [ ] **Step 2: Run to verify it fails**

Run: `SIMPLEMARK_TEST_PORT=5413 npx playwright test tests/ui/notes-styles-bar.spec.ts`
Expected: FAIL (`.styles-note` count 0).

- [ ] **Step 3: Selection shape carries `hasSelection`**

`src/app/ui/window-chrome.ts:126`:

```ts
  readonly getSelectionShape?: () => {
    readonly inTable: boolean
    readonly inCode: boolean
    readonly hasSelection: boolean
  }
```

`src/app/bootstrap.ts:799`:

```ts
    getSelectionShape: () => {
      const markdown = editor?.selectionMarkdown() ?? ''
      return {
        inTable: markdownTableToCsv(markdown) !== null,
        inCode: codeFenceContent(markdown) !== null,
        hasSelection: editor?.selectionRange() !== undefined,
      }
    },
```

Fix the one place that spreads the shape (`window-chrome.ts:2980` default): `?? { inTable: false, inCode: false, hasSelection: false }`. Any other literal of that shape (search `inCode: false`) gets `hasSelection: false`.

- [ ] **Step 4: The button and the overflow item**

Inside `createStylesBar`, after the `asset` button block and before `bar.append(`:

```ts
  // Add Note. On a phone the styles bar is the keyboard accessory, and this is
  // the only touch route to the composer; on the desktop it is a third route
  // beside ⌘⇧M and the context menu. Absent when notes are not wired.
  const noteGlyph = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v10H9l-5 4z"/><path d="M12 8v4M10 10h4"/></svg>'
  const addNote = document.createElement('button')
  addNote.type = 'button'
  addNote.className = 'styles-control styles-note'
  addNote.innerHTML = noteGlyph
  addNote.setAttribute('aria-label', 'Add Note')
  addNote.title = 'Add Note — select the passage first'
  addNote.disabled = true
  addNote.addEventListener('mousedown', (event) => event.preventDefault())
  addNote.addEventListener('click', () => {
    closePanels()
    options.onAddNote?.()
  })
  const paintAddNote = (): void => {
    const shape = options.getSelectionShape?.() ?? { inTable: false, inCode: false, hasSelection: false }
    addNote.disabled = !shape.hasSelection
    addNote.title = shape.hasSelection ? 'Add Note' : 'Add Note — select the passage first'
  }
  bar.addEventListener('simplemark-selection-changed', paintAddNote)
```

Add `...(options.onAddNote === undefined ? [] : [addNote]),` to `bar.append(` right after the `Tables` command. In the More panel (`panel.append(command('Todo', …), … command('Tables', …))`) add after Tables:

```ts
    if (options.onAddNote !== undefined) {
      const overflowNote = document.createElement('button')
      overflowNote.type = 'button'
      overflowNote.className = 'styles-control styles-overflow-menu-item'
      overflowNote.textContent = 'Add Note'
      overflowNote.addEventListener('mousedown', (event) => event.preventDefault())
      overflowNote.addEventListener('click', () => {
        closePanels()
        options.onAddNote?.()
      })
      panel.append(overflowNote)
    }
```

Repaint on selection: in `createWindowChrome`, where the editor host's `mouseup`/`keyup`/`selectionchange` are observed for the native context (search `updateNativeContext(event.target)` near `:3046`), add once after `stylesBar` is created:

```ts
  document.addEventListener('selectionchange', () => {
    stylesBar.dispatchEvent(new Event('simplemark-selection-changed'))
  })
```

Also dispatch it from `bootstrap.ts` `onEditorSelectionSettled` is unnecessary — `selectionchange` fires for ProseMirror selections. If Playwright shows the button not enabling after `selectTextForTest`, dispatch `chrome.stylesBarSelectionChanged()` there: add `stylesBarSelectionChanged: () => stylesBar.dispatchEvent(new Event('simplemark-selection-changed'))` to the returned `WindowChrome` and call it from `selectTextForTest` and `onEditorSelectionSettled`.

- [ ] **Step 5: Phone default visibility**

Where the styles bar's initial visibility is computed in `bootstrap.ts` (`stylesBarKey`, `:288`), make the default `true` when `options.chromeMode === 'ios'` and no stored value exists:

```ts
  const storedStylesBar = storage.getItem(stylesBarKey)
  const stylesBarVisible = storedStylesBar === null
    ? options.chromeMode === 'ios'
    : storedStylesBar === 'true'
```

(Read the surrounding code first — keep whatever parsing it already does for the stored value; only the *default when unset* changes.)

- [ ] **Step 6: CSS**

`src/app/styles/app.css`, next to `.styles-asset`:

```css
.styles-note svg {
  display: block;
}

.styles-note:disabled {
  opacity: 0.45;
  cursor: default;
}
```

- [ ] **Step 7: Verify**

Run: `SIMPLEMARK_TEST_PORT=5413 npx playwright test tests/ui/notes-styles-bar.spec.ts tests/ui/styles-bar*.spec.ts tests/ui/notes-capture.spec.ts && npx tsc --noEmit && npm run check:boundaries`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(notes): Add Note on the styles bar, the phone's command surface

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Container fallback and async notes commands (Rust)

**Files:**
- Modify: `src-tauri/src/notes.rs` (`sidecar_target` `:118`, `apply_read_note_threads` `:137`, `apply_write_note_threads` `:149`, the four `#[tauri::command]` fns, tests module)
- Modify: `src-tauri/src/lib.rs:631` — make `off_the_ui_thread` `pub(crate)`

**Interfaces:**
- Produces: `pub(crate) enum ThreadsLocation { Sidecar(PathBuf), AppData(PathBuf) }`; `fn resolve_threads_location(note_key: &str, document_handle: Option<&Path>, intent: Intent) -> Result<ThreadsLocation, String>` with `enum Intent { Read, Write }`; `pub(crate) fn threads_file_for_document(document: &Path) -> Result<PathBuf, String>` (used by Task 5); async commands with unchanged names/args.

- [ ] **Step 1: Write the failing Rust tests**

Append to `mod tests` in `notes.rs`:

```rust
    #[cfg(unix)]
    #[test]
    fn a_write_falls_back_to_app_data_when_the_parent_dir_is_not_writable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        fs::write(&path, "---\nid: fallbackabc\n---\n\nbody\n").expect("fixture");
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o500)).expect("chmod");
        let location = resolve_threads_location("fallbackabc", Some(&path), Intent::Write)
            .expect("resolves");
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).expect("restore");
        assert!(matches!(location, ThreadsLocation::AppData(_)), "{location:?}");
        assert!(!dir.path().join(".simplemark").exists());
    }

    #[test]
    fn a_write_uses_the_sidecar_when_the_parent_dir_is_writable() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        fs::write(&path, "body\n").expect("fixture");
        let location = resolve_threads_location("writableabc", Some(&path), Intent::Write)
            .expect("resolves");
        assert_eq!(
            location,
            ThreadsLocation::Sidecar(dir.path().join(".simplemark").join("writableabc.json"))
        );
        assert!(
            !dir.path().join(".simplemark").join(".write-probe").exists(),
            "the probe file must not be left behind"
        );
    }

    #[test]
    fn a_read_prefers_an_existing_sidecar_and_otherwise_app_data() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        fs::write(&path, "body\n").expect("fixture");
        assert!(matches!(
            resolve_threads_location("readabc", Some(&path), Intent::Read).expect("resolves"),
            ThreadsLocation::AppData(_)
        ));
        fs::create_dir_all(dir.path().join(".simplemark")).expect("mkdir");
        fs::write(dir.path().join(".simplemark").join("readabc.json"), "[]").expect("sidecar");
        assert!(matches!(
            resolve_threads_location("readabc", Some(&path), Intent::Read).expect("resolves"),
            ThreadsLocation::Sidecar(_)
        ));
    }

    #[test]
    fn threads_file_for_document_follows_the_front_matter_link() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        fs::write(&path, "---\nid: linked1\ncomments: .simplemark/linked1.json\n---\n\nbody\n")
            .expect("fixture");
        let sidecar = dir.path().join(".simplemark").join("linked1.json");
        // Not present yet: app data.
        assert_ne!(threads_file_for_document(&path).expect("resolves"), sidecar);
        fs::create_dir_all(sidecar.parent().unwrap()).expect("mkdir");
        fs::write(&sidecar, "[]").expect("sidecar");
        assert_eq!(threads_file_for_document(&path).expect("resolves"), sidecar);
    }

    #[test]
    fn threads_file_for_document_uses_the_degraded_key_without_an_id() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        fs::write(&path, "body\n").expect("fixture");
        let file = threads_file_for_document(&path).expect("resolves");
        let name = file.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with("path-"), "{name}");
    }
```

- [ ] **Step 2: Run to verify they fail to compile**

Run: `CARGO_TARGET_DIR=/private/tmp/simplemark-paint-first/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib notes:: 2>&1 | tail -5`
Expected: compile error (`resolve_threads_location` undefined).

- [ ] **Step 3: Implement**

In `notes.rs`, replace `sidecar_target`, `apply_read_note_threads`, `apply_write_note_threads` with:

```rust
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ThreadsLocation {
    Sidecar(PathBuf),
    AppData(PathBuf),
}

impl ThreadsLocation {
    fn path(&self) -> &Path {
        match self {
            ThreadsLocation::Sidecar(path) | ThreadsLocation::AppData(path) => path,
        }
    }
}

#[derive(Clone, Copy)]
enum Intent {
    Read,
    Write,
}

/// Where the sidecar *would* be, when this key and handle allow one at all.
fn sidecar_candidate(note_key: &str, document_handle: Option<&Path>) -> Result<Option<PathBuf>, String> {
    validate_note_key(note_key)?;
    if note_key.starts_with("path-") {
        return Ok(None);
    }
    let Some(document) = document_handle else {
        return Ok(None);
    };
    if !document.is_absolute() {
        return Ok(None);
    }
    let parent = document
        .parent()
        .ok_or_else(|| "path has no parent directory".to_string())?;
    Ok(Some(parent.join(".simplemark").join(format!("{note_key}.json"))))
}

/// Can we create the sidecar directory and a file inside it?
///
/// iOS grants a document opened from Files a scope on the file, not on the
/// folder around it, so the answer there is usually "no" — and that must cost
/// the sidecar, never the note. Only permission answers count as "no"; a full
/// disk is still an error.
fn sidecar_dir_is_writable(sidecar: &Path) -> Result<bool, String> {
    let Some(directory) = sidecar.parent() else {
        return Ok(false);
    };
    let denied = |error: &io::Error| {
        matches!(
            error.kind(),
            io::ErrorKind::PermissionDenied | io::ErrorKind::ReadOnlyFilesystem
        )
    };
    if let Err(error) = fs::create_dir_all(directory) {
        return if denied(&error) { Ok(false) } else { Err(error.to_string()) };
    }
    let probe = directory.join(".write-probe");
    let outcome = fs::OpenOptions::new().create(true).write(true).open(&probe);
    let _ = fs::remove_file(&probe);
    match outcome {
        Ok(_) => Ok(true),
        Err(error) if denied(&error) => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

fn resolve_threads_location(
    note_key: &str,
    document_handle: Option<&Path>,
    intent: Intent,
) -> Result<ThreadsLocation, String> {
    if let Some(sidecar) = sidecar_candidate(note_key, document_handle)? {
        let use_sidecar = match intent {
            Intent::Read => sidecar.exists(),
            Intent::Write => sidecar.exists() || sidecar_dir_is_writable(&sidecar)?,
        };
        if use_sidecar {
            return Ok(ThreadsLocation::Sidecar(sidecar));
        }
    }
    Ok(ThreadsLocation::AppData(threads_file(note_key)?))
}

fn apply_read_note_threads(note_key: &str, document_handle: Option<&Path>) -> Result<String, String> {
    let location = resolve_threads_location(note_key, document_handle, Intent::Read)?;
    read_threads_file(location.path())
}

fn apply_write_note_threads(
    note_key: &str,
    contents: &str,
    document_handle: Option<&Path>,
) -> Result<PathBuf, String> {
    let location = resolve_threads_location(note_key, document_handle, Intent::Write)?;
    write_threads_file(location.path(), contents)?;
    Ok(location.path().to_path_buf())
}

/// The threads file the mobile watcher should hash for this document: the
/// linked sidecar when it exists, else app data for the id (or the degraded key).
pub(crate) fn threads_file_for_document(document: &Path) -> Result<PathBuf, String> {
    let text = fs::read_to_string(document).unwrap_or_default();
    let key = extract_id(&text).unwrap_or_else(|| degraded_key_for_path(document));
    Ok(resolve_threads_location(&key, Some(document), Intent::Read)?.path().to_path_buf())
}

/// Mirrors `noteKeyForPath` in src/adapters/filesystem/tauri-thread-store.ts:
/// hash = (hash * 131 + codepoint) mod 2^64 over the path's chars, hex, 16 wide.
fn degraded_key_for_path(path: &Path) -> String {
    let mut hash: u64 = 0;
    for ch in path.to_string_lossy().chars() {
        hash = hash.wrapping_mul(131).wrapping_add(ch as u64);
    }
    format!("path-{hash:016x}")
}
```

Add a test that pins the hash to the TypeScript one (compute the expected value once with `node -e "…"` from `noteKeyForPath('/tmp/a.md')` and hard-code it):

```rust
    #[test]
    fn degraded_key_matches_the_typescript_note_key_for_path() {
        // node -e "…noteKeyForPath('/tmp/a.md')" → paste the result here.
        assert_eq!(degraded_key_for_path(Path::new("/tmp/a.md")), "path-<value>");
    }
```

Make the four commands async and off the UI thread. `write_note_threads` also records its bytes in the ledger so the watcher ignores our own write:

```rust
#[tauri::command]
pub async fn read_note_threads(
    note_key: String,
    document_handle: Option<String>,
) -> Result<String, String> {
    crate::off_the_ui_thread(move || {
        apply_read_note_threads(&note_key, document_handle.as_deref().map(Path::new))
    })
    .await
}

#[tauri::command]
pub async fn write_note_threads(
    note_key: String,
    contents: String,
    document_handle: Option<String>,
    ledger: State<'_, crate::WriteLedger>,
) -> Result<(), String> {
    let ledger = ledger.inner().clone();
    crate::off_the_ui_thread(move || {
        let written = apply_write_note_threads(&note_key, &contents, document_handle.as_deref().map(Path::new))?;
        ledger.record_bytes(written, contents.as_bytes())
    })
    .await
}

#[tauri::command]
pub async fn read_note_id(document_handle: String) -> Result<Option<String>, String> {
    crate::off_the_ui_thread(move || read_id_at(Path::new(&document_handle))).await
}

#[tauri::command]
pub async fn ensure_note_id(
    document_handle: String,
    ledger: State<'_, crate::WriteLedger>,
) -> Result<EnsureNoteId, String> {
    let ledger = ledger.inner().clone();
    crate::off_the_ui_thread(move || {
        let path = PathBuf::from(&document_handle);
        let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        apply_ensure_note_id(&path, &text, |bytes| ledger.record_bytes(path.clone(), bytes))
    })
    .await
}
```

`WriteLedger` derives `Clone` already (`lib.rs:324`). In `lib.rs:631` change `async fn off_the_ui_thread` to `pub(crate) async fn off_the_ui_thread`. Existing tests that call `read_note_threads("foo/bar".into(), None)` synchronously must now call `apply_read_note_threads("foo/bar", None)` instead — update them.

- [ ] **Step 4: Verify**

Run: `CARGO_TARGET_DIR=/private/tmp/simplemark-paint-first/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib notes:: 2>&1 | tail -4`
Expected: all pass (previous 22 + new).
Run: `npx vitest run tests/adapters/tauri-thread-store.test.ts` — unchanged adapters still pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(notes): fall back to app data when the sidecar folder is not ours to write; notes commands off the UI thread

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Phone layout

**Files:**
- Modify: `src/app/styles/app.css` (after the `.sm-note-*` block ending ~`:4120`)
- Modify: `src/adapters/editor/note-capture.ts:114-118` (composer placement)
- Test: `tests/ui/notes-phone.spec.ts` (create)

**Interfaces:**
- Consumes: `.window.keyboard-open` and `--keyboard-inset` (set by `window-chrome.ts:1577-1620`), `.styles-note` from Task 2.
- Produces: composer attribute `data-placement="keyboard" | "caret"`.

- [ ] **Step 1: Write the failing phone spec**

Create `tests/ui/notes-phone.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

/**
 * On a phone, notes live in bottom sheets above the keyboard and every action
 * is a 44pt target. The composer sits above the keyboard, not under it.
 */
const QUOTE = 'This document is the demo.'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.evaluate(() => window.simplemark!.notes.setThreadsForTest([]))
})

test('capture through the styles bar, see the rail as a bottom sheet, resolve', async ({ page }) => {
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), QUOTE)
  await page.locator('.styles-bar .styles-note').click()
  await page.keyboard.type('phone note')
  await page.keyboard.press('Enter')

  const rail = page.locator('.sm-note-rail')
  await expect(rail).toBeVisible()
  const railBox = await rail.boundingBox()
  expect(railBox!.x).toBeLessThan(2)
  expect(railBox!.x + railBox!.width).toBeGreaterThan(388)
  for (const button of await rail.locator('button').all()) {
    const box = await button.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
  await rail.locator('[data-action="resolve"]').first().click()
  await expect(page.locator('.sm-note-anchor')).toHaveCount(0)
})

test('the composer sits above the keyboard inset when the keyboard is open', async ({ page }) => {
  await page.evaluate(() => {
    const win = document.querySelector<HTMLElement>('.window')!
    win.classList.add('keyboard-open')
    win.style.setProperty('--keyboard-inset', '300px')
  })
  await page.evaluate((quote) => window.simplemark!.notes.selectTextForTest(quote), QUOTE)
  await page.locator('.styles-bar .styles-note').click()
  const composer = page.locator('.sm-note-composer')
  await expect(composer).toHaveAttribute('data-placement', 'keyboard')
  const box = await composer.boundingBox()
  expect(box!.y + box!.height).toBeLessThanOrEqual(844 - 300 + 1)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `SIMPLEMARK_TEST_PORT=5413 npx playwright test tests/ui/notes-phone.spec.ts`
Expected: FAIL (rail is a 280 px card; no `data-placement`).

- [ ] **Step 3: Composer placement attribute**

`note-capture.ts` around line 114, replace the four positioning lines with:

```ts
    const keyboardOpen = host.closest('.window')?.classList.contains('keyboard-open') === true
    panel.dataset['placement'] = keyboardOpen ? 'keyboard' : 'caret'
    if (!keyboardOpen) {
      const coords = view.coordsAtPos(from)
      const hostBox = host.getBoundingClientRect()
      panel.style.top = `${Math.max(8, coords.bottom - hostBox.top + 8)}px`
      panel.style.left = `${Math.max(8, coords.left - hostBox.left)}px`
    }
```

- [ ] **Step 4: CSS**

Append to `app.css` after the `.sm-note-unwritable p` rule:

```css
/* Phone: notes are bottom sheets above the keyboard, and every action is a
   44pt target. The keyboard inset comes from the same visualViewport tracking
   the styles bar uses. */
@media (max-width: 620px) {
  .sm-note-rail,
  .sm-note-stack {
    position: fixed;
    inset: auto 0 var(--keyboard-inset, 0) 0;
    top: auto;
    right: auto;
    width: auto;
    max-height: 40vh;
    border-radius: 14px 14px 0 0;
    border-bottom: 0;
    padding: 12px 14px calc(12px + env(safe-area-inset-bottom));
  }

  .sm-note-rail-actions button,
  .sm-note-stack button {
    min-height: 44px;
    padding: 10px 14px;
    font-size: 14px;
  }

  .sm-note-composer[data-placement="keyboard"],
  .sm-note-unwritable {
    position: fixed;
    left: 8px;
    right: 8px;
    top: auto;
    bottom: calc(var(--keyboard-inset, 0px) + 8px);
    width: auto;
  }
}
```

If `.sm-note-stack` positions via inline `top/left` from `renderNoteStack`, the `!important`-free way is to add `top: auto !important; left: auto !important;` inside the media block for `.sm-note-stack` only — inline styles beat the sheet otherwise. Do that only if the rail test passes and a stack test shows it misplaced.

- [ ] **Step 5: Verify**

Run: `SIMPLEMARK_TEST_PORT=5413 npx playwright test tests/ui/notes-phone.spec.ts tests/ui/notes-rail.spec.ts tests/ui/notes-capture.spec.ts tests/ui/notes-lifecycle.spec.ts`
Expected: pass (desktop specs unchanged).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(notes): phone layout — sheets above the keyboard, 44pt actions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Freshness — watch the threads file, `notes.reload()`

**Files:**
- Modify: `src-tauri/src/lib.rs` mobile `watch_note` (`:1991`–`:2058`)
- Modify: `src/app/bootstrap.ts` (`AppComposition['notes']` at `:103`; the `notes` object at `~:1024`)
- Modify: `src/app/tauri.ts` `watch()` (`:329`–`:340`)
- Test: `tests/app/notes-ios-shell.test.ts` (extend), `tests/ui/notes-phone.spec.ts` (extend)

**Interfaces:**
- Consumes: `notes::threads_file_for_document(&Path) -> Result<PathBuf, String>` (Task 3), `WriteLedger`.
- Produces: event `note-threads-changed-externally` (payload: document handle string); `AppComposition.notes.reload(): Promise<void>`.

- [ ] **Step 1: Failing tests**

Append to `tests/app/notes-ios-shell.test.ts`:

```ts
describe('freshness', () => {
  it('the mobile watcher hashes the threads file and names its own event', () => {
    const mobileWatch = RUST.slice(RUST.indexOf('#[cfg(mobile)]\n#[tauri::command]\nfn watch_note('))
    expect(mobileWatch.slice(0, 4000)).toMatch(/notes::threads_file_for_document/)
    expect(mobileWatch.slice(0, 4000)).toMatch(/"note-threads-changed-externally"/)
  })

  it('the shell reloads notes on that event, guarded', () => {
    expect(TAURI).toMatch(/listen<string>\('note-threads-changed-externally'/)
    expect(TAURI).toMatch(/notes\.reload\(\)/)
  })
})
```

Append to `tests/ui/notes-phone.spec.ts`:

```ts
test('notes.reload() picks up a thread written behind the composition', async ({ page }) => {
  await page.evaluate((quote) => {
    // The browser shell stores threads in localStorage under the document key.
    const key = Object.keys(localStorage).find((k) => k.startsWith('simplemark.threads.'))
    const noteKey = key === undefined ? 'fixture:welcome-to-simplemark' : key.slice('simplemark.threads.'.length)
    localStorage.setItem(`simplemark.threads.${noteKey}`, JSON.stringify([
      { id: 'external', noteKey, author: 'phone', createdAt: '', body: 'from another device',
        anchor: { quote, prefix: '', suffix: '', blockIndex: 0 }, state: 'open' },
    ]))
  }, QUOTE)
  await page.evaluate(() => window.simplemark!.notes.reload())
  await expect(page.locator('.sm-note-rail')).toContainText('from another device')
})
```

(Read `src/adapters/filesystem/local-thread-store.ts` for the exact `STORAGE_PREFIX` and the browser document handle; adjust the two strings so the test seeds the key the composition actually lists.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/app/notes-ios-shell.test.ts && SIMPLEMARK_TEST_PORT=5413 npx playwright test tests/ui/notes-phone.spec.ts -g reload`
Expected: FAIL.

- [ ] **Step 3: `notes.reload()` in bootstrap**

`AppComposition['notes']` (`bootstrap.ts:103`): add

```ts
    /** Re-lists threads from the store (another device wrote them) and repaints. */
    reload(): Promise<void>
```

In the `notes` object:

```ts
    reload: async () => {
      try {
        noteThreads = await persist.list(await noteKeyForOpenDocument())
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        chrome.setStatus('error', `Notes for this document could not be read — ${message}`)
        return
      }
      closeNoteStack()
      paintNotes()
    },
```

- [ ] **Step 4: Rust watcher**

In the mobile `watch_note` thread body, alongside `seen`:

```rust
        let threads_path = notes::threads_file_for_document(&path).ok();
        let mut seen_threads = threads_path
            .as_ref()
            .and_then(|threads| fs::read(threads).ok())
            .map(|bytes| content_hash(&bytes));
```

Inside the loop, after the `.md` handling (before the closing brace of the loop), add — and note the `.md` branch `continue`s early, so restructure so the threads check runs every tick:

```rust
            if let Some(threads) = threads_path.as_ref() {
                let current_threads = fs::read(threads).ok().map(|bytes| content_hash(&bytes));
                if current_threads != seen_threads {
                    seen_threads = current_threads;
                    let ours = current_threads
                        .and_then(|hash| {
                            ledger.0.lock().ok().map(|ledger| ledger.get(threads).copied() == Some(hash))
                        })
                        .unwrap_or(false);
                    if !ours {
                        let _ = app.emit("note-threads-changed-externally", handle.clone());
                    }
                }
            }
```

Restructure the existing `.md` block from `continue`s into `if`-guards so this runs each tick. Because `write_note_threads` now records into the ledger keyed by the file it wrote (Task 3), our own saves stay silent. Note: `threads_path` is resolved once at watch start; a note that gains a sidecar later is picked up on the next open (acceptable for v1, say so in a comment).

- [ ] **Step 5: Shell listener**

`tauri.ts` `watch()`: after the `note-changed-externally` listener, register a second one and stop both:

```ts
    const stopThreads = await listen<string>('note-threads-changed-externally', (event) => {
      if (event.payload !== handle) return
      void current.notes.reload()
    })
    const stopChanged = stopWatching
    stopWatching = () => {
      stopChanged?.()
      stopThreads()
    }
```

(Assign the first `listen` to a local, then compose; keep `stopWatching`'s type as `(() => void) | undefined`.)

- [ ] **Step 6: Verify**

Run: `npx vitest run tests/app && SIMPLEMARK_TEST_PORT=5413 npx playwright test tests/ui/notes-phone.spec.ts && npx tsc --noEmit && CARGO_TARGET_DIR=/private/tmp/simplemark-paint-first/src-tauri/target cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -2`
Expected: pass. Also: `cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-ios 2>&1 | tail -2` (mobile cfg compiles; needs the target installed — `rustup target add aarch64-apple-ios` if not).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(notes): refresh threads when another device writes them

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Docs — ADR-0011 amendment and touch-target sweep

**Files:**
- Modify: `docs/decisions/0011-comments-travel-beside-the-document.md`
- Modify: `docs/superpowers/plans/2026-08-11-ios-touch-targets.md` (the sweep selector list)
- Modify: `docs/decisions/INDEX.md` only if it lists status lines that need the amendment date

- [ ] **Step 1: Amend ADR-0011**

Append a section:

```markdown
## Amendment 2026-08-18 — iOS

Anchored notes ship on iOS as the same feature (spec
`docs/superpowers/specs/2026-08-18-anchored-notes-on-ios-design.md`):

- **Trigger.** Add Note is on the styles bar (the keyboard accessory) and in
  the in-webview selection menu; ⌘⇧M works with a hardware keyboard.
- **Where comments live.** "Beside the document" is the intent and the
  front-matter `comments:` link always names `.simplemark/<id>.json`. When this
  device cannot write that folder — iOS grants a Files-opened document a scope
  on the file, not its folder — threads are stored in application data for
  this device and the note is *degraded* in exactly ADR-0007's sense. Reads
  prefer a sidecar that exists. Only permission answers trigger the fallback.
- **Freshness.** The mobile watcher hashes the threads file as well as the
  `.md`; a change that is not ours repaints the rail.
- **Not yet.** Directory-scope acquisition and `NSFileCoordinator` writes; the
  desktop watcher does not yet watch the sidecar.
```

- [ ] **Step 2: Touch-target sweep**

In `2026-08-11-ios-touch-targets.md`, find the selector list the sweep test iterates and add `.sm-note-rail-actions button`, `.sm-note-stack button`, `.styles-note`, with a one-line note pointing at this plan.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs(notes): ADR-0011 iOS amendment; note controls join the touch-target sweep

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Whole-branch verification and PR

- [ ] **Step 1: Full checks**

```bash
npx tsc --noEmit && npm run check:boundaries
npx vitest run
SIMPLEMARK_TEST_PORT=5413 npx playwright test tests/ui/notes-*.spec.ts tests/ui/selection-context-menu.spec.ts tests/ui/styles-bar*.spec.ts
CARGO_TARGET_DIR=/private/tmp/simplemark-paint-first/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib
```

- [ ] **Step 2: Desktop is unchanged**

Build a release bundle from the branch (`SIMPLEMARK_BUILD_SHA=ios-notes CARGO_TARGET_DIR=/private/tmp/simplemark-paint-first/src-tauri/target npm run build:native`), open it, confirm: notes open, right-click Add Note still present, styles bar shows Add Note enabled on selection.

- [ ] **Step 3: iOS simulator smoke (record honestly)**

If an iOS simulator build is available (`npm run tauri ios build` / Xcode project under `src-tauri/gen/apple`), install to a booted iPhone simulator, open the welcome/container note, select text, tap Add Note on the keyboard accessory, save, kill and relaunch, note is still there. Record in the PR that Files/iCloud scopes are **not** proven by the simulator (project memory: the simulator cannot prove iOS). If no simulator build is possible in this session, say so in the PR test plan.

- [ ] **Step 4: PR**

`git push -u origin feat/notes-ios`, then `gh pr create` titled `feat(notes): anchored notes on iOS` with a summary of the five pieces and the test plan above; `gh pr merge <N>` to enqueue; poll until MERGED (the queue drops PRs on unrelated flakes — re-enqueue, see memory).

---

## Self-review

- Spec §3 In-scope → Task 1 (platform), 2 (trigger + iOS default visibility), 3 (fallback + async), 4 (layout), 5 (freshness), 6 (docs), 7 (tests/PR, `cargo check --target aarch64-apple-ios`). Touch-target sweep additions → Task 6.
- Names consistent: `hostChromeMode`, `hasNativeTitlebar`/`hasNativeContextMenu`, `hasSelection`, `.styles-note`, `simplemark-selection-changed`, `ThreadsLocation`/`Intent`/`resolve_threads_location`/`threads_file_for_document`, `note-threads-changed-externally`, `notes.reload()`, `data-placement`.
- No TBDs; every code step has code.
