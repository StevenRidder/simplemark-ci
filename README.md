# SimpleMark

**The beautiful living document for AI work.**

Your agent writes the Markdown. SimpleMark turns it into a document: open any local `.md` file,
see it rendered exceptionally, keep reading while the agent updates it, and click in only when you
want to make a small correction. No IDE, vault, account, provider setup, workspace, or permanent
Markdown source view.

**The core promise:** always rendered, always your file. Mermaid, SVG, math, tables, code, and
technical material live inline on one calm page. Untouched source is preserved byte for byte.

![Current SimpleMark renderer prototype showing Markdown, Mermaid and SVG rendered in one document canvas](docs/assets/simplemark-demo.gif)

*Current pre-alpha renderer and correction proof, recorded from the running app in one unbroken
session. It is not the canonical product demo; that watched-file demo is specified in
[`docs/PRODUCT.md`](docs/PRODUCT.md). Regenerate with `npm run demo` while `npm run dev` is up.*

In practice: Codex, Claude, or another tool writes `plan.md`; SimpleMark opens that exact file as a
beautiful technical document and refreshes it cleanly as the file changes. Raw Mermaid, a raw
`<svg>`, DOT, LaTeX, tables, code, charts, and ANSI captures render natively. The source stays
portable and yours.

SimpleMark is not an AI workspace or a cockpit for operating agents. Editing is a contextual escape
hatch. In-app agent participation and collaboration are optional later capabilities, and they must
remain invisible until explicitly invoked.

## Status

Pre-alpha. The editor canvas, paste recognition, Mermaid and SVG rendering, byte-fidelity
round-tripping, and reader controls work. Opening arbitrary files from disk, persistence, calm
external-change refresh, and the renderer-first product proof are not complete yet.

- [`docs/PRODUCT.md`](docs/PRODUCT.md) — **the product authority** — user, job, category difference, UI rules, sequencing, demo, and language
- [`docs/DESIGN.md`](docs/DESIGN.md) — **start here** — the notebook: architecture, fidelity contract, paste rules, wireframe
- [`docs/decisions/`](docs/decisions/) — accepted architecture decisions and supersession record
- [`docs/POC.md`](docs/POC.md) — **the next executable target** — open, render, watch, correct, and preserve one AI-generated local file
- [`docs/COLLABORATION.md`](docs/COLLABORATION.md) — optional expansion after the reader product proves itself
- [`docs/SWITCHBOARD-KERNEL.md`](docs/SWITCHBOARD-KERNEL.md) — the four patterns borrowed from Switchboard, and the four deliberately not
- [`docs/TECH-SPEC.md`](docs/TECH-SPEC.md) — universal paste: recognition ladder, renderer catalog, sandbox
- [`docs/RENDERERS.md`](docs/RENDERERS.md) — renderers vs embedded editors, and the v1 set
- [`docs/MCP-SERVER.md`](docs/MCP-SERVER.md) — the agent contract: one tool surface for notes whether or not they are open
- [`docs/LESSONS-LEARNED-MARKDOWN-EDITOR-AUDIT.md`](docs/LESSONS-LEARNED-MARKDOWN-EDITOR-AUDIT.md) — code-level competitor audit: mechanisms to borrow, traps to reject, licenses, tests, and community evidence
- [`docs/AGENT-WORKSPACE.md`](docs/AGENT-WORKSPACE.md) — MCP safety posture and build rationale; its tool surface is superseded above
- [`docs/wireframe.html`](docs/wireframe.html) — interactive editor, agent, redirect/chat, and stop states (open in a browser)
- [`docs/superpowers/plans/`](docs/superpowers/plans/) — the Phase 0–1 implementation plan
- [`AGENTS.md`](AGENTS.md) — **contributors and agents start here** — boundaries, board, and the validation gate
- [`docs/CI-SANDBOX.md`](docs/CI-SANDBOX.md) — private canonical repo, public CI sandbox, and the branch loop

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

## The bet

Most Markdown products assume a human writes Markdown and AI assists inside an editor or workspace.
SimpleMark assumes AI composes and the human consumes, judges, and occasionally directs.

SimpleMark keeps files as the truth but treats the editor as a real document canvas. Diagrams, SVG,
math, tables, and highlighted code render in place. Source appears only for the exact content being
corrected, and everything still saves as portable Markdown.

| Decision | Choice |
|---|---|
| Editor core | Milkdown or raw ProseMirror with a source-preserving bridge — **gated on Phase 0** |
| POC coordination | One in-process `DocumentSession`; human edits and watched external changes share application use cases |
| Later collaboration | ProseMirror step authority first; Yjs only if masterless operation is required |
| Durability | Plain `.md` files in a folder; SQLite is a rebuildable cache |
| Fidelity | Untouched blocks are preserved byte-for-byte; only edited blocks re-serialize |
| Sync | Delegated to iCloud Drive / any synced folder — no server, no accounts |
| Canvas | Single unified view, no source/preview split |
| Typography | Bear-style: font, size, line height, theme in preferences |
| Extensibility | Internal extension points in v1, shaped to become the public plugin API |
| License | Apache-2.0 or MIT — permissive, so a hosted or proprietary layer stays possible |

## First task — prove the living document

**Phase 0 — fidelity.** Open a hostile real-world document, save it without editing, and diff. Then edit one block and diff everything else. Untouched content must never be rewritten — no renumbered lists, no repadded tables, no restyled fences. No off-the-shelf Markdown editor does this, because serializers normalize. Ten acceptance fixtures are in [`docs/DESIGN.md` §12](docs/DESIGN.md).

The fidelity work is visible, not a headless detour. The approved wireframe is extracted into the
real reusable UI and hosts the candidate editor against safe fixtures. After the gate passes, that
same frontend opens a real file through a browser development adapter; Tauri then replaces only
the browser file/window ports. The editor, document session, Mermaid renderer, toolbar, styles, and
components are product code from their first visible run.

Days, not weeks. Nothing else starts until it resolves.

If it passes, build only [`docs/POC.md`](docs/POC.md): open one AI-generated local Markdown file,
render it beautifully, refresh it calmly when another process changes it, make one small correction,
save atomically, and prove the source remains trustworthy. No in-app agent, MCP setup, chat,
activity feed, collaboration room, remote peer, or CRDT is part of that proof.

The product must be worth installing with collaboration removed. [`docs/PRODUCT.md`](docs/PRODUCT.md)
is the canonical contract; [`ADR-0005`](docs/decisions/0005-rendered-document-before-agent-participation.md)
records the sequencing correction.
