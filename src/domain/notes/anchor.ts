/**
 * Where a note is attached, expressed in text rather than positions.
 *
 * Positions break the moment anything edits the document — including tools that
 * are not SimpleMark. A quote plus its surroundings survives reformatting,
 * reordering, and rewriting elsewhere in the file, and fails *visibly* when the
 * passage itself is gone.
 *
 * `ADR-0007` names this as one of two anchor mechanisms: note anchors are text,
 * because after the app closes the text is all that survives. Participant
 * anchors are opaque and authority-issued, and are not this.
 */
export interface Anchor {
  readonly quote: string
  readonly prefix: string
  readonly suffix: string
  /** Document order, for listing only. Never consulted when matching. */
  readonly blockIndex: number
}

/** Characters of context kept either side of the quote. */
export const CONTEXT_LENGTH = 30

export function buildAnchor(text: string, from: number, to: number, blockIndex: number): Anchor {
  return {
    quote: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - CONTEXT_LENGTH), from),
    suffix: text.slice(to, to + CONTEXT_LENGTH),
    blockIndex,
  }
}

/** Every exact occurrence of `quote`, by start offset. */
function occurrences(quote: string, text: string): number[] {
  const found: number[] = []
  // An empty quote occurs everywhere, which is the same as nowhere useful.
  if (quote === '') return found
  let at = text.indexOf(quote)
  while (at !== -1) {
    found.push(at)
    at = text.indexOf(quote, at + 1)
  }
  return found
}

/** How many trailing prefix / leading suffix characters agree at `offset`. */
function contextScore(anchor: Anchor, text: string, offset: number): number {
  const before = text.slice(Math.max(0, offset - anchor.prefix.length), offset)
  const after = text.slice(
    offset + anchor.quote.length,
    offset + anchor.quote.length + anchor.suffix.length,
  )

  let score = 0
  for (let i = 1; i <= Math.min(before.length, anchor.prefix.length); i += 1) {
    if (before[before.length - i] !== anchor.prefix[anchor.prefix.length - i]) break
    score += 1
  }
  for (let i = 0; i < Math.min(after.length, anchor.suffix.length); i += 1) {
    if (after[i] !== anchor.suffix[i]) break
    score += 1
  }
  return score
}

/**
 * Why a quote could not be identified, or where it was found.
 *
 * Instruction targeting asks a different question for a missing passage than
 * for an ambiguous one. `matchAnchor` still collapses both to `undefined`.
 */
export type AnchorLocation =
  | { readonly kind: 'found'; readonly offset: number }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous' }

export function locateAnchor(anchor: Anchor, text: string): AnchorLocation {
  const candidates = occurrences(anchor.quote, text)
  if (candidates.length === 0) return { kind: 'missing' }
  if (candidates.length === 1) {
    const offset = candidates[0]
    return offset === undefined ? { kind: 'missing' } : { kind: 'found', offset }
  }

  const scored = candidates.map((offset) => ({ offset, score: contextScore(anchor, text, offset) }))
  const best = Math.max(...scored.map((entry) => entry.score))
  const winners = scored.filter((entry) => entry.score === best)

  // A tie means the document genuinely cannot say which one was meant.
  const winner = winners.length === 1 ? winners[0] : undefined
  return winner === undefined ? { kind: 'ambiguous' } : { kind: 'found', offset: winner.offset }
}

/**
 * The start offset of the anchored passage, or `undefined` if it cannot be
 * identified beyond doubt.
 *
 * There is deliberately no approximate matching. Fuzzy comparison is what
 * reattaches a note to a sentence that merely resembles the original, and a
 * note on the wrong sentence is worse than a note that admits it is lost.
 */
export function matchAnchor(anchor: Anchor, text: string): number | undefined {
  const located = locateAnchor(anchor, text)
  return located.kind === 'found' ? located.offset : undefined
}
