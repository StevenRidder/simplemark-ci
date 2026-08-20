# ADR-0012: The agent conversation is app level, hidden until asked for

- **Status:** Accepted
- **Date:** 2026-08-20
- **Decision owners:** SimpleMark maintainers
- **Amends:** the "no chat panel" rules in [`DESIGN.md`](../DESIGN.md) §9 and §10.1.
  It does not amend the anchored-notes rail rule in `DESIGN.md` §9, ADR-0007's
  A→B→C0→C→D decomposition, the two-anchor rule of
  [`ADR-0007`](0007-annotation-before-participation.md), or the sidecar storage
  of [`ADR-0011`](0011-comments-travel-beside-the-document.md).

## Context

`DESIGN.md` §9 says there is "no permanent activity, chat, agent, or inspector
rail," and §10.1 says it again as a flat sentence: "There is no agent pane,
activity sidebar, model picker, or chat panel." All three wireframes
(`wireframe.html`, `wireframe-bear.html`, `wireframe-collaboration.html`) draw
the workspace without one. Those rules earned their place: the install reason is
reading a rendered document, and every product in this category has drifted into
being a chat app with a document attached.

[`COLLABORATION.md`](../COLLABORATION.md) §5.4 specifies the other half —
Redirect "opens that passage's conversation instead of a global chatbot." Read
literally, the conversation is per-passage and only ever per-passage.

Building the surfaces for APP-32 exposed a situation neither rule covers.
`MCP-SERVER.md` §10.2 (quoted in `COLLABORATION.md` §5.7) already accepts that
an agent may be asked to edit **a note nobody has open** — that starts an
authority, not a window. A per-passage conversation cannot host that request:
there is no passage on screen to anchor it to, and no document open to put a
thread in. The instruction has nowhere to live, and the reply has nowhere to
land.

So the choice is not "chat panel or no chat panel." It is: does an instruction
that spans notes get a surface, or does the product refuse to accept one?
Refusing it would contradict a rule already accepted.

## Decision

**A single app-level conversation surface exists, spanning notes. It does not
exist in the layout until a person asks for it, it never takes focus, and it
never becomes the primary surface. The in-document surfaces are not replaced.**

1. **Absent, not collapsed.** With the panel closed there is no panel element in
   the DOM — the same standard `DESIGN.md` §9 sets for the notes rail: "absent
   from the layout, not present and empty." A session in which nobody opens it
   is byte-for-byte the product that shipped before this decision. This is the
   operative constraint, and it is what makes the amendment narrow: §9 forbids a
   **permanent** rail, and this is not one.
2. **Opened only by a person.** An agent, a run, an error, a completed edit, and
   an arriving message may never open the panel, and may never move focus into
   it. Nothing the agent does changes what surface the reader is looking at.
   A closed panel with a running agent is an ordinary state, not a missed
   notification: the note row and the status line carry it.
3. **Not the primary surface.** The document keeps the reading column and the
   window's title. The panel is a side surface with a fixed maximum width; it
   cannot be maximised, cannot become a full-window mode, and does not survive
   as a mode across a relaunch.
4. **It does not replace the in-document surfaces.** The note-row marker, the
   status line with opt-in Follow, Pause, and the margin attribution chips are
   all still required, and each covers a case the panel cannot: an edit to a
   note nobody is looking at, a run whose progress must be legible without
   reading a transcript, and a block with several authors.
5. **Messages are correctable.** A message is Markdown, rendered through the
   document's own parser and schema, and editable in place. The conversation is
   not an append-only log. Correcting a message is a local edit to app state; it
   re-sends nothing and changes no authority.
6. **Communication is still not control.** The panel's composer has two modes
   that are never conflated. **Leave note** posts a message and has no control
   effect. **Redirect** bumps the run generation through `AgentControl` and
   starts replacement work. A message whose text is "stop" is a message.
   `SWITCHBOARD-KERNEL.md` §5 is unchanged.
7. **Not persisted to the Canvas.** The conversation is app state. Nothing in it
   is written into any `.md`, and it is not the `.simplemark/` thread sidecar
   either — those are a human's anchored notes on one document (ADR-0011), and
   this spans notes.

## Alternatives rejected

- **Per-passage threads only, as `COLLABORATION.md` §5.4 reads.** Correct and
  kept for the anchored case; it cannot express "fix the heading levels in last
  week's meeting notes" while a different note is open. Choosing this would mean
  withdrawing the already-accepted rule that an agent may work in notes nobody
  has open.
- **Route cross-note instructions through the notes rail.** The rail carries a
  human's own notes on *this* document and nothing else (`DESIGN.md` §9, quoted
  by ADR-0007). Putting agent conversation in it would break the one surface
  whose emptiness the product currently guarantees.
- **A permanently docked panel.** What §9 and §10.1 forbid, and what the CHI
  evidence in `COLLABORATION.md` §5.7 argues against: teams preferred AI inside
  the shared artifact over a side chatbot. A panel you must dismiss teaches the
  reader that the document is the secondary surface.
- **A modal command palette instead of a conversation.** Fits "hidden until
  asked for" better, but a modal cannot show a running agent's status while the
  reader keeps reading, and it makes correcting an earlier instruction
  impossible — which point 5 exists to prevent.

## Consequences

### Positive

- An instruction that spans notes has a home, so the accepted `MCP-SERVER.md`
  §10.2 behaviour is reachable from the product rather than only from MCP.
- The default product is unchanged. The absent-not-collapsed rule is testable,
  and is tested: with the panel never opened, no panel element exists.
- Conversation being correctable removes the one-way transcript this product
  exists to replace.

### Negative

- Two conversation surfaces now exist — anchored threads and the app-level panel
  — and a reader could reasonably expect a message in one to appear in the other.
  It does not. They are separated by anchor, not by kind: a thread is about a
  passage in this document, the panel is about work across notes.
- The panel is the most plausible place for the product to drift into being a
  chat app. Points 1–3 are the guard, and they are only as strong as the tests
  that assert them.
- `wireframe-collaboration.html` now under-describes the shipped surface. The
  wireframes are exploration, not contract, and are not being redrawn for this.

## Compliance

- With the panel never opened, the workspace contains no panel element.
- An agent run, an agent edit, and an agent error do not open the panel and do
  not move focus.
- Sending in **Leave note** mode does not change the run generation; sending in
  **Redirect** mode does.
- A message body renders through the same parser and schema as the document, and
  editing one changes no document bytes.
