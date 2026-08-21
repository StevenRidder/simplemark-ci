# 0016. Borrow from the ProseMirror ecosystem where it fits; do not swap the editor

Date: 2026-08-22
Status: Accepted
Tasks: APP-49 (changeset), APP-50 (thread ⇄ proposal linking), APP-51 (block handles feasibility), APP-52 (this record)

## Context

The SimpleMark Margins work (ADR-0011 … ADR-0015) built comments, agent
proposals, margin cards, snapshots and compare by hand, as ProseMirror
decorations and steps inside Milkdown. Two outside toolkits were raised as
"the wheel we might be reinventing":

- **Tiptap** — a framework on ProseMirror. Its Tracked Changes extension does
  suggestion mode with accept/reject and links suggestions to comment
  threads. It is Tiptap-shaped (extensions against Tiptap's API), pre-1.0
  ("API may change"), part of the paid tier, and assumes a Yjs document.
- **Pitter Patter** — Handle with Care's React + ProseMirror toolkit: block
  reordering/resizing/repositioning, Markdown serialization with directives,
  a CodeMirror code block, uploads. No comments, no tracked changes.

SimpleMark's constraints decide the question: the Markdown file is the
document; notes live beside it in a sidecar; there is one person and one
agent, no server, no React. Adopting either toolkit means replacing the
editor adapter layer — tables, diagrams, callouts, wiki-links, front-matter
handling, notes, proposals — to gain a suggestion system that would then
have to be bent back to "the file is the truth".

## Decision

SimpleMark stays on **Milkdown on ProseMirror**. We borrow the layer under
both toolkits, and the ideas above it:

1. **`prosemirror-changeset`** (MIT, by the ProseMirror author) becomes the
   source of inserted/deleted spans: for W4 proposal markup (exact spans in
   place of the per-proposal strikethrough-plus-widget approximation), for
   W5 Compare (character-level spans in place of the block-level LCS), and
   for "what changed since the last snapshot" in Activity. It works on steps
   and documents and is framework-free. — APP-49
2. **Tiptap's linking semantics, not its code**: a proposal staged from a
   note carries that thread's id; the card shows its change (Show / Accept /
   Reject); accepting resolves the thread with an agent turn; resolving a
   thread with a pending change asks rather than leaving it pending. — APP-50
3. **Pitter Patter's block handles, as a feasibility check only**: if the
   reorder/resize behaviour is a plain ProseMirror plugin beneath the React
   layer, prototype it inside Milkdown through a `$prose` plugin and write the
   finding either way. It enters the Margins map as W7 only if it runs. — APP-51

Not adopted: Tiptap as the editor, Tiptap's paid extensions, Pitter Patter's
React shell, Yjs/real-time. The day multi-user editing is wanted is the day
the Tiptap/Yjs stack is reconsidered on its merits.

## Consequences

- One new runtime dependency (`prosemirror-changeset`); no new framework.
- The proposal and note models gain a link (a thread id on a proposal), which
  is session state plus a sidecar field — nothing enters the `.md`
  (ADR-0011's rule holds).
- APP-51 may produce a "no" — that is a valid outcome and is recorded on the
  board, not hidden.
- The Margins map (the wireframe artifact) carries this as §6 and Phase 5 so
  the plan and the code read from the same decision.
