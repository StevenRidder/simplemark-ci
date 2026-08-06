# Swappable App Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five editable icon masters and a persistent macOS Settings chooser that changes the running SimpleMark Dock and Command-Tab icon.

**Architecture:** A small shared app-icon catalog gives the UI a closed identifier set and SVG thumbnails. The macOS transport validates the same identifiers, maps them to embedded generated PNGs, applies the image through AppKit, and stores the successful choice in `NSUserDefaults`; browser composition supplies no capability and therefore renders no chooser.

**Tech Stack:** TypeScript 5.9, DOM, Vite asset URLs, Vitest, Playwright, Rust, Tauri 2.11, objc2 AppKit/Foundation, SVG, Tauri icon generator.

## Global Constraints

- Five choices: Original, Live Layers, Movable Blocks, Midnight, and Blue Page.
- Live Layers and Blue Page use an exact `#FFFFFF` tile base.
- SVG masters contain no embedded raster images or font-dependent text.
- The running macOS Dock and Command-Tab icon changes immediately and persists across relaunch.
- Finder and the signed `.app` keep Original in this phase.
- Browser builds omit the chooser.
- Native failures remain visible and local; they never silently select a different icon.
- No document, domain, application, or filesystem rule changes.

---

### Task 1: Vector masters and generated runtime assets

**Files:**
- Create: `src-tauri/icons/alternates/original.svg`
- Create: `src-tauri/icons/alternates/live-layers.svg`
- Create: `src-tauri/icons/alternates/movable-blocks.svg`
- Create: `src-tauri/icons/alternates/midnight.svg`
- Create: `src-tauri/icons/alternates/blue-page.svg`
- Create: `src-tauri/icons/alternates/png/original.png`
- Create: `src-tauri/icons/alternates/png/live-layers.png`
- Create: `src-tauri/icons/alternates/png/movable-blocks.png`
- Create: `src-tauri/icons/alternates/png/midnight.png`
- Create: `src-tauri/icons/alternates/png/blue-page.png`
- Create: `scripts/generate-alternate-icons.sh`
- Create: `tests/app/app-icon-assets.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: five SVG masters and five same-name 1024x1024 PNG assets.
- Produces: `npm run icons:generate`, which calls `npx tauri icon --png 1024` once per master and copies the single generated PNG to the stable `png/<id>.png` path.

- [ ] **Step 1: Write the failing asset-contract test**

```ts
const ids = ['original', 'live-layers', 'movable-blocks', 'midnight', 'blue-page'] as const
for (const id of ids) {
  const svg = readFileSync(resolve(`src-tauri/icons/alternates/${id}.svg`), 'utf8')
  expect(svg).not.toMatch(/<image\b|data:image|<text\b/i)
  expect(statSync(resolve(`src-tauri/icons/alternates/png/${id}.png`)).size).toBeGreaterThan(0)
}
expect(readFileSync(resolve('src-tauri/icons/alternates/live-layers.svg'), 'utf8'))
  .toContain('data-tile-background="#FFFFFF"')
expect(readFileSync(resolve('src-tauri/icons/alternates/blue-page.svg'), 'utf8'))
  .toContain('data-tile-background="#FFFFFF"')
```

- [ ] **Step 2: Run the test and verify missing assets fail**

Run: `npx vitest run tests/app/app-icon-assets.test.ts`

Expected: FAIL because `src-tauri/icons/alternates/original.svg` does not exist.

- [ ] **Step 3: Draw the five SVG masters**

Use a common `viewBox="0 0 1024 1024"`, a 904x904 rounded tile at `(60, 60)`, optical centering, and path-only M-down marks. Preserve each approved composition and set `data-tile-background="#FFFFFF" fill="#FFFFFF"` on the two blue tiles.

- [ ] **Step 4: Add deterministic generation and generate the PNGs**

```bash
#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
for id in original live-layers movable-blocks midnight blue-page; do
  output="$root/src-tauri/icons/alternates/.generated/$id"
  "$root/node_modules/.bin/tauri" icon --png 1024 \
    --output "$output" "$root/src-tauri/icons/alternates/$id.svg"
  cp "$output/1024x1024.png" "$root/src-tauri/icons/alternates/png/$id.png"
done
rm -r "$root/src-tauri/icons/alternates/.generated"
```

Add `"icons:generate": "bash scripts/generate-alternate-icons.sh"` to `package.json` and run `npm run icons:generate`.

- [ ] **Step 5: Run the asset test and inspect small-size renders**

Run: `npx vitest run tests/app/app-icon-assets.test.ts`

Expected: PASS. Create only a disposable contact sheet for 16, 32, 128, 256, and 512 pixel inspection, then remove it after review.

- [ ] **Step 6: Commit the asset unit**

```bash
git add package.json scripts/generate-alternate-icons.sh src-tauri/icons/alternates tests/app/app-icon-assets.test.ts
git commit -m "feat: add alternate app icon masters"
```

---

### Task 2: Closed icon catalog and Settings chooser

**Files:**
- Create: `src/app/app-icons.ts`
- Create: `tests/app/app-icons.test.ts`
- Modify: `src/app/ui/window-chrome.ts`
- Modify: `src/app/styles/app.css`
- Modify: `src/app/bootstrap.ts`
- Modify: `tests/ui/sidebar-parity.spec.ts`

**Interfaces:**
- Produces: `APP_ICON_IDS`, `AppIconId`, `APP_ICON_CHOICES`, and `normaliseAppIconId(value): AppIconId`.
- Extends `ComposeOptions` and `WindowChromeOptions` with optional `appIcon`, `appIconChoices`, and `onAppIconChange(id): Promise<void>` capability fields.
- Consumes: the SVG masters from Task 1 as Vite asset URLs.

- [ ] **Step 1: Write the failing catalog tests**

```ts
expect(APP_ICON_IDS).toEqual(['original', 'live-layers', 'movable-blocks', 'midnight', 'blue-page'])
expect(normaliseAppIconId('midnight')).toBe('midnight')
expect(normaliseAppIconId('unknown')).toBe('original')
expect(APP_ICON_CHOICES.map(({ label }) => label)).toEqual([
  'Original', 'Live Layers', 'Movable Blocks', 'Midnight', 'Blue Page',
])
```

- [ ] **Step 2: Run the catalog test and verify it fails**

Run: `npx vitest run tests/app/app-icons.test.ts`

Expected: FAIL because `src/app/app-icons.ts` does not exist.

- [ ] **Step 3: Implement the closed catalog**

```ts
export const APP_ICON_IDS = [
  'original', 'live-layers', 'movable-blocks', 'midnight', 'blue-page',
] as const
export type AppIconId = typeof APP_ICON_IDS[number]
export interface AppIconChoice {
  readonly id: AppIconId
  readonly label: string
  readonly source: string
}
export const normaliseAppIconId = (value: unknown): AppIconId =>
  APP_ICON_IDS.find((id) => id === value) ?? 'original'
```

Define `APP_ICON_CHOICES` with `new URL('../../src-tauri/icons/alternates/<id>.svg', import.meta.url).href` sources.

- [ ] **Step 4: Write the failing native-chooser UI test**

Add a window-chrome test fixture with the capability supplied and assert five accessible buttons, `aria-pressed="true"` on the active choice, one callback for a successful click, and unchanged selection when the callback rejects. Add a browser-mode assertion that “App Icon” is absent when the capability is omitted.

- [ ] **Step 5: Implement the Settings section**

Append a native-only `.app-icon-settings` section to the existing sidebar Settings popover. Use real `<img>` thumbnails, five `<button aria-label="Use <label> app icon">` controls, `aria-pressed`, a selected ring, and a CSS check badge. Await `onAppIconChange`; repaint only after fulfillment and call the existing `setStatus('error', ...)` path on rejection.

- [ ] **Step 6: Run focused app and UI tests**

Run: `npx vitest run tests/app/app-icons.test.ts`

Run: `npx playwright test tests/ui/sidebar-parity.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit the UI unit**

```bash
git add src/app/app-icons.ts src/app/bootstrap.ts src/app/ui/window-chrome.ts src/app/styles/app.css tests/app/app-icons.test.ts tests/ui/sidebar-parity.spec.ts
git commit -m "feat: choose the native app icon in Settings"
```

---

### Task 3: AppKit bridge and launch restoration

**Files:**
- Create: `src-tauri/src/app_icons.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src/app/tauri.ts`

**Interfaces:**
- Produces Tauri commands `get_app_icon() -> String` and `set_app_icon(icon: String) -> Result<(), String>`.
- Produces `app_icons::restore()` for native startup.
- Consumes the five `png/<id>.png` assets from Task 1.
- Supplies Task 2's optional composition capability from `tauri.ts`.

- [ ] **Step 1: Write failing Rust identifier and asset tests**

```rust
#[test]
fn parses_only_known_icon_ids() {
    assert_eq!(AppIconId::parse("midnight"), Some(AppIconId::Midnight));
    assert_eq!(AppIconId::parse("unknown"), None);
}

#[test]
fn every_icon_has_embedded_png_bytes() {
    for id in AppIconId::ALL {
        assert!(id.png().starts_with(b"\x89PNG\r\n\x1a\n"));
    }
}
```

- [ ] **Step 2: Run native tests and verify the new module is absent**

Run: `npm run test:native`

Expected: FAIL because `app_icons` and `AppIconId` do not exist.

- [ ] **Step 3: Implement the native icon module**

Define the five-case enum, `ALL`, `as_str`, `parse`, and `png` mapping with `include_bytes!`. On macOS, decode bytes with `NSData::with_bytes` and `NSImage::initWithData`, apply via `NSApplication::setApplicationIconImage`, and store `app.simplemark.selected-app-icon` in `NSUserDefaults` only after success. `stored()` defaults invalid data to Original, and `restore()` applies `stored()`.

Enable the exact objc2 features needed by the module: `NSImage`, `NSData`, and `NSUserDefaults` in addition to existing AppKit/Foundation features.

- [ ] **Step 4: Register commands and restore on startup**

Add `get_app_icon` and `set_app_icon` to `tauri::generate_handler!`. Call `app_icons::restore()` on macOS after the app is built and before `app.run`; log an explicit error if restoration fails while leaving Original in place.

- [ ] **Step 5: Wire the native composition root**

In `tauri.ts`, read `get_app_icon` before mounting and pass:

```ts
appIcon: normaliseAppIconId(await invoke<string>('get_app_icon')),
appIconChoices: APP_ICON_CHOICES,
onAppIconChange: (icon) => invoke('set_app_icon', { icon }),
```

Do not add these properties in `browser.ts`.

- [ ] **Step 6: Run native and focused shared tests**

Run: `npm run test:native`

Run: `npx vitest run tests/app/app-icons.test.ts tests/app/app-icon-assets.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the native unit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/app_icons.rs src-tauri/src/lib.rs src/app/tauri.ts
git commit -m "feat: persist and apply alternate macOS icons"
```

---

### Task 4: End-to-end verification and handoff

**Files:**
- Modify only if verification reveals a scoped defect.

**Interfaces:**
- Consumes the complete icon catalog, Settings capability, and native bridge.
- Produces exact branch/test/visual evidence for APP-26.

- [ ] **Step 1: Regenerate assets and prove a clean asset diff**

Run: `npm run icons:generate`

Run: `git diff --exit-code -- src-tauri/icons/alternates/png`

Expected: PASS with no regenerated PNG drift.

- [ ] **Step 2: Run the canonical shared gate**

Run: `bash scripts/simplemark_ci.sh`

Expected: PASS.

- [ ] **Step 3: Run native verification**

Run: `npm run test:native`

Run: `npm run build:native`

Expected: PASS and a real SimpleMark `.app` bundle.

- [ ] **Step 4: Perform visual and interaction QA**

Verify all five Settings thumbnails, the selection ring/check, immediate Dock change, Command-Tab change, persistence after relaunch, Original fallback for invalid stored data, and exact white bases on Live Layers and Blue Page. Inspect each PNG at 16, 32, 128, 256, and 512 pixels.

- [ ] **Step 5: Remove generated build output after recording results**

Delete only this worktree's `dist/`, `playwright-report/`, `test-results/`, and Rust `target/` directories after recording their successful outputs. Keep committed SVG and PNG assets.

- [ ] **Step 6: Commit any scoped verification fixes**

```bash
git add -A
git commit -m "test: verify alternate app icons"
```

- [ ] **Step 7: Push, open the PR, and submit completion evidence**

Push `claude/APP-26-swappable-app-icons`, open a PR against `main`, wait for the exact-head `gate`, add it to the merge queue, and call `complete_claim` with branch, head SHA, PR URL, shared gate result, native test/build result, and visual QA evidence. Do not mark the task Done manually.
