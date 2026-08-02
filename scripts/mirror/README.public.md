# SimpleMark

**The beautiful living document for AI work.**

Your agent writes the Markdown. SimpleMark turns it into a document: open the local `.md` file,
see it rendered exceptionally, keep reading while the agent updates it, and click in only for a
small correction.

**Always rendered. Always your file.** No IDE, vault, account, provider setup, workspace, or
permanent Markdown source view.

![Current SimpleMark renderer prototype showing Markdown, Mermaid and SVG rendered in one document canvas](docs/assets/simplemark-demo.gif)

*Current pre-alpha renderer and correction proof, recorded from the running app in one unbroken
session. The canonical watched-file product demo is specified in [`docs/PRODUCT.md`](docs/PRODUCT.md).*

In practice: Codex, Claude, or another tool writes `plan.md`; SimpleMark shows that exact file as a
beautiful technical document and refreshes it cleanly as the file changes. Mermaid, SVG, math,
tables, code, and technical material render inline. The source stays portable and yours.

SimpleMark is not an AI workspace or a cockpit for operating agents. Editing is a contextual escape
hatch. Agent participation and collaboration are optional later capabilities, hidden until invoked.

## The commitments

1. **Files are the truth.** Every feature round-trips to Markdown. Untouched blocks re-emit their original bytes — only blocks you actually edit are re-serialized.
2. **Rendered is the default.** Markdown punctuation is storage syntax, not the interface. Source appears only for the content you deliberately correct.
3. **External updates are ordinary.** An agent can change the same file while SimpleMark remains a calm, current reading surface.
4. **Typography is product behavior.** The page must feel like a document worth keeping open, not an IDE preview.

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

- [`docs/PRODUCT.md`](docs/PRODUCT.md) — the product contract, category difference, and sequencing
- [`docs/DESIGN.md`](docs/DESIGN.md) — the product design, including the paste-recognition chain
- [`docs/TECH-SPEC.md`](docs/TECH-SPEC.md) — the technical specification
- [`docs/RENDERERS.md`](docs/RENDERERS.md) — the renderer taxonomy and how new ones are added
- [`docs/COLLABORATION.md`](docs/COLLABORATION.md) — the live-session model
- [`docs/MCP-SERVER.md`](docs/MCP-SERVER.md) — the agent participant surface
- [`docs/decisions/`](docs/decisions/) — architecture decision records
- [`docs/wireframe.html`](docs/wireframe.html) — the UI reference

## Status

Pre-alpha. The editor canvas, paste-recognition chain, Mermaid and SVG rendering, byte-fidelity
round-tripping, and reader controls work. Opening arbitrary files from disk, persistence, calm
external-change refresh, and the renderer-first product proof are not complete yet.

## Licence

Copyright © 6th Element Labs. All rights reserved.

This source is published for reading and evaluation. It is not licensed for redistribution or derivative works. See [`LICENSE`](LICENSE).
