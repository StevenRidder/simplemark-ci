import { hasAgentTurn, matchAnchor } from '../../domain/index.js'
import type { Thread } from '../../domain/index.js'
import { tablerIcon } from './tabler-icons.js'

/**
 * The notes overview (APP-43, SimpleMark Margins W3).
 *
 * Google Docs' comment overview, sized for one person: every note on the
 * document in one list, filter chips, plain search over bodies and quotes,
 * and Jump to on each row. Opened deliberately — absent from the DOM until
 * asked for, like Activity and the agent panel (`DESIGN.md` §9) — and it
 * closes when one of those opens, because one side surface at a time is the
 * rule that keeps the document the workspace.
 */

export type OverviewFilter = 'open' | 'resolved' | 'agent' | 'all'

export interface NotesOverviewActions {
  /** Scrolls the passage into view and focuses its margin card. */
  jumpTo(id: string): void
  reopen(id: string): void
  resolve(id: string): void
  remove(id: string): void
}

export interface NotesOverviewOptions extends NotesOverviewActions {
  readonly onClosed?: () => void
  readonly threads: () => readonly Thread[]
  /** The document's plain text, for "is this passage still here". */
  readonly documentText: () => string
}

export interface NotesOverview {
  readonly host: HTMLElement
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
  /** Repaints from the threads. A no-op while closed. */
  repaint(): void
}

const FILTER_LABEL: Record<OverviewFilter, string> = {
  open: 'Open',
  resolved: 'Resolved',
  agent: 'Agent',
  all: 'All',
}

function matchesFilter(thread: Thread, filter: OverviewFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'agent') return hasAgentTurn(thread)
  return thread.state === filter
}

function matchesQuery(thread: Thread, query: string): boolean {
  if (query === '') return true
  const needle = query.toLowerCase()
  const haystack = [
    thread.body,
    thread.anchor?.quote ?? '',
    ...(thread.replies ?? []).map((reply) => reply.body),
  ].join('\n').toLowerCase()
  return haystack.includes(needle)
}

export function createNotesOverview(options: NotesOverviewOptions): NotesOverview {
  const host = document.createElement('div')
  host.className = 'sm-notes-overview-host'
  let open = false
  let filter: OverviewFilter = 'open'
  /** Survives repaints, so a search someone is typing is not reset by a note changing. */
  let query = ''

  function counts(threads: readonly Thread[]): Record<OverviewFilter, number> {
    return {
      open: threads.filter((thread) => thread.state === 'open').length,
      resolved: threads.filter((thread) => thread.state === 'resolved').length,
      agent: threads.filter((thread) => hasAgentTurn(thread)).length,
      all: threads.length,
    }
  }

  function row(thread: Thread, text: string): HTMLElement {
    const item = document.createElement('article')
    item.className = 'sm-overview-row'
    item.dataset['thread'] = thread.id
    item.dataset['state'] = thread.state
    const located = thread.anchor !== undefined && matchAnchor(thread.anchor, text) !== undefined

    const meta = document.createElement('p')
    meta.className = 'sm-overview-meta'
    const where = thread.anchor === undefined
      ? 'whole note'
      : located
        ? `“${thread.anchor.quote.length > 48 ? `${thread.anchor.quote.slice(0, 48)}…` : thread.anchor.quote}”`
        : 'passage no longer found'
    meta.textContent = `${thread.state === 'open' ? 'OPEN' : 'RESOLVED'} · ${where}`

    const body = document.createElement('p')
    body.className = 'sm-overview-body'
    body.textContent = thread.body.trim() === '' ? '(empty note)' : thread.body
    item.append(meta, body)

    const replies = thread.replies?.length ?? 0
    if (replies > 0) {
      const tail = document.createElement('p')
      tail.className = 'sm-overview-replies'
      tail.textContent = replies === 1 ? '1 reply' : `${replies} replies`
      item.append(tail)
    }

    const actions = document.createElement('div')
    actions.className = 'sm-overview-actions'
    const button = (action: string, label: string, handler: () => void): HTMLButtonElement => {
      const element = document.createElement('button')
      element.type = 'button'
      element.dataset['action'] = action
      element.textContent = label
      element.addEventListener('click', handler)
      return element
    }
    if (located) actions.append(button('jump-to', 'Jump to', () => options.jumpTo(thread.id)))
    if (thread.state === 'open') {
      actions.append(button('resolve', 'Resolve', () => options.resolve(thread.id)))
    } else {
      actions.append(button('reopen', 'Reopen', () => options.reopen(thread.id)))
      actions.append(button('delete-forever', 'Delete', () => options.remove(thread.id)))
    }
    item.append(actions)
    return item
  }

  function build(): HTMLElement {
    const panel = document.createElement('aside')
    panel.className = 'sm-notes-overview'
    panel.setAttribute('role', 'complementary')
    panel.setAttribute('aria-label', 'Notes overview')

    const header = document.createElement('header')
    header.className = 'sm-overview-header'
    const title = document.createElement('span')
    title.className = 'sm-overview-title'
    title.textContent = 'Notes'
    const close = document.createElement('button')
    close.type = 'button'
    close.dataset['action'] = 'close-overview'
    close.className = 'sm-overview-close'
    close.setAttribute('aria-label', 'Close notes overview')
    close.innerHTML = tablerIcon('x')
    close.addEventListener('click', () => closePanel())
    header.append(title, close)

    const threads = options.threads()
    const tally = counts(threads)

    const chips = document.createElement('div')
    chips.className = 'sm-overview-filters'
    chips.setAttribute('role', 'tablist')
    for (const candidate of ['open', 'resolved', 'agent', 'all'] as const) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.dataset['filter'] = candidate
      chip.setAttribute('role', 'tab')
      chip.setAttribute('aria-selected', String(filter === candidate))
      chip.textContent = `${FILTER_LABEL[candidate]} · ${tally[candidate]}`
      chip.addEventListener('click', () => {
        filter = candidate
        repaint()
      })
      chips.append(chip)
    }

    const search = document.createElement('input')
    search.type = 'search'
    search.className = 'sm-overview-search'
    search.placeholder = 'Search notes…'
    search.setAttribute('aria-label', 'Search notes')
    search.value = query
    search.addEventListener('input', () => {
      query = search.value.trim()
      paintRows()
    })

    const list = document.createElement('div')
    list.className = 'sm-overview-rows'
    const text = options.documentText()
    const paintRows = (): void => {
      list.replaceChildren()
      const shown = threads.filter((thread) => matchesFilter(thread, filter) && matchesQuery(thread, query))
      if (shown.length === 0) {
        const empty = document.createElement('p')
        empty.className = 'sm-overview-empty'
        empty.textContent = query === '' ? 'Nothing here.' : 'No notes match.'
        list.append(empty)
        return
      }
      for (const thread of shown) list.append(row(thread, text))
    }
    paintRows()

    panel.append(header, chips, search, list)
    return panel
  }

  function repaint(): void {
    if (!open) return
    const active = host.ownerDocument.activeElement
    const keepFocus = active instanceof HTMLInputElement && active.classList.contains('sm-overview-search')
    host.replaceChildren(build())
    if (keepFocus) {
      const search = host.querySelector<HTMLInputElement>('.sm-overview-search')
      search?.focus()
      search?.setSelectionRange(search.value.length, search.value.length)
    }
  }

  function openPanel(): void {
    open = true
    host.replaceChildren(build())
  }

  function closePanel(): void {
    open = false
    host.replaceChildren()
    options.onClosed?.()
  }

  return {
    host,
    open: openPanel,
    close: closePanel,
    toggle: () => (open ? closePanel() : openPanel()),
    isOpen: () => open,
    repaint,
  }
}
