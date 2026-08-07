# Project Tanoa Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the finished Project Tanoa Markdown field report and a reproducible 17-second GIF that proves its renderers, contextual source edit, and real native watched-file path in the latest SimpleMark UI.

**Architecture:** One checked JSON scenario owns every fictional number. One final portable Markdown document contains invisible beat markers that the recorder splits into its opening, paste, and external-update phases. Vitest checks narrative and arithmetic consistency; Playwright opens the exact document content and proves each renderer and source edit; a separate macOS recorder launches the real Tauri bundle on a temporary note, drives it through Accessibility, captures one continuous window sequence, performs an atomic external write, reopens the changed note through the native single-instance path, and encodes the frames as the final GIF.

**Tech Stack:** Markdown, JSON, SVG, TypeScript 5.9, Vitest, Playwright, Node.js 20+, Tauri 2.11, macOS Accessibility through `osascript`, `screencapture`, FFmpeg.

## Global Constraints

- Follow the accepted design in [`2026-08-08-simplemark-showcase-design.md`](../specs/2026-08-08-simplemark-showcase-design.md).
- Before Task 1, create and claim a separate implementation task on the live `simplemark` Switchboard board; `APP-29` remains the design-and-plan provenance task.
- Label Project Tanoa, its 2032 cyclone, equipment, telemetry, committee, and outcomes as fictional in the opening screen and source notes.
- Keep `Fulaga` pending Fijian-language or Fulaga community review; do not imply that review has happened.
- Use OpenStreetMap relation `3521053` only as sourced geography. Put `Map data © OpenStreetMap contributors · ODbL 1.0` visibly in the map and link the document attribution to `https://www.openstreetmap.org/copyright`.
- Use only current renderers: raw SVG, Mermaid, Vega-Lite, KaTeX, ANSI, Graphviz/DOT, JSON, GFM tables/checklists/callouts, and ordinary highlighted code.
- Do not add or repair a renderer, add document-specific CSS, change product chrome, or use Markmap.
- Keep [`record-demo.mjs`](../../../scripts/record-demo.mjs) and [`simplemark-demo.gif`](../../assets/simplemark-demo.gif) byte-for-byte unchanged.
- The final report is `docs/showcase/project-tanoa.md`; recorder preparation occurs only in a disposable directory under `.artifacts/`.
- The canonical final report stores `reserve_floor` as `0.42`. The recorder alone prepares the pre-correction paste by changing the one marked JSON field to `0.35` in its disposable copy.
- The native watcher currently reports an external change but does not silently adopt new bytes. The film must show the real `watch_note` warning, then reopen the same path through the existing native open-request bridge before showing the final success section. Do not present that sequence as automatic merge or attribution.
- Native capture requires Screen Recording and Accessibility permission. Missing permission is a hard, explained failure; it is never bypassed with browser chrome or a DOM mutation.
- One continuous native capture, exactly 102 output frames at 6 fps, `1000 × 625`, 17 seconds, looping, at or below 5 MB.
- Product or test changes go through the normal PR and merge queue. Documentation, scenario, and recorder-only changes still require exact local verification before publication.

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `docs/showcase/data/project-tanoa-scenario.json` | Create | Single source for fictional technical values and source metadata |
| `docs/showcase/assets/fulaga-map.svg` | Create | Lagoon Editorial map made from OSM relation 3521053, with embedded attribution |
| `docs/showcase/project-tanoa.md` | Create | Final public-quality portable field report and recorder beat markers |
| `tests/app/project-tanoa-showcase.test.ts` | Create | Arithmetic, prose, source, link, marker, and truth-boundary contract |
| `tests/ui/project-tanoa-showcase.spec.ts` | Create | Exact-document renderer, fidelity, and contextual-edit proof |
| `scripts/record-tanoa-showcase.mjs` | Create | Native macOS orchestration, capture, external update, reopen, and GIF encoding |
| `tests/app/project-tanoa-recorder.test.ts` | Create | Recorder content preparation, refusal, and metadata contract |
| `package.json` | Modify | Add `showcase:tanoa` command only |
| `docs/assets/project-tanoa-showcase.gif` | Create last | Verified 17-second final artifact |

---

### Task 1: Lock the fictional scenario and its arithmetic

**Files:**
- Create: `docs/showcase/data/project-tanoa-scenario.json`
- Create: `tests/app/project-tanoa-showcase.test.ts`

**Interfaces:**
- Produces schema `simplemark.project-tanoa.v1`.
- Produces the exact values consumed by the report and recorder.
- The test reads repository files directly; no scenario logic enters `src/`.

- [ ] **Step 1: Write the failing scenario-contract test**

Create `tests/app/project-tanoa-showcase.test.ts` with the first contract:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Scenario {
  readonly schema: 'simplemark.project-tanoa.v1'
  readonly fictional: true
  readonly geography: { readonly osmRelation: 3521053; readonly name: 'Fulaga' }
  readonly battery: {
    readonly capacityKwh: number
    readonly isolationSoc: number
    readonly approvedReserveFloor: number
    readonly staleReserveFloor: number
  }
  readonly load: {
    readonly commissioningKw: number
    readonly priorityKw: number
    readonly flexibleKw: number
    readonly priorityCircuits: readonly string[]
  }
  readonly autonomy: {
    readonly requiredHours: number
    readonly safeBeforeHours: number
    readonly falseControllerHours: number
    readonly acceptedHours: number
    readonly gapHours: number
  }
  readonly final: {
    readonly frequencyHz: number
    readonly reservePct: number
    readonly priorityCircuitsHolding: number
  }
}

const scenario = JSON.parse(
  readFileSync(resolve('docs/showcase/data/project-tanoa-scenario.json'), 'utf8'),
) as Scenario

const oneDecimal = (value: number): number => Math.round(value * 10) / 10

describe('Project Tanoa scenario', () => {
  it('is explicitly fictional and tied to the sourced Fulaga geometry', () => {
    expect(scenario.schema).toBe('simplemark.project-tanoa.v1')
    expect(scenario.fictional).toBe(true)
    expect(scenario.geography).toEqual(expect.objectContaining({ name: 'Fulaga', osmRelation: 3521053 }))
  })

  it('makes the stale floor produce a false pass and the approved floor reveal the gap', () => {
    const { capacityKwh, isolationSoc, approvedReserveFloor, staleReserveFloor } = scenario.battery
    const safeEnergy = capacityKwh * (isolationSoc - approvedReserveFloor)
    const staleEnergy = capacityKwh * (isolationSoc - staleReserveFloor)

    expect(oneDecimal(safeEnergy / scenario.load.commissioningKw)).toBe(scenario.autonomy.safeBeforeHours)
    expect(oneDecimal(staleEnergy / scenario.load.commissioningKw)).toBe(scenario.autonomy.falseControllerHours)
    expect(oneDecimal(scenario.autonomy.requiredHours - scenario.autonomy.safeBeforeHours))
      .toBe(scenario.autonomy.gapHours)
  })

  it('closes the gap by deferring only flexible load', () => {
    expect(scenario.load.commissioningKw - scenario.load.flexibleKw).toBe(scenario.load.priorityKw)
    const safeEnergy = scenario.battery.capacityKwh
      * (scenario.battery.isolationSoc - scenario.battery.approvedReserveFloor)
    expect(oneDecimal(safeEnergy / scenario.load.priorityKw)).toBe(scenario.autonomy.acceptedHours)
    expect(scenario.autonomy.acceptedHours).toBeGreaterThan(scenario.autonomy.requiredHours)
    expect(scenario.load.priorityCircuits).toEqual(['clinic', 'communications', 'water'])
    expect(scenario.final.priorityCircuitsHolding).toBe(scenario.load.priorityCircuits.length)
  })
})
```

- [ ] **Step 2: Run the focused test and confirm the missing fixture fails**

Run: `npx vitest run tests/app/project-tanoa-showcase.test.ts`

Expected: FAIL because `docs/showcase/data/project-tanoa-scenario.json` does not exist.

- [ ] **Step 3: Create the deterministic scenario**

Create the JSON with these exact governing values:

```json
{
  "schema": "simplemark.project-tanoa.v1",
  "fictional": true,
  "geography": {
    "name": "Fulaga",
    "region": "Lau Group, Fiji",
    "osmRelation": 3521053,
    "osmUrl": "https://www.openstreetmap.org/relation/3521053",
    "attribution": "Map data © OpenStreetMap contributors · ODbL 1.0"
  },
  "clock": { "decisionMinutes": 14 },
  "battery": {
    "capacityKwh": 360,
    "isolationSoc": 0.84,
    "approvedReserveFloor": 0.42,
    "staleReserveFloor": 0.35
  },
  "load": {
    "commissioningKw": 13.5,
    "priorityKw": 11,
    "flexibleKw": 2.5,
    "priorityCircuits": ["clinic", "communications", "water"]
  },
  "autonomy": {
    "requiredHours": 13,
    "safeBeforeHours": 11.2,
    "falseControllerHours": 13.1,
    "acceptedHours": 13.7,
    "gapHours": 1.8
  },
  "final": {
    "frequencyHz": 50,
    "reservePct": 78,
    "priorityCircuitsHolding": 3
  }
}
```

Add `forecast` points only after calculating them from the same battery/load model. Each point must name its derivation; do not insert decorative time-series values that merely look plausible.

- [ ] **Step 4: Extend the test to reject contradictions and missing public caveats**

Add assertions for fractions between 0 and 1, positive loads, `reservePct > approvedReserveFloor * 100`, final frequency exactly `50`, and the document requirements that will be added in Task 2: the words `fictional design scenario`, the community-review caveat, all displayed governing values, exactly one of each recorder marker, and no case-insensitive `markmap`.

- [ ] **Step 5: Run the scenario test**

Run: `npx vitest run tests/app/project-tanoa-showcase.test.ts`

Expected: arithmetic tests PASS; document assertions FAIL because the report and map are not present yet.

- [ ] **Step 6: Commit the scenario unit**

```bash
git add docs/showcase/data/project-tanoa-scenario.json tests/app/project-tanoa-showcase.test.ts
git commit -m "docs: define the Project Tanoa scenario"
```

---

### Task 2: Author the sourced map and finished field report

**Files:**
- Create: `docs/showcase/assets/fulaga-map.svg`
- Create: `docs/showcase/project-tanoa.md`
- Modify: `tests/app/project-tanoa-showcase.test.ts`

**Interfaces:**
- Consumes every public number from Task 1.
- Produces invisible markers `<!-- simplemark-showcase:paste -->` and `<!-- simplemark-showcase:external-update -->`, exactly once and in that order.
- Produces an inline raw-SVG block in the report and a matching standalone source asset.

- [ ] **Step 1: Add the failing map and report source checks**

Assert all of the following in the Vitest contract:

```ts
expect(map).toContain('data-osm-relation="3521053"')
expect(map).toContain('Map data © OpenStreetMap contributors')
expect(map).toContain('https://www.openstreetmap.org/copyright')
expect(map).not.toMatch(/<image\b|data:image|<script\b|<foreignObject\b/i)
expect(report.match(/<!-- simplemark-showcase:paste -->/g)).toHaveLength(1)
expect(report.match(/<!-- simplemark-showcase:external-update -->/g)).toHaveLength(1)
expect(report.indexOf('simplemark-showcase:paste'))
  .toBeLessThan(report.indexOf('simplemark-showcase:external-update'))
for (const fence of ['mermaid', 'vega-lite', 'ansi', 'dot', 'json']) {
  expect(report).toContain('```' + fence)
}
expect(report).toContain('$$')
expect(report).toContain('fictional design scenario')
expect(report).toContain('community language review')
expect(report).not.toMatch(/markmap/i)
```

The test must also resolve every relative Markdown link and image path from `docs/showcase/`, while allowing `https:` links.

- [ ] **Step 2: Create the Lagoon Editorial map asset**

Use the polygon returned for OpenStreetMap relation `3521053` and its documented bounding box (`-19.1751410`, `-19.0981838`, `-178.6116407`, `-178.5357660`). Simplify only enough for an editorial SVG; retain the recognisable island/lagoon geometry and record the relation ID in the root element.

The SVG must use a `viewBox="0 0 1000 520"`, deep-ocean background, warm island linework, lagoon-teal water layers, a restrained coral forecast track, and text rendered as SVG text only when it is also readable as ordinary report prose. Include a visible lower-edge attribution line and source URL. No remote assets, fonts, raster images, or culturally decorative motifs.

- [ ] **Step 3: Write the opening and the human decision spine**

Author `docs/showcase/project-tanoa.md` so the first screen contains:

```md
# Holding the island through the storm
*Fulaga Community Energy Committee · Project Tanoa · Commissioning Watch*

> [!IMPORTANT]
> **14 minutes to the isolation decision.** This is a fictional 2032 design scenario, not a report of present conditions on Fulaga.
```

Explain `Tanoa` once as a shared vessel metaphor, state that `Fulaga` awaits community language review, and keep all source notes near the end. The narrative must remain understandable if every technical block is skipped.

- [ ] **Step 4: Place every renderer where it answers one story question**

Use this exact sequence and no renderer catalogue headings:

1. raw inline copy of the sourced map SVG;
2. T−72 protected-circuit checklist and baseline callout;
3. Mermaid energy flow with solar, battery, controller, priority bus, and flexible bus;
4. the paste marker;
5. T−24 Vega-Lite forecast and GFM telemetry table;
6. KaTeX calculation showing `360(0.84-0.42)/13.5 = 11.2 h`, the `13.0 h` requirement, and the `1.8 h` gap;
7. ANSI commissioning capture showing the false `13.1 h` pass at `reserve_floor=0.35` and the safe-model warning;
8. Graphviz fault path from forecast mismatch to stale controller profile;
9. a three-option committee decision table, with the accepted row preserving clinic, communications, and water;
10. JSON configuration whose final property is exactly `"reserve_floor": 0.42` so the recorder can select the old value from the end of the textarea;
11. the external-update marker;
12. final transition callout with `50.0 Hz`, `78%`, `3/3`, and `13.7 h` safe autonomy;
13. data dictionary, assumptions, fiction statement, map attribution, and research links.

- [ ] **Step 5: Check the exact data representations**

Extend the test to count every governing literal and distinguish intentional repeats. Parse the JSON fence, extract the KaTeX formula, and assert the terminal, table, final callout, and scenario agree. Fail if a second `reserve_floor` JSON property makes the recorder replacement ambiguous.

- [ ] **Step 6: Run document checks and inspect the source as plain Markdown**

Run: `npx vitest run tests/app/project-tanoa-showcase.test.ts`

Run: `git diff --check`

Expected: PASS. Then open the raw file in a plain text editor and a generic Markdown preview. The complete decision must remain legible without SimpleMark.

- [ ] **Step 7: Commit the finished document unit**

```bash
git add docs/showcase/project-tanoa.md docs/showcase/assets/fulaga-map.svg tests/app/project-tanoa-showcase.test.ts
git commit -m "docs: author the Project Tanoa field report"
```

---

### Task 3: Prove the exact document and contextual correction in the browser shell

**Files:**
- Create: `tests/ui/project-tanoa-showcase.spec.ts`

**Interfaces:**
- Opens the exact bytes of `docs/showcase/project-tanoa.md` through the existing browser file-port fixture.
- Proves raw SVG, Mermaid, Vega-Lite, KaTeX, ANSI, Graphviz, JSON, GFM table, callout, source edit, save, and untouched-byte fidelity.
- Supplies the recorder's browser preflight; it does not stand in for native watcher proof.

- [ ] **Step 1: Write the exact-file harness**

At module load, read `docs/showcase/project-tanoa.md`. Before `page.goto('/')`, install `showOpenFilePicker` with an OPFS-backed `project-tanoa.md` containing those exact bytes. Open it through the visible `Open file` button, then wait for the filename title `project-tanoa`.

- [ ] **Step 2: Write the failing renderer assertions**

Assert:

```ts
await expect(page.getByRole('heading', { name: 'Holding the island through the storm' })).toBeVisible()
await expect(page.locator('.diagram-error:visible')).toHaveCount(0)
await expect(page.locator('.diagram .diagram-render svg')).toHaveCount(4, { timeout: 30_000 })
await expect(page.locator('.math-block .katex')).toBeVisible()
await expect(page.locator('.ansi-card')).toContainText('reserve_floor')
await expect(page.locator('.json-card')).toContainText('0.42')
await expect(page.locator('.callout-important')).toContainText('14 minutes')
await expect(page.locator('.milkdown table')).toHaveCount(2)
```

Use renderer labels/text to identify the map, Mermaid, Vega-Lite, and DOT blocks; do not rely only on a total count if the document changes.

- [ ] **Step 3: Run the test and capture any honest product mismatch**

Run: `npx playwright test tests/ui/project-tanoa-showcase.spec.ts`

Expected: either PASS or a concrete document/renderer mismatch. Repair the document source. Do not add product behavior to make the showcase pass.

- [ ] **Step 4: Add untouched-byte and contextual-edit cases**

First case: click Save without editing, then read the OPFS file and expect byte-for-byte equality with the repository document.

Second case: prepare the recorder's middle section with the unique JSON `0.35`, open it, find the JSON diagram by its `json` label, click its own `Edit source` button, fill the source with the same JSON except `0.42`, close the sheet, wait for `.json-card` to show `0.42`, save, and assert the stored Markdown has the corrected value while the ANSI historical evidence still shows `0.35`.

- [ ] **Step 5: Add a recorder preflight mode**

Tag the visual proof tests `@tanoa-preflight` or isolate them in this file so the native recorder can run exactly:

`npx playwright test tests/ui/project-tanoa-showcase.spec.ts`

There must be no skipped renderer assertion and no screenshot comparison tied to one machine's font rasterisation.

- [ ] **Step 6: Run the full focused UI proof**

Run: `npx playwright test tests/ui/project-tanoa-showcase.spec.ts`

Expected: PASS with no renderer error card.

- [ ] **Step 7: Commit the browser proof**

```bash
git add tests/ui/project-tanoa-showcase.spec.ts
git commit -m "test: prove the Project Tanoa document"
```

---

### Task 4: Build the fail-loud native recording harness

**Files:**
- Create: `scripts/record-tanoa-showcase.mjs`
- Create: `tests/app/project-tanoa-recorder.test.ts`
- Modify: `package.json`

**Interfaces:**
- Adds `npm run showcase:tanoa` → `node scripts/record-tanoa-showcase.mjs`.
- Supports `--verify-content`, `--preflight`, and `--record`; default runs all three.
- Reads the final report and scenario, creates only `.artifacts/tanoa-showcase/working/project-tanoa.md`, and writes the final GIF only after all assertions pass.
- Accepts `SIMPLEMARK_TANOA_APP` to select an already-built `.app`; otherwise uses `src-tauri/target/release/bundle/macos/SimpleMark.app`.

- [ ] **Step 1: Write the failing recorder contract tests**

Spawn the CLI with `--verify-content` and assert success only when:

- both beat markers occur exactly once and in order;
- the opening contains the title, fiction label, map, and 14-minute clock;
- the paste contains Vega-Lite, KaTeX, ANSI, DOT, and the JSON field;
- the prepared paste changes exactly one marked JSON value from `0.42` to `0.35`;
- the final source remains `0.42` and contains the final external-update section;
- the scenario arithmetic still matches;
- no path points at the existing demo or its recorder.

Copy inputs into a temporary directory for negative cases: missing marker, duplicate `reserve_floor`, contradictory final metric, and accidental `page.evaluate`/browser-only recording mode must all exit nonzero with a specific message.

- [ ] **Step 2: Implement pure content preparation and verify-only mode**

The script must split on the two HTML comments, construct `opening`, `pasteBeforeCorrection`, and `finalDocument`, and expose no unmarked string replacement. `--verify-content` performs no launch, capture, or write outside a disposable test directory.

- [ ] **Step 3: Implement environmental preflight**

Before recording, require macOS, `osascript`, `screencapture`, `ffmpeg`, the selected `.app`, and the app binary at `Contents/MacOS/SimpleMark`. Run the focused Playwright proof from Task 3. Then use System Events to confirm Accessibility can see the SimpleMark process and use one disposable `screencapture` invocation to confirm Screen Recording permission produces a non-empty PNG.

If either permission is absent, exit with the exact System Settings pane and never write the final GIF.

- [ ] **Step 4: Launch the real native shell on the disposable opening note**

Create the working note with the opening section, then spawn:

```text
<SimpleMark.app>/Contents/MacOS/SimpleMark <absolute-working-note-path>
```

Use System Events to set the front window to position `{80, 80}` and size `{1000, 625}`. Recursively inspect the Accessibility tree until it contains `Holding the island through the storm` and `14 minutes`. Fail after a bounded timeout; never continue on a welcome note.

- [ ] **Step 5: Capture one continuous 102-frame sequence while driving accessible controls**

Capture the fixed window region with `screencapture -x -R80,80,1000,625` at six scheduled frames per second. The action timeline is:

| Frames | Time | Action |
|---:|---:|---|
| `0–11` | `0.0–2.0` | Hold opening title, map, and clock |
| `12–26` | `2.0–4.5` | Put `pasteBeforeCorrection` on the system clipboard and send real Command-V |
| `27–41` | `4.5–7.0` | Wait for accessible forecast and `11.2 h`; scroll once |
| `42–56` | `7.0–9.5` | Hold ANSI warning and DOT fault path |
| `57–77` | `9.5–13.0` | Press the visible JSON block's `Edit source` AX button, focus the source textarea, Command-Down, Option-Left to move before the closing brace, Option-Shift-Left to select the final `0.35`, type `0.42`, then press the accessible Close button |
| `78–101` | `13.0–17.0` | Atomically write the full final document, wait for `Changed on disk by another program`, invoke the same app binary with the same path to exercise the single-instance open request, then wait for `50.0 Hz`, `78%`, and `3/3` |

All waits occur against AX roles/names/text and the native status. Coordinate-only clicking is forbidden; the fixed window rectangle is for capture, not interaction. If an expected AX element is unavailable, stop and report the element rather than guessing a pixel.

- [ ] **Step 6: Make the external write genuinely atomic and watched**

Write the final bytes to a unique temporary file in the working note's directory, `fsync` the file, rename it over the working note, and `fsync` the directory. Do not call a Tauri command or touch the DOM. Require the native changed-on-disk status before reopening the path through the second app invocation.

- [ ] **Step 7: Encode only a complete sequence**

Require exactly 102 numbered PNGs. Encode through a generated palette with `palettegen=max_colors=96:stats_mode=diff` and `paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, loop forever, and write first to `.artifacts/tanoa-showcase/project-tanoa-showcase.gif`. Validate dimensions, frame count, duration, loop metadata, and byte size before copying to `docs/assets/project-tanoa-showcase.gif`.

- [ ] **Step 8: Run the recorder unit and content tests**

Run: `npx vitest run tests/app/project-tanoa-recorder.test.ts tests/app/project-tanoa-showcase.test.ts`

Run: `node --check scripts/record-tanoa-showcase.mjs`

Expected: PASS without requiring macOS permissions because only `--preflight` and `--record` touch the native environment.

- [ ] **Step 9: Commit the recorder before generating the binary artifact**

```bash
git add package.json scripts/record-tanoa-showcase.mjs tests/app/project-tanoa-recorder.test.ts
git commit -m "tooling: add the native Tanoa showcase recorder"
```

---

### Task 5: Record, inspect, and publish the 17-second film

**Files:**
- Create: `docs/assets/project-tanoa-showcase.gif`
- Modify only if verification reveals a scoped document or recorder defect.

**Interfaces:**
- Consumes the real release-mode macOS bundle, exact report, scenario, and recorder.
- Produces the only public motion artifact in this phase.

- [ ] **Step 1: Build and verify the native app**

Run: `npm run test:native`

Run: `npm run build:native`

Expected: both PASS; the `.app` exists at the path the recorder reports.

- [ ] **Step 2: Run preflight without recording**

Run: `node scripts/record-tanoa-showcase.mjs --preflight`

Expected: exact-document browser proof passes, native app and permissions are present, and no final GIF is written.

- [ ] **Step 3: Record the real sequence**

Run: `npm run showcase:tanoa`

Expected: the real app opens the disposable note, the source edit and external-change warning are visible, exactly 102 frames are captured, and the verified GIF is copied to `docs/assets/project-tanoa-showcase.gif`.

- [ ] **Step 4: Inspect representative frames at final display size**

Render frames `0`, `12`, `27`, `42`, `57`, `72`, `78`, `88`, and `101` as a disposable contact sheet. Check the title/map, paste, chart/math, terminal/graph, decision, source correction, changed-on-disk status, reopened final state, and closing hold. Inspect the GIF at README/website width. Remove the contact sheet after review.

- [ ] **Step 5: Verify GIF metadata and publication budget**

Use `ffprobe` and a small Node metadata check to assert:

- width `1000`, height `625`;
- 102 frames at 6 fps;
- duration `17.0 s` within one frame;
- loop enabled;
- file size `<= 5,242,880` bytes.

Also compare SHA-256 of the existing `scripts/record-demo.mjs` and `docs/assets/simplemark-demo.gif` against their pre-task values.

- [ ] **Step 6: Run proportionate repository verification**

Run:

```bash
npx vitest run tests/app/project-tanoa-showcase.test.ts tests/app/project-tanoa-recorder.test.ts
npx playwright test tests/ui/project-tanoa-showcase.spec.ts
node --check scripts/record-tanoa-showcase.mjs
git diff --check
```

If any `src/`, `src-tauri/`, or unrelated test surface changed during repair, also run `bash scripts/simplemark_ci.sh`; otherwise do not broaden the patch.

- [ ] **Step 7: Record the cultural-review publication gate**

The repository artifact may be complete while public release remains gated. Add the reviewer/date/result only after a real Fijian-language or Fulaga community review. Until then, label the artifact `internal preview — community language review pending` wherever it is published.

- [ ] **Step 8: Commit the verified GIF**

```bash
git add docs/assets/project-tanoa-showcase.gif
git commit -m "docs: add the Project Tanoa showcase film"
```

---

## Final Acceptance

- [ ] The report tells one chronological community decision without requiring technical fluency.
- [ ] All fictional values are mathematically consistent with the checked scenario.
- [ ] The exact report renders without an error card in the current browser and native shells.
- [ ] Untouched save preserves the exact Markdown bytes.
- [ ] The JSON correction is contextual, visible, and persists as `0.42`.
- [ ] The final native beat includes a real watched external write and honest explicit reopen.
- [ ] The GIF is one continuous latest-UI capture, 1000×625, 17 seconds, 6 fps, looping, and at or below 5 MB.
- [ ] Existing demo assets remain unchanged.
- [ ] Public use remains labelled pending community language review until that review actually occurs.
