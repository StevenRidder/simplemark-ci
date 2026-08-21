import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

/**
 * Pulls a live browser text selection into ProseMirror before something acts
 * on `view.state.selection`.
 *
 * A click or an arrow key moves the DOM selection synchronously, while
 * ProseMirror only learns where it went from the browser's `selectionchange`
 * event, which both Chromium and WebKit deliver asynchronously — at the next
 * rendering frame. Anything that reads the editor state inside that gap sees
 * the caret where it *was*. A toolbar or native-menu command can arrive in the
 * gap under load (#196); so can a paste (BUG-19), which then lands one move
 * behind the caret the reader is looking at. Focusing first is no better: it
 * overwrites the new DOM caret with the stale editor state.
 *
 * Text selections only. A node or cell selection is not described by the DOM
 * range the browser reports for it, so those are left to ProseMirror's own
 * `selectionchange` handling.
 */
export function syncTextSelectionFromDOM(view: EditorView): void {
  const selection = view.dom.ownerDocument.getSelection()
  if (selection === null || selection.rangeCount === 0) return

  const { anchorNode, focusNode } = selection
  if (
    anchorNode === null
    || focusNode === null
    || anchorNode.nodeType !== 3
    || focusNode.nodeType !== 3
    || !view.dom.contains(anchorNode)
    || !view.dom.contains(focusNode)
  ) return

  try {
    const anchor = view.posAtDOM(anchorNode, selection.anchorOffset)
    const head = view.posAtDOM(focusNode, selection.focusOffset)
    const next = TextSelection.create(view.state.doc, anchor, head)
    if (!next.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(next))
  } catch (error: unknown) {
    // A NodeView can replace its DOM between selection capture and mapping.
    // Keep the authoritative ProseMirror selection when that happens.
    console.warn('Could not synchronize the live editor selection; keeping the ProseMirror selection.', error)
  }
}
