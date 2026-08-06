# Swappable App Icons Design

**Status:** Approved
**Date:** 2026-08-07
**Task:** APP-26

## Goal

Let a person choose among the existing SimpleMark icon and four approved alternatives from the native macOS Settings popover. The choice changes the Dock and Command-Tab icon immediately and survives relaunch without changing the signed application bundle.

## Icon set

Five editable SVG masters live under `src-tauri/icons/alternates/`:

1. **Original** — the existing warm document and M-down badge.
2. **Live Layers** — three translucent cyan-to-blue page layers with a white M-down mark. Its tile background is exactly `#FFFFFF`.
3. **Movable Blocks** — a charcoal outlined page containing amber and charcoal movable blocks, with an amber M-down badge.
4. **Midnight** — a near-black tile, ivory outlined page, amber middle line, and compact amber M-down badge.
5. **Blue Page** — a navy outlined page, blue middle line, and blue M-down badge. Its tile background is exactly `#FFFFFF`.

The four alternatives are clean vector redraws of the approved raster concepts. They contain only SVG shapes, paths, gradients, masks, and filters—never embedded screenshots or font-dependent text. The original SVG remains the source for Original.

Each SVG produces a matching 1024-pixel PNG through the existing Tauri icon command. SVGs are used for Settings thumbnails; PNGs are embedded in the native binary because AppKit consumes raster image data for the running application icon.

## Settings interaction

The existing native Settings popover gains an **App Icon** section with five compact square buttons. Each button shows the actual SVG, has an accessible name, and exposes the candidate name as its tooltip. The active choice has a visible selection ring and checkmark.

Selecting a button:

1. asks the native bridge to apply the chosen icon;
2. updates the selection only after native success;
3. leaves the current icon selected and shows the existing local error status if the operation fails; and
4. keeps document focus and never changes Markdown.

Browser builds omit the whole section because they cannot change an operating-system application icon.

## Native boundary and persistence

A closed `AppIconId` union names the five choices. The macOS bridge exposes two thin commands:

- `get_app_icon` returns the persisted, validated choice, defaulting to Original.
- `set_app_icon` validates the identifier, decodes the corresponding embedded PNG as an `NSImage`, applies it through `NSApplication`, and persists the identifier in macOS user defaults only after success.

Startup restores the validated icon before the document composition mounts. Unknown or stale stored values fall back to Original. Non-macOS implementations return an honest unsupported result and the shared browser UI never offers the chooser.

This is shell presentation state. It does not enter the document, domain, application layer, file adapter, or signed bundle.

## Deferred packaged-icon behavior

For this phase, Finder and the installed `.app` retain Original. After a candidate wins, its SVG can replace the primary bundle source and regenerate ICNS, ICO, and platform PNGs so the same icon appears everywhere without runtime bundle mutation.

## Verification

- Asset tests prove all five SVG and PNG pairs exist, the SVGs contain no embedded raster data or text elements, and both blue tiles use exact `#FFFFFF` bases.
- UI tests prove all five choices render when native capability is supplied, the active choice is marked, successful selection emits the chosen ID, failed selection remains unchanged, and browser mode omits the section.
- Rust tests prove the five identifiers, invalid-value fallback, and asset mapping.
- Manual visual QA compares every candidate at 16, 32, 128, 256, and 512 pixels.
- The final branch runs `bash scripts/simplemark_ci.sh`, `npm run test:native`, and `npm run build:native`.
