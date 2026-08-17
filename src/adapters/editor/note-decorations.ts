import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'

import { buildAnchor, matchAnchor } from '../../domain/index.js'
import type { Anchor, Thread } from '../../domain/index.js'

/**
 * Passage tints for open notes (ADR-0007).
 *
 * A matched open thread tints its quote. An unmatched thread tints nothing.
 * Overlapping notes share one tint and a count. Setting the thread list
 * recomputes from `matchAnchor`. In-session edits then map those decorations
 * forward (spec §5.3) so rewording teaches `currentAnchors` the new quote.
 * `paintNotes` writes those derived anchors back into the in-memory threads
 * before it rematches. A destroyed match is a decoration that mapping dropped,
 * not a stored quote that no longer occurs in the text.
 *
 * Nothing here is serialisable. The document bytes do not change.
 */

interface NotesState {
  readonly threads: readonly Thread[]
  readonly decorations: DecorationSet
}

export const notesKey = new PluginKey<NotesState>('simplemark-notes')

/**
 * Document text in the same shape `matchAnchor` consumes, plus a map from a
 * character offset to a ProseMirror position.
 *
 * `textBetween(..., '\n', '\n')` plus `offset + 1` only works inside the first
 * block. Later blocks insert positions that the string never counts.
 */
function indexDocumentText(doc: ProseNode): {
  readonly text: string
  posAt(offset: number): number | undefined
  offsetsInside(from: number, to: number): { fromOffset: number; lastOffset: number } | undefined
} {
  const chars: Array<{ ch: string; pos: number | undefined }> = []
  let separated = true

  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (node.isText && node.text !== undefined) {
      for (let i = 0; i < node.text.length; i += 1) {
        chars.push({ ch: node.text[i]!, pos: pos + i })
      }
      separated = false
      return
    }
    if (node.isLeaf) {
      chars.push({ ch: '\n', pos: undefined })
      separated = false
      return
    }
    if (!separated && node.isBlock) {
      chars.push({ ch: '\n', pos: undefined })
      separated = true
    }
  })

  return {
    text: chars.map((entry) => entry.ch).join(''),
    posAt: (offset) => chars[offset]?.pos,
    offsetsInside(from, to) {
      let fromOffset: number | undefined
      let lastOffset: number | undefined
      for (let i = 0; i < chars.length; i += 1) {
        const pos = chars[i]!.pos
        if (pos === undefined || pos < from || pos >= to) continue
        if (fromOffset === undefined) fromOffset = i
        lastOffset = i
      }
      if (fromOffset === undefined || lastOffset === undefined) return undefined
      return { fromOffset, lastOffset }
    },
  }
}

/** Plain text the matcher and the rail share — the same offsets as the tints. */
export function documentText(state: EditorState): string {
  return indexDocumentText(state.doc).text
}

/**
 * Where each open, anchored thread currently sits.
 *
 * Recomputed when the thread list is set. In-session edits map the resulting
 * decorations forward so `currentAnchors` can re-derive the quote.
 */
function decorate(state: EditorState, threads: readonly Thread[]): DecorationSet {
  const indexed = indexDocumentText(state.doc)
  const byOffset = new Map<number, { to: number; ids: string[] }>()

  for (const thread of threads) {
    if (thread.state !== 'open' || thread.anchor === undefined) continue
    const offset = matchAnchor(thread.anchor, indexed.text)
    if (offset === undefined) continue

    const existing = byOffset.get(offset)
    if (existing === undefined) {
      byOffset.set(offset, { to: offset + thread.anchor.quote.length, ids: [thread.id] })
    } else {
      existing.ids.push(thread.id)
    }
  }

  const decorations: Decoration[] = []
  for (const [fromOffset, { to: toOffset, ids }] of byOffset) {
    const from = indexed.posAt(fromOffset)
    const last = indexed.posAt(toOffset - 1)
    if (from === undefined || last === undefined || last < from) continue
    decorations.push(
      Decoration.inline(
        from,
        last + 1,
        {
          class: ids.length > 1 ? 'sm-note-anchor sm-note-anchor-stacked' : 'sm-note-anchor',
          'data-count': String(ids.length),
          'data-threads': ids.join(' '),
        },
        { ids },
      ),
    )
  }

  return DecorationSet.create(state.doc, decorations)
}

/** Document-order index of the top-level block that contains `pos`. */
function blockIndexAt(state: EditorState, pos: number): number {
  let index = 0
  state.doc.forEach((_child, childPos, childIndex) => {
    if (childPos <= pos) index = childIndex
  })
  return index
}

/**
 * Fresh anchors from each live decoration's current span (spec §5.3).
 *
 * Positions are mapped through in-session edits rather than re-matched, so
 * rewording the tinted passage teaches the quote its new wording. Persist on
 * close is NOTES-10; this function is the derivation that close will save.
 */
export function currentAnchors(view: EditorView): Map<string, Anchor> {
  const result = new Map<string, Anchor>()
  const notes = notesKey.getState(view.state)
  if (notes === undefined) return result

  const indexed = indexDocumentText(view.state.doc)
  for (const decoration of notes.decorations.find()) {
    const ids = Array.isArray(decoration.spec['ids'])
      ? (decoration.spec['ids'] as readonly string[])
      : []
    if (ids.length === 0) continue

    const span = indexed.offsetsInside(decoration.from, decoration.to)
    if (span === undefined) continue

    const anchor = buildAnchor(
      indexed.text,
      span.fromOffset,
      span.lastOffset + 1,
      blockIndexAt(view.state, decoration.from),
    )
    for (const id of ids) result.set(id, anchor)
  }
  return result
}

/** Replaces the first occurrence of `from` with `to` so a test can reword a quote. */
export function replaceText(view: EditorView, from: string, to: string): void {
  if (from === '') return
  const indexed = indexDocumentText(view.state.doc)
  const offset = indexed.text.indexOf(from)
  if (offset < 0) return
  const start = indexed.posAt(offset)
  const last = indexed.posAt(offset + from.length - 1)
  if (start === undefined || last === undefined) return
  view.dispatch(view.state.tr.insertText(to, start, last + 1))
}

export function setThreads(view: EditorView, threads: readonly Thread[]): void {
  view.dispatch(view.state.tr.setMeta(notesKey, threads))
}

function notesProsePlugin(): Plugin<NotesState> {
  return new Plugin<NotesState>({
    key: notesKey,
    state: {
      init: () => ({ threads: [], decorations: DecorationSet.empty }),
      apply: (tr: Transaction, value: NotesState, _oldState, newState) => {
        const meta = tr.getMeta(notesKey) as readonly Thread[] | undefined
        if (meta !== undefined) {
          return { threads: meta, decorations: decorate(newState, meta) }
        }
        if (tr.docChanged) {
          return { ...value, decorations: value.decorations.map(tr.mapping, tr.doc) }
        }
        return value
      },
    },
    props: {
      decorations(state) {
        const notes = notesKey.getState(state)
        if (notes === undefined) return DecorationSet.empty
        return notes.decorations
      },
    },
  })
}

/** The milkdown wrapper the editor adapter mounts, beside `findPlugin`. */
export const notesPlugin = $prose(() => notesProsePlugin())
