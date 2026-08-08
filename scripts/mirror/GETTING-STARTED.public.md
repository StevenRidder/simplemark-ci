# Getting started

SimpleMark is a TypeScript application with a browser composition and a native macOS shell. This guide gets a fresh checkout running.

## Requirements

- Node.js 20 or newer (CI uses Node 22)
- npm
- Rust and the macOS toolchain for native-shell work

## Install and run

```bash
npm install
npm run dev
```

Open the local Vite URL printed by the dev server. The browser composition is the fastest way to inspect the rendered document and renderer changes.

For the native shell:

```bash
npm run dev:native
```

## Validate a change

```bash
npm test
npm run test:ui
npm run typecheck
npm run check:boundaries
git diff --check
```

The UI suite starts the real composition and exercises the document surface in Chromium. Keep renderer failures visible and preserve the Markdown fallback when adding a format.

## Explore the showcase

- [Welcome to SimpleMark](showcase/welcome-to-simplemark.md) is a compact tour of the rendered formats.
- [Project Tanoa: Storm Atlas](showcase/project-tanoa-storm-atlas.md) is the full visual showcase with maps, charts, math, diagrams, terminal evidence, and live source editing.

The repository also contains [the renderer catalog](RENDERERS.md), which documents supported fences, inline formats, and portable fallbacks.

## Where to look

```text
src/domain       format recognition and document rules
src/application  document use cases and ports
src/adapters     browser, native, editor, and renderer integrations
tests            unit, round-trip, and browser coverage
src-tauri        native transport and packaging boundary
```

Keep changes small, run the relevant tests, and leave the source Markdown readable in an ordinary editor.
