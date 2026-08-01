# SimpleMark

A living, local-first workspace where you and AI agents think together in one document — and the output stays yours as portable Markdown files.

**The defining behavior:** you type in a note while an agent adds a diagram beside the paragraph it's explaining. Both cursors are visible. You interrupt it mid-table and it changes course. `Cmd+Z` undoes your sentence, not its diagram. You close the app and the file on disk is clean Markdown that opens correctly in Bear.

**And it renders anything.** Paste raw Mermaid, a raw `<svg>`, a `.pptx`, a chart spec, an ANSI capture — no fence, no mode switch, no plugin install. It works out what the thing is and shows it.

## Status

Design stage. No code yet.

- [`docs/COLLABORATION.md`](docs/COLLABORATION.md) — **start here** — the live CRDT session, agents as participants, the three document layers
- [`docs/DESIGN.md`](docs/DESIGN.md) — product architecture, fidelity contract, paste rules, wireframe
- [`docs/TECH-SPEC.md`](docs/TECH-SPEC.md) — universal paste: recognition ladder, renderer catalog, sandbox
- [`docs/RENDERERS.md`](docs/RENDERERS.md) — renderers vs embedded editors, and the v1 set
- [`docs/AGENT-WORKSPACE.md`](docs/AGENT-WORKSPACE.md) — MCP co-editing: you and an agent in one folder
- [`docs/wireframe.html`](docs/wireframe.html) — interactive interface wireframe (open in a browser)
- [`docs/superpowers/plans/`](docs/superpowers/plans/) — the Phase 0–1 implementation plan

## Two truths, two jobs

A live document needs a CRDT — a file watcher has no presence, no cursors, no interruption channel, and cannot merge two edits to one paragraph. A durable document needs to be a file you own. So:

```
   You ──────┐
             ├─→  Yjs session (localhost)  ─→  debounced save  ─→  .md in iCloud Drive
   Agent ────┘         coordination truth                            durability truth
```

While a note is open, the session coordinates. The moment it closes, the folder is sufficient on its own — which is the property lock-in actually depends on.

**v1 is two participants on one machine:** you and an agent, over localhost. No relay, no WebRTC, no rendezvous service. Second devices and multi-human come later, and everything built for a local peer works unchanged for a remote one.

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

## First tasks — two go/no-go spikes

**Phase 0 — collaboration.** Two app windows plus one simulated agent edit the same document. Concurrent inserts merge, cursors show, per-client undo is correct, a client disconnects and reconnects cleanly. If this doesn't work, nothing else matters.

**Phase 0b — fidelity.** Open a hostile real-world document, save it without editing, and diff. Then edit one block and diff everything else. Untouched content must never be rewritten — no renumbered lists, no repadded tables, no restyled fences. No off-the-shelf Markdown editor does this, because serializers normalize. Ten acceptance fixtures are in [`docs/DESIGN.md` §12](docs/DESIGN.md).

Both are days, not weeks. Nothing else starts until they resolve.
