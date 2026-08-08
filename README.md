# SimpleMark

**The beautiful living document for AI work.**

Your agent writes the Markdown. SimpleMark turns it into a document: open any local `.md` file,
see it rendered exceptionally, keep reading while the agent updates it, and click in only when you
want to make a small correction. No IDE, vault, account, provider setup, workspace, or permanent
Markdown source view.

**The core promise:** always rendered, always your file. Mermaid, SVG, math, charts, tables, code,
and technical material live inline on one calm page. Untouched source is preserved byte for byte.

![Current SimpleMark renderer prototype showing Markdown, Mermaid and SVG rendered in one document canvas](docs/assets/simplemark-demo.gif)

*Current pre-alpha renderer and correction proof, recorded from the running app in one unbroken
session. It is not the canonical product demo; that watched-file demo is specified in
[`docs/PRODUCT.md`](docs/PRODUCT.md). Regenerate with `npm run demo` while `npm run dev` is up.*

In practice: Codex, Claude, or another tool writes `plan.md`; SimpleMark opens that exact file as a
beautiful technical document and refreshes it cleanly as the file changes. Raw Mermaid, a raw
`<svg>`, DOT, LaTeX, Vega-Lite, tables, code, charts, and ANSI captures render natively. The source
stays portable and yours.

SimpleMark is not an AI workspace or a cockpit for operating agents. Editing is a contextual escape
hatch. In-app agent participation and collaboration are optional later capabilities, and they must
remain invisible until explicitly invoked.

## Status

**Pre-alpha, and now a real desktop app.** The native macOS shell opens files and folders from
disk, watches them, and re-renders calmly when another process rewrites the file. Byte-fidelity
round-tripping, the full renderer set, portable document commands, and reader controls all work.
Cross-platform test builds and the release-trust gate are in review.

Not done: the renderer-first product proof end to end, the one-real-day dogfood that picks the
default workflow, and the multi-client authority decision.

## What works today

### The document canvas

- **One continuous rendered page.** No source/preview split, no permanent Markdown view. Source
  appears only for the block being corrected.
- **Byte fidelity.** An untouched save is byte-identical. Editing one block leaves every other
  block's bytes alone — no renumbered lists, no repadded tables, no restyled fences — because
  untouched blocks are re-emitted from the file rather than re-serialized. When a block is added,
  removed or split, block identity no longer holds and the document is written whole rather than
  guessed at. Enforced by a source map
  and a byte-diff suite over hostile real-world fixtures.
- **Typography as product behavior.** Bear-style font, size, line height, and theme in preferences.

### Renderers

Mermaid diagrams · raw `<svg>` · KaTeX math (with proven malformed-math fallback) · Graphviz/DOT ·
Vega-Lite charts from inline data *or* note-relative data files · ANSI terminal captures ·
syntax-highlighted code via lowlight · text cards · a composite renderer that combines them.

Large Markdown tables render under a budget with deferral, so a huge table stays responsive instead
of freezing the page. Diagrams size to their column and their detail sheet closes itself.

### Paste

A recognition ladder classifies pasted content — formal Markdown, callouts, and a set of exhaust
sniffers for terminal/log/tool output — and renders it correctly without the user choosing a mode.
The sniffers are deliberately bounded so they cannot swallow a whole Markdown document.

### Files and workspace

- Open any `.md` file directly — no import, no vault, no workspace choice.
- Folder and note browsing with collections, pins, and selection state.
- Native draft save and rename; **Show in Finder** for notes and folders.
- Note-relative asset and document-link resolution, so images and cross-links work from the file's
  own location.
- External-change watching (`watch_note`) with a superseding operation queue, so a burst of agent
  writes collapses to one calm re-render.

### Reader

Whole-page pinch zoom, expanded reader zoom, remembered view and app state, window geometry, a find
bar, and temporary reader navigation.

### Portable document commands

Clipboard exports in portable formats and structural corrections that survive the round trip, both
reachable from a right-click. Native macOS menus, menu services, and context menu are preserved
rather than replaced.

### Desktop and release

Tauri-based native shell (`src-tauri/`) with its own file, catalog, chart-data, and document-link
ports behind the same application interfaces the browser shell uses. Cross-platform test builds,
build provenance that follows `HEAD`, an executable release-trust gate, and update notification.

## The hierarchy

```
First:   read and judge a beautiful document while an external agent updates the file
Then:    make a small correction without living in Markdown source
Later:   invite an agent or another human only if the simpler workflow proves insufficient
```

The filesystem is the first agent integration. Any agent can write the file; SimpleMark watches it.
Inside the app, one `DocumentSession` protects the open document and materializes atomic saves:

```
External agent ─→ .md in your folder ─→ watched import ─┐
                                                        ├─→ rendered document
Small human correction ─────────────→ DocumentSession ──┘
```

Later, an MCP-connected agent may submit scoped transactions to that same authority. Multi-client
collaboration remains a separate evidence-gated decision. Neither belongs in the first install
reason or the default interface.

## Architecture

Dependencies point one way only:

```
app → adapters → application → domain
```

`domain` imports nothing inward and knows nothing about ProseMirror, Mermaid, or the DOM.
`application` defines ports; `adapters` implement them — which is why the browser shell and the
Tauri shell are two adapter sets over one application core, not two apps. The rule is enforced
mechanically:

```bash
npm run check:boundaries
```

```
src/
  domain/       source maps, byte diff, paste recognition, render budgets, clipboard formats
  application/  DocumentSession, ports, commands
  adapters/     editor (Milkdown), renderers, filesystem (browser + Tauri), clipboard, MCP
  app/          browser.ts and tauri.ts shells, UI, preferences, provenance
src-tauri/      the native macOS shell
tests/          unit, round-trip, and Playwright suites over the real composition
```

## Run it

```bash
npm install
npm run dev          # browser shell
npm run dev:native   # Tauri desktop shell
```

```bash
npm test             # unit and round-trip suites
npm run test:ui      # Playwright, against the real composition
npm run typecheck
npm run check:boundaries
npm run demo         # re-record the demo GIF (needs a running dev server)
```

The canonical local gate is `scripts/simplemark_ci.sh`. Landing is owned by GitHub's native merge
queue behind the `gate` check.

## The bet

Most Markdown products assume a human writes Markdown and AI assists inside an editor or workspace.
SimpleMark assumes AI composes and the human consumes, judges, and occasionally directs.

SimpleMark keeps files as the truth but treats the editor as a real document canvas. Diagrams, SVG,
math, tables, and highlighted code render in place. Source appears only for the exact content being
corrected, and everything still saves as portable Markdown.

| Decision | Choice |
|---|---|
| Editor core | Milkdown over ProseMirror with a source-preserving bridge |
| POC coordination | One in-process `DocumentSession`; human edits and watched external changes share application use cases |
| Later collaboration | ProseMirror step authority first; Yjs only if masterless operation is required |
| Durability | Plain `.md` files in a folder; SQLite is a rebuildable cache |
| Fidelity | Untouched blocks are preserved byte-for-byte; only blocks whose meaning changed re-serialize |
| Sync | Delegated to iCloud Drive / any synced folder — no server, no accounts |
| Canvas | Single unified view, no source/preview split |
| Typography | Bear-style: font, size, line height, theme in preferences |
| Extensibility | Internal extension points in v1, shaped to become the public plugin API |
| Desktop shell | Tauri, as an adapter set — not a fork of the app |

## Roadmap

The board sequences this as *see it → use it → refine it → ship it → then decide expansion*.

| # | Milestone | State |
|---|---|---|
| 1 | **See SimpleMark** — wireframe-backed editor and Markdown trust | Done |
| 2 | **Use SimpleMark** — one local note and Mermaid | Done |
| 3 | **Refine SimpleMark** — portable document commands | In review |
| 4 | **Ship SimpleMark** — cross-platform test builds and releases | In review |

Next, in order:

- **Turn AI work into living local documents** — the renderer-first product proof: an agent writes,
  SimpleMark stays a calm current reading surface, and the source stays trustworthy.
- **Use SimpleMark for one real day and choose the default** — dogfood decides the default
  workflow rather than a design argument.
- **Choose multi-client authority from evidence** — ProseMirror steps vs Yjs, decided by what the
  single-client product actually needs. Deliberately last.

Collaboration, in-app agent participation, comments, and history stay behind that gate. The product
must be worth installing with all of them removed —
[`ADR-0005`](docs/decisions/0005-rendered-document-before-agent-participation.md) records the
sequencing correction.

## Documents

- [`docs/PRODUCT.md`](docs/PRODUCT.md) — **the product authority** — user, job, category difference, UI rules, sequencing, demo, and language
- [`docs/DESIGN.md`](docs/DESIGN.md) — **start here** — the notebook: architecture, fidelity contract, paste rules, wireframe
- [`docs/decisions/`](docs/decisions/) — accepted architecture decisions and supersession record
- [`docs/POC.md`](docs/POC.md) — **the next executable target** — open, render, watch, correct, and preserve one AI-generated local file
- [`docs/COLLABORATION.md`](docs/COLLABORATION.md) — optional expansion after the reader product proves itself
- [`docs/SWITCHBOARD-KERNEL.md`](docs/SWITCHBOARD-KERNEL.md) — the four patterns borrowed from Switchboard, and the four deliberately not
- [`docs/TECH-SPEC.md`](docs/TECH-SPEC.md) — universal paste: recognition ladder, renderer catalog, sandbox
- [`docs/RENDERERS.md`](docs/RENDERERS.md) — renderers vs embedded editors, and the v1 set
- [`docs/MCP-SERVER.md`](docs/MCP-SERVER.md) — the agent contract: one tool surface for notes whether or not they are open
- [`docs/RELEASE-CONTRACT.md`](docs/RELEASE-CONTRACT.md) — what any build-and-release workflow must do
- [`docs/RELEASE-TRUST.md`](docs/RELEASE-TRUST.md) — the executable release-trust gate
- [`docs/LESSONS-LEARNED-MARKDOWN-EDITOR-AUDIT.md`](docs/LESSONS-LEARNED-MARKDOWN-EDITOR-AUDIT.md) — code-level competitor audit: mechanisms to borrow, traps to reject, licenses, tests, and community evidence
- [`docs/AGENT-WORKSPACE.md`](docs/AGENT-WORKSPACE.md) — MCP safety posture and build rationale; its tool surface is superseded above
- [`docs/wireframe.html`](docs/wireframe.html) — interactive editor, agent, redirect/chat, and stop states (open in a browser)
- [`docs/superpowers/plans/`](docs/superpowers/plans/) — the Phase 0–1 implementation plan
- [`AGENTS.md`](AGENTS.md) — **contributors and agents start here** — boundaries, board, and the validation gate
- [`docs/CI-SANDBOX.md`](docs/CI-SANDBOX.md) — private canonical repo, public CI sandbox, and the branch loop
