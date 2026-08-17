import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'

import { matchAnchor } from '../../domain/index.js'
import type { Thread } from '../../domain/index.js'

/**
 * Passage tints for open notes (ADR-0007).
 *
 * A matched open thread tints its quote. An unmatched thread tints nothing.
 * Overlapping notes share one tint and a count. Positions are recomputed on
 * every document change rather than remapped: an edit can destroy a match,
 * and a remapped highlight over the wrong words is worse than no highlight.
 *
 * Nothing here is serialisable. The document bytes do not change.
 */

interface NotesState {
  readonly threads: readonly Thread[]
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
  }
}

/** Plain text the matcher and the rail share — the same offsets as the tints. */
export function documentText(state: EditorState): string {
  return indexDocumentText(state.doc).text
}

/**
 * Where each open, anchored thread currently sits.
 *
 * Recomputed on every document change rather than remapped, for the same
 * reason `find.ts` recomputes: an edit can destroy a match outright, and a
 * remapped position would survive as a highlight over the wrong words.
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
      Decoration.inline(from, last + 1, {
        class: ids.length > 1 ? 'sm-note-anchor sm-note-anchor-stacked' : 'sm-note-anchor',
        'data-count': String(ids.length),
        'data-threads': ids.join(' '),
      }),
    )
  }

  return DecorationSet.create(state.doc, decorations)
}

export function setThreads(view: EditorView, threads: readonly Thread[]): void {
  view.dispatch(view.state.tr.setMeta(notesKey, threads))
}

function notesProsePlugin(): Plugin<NotesState> {
  return new Plugin<NotesState>({
    key: notesKey,
    state: {
      init: () => ({ threads: [] }),
      apply: (tr: Transaction, value: NotesState) => {
        const meta = tr.getMeta(notesKey) as readonly Thread[] | undefined
        return meta === undefined ? value : { threads: meta }
      },
    },
    props: {
      decorations(state) {
        const notes = notesKey.getState(state)
        if (notes === undefined || notes.threads.length === 0) return DecorationSet.empty
        return decorate(state, notes.threads)
      },
    },
  })
}

/** The milkdown wrapper the editor adapter mounts, beside `findPlugin`. */
export const notesPlugin = $prose(() => notesProsePlugin())
