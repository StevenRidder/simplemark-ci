import type { MarkdownDiffToken } from './ports.js'

/**
 * Compare, for presentation (ADR-0014 §5, ADR-0016).
 *
 * The editor's diff answers with a stream of kept / deleted / inserted text.
 * A reader wants paragraphs: which ones changed, with the changed words
 * marked inside them, and the unchanged ones left out. This groups the stream
 * into paragraphs at blank lines and says which carry a change.
 *
 * Pure: tokens in, paragraphs out.
 */

export interface DiffSegment {
  readonly kind: MarkdownDiffToken['kind']
  readonly text: string
}

export interface DiffParagraph {
  readonly segments: readonly DiffSegment[]
  /** Whether any segment was deleted or inserted. */
  readonly changed: boolean
}

const BLOCK = '\n\n'

export function groupDiffTokens(tokens: readonly MarkdownDiffToken[]): readonly DiffParagraph[] {
  const paragraphs: DiffParagraph[] = []
  let current: DiffSegment[] = []
  const close = (): void => {
    if (current.length === 0) return
    paragraphs.push({ segments: current, changed: current.some((segment) => segment.kind !== 'same') })
    current = []
  }
  for (const token of tokens) {
    const parts = token.text.split(BLOCK)
    parts.forEach((part, index) => {
      if (index > 0) close()
      if (part.length > 0) current.push({ kind: token.kind, text: part })
    })
  }
  close()
  return paragraphs
}

/** How many paragraphs differ — the number a summary line can say. */
export function changedParagraphCount(paragraphs: readonly DiffParagraph[]): number {
  return paragraphs.filter((paragraph) => paragraph.changed).length
}
