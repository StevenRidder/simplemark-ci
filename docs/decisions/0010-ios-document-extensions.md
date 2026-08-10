# ADR-0010: iOS document extensions are native, isolated bundles embedded by the generated Xcode project

- **Status:** Accepted
- **Date:** 2026-08-10
- **Decision owners:** SimpleMark maintainers

## Context

SimpleMark must behave as a Markdown document app on iOS: Files and Open In must deliver the original document to the app, plain text shared from another app must become an explicitly saved new document, and Quick Look must show a useful document preview. Share and Quick Look are app extensions, not Tauri windows or a second document authority.

Tauri generates the iOS Xcode project but does not model these extension targets from `tauri.conf.json`. The generated `gen/apple/project.yml` is tracked and is the Xcode project's source of truth. A manual Xcode edit would disappear the next time the project is generated, and a URL-scheme-only handoff would not make the extensions discoverable to iOS.

## Decision

The tracked XcodeGen definition embeds two native iOS app extensions in the SimpleMark application:

1. A Share extension activates only for `public.plain-text`, puts one bounded UTF-8 draft record in the shared App Group, and asks iOS to open SimpleMark. It never accepts a Markdown file or copies a provider file. Registered document ownership handles Markdown files in place.
2. A Quick Look preview extension advertises Markdown, reads only the URL Quick Look provides, and produces escaped static HTML. It does not start Tauri, use a WebView, make a network request, or write a file.

The app and both extensions share only the App Group required for the temporary plain-text handoff. The main app consumes and deletes a draft record only after the person chooses its normal save destination. Extension code is native presentation or rendering plumbing; document parsing, edits, and persistent writes remain under the existing application authority.

`project.yml` is regenerated with XcodeGen as part of native verification. The built app must contain both signed `.appex` bundles, and a verifier checks the app and extension declarations rather than trusting source text.

## Consequences

- Files/Open In stays the original Markdown-file route; no private import library or temporary-file masquerade is introduced.
- Grammarly and similar plain-text shares are intentionally drafts, because they have no original `.md` file to preserve.
- The project carries the ordinary App Group entitlement and two independently signed extension bundles. Missing entitlements, embeddings, or signatures fail the native verification.
- The extensions intentionally use a small portable renderer and handoff record. They are not another app composition root and do not expose editing or collaboration.

## Rejected alternatives

- **A custom URL scheme as the only integration.** It is not an Open In, Share, or Quick Look registration, and it cannot preserve a provider-owned document URL.
- **Copy every shared Markdown file into SimpleMark storage.** It violates the original-file requirement and makes a stale duplicate look authoritative.
- **Run the Tauri app or its WebView inside an extension.** That duplicates composition and exceeds an extension's memory and lifecycle contract.
- **Manual Xcode project edits.** They are not reproducible after Tauri generation.
