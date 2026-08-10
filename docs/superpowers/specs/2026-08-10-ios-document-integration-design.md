# iOS Markdown document integration design

**Status:** Approved by the product owner, 2026-08-10

## Goal

Make SimpleMark a first-class iOS Markdown editor: it is declared as the owner/editor for `.md` and `.markdown`, appears in Files and the system Open In choices, opens an existing document at its original provider URL, saves back to that URL, accepts a Markdown file from the Share sheet, and supplies a system Quick Look preview.

This means the supported iOS interpretation of “the `.md` app”. iOS does not expose a default-application category for arbitrary document extensions, so installation cannot replace another app globally. SimpleMark must instead be the correctly registered owner and a reliable destination in every standard document surface.

## Non-negotiable rules

- An existing document selected in Files, Open In, or a file-share action remains at its existing iCloud Drive, Dropbox, Files-provider, or local URL. SimpleMark reads and writes that document in place; it never silently imports it into the app container.
- Plain text shared from Grammarly is not an existing document. It becomes a new Markdown document only after the person selects a destination in the standard document browser.
- The main app, Share extension, and Quick Look extension are ordinary Xcode targets with independent `Info.plist`, entitlements, signing, and tests. No private API, runtime swizzling, URL-scheme handoff, or polling directory is used to imitate document delivery.
- Every document change continues through the application authority. Native code only acquires a URL, security scope, or bytes; it never mutates editor state or writes a second document model.
- Quick Look is read-only. It uses a bounded static HTML preview generated from the Markdown renderer inputs; it does not boot the Tauri application or write the previewed document.

## Root causes in the current build

1. The generated iOS `Info.plist` declares Markdown support and Tauri already emits its documented iOS `RunEvent::Opened` for document URLs, but `src-tauri/src/lib.rs` deliberately consumes that event only on desktop. iOS-delivered URLs are therefore dropped by SimpleMark rather than by iOS or Tauri.
2. `open_workspace_folder` has a mobile implementation that always returns Tauri's on-device documents directory, while `default_workspaces` prefers the public iCloud container. The same “open folder” action can therefore open a different, empty folder.
3. The Tauri dialog plugin deliberately copies Files-provider selections to a temporary URL on iOS. It cannot meet the open-in-place promise.
4. There is no Share extension, no Quick Look preview extension, and no Xcode build wiring to embed either target.

## Design

### 1. Registration and standard document browser

The iOS app target declares `net.daringfireball.markdown` as an `Editor` with `LSHandlerRank=Owner`, maps `.md` and `.markdown`, and explicitly supports opening documents in place. The app target enables the UIKit document browser launch experience rather than pretending the Tauri file dialog is a provider browser.

The existing rendered reader remains the main application surface. A documented `UIDocumentPickerViewController` bridge owns explicit Files selection and folder navigation, while iOS's standard document-open callback reaches Tauri's `RunEvent::Opened` for Files/Open In delivery. The picker requests open-in-place URLs, begins security-scoped access, and retains that scope until the document session closes. The browser remains the only way to browse an arbitrary provider folder; no provider API or artificial workspace is introduced.

The bridge distinguishes:

| Intake | Result |
| --- | --- |
| Files / Open In Markdown URL | Original URL opened and saved in place |
| Document-browser new document | New user-chosen URL opened and saved in place |
| Share file URL | Original URL opened in place when the provider supplies one |
| Grammarly plain text | A new unsaved Markdown draft, followed by the document browser's standard destination choice |

The public iCloud SimpleMark Documents directory remains a convenience location, not a replacement for selected folders. `open_workspace_folder` and `default_workspaces` resolve the same iCloud directory so an in-app folder operation cannot split the workspace.

### 2. Main-app intake bridge

Create an iOS-native document-picker plugin at the Tauri mobile boundary. It owns only `UIDocumentPickerViewController` delegation and security-scoped bookmark lifecycle. OS Open In delivery uses Tauri's existing iOS `RunEvent::Opened`; SimpleMark queues its URLs before the webview mounts exactly as the desktop path already does. The plugin is used only for the app's explicit Open and folder actions because Tauri's stock dialog plugin turns iOS provider documents into temporary copies.

The Rust adapter exposes a typed queued open request whose values are opaque handles, exact bytes, and a source label (`files`, `open_in`, or `share_file`). TypeScript consumes that request through a Tauri port, constructs the existing `DocumentSession`, and reports an actual error when scope acquisition, download, parsing, or in-place save fails. There is no fallback copy and no silent request loss before the webview mounts.

Write operations coordinate with the provider URL. The native layer wraps reads and writes in `NSFileCoordinator`, uses `startAccessingSecurityScopedResource` only while required, and preserves the current same-directory atomic-save rule only where the provider supports replacement. It reports inability to replace rather than copying to the app container.

### 3. Share extension

Add an iOS Share extension target with its own signed bundle. Its activation rule accepts Markdown file representations and plain text. It handles exactly one item:

- Markdown files use the main application's registered document type and standard Open In route; this is the only path that guarantees the original provider URL remains the document being edited.
- For plain text, save the UTF-8 text as a pending draft record. On foregrounding, the main app presents the standard document-picker save destination, then opens that newly chosen file.

The app group is transient handoff metadata only. It never becomes a document store and deletes a consumed or failed record with a visible error retained for the user.

### 4. Quick Look extension

Add a Quick Look preview-extension target with `QLSupportedContentTypes` for Markdown. It reads the provided URL once, transforms supported Markdown to self-contained static HTML, and returns a `QLPreviewReply`. Preview assets are bundled, local, and bounded; remote images and active content are refused. The extension never imports the app's Tauri process or writes data.

The initial renderer must cover headings, prose, lists, links, code, tables, blockquotes, and fenced Mermaid/code as legible static fallbacks. It shares portable CSS tokens and test fixtures with the app where that does not make the extension depend on the application composition root. Rich interactive diagrams, editing, and network loads are explicitly out of the Quick Look surface.

### 5. Build, signing, and verification

The generated `src-tauri/gen/apple` project remains generated input, not the single source of truth. Add a checked-in Xcode extension project/target definitions and deterministic generation/post-generation script so `tauri ios build` produces an `.app` with both `.appex` bundles. Give every target its own Info plist and entitlements; use the app group only for main-app/Share handoff.

Build verification fails if the installed app lacks either extension, any target lacks the Markdown type declaration it needs, code signatures do not validate, or the extension Info plists have the wrong extension point. Simulator tests cover document selection, a provider URL that remains unchanged after save, launch-time queued delivery, a Grammarly-text draft, share-file handoff, the matching iCloud-folder path, and Quick Look static output. Device validation covers iCloud Drive and a real third-party Files provider.

## Acceptance criteria

1. Installing SimpleMark makes it an Editor/Owner option for `.md` and `.markdown` in Files/Open In; it does not claim an impossible universal iOS default setting.
2. Opening a Markdown document from Files reaches the rendered SimpleMark document with no copy into SimpleMark's folder.
3. Editing and saving that document changes the original provider URL and leaves its parent folder unchanged.
4. Folder browsing uses the standard iOS document browser, and choosing the app's folder opens the same iCloud Documents directory used by launch.
5. Sharing a Markdown file from another app uses iOS Open In and opens that original file in SimpleMark; sharing Grammarly plain text asks for a destination and produces exactly one new portable `.md` file.
6. Quick Look previews a Markdown file with SimpleMark typography without launching the app.
7. Failure to acquire scope, materialize cloud bytes, parse Markdown, hand off an extension item, or write in place remains visible; no private backup copy is created.
8. The app, Share extension, and Quick Look extension build, sign, install, and run on the iPhone 17 Pro simulator; source and native gates remain green.

## Risks deliberately addressed

- **Tauri lifecycle:** Tauri emits iOS `RunEvent::Opened`; SimpleMark must queue that documented event on iOS instead of treating it as desktop-only.
- **Provider permissions:** security-scoped access and file coordination are retained at the native boundary so a Dropbox or iCloud URL does not turn into a temporary file.
- **Extensions:** the app group is bounded metadata only; it does not create a second document authority or a private vault.
- **Quick Look size:** the static preview is bounded and no WebView/Tauri process runs in the extension.
- **Generated Xcode state:** extension targets are verified after regeneration and after a packaged build, not merely checked into `gen/apple` once.
