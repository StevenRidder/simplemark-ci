import { matchAnchor } from '../../domain/index.js'
import type { Thread } from '../../domain/index.js'

/**
 * The conditional notes rail (ADR-0007).
 *
 * No open threads, no rail element. An unmatched open thread is an orphan:
 * it keeps the original quote, tints nowhere, and offers reattach / detach /
 * remove. A matched open thread offers resolve. Bodies are plain text here;
 * Markdown rendering is a recorded deferral.
 */

export interface NoteRailActions {
  readonly resolve: (id: string) => void
  readonly detach: (id: string) => void
  readonly remove: (id: string) => void
  readonly reattach: (id: string) => void
}

export function renderNoteRail(
  host: HTMLElement,
  threads: readonly Thread[],
  actions: NoteRailActions,
  documentText: string,
): void {
  host.replaceChildren()
  const open = threads.filter((thread) => thread.state === 'open')
  if (open.length === 0) return

  const sorted = [...open].sort((left, right) => {
    const a = left.anchor?.blockIndex
    const b = right.anchor?.blockIndex
    if (a === undefined && b === undefined) return 0
    if (a === undefined) return 1
    if (b === undefined) return -1
    return a - b
  })

  const rail = document.createElement('aside')
  rail.className = 'sm-note-rail'
  rail.setAttribute('aria-label', 'Unresolved notes')

  for (const thread of sorted) {
    const matched =
      thread.anchor !== undefined && matchAnchor(thread.anchor, documentText) !== undefined
    const row = document.createElement('article')
    row.dataset['thread'] = thread.id
    row.dataset['orphan'] = matched ? 'false' : 'true'

    const body = document.createElement('p')
    body.className = 'sm-note-rail-body'
    body.textContent = thread.body
    row.append(body)

    if (!matched && thread.anchor !== undefined) {
      const quote = document.createElement('p')
      quote.className = 'sm-note-rail-quote'
      quote.textContent = `was on: "${thread.anchor.quote}"`
      row.append(quote)
    }

    const buttons = document.createElement('div')
    buttons.className = 'sm-note-rail-actions'
    if (matched) {
      buttons.append(actionButton('resolve', 'Resolve', () => actions.resolve(thread.id)))
    } else {
      buttons.append(
        actionButton('reattach', 'Reattach', () => actions.reattach(thread.id)),
        actionButton('detach', 'Keep as note', () => actions.detach(thread.id)),
        actionButton('remove', 'Delete', () => actions.remove(thread.id)),
      )
    }
    row.append(buttons)
    rail.append(row)
  }

  host.append(rail)
}

function actionButton(action: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset['action'] = action
  button.textContent = label
  button.addEventListener('click', onClick)
  return button
}
