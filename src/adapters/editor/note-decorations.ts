import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

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

/** Plain text of the document, with the offsets ProseMirror uses. */
export function documentText(state: EditorState): string {
  return state.doc.textBetween(0, state.doc.content.size, '\n', '\n')
}

/**
 * Where each open, anchored thread currently sits.
 *
 * Recomputed on every document change rather than remapped, for the same
 * reason `find.ts` recomputes: an edit can destroy a match outright, and a
 * remapped position would survive as a highlight over the wrong words.
 */
function decorate(state: EditorState, threads: readonly Thread[]): DecorationSet {
  const text = documentText(state)
  const byOffset = new Map<number, { to: number; ids: string[] }>()

  for (const thread of threads) {
    if (thread.state !== 'open' || thread.anchor === undefined) continue
    const offset = matchAnchor(thread.anchor, text)
    if (offset === undefined) continue

    const existing = byOffset.get(offset)
    if (existing === undefined) {
      byOffset.set(offset, { to: offset + thread.anchor.quote.length, ids: [thread.id] })
    } else {
      existing.ids.push(thread.id)
    }
  }

  return DecorationSet.create(
    state.doc,
    [...byOffset.entries()].map(([from, { to, ids }]) =>
      // +1 converts a text offset into a ProseMirror position inside the
      // first block. textBetween counts block separators as one character,
      // which matches the single leading position of the doc node.
      Decoration.inline(from + 1, to + 1, {
        class: ids.length > 1 ? 'sm-note-anchor sm-note-anchor-stacked' : 'sm-note-anchor',
        'data-count': String(ids.length),
        'data-threads': ids.join(' '),
      }),
    ),
  )
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
