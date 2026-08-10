# iOS Markdown Document Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SimpleMark a correct iOS Markdown document owner that opens Files/Open In URLs in place, accepts Grammarly plain-text shares as deliberate new drafts, and provides a bounded Quick Look preview.

**Architecture:** Reuse Tauri's existing iOS `RunEvent::Opened` for standard document delivery and extend SimpleMark's durable request queue to consume it on iOS. Add one documented UIKit picker plugin for deliberate Files selection because the stock Tauri dialog plugin copies provider files. Package separate Share and Quick Look extension targets via a deterministic Xcode post-generation step; neither extension becomes a document authority.

**Tech Stack:** Rust 2021/Tauri 2, TypeScript strict/Vitest, Swift/UIKit/QuickLook, Xcode 26.5, iPhone 17 Pro iOS 26.5 simulator.

## Global Constraints

- Existing Markdown files are opened and saved at their original Files-provider URL; never silently copy them into an app-owned directory.
- Markdown registration uses `CFBundleTypeRole=Editor`, `LSHandlerRank=Owner`, `.md`, `.markdown`, and `net.daringfireball.markdown`.
- The system Open In path handles Markdown files. The Share extension handles plain text only and creates a new document only after a user-selected destination.
- All UI-document changes enter through the existing application composition; Rust and Swift transport URLs/bytes only.
- No private APIs, URL-scheme handoff, polling folders, or Tauri process inside an extension.
- Native work must pass `npm run test:native`, `npm run build:native`, and `bash scripts/simplemark_ci.sh` before merge.

---

### Task 1: Deliver iOS Open In URLs through the existing request queue

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/app/tauri.ts`
- Test: `src-tauri/src/lib.rs` unit tests
- Test: `tests/app/native-open-request.test.ts` (create)

**Interfaces:**
- Consumes: `tauri::RunEvent::Opened { urls }`, `OpenRequestQueue`, `take_open_note_request`.
- Produces: queued file URLs on iOS and desktop; TypeScript consumes them before and after the webview mounts.

- [ ] **Step 1: Write failing Rust queue tests**

Add a platform-neutral helper that accepts `&[Url]`, filters `.md`/`.markdown`, and returns paths. Test both `file:///tmp/plan.md` and `file:///tmp/plan.markdown`, rejecting `file:///tmp/plan.txt` and non-file URLs.

```rust
#[test]
fn opened_markdown_paths_accepts_ios_file_urls() {
    let urls = [Url::parse("file:///tmp/plan.md").unwrap()];
    assert_eq!(opened_markdown_paths(&urls), vec![PathBuf::from("/tmp/plan.md")]);
}
```

- [ ] **Step 2: Run the Rust test and verify it fails for the current iOS gate**

Run: `cargo test --manifest-path src-tauri/Cargo.toml opened_markdown_paths_accepts_ios_file_urls`

Expected: the test cannot compile for an iOS-specific expectation because the helper and `RunEvent::Opened` branch are desktop-only.

- [ ] **Step 3: Make URL delivery target-neutral where Tauri supports it**

Replace the desktop-only `RunEvent::Opened` handling with `#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]`, retain `queue_opened_notes`, and use the already-existing `OpenRequestQueue`. Do not add a second iOS queue or a file copy.

- [ ] **Step 4: Add a TypeScript startup and runtime-delivery test**

Create `tests/app/native-open-request.test.ts` using an injected `take_open_note_request`/event listener seam. Assert a queued request opens exactly once after mount and an event request opens once after mount; assert cancellation or a `.txt` URL leaves the current document unchanged.

- [ ] **Step 5: Run focused tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml opened_markdown_paths && npx vitest run tests/app/native-open-request.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src/app/tauri.ts tests/app/native-open-request.test.ts
git commit -m "fix: accept iOS open-in Markdown requests"
```

### Task 2: Keep mobile folder actions on the actual SimpleMark iCloud directory

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/lib.rs` unit tests

**Interfaces:**
- Consumes: `icloud_documents() -> Option<PathBuf>`, `default_workspaces`, `open_workspace_folder`.
- Produces: identical iCloud-first path resolution for mobile launch and mobile folder actions.

- [ ] **Step 1: Extract a failing path-resolution test**

Create a small `mobile_workspace_directory(icloud: Option<PathBuf>, fallback: PathBuf) -> PathBuf` helper. Test that both `default_workspaces` and `open_workspace_folder` call it and that an iCloud Documents URL wins over the fallback documents directory.

```rust
#[test]
fn mobile_workspace_prefers_the_public_icloud_documents_directory() {
    assert_eq!(
        mobile_workspace_directory(Some(PathBuf::from("/icloud/Documents")), PathBuf::from("/app/Documents")),
        PathBuf::from("/icloud/Documents"),
    );
}
```

- [ ] **Step 2: Run the test and verify current behaviour fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mobile_workspace_prefers_the_public_icloud_documents_directory`

Expected: FAIL before the shared resolver is called by the mobile folder command.

- [ ] **Step 3: Implement the shared resolver**

Move the iCloud-first/fallback decision into `mobile_workspace_directory`; use it in both mobile commands. Keep `workspace_catalog_for_directory` as the sole listing operation and preserve the visible error when the fallback directory is unavailable.

- [ ] **Step 4: Run focused native tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mobile_workspace`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "fix: align iOS folder actions with iCloud workspace"
```

### Task 3: Add an open-in-place iOS document-picker plugin

**Files:**
- Create: `src-tauri/plugins/ios-document-picker/Package.swift`
- Create: `src-tauri/plugins/ios-document-picker/Sources/DocumentPickerPlugin.swift`
- Create: `src-tauri/plugins/ios-document-picker/Tests/DocumentPickerPluginTests.swift`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/adapters/filesystem/tauri-file-port.ts`
- Test: `tests/adapters/tauri-file-port.test.ts`

**Interfaces:**
- Consumes: `UIDocumentPickerViewController(forOpeningContentTypes:asCopy: false)` and `startAccessingSecurityScopedResource()`.
- Produces: `pick_open_in_place_markdown() -> { handle: string; name: string } | null`; Rust reads/saves the returned original URL under its retained security scope.

- [ ] **Step 1: Write failing port tests**

Add a fake native invoke result with a stable handle and assert `TauriFilePort.open()` calls `pick_open_in_place_markdown`, not `open_note`, when the platform reports iOS document-picker capability.

```ts
expect(calls).toEqual([{ command: 'pick_open_in_place_markdown' }])
expect(opened.handle).toBe('/provider/plan.md')
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run tests/adapters/tauri-file-port.test.ts`

Expected: FAIL because the current port invokes `open_note`.

- [ ] **Step 3: Implement the documented Swift plugin**

Use a `UIDocumentPickerViewController` configured for `UTType(filenameExtension: "md")` and `UTType(filenameExtension: "markdown")`, `asCopy: false`. On a successful selection, begin security-scoped access, serialize a bookmark into an in-memory plugin map keyed by an opaque handle, and return the handle/name. On cancel return `null`; on scope failure return a named error. Do not move, copy, or persist document bytes.

- [ ] **Step 4: Bridge opaque handles in Rust**

Add `read_security_scoped_note(handle)` and `save_security_scoped_note(handle, bytes)` commands that resolve only a live plugin handle. Refuse an unknown, expired, or non-Markdown handle. Leave path-based desktop commands unchanged.

- [ ] **Step 5: Update TypeScript transport and tests**

Select the new command only in the iOS native shell. Maintain the `OpenedDocument` shape and test that save targets the returned opaque handle, not a copied temporary path.

- [ ] **Step 6: Build and test the plugin on the simulator**

Run: `npm run tauri ios build -- --debug && xcodebuild -project src-tauri/gen/apple/simplemark.xcodeproj -scheme simplemark_iOS -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test`

Expected: PASS; picker cancellation preserves the reader and provider selection returns a non-temporary URL.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/plugins/ios-document-picker src-tauri/Cargo.toml src-tauri/src/lib.rs src/adapters/filesystem/tauri-file-port.ts tests/adapters/tauri-file-port.test.ts
git commit -m "feat: open iOS Markdown documents in place"
```

### Task 4: Register Markdown ownership and package the plain-text Share extension

**Files:**
- Create: `src-tauri/apple-extensions/Share/Info.plist`
- Create: `src-tauri/apple-extensions/Share/ShareViewController.swift`
- Create: `src-tauri/apple-extensions/Share/Share.entitlements`
- Create: `src-tauri/apple-extensions/ShareTests/ShareViewControllerTests.swift`
- Modify: `src-tauri/Info.ios.plist`
- Modify: `src-tauri/gen/apple/project.yml`
- Create: `scripts/verify-ios-document-integration.mjs`

**Interfaces:**
- Consumes: `public.plain-text` `NSItemProvider` content.
- Produces: one app-group pending UTF-8 draft record; the main app consumes/deletes it and presents its standard save destination.

- [ ] **Step 1: Write failing registration checks**

Create a Node test script that parses the built app and extension plists. Require main-app `Editor`, `Owner`, Markdown UTI, both extensions, and `LSSupportsOpeningDocumentsInPlace=true`; require Share's `com.apple.share-services` extension point and `public.plain-text` activation rule.

- [ ] **Step 2: Run the verifier before extension packaging**

Run: `node scripts/verify-ios-document-integration.mjs --app /tmp/missing.app`

Expected: FAIL naming the missing app or required plist field.

- [ ] **Step 3: Add target configuration and plain-text handoff**

Use an App Group shared by the app and Share target. The extension writes `{ id, kind: "plain_text", utf8, createdAt }` atomically to the group container and completes only after the write. It never declares Markdown-file activation or claims an original file URL it cannot own. Main-app startup consumes one record, creates an unsaved draft, calls the standard save destination, then deletes the record on success or surfaces an error on failure.

- [ ] **Step 4: Add unit and simulator tests**

Test empty text rejection, exact Unicode preservation, single-consumption deletion, and no document creation before destination selection. Run the plist verifier against the Debug simulator bundle.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/apple-extensions/Share src-tauri/Info.ios.plist src-tauri/gen/apple/project.yml scripts/verify-ios-document-integration.mjs
git commit -m "feat: register SimpleMark Markdown ownership on iOS"
```

### Task 5: Package a read-only Quick Look Markdown preview extension

**Files:**
- Create: `src-tauri/apple-extensions/QuickLook/Info.plist`
- Create: `src-tauri/apple-extensions/QuickLook/PreviewProvider.swift`
- Create: `src-tauri/apple-extensions/QuickLook/MarkdownPreview.swift`
- Create: `src-tauri/apple-extensions/QuickLook/QuickLook.entitlements`
- Create: `src-tauri/apple-extensions/QuickLookTests/MarkdownPreviewTests.swift`
- Modify: `src-tauri/gen/apple/project.yml`
- Modify: `scripts/verify-ios-document-integration.mjs`

**Interfaces:**
- Consumes: a Quick Look-provided Markdown file URL.
- Produces: a self-contained static HTML `QLPreviewReply` with no remote requests or writes.

- [ ] **Step 1: Write failing renderer tests**

Add Swift tests for escaped HTML, headings, paragraphs, lists, code fences, links, blockquotes, and tables. Assert remote image markdown produces a readable link/fallback rather than an external request.

```swift
XCTAssertTrue(renderMarkdown("# Plan\n\n<script>x</script>").contains("&lt;script&gt;"))
XCTAssertFalse(renderMarkdown("![x](https://example.com/x.png)").contains("<img"))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `xcodebuild test -project src-tauri/gen/apple/simplemark.xcodeproj -scheme SimpleMarkQuickLookTests -destination 'platform=iOS Simulator,name=iPhone 17 Pro'`

Expected: FAIL because no Quick Look target or renderer exists.

- [ ] **Step 3: Implement the data-based provider**

Declare the `com.apple.quicklook.preview` extension point and Markdown `QLSupportedContentTypes`. Use `QLPreviewProvider` to read the supplied URL, convert the bounded subset into escaped HTML with local CSS, and reply with an HTML content type. Reject read failure with the exact error; do not launch Tauri, use a WebView, or write files.

- [ ] **Step 4: Verify target embedding and output**

Run the simulator extension tests, then `node scripts/verify-ios-document-integration.mjs --app <built-app>`. Confirm the `.appex` is embedded, signed, advertises Quick Look, and produces HTML for a representative Markdown fixture.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/apple-extensions/QuickLook src-tauri/gen/apple/project.yml scripts/verify-ios-document-integration.mjs
git commit -m "feat: preview Markdown in iOS Quick Look"
```

### Task 6: Full verification and device-ready handoff

**Files:**
- Modify: `docs/RELEASE-TRUST.md`
- Modify: `docs/APPLE-NATIVE-CAPABILITIES.md`

**Interfaces:**
- Consumes: generated app bundle and simulator.
- Produces: reproducible evidence for registration, open in place, Share, Quick Look, signing, and source regression checks.

- [ ] **Step 1: Run all focused test suites**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && npx vitest run tests/adapters/tauri-file-port.test.ts tests/app/native-open-request.test.ts && xcodebuild test -project src-tauri/gen/apple/simplemark.xcodeproj -destination 'platform=iOS Simulator,name=iPhone 17 Pro'`

Expected: PASS.

- [ ] **Step 2: Build and inspect the iOS app**

Run: `npm run build:native && npm run tauri ios build -- --debug && node scripts/verify-ios-document-integration.mjs --app <built-app>`

Expected: PASS with both extensions, required plist fields, and valid code signatures.

- [ ] **Step 3: Run the canonical shared gate**

Run: `bash scripts/simplemark_ci.sh`

Expected: PASS.

- [ ] **Step 4: Record real simulator actions**

Use the booted iPhone 17 Pro simulator to: install the app; open a fixture `.md` through the Files/Open In path; edit and save; prove the original fixture URL changed in place; share Unicode plain text; choose a destination; and request a Quick Look preview. Capture each result and the bundle SHA.

- [ ] **Step 5: Commit docs and prepare the branch**

```bash
git add docs/RELEASE-TRUST.md docs/APPLE-NATIVE-CAPABILITIES.md
git commit -m "docs: record iOS document integration verification"
git diff --check origin/main...HEAD
```
