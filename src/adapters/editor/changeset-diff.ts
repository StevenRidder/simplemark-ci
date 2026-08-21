import { ChangeSet, simplifyChanges } from 'prosemirror-changeset'
import { Slice, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { Transform } from '@milkdown/kit/prose/transform'

/**
 * Exact inserted and deleted spans, from `prosemirror-changeset` (ADR-0016).
 *
 * The library condenses a replacement into the smallest set of changes whose
 * content actually differs, then `simplifyChanges` widens partial-word edits
 * to word boundaries so a reader never sees half a word struck through. Two
 * uses: proposal markup in the live editor (W4) and Compare between a
 * snapshot and the document now (W5). Nothing here touches Milkdown: it
 * works on ProseMirror documents and steps alone.
 */

export interface DiffToken {
  readonly kind: 'same' | 'deleted' | 'inserted'
  readonly text: string
}

/** Paragraphs are separated by a blank line in the token text, as in Markdown. */
const BLOCK = '\n\n'

function changesBetween(docA: ProseNode, docB: ProseNode) {
  const transform = new Transform(docA).replaceWith(0, docA.content.size, docB.content)
  const set = ChangeSet.create(docA).addSteps(transform.doc, transform.mapping.maps, null)
  return { changes: simplifyChanges(set.changes, transform.doc), after: transform.doc }
}

/** The two documents as one stream of kept, deleted and inserted text, in order. */
export function diffDocuments(docA: ProseNode, docB: ProseNode): readonly DiffToken[] {
  const { changes, after } = changesBetween(docA, docB)
  const tokens: DiffToken[] = []
  let cursor = 0
  const push = (kind: DiffToken['kind'], text: string): void => {
    if (text.length > 0) tokens.push({ kind, text })
  }
  for (const change of changes) {
    push('same', docA.textBetween(cursor, change.fromA, BLOCK))
    push('deleted', docA.textBetween(change.fromA, change.toA, BLOCK))
    push('inserted', after.textBetween(change.fromB, change.toB, BLOCK))
    cursor = change.toA
  }
  push('same', docA.textBetween(cursor, docA.content.size, BLOCK))
  return tokens
}

export interface ProposalSpans {
  /** Ranges of the live document the proposal removes. */
  readonly deleted: readonly { readonly from: number; readonly to: number }[]
  /** Text the proposal adds, anchored at a live-document position. */
  readonly inserted: readonly { readonly at: number; readonly text: string }[]
  /** True when the whole proposal is one insertion with nothing removed — an append or a new section. */
  readonly pureInsertion: boolean
}

/**
 * What a proposal would change inside `[from, to]` of `doc`, as exact spans.
 *
 * A rewrite that changes one word yields one deleted word and one inserted
 * word, not the whole passage struck and re-typed. Inserted text is anchored
 * at the end of the range it replaces, in the live document's coordinates,
 * which is where Word and Docs draw it.
 */
export function proposalSpans(doc: ProseNode, from: number, to: number, replacement: ProseNode): ProposalSpans {
  const transform = new Transform(doc).replaceRange(from, to, new Slice(replacement.content, 0, 0))
  const set = ChangeSet.create(doc).addSteps(transform.doc, transform.mapping.maps, null)
  const changes = simplifyChanges(set.changes, transform.doc)
  const deleted = changes
    .filter((change) => change.toA > change.fromA)
    .map((change) => ({ from: change.fromA, to: change.toA }))
  const inserted = changes
    .filter((change) => change.toB > change.fromB)
    .map((change) => ({ at: change.toA, text: transform.doc.textBetween(change.fromB, change.toB, '\n') }))
  const pureInsertion = deleted.length === 0 && changes.length <= 1
  return { deleted, inserted, pureInsertion }
}
