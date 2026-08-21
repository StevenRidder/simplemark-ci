/**
 * Agent proposals: edits that wait for a person (AGENT-13, ADR-0013).
 *
 * A proposal is what an agent write becomes when the document agent is set to
 * propose first: the passage it would replace (as text, located again at
 * paint and accept time) plus the Markdown it would put there. Nothing here
 * touches the authority — a proposal is not a transaction, not a revision,
 * and never reaches the file. Accepting one turns it into an ordinary
 * transaction through `DocumentSession.applyMarkdown`; rejecting one simply
 * forgets it.
 *
 * Targets are text, not positions, on purpose: a person keeps typing while
 * proposals wait, and a stored position would drift with every keystroke. The
 * quote is located afresh each time it matters, and a quote that can no
 * longer be found uniquely is a proposal that can no longer be accepted —
 * said out loud, never guessed.
 *
 * Pure: no DOM, no editor, no session. The boundary check enforces it.
 */

export interface ProposedChange {
  /** Human-readable, the same name the transaction will carry once accepted. */
  readonly name: string
  readonly actorId: string
  readonly kind: 'replace' | 'append'
  /** The text the proposal replaces. Empty for an append. */
  readonly quote: string
  /** Where the quote sat when proposed — the first place to look for it again. */
  readonly offset: number
  /** The replacement (or appended) Markdown. */
  readonly markdown: string
}

export interface AgentProposal extends ProposedChange {
  readonly id: string
}

export interface ProposalLocation {
  readonly offset: number
  readonly length: number
}

/** Pending proposals, oldest first. */
export class ProposalQueue {
  #items: AgentProposal[] = []
  #next = 1

  add(change: ProposedChange): AgentProposal {
    const proposal: AgentProposal = { ...change, id: `proposal-${this.#next}` }
    this.#next += 1
    this.#items = [...this.#items, proposal]
    return proposal
  }

  list(): readonly AgentProposal[] {
    return this.#items
  }

  get(id: string): AgentProposal | undefined {
    return this.#items.find((candidate) => candidate.id === id)
  }

  remove(id: string): AgentProposal | undefined {
    const found = this.get(id)
    if (found !== undefined) this.#items = this.#items.filter((candidate) => candidate.id !== id)
    return found
  }

  clear(): readonly AgentProposal[] {
    const cleared = this.#items
    this.#items = []
    return cleared
  }

  get size(): number {
    return this.#items.length
  }
}

/**
 * Where a proposal's passage sits in `text` right now.
 *
 * The remembered offset wins when the quote is still there; otherwise the
 * quote is located by content, and only a unique occurrence counts — two
 * matches would be a guess about which one the agent meant.
 */
export function locateProposal(text: string, proposal: ProposedChange): ProposalLocation | undefined {
  if (proposal.kind === 'append') return { offset: text.length, length: 0 }
  if (proposal.quote === '') return undefined
  if (proposal.offset >= 0 && text.startsWith(proposal.quote, proposal.offset)) {
    return { offset: proposal.offset, length: proposal.quote.length }
  }
  const first = text.indexOf(proposal.quote)
  if (first < 0) return undefined
  if (text.indexOf(proposal.quote, first + 1) >= 0) return undefined
  return { offset: first, length: proposal.quote.length }
}

/**
 * The document as it would read with the proposals applied, best effort.
 *
 * This is what the agent is shown about its own pending work, so it does not
 * redo an edit it believes vanished. A quote that cannot be found in the
 * Markdown (inline syntax inside the passage, say) leaves that proposal out of
 * the picture — the provider is told, separately, that staged edits may not
 * appear in the text it reads.
 */
export function virtualMarkdown(markdown: string, proposals: readonly ProposedChange[]): string {
  let current = markdown
  for (const proposal of proposals) {
    const location = locateProposal(current, proposal)
    if (location === undefined) continue
    const before = current.slice(0, location.offset)
    const after = current.slice(location.offset + location.length)
    const separator = proposal.kind === 'append' && !before.endsWith('\n') && before !== '' ? '\n\n' : ''
    current = `${before}${separator}${proposal.markdown}${after}`
  }
  return current
}
