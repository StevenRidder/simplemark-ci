# Blue Movable Blocks App Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved Blue Trio and Electric + Black icons as separate, persistent choices in the native macOS App Icon settings, hot-patch the installed app, and land the source on canonical `main`.

**Architecture:** Preserve the generic TypeScript Settings chooser and existing AppKit icon boundary. Add two SVG masters plus generated PNGs, extend the shared TypeScript catalog and Rust embedded-asset enum with stable IDs, and verify the same focused contracts that protect the existing five choices.

**Tech Stack:** SVG, TypeScript, Vitest, Rust, Tauri 2, AppKit, GitHub merge queue

## Global Constraints

- Reuse the existing Movable Blocks geometry exactly; change only approved fills and color-derived shadow tones.
- Use pure white (`#FFFFFF`) tile backgrounds for both new icons.
- Stable IDs are `blue-trio` and `electric-blocks`.
- Settings order is Original, Live Layers, Movable Blocks, Blue Trio, Electric + Black, Midnight, Blue Page.
- Unknown persisted IDs continue to fall back to Original.
- Do not run `bash scripts/simplemark_ci.sh` locally; run focused icon tests and a native app build.
- Source changes reach canonical `main` only through a pull request and merge queue.

---

### Task 1: Vector masters and runtime PNG assets

**Files:**
- Create: `src-tauri/icons/alternates/blue-trio.svg`
- Create: `src-tauri/icons/alternates/electric-blocks.svg`
- Create: `src-tauri/icons/alternates/png/blue-trio.png`
- Create: `src-tauri/icons/alternates/png/electric-blocks.png`
- Modify: `tests/app/app-icon-assets.test.ts`

**Interfaces:**
- Consumes: the geometry and filters in `src-tauri/icons/alternates/movable-blocks.svg`; the color stops in `src-tauri/icons/alternates/live-layers.svg`.
- Produces: vector preview sources addressed as `blue-trio.svg` and `electric-blocks.svg`, plus 1024-pixel PNG byte assets embedded by Rust in Task 2.

- [ ] **Step 1: Write the failing asset contract**

Extend `ICON_IDS` and the pure-white assertion:

```ts
const ICON_IDS = [
  'original',
  'live-layers',
  'movable-blocks',
  'blue-trio',
  'electric-blocks',
  'midnight',
  'blue-page',
] as const

test.each(['live-layers', 'blue-trio', 'electric-blocks', 'blue-page'])(
  '%s uses the approved pure-white tile instead of warm white',
  (id) => {
    const svg = readFileSync(alternate(`${id}.svg`), 'utf8')
    expect(svg).toContain('data-tile-background="#FFFFFF"')
  },
)

test('uses the approved Live Layers palette for both blue block treatments', () => {
  const trio = readFileSync(alternate('blue-trio.svg'), 'utf8')
  const electric = readFileSync(alternate('electric-blocks.svg'), 'utf8')
  expect(trio).toContain('data-block-palette="royal-sky-cyan"')
  expect(electric).toContain('data-block-palette="royal-charcoal-charcoal"')
})
```

- [ ] **Step 2: Run the asset test and verify it fails**

Run: `npx vitest run tests/app/app-icon-assets.test.ts`

Expected: FAIL because `blue-trio.svg` and `electric-blocks.svg` do not exist.

- [ ] **Step 3: Create both SVG masters**

Copy the existing Movable Blocks path and rectangle geometry without changing coordinates. Give both tiles:

```svg
<rect data-tile-background="#FFFFFF" x="60" y="60" width="904" height="904" rx="206" fill="#FFFFFF"/>
```

Blue Trio uses:

```svg
<g data-block-palette="royal-sky-cyan" filter="url(#soft-shadow)">
  <rect x="350" y="385" width="340" height="104" rx="28" fill="url(#royal)" transform="rotate(7 520 437)"/>
  <rect x="388" y="530" width="330" height="104" rx="28" fill="url(#sky)"/>
  <rect x="348" y="676" width="330" height="104" rx="28" fill="url(#cyan)"/>
  <rect x="142" y="652" width="350" height="230" rx="64" fill="url(#royal)"/>
</g>
```

Electric + Black uses:

```svg
<g data-block-palette="royal-charcoal-charcoal" filter="url(#soft-shadow)">
  <rect x="350" y="385" width="340" height="104" rx="28" fill="url(#royal)" transform="rotate(7 520 437)"/>
  <rect x="388" y="530" width="330" height="104" rx="28" fill="#20201F"/>
  <rect x="348" y="676" width="330" height="104" rx="28" fill="#20201F"/>
  <rect x="142" y="652" width="350" height="230" rx="64" fill="url(#royal)"/>
</g>
```

Define the exact Live Layers gradients: royal `#2D67FF`→`#1548E7`, sky `#62B6FF`→`#357FF3`, and cyan `#67DCF7`→`#37B9EA`.

- [ ] **Step 4: Generate only the two required PNG assets**

Run:

```bash
npx tauri icon --png 1024 --output src-tauri/icons/alternates/.generated/blue-trio src-tauri/icons/alternates/blue-trio.svg
npx tauri icon --png 1024 --output src-tauri/icons/alternates/.generated/electric-blocks src-tauri/icons/alternates/electric-blocks.svg
cp src-tauri/icons/alternates/.generated/blue-trio/1024x1024.png src-tauri/icons/alternates/png/blue-trio.png
cp src-tauri/icons/alternates/.generated/electric-blocks/1024x1024.png src-tauri/icons/alternates/png/electric-blocks.png
find src-tauri/icons/alternates/.generated -depth -delete
```

- [ ] **Step 5: Run the focused asset test**

Run: `npx vitest run tests/app/app-icon-assets.test.ts`

Expected: all asset tests PASS.

- [ ] **Step 6: Commit the asset slice**

```bash
git add tests/app/app-icon-assets.test.ts src-tauri/icons/alternates/blue-trio.svg src-tauri/icons/alternates/electric-blocks.svg src-tauri/icons/alternates/png/blue-trio.png src-tauri/icons/alternates/png/electric-blocks.png
git commit -m "feat: add blue Movable Blocks icon assets"
```

### Task 2: Settings catalog and native embedded mapping

**Files:**
- Modify: `src/app/app-icons.ts`
- Modify: `src-tauri/src/app_icons.rs`
- Modify: `tests/app/app-icons.test.ts`
- Modify: `tests/ui/sidebar-parity.spec.ts`

**Interfaces:**
- Consumes: `blue-trio.svg`, `electric-blocks.svg`, and their PNGs from Task 1.
- Produces: `AppIconId` values `blue-trio` and `electric-blocks` accepted by TypeScript, the Tauri command boundary, persistence, and the Settings chooser.

- [ ] **Step 1: Write failing catalog and chooser expectations**

Update the expected IDs and labels:

```ts
expect(APP_ICON_IDS).toEqual([
  'original',
  'live-layers',
  'movable-blocks',
  'blue-trio',
  'electric-blocks',
  'midnight',
  'blue-page',
])
expect(APP_ICON_CHOICES.map(({ label }) => label)).toEqual([
  'Original',
  'Live Layers',
  'Movable Blocks',
  'Blue Trio',
  'Electric + Black',
  'Midnight',
  'Blue Page',
])
```

Change the native chooser count from five to seven and assert that `Use Blue Trio app icon` and `Use Electric + Black app icon` exist.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npx vitest run tests/app/app-icons.test.ts tests/ui/sidebar-parity.spec.ts`

Expected: FAIL because the catalog still exposes five choices.

- [ ] **Step 3: Extend the TypeScript catalog**

Add both IDs to `APP_ICON_IDS` and add:

```ts
{
  id: 'blue-trio',
  label: 'Blue Trio',
  source: new URL('../../src-tauri/icons/alternates/blue-trio.svg', import.meta.url).href,
},
{
  id: 'electric-blocks',
  label: 'Electric + Black',
  source: new URL('../../src-tauri/icons/alternates/electric-blocks.svg', import.meta.url).href,
},
```

- [ ] **Step 4: Extend the Rust enum and embedded PNG mapping**

Add `BlueTrio` and `ElectricBlocks` to `AppIconId`, expand `ALL` to seven values, parse and serialize their stable IDs, and embed:

```rust
Self::BlueTrio => include_bytes!("../icons/alternates/png/blue-trio.png"),
Self::ElectricBlocks => include_bytes!("../icons/alternates/png/electric-blocks.png"),
```

Extend `parses_only_known_icon_ids` with assertions for both IDs.

- [ ] **Step 5: Run the focused TypeScript and Rust tests**

Run:

```bash
npx vitest run tests/app/app-icons.test.ts tests/app/app-icon-assets.test.ts
(cd src-tauri && cargo test app_icons)
```

Expected: all focused tests PASS.

- [ ] **Step 6: Commit the catalog slice**

```bash
git add src/app/app-icons.ts src-tauri/src/app_icons.rs tests/app/app-icons.test.ts tests/ui/sidebar-parity.spec.ts
git commit -m "feat: offer blue block icons in Settings"
```

### Task 3: Native hot patch and canonical merge

**Files:**
- Verify: all files changed by Tasks 1 and 2
- Install: `/Applications/SimpleMark.app`

**Interfaces:**
- Consumes: the seven-choice catalog and embedded PNGs.
- Produces: a locally installed, signed, running app and merged canonical source provenance.

- [ ] **Step 1: Verify the scoped diff and focused contracts**

Run:

```bash
git diff --check origin/main...HEAD
npx vitest run tests/app/app-icons.test.ts tests/app/app-icon-assets.test.ts
(cd src-tauri && cargo test app_icons)
```

Expected: no whitespace errors and all focused tests PASS.

- [ ] **Step 2: Build the native app without the full local CI suite**

Run: `CARGO_INCREMENTAL=0 npm run build:native -- --bundles app`

Expected: Tauri reports one app bundle at `src-tauri/target/release/bundle/macos/SimpleMark.app`.

- [ ] **Step 3: Sign and hot-patch the installed app**

Ad-hoc sign the built bundle, verify it, stage with `ditto`, atomically swap the exact `/Applications/SimpleMark.app` path, delete only the old staged bundle, launch the app, and verify the running executable path and signature.

- [ ] **Step 4: Push, open the PR, and queue it**

Push `codex/blue-movable-blocks`, open a pull request against canonical `main`, wait for the required `gate`, and add the PR to GitHub's merge queue. Do not push directly to `main`.

- [ ] **Step 5: Prove canonical landing**

Fetch `origin/main`, confirm the merge provenance contains the icon commits, and record the merged SHA on the SimpleMark board.

- [ ] **Step 6: Remove generated caches**

Delete only this worktree's `src-tauri/target`, `node_modules`, `dist`, `.artifacts`, `playwright-report`, and `test-results` directories, then report the final worktree size.
