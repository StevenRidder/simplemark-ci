# Blue Movable Blocks app icons

## Outcome

Add both approved blue Movable Blocks treatments to the native macOS **App Icon** chooser so they can be compared in the running app:

1. **Blue Trio** — the three movable content blocks use the royal, sky, and cyan colors from Live Layers.
2. **Electric + Black** — the tilted content block and MDown badge use the royal Live Layers blue while the other two content blocks remain charcoal.

The installed app will offer seven choices: Original, Live Layers, Movable Blocks, Blue Trio, Electric + Black, Midnight, and Blue Page.

## Visual contract

Both new icons reuse the existing Movable Blocks vector geometry exactly: white rounded tile, charcoal page outline, folded corner, three movable content blocks, lower-left MDown badge, shadows, rotations, radii, and line weights. Only color fills and color-derived shadow tones change.

The tile background is pure white (`#FFFFFF`) so the new icons match Live Layers and Blue Page.

### Blue Trio

- Tilted top block: Live Layers royal gradient (`#2D67FF` to `#1548E7`).
- Middle block: Live Layers sky gradient (`#62B6FF` to `#357FF3`).
- Bottom block: Live Layers cyan gradient (`#67DCF7` to `#37B9EA`).
- MDown badge: royal gradient with a white mark.
- Page outline: the same charcoal used by Movable Blocks.

### Electric + Black

- Tilted top block: Live Layers royal gradient.
- Middle and bottom blocks: existing Movable Blocks charcoal.
- MDown badge: the same royal gradient as the tilted block, with a white mark.
- Page outline: existing Movable Blocks charcoal.

## Asset and application changes

Create two fully vector SVG masters and their generated 1024-pixel PNG runtime assets:

- `src-tauri/icons/alternates/blue-trio.svg`
- `src-tauri/icons/alternates/electric-blocks.svg`
- `src-tauri/icons/alternates/png/blue-trio.png`
- `src-tauri/icons/alternates/png/electric-blocks.png`

Extend the TypeScript icon catalog and Rust `AppIconId` mapping with stable IDs `blue-trio` and `electric-blocks`. The chooser remains generic and needs no new UI behavior. The Rust boundary continues to embed PNG bytes, apply the selected image through AppKit, and persist the stable ID in `NSUserDefaults`.

Place both choices immediately after Movable Blocks. Existing saved choices remain valid; unknown values continue to fall back to Original.

## Failure behavior

An invalid or undecodable runtime asset must continue to leave the current icon selected and show the existing visible Settings error. The change must not alter persistence, fallback, browser behavior, or the original five assets.

## Verification and delivery

- Add focused catalog and asset assertions for all seven choices, stable order, vector-only SVG masters, non-empty PNGs, and pure-white blue tiles.
- Extend the focused Rust mapping tests so every ID parses and every embedded PNG begins with the PNG signature.
- Run the focused TypeScript icon suites and focused Rust icon tests.
- Build a native `.app` bundle, ad-hoc sign it, hot-patch `/Applications/SimpleMark.app`, launch it, and verify the installed signature and process.
- Do not run the full local `scripts/simplemark_ci.sh` suite for this icon-only change.
- Remove generated build caches after installation.

Canonical `main` cannot be pushed directly for a source change. After local approval, publish through a pull request and merge queue. GitHub's required gate may run there even though the full local CI suite is intentionally skipped.
