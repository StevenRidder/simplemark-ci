import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/**
 * Margin attribution chips (COLLABORATION.md §5.7, APP-32).
 *
 * A block touched by more than one participant lists every one of them, most
 * recent first, and is never collapsed to the last writer: where an agent
 * polished a human's paragraph, *who wrote this* genuinely has several answers.
 *
 * Two properties are load-bearing.
 *
 * **Derived, never asserted.** Authorship comes from the transactions
 * themselves — the changed range of each one and whether it arrived as remote
 * steps — so it cannot drift from what actually changed. Nothing calls "record
 * this actor here"; there is no second copy of the truth to fall out of date.
 *
 * **Inert until an agent writes.** Before the first remote transaction the
 * plugin records nothing at all, so a document only a person has edited carries
 * no chips and no cost. That is the product rule, not an optimisation: with no
 * agent in the room the window looks exactly as it did before this existed.
 *
 * Positions map forward through later edits, so a chip follows its block.
 * A block that is split or merged past recognition loses its chip rather than
 * claiming the wrong paragraph — the same refusal to guess that governs note
 * anchors (COLLABORATION.md §4.1).
 *
 * Nothing here is serialisable. The document bytes do not change.
 */

/** The actor a transaction is attributed to. `you` is this person, always. */
export const HUMAN_ACTOR = 'you'

export interface AttributionMeta {
  /** Attribute this transaction's changes to a named participant. */
  readonly actorId: string
}

interface AttributionState {
  /**
   * Node decorations, one per attributed block, spec `{ actors }`.
   *
   * The set is the state, not a cache: it is what maps forward when the
   * document changes, which is what keeps a chip on its own block.
   */
  readonly decorations: DecorationSet
  /**
   * False until an agent has written. A document a person edited alone stays
   * unattributed, so no chips appear where authorship has one answer.
   */
  readonly armed: boolean
}

export const attributionKey = new PluginKey<AttributionState>('simplemark-attribution')

const EMPTY: AttributionState = { decorations: DecorationSet.empty, armed: false }

/** Actors on one block, most recent first. */
export function actorsOf(decoration: Decoration): readonly string[] {
  const actors = decoration.spec['actors']
  return Array.isArray(actors) ? (actors as readonly string[]) : []
}

/**
 * The document range a transaction changed, in the coordinates of its result.
 *
 * Each step's map is read in the coordinates it produced, then carried through
 * the maps that follow it, which is what makes a multi-step transaction report
 * one range in the final document rather than several in stale ones.
 */
function changedRange(transaction: Transaction): { from: number; to: number } | undefined {
  let from = Number.POSITIVE_INFINITY
  let to = Number.NEGATIVE_INFINITY

  transaction.mapping.maps.forEach((map, index) => {
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const rest = transaction.mapping.slice(index + 1)
      from = Math.min(from, rest.map(newStart, -1))
      to = Math.max(to, rest.map(newEnd, 1))
    })
  })

  if (from > to) return undefined
  return { from, to }
}

/** Top-level blocks overlapping the range, as `[pos, nodeSize]` pairs. */
function blocksOverlapping(
  state: EditorState,
  range: { from: number; to: number },
): ReadonlyArray<{ from: number; to: number }> {
  const blocks: Array<{ from: number; to: number }> = []
  state.doc.forEach((child, pos) => {
    const end = pos + child.nodeSize
    // A caret sitting exactly at a boundary belongs to the block it is inside,
    // not to both neighbours: an empty range at `end` is the next block's.
    if (end <= range.from && !(range.from === range.to && end === range.from)) return
    if (pos >= range.to && !(range.from === range.to && pos === range.to)) return
    blocks.push({ from: pos, to: end })
  })
  return blocks
}

/** `actor` first, every previous actor after it, each named once. */
function promote(actors: readonly string[], actor: string): readonly string[] {
  return [actor, ...actors.filter((existing) => existing !== actor)]
}

function attributed(from: number, to: number, actors: readonly string[]): Decoration {
  return Decoration.node(
    from,
    to,
    {
      class: 'sm-attributed',
      'data-authors': actors.join(' '),
    },
    { actors },
  )
}

/**
 * Records this transaction's actor against every block it touched.
 *
 * Existing decorations are mapped first so a chip that is merely displaced by
 * the edit keeps its actors, then the touched blocks are rewritten.
 */
function record(
  state: AttributionState,
  transaction: Transaction,
  nextState: EditorState,
  actorId: string,
): AttributionState {
  const range = changedRange(transaction)
  if (range === undefined) return state

  const mapped = state.decorations.map(transaction.mapping, transaction.doc)
  const touched = blocksOverlapping(nextState, range)
  if (touched.length === 0) return { decorations: mapped, armed: true }

  const replaced: Decoration[] = []
  for (const block of touched) {
    const existing = mapped.find(block.from, block.to)
      .filter((decoration) => decoration.from === block.from && decoration.to === block.to)
    const actors = existing.length === 0 ? [] : actorsOf(existing[0]!)
    replaced.push(attributed(block.from, block.to, promote(actors, actorId)))
  }

  const kept = mapped.remove(
    touched.flatMap((block) =>
      mapped.find(block.from, block.to)
        .filter((decoration) => decoration.from === block.from && decoration.to === block.to),
    ),
  )
  return { decorations: kept.add(transaction.doc, replaced), armed: true }
}

/** One chip per actor, in the order the block records them. */
function chipsWidget(actors: readonly string[]): HTMLElement {
  const chips = document.createElement('span')
  chips.className = 'sm-margin-chips'
  chips.contentEditable = 'false'
  chips.setAttribute('aria-hidden', 'false')
  chips.setAttribute('role', 'note')
  chips.setAttribute(
    'aria-label',
    `Edited by ${actors.join(', ')}, most recent first`,
  )
  for (const actor of actors) {
    const chip = document.createElement('span')
    chip.className = 'sm-margin-chip'
    chip.dataset['actor'] = actor
    chip.title = `Edited by ${actor}`
    chip.textContent = actor
    chips.append(chip)
  }
  return chips
}

/**
 * The node decorations plus a chip widget for each.
 *
 * Widgets are rebuilt per state rather than stored, because the stored set has
 * to survive mapping and a widget's position is derived from the block it
 * belongs to. `key` lets ProseMirror reuse the DOM instead of replacing it on
 * every keystroke.
 */
function visible(state: EditorState): DecorationSet {
  const attribution = attributionKey.getState(state)
  if (attribution === undefined || !attribution.armed) return DecorationSet.empty

  const decorations: Decoration[] = []
  for (const decoration of attribution.decorations.find()) {
    const actors = actorsOf(decoration)
    if (actors.length === 0) continue
    decorations.push(decoration)
    decorations.push(
      Decoration.widget(decoration.from + 1, () => chipsWidget(actors), {
        side: -1,
        key: `attribution-${decoration.from}-${actors.join('-')}`,
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    )
  }
  return DecorationSet.create(state.doc, decorations)
}

/** Every attributed block in the live view, for the harness and for tests. */
export function currentAttribution(state: EditorState): ReadonlyArray<{
  readonly from: number
  readonly actors: readonly string[]
}> {
  const attribution = attributionKey.getState(state)
  if (attribution === undefined) return []
  return attribution.decorations
    .find()
    .map((decoration) => ({ from: decoration.from, actors: actorsOf(decoration) }))
    .sort((left, right) => left.from - right.from)
}

function attributionProsePlugin(remoteMeta: string): Plugin<AttributionState> {
  return new Plugin<AttributionState>({
    key: attributionKey,
    state: {
      init: () => EMPTY,
      apply: (transaction, value, _oldState, nextState) => {
        const explicit = transaction.getMeta(attributionKey) as AttributionMeta | undefined
        if (explicit !== undefined && transaction.docChanged) {
          return record(value, transaction, nextState, explicit.actorId)
        }
        if (!transaction.docChanged) return value

        const remote = transaction.getMeta(remoteMeta) === true
        // An unarmed document is one nobody but this person has edited. Recording
        // their keystrokes then would put a chip on every block they touch and
        // say nothing: attribution is for blocks with more than one answer.
        if (!remote && !value.armed) return value
        return record(value, transaction, nextState, remote ? 'agent' : HUMAN_ACTOR)
      },
    },
    props: {
      decorations: (state) => visible(state),
    },
  })
}

/** The milkdown wrapper the editor adapter mounts, beside `notesPlugin`. */
export const attributionPlugin = (remoteMeta: string) =>
  $prose(() => attributionProsePlugin(remoteMeta))
