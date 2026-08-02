# SimpleMark

A lightweight, local-first Markdown notebook that turns raw technical material into editable documents — and lets humans and AI agents join you live when you want them.

**The core promise:** paste common technical source, and SimpleMark makes it immediately useful — render it natively, preview it safely, or show it with the best available local viewer — **without losing the original.**

![Typing in SimpleMark, then pasting Markdown, Mermaid and raw SVG — each recognised and rendered on paste, with the diagram source edited live](docs/assets/simplemark-demo.gif)

*Recorded from the running app in one unbroken session — no cuts.*

In practice: raw Mermaid, a raw `<svg>`, DOT, LaTeX, a chart spec, code, an ANSI capture all render natively, with no fence and no mode switch. The Markdown on disk stays portable and yours.

**Collaboration is optional and live.** Alone it is calm and fast. Invite someone and they join this note; invite an agent and it works alongside you — visible, interruptible, redirectable. Close the session and you have ordinary Markdown plus attachments in your folder.

**No active session means no service, no cost, no overhead.** SimpleMark is a notebook that becomes multiplayer, not a workspace you have to enter.

## The three commitments

1. **Files are the truth.** Every feature round-trips to Markdown. Untouched blocks re-emit their original bytes — only blocks you actually edit are re-serialized.
2. **Sync is your cloud drive.** iCloud, Dropbox, whatever you already use. No relay, no accounts, no hosting.
3. **Typography is document-level.** Reader controls (typeface, size, background) style the document you are reading; they are not per-selection formatting Markdown cannot express.

## Run it

```bash
npm install
npm run dev
```

Then open the printed URL. The browser shell opens an in-memory fixture note, so nothing on disk can be damaged while the file-opening path is still being built.

```bash
npm test            # unit and round-trip suites
npm run test:ui     # Playwright, against the real composition
npm run demo        # re-record the demo GIF (needs a running dev server)
```

## Architecture

Dependencies point one way only:

```
app → adapters → application → domain
```

`domain` imports nothing inward and knows nothing about ProseMirror, Mermaid, or the DOM. `application` defines ports; `adapters` implement them. The rule is enforced mechanically by dependency-cruiser:

```bash
npm run check:boundaries
```

## Documents

- [`docs/DESIGN.md`](docs/DESIGN.md) — the product design, including the paste-recognition chain
- [`docs/TECH-SPEC.md`](docs/TECH-SPEC.md) — the technical specification
- [`docs/RENDERERS.md`](docs/RENDERERS.md) — the renderer taxonomy and how new ones are added
- [`docs/COLLABORATION.md`](docs/COLLABORATION.md) — the live-session model
- [`docs/MCP-SERVER.md`](docs/MCP-SERVER.md) — the agent participant surface
- [`docs/decisions/`](docs/decisions/) — architecture decision records
- [`docs/wireframe.html`](docs/wireframe.html) — the UI reference

## Status

Pre-alpha. The editor, the paste-recognition chain, Mermaid and SVG rendering, byte-fidelity round-tripping, and the reader controls work. Opening arbitrary files from disk, persistence, search, and the live-agent session do not yet.

## Licence

Copyright © 6th Element Labs. All rights reserved.

This source is published for reading and evaluation. It is not licensed for redistribution or derivative works. See [`LICENSE`](LICENSE).
