import { makeDraggable } from './draggable.js'
import type { EditorView } from '@milkdown/kit/prose/view'

import type { NoteIdentity, ThreadStore } from '../../application/index.js'
import { buildAnchor } from '../../domain/index.js'
import type { Anchor, Thread } from '../../domain/index.js'

import { indexDocumentText } from './note-decorations.js'

/**
 * Capture a note on the current selection (ADR-0007 §5.1).
 *
 * ⌘⇧M or Add Note on the context menu, with a selection, builds an anchor,
 * asks `ensureId`, and opens a focused composer. Return saves; Escape
 * discards. With no selection the document is untouched and the shell says
 * so. Front matter may hold `id` and a `comments:` link to the sidecar. Only
 * `ensureId` writes those lines. Comment bodies stay out of the `.md`.
 */

export interface NoteCaptureDeps {
  readonly store: ThreadStore
  readonly identity: NoteIdentity
  readonly handle: () => string | undefined
  readonly degradedKey: (handle: string) => string
  readonly onSaved: () => void
  readonly onNeedSelection: () => void
  /**
   * A note that could not be saved must say so. The composer only opens after
   * the thread persists, so a swallowed failure here looked like the button
   * doing nothing at all — or worse, like a note that existed until the app
   * closed.
   */
  readonly onSaveFailed?: (message: string) => void
  /** Front matter written by ensureId, so the next save keeps the comments link. */
  readonly onIdentityWritten?: (markdown: string) => void
}

const NEED_SELECTION = 'Select the text this note is about'

/** The current editor selection as a note anchor, or nothing if it is empty. */
export function anchorFromView(view: EditorView): Anchor | undefined {
  const { empty, from, to } = view.state.selection
  if (empty || from === to) return undefined

  const $from = view.state.doc.resolve(from)
  const clampedTo = Math.min(to, $from.end())
  if (clampedTo <= from) return undefined

  const indexed = indexDocumentText(view.state.doc)
  const start = indexed.offsetAt(from)
  const last = indexed.offsetAt(clampedTo - 1)
  if (start === undefined || last === undefined || last < start) return undefined
  return buildAnchor(indexed.text, start, last + 1, $from.index(0))
}

export interface NoteCapture {
  readonly destroy: () => void
  readonly capture: () => Promise<void>
}

export function installNoteCapture(view: EditorView, deps: NoteCaptureDeps): NoteCapture {
  let composer: HTMLElement | undefined
  let draft: Thread | undefined
  let busy = false
  let onPointerDown: ((event: PointerEvent) => void) | undefined

  const closeComposer = (): void => {
    if (onPointerDown !== undefined) {
      view.dom.ownerDocument.removeEventListener('pointerdown', onPointerDown, true)
      onPointerDown = undefined
    }
    composer?.remove()
    composer = undefined
  }

  const discardDraft = async (): Promise<void> => {
    const thread = draft
    draft = undefined
    closeComposer()
    if (thread !== undefined) await deps.store.remove(thread.noteKey, thread.id)
    deps.onSaved()
  }

  const saveDraft = async (body: string): Promise<void> => {
    if (draft === undefined) return
    const thread: Thread = { ...draft, body }
    draft = undefined
    closeComposer()
    await deps.store.save(thread)
    deps.onSaved()
  }

  const openComposer = (thread: Thread, from: number): void => {
    closeComposer()
    const host = view.dom.closest('.document-surface') ?? view.dom.parentElement ?? view.dom
    const panel = document.createElement('div')
    panel.className = 'sm-note-composer'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'New note')

    const quote = document.createElement('p')
    quote.className = 'sm-note-composer-quote'
    quote.textContent = thread.anchor?.quote ?? ''
    panel.append(quote)

    const textarea = document.createElement('textarea')
    textarea.setAttribute('aria-label', 'Note body')
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        void discardDraft()
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        void saveDraft(textarea.value)
      }
    })
    panel.append(textarea)

    const keyboardOpen = host.closest('.window')?.classList.contains('keyboard-open') === true
    panel.dataset['placement'] = keyboardOpen ? 'keyboard' : 'caret'
    // A phone's composer is the keyboard accessory: docked, not a window.
    if (!keyboardOpen) makeDraggable(panel)
    if (!keyboardOpen) {
      const coords = view.coordsAtPos(from)
      const hostBox = host.getBoundingClientRect()
      panel.style.top = `${Math.max(8, coords.bottom - hostBox.top + 8)}px`
      panel.style.left = `${Math.max(8, coords.left - hostBox.left)}px`
    }
    host.append(panel)
    composer = panel
    textarea.focus()

    onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || panel.contains(event.target)) return
      if (textarea.value.trim() !== '') return
      void discardDraft()
    }
    view.dom.ownerDocument.addEventListener('pointerdown', onPointerDown, true)
  }

  const capture = async (): Promise<void> => {
    if (busy || composer !== undefined) return
    const { empty, from, to } = view.state.selection
    if (empty || from === to) {
      deps.onNeedSelection()
      return
    }

    const anchor = anchorFromView(view)
    if (anchor === undefined) {
      deps.onNeedSelection()
      return
    }

    busy = true
    try {
      const handle = deps.handle()
      let noteKey = handle ?? 'browser'
      let degraded: true | undefined
      if (handle !== undefined) {
        const ensured = await deps.identity.ensureId(handle)
        if ('unwritable' in ensured) {
          const proceed = await promptUnwritable(view)
          if (!proceed) return
          noteKey = deps.degradedKey(handle)
          degraded = true
        } else {
          noteKey = ensured.id
          if (ensured.markdown !== undefined) deps.onIdentityWritten?.(ensured.markdown)
        }
      }

      const thread: Thread = {
        id: crypto.randomUUID(),
        noteKey,
        author: 'local',
        createdAt: new Date().toISOString(),
        body: '',
        anchor,
        state: 'open',
        ...(degraded === true ? { degraded: true } : {}),
      }
      draft = thread
      await deps.store.save(thread)
      deps.onSaved()
      openComposer(thread, from)
    } catch (error) {
      deps.onSaveFailed?.(error instanceof Error ? error.message : String(error))
    } finally {
      busy = false
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return
    if (event.key.toLowerCase() !== 'm') return
    event.preventDefault()
    void capture()
  }

  const document = view.dom.ownerDocument
  document.addEventListener('keydown', onKeyDown)

  return {
    destroy: () => {
      document.removeEventListener('keydown', onKeyDown)
      closeComposer()
    },
    capture,
  }
}

export { NEED_SELECTION }

function promptUnwritable(view: EditorView): Promise<boolean> {
  return new Promise((resolve) => {
    const host = view.dom.closest('.document-surface') ?? view.dom.parentElement ?? view.dom
    const panel = document.createElement('div')
    panel.className = 'sm-note-unwritable'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'File is read-only')
    makeDraggable(panel)

    const body = document.createElement('p')
    body.textContent = "This file is read-only, so notes on it won't survive a rename."
    panel.append(body)

    const actions = document.createElement('div')
    const finish = (proceed: boolean): void => {
      panel.remove()
      resolve(proceed)
    }
    const anyway = document.createElement('button')
    anyway.type = 'button'
    anyway.textContent = 'Note anyway'
    anyway.addEventListener('click', () => finish(true))
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    cancel.addEventListener('click', () => finish(false))
    actions.append(anyway, cancel)
    panel.append(actions)
    host.append(panel)
    anyway.focus()
  })
}
