# Responsive cloud note previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every workspace note immediately while extracting cloud-backed previews asynchronously, without ever blocking the native UI thread.

**Architecture:** Native catalog discovery returns names and timestamps only. A new native command reads requested preview bytes in Tauri's blocking pool and emits a typed event for each result. The Tauri shell retains those previews in a transient overlay and patches the existing sidebar row in place; the existing AI-summary overlay remains the final subtitle authority.

**Tech Stack:** Rust 2021, Tauri 2 async runtime and events, TypeScript strict mode, Vitest, Rust unit tests.

## Global Constraints

- Directory listing never opens Markdown content; cloud placeholders are ordinary.
- The new transport carries opaque handles only and makes no cloud-provider inference.
- Preview delivery never sorts, remounts, or filters a visible list.
- An AI summary remains higher priority than an extracted preview.
- No document rule belongs in the Tauri command; this is a transport boundary only.

---

### Task 1: Native metadata catalog and background preview event

**Files:**
- Modify: `src-tauri/src/lib.rs:246-260, 690-782, 1558-1571, 1627-1669`

**Interfaces:**
- Produces: `WorkspacePreview { handle: String, preview: Option<String> }`, serialized in camel case.
- Produces: `request_workspace_previews(app: AppHandle, handles: Vec<String>) -> Result<(), String>`.
- Produces: `workspace-note-preview` events emitted from `tauri::async_runtime::spawn_blocking`.

- [ ] **Step 1: Write the failing Rust tests**

```rust
#[test]
fn catalog_entry_leaves_preview_absent_until_the_background_request() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("note.md");
    fs::write(&path, b"# Title\n\nOpening sentence.\n").unwrap();

    assert_eq!(catalog_entry(&path).unwrap().preview, None);
}

#[test]
fn preview_of_extracts_a_note_preview_for_the_worker() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("note.md");
    fs::write(&path, b"# Title\n\nOpening sentence.\n").unwrap();

    assert_eq!(preview_of(&path), Some("Opening sentence.".to_string()));
}
```

- [ ] **Step 2: Run the new tests to verify the catalogue test fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml catalog_entry_leaves_preview_absent_until_the_background_request -- --exact`

Expected: FAIL because `catalog_entry` still reads the preview.

- [ ] **Step 3: Make catalog discovery metadata-only and add background delivery**

```rust
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePreview {
    handle: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<String>,
}

#[tauri::command]
fn request_workspace_previews(app: AppHandle, handles: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        for handle in handles {
            let preview = preview_of(Path::new(&handle));
            let _ = app.emit("workspace-note-preview", WorkspacePreview { handle, preview });
        }
    });
    Ok(())
}
```

Set `catalog_entry(...).preview` to `None`; retain `preview_of` as the bounded worker-only reader; register the command in `generate_handler!`.

- [ ] **Step 4: Run the focused native tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml 'catalog_entry_leaves_preview_absent_until_the_background_request|preview_of_extracts_a_note_preview_for_the_worker'`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "fix(native): load note previews off the UI thread"
```

### Task 2: Preview overlay and sidebar patching

**Files:**
- Create: `src/app/note-preview-overlay.ts`
- Create: `src/app/note-preview-overlay.test.ts`
- Modify: `src/adapters/filesystem/tauri-workspace-catalog-port.ts:1-55`
- Modify: `src/app/tauri.ts:28, 241-285, 878-980`
- Modify: `src/app/ui/window-chrome.ts:306-311, 1805-1825, 2909-2918`

**Interfaces:**
- Produces: `applyPreviewsToCatalog(catalog, previews): WorkspaceCatalog`.
- Produces: `WindowChrome.applyNotePreview(handle: string, preview: string): void`.
- Consumes: native `workspace-note-preview` event payload `{ handle: string; preview?: string }`.
- Produces: `TauriWorkspaceCatalogPort` catalog methods that request previews only after their metadata response resolves.

- [ ] **Step 1: Write failing overlay tests**

```ts
it('overlays an arrived preview onto its matching catalog entry', () => {
  expect(applyPreviewsToCatalog(catalog, new Map([['a', 'First sentence.']])).notes[0].preview)
    .toBe('First sentence.')
})

it('keeps an AI summary when the catalog is layered afterward', () => {
  const previews = applyPreviewsToCatalog(catalog, new Map([['a', 'Extracted.']]))
  expect(applySummariesToCatalog(previews, new Map([['a', 'AI summary.']])).notes[0].preview)
    .toBe('AI summary.')
})
```

- [ ] **Step 2: Run the overlay test to verify it fails**

Run: `npm test -- note-preview-overlay.test.ts`

Expected: FAIL because the overlay module does not exist.

- [ ] **Step 3: Add the pure overlay and wire event delivery**

```ts
const arrivedPreviews = new Map<string, string>()
const withPreviews = (catalog: WorkspaceCatalog): WorkspaceCatalog =>
  applyPreviewsToCatalog(catalog, arrivedPreviews)

await listen<WorkspacePreview>('workspace-note-preview', ({ payload }) => {
  if (payload.preview === undefined) return
  arrivedPreviews.set(payload.handle, payload.preview)
  current.applyNotePreview(payload.handle, payload.preview)
})
```

Register the listener before any saved folder is restored. Add the adapter helper below and use it from `inspect`, `chooseFolder`, `listAround`, and `listFolder`; it starts background previews only after the metadata response resolves. Compose `withPreviews` before `withSummaries`; add `applyNotePreview` using the same in-place mutation as the existing summary method.

```ts
private requestPreviews(catalog: WorkspaceCatalog): WorkspaceCatalog {
  void this.invoke('request_workspace_previews', {
    handles: catalog.notes.map((note) => note.handle),
  })
  return catalog
}
```

- [ ] **Step 4: Run the focused TypeScript tests**

Run: `npm test -- note-preview-overlay.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/filesystem/tauri-workspace-catalog-port.ts src/app/note-preview-overlay.ts src/app/note-preview-overlay.test.ts src/app/tauri.ts src/app/ui/window-chrome.ts
git commit -m "fix: populate cloud note previews asynchronously"
```

### Task 3: Full verification and native smoke build

**Files:**
- No source changes expected.

- [ ] **Step 1: Run native tests**

Run: `npm run test:native`

Expected: PASS.

- [ ] **Step 2: Run the canonical gate**

Run: `bash scripts/simplemark_ci.sh`

Expected: PASS.

- [ ] **Step 3: Build the macOS bundle**

Run: `npm run build:native`

Expected: PASS and produces `src-tauri/target/release/bundle/macos/SimpleMark.app`.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff origin/main...HEAD --check && git status --short`

Expected: no whitespace errors and no uncommitted changes.
