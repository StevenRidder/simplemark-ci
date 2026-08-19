import { buildAnchor, locateAnchor } from '../domain/index.js'

/**
 * Which part of the document an instruction is about.
 *
 * The application answers this. The model never does. A live selection is
 * the scope. Otherwise a quote or paste is located with the text-anchor
 * matcher. Append is only what remains when nothing pointed at existing
 * content.
 */
export type InstructionTarget =
  | { readonly kind: 'selection'; readonly from: number; readonly to: number }
  | { readonly kind: 'passage'; readonly offset: number; readonly quote: string }
  | { readonly kind: 'append' }
  | { readonly kind: 'ask'; readonly reason: 'missing' | 'ambiguous'; readonly quote: string }

export interface InstructionTargetInput {
  readonly document: string
  readonly instruction: string
  readonly selection?: { readonly from: number; readonly to: number }
}

const QUOTED = /"([^"]+)"|'([^']+)'/

export function resolveInstructionTarget(input: InstructionTargetInput): InstructionTarget {
  const selection = input.selection
  if (selection !== undefined && selection.from < selection.to) {
    return { kind: 'selection', from: selection.from, to: selection.to }
  }

  const pointed = pointedText(input.instruction, input.document)
  if (pointed === undefined) return { kind: 'append' }

  const located = locateAnchor(buildAnchor(pointed, 0, pointed.length, 0), input.document)
  if (located.kind === 'found') {
    return { kind: 'passage', offset: located.offset, quote: pointed }
  }
  return { kind: 'ask', reason: located.kind, quote: pointed }
}

function pointedText(instruction: string, document: string): string | undefined {
  const pasted = instruction.trim()
  if (pasted !== '' && document.includes(pasted)) return pasted

  const quoted = QUOTED.exec(instruction)
  const inner = quoted?.[1] ?? quoted?.[2]
  if (inner !== undefined) {
    const quote = inner.trim()
    return quote === '' ? undefined : quote
  }

  return undefined
}
