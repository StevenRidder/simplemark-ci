# ADR-0013: Agent edits are proposals until a person accepts them

- **Status:** Accepted
- **Date:** 2026-08-21
- **Decision owners:** SimpleMark maintainers
- **Amends:** the "agent writes land through the accepted-change stream" rule of
  [`ADR-0006`](0006-one-accepted-change-stream.md) — it still holds for every
  write that *lands*; this ADR adds a state before landing. It does not amend the
  authority model of [`ADR-0002`](0002-document-session-authority.md) or the
  revert semantics of `COLLABORATION.md` §6.1.

## Context

An agent write has always landed immediately: `apply_transaction` converts
Markdown to steps at a resolved range and applies them through
`DocumentSession`, the mirror puts them on screen, attribution and Activity
record them. The person's safety net is *after the fact* — Activity's Revert.

That is the inverse of how people review writing they did not do themselves.
Word's Track Changes and Google Docs' Suggesting mode both make the other
party's edits *visible but not real* until accepted, and the SimpleMark Margins
design map (W4) names this the trust gate: the machine suggests, the human is
the authority. On the documents people care most about — a customer PRD, a
quote — "the agent edited my document" and "the agent drafted, I decided" are
different products.

## Decision

1. **A proposal is not a transaction.** It lives outside the authority, in a
   pure `ProposalQueue`, as a *text target* (the passage's quote and the offset
   it was found at, or an append) plus the proposed Markdown. The session's
   revision, its markdown, and the file are untouched by any number of
   pending proposals.

2. **Targets are text, relocated on use.** A person keeps typing while
   proposals wait. A stored position would drift; a quote is found again at
   paint time and at accept time. A quote that is gone, or no longer unique,
   makes a proposal that cannot be accepted — the status line says so. Nothing
   is guessed.

3. **Markup is decoration.** The editor draws a strikethrough over the target
   and renders the proposed Markdown beside it through the document's own
   parser and schema, with Accept and Reject in the widget. The serialised
   Markdown is byte-identical with proposals on screen.

4. **Accept is an ordinary write.** It relocates the target, converts through
   `markdownToSteps`, and calls `applyMarkdown` at the current revision —
   the same path a direct write took, so Activity, attribution, the mirror and
   Revert need no new code. Reject forgets the proposal and says so.

5. **The agent sees its own staged work.** Inside a run the provider is shown
   the note with pending proposals applied (best effort, by text) and is told
   that staged edits may not appear in the text it reads, so it neither redoes
   an edit nor believes it failed.

6. **Propose first is the default.** Settings → Document agent → Edits offers
   *Propose first* and *Apply directly*. The default is the trust gate; the
   direct mode remains for a person who has decided to trust a run.

## Consequences

- The file-integrity guarantee is strengthened, not merely preserved: a
  proposal cannot corrupt a file because it never reaches one.
- Accepting out of order is allowed; a proposal whose passage another
  acceptance already replaced refuses honestly at accept time.
- Proposals are session state in v1: closing the note discards them, and the
  close path says how many. Persisting them beside the document is a later
  decision, if anyone wants it.
- Every accept/reject is a person's click. Accept all exists; there is no
  auto-accept timer and there will not be one.
