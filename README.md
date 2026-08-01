# SimpleMark

A lightweight, beautiful, local-first Markdown notebook that turns raw technical material into editable documents — and lets humans and AI agents join you live when you want them.

**The core promise:** paste common technical source or a document attachment, and SimpleMark makes it immediately useful — render it natively, preview it safely, or show it with the best available local viewer — **without losing the original.**

In practice: raw Mermaid, a raw `<svg>`, DOT, LaTeX, a chart spec, code, an ANSI capture all render natively, with no fence and no mode switch. A `.pptx` or `.pdf` previews as pages, with the file intact as an attachment. The Markdown on disk stays portable and yours.

**Collaboration is optional and live.** Alone it is calm and fast, like Bear. Click *Collaborate* and someone joins this note. Click *Invite agent* and one works alongside you — visible, interruptible, redirectable. Close the session and you have ordinary Markdown plus attachments in your folder.

**No active session means no service, no cost, no overhead.** SimpleMark is a notebook that becomes multiplayer, not a workspace you have to enter.

## Status

Design stage. No code yet.

- [`docs/DESIGN.md`](docs/DESIGN.md) — **start here** — the notebook: architecture, fidelity contract, paste rules, wireframe
- [`docs/COLLABORATION.md`](docs/COLLABORATION.md) — the optional live session: CRDT room, focus-aware agent rules, the day-of-use experiment
- [`docs/SWITCHBOARD-KERNEL.md`](docs/SWITCHBOARD-KERNEL.md) — the four patterns borrowed from Switchboard, and the four deliberately not
- [`docs/TECH-SPEC.md`](docs/TECH-SPEC.md) — universal paste: recognition ladder, renderer catalog, sandbox
- [`docs/RENDERERS.md`](docs/RENDERERS.md) — renderers vs embedded editors, and the v1 set
- [`docs/AGENT-WORKSPACE.md`](docs/AGENT-WORKSPACE.md) — MCP co-editing: you and an agent in one folder
- [`docs/wireframe.html`](docs/wireframe.html) — interactive interface wireframe (open in a browser)
- [`docs/superpowers/plans/`](docs/superpowers/plans/) — the Phase 0–1 implementation plan

## The hierarchy

```
SimpleMark first:     write, read, paste, render, think
Collaboration second: invite a human or an agent into this exact
                      document, when it is useful
```

When a session *is* running, a CRDT coordinates it — a file watcher has no presence, no cursors, no interruption channel, and cannot merge two edits to one paragraph. Files remain the durable artifact:

```
   You ──────┐
             ├─→  Yjs session  ─→  debounced save  ─→  .md in your folder
   Agent ────┘   coordination                          durability
```

You plus local agents never leave the machine. A LAN peer connects directly. Only a remote human or a sleeping device needs a relay — tiny, self-hostable, zero-knowledge, and **optional**.

## The bet

Every existing open-source notes app — Obsidian, Zettlr, Logseq, Joplin — made the same bet: files on disk are the truth and the editor is a viewer over text. That is why none of them render arbitrary rich blocks inline on one canvas.

SimpleMark keeps files as the truth but treats the editor as a real document canvas, so a plugin can own a rectangle of the page. Diagrams, SVG, highlighted code, and later handwriting all render in place, and everything still serializes back to portable Markdown.

| Decision | Choice |
|---|---|
| Editor core | Milkdown / ProseMirror + Yjs — **gated on the spikes below** |
| Coordination | Yjs CRDT while a document is live; localhost transport |
| Durability | Plain `.md` files in a folder; SQLite is a rebuildable cache |
| Fidelity | Untouched blocks are preserved byte-for-byte; only edited blocks re-serialize |
| Sync | Delegated to iCloud Drive / any synced folder — no server, no accounts |
| Canvas | Single unified view, no source/preview split |
| Typography | Bear-style: font, size, line height, theme in preferences |
| Extensibility | Internal extension points in v1, shaped to become the public plugin API |
| License | Apache-2.0 or MIT — permissive, so a hosted or proprietary layer stays possible |

## First task — the fidelity gate

**Phase 0 — fidelity.** Open a hostile real-world document, save it without editing, and diff. Then edit one block and diff everything else. Untouched content must never be rewritten — no renumbered lists, no repadded tables, no restyled fences. No off-the-shelf Markdown editor does this, because serializers normalize. Ten acceptance fixtures are in [`docs/DESIGN.md` §12](docs/DESIGN.md).

Days, not weeks. Nothing else starts until it resolves.

**Phase 3 is a real ship:** a beautiful local Markdown notebook that renders anything you paste. Everything after it — live sessions, agents in the room — is built on a thing that already works alone.
