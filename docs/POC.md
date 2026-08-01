# SimpleMark — Proof of Concept

**Status:** the next executable target  
**Scope:** one local note, one macOS window, one human, one local agent, no CRDT

## The question

Can one person and one agent genuinely work in the same technical Markdown note, live and without
fear of losing the file?

The POC answers that interaction question before attempting distributed collaboration. The human
editor and MCP adapter submit transactions to one in-process `DocumentSession`; neither edits files
or each other directly.

```text
Human editor ─┐
              ├─ DocumentSession ─→ structured document ─→ atomic Markdown save
Local agent ──┘
```

This is live human-agent editing, but it is not yet multi-client editing. The later authority
decision is deferred to [`ADR-0002`](decisions/0002-local-document-session-before-crdt.md).

## In

- One local Markdown file, one macOS app window, and one structured ProseMirror-compatible document.
- The source-preservation gate from `DESIGN.md` §12.
- Raw Mermaid paste, inline render, click-to-edit source, and portable fenced Markdown on save.
- One local MCP-connected agent with a visible name, scope, status, and activity entry.
- Manual invocation over one explicit selection or whole blocks. Nothing selected means nothing
  happens; the agent never edits beneath an active human cursor.
- One coherent, named agent transaction: select text and ask it to add a Mermaid diagram.
- One passage-anchored, session-only conversation. **Redirect now** fences the active generation
  and starts its replacement; **Leave note** communicates without changing the run.
- Out-of-band Stop and Redirect. A stopped or redirected generation cannot land a late edit.
- `Cmd+Z` undoes the human's last action. Activity deliberately reverts an agent transaction.
- Close and reopen to ordinary, readable Markdown.

## Out

- Yjs, another process, another human, another device, offline merge, or remote collaboration.
- Folder scanning, tags, search, sidebars, attachments, or full Bear-parity polish.
- iCloud live sync, LAN discovery, relays, encryption, keys, and permissions.
- A public or broad MCP surface; only the live-note commands needed for this proof.
- Multiple agents, autonomous document-wide work, leases, reaction budgets, and persisted threads.
- SVG beyond opaque preservation, renderer acquisition, PPTX/PDF/DOCX, and other converters.

## Transaction contract

Every human and agent change reaches `DocumentSession` as a typed transaction containing:

```ts
interface DocumentTransaction {
  actorId: string
  name: string
  expectedRevision: number
  scope: BlockScope
  run?: { id: string; generation: number }
  steps: readonly DocumentStep[]
}
```

The session checks the revision, scope, active-human focus, and run generation before applying it.
The agent returns whole-block or coherent structural steps, never blind Markdown offsets. MCP and
the editor are thin adapters over this same command.

## Source baseline rule

Each clean block keeps an immutable `originalSource` plus the revision it came from. Dirty is
monotonic until save. Once touched, the block is serialized from the structured document and its
old source is ignored. Only a successful atomic save creates a new clean baseline. `originalSource`
is never collaborative editable content.

## Acceptance test

1. Open every D7 fixture and save untouched: each file is byte-identical.
2. Paste bare Mermaid at a block boundary: it renders and saves as a normal `mermaid` fence.
3. Select a paragraph and ask the agent to add a diagram below it.
4. See one named scope/status and one grouped, attributed agent transaction.
5. Leave a note and verify it does not interrupt the run.
6. Redirect the agent; verify the old generation is fenced before the replacement starts.
7. Stop the replacement and verify neither stopped generation can apply a delayed result.
8. Put the human cursor inside a block and verify the agent cannot edit that block.
9. Undo a human edit without undoing the agent; revert the agent transaction separately.
10. Reopen the file in a plain-text editor and confirm it is clean, portable Markdown.

## Decision after one day of real use

Use the POC on one real architecture note for a day. Record only:

- whether live agent edits feel faster than suggestions;
- how often the human interrupts, redirects, or pauses the agent;
- whether the agent's presence is helpful or distracting; and
- whether the saved Markdown remains trusted.

If it is delightful, proceed to the multi-client authority spike. If it is distracting, make
suggest mode the default. Either outcome is useful evidence; neither requires building distributed
editing first.
