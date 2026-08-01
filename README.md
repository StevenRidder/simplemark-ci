# SimpleMark

A lightweight, beautiful, local-first Markdown notebook that turns raw technical material into editable documents — and lets humans and AI agents join you live when you want them.

**The core promise:** paste common technical source or a document attachment, and SimpleMark makes it immediately useful — render it natively, preview it safely, or show it with the best available local viewer — **without losing the original.**

In practice: raw Mermaid, a raw `<svg>`, DOT, LaTeX, a chart spec, code, an ANSI capture all render natively, with no fence and no mode switch. A `.pptx` or `.pdf` previews as pages, with the file intact as an attachment. The Markdown on disk stays portable and yours.

**Collaboration is optional and live.** Alone it is calm and fast, like Bear. Click *Collaborate* and someone joins this note. Click *Invite agent* and one works alongside you — visible, interruptible, redirectable. Live chat and anchored notes steer the work; explicit Stop and Redirect controls govern an agent run. Close the session and you have ordinary Markdown plus attachments in your folder.

**No active session means no service, no cost, no overhead.** SimpleMark is a notebook that becomes multiplayer, not a workspace you have to enter.

## Status

Design stage. No code yet.

- [`docs/DESIGN.md`](docs/DESIGN.md) — **start here** — the notebook: architecture, fidelity contract, paste rules, wireframe
- [`docs/decisions/`](docs/decisions/) — accepted architecture decisions and supersession record
- [`docs/POC.md`](docs/POC.md) — **the next executable target** — one local note, Mermaid, and one interruptible live agent
- [`docs/COLLABORATION.md`](docs/COLLABORATION.md) — local human-agent transactions first; the later multi-client authority decision and its gates
- [`docs/SWITCHBOARD-KERNEL.md`](docs/SWITCHBOARD-KERNEL.md) — the four patterns borrowed from Switchboard, and the four deliberately not
- [`docs/TECH-SPEC.md`](docs/TECH-SPEC.md) — universal paste: recognition ladder, renderer catalog, sandbox
- [`docs/RENDERERS.md`](docs/RENDERERS.md) — renderers vs embedded editors, and the v1 set
- [`docs/AGENT-WORKSPACE.md`](docs/AGENT-WORKSPACE.md) — MCP co-editing: you and an agent in one folder
- [`docs/wireframe.html`](docs/wireframe.html) — interactive editor, agent, redirect/chat, and stop states (open in a browser)
- [`docs/superpowers/plans/`](docs/superpowers/plans/) — the Phase 0–1 implementation plan
- [`AGENTS.md`](AGENTS.md) — **contributors and agents start here** — boundaries, board, and the validation gate
- [`docs/CI-SANDBOX.md`](docs/CI-SANDBOX.md) — private canonical repo, public CI sandbox, and the branch loop

## The hierarchy

```
SimpleMark first:     write, read, paste, render, think
Collaboration second: invite a human or an agent into this exact
                      document, when it is useful
```

The first local human-agent session does not need a CRDT. Both participants submit transactions to
one in-process `DocumentSession`; files remain the durable artifact:

```
   You ──────┐
             ├─→  DocumentSession  ─→  atomic save  ─→  .md in your folder
   Agent ────┘    coordination                         durability
```

You plus local agents never leave the machine. A later multi-client authority spike compares
ProseMirror steps with a single authority against a structured CRDT. Yjs is considered only if
truly masterless operation is a demonstrated requirement.

## The bet

Every existing open-source notes app — Obsidian, Zettlr, Logseq, Joplin — made the same bet: files on disk are the truth and the editor is a viewer over text. That is why none of them render arbitrary rich blocks inline on one canvas.

SimpleMark keeps files as the truth but treats the editor as a real document canvas, so a plugin can own a rectangle of the page. Diagrams, SVG, highlighted code, and later handwriting all render in place, and everything still serializes back to portable Markdown.

| Decision | Choice |
|---|---|
| Editor core | Milkdown or raw ProseMirror with a source-preserving bridge — **gated on Phase 0** |
| POC coordination | One in-process application `DocumentSession`; editor and MCP share use cases |
| Later collaboration | ProseMirror step authority first; Yjs only if masterless operation is required |
| Durability | Plain `.md` files in a folder; SQLite is a rebuildable cache |
| Fidelity | Untouched blocks are preserved byte-for-byte; only edited blocks re-serialize |
| Sync | Delegated to iCloud Drive / any synced folder — no server, no accounts |
| Canvas | Single unified view, no source/preview split |
| Typography | Bear-style: font, size, line height, theme in preferences |
| Extensibility | Internal extension points in v1, shaped to become the public plugin API |
| License | Apache-2.0 or MIT — permissive, so a hosted or proprietary layer stays possible |

## First task — the fidelity gate, then the POC

**Phase 0 — fidelity.** Open a hostile real-world document, save it without editing, and diff. Then edit one block and diff everything else. Untouched content must never be rewritten — no renumbered lists, no repadded tables, no restyled fences. No off-the-shelf Markdown editor does this, because serializers normalize. Ten acceptance fixtures are in [`docs/DESIGN.md` §12](docs/DESIGN.md).

The fidelity work is visible, not a headless detour. The approved wireframe is extracted into the
real reusable UI and hosts the candidate editor against safe fixtures. After the gate passes, that
same frontend opens a real file through a browser development adapter; Tauri then replaces only
the browser file/window ports. The editor, document session, Mermaid renderer, toolbar, styles, and
components are product code from their first visible run.

Days, not weeks. Nothing else starts until it resolves.

If it passes, build only [`docs/POC.md`](docs/POC.md): one local Markdown file, one macOS
window, Mermaid, and one agent participating in the same local document session. Remote peers,
iCloud live sync, broad MCP access, multi-agent governance, renderer acquisition, and binary
converters—and Yjs itself—are deliberately not part of that proof.

The POC decides the next investment. A later notebook release can be a real ship on its own;
collaboration expands only after the POC is useful in real work.
